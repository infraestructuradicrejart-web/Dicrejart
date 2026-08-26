/**
 * @file nasUploadService.js
 * @description Sube archivos de evidencia/ayuda visual al NAS de Dicrejart (vía la
 * Cloud Function `uploadToNas`), con respaldo automático a Firebase Storage si el NAS o
 * QuickConnect no responden — la migración de vuelta al NAS la reintenta sola
 * `nasMigrationRetryCheck` (Cloud Function programada), sin que el usuario pierda nada
 * ni tenga que hacer nada más.
 */

import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc } from 'firebase/firestore';
import { db, storage, functions } from '../config/firebase';

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/**
 * Sube un archivo de evidencia/ayuda visual al NAS. Si el NAS no responde, cae a
 * Firebase Storage como respaldo temporal y encola la migración automática — nunca
 * lanza por una falla del NAS en sí, solo si tampoco se pudo subir a Firebase.
 *
 * @param {File} file
 * @param {Object} ctx
 * @param {'fabricacion'|'calidad'|'diseno'} ctx.category
 * @param {string} [ctx.areaId] @param {string} [ctx.areaName]
 * @param {string} [ctx.gameId] @param {string} [ctx.gameName]
 * @param {string} [ctx.projectId] @param {string} [ctx.projectName]
 * @param {'actividad'|'auditVerdict'|'auditVerdictProject'|'recursoNode'} ctx.targetType
 * @param {Object} ctx.targetRef - ids suficientes para localizar el registro a actualizar cuando se migre
 * @returns {Promise<{url:string, nasPath:string|null, pendingMigration:boolean}>}
 */
export const uploadEvidenceFile = async (file, ctx) => {
  const { category, areaId, areaName, gameId, gameName, projectId, projectName, targetType, targetRef } = ctx;

  try {
    if (!functions) throw new Error('Cloud Functions no está inicializado.');
    const fileBase64 = await fileToBase64(file);
    const callable = httpsCallable(functions, 'uploadToNas');
    const result = await callable({
      fileBase64,
      fileName: file.name,
      mimeType: file.type,
      category,
      areaId: areaId || null,
      areaName: areaName || null,
      gameId: gameId || null,
      gameName: gameName || null,
      projectId: projectId || null,
      projectName: projectName || null,
    });
    const data = result.data;
    if (!data?.ok) throw new Error(data?.error || 'Fallo desconocido al subir al NAS.');
    return { url: data.url, nasPath: data.nasPath, pendingMigration: false };
  } catch (nasError) {
    console.warn('No se pudo subir al NAS, se usa respaldo temporal en Firebase Storage:', nasError);
    if (!storage) throw nasError;

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
  }
};

/**
 * Variante ligera para Ayudas Visuales (imágenes/PDFs/modelos 3D del lienzo, categoría
 * `'diseno'`): intenta el NAS y cae a Firebase Storage igual que `uploadEvidenceFile`,
 * pero SIN encolar migración automática — estos archivos se suben antes de que exista
 * un registro estable al cual asociar la migración después (ej. un nodo `recurso` que
 * todavía no se ha creado). Si el NAS está caído justo en ese momento, el archivo se
 * queda en Firebase Storage permanentemente (no se reintenta solo). Devuelve la misma
 * forma que ya esperan los 4 puntos que usan `uploadResourceFile` en
 * `EditorVisualPage.jsx`, para no tener que tocarlos.
 *
 * @param {File} file
 * @param {{projectId?:string, projectName?:string}} [routeCtx]
 */
export const uploadDesignFile = async (file, routeCtx = {}) => {
  try {
    if (!functions) throw new Error('Cloud Functions no está inicializado.');
    const fileBase64 = await fileToBase64(file);
    const callable = httpsCallable(functions, 'uploadToNas');
    const result = await callable({
      fileBase64,
      fileName: file.name,
      mimeType: file.type,
      category: 'diseno',
      projectId: routeCtx.projectId || null,
      projectName: routeCtx.projectName || null,
    });
    const data = result.data;
    if (!data?.ok) throw new Error(data?.error || 'Fallo desconocido al subir al NAS.');
    return { url: data.url, nasPath: data.nasPath, storagePath: null };
  } catch (nasError) {
    console.warn('No se pudo subir Ayuda Visual al NAS, se usa Firebase Storage:', nasError);
    return null;
  }
};

/** Borra un archivo del NAS — best-effort, nunca lanza (mismo criterio que deleteObject de Firebase Storage en el resto de la app). */
export const deleteNasFile = async (nasPath) => {
  if (!nasPath || !functions) return;
  try {
    const callable = httpsCallable(functions, 'deleteFromNas');
    await callable({ nasPath });
  } catch (error) {
    console.warn('No se pudo borrar el archivo del NAS (no crítico):', error);
  }
};
