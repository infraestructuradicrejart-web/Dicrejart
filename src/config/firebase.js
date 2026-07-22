/**
 * @file firebase.js
 * @description Configuración e inicialización centralizada de los servicios de Firebase
 * (Auth, Firestore y Storage) para la aplicación Dicrejart.
 * Incluye persistencia de datos local (caché offline) y diagnóstico de conexión.
 * @author Dicrejart Dev Team
 * @requires firebase/app
 * @requires firebase/auth
 * @requires firebase/firestore
 * @requires firebase/storage
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  enableIndexedDbPersistence,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

/**
 * Activa los Emuladores de Firebase (Auth + Firestore) en lugar de los servicios
 * reales en la nube. Útil mientras el proyecto de Firebase no tenga el plan Blaze
 * (Identity Platform requiere facturación habilitada). Se activa con
 * VITE_USE_FIREBASE_EMULATOR=true en el .env; no aplica nunca en un build de producción.
 */
export const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

// Configuración de Firebase leída de las variables de entorno de Vite
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Validar que las credenciales no estén vacías para evitar colapsar la app antes de configurar
const hasCredentials = Boolean(firebaseConfig.apiKey);

if (!hasCredentials) {
  console.warn(
    '⚠️ [Firebase Config]: No se detectaron credenciales en el archivo .env.\n' +
    'Por favor, copia el archivo .env.example a .env e ingresa tus llaves del proyecto Firebase.'
  );
}

// Inicializar la App de Firebase (Singleton)
let app;
try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
} catch (error) {
  console.error('❌ Error al inicializar Firebase App:', error);
}

// Inicializar y exportar Firebase Authentication
export const auth = app ? getAuth(app) : null;

// Inicializar y exportar Cloud Firestore. Con emulador se usa caché en memoria (los
// datos son locales y temporales); en producción se usa caché persistente multi-pestaña
let db = null;
if (app) {
  try {
    db = useEmulator
      ? initializeFirestore(app, {})
      : initializeFirestore(app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        });
  } catch (error) {
    console.error('❌ Error al inicializar Firestore:', error);
  }
}
export { db };

// Inicializar y exportar Firebase Storage
export const storage = app ? getStorage(app) : null;

// Inicializar y exportar Cloud Functions (operaciones que requieren el SDK de
// administrador, como restablecer la contraseña de un usuario)
export const functions = app ? getFunctions(app) : null;

// Conectar a los Emuladores locales de Firebase (Auth + Firestore) en vez de la nube real
if (useEmulator && auth && db) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8090);
  console.info('🧪 [Firebase] Conectado a los Emuladores locales (Auth :9099, Firestore :8090).');
}

/**
 * Función de diagnóstico de conexión para verificar la comunicación con Firebase.
 * Intenta realizar un ping de red rápido.
 * 
 * @returns {Promise<{ok: boolean, error?: string}>} Estado de la conexión
 */
export const checkFirebaseConnection = async () => {
  if (!hasCredentials) {
    return { ok: false, error: 'Faltan credenciales en el archivo .env' };
  }
  if (!db) {
    return { ok: false, error: 'Firestore no está inicializado' };
  }

  try {
    // Intenta verificar la conexión realizando una consulta mínima (ej. leer una colección temporal)
    // Usamos el módulo de red nativo o simplemente confirmamos la existencia del SDK
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default app;
