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
import { getTodayLocalDateStr } from '../utils/dateUtils';

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
   * Crea o actualiza la evaluación de desempeño de un colaborador para un bloque y fecha específica.
   * Si se modifica un bloque previo o fecha pasada, registra el evento con timestamp y autor en la bitácora.
   * @param {string} operarioId
   * @param {string} blockId
   * @param {number} score
   * @param {string} notes
   * @param {string} targetDate - Fecha YYYY-MM-DD de la evaluación
   * @param {boolean} isPastBlockEdit - Indica si fue una edición sobre un bloque/fecha pasada
   * @returns {Promise<{ok: boolean, wasUpdate: boolean, isPastBlockEdit: boolean}>}
   */
  const saveEvaluacion = useCallback(
    async (operarioId, blockId, score, notes, targetDate = null, isPastBlockEdit = false) => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };

      const evalDate = targetDate || getTodayLocalDateStr();
      const existing = evaluaciones.find((ev) => {
        if (ev.operarioId !== operarioId || ev.blockId !== blockId) return false;
        const evDate = ev.date || (ev.createdAt ? ev.createdAt.split('T')[0] : null);
        return evDate ? evDate === evalDate : true;
      });

      const timestamp = new Date().toISOString();
      const editorName = user?.name || 'Usuario';
      const editorRole = user?.roleType || 'operador';

      try {
        if (existing) {
          const modRecord = {
            modifiedBy: editorName,
            modifiedByRole: editorRole,
            modifiedAt: timestamp,
            previousScore: existing.score,
            newScore: score,
            previousNotes: existing.notes || '',
            newNotes: notes || '',
            isPastBlockEdit,
          };
          const updatedHistory = [...(existing.history || []), modRecord];

          await updateDoc(doc(db, 'evaluaciones', existing.id), {
            score,
            notes,
            date: evalDate,
            updatedAt: timestamp,
            updatedBy: editorName,
            history: updatedHistory,
          });

          if (isPastBlockEdit) {
            logAudit({
              user,
              module: 'calidad',
              action: '⚠️ Modificó bloque de tiempo previo en Evaluación de Desempeño',
              details: `Operario: ${operarioId}, Bloque: ${blockId}, Fecha: ${evalDate}, Score: ${existing.score} -> ${score}, Autor: ${editorName} (${editorRole})`,
            });
          } else {
            logAudit({
              user,
              module: 'calidad',
              action: 'Actualizó evaluación de desempeño',
              details: `Operario: ${operarioId}, Bloque: ${blockId}, Score: ${score}`,
            });
          }
          return { ok: true, wasUpdate: true, isPastBlockEdit };
        } else {
          const id = `EV-${Date.now()}`;
          const newDoc = {
            id,
            operarioId,
            blockId,
            score,
            notes,
            date: evalDate,
            createdAt: timestamp,
            createdBy: editorName,
            createdByRole: editorRole,
            history: isPastBlockEdit
              ? [
                  {
                    modifiedBy: editorName,
                    modifiedByRole: editorRole,
                    modifiedAt: timestamp,
                    previousScore: null,
                    newScore: score,
                    previousNotes: '',
                    newNotes: notes,
                    isPastBlockEdit: true,
                  },
                ]
              : [],
          };
          await setDoc(doc(db, 'evaluaciones', id), newDoc);

          if (isPastBlockEdit) {
            logAudit({
              user,
              module: 'calidad',
              action: '⚠️ Registró evaluación retroactiva en bloque de tiempo previo',
              details: `Operario: ${operarioId}, Bloque: ${blockId}, Fecha: ${evalDate}, Score: ${score}, Autor: ${editorName} (${editorRole})`,
            });
          } else {
            logAudit({
              user,
              module: 'calidad',
              action: 'Registró evaluación de desempeño',
              details: `Operario: ${operarioId}, Bloque: ${blockId}, Score: ${score}`,
            });
          }
          return { ok: true, wasUpdate: false, isPastBlockEdit };
        }
      } catch (error) {
        console.error('Error al guardar evaluación en Firestore:', error);
        return { ok: false, error: error.message };
      }
    },
    [evaluaciones, user]
  );

  /**
   * Elimina una evaluación de desempeño específica (por ejemplo, si fue capturada por error
   * o si el colaborador faltó / estaba ausente).
   * @param {string} evaluacionId
   * @param {string} reason
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  const deleteEvaluacion = useCallback(
    async (evaluacionId, reason = '') => {
      if (!db) return { ok: false, error: 'Firestore no inicializado' };
      if (!evaluacionId) return { ok: false, error: 'ID de evaluación no especificado' };

      try {
        const evalRef = doc(db, 'evaluaciones', evaluacionId);
        const evalSnap = await getDoc(evalRef);
        let evalData = null;
        if (evalSnap.exists()) {
          evalData = evalSnap.data();
        } else {
          evalData = evaluaciones.find((e) => e.id === evaluacionId);
        }

        await deleteDoc(evalRef);

        const opId = evalData?.operarioId || 'N/A';
        const blkId = evalData?.blockId || 'N/A';
        const score = evalData?.score ?? 'N/A';
        const date = evalData?.date || 'N/A';
        const details = `Operario: ${opId}, Bloque: ${blkId}, Fecha: ${date}, Score: ${score}${reason ? `, Motivo: ${reason}` : ''}`;

        logAudit({
          user,
          module: 'calidad',
          action: '🗑️ Eliminó calificación de desempeño (por error)',
          details,
        });

        return { ok: true };
      } catch (error) {
        console.error('Error al eliminar evaluación en Firestore:', error);
        return { ok: false, error: error.message };
      }
    },
    [evaluaciones, user]
  );

  /**
   * Busca evaluaciones de desempeño ("calificaciones") cuyo operarioId ya no exista en
   * el padrón actual de operarios — huérfanas de un colaborador eliminado antes de que
   * `deleteOperario`/`clearAllOperarios` limpiaran también la colección "evaluaciones".
   * No borra nada por sí sola: solo reporta lo que encontró para revisar antes de limpiar.
   * Recorre TODA la colección (sin el límite en memoria de `evaluacionesLimit`), ya que
   * es una auditoría puntual, no la suscripción en vivo de la app.
   */
  const findOrphanedEvaluaciones = useCallback(async (validOperarioIds) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      const snap = await getDocs(collection(db, 'evaluaciones'));
      const validSet = new Set(validOperarioIds);
      const orphaned = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!validSet.has(data.operarioId)) {
          orphaned.push({ id: docSnap.id, operarioId: data.operarioId, blockId: data.blockId, score: data.score });
        }
      });
      return { ok: true, orphaned };
    } catch (error) {
      console.error('Error al buscar evaluaciones huérfanas:', error);
      return { ok: false, error: error.message };
    }
  }, []);

  /**
   * Elimina definitivamente las evaluaciones huérfanas ya identificadas por
   * findOrphanedEvaluaciones (recibe los ids de esos documentos).
   */
  const deleteOrphanedEvaluaciones = useCallback(async (evaluacionIds) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    try {
      await Promise.all(evaluacionIds.map((id) => deleteDoc(doc(db, 'evaluaciones', id))));
      logAudit({ user, module: 'calidad', action: 'Limpió evaluaciones huérfanas', details: `${evaluacionIds.length} eliminada(s)` });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar evaluaciones huérfanas:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  const value = useMemo(
    () => ({
      inspecciones,
      evaluaciones,
      addInspeccion,
      editInspeccion,
      deleteInspeccion,
      saveEvaluacion,
      deleteEvaluacion,
      addEvidenceToInspeccion,
      removeEvidenceFromInspeccion,
      findOrphanedEvaluaciones,
      deleteOrphanedEvaluaciones,
    }),
    [
      inspecciones,
      evaluaciones,
      addInspeccion,
      editInspeccion,
      deleteInspeccion,
      saveEvaluacion,
      deleteEvaluacion,
      addEvidenceToInspeccion,
      removeEvidenceFromInspeccion,
      findOrphanedEvaluaciones,
      deleteOrphanedEvaluaciones,
    ]
  );

  return <CalidadContext.Provider value={value}>{children}</CalidadContext.Provider>;
};

CalidadProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
