/**
 * @file ActividadesContext.jsx
 * @description Contexto global de actividades operativas no ligadas a un juego.
 * Conectado en tiempo real con Cloud Firestore.
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
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { AuthContext } from './AuthContext';
import { logAudit } from '../utils/auditLog';

export const ActividadesContext = createContext(null);

export const ActividadesProvider = ({ children }) => {
  const [actividades, setActividades] = useState([]);

  const { limits } = useContext(ConfigContext) || {};
  const actividadesLimit = limits?.actividadesLimit || DEFAULT_LIMITS.actividadesLimit;
  const { user } = useContext(AuthContext) || {};

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  // Se espera a onAuthStateChanged y se resuscribe con cada cambio de sesión: este
  // Provider envuelve toda la app (incluida /login), así que suscribirse de inmediato
  // fallaría por falta de permisos antes del login, sin volver a intentarlo después.
  // También se vuelve a suscribir si cambia el límite dinámico configurado por el Admin.
  useEffect(() => {
    if (!db || !auth) return;

    let unsubSnapshot = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubSnapshot) unsubSnapshot();

      if (!user) {
        setActividades([]);
        return;
      }

      // Se ordena por "id" (formato ACT-<timestamp>, presente desde siempre en cada
      // documento) en vez de agregar un campo de fecha nuevo, para no dejar invisibles
      // las actividades ya guardadas antes de este cambio.
      unsubSnapshot = onSnapshot(
        query(collection(db, 'actividades'), orderBy('id', 'desc'), limit(actividadesLimit)),
        (snap) => {
          const list = [];
          snap.forEach((doc) => list.push(doc.data()));
          setActividades(list);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubSnapshot) unsubSnapshot();
    };
  }, [actividadesLimit]);

  /**
   * Registra una nueva actividad operativa en Firestore
   */
  const addActividad = useCallback(async (data) => {
    if (!db) return;
    const id = `ACT-${Date.now()}`;
    const created = {
      id,
      status: 'pendiente',
      ...data,
    };
    try {
      await setDoc(doc(db, 'actividades', id), created);
      logAudit({ user, module: 'actividades', action: 'Registró una actividad', details: `${data.title} (${data.areaId})` });
      return id;
    } catch (error) {
      console.error('Error al registrar actividad en Firestore:', error);
      return null;
    }
  }, [user]);

  /**
   * Avanza el estatus de una actividad al siguiente en el ciclo en Firestore
   * pendiente -> proceso -> completado -> pendiente
   */
  const advanceStatus = useCallback(async (activityId) => {
    if (!db) return;
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return;
    const nextStatus = { pendiente: 'proceso', proceso: 'completado', completado: 'pendiente' };
    try {
      await updateDoc(doc(db, 'actividades', activityId), { status: nextStatus[act.status] });
      logAudit({ user, module: 'actividades', action: 'Avanzó el estatus de una actividad', details: `${act.title}: ${act.status} -> ${nextStatus[act.status]}` });
    } catch (error) {
      console.error('Error al actualizar estatus de actividad en Firestore:', error);
    }
  }, [actividades, user]);

  /**
   * Elimina una actividad si su estatus es 'pendiente'
   */
  const deleteActividad = useCallback(async (activityId) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return { ok: false, error: 'Actividad no encontrada' };

    if (act.status !== 'pendiente') {
      return { ok: false, error: 'No se puede eliminar una actividad con avance (En Proceso o Completado).' };
    }

    try {
      await deleteDoc(doc(db, 'actividades', activityId));
      logAudit({ user, module: 'actividades', action: 'Eliminó una actividad', details: act.title || activityId });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar actividad de Firestore:', error);
      return { ok: false, error: error.message };
    }
  }, [actividades, user]);

  const value = useMemo(
    () => ({ actividades, addActividad, advanceStatus, deleteActividad }),
    [actividades, addActividad, advanceStatus, deleteActividad]
  );

  return <ActividadesContext.Provider value={value}>{children}</ActividadesContext.Provider>;
};

ActividadesProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
