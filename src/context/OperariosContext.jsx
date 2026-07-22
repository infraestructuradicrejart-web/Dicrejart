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
  orderBy,
  limit
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { resolveAreaId } from '../data/operariosData';
import { AuthContext } from './AuthContext';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { logAudit } from '../utils/auditLog';

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

export const OperariosProvider = ({ children }) => {
  const [blockDuration, setBlockDuration] = useState(() => {
    const saved = localStorage.getItem('dicrejart_block_duration');
    return saved ? Number(saved) : 2;
  });

  const [operarios, setOperarios] = useState([]);
  const [movimientos, setMovimientos] = useState([]);

  // verifyAreaAuthorizer valida, con la contraseña real de un tercero, que tenga
  // autoridad (Admin, Encargado o Supervisor) sobre un área específica
  const { verifyAreaAuthorizer, user } = useContext(AuthContext) || {};
  const { limits } = useContext(ConfigContext) || {};
  const movimientosPersonalLimit = limits?.movimientosPersonalLimit || DEFAULT_LIMITS.movimientosPersonalLimit;

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  // Se espera a onAuthStateChanged y se resuscribe con cada cambio de sesión: este
  // Provider envuelve toda la app (incluida /login), así que suscribirse de inmediato
  // fallaría por falta de permisos antes del login, sin volver a intentarlo después.
  // También se vuelve a suscribir si cambia el límite dinámico configurado por el Admin.
  // Nota: "operarios" (el padrón de personal) NO se limita — no es una bitácora que
  // crece indefinidamente, es un registro acotado por la cantidad real de colaboradores.
  useEffect(() => {
    if (!db || !auth) return;

    let unsubOperarios = null;
    let unsubMovimientos = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubOperarios) unsubOperarios();
      if (unsubMovimientos) unsubMovimientos();

      if (!user) {
        setOperarios([]);
        setMovimientos([]);
        return;
      }

      unsubOperarios = onSnapshot(collection(db, 'operarios'), (snapshot) => {
        const list = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          list.push({
            ...data,
            schedule: data.schedule || getDefaultSchedule(),
            estado: data.estado || getDefaultEstado(),
          });
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
    });

    return () => {
      unsubAuth();
      if (unsubOperarios) unsubOperarios();
      if (unsubMovimientos) unsubMovimientos();
    };
  }, [movimientosPersonalLimit]);

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
  }, [operarios, user]);

  /**
   * Elimina un operario de Firestore
   */
  const deleteOperario = useCallback(async (operarioId) => {
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'operarios', operarioId));
      logAudit({ user, module: 'operarios', action: 'Eliminó un operario', details: operarioId });
    } catch (error) {
      console.error('Error al eliminar operario de Firestore:', error);
    }
  }, [user]);

  /**
   * Vacía todos los registros de operarios en la base de datos de Firestore
   */
  const clearAllOperarios = useCallback(async () => {
    if (!db) return;
    try {
      const querySnapshot = await getDocs(collection(db, 'operarios'));
      const promises = [];
      querySnapshot.forEach((docSnap) => {
        promises.push(deleteDoc(docSnap.ref));
      });
      await Promise.all(promises);
      logAudit({ user, module: 'operarios', action: 'Vació todo el padrón de operarios', details: `${querySnapshot.size} registros eliminados` });
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
      fromAreaId: op.currentArea,
      toAreaId,
      tipo,
      fechaFinEstimada: tipo === 'prestamo' ? (fechaFinEstimada || null) : null,
      motivo: motivo || '',
      solicitadoPor,
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
   * regresar una requisición de compra: solo queda registrado quién y por qué).
   */
  const rejectMovimiento = useCallback(async (movimientoId, reviewerName, notes) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    try {
      await updateDoc(doc(db, 'movimientos_personal', movimientoId), {
        status: 'rechazado',
        rechazadoPor: reviewerName,
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
      desde: desde || new Date().toISOString().split('T')[0],
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
      deleteOperario,
      clearAllOperarios,
      movimientos,
      requestMovimiento,
      authorizeMovimientoOrigen,
      authorizeMovimientoDestino,
      rejectMovimiento,
      setOperarioEstado,
    }),
    [
      operarios,
      blockDuration,
      assignToArea,
      returnToHomeArea,
      updateOperarioSchedule,
      updateBlockDuration,
      importFromExcel,
      deleteOperario,
      clearAllOperarios,
      movimientos,
      requestMovimiento,
      authorizeMovimientoOrigen,
      authorizeMovimientoDestino,
      rejectMovimiento,
      setOperarioEstado,
    ]
  );

  return <OperariosContext.Provider value={value}>{children}</OperariosContext.Provider>;
};

OperariosProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
