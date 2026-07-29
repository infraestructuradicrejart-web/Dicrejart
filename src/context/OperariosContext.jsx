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
  limit
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import useAreas from '../hooks/useAreas';
import { AuthContext } from './AuthContext';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { logAudit } from '../utils/auditLog';
import { getTodayLocalDateStr } from '../utils/dateUtils';
import { triggerDailyRHNotification } from '../services/rhNotificationService';

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
 * Revisa si el estado de disponibilidad de un colaborador ha expirado y debe restablecerse a 'activo' (En Planta).
 * - Faltas (falta): Se restablecen automáticamente al día siguiente (cuando fechaFalta < fechaHoy).
 * - Ausencias por tiempo definido (con campo `hasta`): Se restablecen cuando la fecha actual supera el `hasta` (hasta < fechaHoy).
 */
const evaluateAndResetExpiredEstado = async (op) => {
  if (!db || !op || !op.estado || op.estado.tipo === 'activo') return;

  const todayStr = getTodayLocalDateStr();
  const { tipo, desde, hasta, registradoAt } = op.estado;

  let shouldReset = false;
  let resetNotes = '';

  if (tipo === 'falta') {
    const fechaFalta = desde || (registradoAt ? registradoAt.split('T')[0] : null);
    if (fechaFalta && fechaFalta < todayStr) {
      shouldReset = true;
      resetNotes = 'Restablecido automáticamente a En Planta (Falta diaria concluyó)';
    }
  } else if (hasta) {
    if (hasta < todayStr) {
      shouldReset = true;
      resetNotes = `Restablecido automáticamente a En Planta (Venció periodo de ausencia el ${hasta})`;
    }
  }

  if (shouldReset) {
    const defaultEstado = {
      tipo: 'activo',
      desde: null,
      hasta: null,
      notas: resetNotes,
      registradoPor: 'Sistema (Restablecimiento Automático)',
      registradoAt: new Date().toISOString(),
    };
    try {
      await updateDoc(doc(db, 'operarios', op.id), {
        estado: defaultEstado,
        estadoHistorial: [...(op.estadoHistorial || []), defaultEstado],
      });
    } catch (err) {
      console.error(`Error al restablecer automáticamente el estado de ${op.id}:`, err);
    }
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

  // verifyAreaAuthorizer valida, con la contraseña real de un tercero, que tenga
  // autoridad (Admin, Encargado o Supervisor) sobre un área específica
  const { verifyAreaAuthorizer, user } = useContext(AuthContext) || {};
  const { limits, generalConfig, updateGeneralConfig } = useContext(ConfigContext) || {};
  const movimientosPersonalLimit = limits?.movimientosPersonalLimit || DEFAULT_LIMITS.movimientosPersonalLimit;
  const horasExtraLimit = limits?.horasExtraLimit || DEFAULT_LIMITS.horasExtraLimit;
  
  const { resolveAreaId } = useAreas();

  // ============================================
  // PROGRAMACIÓN AUTOMÁTICA DE NOTIFICACIÓN A RH (10:00 AM)
  // ============================================
  useEffect(() => {
    if (!db || !operarios.length || !generalConfig) return;

    const checkAndTriggerRHNotification = async () => {
      const todayStr = getTodayLocalDateStr();
      if (generalConfig.notificarFaltasRH === false) return;
      if (generalConfig.lastRHNotificationDate === todayStr) return;

      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();

      const [targetHours, targetMinutes] = (generalConfig.horaNotificacionRH || '10:00').split(':').map(Number);
      const isPastTargetTime = currentHours > targetHours || (currentHours === targetHours && currentMinutes >= targetMinutes);

      if (isPastTargetTime) {
        const result = await triggerDailyRHNotification({
          operarios,
          generalConfig,
          updateGeneralConfig,
          force: false,
        });

        if (result && result.ok) {
          console.log(`📧 [Dicrejart RH Notification System] Reporte de faltas generado a las 10:00 AM para ${result.emailTarget} (${result.absentCount} ausencias).`);
        }
      }
    };

    checkAndTriggerRHNotification();
    const intervalId = setInterval(checkAndTriggerRHNotification, 60000);

    return () => clearInterval(intervalId);
  }, [operarios, generalConfig, updateGeneralConfig]);

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  useEffect(() => {
    if (!db || !auth) return;

    let unsubOperarios = null;
    let unsubMovimientos = null;
    let unsubHorasExtra = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubOperarios) unsubOperarios();
      if (unsubMovimientos) unsubMovimientos();
      if (unsubHorasExtra) unsubHorasExtra();

      if (!user) {
        setOperarios([]);
        setMovimientos([]);
        setHorasExtra([]);
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

      unsubMovimientos = onSnapshot(
        query(collection(db, 'movimientos_personal'), orderBy('createdAt', 'desc'), limit(movimientosPersonalLimit)),
        (snapshot) => {
          const list = [];
          snapshot.forEach((doc) => list.push(doc.data()));
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          setMovimientos(list);
        }
      );

      unsubHorasExtra = onSnapshot(
        query(collection(db, 'horas_extra'), orderBy('createdAt', 'desc'), limit(horasExtraLimit)),
        (snapshot) => {
          const list = [];
          snapshot.forEach((doc) => list.push(doc.data()));
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          setHorasExtra(list);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubOperarios) unsubOperarios();
      if (unsubMovimientos) unsubMovimientos();
      if (unsubHorasExtra) unsubHorasExtra();
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
   * Actualiza el horario de trabajo y horas extras de un colaborador en Firestore
   */
  const updateOperarioSchedule = useCallback(async (operarioId, scheduleData) => {
    if (!db) return;
    const op = operarios.find((o) => o.id === operarioId);
    if (!op) return;
    try {
      await updateDoc(doc(db, 'operarios', operarioId), {
        schedule: {
          ...op.schedule,
          ...scheduleData,
        },
      });
      logAudit({ user, module: 'operarios', action: 'Actualizó horario/horas extra de un operario', details: op.name });
    } catch (error) {
      console.error('Error al actualizar horario del operario:', error);
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
   * Calidad (o Admin) marca si las tareas asignadas durante el tiempo extra realmente se
   * cumplieron. Exige notas cuando NO se cumplieron, para dejar constancia del motivo.
   */
  const verifyHorasExtra = useCallback(async (horasExtraId, { verificationStatus, verificationNotes }) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    if (verificationStatus === 'no_cumplido' && !verificationNotes?.trim()) {
      return { ok: false, error: 'Indica qué tareas no se cumplieron.' };
    }
    try {
      await updateDoc(doc(db, 'horas_extra', horasExtraId), {
        verificationStatus,
        verificationNotes: verificationNotes?.trim() || '',
        verifiedBy: user?.name || null,
        verifiedByRole: user?.roleType || null,
        verifiedAt: new Date().toISOString(),
      });
      logAudit({ user, module: 'operarios', action: 'Verificó cumplimiento de horas extra', details: `${horasExtraId}: ${verificationStatus}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al verificar horas extra:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Cancela cualquier autorización de horas extra AÚN PENDIENTE de verificar para este
   * colaborador en esta fecha — se llama justo antes de guardar una nueva autorización
   * (o de quitar las horas por completo) para esa misma fecha, así Calidad nunca ve un
   * registro "fantasma" pidiendo verificar tareas de un turno que ya se canceló o
   * cambió. Los registros YA verificados (cumplido/no_cumplido) no se tocan — son
   * historial cerrado, no se reescriben.
   */
  const cancelPendingHorasExtra = useCallback(async (operarioId, authorizedDate) => {
    if (!db) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'horas_extra'),
        where('operarioId', '==', operarioId),
        where('authorizedDate', '==', authorizedDate),
        where('verificationStatus', '==', 'pendiente')
      ));
      if (snap.empty) return;
      await Promise.all(snap.docs.map((docSnap) => updateDoc(docSnap.ref, {
        verificationStatus: 'cancelado',
        canceledBy: user?.name || null,
        canceledByRole: user?.roleType || null,
        canceledAt: new Date().toISOString(),
      })));
      logAudit({ user, module: 'operarios', action: 'Canceló autorización(es) de horas extra previas', details: `${operarioId} (${authorizedDate}): ${snap.size} registro(s)` });
    } catch (error) {
      console.error('Error al cancelar autorizaciones de horas extra previas:', error);
    }
  }, [user]);

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

  /**
   * Edita el nombre de un colaborador ya existente (corregir un error de captura, por
   * ejemplo). El área de origen/actual, horario y estado tienen sus propios flujos
   * dedicados (préstamo/cambio de área, jornada, disponibilidad) — esto solo toca el
   * nombre, para no saltarse esas validaciones/autorizaciones desde una edición directa.
   */
  const updateOperario = useCallback(async (operarioId, { name }) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const trimmedName = (name || '').trim();
    if (!trimmedName) return { ok: false, error: 'El nombre es obligatorio.' };

    try {
      await updateDoc(doc(db, 'operarios', operarioId), { name: trimmedName });
      logAudit({ user, module: 'operarios', action: 'Editó los datos de un operario', details: `${operarioId} → ${trimmedName}` });
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
   */
  const deleteOperario = useCallback(async (operarioId) => {
    if (!db) return;
    try {
      const evalSnapshot = await getDocs(
        query(collection(db, 'evaluaciones'), where('operarioId', '==', operarioId))
      );
      await Promise.all(evalSnapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));

      await deleteDoc(doc(db, 'operarios', operarioId));
      logAudit({
        user,
        module: 'operarios',
        action: 'Eliminó un operario',
        details: `${operarioId} (+ ${evalSnapshot.size} evaluación(es) asociada(s))`,
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

    const nuevoEstado = {
      tipo,
      desde: desde || getTodayLocalDateStr(),
      hasta: hasta || null,
      notas: notas || '',
      registradoPor,
      registradoAt: new Date().toISOString(),
    };

    try {
      await updateDoc(doc(db, 'operarios', operarioId), {
        estado: nuevoEstado,
        estadoHistorial: [...(op.estadoHistorial || []), nuevoEstado],
      });
      logAudit({ user, module: 'operarios', action: 'Cambió el estado de disponibilidad de un colaborador', details: `${op.name}: ${tipo}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar estado del colaborador:', error);
      return { ok: false, error: error.message };
    }
  }, [operarios, user]);

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
      horasExtra,
      authorizeOvertimeTasks,
      verifyHorasExtra,
      cancelPendingHorasExtra,
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
      horasExtra,
      authorizeOvertimeTasks,
      verifyHorasExtra,
      cancelPendingHorasExtra,
    ]
  );

  return <OperariosContext.Provider value={value}>{children}</OperariosContext.Provider>;
};

OperariosProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
