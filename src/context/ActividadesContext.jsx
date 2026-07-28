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
import { uploadAttachments, deleteEvidencePhotos } from '../utils/evidenceStorage';

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
   * Registra una nueva actividad operativa en Firestore.
   * - `data.attachments` (si viene): archivos crudos (File) de referencia general (ej.
   *   planos de Arquitectura) — se suben a Storage y solo se guarda su referencia
   *   ({url, path, name}).
   * - `data.links`: arreglo simple de URLs de referencia (sin subir nada).
   * - `data.modelFile` (opcional, un solo File): el archivo del modelo 3D/renderizable
   *   de Diseño (ej. SolidWorks) — se sube aparte de `attachments` porque es el que
   *   abre el botón "🎬 Abrir Modelo" del bloque, no un adjunto de referencia más.
   * - `data.modelLink` (opcional, string): alternativa a subir el archivo — un link
   *   (ej. Drive) al mismo modelo, para cuando se comparte por fuera del sistema.
   */
  const addActividad = useCallback(async (data) => {
    if (!db) return null;
    const id = `ACT-${Date.now()}`;
    const { attachments = [], links = [], modelFile = null, modelLink = null, ...restData } = data;

    let uploadedAttachments = [];
    let uploadedModelFile = null;
    try {
      uploadedAttachments = await uploadAttachments('actividades', id, attachments);
      if (modelFile) {
        const [uploaded] = await uploadAttachments('actividades', id, [modelFile]);
        uploadedModelFile = uploaded || null;
      }
    } catch (error) {
      console.error('Error al subir los adjuntos de la actividad:', error);
      deleteEvidencePhotos(uploadedAttachments).catch(() => {});
      return null;
    }

    const created = {
      id,
      status: 'pendiente',
      attachments: uploadedAttachments,
      links: links.filter(Boolean),
      modelFile: uploadedModelFile,
      modelLink: modelLink?.trim() || null,
      ...restData,
    };
    try {
      await setDoc(doc(db, 'actividades', id), created);
      logAudit({ user, module: 'actividades', action: 'Registró una actividad', details: `${data.title} (${data.areaId})` });
      return id;
    } catch (error) {
      console.error('Error al registrar actividad en Firestore:', error);
      deleteEvidencePhotos([...uploadedAttachments, uploadedModelFile].filter(Boolean)).catch(() => {});
      return null;
    }
  }, [user]);

  /**
   * Edita campos arbitrarios de una actividad ya existente (ej. reasignar responsable
   * en lote desde un Bloque del Editor Visual). No maneja adjuntos — esos se suben con
   * `addActividad` al crearla.
   */
  const updateActividad = useCallback(async (activityId, updates) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      await updateDoc(doc(db, 'actividades', activityId), updates);
      logAudit({ user, module: 'actividades', action: 'Editó una actividad', details: activityId });
      return { ok: true };
    } catch (error) {
      console.error('Error al editar actividad en Firestore:', error);
      return { ok: false, error: error.message };
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
   * Elimina una actividad si su estatus es 'pendiente', junto con sus adjuntos en Storage
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
    } catch (error) {
      console.error('Error al eliminar actividad de Firestore:', error);
      return { ok: false, error: error.message };
    }

    const filesToClean = [...(act.attachments || []), act.modelFile].filter(Boolean);
    if (filesToClean.length) {
      deleteEvidencePhotos(filesToClean).catch(() => {});
    }
    return { ok: true };
  }, [actividades, user]);

  const value = useMemo(
    () => ({ actividades, addActividad, updateActividad, advanceStatus, deleteActividad }),
    [actividades, addActividad, updateActividad, advanceStatus, deleteActividad]
  );

  return <ActividadesContext.Provider value={value}>{children}</ActividadesContext.Provider>;
};

ActividadesProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
