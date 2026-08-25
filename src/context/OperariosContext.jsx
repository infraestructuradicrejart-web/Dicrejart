/**
 * @file OperariosContext.jsx
 * @description Contexto del padrón de operarios y sus horarios de la aplicación Dicrejart.
 * Conectado en tiempo real con Cloud Firestore para sincronización permanente.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/firestore
 */

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import PropTypes from 'prop-types';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import useAreas from '../hooks/useAreas';
import { AuthContext } from './AuthContext';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { logAudit } from '../utils/auditLog';
import { getTodayLocalDateStr, getOvertimeWeekRange } from '../utils/dateUtils';
import { checkOvertimeEligibility, calculateScheduleFromOvertime } from '../utils/overtimeRules';
import {
  triggerDailyRHNotification,
  triggerRHOvertimeNotification,
  triggerRHWeeklyOvertimeSummary,
} from '../services/rhNotificationService';

export const OperariosContext = createContext(null);

/**
 * Obtiene el horario de trabajo por defecto basándose en el día de la semana
 * Lunes a Viernes: 08:00 - 18:00 (10 horas)
 * Sábados: 08:00 - 13:00 (5 horas)
 */
const getDefaultSchedule = () => {
  const isSaturday = new Date().getDay() === 6; // 6 es Sábado
  return {
    startHour: 8,
    endHour: isSaturday ? 13 : 18,
    overtimeHours: 0,
    authorizedBy: '',
    authorizedDate: '',
  };
};

/** Estado de disponibilidad por defecto de un colaborador (siempre "activo" al alta) */
const getDefaultEstado = () => ({
  tipo: 'activo',
  desde: null,
  hasta: null,
  notas: '',
  registradoPor: null,
  registradoAt: null,
});

/**
 * Determina si un estado de disponibilidad ya expiró y debe restablecerse a 'activo'.
 * - Faltas (falta): expiran al día siguiente (cuando fechaFalta < fechaHoy).
 * - Ausencias por tiempo definido (con campo `hasta`): expiran cuando la fecha actual
 *   supera el `hasta` (hasta < fechaHoy).
 * @returns {string|null} La nota de restablecimiento si expiró, o null si sigue vigente
 */
const getExpiredEstadoResetNote = (estado, todayStr = getTodayLocalDateStr()) => {
  if (!estado || !estado.tipo || estado.tipo === 'activo') return null;
  const { tipo, desde, hasta, registradoAt } = estado;

  // Las faltas (inasistencias puntuales) son estrictamente de 1 solo día:
  if (tipo === 'falta' || tipo === 'salida_campo') {
    const fechaPuntual = desde || (registradoAt ? registradoAt.split('T')[0] : null);
    if (fechaPuntual && fechaPuntual < todayStr) {
      return `Restablecido automáticamente a En Planta (La ${tipo === 'falta' ? 'falta diaria' : 'salida de campo'} del ${fechaPuntual} concluyó)`;
    }
    return null;
  }

  // Ausencias programadas con fecha límite 'hasta' (vacaciones, incapacidad, viajes, etc.):
  if (hasta && hasta < todayStr) {
    return `Restablecido automáticamente a En Planta (Venció periodo de ausencia el ${hasta})`;
  }

  return null;
};

/**
 * Revisa si el estado de disponibilidad de un colaborador ya expiró y, de ser así, lo
 * restablece a 'activo' (En Planta) — dentro de una transacción que relee el documento
 * ANTES de decidir.
 *
 * Por qué la transacción: esta función corre para CADA operario en CADA snapshot del
 * listener de `operarios` (onSnapshot sobre la colección completa) — es decir, cualquier
 * cambio a CUALQUIER colaborador (autorizar una jornada, aprobar horas extra, etc.) la
 * vuelve a disparar para TODOS. Con un simple updateDoc basado en el `op` recibido por
 * parámetro (que puede estar obsoleto), dos evaluaciones casi simultáneas del mismo
 * colaborador podían pisarse: si un supervisor registraba una falta NUEVA justo cuando
 * esta función todavía traía en memoria el estado ANTERIOR (ya vencido) de ese mismo
 * colaborador, su updateDoc llegaba después y borraba la falta recién registrada —
 * dejándola "sin registrar" pocos segundos después de capturada. Al releer el documento
 * dentro de la transacción se evalúa siempre el estado más reciente, así que una falta
 * nueva nunca puede ser pisada por un restablecimiento basado en datos viejos.
 */
const evaluateAndResetExpiredEstado = async (op) => {
  if (!db || !op || !op.estado || op.estado.tipo === 'activo') return;
  // Chequeo barato con los datos ya en memoria antes de abrir una transacción — evita
  // pagar una lectura de red para el caso normal (colaborador activo o ausencia vigente).
  if (!getExpiredEstadoResetNote(op.estado, getTodayLocalDateStr())) return;

  const opRef = doc(db, 'operarios', op.id);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(opRef);
      if (!snap.exists()) return;
      const current = snap.data();
      const resetNotes = getExpiredEstadoResetNote(current.estado, getTodayLocalDateStr());
      if (!resetNotes) return;

      const defaultEstado = {
        tipo: 'activo',
        desde: getTodayLocalDateStr(),
        hasta: null,
        notas: resetNotes,
        registradoPor: 'Sistema (Restablecimiento Automático)',
        registradoAt: new Date().toISOString(),
      };
      tx.update(opRef, {
        estado: defaultEstado,
        estadoHistorial: [...(current.estadoHistorial || []), defaultEstado],
      });
    });
  } catch (err) {
    console.error(`Error al restablecer automáticamente el estado de ${op.id}:`, err);
  }
};

