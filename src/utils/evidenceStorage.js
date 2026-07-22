/**
 * @file evidenceStorage.js
 * @description Utilidad compartida para subir/borrar evidencia fotográfica en Firebase
 * Storage (comprimida en el cliente), reutilizada por Producción y Calidad para no
 * duplicar la lógica de subida/borrado de fotos.
 * @author Dicrejart Dev Team
 * @requires firebase/storage
 */

import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../config/firebase';
import { compressImage } from './imageCompressor';

/**
 * Comprime y sube a Firebase Storage la evidencia fotográfica de un registro, bajo
 * `{baseFolder}/{id}/`. Retorna la metadata mínima (url + path) que se guarda en el
 * documento de Firestore, no el archivo en sí.
 */
export const uploadEvidencePhotos = async (baseFolder, id, files) => {
  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const compressed = await compressImage(files[i]);
    const path = `${baseFolder}/${id}/${Date.now()}_${i}.jpg`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, compressed);
    const url = await getDownloadURL(fileRef);
    uploaded.push({ url, path });
  }
  return uploaded;
};

/**
 * Borra de Firebase Storage los archivos de evidencia indicados (al eliminar un
 * registro completo o una foto individual). Los errores se registran pero no
 * detienen el borrado del resto, para no bloquear al usuario por un archivo huérfano.
 * Ignora silenciosamente fotos que no tengan `path` (ej. fotos antiguas guardadas como
 * base64 directo, que no tienen archivo real en Storage que borrar).
 */
/**
 * Corre una promesa con un límite de tiempo. Si no resuelve a tiempo, retorna
 * `{ timedOut: true }` en vez de esperarla indefinidamente — necesario porque los
 * reintentos internos de Firebase Storage ante una falla de red pueden tardar más de un
 * minuto antes de darse por vencidos, y no queremos que la UI se quede "guardando" todo
 * ese tiempo cuando el registro principal (sin la foto) ya se guardó hace rato.
 */
export const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
};

/**
 * Sube a Firebase Storage uno o más archivos (imagen o PDF) — a diferencia de
 * `uploadEvidencePhotos` (solo fotos), conserva la extensión real del archivo y no
 * fuerza `.jpg`, porque los adjuntos de Compras (cotizaciones, comprobantes) incluyen
 * PDFs. Las imágenes sí se comprimen igual que la evidencia fotográfica; los PDFs se
 * suben tal cual. Retorna `{url, path, name}` — `name` se guarda para mostrar el
 * nombre original del archivo en la UI (los adjuntos de Compras sí lo necesitan).
 */
export const uploadAttachments = async (baseFolder, id, files) => {
  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isImage = file.type?.startsWith('image/');
    const toUpload = isImage ? await compressImage(file) : file;
    const ext = isImage ? 'jpg' : (file.name?.split('.').pop() || 'bin');
    const path = `${baseFolder}/${id}/${Date.now()}_${i}.${ext}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, toUpload);
    const url = await getDownloadURL(fileRef);
    uploaded.push({ url, path, name: file.name });
  }
  return uploaded;
};

export const deleteEvidencePhotos = async (photos = []) => {
  await Promise.all(
    photos
      .filter((photo) => photo && typeof photo === 'object' && photo.path)
      .map(async (photo) => {
        try {
          await deleteObject(ref(storage, photo.path));
        } catch (error) {
          console.error('Error al borrar evidencia fotográfica de Storage:', error);
        }
      })
  );
};
