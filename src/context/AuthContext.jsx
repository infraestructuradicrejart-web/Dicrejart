/**
 * @file AuthContext.jsx
 * @description Contexto de autenticación de la aplicación Dicrejart.
 * Conectado directamente a Firebase Authentication y Cloud Firestore.
 * Provee inicio de sesión, creación de usuarios secundaria (sin desloguear admin)
 * y verificación de sistema vacío para bootstrapping.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/app
 * @requires firebase/auth
 * @requires firebase/firestore
 */

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  getAuth,
  connectAuthEmulator
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  collection,
  query,
  limit, 
  onSnapshot 
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, useEmulator } from '../config/firebase';
import { logAudit } from '../utils/auditLog';

export const AuthContext = createContext(null);

// Duración máxima de una sesión: 12 horas desde que se inició sesión, sin importar
// cuánta actividad haya (esto es independiente del bloqueo por inactividad). Se guarda
// en localStorage (no sessionStorage) para que sobreviva a recargas de página, pero se
// borra explícitamente al cerrar sesión.
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const SESSION_STARTED_AT_KEY = 'dicrejart_session_started_at';

/**
 * Auxiliar para traducir errores crudos de Firebase a mensajes comprensibles para el usuario
 */
const translateFirebaseError = (error) => {
  const code = error?.code || error?.message || '';
  if (code.includes('auth/operation-not-allowed')) {
    return 'El proveedor de Correo y Contraseña está desactivado en Firebase Auth. Actívalo en la pestaña "Sign-in method" de la consola de Firebase.';
  }
  if (code.includes('auth/email-already-in-use')) {
    return 'El correo electrónico ingresado ya está registrado. Si perdiste tu contraseña o el perfil no se guardó, puedes borrar el usuario desde la sección "Users" en la consola de Firebase Auth y volver a intentar.';
  }
  if (code.includes('auth/invalid-email')) {
    return 'El correo electrónico ingresado no tiene un formato válido.';
  }
  if (code.includes('auth/weak-password')) {
    return 'La contraseña es muy corta o débil. Debe tener al menos 6 caracteres.';
  }
  if (code.includes('permission-denied')) {
    return 'Permiso denegado en Firestore. Asegúrate de haber creado la base de datos de Cloud Firestore (en modo de prueba o con reglas de lectura/escritura abiertas) en la consola de Firebase.';
  }
  if (code.includes('unavailable')) {
    return 'No se pudo establecer conexión con los servidores de Firebase. Verifica tu conexión a internet o los valores del archivo .env.';
  }
  return error.message || 'Ocurrió un error inesperado al conectar con Firebase.';
};

/**
 * Configuración de una instancia secundaria de Firebase (misma app, distinta sesión de
 * Auth) usada para crear o verificar credenciales de OTRO usuario sin cerrar la sesión
 * de quien está usando la app en ese momento.
 */