export const OperariosProvider = ({ children }) => {
  const [blockDuration, setBlockDuration] = useState(() => {
    const saved = localStorage.getItem('dicrejart_block_duration');
    return saved ? Number(saved) : 2;
  });

  const [operarios, setOperarios] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [horasExtra, setHorasExtra] = useState([]);
  const [solicitudesHorasExtra, setSolicitudesHorasExtra] = useState([]);

  // verifyAreaAuthorizer valida, con la contraseña real de un tercero, que tenga
  // autoridad (Admin, Encargado o Supervisor) sobre un área específica
  const { verifyAreaAuthorizer, user } = useContext(AuthContext) || {};
  const { limits, generalConfig, updateGeneralConfig } = useContext(ConfigContext) || {};
  const movimientosPersonalLimit = limits?.movimientosPersonalLimit || DEFAULT_LIMITS.movimientosPersonalLimit;
  const horasExtraLimit = limits?.horasExtraLimit || DEFAULT_LIMITS.horasExtraLimit;
  
  const { resolveAreaId } = useAreas();

  // ============================================
  // SCHEDULER AUTOMÁTICO DE NOTIFICACIONES A RH
  // (Monitorea y despacha automáticamente a las 10:00 AM, 17:30 y Miércoles 18:00
  // mientras haya algún usuario conectado en la aplicación)
  // ============================================
  useEffect(() => {
    if (!db || !user || !generalConfig) return;

    const checkAndTriggerRHNotifications = async () => {
      const now = new Date();
      const todayStr = getTodayLocalDateStr(now);
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const nowMinutes = currentHours * 60 + currentMinutes;
      const dayOfWeek = now.getDay(); // 0 = Domingo, 1-5 = L-V, 6 = Sábado

      // 1. Reporte diario de faltas + ausencias (10:00 AM)
      if (
        generalConfig.notificarFaltasRH !== false &&
        generalConfig.lastRHNotificationDate !== todayStr
      ) {
        const [th, tm] = (generalConfig.horaNotificacionRH || '10:00').split(':').map(Number);
        const targetMinutes = (th || 10) * 60 + (tm || 0);
        if (nowMinutes >= targetMinutes) {
          try {
            await triggerDailyRHNotification({
              operarios,
              horasExtra,
              generalConfig,
              updateGeneralConfig,
              force: false,
              user: null,
            });
          } catch (err) {
            console.error('Auto-trigger diario de faltas RH:', err);
          }
        }
      }

      // 2. Relación de horas extras autorizadas hoy (Lun-Vie 17:30, Sáb 12:00, no domingo)
      if (
        generalConfig.notificarHorasExtraRH !== false &&
        generalConfig.lastRHOvertimeNotificationDate !== todayStr &&
        dayOfWeek !== 0
      ) {
        const horaConfigurada = dayOfWeek === 6
          ? (generalConfig.horaNotificacionHorasExtraRHSabado || '12:00')
          : (generalConfig.horaNotificacionHorasExtraRHSemana || '17:30');
        const [th, tm] = horaConfigurada.split(':').map(Number);
        const targetMinutes = (th || 17) * 60 + (tm || 30);

        if (nowMinutes >= targetMinutes) {
          try {
            await triggerRHOvertimeNotification({
              horasExtra,
              generalConfig,
              updateGeneralConfig,
              force: false,
              user: null,
              horaLabel: horaConfigurada,
            });
          } catch (err) {
            console.error('Auto-trigger diario de horas extras RH:', err);
          }
        }
      }

      // 3. Resumen semanal de horas extra (Miércoles 18:00)
      if (
        generalConfig.notificarResumenSemanalRH !== false &&
        generalConfig.lastRHWeeklySummaryDate !== todayStr &&
        dayOfWeek === 3
      ) {
        const [th, tm] = (generalConfig.horaResumenSemanalRH || '18:00').split(':').map(Number);
        const targetMinutes = (th || 18) * 60 + (tm || 0);

        if (nowMinutes >= targetMinutes) {
          try {
            await triggerRHWeeklyOvertimeSummary({
              horasExtra,
              generalConfig,
              updateGeneralConfig,
              force: false,
              user: null,
            });
          } catch (err) {
            console.error('Auto-trigger semanal de horas extras RH:', err);
          }
        }
      }
    };

    checkAndTriggerRHNotifications();
    const interval = setInterval(checkAndTriggerRHNotifications, 30000);
    return () => clearInterval(interval);
  }, [operarios, horasExtra, generalConfig, updateGeneralConfig, user]);

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  useEffect(() => {
    if (!db || !auth) return;

    let unsubOperarios = null;
    let unsubMovimientosActive = null;
    let unsubMovimientosHistorical = null;
    let unsubHorasExtraActive = null;
    let unsubHorasExtraHistorical = null;
    let unsubSolicitudesHorasExtraActive = null;
    let unsubSolicitudesHorasExtraHistorical = null;

    let movimientosActiveList = [];
    let movimientosHistoricalList = [];
    let horasExtraActiveList = [];
    let horasExtraHistoricalList = [];
    let solicitudesHorasExtraActiveList = [];
    let solicitudesHorasExtraHistoricalList = [];

    const combineMovimientos = () => {
      const activeIds = new Set(movimientosActiveList.map((m) => m.id));
      const merged = [...movimientosActiveList, ...movimientosHistoricalList.filter((m) => !activeIds.has(m.id))];
      merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setMovimientos(merged);
    };
    const combineHorasExtra = () => {
      const activeIds = new Set(horasExtraActiveList.map((h) => h.id));
      const merged = [...horasExtraActiveList, ...horasExtraHistoricalList.filter((h) => !activeIds.has(h.id))];
      merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setHorasExtra(merged);
    };
    const combineSolicitudesHorasExtra = () => {
      const activeIds = new Set(solicitudesHorasExtraActiveList.map((s) => s.id));
      const merged = [...solicitudesHorasExtraActiveList, ...solicitudesHorasExtraHistoricalList.filter((s) => !activeIds.has(s.id))];
      merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setSolicitudesHorasExtra(merged);
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubOperarios) unsubOperarios();
      if (unsubMovimientosActive) unsubMovimientosActive();
      if (unsubMovimientosHistorical) unsubMovimientosHistorical();
      if (unsubHorasExtraActive) unsubHorasExtraActive();
      if (unsubHorasExtraHistorical) unsubHorasExtraHistorical();
      if (unsubSolicitudesHorasExtraActive) unsubSolicitudesHorasExtraActive();
      if (unsubSolicitudesHorasExtraHistorical) unsubSolicitudesHorasExtraHistorical();

      if (!user) {
        setOperarios([]);
        setMovimientos([]);
        setHorasExtra([]);
        setSolicitudesHorasExtra([]);
        return;
      }

      unsubOperarios = onSnapshot(collection(db, 'operarios'), (snapshot) => {
        const list = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const op = {
            ...data,
            schedule: data.schedule || getDefaultSchedule(),
            estado: data.estado || getDefaultEstado(),
            puesto: data.puesto || 'operario',
          };
          list.push(op);
          // Evaluar si expiró su ausencia (falta anterior o periodo concluido)
          evaluateAndResetExpiredEstado(op);
        });
        setOperarios(list);
      });

      // Cada una de las tres colecciones de abajo se carga con dos suscripciones
      // combinadas en vez de una sola capada por cantidad: lo que todavía necesita
      // acción (pendiente, sin importar cuántos registros nuevos se acumulen en otra
      // parte de la empresa) se carga SIN límite, y solo lo ya resuelto respeta el
      // límite configurado en Admin — para consulta casual de historial sin cargar
      // memoria de más. Mismo patrón usado en ActividadesContext.jsx,
      // ComprasContext.jsx y MaterialesContext.jsx.
      unsubMovimientosActive = onSnapshot(
        query(collection(db, 'movimientos_personal'), where('status', 'in', ['pendiente_origen', 'pendiente_destino'])),
        (snapshot) => {
          movimientosActiveList = [];
          snapshot.forEach((doc) => movimientosActiveList.push(doc.data()));
          combineMovimientos();
        },
        (err) => console.warn('Aviso leyendo movimientos de personal activos:', err)
      );
      unsubMovimientosHistorical = onSnapshot(
        query(collection(db, 'movimientos_personal'), where('status', 'in', ['autorizado', 'rechazado']), orderBy('createdAt', 'desc'), limit(movimientosPersonalLimit)),
        (snapshot) => {
          movimientosHistoricalList = [];
          snapshot.forEach((doc) => movimientosHistoricalList.push(doc.data()));
          combineMovimientos();
        },
        (err) => console.warn('Aviso leyendo movimientos de personal resueltos:', err)
      );

      unsubHorasExtraActive = onSnapshot(
        query(collection(db, 'horas_extra'), where('verificationStatus', '==', 'pendiente')),
        (snapshot) => {
          horasExtraActiveList = [];
          snapshot.forEach((doc) => horasExtraActiveList.push(doc.data()));
          combineHorasExtra();
        },
        (err) => console.warn('Aviso leyendo horas extra pendientes de verificar:', err)
      );
      unsubHorasExtraHistorical = onSnapshot(
        query(collection(db, 'horas_extra'), where('verificationStatus', 'in', ['cumplido', 'no_cumplido', 'cancelado']), orderBy('createdAt', 'desc'), limit(horasExtraLimit)),
        (snapshot) => {
          horasExtraHistoricalList = [];
          snapshot.forEach((doc) => horasExtraHistoricalList.push(doc.data()));
          combineHorasExtra();
        },
        (err) => console.warn('Aviso leyendo horas extra ya verificadas:', err)
      );

      unsubSolicitudesHorasExtraActive = onSnapshot(
        query(collection(db, 'solicitudes_horas_extra'), where('status', '==', 'pendiente')),
        (snapshot) => {
          solicitudesHorasExtraActiveList = [];
          snapshot.forEach((doc) => solicitudesHorasExtraActiveList.push(doc.data()));
          combineSolicitudesHorasExtra();
        },
        (err) => console.warn('Aviso leyendo solicitudes de horas extra pendientes:', err)
      );
      unsubSolicitudesHorasExtraHistorical = onSnapshot(
        query(collection(db, 'solicitudes_horas_extra'), where('status', 'in', ['autorizada', 'rechazada', 'cancelada']), orderBy('createdAt', 'desc'), limit(horasExtraLimit)),
        (snapshot) => {
          solicitudesHorasExtraHistoricalList = [];
          snapshot.forEach((doc) => solicitudesHorasExtraHistoricalList.push(doc.data()));
          combineSolicitudesHorasExtra();
        },
        (err) => console.warn('Aviso leyendo solicitudes de horas extra resueltas:', err)
      );
    });

    return () => {
      unsubAuth();
      if (unsubOperarios) unsubOperarios();
      if (unsubMovimientosActive) unsubMovimientosActive();
      if (unsubMovimientosHistorical) unsubMovimientosHistorical();
      if (unsubHorasExtraActive) unsubHorasExtraActive();
      if (unsubHorasExtraHistorical) unsubHorasExtraHistorical();
      if (unsubSolicitudesHorasExtraActive) unsubSolicitudesHorasExtraActive();
      if (unsubSolicitudesHorasExtraHistorical) unsubSolicitudesHorasExtraHistorical();
    };
  }, [movimientosPersonalLimit, horasExtraLimit]);

  // ============================================
  // ACCIONES FIRESTORE
  // ============================================

  /**
   * Reasigna el área activa de un operario en Firestore
   */
  const assignToArea = useCallback(async (operarioId, newAreaId) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'operarios', operarioId), { currentArea: newAreaId });
      logAudit({ user, module: 'operarios', action: 'Reasignó área de un operario', details: `${operarioId} -> ${newAreaId}` });
    } catch (error) {
      console.error('Error al reasignar área del operario:', error);
    }
  }, [user]);

  /**
   * Regresa a un operario prestado a su área de origen en Firestore
   */
  const returnToHomeArea = useCallback(async (operarioId) => {
    if (!db) return;
    const op = operarios.find((o) => o.id === operarioId);
    if (!op) return;
    try {
      await updateDoc(doc(db, 'operarios', operarioId), { currentArea: op.homeArea });
      logAudit({ user, module: 'operarios', action: 'Regresó operario a su área de origen', details: `${op.name} -> ${op.homeArea}` });
    } catch (error) {
      console.error('Error al regresar operario a área de origen:', error);
    }
  }, [operarios, user]);

  /**
   * Actualiza el horario de trabajo y horas extras VIGENTE HOY de un colaborador en
   * Firestore. `operarios.schedule` es un solo campo embebido (no un registro por fecha)
   * que Operarios y Calidad usan para saber el horario/horas extra de HOY — si se
   * programa una fecha FUTURA, escribir aquí pisaría el horario de hoy que sigue
   * vigente y lo haría "desaparecer" de esas vistas. La autorización futura en sí ya
   * queda registrada aparte, por fecha, en `horas_extra` (ver authorizeOvertimeTasks).
   */
  const updateOperarioSchedule = useCallback(async (operarioId, scheduleData) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const op = operarios.find((o) => o.id === operarioId);
    if (!op) return { ok: false, error: 'Colaborador no encontrado.' };

    const todayStr = getTodayLocalDateStr();
    const targetDate = scheduleData.authorizedDate || todayStr;

    if (Number(scheduleData.overtimeHours) > 0) {
      const eligibility = checkOvertimeEligibility(op, targetDate);
      if (!eligibility.isEligible) {
        return { ok: false, error: eligibility.reason };
      }
    }

    if (scheduleData.authorizedDate !== todayStr) {
      logAudit({ user, module: 'operarios', action: 'Programó horario/horas extra para una fecha futura', details: `${op.name}: ${scheduleData.authorizedDate}` });
      return { ok: true };
    }
    try {
      await updateDoc(doc(db, 'operarios', operarioId), {
        schedule: {
          ...op.schedule,
          ...scheduleData,
        },
      });
      logAudit({ user, module: 'operarios', action: 'Actualizó horario/horas extra de un operario', details: op.name });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar horario del operario:', error);
      return { ok: false, error: error.message };
    }
  }, [operarios, user]);

  /**
   * Registra en la colección `horas_extra` (un documento por autorización, nunca se
   * sobreescribe) las tareas que el colaborador realizará durante el tiempo extra recién
   * autorizado — a diferencia de `schedule` (que solo guarda el horario "vigente" de
   * hoy y se sobreescribe en cada autorización), este es el registro auditable que
   * Calidad revisa después para verificar que el trabajo realmente se hizo.
   */
  const authorizeOvertimeTasks = useCallback(async (operarioId, { startHour, endHour, overtimeHours, overtimeTasks, authorizedDate }) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const op = operarios.find((o) => o.id === operarioId);
    if (!op) return { ok: false, error: 'Colaborador no encontrado.' };

    if (Number(overtimeHours) > 0) {
      // Tope semanal: se consulta directo a Firestore (no el arreglo local `horasExtra`,
      // limitado a las últimas `horasExtraLimit` de TODA la empresa vía onSnapshot) para
      // que el acumulado sea siempre correcto sin importar cuánto historial exista. Si ya
      // se llamó cancelPendingHorasExtra para esta misma fecha (flujo normal de
      // handleSaveSchedule), esa autorización previa del mismo día ya quedó "cancelado" y
      // no se cuenta dos veces.
      const { start: weekStart, end: weekEnd } = getOvertimeWeekRange(authorizedDate);
      let weeklyAccumulatedHours = 0;
      try {
        const weekSnap = await getDocs(query(
          collection(db, 'horas_extra'),
          where('operarioId', '==', operarioId),
          where('authorizedDate', '>=', weekStart),
          where('authorizedDate', '<=', weekEnd)
        ));
        weeklyAccumulatedHours = weekSnap.docs
          .map((d) => d.data())
          .filter((h) => h.verificationStatus !== 'cancelado')
          .reduce((sum, h) => sum + Number(h.overtimeHours || 0), 0);
      } catch (error) {
        console.error('Error al calcular horas extra acumuladas de la semana:', error);
      }

      const eligibility = checkOvertimeEligibility(op, authorizedDate, weeklyAccumulatedHours);
      if (!eligibility.isEligible) {
        return { ok: false, error: eligibility.reason };
      }
    }

    const id = `HE-${Date.now()}`;
    const created = {
      id,
      operarioId,
      operarioName: op.name,
      operarioPuesto: op.puesto || 'operario',
      areaId: op.currentArea,
      authorizedDate,
      startHour: Number(startHour),
      endHour: Number(endHour),
      overtimeHours: Number(overtimeHours),
      overtimeTasks: overtimeTasks.trim(),
      authorizedBy: user?.name || 'Supervisor',
      authorizedByRole: user?.roleType || null,
      createdAt: new Date().toISOString(),
      verificationStatus: 'pendiente',
      verifiedBy: null,
      verifiedByRole: null,
      verifiedAt: null,
      verificationNotes: '',
    };

    try {
      await setDoc(doc(db, 'horas_extra', id), created);
      logAudit({ user, module: 'operarios', action: 'Autorizó horas extra con tareas asignadas', details: `${op.name}: ${overtimeHours}h el ${authorizedDate}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al registrar autorización de horas extra:', error);
      return { ok: false, error: error.message };
    }
  }, [operarios, user]);

  /**
   * Calidad (o Admin / Supervisor) marca si las tareas asignadas durante el tiempo extra realmente se
   * cumplieron. Permite cambiar de opción o restablecer a pendiente en caso de error.
   */
  const verifyHorasExtra = useCallback(async (horasExtraId, { verificationStatus, verificationNotes }) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    if (verificationStatus === 'no_cumplido' && !verificationNotes?.trim()) {
      return { ok: false, error: 'Indica qué tareas no se cumplieron.' };
    }
    try {
      const isReset = verificationStatus === 'pendiente';
      await updateDoc(doc(db, 'horas_extra', horasExtraId), {
        verificationStatus,
        verificationNotes: isReset ? '' : (verificationNotes?.trim() || ''),
        verifiedBy: isReset ? null : (user?.name || null),
        verifiedByRole: isReset ? null : (user?.roleType || null),
        verifiedAt: isReset ? null : new Date().toISOString(),
      });
      logAudit({ user, module: 'operarios', action: isReset ? 'Restableció verificación de horas extra' : 'Verificó cumplimiento de horas extra', details: `${horasExtraId}: ${verificationStatus}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al verificar horas extra:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Calidad registra el horario REAL (dentro del bloque de tiempo extra ya autorizado)
   * cuando el colaborador no llegó o no se retiró a la hora indicada — ej. se autorizó
   * entrada a las 6:00 pero llegó hasta las 8:00. No sobreescribe `startHour`/`endHour`
   * (lo autorizado), se guarda como anotación aparte para conservar ambos datos.
   */
  const correctHorasExtraSchedule = useCallback(async (horasExtraId, { actualStartHour, actualEndHour, reason }) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    if (!reason?.trim()) return { ok: false, error: 'Indica el motivo de la corrección.' };
    try {
      await updateDoc(doc(db, 'horas_extra', horasExtraId), {
        scheduleCorrection: {
          actualStartHour: Number(actualStartHour),
          actualEndHour: Number(actualEndHour),
          reason: reason.trim(),
          correctedBy: user?.name || null,
          correctedByRole: user?.roleType || null,
          correctedAt: new Date().toISOString(),
        },
      });
      logAudit({ user, module: 'operarios', action: 'Corrigió el horario real de tiempo extra', details: `${horasExtraId}: ${actualStartHour}:00-${actualEndHour}:00 — ${reason.trim()}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al corregir horario de tiempo extra:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Cancela CUALQUIER autorización de horas extra previa (pendiente, cumplido o
   * no_cumplido) de este colaborador para esta fecha — se llama justo antes de guardar
   * una nueva autorización (o de quitar las horas por completo) para esa misma fecha.
   * Antes solo se cancelaban las 'pendiente', dejando "huérfano" un registro YA
   * verificado si el supervisor ponía, quitaba y volvía a poner horas extra el mismo
   * día (ej. corrigiendo un bloque mal capturado) — eso producía dos registros activos
   * simultáneos para la misma fecha (duplicados visibles en Producción/Calidad). Al
   * redefinir la jornada de un día, el registro anterior (verificado o no) deja de ser
   * vigente, así que se cancela también.
   */
  const cancelPendingHorasExtra = useCallback(async (operarioId, authorizedDate) => {
    if (!db) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'horas_extra'),
        where('operarioId', '==', operarioId),
        where('authorizedDate', '==', authorizedDate)
      ));
      const toCancel = snap.docs.filter((docSnap) => docSnap.data().verificationStatus !== 'cancelado');
      if (toCancel.length === 0) return;
      await Promise.all(toCancel.map((docSnap) => updateDoc(docSnap.ref, {
        verificationStatus: 'cancelado',
        canceledBy: user?.name || null,
        canceledByRole: user?.roleType || null,
        canceledAt: new Date().toISOString(),
      })));
      logAudit({ user, module: 'operarios', action: 'Canceló autorización(es) de horas extra previas', details: `${operarioId} (${authorizedDate}): ${toCancel.length} registro(s)` });
    } catch (error) {
      console.error('Error al cancelar autorizaciones de horas extra previas:', error);
    }
  }, [user]);

  /**
   * Busca la autorización de horas extra VIGENTE (no cancelada) de un colaborador para una
   * fecha exacta — consulta directo a Firestore en vez del arreglo local `horasExtra`
   * (limitado a las últimas `horasExtraLimit` autorizaciones de TODA la empresa, ver el
   * onSnapshot de arriba). Con horas extra programándose casi a diario, ese recorte se
   * agota rápido y una autorización real de días atrás dejaba de "verse" en el formulario
   * — el supervisor la creía perdida y, al reprogramar, terminaba pisándola por accidente.
   * Devuelve el registro completo (para precargar el formulario) o `null` si no existe.
   */
  const findHorasExtraForDate = useCallback(async (operarioId, authorizedDate) => {
    if (!db || !operarioId || !authorizedDate) return null;
    try {
      const snap = await getDocs(query(
        collection(db, 'horas_extra'),
        where('operarioId', '==', operarioId),
        where('authorizedDate', '==', authorizedDate)
      ));
      const active = snap.docs.map((d) => d.data()).find((h) => h.verificationStatus !== 'cancelado');
      return active || null;
    } catch (error) {
      console.error('Error al buscar autorización de horas extra por fecha:', error);
      return null;
    }
  }, []);

  /**
   * Modifica la duración global de los bloques de tiempo de evaluación
   */
  const updateBlockDuration = useCallback((hours) => {
    const num = Number(hours);
    setBlockDuration(num);
    localStorage.setItem('dicrejart_block_duration', String(num));
  }, []);

  /**
   * Importa operarios desde filas de Excel y las guarda en Firestore, validando duplicados
   */
  const importFromExcel = useCallback(async (rows) => {
    if (!db) return { added: 0, skipped: 0, duplicates: 0, error: 'Firestore no está inicializado' };

    let added = 0;
    let skipped = 0;
    let duplicates = 0;

    // Calcular el id inicial en base a los existentes
    let nextIdNumber = operarios.reduce((max, op) => {
      const num = Number(op.id.replace('OP-', ''));
      return Number.isFinite(num) && num > max ? num : max;
    }, 0) + 1;

    try {
      for (const row of rows) {
        const keys = Object.keys(row);
        const nameKey = keys.find((k) => /nombre|name/i.test(k));
        const areaKey = keys.find((k) => /area|área/i.test(k));

        const name = nameKey ? String(row[nameKey]).trim() : '';
        const areaId = areaKey ? resolveAreaId(row[areaKey]) : null;

        if (!name || !areaId) {
          skipped += 1;
          continue;
        }

        // Validar si ya existe un operario con el mismo nombre y área de origen para evitar duplicados
        const isDuplicate = operarios.some(
          (op) => op.name.toLowerCase() === name.toLowerCase() && op.homeArea === areaId
        );

        if (isDuplicate) {
          duplicates += 1;
          continue;
        }

        const id = `OP-${String(nextIdNumber).padStart(2, '0')}`;
        const opData = {
          id,
          name,
          homeArea: areaId,
          currentArea: areaId,
          schedule: getDefaultSchedule(),
          // La importación por Excel es exclusiva del personal de piso — el de Diseño
          // se da de alta individualmente desde "Nuevo Operario" (ver addOperario)
          puesto: 'operario',
        };

        // Guardar documento en Firestore
        await setDoc(doc(db, 'operarios', id), opData);
        nextIdNumber += 1;
        added += 1;
      }
    } catch (error) {
      console.error('Error en la importación de Excel a Firestore:', error);
      return { added, skipped, duplicates, error: error.message };
    }

    logAudit({ user, module: 'operarios', action: 'Importó padrón de operarios desde Excel', details: `${added} agregados, ${duplicates} duplicados, ${skipped} omitidos` });
    return { added, skipped, duplicates };
  }, [operarios, user, resolveAreaId]);

  /**
   * Agrega un solo operario nuevo al padrón (alta individual, sin pasar por Excel). Usa
   * el mismo esquema de id (`OP-XX`) y validación de duplicados que `importFromExcel`.
   * `puesto` distingue al personal de piso ('operario', valor por defecto) del
   * departamento de Diseño ('disenador' / 'arquitecto') — estos últimos tienen una
   * jerarquía distinta (no aplican préstamos/jornada de manufactura) y, para iniciar
   * sesión y consultar sus tareas, se vinculan aparte a una cuenta de Usuario desde
   * Admin → Usuarios del Sistema (campo `operarioId` en el perfil de ese Usuario).
   */
  const addOperario = useCallback(async (name, areaId, puesto = 'operario') => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const trimmedName = (name || '').trim();
    if (!trimmedName || !areaId) {
      return { ok: false, error: 'El nombre y el área son obligatorios.' };
    }

    const isDuplicate = operarios.some(
      (op) => op.name.toLowerCase() === trimmedName.toLowerCase() && op.homeArea === areaId
    );
    if (isDuplicate) {
      return { ok: false, error: 'Ya existe un operario con ese nombre en esa área.' };
    }

    const nextIdNumber = operarios.reduce((max, op) => {
      const num = Number(op.id.replace('OP-', ''));
      return Number.isFinite(num) && num > max ? num : max;
    }, 0) + 1;
    const id = `OP-${String(nextIdNumber).padStart(2, '0')}`;

    const opData = {
      id,
      name: trimmedName,
      homeArea: areaId,
      currentArea: areaId,
      schedule: getDefaultSchedule(),
      puesto,
    };

    try {
      await setDoc(doc(db, 'operarios', id), opData);
      logAudit({ user, module: 'operarios', action: 'Agregó un operario', details: `${trimmedName} (${id}, ${puesto})` });
      return { ok: true, id };
    } catch (error) {
      console.error('Error al agregar operario:', error);
      return { ok: false, error: error.message };
    }
  }, [operarios, user]);

  const updateOperario = useCallback(async (operarioId, updates = {}) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const patch = {};
    if (updates.name !== undefined) {
      const trimmed = (updates.name || '').trim();
      if (!trimmed) return { ok: false, error: 'El nombre es obligatorio.' };
      patch.name = trimmed;
    }
    if (updates.puesto !== undefined) {
      patch.puesto = updates.puesto;
    }
    if (updates.homeArea !== undefined) {
      patch.homeArea = updates.homeArea;
      if (updates.currentArea === undefined) {
        patch.currentArea = updates.homeArea;
      }
    }
    if (updates.currentArea !== undefined) {
      patch.currentArea = updates.currentArea;
    }

    try {
      await updateDoc(doc(db, 'operarios', operarioId), patch);
      logAudit({ user, module: 'operarios', action: 'Editó los datos de un operario', details: `${operarioId} → ${JSON.stringify(patch)}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al editar operario:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Elimina un operario de Firestore junto con sus evaluaciones de desempeño
   * ("calificaciones"), para no dejar registros huérfanos apuntando a un operarioId
   * que ya no existe en el padrón (colección "evaluaciones", ligada por operarioId).
   * También desasigna (no borra) sus actividades pendientes/en proceso — pasan a "Sin
   * asignar" en vez de quedar apuntando para siempre a un colaborador que ya no existe.
   */
  const deleteOperario = useCallback(async (operarioId) => {
    if (!db) return;
    try {
      const evalSnapshot = await getDocs(
        query(collection(db, 'evaluaciones'), where('operarioId', '==', operarioId))
      );
      await Promise.all(evalSnapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));

      const actSnapshot = await getDocs(
        query(collection(db, 'actividades'), where('operarioId', '==', operarioId))
      );
      await Promise.all(actSnapshot.docs.map((docSnap) => updateDoc(docSnap.ref, { operarioId: null })));

      await deleteDoc(doc(db, 'operarios', operarioId));
      logAudit({
        user,
        module: 'operarios',
        action: 'Eliminó un operario',
        details: `${operarioId} (+ ${evalSnapshot.size} evaluación(es) y ${actSnapshot.size} actividad(es) desasignada(s))`,
      });
    } catch (error) {
      console.error('Error al eliminar operario de Firestore:', error);
    }
  }, [user]);

  /**
   * Vacía todos los registros de operarios en la base de datos de Firestore, junto con
   * todas las evaluaciones de desempeño (al desaparecer todo el padrón, cada evaluación
   * queda huérfana sin importar a quién pertenecía).
   */
  const clearAllOperarios = useCallback(async () => {
    if (!db) return;
    try {
      const querySnapshot = await getDocs(collection(db, 'operarios'));
      const evalSnapshot = await getDocs(collection(db, 'evaluaciones'));
      const promises = [];
      querySnapshot.forEach((docSnap) => {
        promises.push(deleteDoc(docSnap.ref));
      });
      evalSnapshot.forEach((docSnap) => {
        promises.push(deleteDoc(docSnap.ref));
      });
      await Promise.all(promises);
      logAudit({
        user,
        module: 'operarios',
        action: 'Vació todo el padrón de operarios',
        details: `${querySnapshot.size} operario(s) y ${evalSnapshot.size} evaluación(es) eliminados`,
      });
    } catch (error) {
      console.error('Error al vaciar operarios de Firestore:', error);
    }
  }, [user]);

  // ============================================
  // PRÉSTAMOS Y CAMBIOS DEFINITIVOS DE ÁREA (con autorización)
  // ============================================

  /**
   * Solicita un préstamo temporal o un cambio definitivo de área para un colaborador.
   * Queda pendiente de autorización del área de origen (y, si es cambio definitivo,
   * después también del área destino) antes de aplicarse de verdad.
   */
  const requestMovimiento = useCallback(async ({ operarioId, toAreaId, tipo, fechaFinEstimada, motivo, solicitadoPor }) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const op = operarios.find((o) => o.id === operarioId);
    if (!op) return { ok: false, error: 'Colaborador no encontrado.' };
    if (op.currentArea === toAreaId) return { ok: false, error: 'El colaborador ya está en esa área.' };

    const id = `MOV-${Date.now()}`;
    const created = {
      id,
      operarioId,
      operarioName: op.name,
      // Puesto del colaborador AL MOMENTO del movimiento (piso vs. Diseño) — se guarda
      // aquí y no se recalcula después, para que el historial no cambie si el puesto del
      // colaborador se modifica más adelante.
      operarioPuesto: op.puesto || 'operario',
      fromAreaId: op.currentArea,
      toAreaId,
      tipo,
      fechaFinEstimada: tipo === 'prestamo' ? (fechaFinEstimada || null) : null,
      motivo: motivo || '',
      solicitadoPor,
      // Rol de quien solicita, tomado de la sesión activa (no de un parámetro aparte)
      solicitadoPorRole: user?.roleType || null,
      status: 'pendiente_origen',
      origenAutorizadoPor: null,
      origenAutorizadoAt: null,
      destinoAutorizadoPor: null,
      destinoAutorizadoAt: null,
      rechazadoPor: null,
      notasRechazo: null,
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'movimientos_personal', id), created);
      logAudit({ user, module: 'operarios', action: `Solicitó ${tipo === 'prestamo' ? 'préstamo' : 'cambio definitivo'} de área`, details: `${op.name}: ${created.fromAreaId} -> ${toAreaId}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al solicitar movimiento de personal:', error);
      return { ok: false, error: error.message };
    }
  }, [operarios, user]);

  /**
   * El supervisor/encargado (o admin) del área de ORIGEN autoriza el movimiento con su
   * propia contraseña real. Si es préstamo, el cambio de área se aplica de inmediato
   * (conservando el área de origen como "homeArea"); si es cambio definitivo, pasa a
   * esperar también la autorización del área destino antes de aplicarse.
   */
  const authorizeMovimientoOrigen = useCallback(async (movimientoId, email, password) => {
    if (!db || !verifyAreaAuthorizer) return { ok: false, error: 'No disponible' };
    const mov = movimientos.find((m) => m.id === movimientoId);
    if (!mov) return { ok: false, error: 'Movimiento no encontrado.' };
    if (mov.status !== 'pendiente_origen') {
      return { ok: false, error: 'Este movimiento ya no está pendiente de autorización de origen.' };
    }

    const result = await verifyAreaAuthorizer(email, password, mov.fromAreaId);
    if (!result.ok) return result;

    try {
      const isPrestamo = mov.tipo === 'prestamo';
      await updateDoc(doc(db, 'movimientos_personal', movimientoId), {
        origenAutorizadoPor: result.name,
        origenAutorizadoPorRole: result.roleType,
        origenAutorizadoAt: new Date().toISOString(),
        status: isPrestamo ? 'autorizado' : 'pendiente_destino',
      });

      if (isPrestamo) {
        await updateDoc(doc(db, 'operarios', mov.operarioId), { currentArea: mov.toAreaId });
      }

      logAudit({
        user: { name: result.name, roleType: result.roleType },
        module: 'operarios',
        action: 'Autorizó movimiento de personal (origen)',
        details: `${mov.operarioName}: ${mov.fromAreaId} -> ${mov.toAreaId}`,
      });
      return { ok: true };
    } catch (error) {
      console.error('Error al autorizar movimiento (origen):', error);
      return { ok: false, error: error.message };
    }
  }, [movimientos, verifyAreaAuthorizer]);

  /**
   * El supervisor/encargado (o admin) del área DESTINO autoriza un cambio definitivo con
   * su propia contraseña real. Al aprobar, se actualizan tanto currentArea como
   * homeArea del colaborador (deja de pertenecer al área original).
   */
  const authorizeMovimientoDestino = useCallback(async (movimientoId, email, password) => {
    if (!db || !verifyAreaAuthorizer) return { ok: false, error: 'No disponible' };
    const mov = movimientos.find((m) => m.id === movimientoId);
    if (!mov) return { ok: false, error: 'Movimiento no encontrado.' };
    if (mov.status !== 'pendiente_destino') {
      return { ok: false, error: 'Este movimiento no está pendiente de autorización de destino.' };
    }

    const result = await verifyAreaAuthorizer(email, password, mov.toAreaId);
    if (!result.ok) return result;

    try {
      await updateDoc(doc(db, 'movimientos_personal', movimientoId), {
        destinoAutorizadoPor: result.name,
        destinoAutorizadoPorRole: result.roleType,
        destinoAutorizadoAt: new Date().toISOString(),
        status: 'autorizado',
      });

      await updateDoc(doc(db, 'operarios', mov.operarioId), {
        currentArea: mov.toAreaId,
        homeArea: mov.toAreaId,
      });

      logAudit({
        user: { name: result.name, roleType: result.roleType },
        module: 'operarios',
        action: 'Autorizó movimiento de personal (destino)',
        details: `${mov.operarioName}: ${mov.fromAreaId} -> ${mov.toAreaId}`,
      });
      return { ok: true };
    } catch (error) {
      console.error('Error al autorizar movimiento (destino):', error);
      return { ok: false, error: error.message };
    }
  }, [movimientos, verifyAreaAuthorizer]);

  /**
   * Rechaza una solicitud de movimiento de personal (no requiere contraseña, igual que
   * regresar una requisición de compra: solo queda registrado quién y por qué). Antes no
   * guardaba la fecha/hora del rechazo (a diferencia de crear/autorizar, que sí la tenían)
   * — se agrega aquí para que todo el ciclo de vida del movimiento quede con marca de
   * tiempo, sin excepción.
   */
  const rejectMovimiento = useCallback(async (movimientoId, reviewerName, notes) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    try {
      await updateDoc(doc(db, 'movimientos_personal', movimientoId), {
        status: 'rechazado',
        rechazadoPor: reviewerName,
        rechazadoPorRole: user?.roleType || null,
        rechazadoAt: new Date().toISOString(),
        notasRechazo: notes || '',
      });
      logAudit({ user, module: 'operarios', action: 'Rechazó movimiento de personal', details: `${movimientoId} por ${reviewerName}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al rechazar movimiento de personal:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  // ============================================
  // ESTADO DE DISPONIBILIDAD DEL COLABORADOR
  // ============================================

  /**
   * Marca el estado de disponibilidad de un colaborador (activo, falta, incapacidad,
   * viaje foráneo, actividad externa). No requiere autorización ni contraseña — solo
   * deja registro de quién lo marcó y cuándo, y se acumula en un historial.
   */
  const setOperarioEstado = useCallback(async (operarioId, { tipo, desde, hasta, notas }, registradoPor) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const op = operarios.find((o) => o.id === operarioId);
    if (!op) return { ok: false, error: 'Colaborador no encontrado.' };

    const todayStr = getTodayLocalDateStr();
    const targetDesde = tipo === 'activo' ? todayStr : (desde || todayStr);

    const nuevoEstado = {
      tipo,
      desde: targetDesde,
      hasta: tipo === 'activo' ? null : (hasta || null),
      notas: notas || '',
      registradoPor,
      registradoAt: new Date().toISOString(),
    };

    try {
      const currentHistorial = [...(op.estadoHistorial || [])];

      // Si el estado previo era una falta o ausencia no registrada en el historial, preservarla intacta
      if (op.estado && op.estado.tipo && op.estado.tipo !== 'activo') {
        const yaExiste = currentHistorial.some(
          (h) => h.tipo === op.estado.tipo && (h.desde === op.estado.desde || h.registradoAt === op.estado.registradoAt)
        );
        if (!yaExiste) {
          currentHistorial.push(op.estado);
        }
      }

      const updates = {
        estado: nuevoEstado,
        estadoHistorial: [...currentHistorial, nuevoEstado],
      };

      // Si se marca como ausente (falta, permiso, etc.) para la fecha de hoy, restablecer horario
      if (tipo !== 'activo') {
        const isSaturday = new Date().getDay() === 6;
        if (targetDesde <= todayStr && (!hasta || hasta >= todayStr)) {
          updates.schedule = {
            ...op.schedule,
            startHour: 8,
            endHour: isSaturday ? 13 : 18,
            overtimeHours: 0,
            authorizedBy: '',
            authorizedDate: '',
          };
        }
      }

      await updateDoc(doc(db, 'operarios', operarioId), updates);

      // Si se marcó como ausente, cancelar cualquier registro de horas extra activo para esa fecha
      if (tipo !== 'activo') {
        await cancelPendingHorasExtra(operarioId, targetDesde);
      }

      logAudit({ user, module: 'operarios', action: 'Cambió el estado de disponibilidad de un colaborador', details: `${op.name}: ${tipo}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar estado del colaborador:', error);
      return { ok: false, error: error.message };
    }
  }, [operarios, user, cancelPendingHorasExtra]);

  /**
   * Elimina o anula un registro de falta o ausencia del historial de un colaborador (o el estado actual).
   * Desbloquea de inmediato las horas extras si se trataba de una falta errónea.
   */
  const deleteOperarioAusencia = useCallback(
    async (operarioId, { recordIndex, isCurrent, tipo, desde }) => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };
      const op = operarios.find((o) => o.id === operarioId);
      if (!op) return { ok: false, error: 'Colaborador no encontrado.' };

      try {
        const updates = {};
        const todayStr = getTodayLocalDateStr();

        // 1. Si es el estado actual vigente o coincide con la ausencia a eliminar
        if (isCurrent || (op.estado && (op.estado.desde === desde || op.estado.tipo === tipo))) {
          updates.estado = {
            tipo: 'activo',
            desde: todayStr,
            hasta: null,
            notas: '',
            registradoPor: user?.name || 'Supervisor',
            registradoAt: new Date().toISOString(),
          };
        }

        // 2. Modificar o limpiar el historial
        const currentHist = [...(op.estadoHistorial || [])];
        if (typeof recordIndex === 'number' && recordIndex >= 0 && recordIndex < currentHist.length) {
          currentHist.splice(recordIndex, 1);
        } else if (desde) {
          const matchIdx = currentHist.findIndex((h) => (h.desde === desde || h.registradoAt?.startsWith(desde)) && (!tipo || h.tipo === tipo));
          if (matchIdx !== -1) {
            currentHist.splice(matchIdx, 1);
          }
        }
        updates.estadoHistorial = currentHist;

        await updateDoc(doc(db, 'operarios', operarioId), updates);
        logAudit({
          user,
          module: 'operarios',
          action: 'Eliminó / Anuló registro de ausencia o falta',
          details: `${op.name}: ${tipo || 'ausencia'} (${desde || 'N/A'})`,
        });
        return { ok: true };
      } catch (error) {
        console.error('Error al eliminar registro de ausencia:', error);
        return { ok: false, error: error.message };
      }
    },
    [operarios, user]
  );

  /**
   * Modifica un registro de falta o ausencia (cambio de tipo ej. falta -> permiso/incapacidad, fecha o notas).
   */
  const editOperarioAusencia = useCallback(
    async (operarioId, { recordIndex, isCurrent, tipo, desde, hasta, notas }) => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };
      const op = operarios.find((o) => o.id === operarioId);
      if (!op) return { ok: false, error: 'Colaborador no encontrado.' };

      try {
        const updates = {};
        const todayStr = getTodayLocalDateStr();
        const updatedRecord = {
          tipo,
          desde: desde || todayStr,
          hasta: hasta || null,
          notas: notas || '',
          actualizadoPor: user?.name || 'Supervisor',
          actualizadoAt: new Date().toISOString(),
        };

        if (isCurrent || (op.estado && op.estado.desde === desde)) {
          updates.estado = {
            ...op.estado,
            ...updatedRecord,
          };
        }

        const currentHist = [...(op.estadoHistorial || [])];
        if (typeof recordIndex === 'number' && recordIndex >= 0 && recordIndex < currentHist.length) {
          currentHist[recordIndex] = {
            ...currentHist[recordIndex],
            ...updatedRecord,
          };
          updates.estadoHistorial = currentHist;
        }

        await updateDoc(doc(db, 'operarios', operarioId), updates);
        logAudit({
          user,
          module: 'operarios',
          action: 'Modificó registro de ausencia o falta',
          details: `${op.name}: ahora ${tipo} (${desde || 'N/A'})`,
        });
        return { ok: true };
      } catch (error) {
        console.error('Error al editar registro de ausencia:', error);
        return { ok: false, error: error.message };
      }
    },
    [operarios, user]
  );

  // ============================================
  // SOLICITUDES Y AUTORIZACIÓN DE HORAS EXTRAS (ENCARGADOS & SUPERVISORES)
  // ============================================

  /**
   * Encargado de área solicita horas extras para un colaborador.
   * Ejecuta la validación de elegibilidad (bloqueo por falta en los últimos 7 días).
   */
  const solicitarHorasExtra = useCallback(
    async ({ operarioId, fecha, horas, bloque, motivo, startHour, endHour }) => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };
      const op = operarios.find((o) => o.id === operarioId);
      if (!op) return { ok: false, error: 'Colaborador no encontrado.' };

      const targetFecha = fecha || getTodayLocalDateStr();

      // Evaluar elegibilidad por faltas o ausencias
      const eligibility = checkOvertimeEligibility(op, targetFecha);
      if (!eligibility.isEligible) {
        return { ok: false, error: eligibility.reason };
      }

      const id = `SOL-HE-${Date.now()}`;
      const nuevaSolicitud = {
        id,
        operarioId: op.id,
        operarioName: op.name,
        operarioPuesto: op.puesto || 'operario',
        areaId: op.currentArea,
        fecha: targetFecha,
        horas: Number(horas) || 1,
        bloque: bloque || 'vespertino',
        // Solo se usan cuando bloque === 'domingo': un domingo es un turno completo desde
        // cero (no una extensión de jornada base), así que se necesita la hora de entrada
        // y salida REAL en vez de solo la cantidad de horas.
        startHour: bloque === 'domingo' ? Number(startHour) : null,
        endHour: bloque === 'domingo' ? Number(endHour) : null,
        motivo: motivo || '',
        solicitadoPor: user?.name || 'Encargado de Área',
        solicitadoPorUid: user?.id || null,
        solicitadoPorRole: user?.roleType || 'encargado-area',
        status: 'pendiente',
        revisadoPor: null,
        revisadoAt: null,
        notasRevision: '',
        createdAt: new Date().toISOString(),
      };

      try {
        await setDoc(doc(db, 'solicitudes_horas_extra', id), nuevaSolicitud);
        logAudit({
          user,
          module: 'operarios',
          action: 'Solicitó horas extras para colaborador',
          details: `${op.name}: ${horas}h (${bloque}) el ${targetFecha}`,
        });
        return { ok: true, id };
      } catch (error) {
        console.error('Error al solicitar horas extras:', error);
        return { ok: false, error: error.message };
      }
    },
    [operarios, user]
  );

  /**
   * Supervisor o Admin autoriza una solicitud de horas extras.
   * Sincroniza automáticamente:
   * 1. Actualiza la solicitud a 'autorizada'.
   * 2. Registra en 'horas_extra'.
   * 3. Si es HOY, actualiza en vivo el horario del operario.
   */
  const autorizarSolicitudHoraExtra = useCallback(
    async (solicitudId, notes = '') => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };
      const sol = solicitudesHorasExtra.find((s) => s.id === solicitudId);
      if (!sol) return { ok: false, error: 'Solicitud no encontrada.' };
      const op = operarios.find((o) => o.id === sol.operarioId);
      if (!op) return { ok: false, error: 'Colaborador asociado no encontrado.' };

      // Revalidar que el colaborador no haya incurrido en falta (penalización de 7 días),
      // ausencia, o ya haya llegado al tope semanal de horas extra — misma consulta directa
      // a Firestore (no el arreglo local `horasExtra`, limitado a las últimas
      // `horasExtraLimit`) que usa authorizeOvertimeTasks, para que el candado semanal
      // aplique igual sin importar si la autorización se aprobó directa o vino de una
      // solicitud.
      const { start: weekStart, end: weekEnd } = getOvertimeWeekRange(sol.fecha);
      let weeklyAccumulatedHours = 0;
      try {
        const weekSnap = await getDocs(query(
          collection(db, 'horas_extra'),
          where('operarioId', '==', op.id),
          where('authorizedDate', '>=', weekStart),
          where('authorizedDate', '<=', weekEnd)
        ));
        weeklyAccumulatedHours = weekSnap.docs
          .map((d) => d.data())
          .filter((h) => h.verificationStatus !== 'cancelado')
          .reduce((sum, h) => sum + Number(h.overtimeHours || 0), 0);
      } catch (error) {
        console.error('Error al calcular horas extra acumuladas de la semana:', error);
      }

      const eligibility = checkOvertimeEligibility(op, sol.fecha, weeklyAccumulatedHours);
      if (!eligibility.isEligible) {
        return { ok: false, error: eligibility.reason };
      }

      const reviewerName = user?.name || 'Supervisor';
      const todayStr = getTodayLocalDateStr();
      const isSaturday = new Date(`${sol.fecha}T00:00:00`).getDay() === 6;
      const baseEnd = isSaturday ? 13 : 18;

      // Domingo es un turno completo desde cero: se usa la hora de entrada/salida REAL
      // que ya viene en la solicitud, no la jornada base 8-18/8-13 de los demás días.
      const scheduleCalc = sol.bloque === 'domingo'
        ? calculateScheduleFromOvertime(sol.startHour, sol.endHour, sol.horas, 'domingo')
        : calculateScheduleFromOvertime(8, baseEnd, sol.horas, sol.bloque);

      try {
        await updateDoc(doc(db, 'solicitudes_horas_extra', solicitudId), {
          status: 'autorizada',
          revisadoPor: reviewerName,
          revisadoPorRole: user?.roleType || 'supervisor-area',
          revisadoAt: new Date().toISOString(),
          notasRevision: notes || '',
        });

        // Cancela cualquier autorización previa vigente de ese colaborador para esa misma
        // fecha antes de crear la nueva — sin esto, si ya existía una autorización directa
        // (o de otra solicitud) para el mismo día, quedaban DOS registros activos
        // simultáneos (duplicados) para la misma persona y fecha: se contaban doble en el
        // reporte a RH, en el resumen semanal y en el PDF por área. Mismo candado que ya
        // usa handleSaveSchedule en ProduccionPage.jsx para la autorización directa.
        await cancelPendingHorasExtra(op.id, sol.fecha);

        const heId = `HE-${Date.now()}`;
        await setDoc(doc(db, 'horas_extra', heId), {
          id: heId,
          solicitudId: sol.id,
          operarioId: op.id,
          operarioName: op.name,
          operarioPuesto: op.puesto || 'operario',
          areaId: op.currentArea,
          authorizedDate: sol.fecha,
          startHour: scheduleCalc.startHour,
          endHour: scheduleCalc.endHour,
          overtimeHours: scheduleCalc.overtimeHours,
          overtimeTasks: sol.motivo || 'Horas extras autorizadas',
          authorizedBy: reviewerName,
          authorizedByRole: user?.roleType || 'supervisor-area',
          createdAt: new Date().toISOString(),
          verificationStatus: 'pendiente',
          verificationNotes: '',
        });

        if (sol.fecha === todayStr) {
          await updateDoc(doc(db, 'operarios', op.id), {
            schedule: {
              ...op.schedule,
              startHour: scheduleCalc.startHour,
              endHour: scheduleCalc.endHour,
              overtimeHours: scheduleCalc.overtimeHours,
              authorizedBy: reviewerName,
              authorizedDate: sol.fecha,
            },
          });
        }

        logAudit({
          user,
          module: 'operarios',
          action: 'Autorizó solicitud de horas extras',
          details: `${op.name}: ${sol.horas}h el ${sol.fecha}`,
        });
        return { ok: true };
      } catch (error) {
        console.error('Error al autorizar solicitud de horas extras:', error);
        return { ok: false, error: error.message };
      }
    },
    [solicitudesHorasExtra, operarios, user, cancelPendingHorasExtra]
  );

  /**
   * Rechaza una solicitud de horas extras.
   */
  const rechazarSolicitudHoraExtra = useCallback(
    async (solicitudId, notes = '') => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };
      try {
        await updateDoc(doc(db, 'solicitudes_horas_extra', solicitudId), {
          status: 'rechazada',
          revisadoPor: user?.name || 'Supervisor',
          revisadoPorRole: user?.roleType || null,
          revisadoAt: new Date().toISOString(),
          notasRevision: notes || '',
        });
        logAudit({
          user,
          module: 'operarios',
          action: 'Rechazó solicitud de horas extras',
          details: solicitudId,
        });
        return { ok: true };
      } catch (error) {
        console.error('Error al rechazar solicitud de horas extras:', error);
        return { ok: false, error: error.message };
      }
    },
    [user]
  );

  /**
   * Cancela una solicitud de horas extras.
   */
  const cancelarSolicitudHoraExtra = useCallback(
    async (solicitudId, reason = '') => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };
      const sol = solicitudesHorasExtra.find((s) => s.id === solicitudId);
      if (!sol) return { ok: false, error: 'Solicitud no encontrada.' };
      const op = operarios.find((o) => o.id === sol.operarioId);

      const todayStr = getTodayLocalDateStr();

      try {
        await updateDoc(doc(db, 'solicitudes_horas_extra', solicitudId), {
          status: 'cancelada',
          canceladaPor: user?.name || 'Usuario',
          canceladaAt: new Date().toISOString(),
          motivoCancelacion: reason || '',
        });

        if (sol.status === 'autorizada') {
          // Cancelar también el registro correspondiente en la colección horas_extra
          await cancelPendingHorasExtra(sol.operarioId, sol.fecha);

          if (sol.fecha === todayStr && op) {
            const isSaturday = new Date().getDay() === 6;
            await updateDoc(doc(db, 'operarios', op.id), {
              schedule: {
                ...op.schedule,
                startHour: 8,
                endHour: isSaturday ? 13 : 18,
                overtimeHours: 0,
                authorizedBy: '',
                authorizedDate: '',
              },
            });
          }
        }

        logAudit({
          user,
          module: 'operarios',
          action: 'Canceló solicitud de horas extras',
          details: `${solicitudId} - ${reason || 'Sin motivo'}`,
        });
        return { ok: true };
      } catch (error) {
        console.error('Error al cancelar solicitud de horas extras:', error);
        return { ok: false, error: error.message };
      }
    },
    [solicitudesHorasExtra, operarios, user, cancelPendingHorasExtra]
  );

  /**
   * Modifica una solicitud de horas extras.
   */
  const modificarSolicitudHoraExtra = useCallback(
    async (solicitudId, { horas, bloque, motivo, fecha, startHour, endHour }) => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };
      const sol = solicitudesHorasExtra.find((s) => s.id === solicitudId);
      if (!sol) return { ok: false, error: 'Solicitud no encontrada.' };
      const op = operarios.find((o) => o.id === sol.operarioId);

      const newFecha = fecha || sol.fecha;
      const newHoras = Number(horas) || sol.horas;
      const newBloque = bloque || sol.bloque;
      const newStartHour = newBloque === 'domingo' ? Number(startHour) : null;
      const newEndHour = newBloque === 'domingo' ? Number(endHour) : null;
      const newMotivo = motivo || sol.motivo;

      if (op && newFecha !== sol.fecha) {
        const { start: weekStart, end: weekEnd } = getOvertimeWeekRange(newFecha);
        let weeklyAccumulatedHours = 0;
        try {
          const weekSnap = await getDocs(query(
            collection(db, 'horas_extra'),
            where('operarioId', '==', op.id),
            where('authorizedDate', '>=', weekStart),
            where('authorizedDate', '<=', weekEnd)
          ));
          weeklyAccumulatedHours = weekSnap.docs
            .map((d) => d.data())
            .filter((h) => h.verificationStatus !== 'cancelado' && h.solicitudId !== sol.id)
            .reduce((sum, h) => sum + Number(h.overtimeHours || 0), 0);
        } catch (error) {
          console.error('Error al calcular horas extra acumuladas de la semana:', error);
        }
        const eligibility = checkOvertimeEligibility(op, newFecha, weeklyAccumulatedHours);
        if (!eligibility.isEligible) {
          return { ok: false, error: eligibility.reason };
        }
      }

      try {
        await updateDoc(doc(db, 'solicitudes_horas_extra', solicitudId), {
          fecha: newFecha,
          horas: newHoras,
          bloque: newBloque,
          startHour: newStartHour,
          endHour: newEndHour,
          motivo: newMotivo,
          modificadoPor: user?.name || 'Usuario',
          modificadoAt: new Date().toISOString(),
        });

        const todayStr = getTodayLocalDateStr();
        if (sol.status === 'autorizada' && op) {
          // Ojo: isSaturday se calcula sobre newFecha (la fecha que en verdad se está
          // autorizando), no sobre "hoy" — antes esto solo corría cuando newFecha era
          // exactamente hoy, así que usar new Date().getDay() coincidía por casualidad;
          // al extender esta sincronización a cualquier fecha (ver abajo), había que
          // corregirlo para no calcular mal la jornada base (8-13 sábado vs 8-18) de una
          // fecha distinta a la actual.
          const isSaturday = new Date(`${newFecha}T00:00:00`).getDay() === 6;
          const baseEnd = isSaturday ? 13 : 18;
          const scheduleCalc = newBloque === 'domingo'
            ? calculateScheduleFromOvertime(newStartHour, newEndHour, newHoras, 'domingo')
            : calculateScheduleFromOvertime(8, baseEnd, newHoras, newBloque);

          // Sincroniza el registro real en `horas_extra` (fuente de verdad para el
          // reporte a RH, el resumen semanal, el PDF por área y la verificación de
          // Calidad) — antes esta función solo actualizaba la solicitud y, si la fecha
          // era hoy, el horario "vigente" del operario, pero NUNCA el registro de
          // horas_extra ya creado al autorizar, así que se quedaba con los datos viejos
          // (fecha/horas/horario) sin importar cuánto se editara la solicitud después.
          // Se busca con una consulta directa a Firestore por solicitudId, no en el
          // arreglo local `horasExtra` (limitado a las últimas `horasExtraLimit` de TODA
          // la empresa) — si el registro vinculado ya había quedado fuera de ese recorte,
          // este bloque se saltaba en silencio y la desincronización pasaba inadvertida.
          const linkedHESnap = await getDocs(query(
            collection(db, 'horas_extra'),
            where('solicitudId', '==', sol.id)
          ));
          const linkedHE = linkedHESnap.docs
            .map((d) => ({ ...d.data(), _ref: d.ref }))
            .find((h) => h.verificationStatus !== 'cancelado');
          if (linkedHE) {
            await updateDoc(linkedHE._ref, {
              authorizedDate: newFecha,
              startHour: scheduleCalc.startHour,
              endHour: scheduleCalc.endHour,
              overtimeHours: scheduleCalc.overtimeHours,
              overtimeTasks: newMotivo || 'Horas extras autorizadas',
              // Los términos autorizados cambiaron — cualquier verificación de
              // cumplimiento previa describiría un horario que ya no es el vigente, así
              // que se reinicia para que Calidad la revise de nuevo con los datos
              // correctos, en vez de dejar una verificación "cumplido"/"no cumplido"
              // que ya no corresponde a lo realmente autorizado.
              verificationStatus: 'pendiente',
              verificationNotes: '',
              verifiedBy: null,
              verifiedByRole: null,
              verifiedAt: null,
            });
          }

          if (newFecha === todayStr) {
            await updateDoc(doc(db, 'operarios', op.id), {
              schedule: {
                ...op.schedule,
                startHour: scheduleCalc.startHour,
                endHour: scheduleCalc.endHour,
                overtimeHours: scheduleCalc.overtimeHours,
                authorizedDate: newFecha,
              },
            });
          }
        }

        logAudit({
          user,
          module: 'operarios',
          action: 'Modificó solicitud de horas extras',
          details: `${solicitudId}: ${newHoras}h (${newBloque})`,
        });
        return { ok: true };
      } catch (error) {
        console.error('Error al modificar solicitud de horas extras:', error);
        return { ok: false, error: error.message };
      }
    },
    [solicitudesHorasExtra, operarios, user]
  );

  // ============================================
  // VALOR DEL CONTEXTO
  // ============================================
  const value = useMemo(
    () => ({
      operarios,
      blockDuration,
      assignToArea,
      returnToHomeArea,
      updateOperarioSchedule,
      updateBlockDuration,
      importFromExcel,
      addOperario,
      updateOperario,
      deleteOperario,
      clearAllOperarios,
      movimientos,
      requestMovimiento,
      authorizeMovimientoOrigen,
      authorizeMovimientoDestino,
      rejectMovimiento,
      setOperarioEstado,
      deleteOperarioAusencia,
      editOperarioAusencia,
      horasExtra,
      authorizeOvertimeTasks,
      verifyHorasExtra,
      correctHorasExtraSchedule,
      cancelPendingHorasExtra,
      findHorasExtraForDate,
      solicitudesHorasExtra,
      solicitarHorasExtra,
      autorizarSolicitudHoraExtra,
      rechazarSolicitudHoraExtra,
      cancelarSolicitudHoraExtra,
      modificarSolicitudHoraExtra,
    }),
    [
      operarios,
      blockDuration,
      assignToArea,
      returnToHomeArea,
      updateOperarioSchedule,
      updateBlockDuration,
      importFromExcel,
      addOperario,
      updateOperario,
      deleteOperario,
      clearAllOperarios,
      movimientos,
      requestMovimiento,
      authorizeMovimientoOrigen,
      authorizeMovimientoDestino,
      rejectMovimiento,
      setOperarioEstado,
      deleteOperarioAusencia,
      editOperarioAusencia,
      horasExtra,
      authorizeOvertimeTasks,
      verifyHorasExtra,
      correctHorasExtraSchedule,
      cancelPendingHorasExtra,
      findHorasExtraForDate,
      solicitudesHorasExtra,
      solicitarHorasExtra,
      autorizarSolicitudHoraExtra,
      rechazarSolicitudHoraExtra,
      cancelarSolicitudHoraExtra,
      modificarSolicitudHoraExtra,
    ]
  );

  return <OperariosContext.Provider value={value}>{children}</OperariosContext.Provider>;
};

OperariosProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
