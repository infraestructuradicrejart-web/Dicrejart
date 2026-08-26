/**
 * @file index.js
 * @description Agente que corre DENTRO del NAS Synology (Programador de Tareas de DSM,
 * cada 5 minutos) — revisa `nasMigrationQueue` en Firestore y sube/borra los archivos
 * pendientes directo en el NAS por su API local (http://localhost:5000), sin depender
 * de QuickConnect (confirmado: QuickConnect necesita un navegador real ejecutando su
 * JavaScript de negociación, no sirve para llamadas servidor-a-servidor). Es un "run and
 * exit" — no un proceso de fondo, así lo espera el Programador de Tareas de DSM.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const sc = require('./synologyClient');

/** Carga variables de un archivo .env sencillo, sin depender de ningún paquete de npm. */
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  });
}
loadEnv(path.join(__dirname, '.env'));

const NAS_LOCAL_URL = process.env.NAS_LOCAL_URL || 'http://localhost:5000';
const NAS_PUBLIC_URL = process.env.NAS_PUBLIC_URL;
const NAS_USER = process.env.NAS_USER;
const NAS_PASS = process.env.NAS_PASS;
const NAS_ROOT_PATH = process.env.NAS_ROOT_PATH || '/evidencias';
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET;
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json');

if (!NAS_PUBLIC_URL || !NAS_USER || !NAS_PASS || !STORAGE_BUCKET) {
  console.error('Falta configuración en .env (NAS_PUBLIC_URL, NAS_USER, NAS_PASS, FIREBASE_STORAGE_BUCKET son obligatorios). Ver .env.example.');
  process.exit(1);
}
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`No se encontró la clave de cuenta de servicio en: ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))),
  storageBucket: STORAGE_BUCKET,
});
const db = admin.firestore();

/** Quita caracteres inválidos en rutas de Windows/Synology; conserva acentos/espacios (son carpetas que la gente navega a mano). */
const sanitizeFolderName = (name) =>
  String(name || 'Sin nombre').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120) || 'Sin nombre';
const sanitizeFileName = (name) =>
  String(name || 'archivo').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 150) || 'archivo';

/** Lee la ruta ya cacheada de una carpeta NAS, si ya se resolvió antes. */
const getCachedNasFolder = (docData, category, areaId) => {
  const m = docData?.nasFolderPaths || {};
  if (category === 'fabricacion') return m.fabricacion?.[areaId || 'general'] || null;
  return m[category] || null;
};

/** Campo(s) a actualizar en Firestore para cachear una ruta NAS recién resuelta. */
const buildNasFolderCacheUpdate = (category, areaId, folderPath) =>
  category === 'fabricacion'
    ? { [`nasFolderPaths.fabricacion.${areaId || 'general'}`]: folderPath }
    : { [`nasFolderPaths.${category}`]: folderPath };

/**
 * Resuelve (y cachea) la carpeta del NAS donde debe ir un archivo — primer nivel por
 * categoría (Calidad / nombre del Área / Diseño y Planos), segundo nivel por Juego (o
 * Proyecto si no hay Juego). Si ya se resolvió antes para ese Juego/Proyecto+categoría,
 * se reutiliza sin volver a tocar el NAS — nunca duplica una carpeta ya creada.
 */
async function resolveNasFolder(sid, category, ctx) {
  const { areaId, areaName, gameId, gameName, projectId, projectName } = ctx || {};

  const cacheDocRef = gameId
    ? db.collection('juegos').doc(gameId)
    : projectId
    ? db.collection('proyectos').doc(projectId)
    : null;

  if (cacheDocRef) {
    const snap = await cacheDocRef.get();
    const cached = getCachedNasFolder(snap.data(), category, areaId);
    if (cached) return cached;
  }

  const bucketName =
    category === 'calidad' ? 'Calidad' : category === 'diseno' ? 'Diseño y Planos' : (areaName || areaId || 'Sin Área');
  const subFolderName = gameId
    ? sanitizeFolderName(gameName || gameId)
    : projectId
    ? sanitizeFolderName(`Proyecto - ${projectName || projectId}`)
    : 'Sin Clasificar';

  const bucketPath = await sc.ensureFolder(NAS_LOCAL_URL, sid, NAS_ROOT_PATH, sanitizeFolderName(bucketName));
  const finalPath = await sc.ensureFolder(NAS_LOCAL_URL, sid, bucketPath, subFolderName);

  if (cacheDocRef) {
    await cacheDocRef.update(buildNasFolderCacheUpdate(category, areaId, finalPath)).catch((e) => {
      console.warn('No se pudo cachear la ruta NAS (no crítico):', e.message);
    });
  }

  return finalPath;
}

/** Aplica la URL ya migrada al NAS sobre el registro real (Actividad, veredicto de Auditoría por Juego+Área o por Proyecto). */
async function applyMigratedNasUrl(targetType, targetRef, url, nasPath) {
  if (targetType === 'actividad') {
    await db.collection('actividades').doc(targetRef.activityId).update({ evidenceLink: url, evidenceNasPath: nasPath });
  } else if (targetType === 'auditVerdict') {
    await db.collection('juegos').doc(targetRef.gameId).update({
      [`qualityVerdict.${targetRef.areaId}.evidenceLink`]: url,
      [`qualityVerdict.${targetRef.areaId}.evidenceNasPath`]: nasPath,
    });
  } else if (targetType === 'auditVerdictProject') {
    await db.collection('proyectos').doc(targetRef.projectId).update({
      'qualityAuditProject.evidenceLink': url,
      'qualityAuditProject.evidenceNasPath': nasPath,
    });
  } else if (targetType === 'recursoNode') {
    const lienzoRef = db.collection('lienzos').doc(targetRef.lienzoId);
    const snap = await lienzoRef.get();
    if (!snap.exists) return;
    const nodes = snap.data().nodes || [];
    const nextNodes = nodes.map((n) =>
      n.id !== targetRef.nodeId
        ? n
        : { ...n, draftFields: { ...n.draftFields, fileData: { ...n.draftFields?.fileData, url, nasPath, storagePath: null } } }
    );
    await lienzoRef.update({ nodes: nextNodes });
  }
}

async function processUploadJob(sid, docSnap, item) {
  const fileRes = await fetch(item.firebaseUrl);
  if (!fileRes.ok) throw new Error(`No se pudo descargar de Firebase Storage (HTTP ${fileRes.status})`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  const folderPath = await resolveNasFolder(sid, item.category, item);
  const finalName = `${Date.now()}_${sanitizeFileName(item.fileName)}`;
  const filePath = await sc.uploadFile(NAS_LOCAL_URL, sid, folderPath, finalName, buffer, item.mimeType);
  const url = await sc.createShareLink(NAS_LOCAL_URL, sid, filePath, NAS_PUBLIC_URL);

  await applyMigratedNasUrl(item.targetType, item.targetRef, url, filePath);

  if (item.firebaseStoragePath) {
    await admin.storage().bucket().file(item.firebaseStoragePath).delete().catch(() => {});
  }
  await docSnap.ref.delete();
  console.log(`✓ Migrado al NAS: ${item.fileName} -> ${filePath}`);
}

async function processDeleteJob(sid, docSnap, item) {
  await sc.deleteFile(NAS_LOCAL_URL, sid, item.nasPath);
  await docSnap.ref.delete();
  console.log(`✓ Borrado del NAS: ${item.nasPath}`);
}

async function run() {
  const pendingSnap = await db.collection('nasMigrationQueue').limit(20).get();
  if (pendingSnap.empty) {
    console.log('Sin trabajos pendientes.');
    return;
  }

  let sid = null;
  try {
    sid = await sc.login(NAS_LOCAL_URL, NAS_USER, NAS_PASS);
    for (const docSnap of pendingSnap.docs) {
      const item = docSnap.data();
      try {
        if (item.action === 'delete') {
          await processDeleteJob(sid, docSnap, item);
        } else {
          await processUploadJob(sid, docSnap, item);
        }
      } catch (itemError) {
        console.error(`✗ Error procesando ${docSnap.id}:`, itemError.message);
        await docSnap.ref
          .update({ attempts: admin.firestore.FieldValue.increment(1), lastError: itemError.message, lastAttemptAt: new Date().toISOString() })
          .catch(() => {});
      }
    }
  } finally {
    if (sid) await sc.logout(NAS_LOCAL_URL, sid);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error general del agente:', err);
    process.exit(1);
  });
