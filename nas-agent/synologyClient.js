/**
 * @file synologyClient.js
 * @description Cliente HTTP mínimo para la API Web de Synology DSM (File Station) —
 * usado por el agente NAS (index.js), que corre DENTRO del propio NAS, así que le habla
 * a DSM por `http://localhost:5000` (sin QuickConnect de por medio — confirmado que
 * QuickConnect no sirve para llamadas servidor-a-servidor, requiere un navegador real
 * que ejecute su JavaScript de negociación). Usa el `fetch`/`FormData`/`Blob` nativos de
 * Node — sin librerías nuevas de npm más que `firebase-admin` (ver package.json).
 */

const SESSION_NAME = 'FileStation';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * `fetch` + parseo de JSON con diagnóstico real cuando el NAS no regresa JSON — sin
 * esto, un error de DSM se ve como "Unexpected token '<'" sin decir nada útil.
 */
async function fetchJson(url, options = {}, label = 'solicitud') {
  const res = await fetch(url, {
    ...options,
    headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const snippet = text.slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`El NAS no regresó JSON en "${label}" (HTTP ${res.status}). Respuesta: ${snippet}`);
  }
}

/**
 * POST a `entry.cgi` con los parámetros en el CUERPO (application/x-www-form-urlencoded),
 * no en la URL — las operaciones de escritura (crear carpeta, compartir, borrar) de DSM
 * regresaban "código 101: falta un parámetro" al mandarlas como POST con los parámetros
 * solo en el query string y sin cuerpo; con el cuerpo correcto sí los reconoce. Las
 * operaciones de lectura (login, listar) sí funcionan bien por GET con query string, así
 * que esas no se tocan.
 */
async function entryPost(nasUrl, sid, params, label) {
  const body = new URLSearchParams({ ...params, _sid: sid }).toString();
  return fetchJson(
    `${nasUrl}/webapi/entry.cgi`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
    label
  );
}

/** Inicia sesión en DSM y devuelve el `sid` para las siguientes llamadas. */
async function login(nasUrl, account, passwd) {
  const url = `${nasUrl}/webapi/auth.cgi?api=SYNO.API.Auth&version=6&method=login&account=${encodeURIComponent(account)}&passwd=${encodeURIComponent(passwd)}&session=${SESSION_NAME}&format=sid`;
  const data = await fetchJson(url, {}, 'login');
  if (!data.success) {
    throw new Error(`No se pudo iniciar sesión en el NAS (código ${data.error?.code}).`);
  }
  return data.data.sid;
}

/** Cierra la sesión — buena práctica, no deja sesiones acumuladas en DSM. */
async function logout(nasUrl, sid) {
  try {
    await fetch(`${nasUrl}/webapi/auth.cgi?api=SYNO.API.Auth&version=6&method=logout&session=${SESSION_NAME}&_sid=${sid}`, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });
  } catch (e) {
    // No crítico — la sesión igual expira sola.
  }
}

/** Lista el contenido de una carpeta. Devuelve `[]` si la carpeta no existe. */
async function listFolder(nasUrl, sid, folderPath) {
  const url = `${nasUrl}/webapi/entry.cgi?api=SYNO.FileStation.List&version=2&method=list&folder_path=${encodeURIComponent(folderPath)}&_sid=${sid}`;
  const data = await fetchJson(url, {}, 'listar carpeta');
  if (!data.success) return [];
  return data.data?.files || [];
}

/** Crea una carpeta (y sus padres si hace falta). Idempotente: si ya existe, no falla. */
async function createFolder(nasUrl, sid, parentPath, name) {
  const data = await entryPost(nasUrl, sid, {
    api: 'SYNO.FileStation.CreateFolder',
    version: '2',
    method: 'create',
    folder_path: JSON.stringify([parentPath]),
    name: JSON.stringify([name]),
    force_parent: 'true',
  }, 'crear carpeta');
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

/**
 * Sube un archivo (Buffer) a una carpeta del NAS. Devuelve la ruta final del archivo.
 * A diferencia de las demás llamadas de escritura, la API de Upload de DSM valida el
 * `_sid` desde la URL (no desde el cuerpo del formulario) antes de procesar el
 * multipart — mandarlo solo en el form regresa "código 119: sesión no encontrada"
 * aunque la sesión sea válida (confirmado: CreateFolder sí acepta `_sid` en el cuerpo,
 * Upload no).
 */
async function uploadFile(nasUrl, sid, folderPath, fileName, buffer, mimeType) {
  const form = new FormData();
  form.append('path', folderPath);
  form.append('create_parents', 'true');
  form.append('overwrite', 'false');
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), fileName);

  const url = `${nasUrl}/webapi/entry.cgi?api=SYNO.FileStation.Upload&version=2&method=upload&_sid=${sid}`;
  const data = await fetchJson(url, { method: 'POST', body: form }, 'subir archivo');
  if (!data.success) {
    throw new Error(`No se pudo subir el archivo al NAS (código ${data.error?.code}).`);
  }
  return `${folderPath}/${fileName}`;
}

/**
 * Crea un link para compartir el archivo. La llamada a la API va por `nasUrl` (local,
 * `http://localhost:5000`), pero el link que se devuelve se construye con `publicUrl`
 * (el dominio de QuickConnect) — el que abrirá la gente en su navegador NO está dentro
 * del NAS, así que un link `http://localhost:5000/sharing/...` no les serviría de nada.
 */
async function createShareLink(nasUrl, sid, filePath, publicUrl) {
  const data = await entryPost(nasUrl, sid, {
    api: 'SYNO.FileStation.Sharing',
    version: '3',
    method: 'create',
    path: JSON.stringify([filePath]),
  }, 'crear link para compartir');
  if (!data.success || !data.data?.links?.[0]?.id) {
    throw new Error(`No se pudo crear el link para compartir (código ${data.error?.code}).`);
  }
  return `${publicUrl}/sharing/${data.data.links[0].id}`;
}

/** Borra un archivo — "fire and forget" (no se espera a que termine la tarea async de DSM). */
async function deleteFile(nasUrl, sid, filePath) {
  const data = await entryPost(nasUrl, sid, {
    api: 'SYNO.FileStation.Delete',
    version: '2',
    method: 'start',
    path: JSON.stringify([filePath]),
  }, 'borrar archivo');
  if (!data.success) {
    throw new Error(`No se pudo borrar el archivo del NAS (código ${data.error?.code}).`);
  }
}

module.exports = { login, logout, listFolder, createFolder, ensureFolder, uploadFile, createShareLink, deleteFile };
