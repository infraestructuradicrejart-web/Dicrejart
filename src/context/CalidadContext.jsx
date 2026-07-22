/**
 * @file CalidadContext.jsx
 * @description Contexto global de aseguramiento de calidad de Dicrejart.
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
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { ProduccionContext } from './ProduccionContext';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { AuthContext } from './AuthContext';
import { uploadEvidencePhotos, deleteEvidencePhotos, withTimeout } from '../utils/evidenceStorage';
import { logAudit } from '../utils/auditLog';

export const CalidadContext = createContext(null);

/**
 * Genera el siguiente ID de pieza (PZ-0001, PZ-0002...), contando cuántas piezas
 * distintas (pieceTrackingId únicos) ya existen en el historial.
 * @param {Array} inspecciones
 * @returns {string}
 */
const nextPieceTrackingId = (inspecciones) => {
  const existingIds = new Set(inspecciones.map((i) => i.pieceTrackingId).filter(Boolean));
  return `PZ-${String(existingIds.size + 1).padStart(4, '0')}`;
};

export const CalidadProvider = ({ children }) => {
  const [inspecciones, setInspecciones] = useState([]);
  const [evaluaciones, setEvaluaciones] = useState([]);

  const { updateGameQualityDefect, updateGameQualityDefectFromHistory } = useContext(ProduccionContext) || {};
  const { limits } = useContext(ConfigContext) || {};
  const { user } = useContext(AuthContext) || {};
  const inspeccionesLimit = limits?.inspeccionesLimit || DEFAULT_LIMITS.inspeccionesLimit;
  const evaluacionesLimit = limits?.evaluacionesLimit || DEFAULT_LIMITS.evaluacionesLimit;

  // ============================================
  // ESCUCHAS EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  // Se espera a onAuthStateChanged y se resuscribe con cada cambio de sesión: este
  // Provider envuelve toda la app (incluida /login), así que suscribirse de inmediato
  // fallaría por falta de permisos antes del login, sin volver a intentarlo después.
  // También se vuelve a suscribir si cambia el límite dinámico configurado por el Admin.
  useEffect(() => {
    if (!db || !auth) return;

    let unsubscribers = [];

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubscribers.forEach((unsub) => unsub());
      unsubscribers = [];

      if (!user) {
        setInspecciones([]);
        setEvaluaciones([]);
        return;
      }

      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'inspecciones'), orderBy('date', 'desc'), limit(inspeccionesLimit)),
          (snap) => {
            const list = [];
            snap.forEach((doc) => {
              list.push({ ...doc.data(), id: doc.id });
            });
            list.sort((a, b) => new Date(b.date) - new Date(a.date));
            setInspecciones(list);
          }
        )
      );

      unsubscribers.push(
        onSnapshot(
          // Se ordena por "id" (formato EV-<timestamp>, ya presente desde siempre en cada
          // documento) en vez de un campo de fecha nuevo, para no dejar invisibles las
          // evaluaciones ya guardadas antes de este cambio (orderBy excluye los documentos
          // que no tengan el campo por el que se ordena).
          query(collection(db, 'evaluaciones'), orderBy('id', 'desc'), limit(evaluacionesLimit)),
          (snap) => {
            const list = [];
            snap.forEach((doc) => {
              list.push({ ...doc.data(), id: doc.id });
            });
            setEvaluaciones(list);
          }
        )
      );
    });

    return () => {
      unsubAuth();
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [inspeccionesLimit, evaluacionesLimit]);

  /**
   * Registra una nueva inspección de calidad de juego en Firestore
   */
  const addInspeccion = useCallback(async (data) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const id = `QLY-${Date.now()}`;

    // El pieceTrackingId identifica a la pieza física a lo largo de su línea de tiempo.
    // Si el inspector marcó explícitamente (eligiéndola por su ID, no por su nombre —
    // pueden existir varias piezas con el mismo nombre) que esta auditoría es el
    // seguimiento de una pieza ya existente, se reutiliza esa misma pieceTrackingId;
    // si no, es una pieza nueva y se le asigna un ID propio (PZ-0001, PZ-0002...).
    const parent = data.previousInspeccionId
      ? inspecciones.find((i) => i.id === data.previousInspeccionId)
      : null;
    const pieceTrackingId = parent ? (parent.pieceTrackingId || parent.id) : nextPieceTrackingId(inspecciones);

    const { photos, ...restData } = data;

    // Se guarda primero la inspección (sin fotos); la evidencia se sube después y por
    // separado, para que una falla de conexión al subir la foto nunca eche a perder la
    // inspección ya registrada.
    const created = {
      id,
      date: new Date().toISOString(),
      ...restData,
      photos: [],
      pieceTrackingId,
      previousInspeccionId: parent ? parent.id : null,
    };

    try {
      await setDoc(doc(db, 'inspecciones', id), created);
      if (updateGameQualityDefect) {
        await updateGameQualityDefect(data.gameName, data.areaId, data.status === 'defectuoso');
      }
      logAudit({ user, module: 'calidad', action: 'Registró una inspección de calidad', details: `${data.gameName} (${data.areaId}) — ${data.status}` });
    } catch (error) {
      console.error('Error al registrar inspección en Firestore:', error);
      return { ok: false, error: error.message };
    }

    // La inspección ya quedó guardada a partir de aquí; si falla (o tarda demasiado) la
    // subida de la foto, la inspección no se pierde — solo se avisa que falta la
    // evidencia. Se corre con un límite de tiempo porque, sin conexión, Firebase Storage
    // puede seguir reintentando por más de un minuto antes de darse por vencido.
    if (photos && photos.length > 0) {
      const uploadTask = uploadEvidencePhotos('inspecciones', id, photos)
        .then(async (uploadedPhotos) => {
          await updateDoc(doc(db, 'inspecciones', id), { photos: uploadedPhotos });
          return { ok: true };
        })
        .catch((error) => {
          console.error('Error al subir evidencia fotográfica (la inspección ya se guardó):', error);
          return { ok: false, error: error.message };
        });

      const result = await withTimeout(uploadTask, 8000);

      if (result.timedOut) {
        return {
          ok: true,
          photoWarning: 'La inspección se guardó. La evidencia fotográfica está tardando en subir (posible falla de conexión) y sigue intentándose en segundo plano; si no aparece, agrégala después editando la inspección.',
        };
      }

      if (!result.ok) {
        return {
          ok: true,
          photoWarning: 'La inspección se guardó, pero la evidencia fotográfica no se pudo subir (revisa tu conexión). Puedes agregarla después editando la inspección.',
        };
      }
    }

    return { ok: true };
  }, [updateGameQualityDefect, inspecciones, user]);

  /**
   * Edita una inspección de calidad y actualiza el estado de defectos del juego
   */
  const editInspeccion = useCallback(async (inspeccionId, updatedFields) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const insRef = doc(db, 'inspecciones', inspeccionId);
      await updateDoc(insRef, updatedFields);

      // Sincronizar el defecto activo consultando el historial actualizado
      const insSnap = await getDoc(insRef);
      if (insSnap.exists() && updateGameQualityDefectFromHistory) {
        const insData = insSnap.data();
        await updateGameQualityDefectFromHistory(insData.gameName, insData.areaId);
      }
      logAudit({ user, module: 'calidad', action: 'Editó una inspección de calidad', details: inspeccionId });
      return { ok: true };
    } catch (error) {
      console.error('Error al editar inspección:', error);
      return { ok: false, error: error.message };
    }
  }, [updateGameQualityDefectFromHistory, user]);

  /**
   * Sube y agrega nuevas fotos de evidencia a una inspección ya existente (permite
   * completar la evidencia si falló al registrarla, ej. por falta de conexión)
   */
  const addEvidenceToInspeccion = useCallback(async (inspeccionId, files) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const insRef = doc(db, 'inspecciones', inspeccionId);
      const insSnap = await getDoc(insRef);
      if (!insSnap.exists()) return { ok: false, error: 'Inspección no encontrada' };

      const existingPhotos = insSnap.data().photos || [];
      const uploaded = await uploadEvidencePhotos('inspecciones', inspeccionId, files);
      const photos = [...existingPhotos, ...uploaded];

      await updateDoc(insRef, { photos });
      logAudit({ user, module: 'calidad', action: 'Agregó evidencia fotográfica a una inspección', details: inspeccionId });
      return { ok: true, photos };
    } catch (error) {
      console.error('Error al subir evidencia fotográfica:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Quita una foto de evidencia de una inspección (borra el archivo de Storage y
   * actualiza el arreglo en Firestore)
   */
  const removeEvidenceFromInspeccion = useCallback(async (inspeccionId, photoPath) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const insRef = doc(db, 'inspecciones', inspeccionId);
      const insSnap = await getDoc(insRef);
      if (!insSnap.exists()) return { ok: false, error: 'Inspección no encontrada' };

      const existingPhotos = insSnap.data().photos || [];
      const target = existingPhotos.find((p) => p && typeof p === 'object' && p.path === photoPath);
      const photos = existingPhotos.filter((p) => !(p && typeof p === 'object' && p.path === photoPath));

      await updateDoc(insRef, { photos });
      if (target) await deleteEvidencePhotos([target]);
      logAudit({ user, module: 'calidad', action: 'Quitó evidencia fotográfica de una inspección', details: inspeccionId });
      return { ok: true, photos };
    } catch (error) {
      console.error('Error al quitar evidencia fotográfica:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Elimina una inspección de calidad y actualiza el estado de defectos del juego
   */
  const deleteInspeccion = useCallback(async (inspeccionId) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      if (!inspeccionId) {
        return { ok: false, error: 'El ID de la inspección no está definido (undefined)' };
      }
      const insRef = doc(db, 'inspecciones', inspeccionId);
      const insSnap = await getDoc(insRef);
      if (!insSnap.exists()) {
        return { ok: false, error: `Inspección no encontrada (ID: ${inspeccionId})` };
      }
      const insData = insSnap.data();

      if (insData.photos?.length) {
        await deleteEvidencePhotos(insData.photos);
      }

      await deleteDoc(insRef);

      if (updateGameQualityDefectFromHistory) {
        await updateGameQualityDefectFromHistory(insData.gameName, insData.areaId);
      }
      logAudit({ user, module: 'calidad', action: 'Eliminó una inspección de calidad', details: `${insData.gameName} (${insData.areaId})` });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar inspección:', error);
      return { ok: false, error: `Error al eliminar: ${error.message}` };
    }
  }, [updateGameQualityDefectFromHistory, user]);

  /**
   * Crea o actualiza la evaluación de desempeño de un colaborador
   * @returns {boolean} true si ya existía una evaluación previa (fue actualizada)
   */
  const saveEvaluacion = useCallback(
    (operarioId, blockId, score, notes) => {
      if (!db) return false;
      const existing = evaluaciones.find(
        (ev) => ev.operarioId === operarioId && ev.blockId === blockId
      );

      const runSave = async () => {
        try {
          if (existing) {
            await updateDoc(doc(db, 'evaluaciones', existing.id), { score, notes });
          } else {
            const id = `EV-${Date.now()}`;
            await setDoc(doc(db, 'evaluaciones', id), {
              id,
              operarioId,
              blockId,
              score,
              notes,
            });
          }
          logAudit({ user, module: 'calidad', action: 'Guardó evaluación de desempeño', details: `Operario ${operarioId}, bloque ${blockId}, score ${score}` });
        } catch (error) {
          console.error('Error al guardar evaluación en Firestore:', error);
        }
      };

      runSave();
      return Boolean(existing);
    },
    [evaluaciones, user]
  );

  const value = useMemo(
    () => ({
      inspecciones,
      evaluaciones,
      addInspeccion,
      editInspeccion,
      deleteInspeccion,
      saveEvaluacion,
      addEvidenceToInspeccion,
      removeEvidenceFromInspeccion,
    }),
    [inspecciones, evaluaciones, addInspeccion, editInspeccion, deleteInspeccion, saveEvaluacion, addEvidenceToInspeccion, removeEvidenceFromInspeccion]
  );

  return <CalidadContext.Provider value={value}>{children}</CalidadContext.Provider>;
};

CalidadProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
