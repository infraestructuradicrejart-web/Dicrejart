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
  onSnapshot,
  getDocs
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { AuthContext } from './AuthContext';
import { ProduccionContext } from './ProduccionContext';
import { logAudit } from '../utils/auditLog';
import { uploadAttachments, uploadEvidencePhotos, deleteEvidencePhotos } from '../utils/evidenceStorage';
import { notifyActivityDeleted } from '../services/chatNotificationService';

export const ActividadesContext = createContext(null);

export const ActividadesProvider = ({ children }) => {
  const [actividades, setActividades] = useState([]);

  const { limits } = useContext(ConfigContext) || {};
  const actividadesLimit = limits?.actividadesLimit || DEFAULT_LIMITS.actividadesLimit;
  const { user } = useContext(AuthContext) || {};
  // ActividadesProvider vive anidado DENTRO de ProduccionProvider (ver App.jsx) — así se
  // puede llamar registerProductionLog directo al completar una actividad ligada a un
  // Juego, sin duplicar esa lógica aquí (ver advanceStatus).
  const { juegos, registerProductionLog } = useContext(ProduccionContext) || {};

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
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      checklist: [],
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
   * pendiente -> proceso -> completado -> pendiente.
   * `completionNotes` es obligatorio (validado en la UI, ver ActividadesPage.jsx) solo al
   * llegar a 'completado' — es el candado para que cerrar una actividad no sea un solo
   * clic sin dejar constancia de qué se hizo/verificó.
   * Si la actividad llega a 'completado' y está ligada a un Juego (`gameId`+`areaId`),
   * registra automáticamente esa producción vía registerProductionLog — así el
   * Dashboard/KPIs avanzan según se completan actividades del lienzo, sin necesitar el
   * registro manual de cantidad. `productionLogId` evita contarla dos veces si se reabre
   * y se vuelve a completar. Actividades sin `gameId` (tareas sueltas) no se ven afectadas.
   */
  const advanceStatus = useCallback(async (activityId, completionNotes = '') => {
    if (!db) return;
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return;
    const nextStatus = { pendiente: 'proceso', proceso: 'completado', completado: 'pendiente' };
    const newStatus = nextStatus[act.status];

    // Marca de tiempo para poder medir después cuánto tarda una actividad en resolverse
    // (ver Reportes → sección Actividades): se fija al llegar a cada etapa, y se limpia
    // si el ciclo vuelve a 'pendiente' (reinicio manual), para que un reporte no muestre
    // una actividad "completada" con una fecha vieja después de reabrirla.
    const updates = { status: newStatus };
    if (newStatus === 'proceso' && !act.startedAt) {
      updates.startedAt = new Date().toISOString();
    } else if (newStatus === 'completado') {
      updates.completedAt = new Date().toISOString();
      updates.completionNotes = completionNotes.trim();
    } else if (newStatus === 'pendiente') {
      updates.startedAt = null;
      updates.completedAt = null;
      updates.completionNotes = '';
    }

    try {
      await updateDoc(doc(db, 'actividades', activityId), updates);
      logAudit({ user, module: 'actividades', action: 'Avanzó el estatus de una actividad', details: `${act.title}: ${act.status} -> ${newStatus}` });

      if (newStatus === 'completado' && act.gameId && act.areaId && !act.productionLogId && registerProductionLog) {
        const game = (juegos || []).find((j) => j.id === act.gameId);
        if (game) {
          const result = await registerProductionLog({
            areaId: act.areaId,
            quantity: act.quantity || 1,
            operator: user?.name || user?.email || 'Usuario',
            gameName: game.name,
            notes: `Actividad completada: ${act.title}`,
            photos: [],
          });
          if (result?.ok !== false && result?.id) {
            await updateDoc(doc(db, 'actividades', activityId), { productionLogId: result.id });
          }
        }
      }
    } catch (error) {
      console.error('Error al actualizar estatus de actividad en Firestore:', error);
    }
  }, [actividades, user, juegos, registerProductionLog]);

  /**
   * Agrega un punto a la checklist de subtareas de una actividad (mismo patrón que el
   * checklist de revisión de calidad en ProduccionContext.jsx, pero como campo plano —
   * una actividad no se divide por área).
   */
  const addChecklistItem = useCallback(async (activityId, text) => {
    if (!db) return;
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return;
    const newItem = { id: `chk-${Date.now()}`, text, checked: false };
    try {
      await updateDoc(doc(db, 'actividades', activityId), {
        checklist: [...(act.checklist || []), newItem],
      });
      logAudit({ user, module: 'actividades', action: 'Agregó punto de checklist a una actividad', details: `${act.title}: "${text}"` });
    } catch (error) {
      console.error('Error al agregar item de checklist en Firestore:', error);
    }
  }, [actividades, user]);

  /**
   * Marca/desmarca un punto de la checklist de una actividad
   */
  const toggleChecklistItem = useCallback(async (activityId, itemId) => {
    if (!db) return;
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return;
    const nextChecklist = (act.checklist || []).map((it) =>
      it.id === itemId ? { ...it, checked: !it.checked } : it
    );
    try {
      await updateDoc(doc(db, 'actividades', activityId), { checklist: nextChecklist });
      logAudit({ user, module: 'actividades', action: 'Marcó/desmarcó punto de checklist de una actividad', details: act.title });
    } catch (error) {
      console.error('Error al marcar item de checklist en Firestore:', error);
    }
  }, [actividades, user]);

  /**
   * Quita un punto de la checklist de una actividad
   */
  const removeChecklistItem = useCallback(async (activityId, itemId) => {
    if (!db) return;
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return;
    try {
      await updateDoc(doc(db, 'actividades', activityId), {
        checklist: (act.checklist || []).filter((it) => it.id !== itemId),
      });
      logAudit({ user, module: 'actividades', action: 'Quitó punto de checklist de una actividad', details: act.title });
    } catch (error) {
      console.error('Error al remover item de checklist en Firestore:', error);
    }
  }, [actividades, user]);

  /**
   * Agrega evidencia fotográfica a una actividad (separada de `attachments`, que son
   * adjuntos de referencia tipo planos, no evidencia de avance). Mismo patrón que
   * addEvidenceToInspeccion en CalidadContext.jsx.
   */
  const addEvidenceToActividad = useCallback(async (activityId, files) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return { ok: false, error: 'Actividad no encontrada' };
    try {
      const uploaded = await uploadEvidencePhotos('actividades', activityId, files);
      const photos = [...(act.evidencePhotos || []), ...uploaded];
      await updateDoc(doc(db, 'actividades', activityId), { evidencePhotos: photos });
      logAudit({ user, module: 'actividades', action: 'Agregó evidencia fotográfica a una actividad', details: act.title });
      return { ok: true, photos };
    } catch (error) {
      console.error('Error al subir evidencia fotográfica de actividad:', error);
      return { ok: false, error: error.message };
    }
  }, [actividades, user]);

  /**
   * Quita una foto de evidencia de una actividad (borra el archivo de Storage y
   * actualiza el arreglo en Firestore).
   */
  const removeEvidenceFromActividad = useCallback(async (activityId, photoPath) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return { ok: false, error: 'Actividad no encontrada' };
    try {
      const photoToRemove = (act.evidencePhotos || []).find((p) => p.path === photoPath);
      const photos = (act.evidencePhotos || []).filter((p) => p.path !== photoPath);
      await updateDoc(doc(db, 'actividades', activityId), { evidencePhotos: photos });
      if (photoToRemove) deleteEvidencePhotos([photoToRemove]).catch(() => {});
      logAudit({ user, module: 'actividades', action: 'Quitó evidencia fotográfica de una actividad', details: act.title });
      return { ok: true, photos };
    } catch (error) {
      console.error('Error al quitar evidencia fotográfica de actividad:', error);
      return { ok: false, error: error.message };
    }
  }, [actividades, user]);

  /**
   * Elimina una actividad si su estatus es 'pendiente', junto con sus adjuntos en Storage,
   * y despacha un aviso automático al chat del colaborador asignado y al canal general.
   */
  const deleteActividad = useCallback(async (activityId) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return { ok: false, error: 'Actividad no encontrada' };

    if (act.status !== 'pendiente') {
      return { ok: false, error: 'No se puede eliminar una actividad con avance (En Proceso o Completado).' };
    }

    try {
      // 1. Despachar aviso al chat interno antes de borrar el documento
      notifyActivityDeleted({
        activity: act,
        user,
      }).catch((err) => console.error('Error al notificar eliminación de actividad al chat:', err));

      // 2. Eliminar de Firestore y registrar auditoría
      await deleteDoc(doc(db, 'actividades', activityId));
      logAudit({ user, module: 'actividades', action: 'Eliminó una actividad', details: act.title || activityId });
    } catch (error) {
      console.error('Error al eliminar actividad de Firestore:', error);
      return { ok: false, error: error.message };
    }

    const filesToClean = [...(act.attachments || []), ...(act.evidencePhotos || []), act.modelFile].filter(Boolean);
    if (filesToClean.length) {
      deleteEvidencePhotos(filesToClean).catch(() => {});
    }
    return { ok: true };
  }, [actividades, user]);

  /**
   * Busca actividades cuyo operarioId ya no exista en el padrón actual de operarios —
   * huérfanas de un colaborador eliminado antes de que deleteOperario empezara a
   * desasignarlas también a ellas. No modifica nada por sí sola: solo reporta lo que
   * encontró para revisar antes de decidir qué hacer. Recorre TODA la colección (sin el
   * límite en memoria de actividadesLimit), ya que es una auditoría puntual.
   */
  const findOrphanedAssignments = useCallback(async (validOperarioIds) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const snap = await getDocs(collection(db, 'actividades'));
      const validSet = new Set(validOperarioIds);
      const orphaned = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.operarioId && !validSet.has(data.operarioId)) {
          orphaned.push({
            id: docSnap.id,
            title: data.title,
            operarioId: data.operarioId,
            areaId: data.areaId,
            status: data.status,
          });
        }
      });
      return { ok: true, orphaned };
    } catch (error) {
      console.error('Error al buscar actividades con colaborador huérfano:', error);
      return { ok: false, error: error.message };
    }
  }, []);

  /**
   * Quita el operarioId roto de las actividades huérfanas ya identificadas por
   * findOrphanedAssignments (recibe sus ids) — las deja "Sin asignar" en vez de
   * borrarlas, porque la actividad en sí sigue siendo válida.
   */
  const unassignOrphanedActivities = useCallback(async (activityIds) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      await Promise.all(activityIds.map((id) => updateDoc(doc(db, 'actividades', id), { operarioId: null })));
      logAudit({
        user,
        module: 'actividades',
        action: 'Limpió asignaciones huérfanas',
        details: `${activityIds.length} actividad(es) sin colaborador`,
      });
      return { ok: true };
    } catch (error) {
      console.error('Error al limpiar actividades huérfanas:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  const value = useMemo(
    () => ({
      actividades,
      addActividad,
      updateActividad,
      advanceStatus,
      deleteActividad,
      addChecklistItem,
      toggleChecklistItem,
      removeChecklistItem,
      addEvidenceToActividad,
      removeEvidenceFromActividad,
      findOrphanedAssignments,
      unassignOrphanedActivities,
    }),
    [actividades, addActividad, updateActividad, advanceStatus, deleteActividad, addChecklistItem, toggleChecklistItem, removeChecklistItem, addEvidenceToActividad, removeEvidenceFromActividad, findOrphanedAssignments, unassignOrphanedActivities]
  );

  return <ActividadesContext.Provider value={value}>{children}</ActividadesContext.Provider>;
};

ActividadesProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
