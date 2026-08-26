/**
 * @file nasUploadService.js
 * @description Sube archivos de evidencia al NAS de Dicrejart. QuickConnect no sirve
 * para llamadas servidor-a-servidor (necesita un navegador real ejecutando su
 * JavaScript de negociación), así que ninguna Cloud Function puede hablarle al NAS
 * directo — en vez de eso, el archivo se sube a Firebase Storage (siempre, instantáneo)
 * y se encola un trabajo en Firestore (`nasMigrationQueue`); el agente que corre DENTRO
 * del NAS (ver `nas-agent/`, Programador de Tareas de DSM) lo recoge y lo sube de
 * verdad al NAS por la API local de DSM, sin pasar por QuickConnect.
 */

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc } from 'firebase/firestore';
import { db, storage } from '../config/firebase';

/**
 * Sube un archivo de evidencia a Firebase Storage y encola su migración al NAS — la
 * evidencia queda disponible de inmediato (con la URL de Storage) mientras el agente la
 * mueve al NAS en su siguiente corrida.
 *
 * @param {File} file
 * @param {Object} ctx
 * @param {'fabricacion'|'calidad'} ctx.category
 * @param {string} [ctx.areaId] @param {string} [ctx.areaName]
 * @param {string} [ctx.gameId] @param {string} [ctx.gameName]
 * @param {string} [ctx.projectId] @param {string} [ctx.projectName]
 * @param {'actividad'|'auditVerdict'|'auditVerdictProject'} ctx.targetType
 * @param {Object} ctx.targetRef - ids suficientes para localizar el registro a actualizar cuando se migre
 * @returns {Promise<{url:string, nasPath:string|null, pendingMigration:boolean}>}
 */
export const uploadEvidenceFile = async (file, ctx) => {
  const { category, areaId, areaName, gameId, gameName, projectId, projectName, targetType, targetRef } = ctx;
  if (!storage) throw new Error('Firebase Storage no está inicializado.');

  const safeName = (file.name || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `nas_pendientes/${Date.now()}_${safeName}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, file);
  const firebaseUrl = await getDownloadURL(fileRef);

  if (db) {
    await addDoc(collection(db, 'nasMigrationQueue'), {
      createdAt: new Date().toISOString(),
      targetType,
      targetRef,
      firebaseUrl,
      firebaseStoragePath: storagePath,
      category,
      areaId: areaId || null,
      areaName: areaName || null,
      gameId: gameId || null,
      gameName: gameName || null,
      projectId: projectId || null,
      projectName: projectName || null,
      fileName: file.name,
      mimeType: file.type,
      attempts: 0,
      lastError: null,
    });
  }

  return { url: firebaseUrl, nasPath: null, pendingMigration: true };
};

/**
 * Encola el borrado de un archivo ya migrado al NAS — el agente lo procesa en su
 * siguiente corrida. Best-effort, nunca lanza (mismo criterio que deleteObject de
 * Firebase Storage en el resto de la app): si no se pudo encolar, el archivo queda
 * huérfano en el NAS, pero eso nunca debe bloquear la acción del usuario.
 */
export const deleteNasFile = async (nasPath) => {
  if (!nasPath || !db) return;
  try {
    await addDoc(collection(db, 'nasMigrationQueue'), {
      createdAt: new Date().toISOString(),
      action: 'delete',
      nasPath,
      attempts: 0,
      lastError: null,
    });
  } catch (error) {
    console.warn('No se pudo encolar el borrado del archivo en el NAS (no crítico):', error);
  }
};