const getSecondaryFirebaseConfig = () => ({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

/**
 * Auxiliar para generar nombres de roles legibles en Firestore
 */
const computeRoleLabel = (roleType, areaId, areaIds) => {
  if (roleType === 'admin') return 'Administrador';
  if (roleType === 'calidad') return 'Inspector de Calidad';
  if (roleType === 'encargado-area') {
    return `Encargado de ${areaId || 'Área'}`;
  }
  if (roleType === 'supervisor-area') {
    return `Supervisor de ${(areaIds || []).join(' y ')}`;
  }
  if (roleType === 'direccion') return 'Dirección';
  if (roleType === 'compras') return 'Compras';
  return 'Usuario';
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [users, setUsers] = useState([]);
  const [isSystemEmpty, setIsSystemEmpty] = useState(false);

  // ============================================
  // EFECTOS - ESCUCHAS EN TIEMPO REAL
  // ============================================

  // 1. Escuchar el estado de autenticación de Firebase. La escucha de la colección
  // "users" (para el panel de Admin y el chequeo de "sistema vacío") se anida aquí
  // mismo y se (re)suscribe con cada cambio de sesión: intentarlo de una vez desde un
  // efecto separado fallaría por falta de permisos antes del login, sin reintentarlo después.
  useEffect(() => {
    if (!auth || !db) {
      setLoading(false);
      return;
    }

    let unsubUsers = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);

      if (unsubUsers) {
        unsubUsers();
        unsubUsers = null;
      }

      if (firebaseUser) {
        try {
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setUser(docSnap.data());
          } else {
            console.warn('No se encontró el documento de perfil en Firestore para el UID:', firebaseUser.uid);
            setUser({
              id: firebaseUser.uid,
              email: firebaseUser.email,
              name: firebaseUser.displayName || 'Usuario de Firebase',
              roleType: 'admin', // Rol fallback de emergencia
              status: 'activo'
            });
          }
        } catch (error) {
          console.error('Error al recuperar perfil de usuario:', error);
          setUser(null);
        }

        unsubUsers = onSnapshot(
          collection(db, 'users'),
          (snapshot) => {
            const list = [];
            snapshot.forEach((doc) => {
              list.push({ id: doc.id, ...doc.data() });
            });
            setUsers(list);
          },
          (error) => {
            console.warn('Fallo al leer la colección de usuarios:', error);
          }
        );
      } else {
        setUser(null);
        setUsers([]);
      }

      setLoading(false);
    });

    // Antes de iniciar sesión no hay forma de leer "users" directamente (la regla exige
    // auth), así que se verifica si el sistema está vacío a través de una Cloud Function
    // pública que solo regresa un booleano (nunca datos reales de usuarios).
    fetch('/api/checkSystemEmpty', { method: 'POST' })
      .then((res) => res.json())
      .then((data) => setIsSystemEmpty(Boolean(data.empty)))
      .catch(() => setIsSystemEmpty(false));

    return () => {
      unsubscribe();
      if (unsubUsers) unsubUsers();
    };
  }, []);

  // ============================================
  // ACCIONES DE SESIÓN
  // ============================================

  /**
   * Inicia sesión en Firebase Auth y valida el perfil en Firestore
   */
  const login = useCallback(async (email, password) => {
    if (!auth || !db) {
      setAuthError('Firebase no está inicializado.');
      return false;
    }

    try {
      setAuthError('');
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Obtener perfil en Firestore
      const docSnap = await getDoc(doc(db, 'users', uid));
      if (!docSnap.exists()) {
        setAuthError('No se encontró el perfil de usuario en la base de datos.');
        await signOut(auth);
        return false;
      }

      const profile = docSnap.data();
      if (profile.status !== 'activo') {
        setAuthError('Este usuario está inactivo. Contacta al administrador.');
        await signOut(auth);
        return false;
      }

      // Se registra aquí (login real, contraseña verificada) y no en el listener
      // onAuthStateChanged, que también se dispara al restaurar sesión en cada recarga.
      logAudit({
        user: { ...profile, id: profile.id || uid },
        module: 'auth',
        action: 'Inició sesión',
        details: email,
      });

      // Arranca el conteo de las 12 horas de duración máxima de la sesión (ver
      // SESSION_DURATION_MS) desde este login real, no desde una restauración de sesión.
      localStorage.setItem(SESSION_STARTED_AT_KEY, Date.now().toString());

      return true;
    } catch (error) {
      console.error('Error de login en Firebase:', error);
      let msg = 'Error de inicio de sesión.';
      if (
        error.code === 'auth/wrong-password' || 
        error.code === 'auth/user-not-found' || 
        error.code === 'auth/invalid-credential'
      ) {
        msg = 'Correo o contraseña incorrectos. Verifica tus credenciales.';
      } else if (error.code === 'auth/invalid-email') {
        msg = 'Formato de correo electrónico no válido.';
      }
      setAuthError(msg);
      return false;
    }
  }, []);

  /**
   * Cierra la sesión activa
   */
  const logout = useCallback(async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      logAudit({ user, module: 'auth', action: 'Cerró sesión', details: user?.email || '' });
      setUser(null);
      setAuthError('');
      localStorage.removeItem(SESSION_STARTED_AT_KEY);
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  }, [user]);

  // Límite absoluto de sesión: 12 horas desde que se inició sesión (ver
  // SESSION_DURATION_MS), sin importar la actividad. Se revisa al restaurar la sesión
  // (recarga de página) y luego cada minuto mientras la pestaña siga abierta.
  useEffect(() => {
    if (!user) return undefined;

    const startedAtRaw = localStorage.getItem(SESSION_STARTED_AT_KEY);
    // Sesión existente de antes de que este límite existiera (o localStorage se limpió
    // sin cerrar sesión): se le concede el beneficio de la duda y se cuenta desde ahora.
    const startedAt = startedAtRaw ? Number(startedAtRaw) : Date.now();
    if (!startedAtRaw) {
      localStorage.setItem(SESSION_STARTED_AT_KEY, startedAt.toString());
    }

    const checkExpiry = () => {
      if (Date.now() - startedAt >= SESSION_DURATION_MS) {
        logout();
      }
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, 60 * 1000);
    return () => clearInterval(interval);
  }, [user, logout]);

  /**
   * Reautentica al usuario en sesión para confirmar su contraseña en operaciones sensibles
   */
  const verifyPassword = useCallback(async (password) => {
    if (!auth || !auth.currentUser) return false;
    const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
    try {
      await reauthenticateWithCredential(auth.currentUser, credential);
      return true;
    } catch (error) {
      console.error('Error al verificar contraseña:', error);
      return false;
    }
  }, []);

  /**
   * Verifica el correo y contraseña de OTRO usuario (no el que tiene la sesión abierta)
   * y confirma que tenga autoridad sobre el área indicada (Admin, Calidad, Encargado de
   * esa área, o Supervisor que la cubre). Se usa para autorizar préstamos/cambios de área de
   * colaboradores con la contraseña real del supervisor/encargado que presta o recibe.
   * Usa una instancia secundaria de Firebase Auth para no cerrar la sesión actual.
   * @param {string} email
   * @param {string} password
   * @param {string} areaId - Área sobre la que debe tener autoridad
   * @returns {Promise<{ok: boolean, name?: string, roleType?: string, error?: string}>}
   */
  const verifyAreaAuthorizer = useCallback(async (email, password, areaId) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };

    const secondaryAppName = `VerifyAreaAuth_${Date.now()}`;
    let secondaryApp;
    try {
      secondaryApp = initializeApp(getSecondaryFirebaseConfig(), secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);
      if (useEmulator) {
        connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
      }

      const credential = await signInWithEmailAndPassword(secondaryAuth, email, password);
      const profileSnap = await getDoc(doc(db, 'users', credential.user.uid));
      if (!profileSnap.exists()) {
        return { ok: false, error: 'No se encontró el perfil de este usuario.' };
      }

      const profile = profileSnap.data();
      if (profile.status !== 'activo') {
        return { ok: false, error: 'Este usuario está inactivo.' };
      }

      const canAuthorize =
        profile.roleType === 'admin' ||
        // Calidad no está atado a una sola área (igual que en canActOnArea de
        // OperariosPage.jsx) — puede autorizar movimientos de cualquier área
        profile.roleType === 'calidad' ||
        (profile.roleType === 'encargado-area' && profile.areaId === areaId) ||
        (profile.roleType === 'supervisor-area' && (profile.areaIds || []).includes(areaId));

      if (!canAuthorize) {
        return { ok: false, error: 'Este usuario no tiene autoridad para autorizar movimientos en esa área.' };
      }

      return { ok: true, name: profile.name, roleType: profile.roleType };
    } catch (error) {
      console.error('Error al verificar autorizador de área:', error);
      let msg = 'Correo o contraseña incorrectos.';
      if (error.code === 'auth/too-many-requests') {
        msg = 'Demasiados intentos fallidos. Espera un momento antes de volver a intentar.';
      }
      return { ok: false, error: msg };
    } finally {
      if (secondaryApp) {
        try {
          await deleteApp(secondaryApp);
        } catch (e) {
          console.error('Error al liberar secondaryApp de verificación:', e);
        }
      }
    }
  }, []);

  /**
   * Registra el primer Administrador del sistema en Firebase Auth y Firestore (Bootstrapping)
   */
  const registerFirstAdmin = useCallback(async (name, email, password) => {
    if (!auth || !db) return { ok: false, error: 'Firebase no inicializado' };

    let createdUser = null;
    try {
      setAuthError('');
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      createdUser = userCredential.user;
      const uid = createdUser.uid;

      const profile = {
        id: uid,
        name,
        email,
        role: 'Administrador',
        roleType: 'admin',
        areaId: null,
        areaIds: [],
        status: 'activo',
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'users', uid), profile);
      setIsSystemEmpty(false);
      setUser(profile);
      logAudit({ user: profile, module: 'auth', action: 'Registró el primer administrador del sistema', details: email });
      localStorage.setItem(SESSION_STARTED_AT_KEY, Date.now().toString());
      return { ok: true };
    } catch (error) {
      console.error('Error al registrar primer administrador:', error);
      // Rollback: Eliminar el usuario de Firebase Auth si falló la escritura en Firestore
      if (createdUser) {
        try {
          await createdUser.delete();
        } catch (deleteError) {
          console.error('Error al realizar rollback de usuario de Auth:', deleteError);
        }
      }
      return { ok: false, error: translateFirebaseError(error) };
    }
  }, []);

  // ============================================
  // GESTIÓN DE COLABORADORES (Panel de Admin)
  // ============================================

  /**
   * Crea un usuario utilizando una instancia secundaria para no interferir con la sesión del Administrador
   */
  const addUser = useCallback(async (data) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };

    const secondaryAppName = `SecondaryAuthApp_${Date.now()}`;
    let secondaryApp;
    let createdUser = null;
    try {
      secondaryApp = initializeApp(getSecondaryFirebaseConfig(), secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);

      // La app secundaria arranca "limpia": si estamos usando el Emulador local,
      // hay que conectarla también, o intentaría crear el usuario en la nube real.
      if (useEmulator) {
        connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
      }

      const credential = await createUserWithEmailAndPassword(secondaryAuth, data.email, data.password);
      createdUser = credential.user;
      const uid = createdUser.uid;

      const profile = {
        id: uid,
        name: data.name,
        email: data.email,
        role: computeRoleLabel(data.roleType, data.areaId, data.areaIds),
        roleType: data.roleType,
        areaId: data.areaId || null,
        areaIds: data.areaIds || [],
        // Solo Diseñador/Arquitecto: id del registro del padrón de Operarios (Diseño)
        // al que se vincula esta cuenta, para filtrar sus tareas asignadas
        operarioId: data.operarioId || null,
        status: data.status || 'activo',
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'users', uid), profile);
      logAudit({ user, module: 'auth', action: 'Creó un usuario', details: `${profile.name} (${profile.email}) — ${profile.role}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al crear usuario secundario:', error);
      // Rollback: Eliminar de Auth si falló escritura en Firestore
      if (createdUser) {
        try {
          await createdUser.delete();
        } catch (deleteError) {
          console.error('Error al realizar rollback de Auth secundario:', deleteError);
        }
      }
      return { ok: false, error: translateFirebaseError(error) };
    } finally {
      if (secondaryApp) {
        try {
          await deleteApp(secondaryApp);
        } catch (e) {
          console.error('Error al liberar secondaryApp:', e);
        }
      }
    }
  }, [user]);

  /**
   * Actualiza el perfil de un usuario en Firestore
   */
  const updateUser = useCallback(async (userId, data) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    try {
      const docRef = doc(db, 'users', userId);
      const updates = {
        name: data.name,
        email: data.email,
        role: computeRoleLabel(data.roleType, data.areaId, data.areaIds),
        roleType: data.roleType,
        areaId: data.areaId || null,
        areaIds: data.areaIds || [],
        operarioId: data.operarioId || null,
        status: data.status,
      };

      await updateDoc(docRef, updates);

      // Si el usuario editado es el actual, refrescar sesión local
      if (user && user.id === userId) {
        setUser((prev) => prev ? { ...prev, ...updates } : null);
      }

      logAudit({ user, module: 'auth', action: 'Editó un usuario', details: `${updates.name} (${updates.email}) — ${updates.role}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar usuario:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Elimina un usuario de Firestore
   */
  const deleteUser = useCallback(async (userId) => {
    if (user && user.id === userId) {
      return { ok: false, error: 'No puedes eliminar tu propio usuario mientras tienes sesión iniciada.' };
    }
    if (!db) return { ok: false, error: 'Firestore no inicializado' };

    try {
      const target = users.find((u) => u.id === userId);
      await deleteDoc(doc(db, 'users', userId));
      logAudit({ user, module: 'auth', action: 'Eliminó un usuario', details: target ? `${target.name} (${target.email})` : userId });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar usuario:', error);
      return { ok: false, error: error.message };
    }
  }, [user, users]);

  /**
   * Restablece la contraseña de otro usuario mediante la Cloud Function
   * `resetUserPassword` (requiere el SDK de administrador, no se puede hacer desde el
   * navegador). La función verifica de nuevo, del lado del servidor, que quien llama
   * sea Admin — esta llamada del cliente es solo la interfaz, no la protección real.
   */
  const resetUserPassword = useCallback(async (userId, newPassword) => {
    if (!functions) return { ok: false, error: 'Firebase Functions no inicializado' };
    try {
      const callable = httpsCallable(functions, 'resetUserPassword');
      await callable({ userId, newPassword });
      const target = users.find((u) => u.id === userId);
      logAudit({ user, module: 'auth', action: 'Restableció la contraseña de un usuario', details: target ? `${target.name} (${target.email})` : userId });
      return { ok: true };
    } catch (error) {
      console.error('Error al restablecer contraseña:', error);
      return { ok: false, error: error.message };
    }
  }, [user, users]);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      authError,
      isSystemEmpty,
      login,
      logout,
      verifyPassword,
      verifyAreaAuthorizer,
      registerFirstAdmin,
      users,
      addUser,
      updateUser,
      deleteUser,
      resetUserPassword,
    }),
    [user, loading, authError, isSystemEmpty, login, logout, verifyPassword, verifyAreaAuthorizer, registerFirstAdmin, users, addUser, updateUser, deleteUser, resetUserPassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
