/**
 * @file synologyClient.js
 * @description Cliente HTTP mínimo para la API Web de Synology DSM (File Station) —
 * usado por las Cloud Functions de subida/borrado/proxy de evidencias al NAS. Usa el
 * `fetch`/`FormData`/`Blob` nativos de Node 22 (mismo runtime que el resto de
 * `functions/`) — a propósito sin ninguna librería nueva de npm.
 */

const SESSION_NAME = 'FileStation';

/** Inicia sesión en DSM y devuelve el `sid` para las siguientes llamadas. */
async function login(nasUrl, account, passwd) {
  const url = `${nasUrl}/webapi/auth.cgi?api=SYNO.API.Auth&version=6&method=login&account=${encodeURIComponent(account)}&passwd=${encodeURIComponent(passwd)}&session=${SESSION_NAME}&format=sid`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) {
    throw new Error(`No se pudo iniciar sesión en el NAS (código ${data.error?.code}).`);
  }
  return data.data.sid;
}

/** Cierra la sesión — buena práctica, no deja sesiones acumuladas en DSM. */
async function logout(nasUrl, sid) {
  try {
    await fetch(`${nasUrl}/webapi/auth.cgi?api=SYNO.API.Auth&version=6&method=logout&session=${SESSION_NAME}&_sid=${sid}`);
  } catch (e) {
    // No crítico — la sesión igual expira sola.
  }
}

/** Lista el contenido de una carpeta. Devuelve `[]` si la carpeta no existe. */
async function listFolder(nasUrl, sid, folderPath) {
  const url = `${nasUrl}/webapi/entry.cgi?api=SYNO.FileStation.List&version=2&method=list&folder_path=${encodeURIComponent(folderPath)}&_sid=${sid}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return [];
  return data.data?.files || [];
}

/** Crea una carpeta (y sus padres si hace falta). Idempotente: si ya existe, no falla. */
async function createFolder(nasUrl, sid, parentPath, name) {
  const url = `${nasUrl}/webapi/entry.cgi?api=SYNO.FileStation.CreateFolder&version=2&method=create&folder_path=${encodeURIComponent(JSON.stringify([parentPath]))}&name=${encodeURIComponent(JSON.stringify([name]))}&force_parent=true&_sid=${sid}`;
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();
  // Código 408 = "El archivo ya existe" — no es un error real para nosotros (idempotente).
  if (!data.success && data.error?.code !== 408) {
    throw new Error(`No se pudo crear la carpeta "${name}" en el NAS (código ${data.error?.code}).`);
  }
  return `${parentPath}/${name}`;
}

/**
 * Busca (o crea) una subcarpeta por nombre exacto dentro de `parentPath`. Es la pieza
 * que hace la organización "inteligente": nunca duplica una carpeta que ya existe.
 */
async function ensureFolder(nasUrl, sid, parentPath, name) {
  const existing = await listFolder(nasUrl, sid, parentPath);
  const found = existing.find((f) => f.isdir && f.name === name);
  if (found) return found.path;
  return createFolder(nasUrl, sid, parentPath, name);
}

/** Sube un archivo (Buffer) a una carpeta del NAS. Devuelve la ruta final del archivo. */
async function uploadFile(nasUrl, sid, folderPath, fileName, buffer, mimeType) {
  const form = new FormData();
  form.append('api', 'SYNO.FileStation.Upload');
  form.append('version', '2');
  form.append('method', 'upload');
  form.append('path', folderPath);
  form.append('create_parents', 'true');
  form.append('overwrite', 'false');
  form.append('_sid', sid);
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), fileName);

  const res = await fetch(`${nasUrl}/webapi/entry.cgi`, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`No se pudo subir el archivo al NAS (código ${data.error?.code}).`);
  }
  return `${folderPath}/${fileName}`;
}

/**
 * Crea un link para compartir el archivo — usado para evidencias donde solo hace falta
 * un botón "Abrir" (Actividad/Auditoría), no vista previa embebida.
 */
async function createShareLink(nasUrl, sid, filePath) {
  const url = `${nasUrl}/webapi/entry.cgi?api=SYNO.FileStation.Sharing&version=3&method=create&path=${encodeURIComponent(JSON.stringify([filePath]))}&_sid=${sid}`;
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();
  if (!data.success || !data.data?.links?.[0]?.id) {
    throw new Error(`No se pudo crear el link para compartir (código ${data.error?.code}).`);
  }
  // Se construye con NAS_URL (el dominio de QuickConnect) en vez de usar el `url` que
  // regresa la API, que normalmente trae la IP/hostname local del NAS — no alcanzable
  // desde fuera de la red.
  return `${nasUrl}/sharing/${data.data.links[0].id}`;
}

/** Descarga el archivo crudo (bytes) — usado por el proxy de vista previa y la migración. */
async function downloadFile(nasUrl, sid, filePath) {
  const url = `${nasUrl}/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&path=${encodeURIComponent(filePath)}&mode=open&_sid=${sid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar el archivo del NAS (HTTP ${res.status}).`);
  return res;
}

/** Borra un archivo — "fire and forget" (no se espera a que termine la tarea async de DSM). */
async function deleteFile(nasUrl, sid, filePath) {
  const url = `${nasUrl}/webapi/entry.cgi?api=SYNO.FileStation.Delete&version=2&method=start&path=${encodeURIComponent(JSON.stringify([filePath]))}&_sid=${sid}`;
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`No se pudo borrar el archivo del NAS (código ${data.error?.code}).`);
  }
}

module.exports = { login, logout, listFolder, createFolder, ensureFolder, uploadFile, createShareLink, downloadFile, deleteFile };
