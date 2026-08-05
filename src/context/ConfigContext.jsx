/**
 * @file ConfigContext.jsx
 * @description Contexto global de configuración de la aplicación Dicrejart. Administra
 * los límites dinámicos de cuántos registros recientes se mantienen en vivo (en memoria
 * del navegador) para las colecciones tipo bitácora (historial de producción,
 * inspecciones, evaluaciones, actividades, requisiciones, movimientos de personal y
 * solicitudes de materiales a Almacén), y
 * la configuración general (Modo Mantenimiento, alertas de calidad automáticas y
 * tolerancia de calidad exigida), todo configurable por el Admin desde AdminPage.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/firestore
 */

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import PropTypes from 'prop-types';
import { doc, setDoc, collection, query, orderBy, limit as fbLimit, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { AuthContext } from './AuthContext';
import { logAudit } from '../utils/auditLog';

export const ConfigContext = createContext(null);

/**
 * Valores por defecto de los límites, usados mientras el documento de configuración
 * todavía no existe en Firestore (primera vez que corre la app) o mientras carga.
 */
export const DEFAULT_LIMITS = {
  historialProduccionLimit: 5,
  inspeccionesLimit: 5,
  evaluacionesLimit: 50,
  actividadesLimit: 5,
  requisicionesLimit: 5,
  movimientosPersonalLimit: 5,
  horasExtraLimit: 50,
  auditLogLimit: 100,
  materialesLimit: 20,
};

/**
 * Valores por defecto de la configuración general (Modo Mantenimiento, alertas de
 * calidad automáticas y tolerancia de calidad exigida), editables por el Admin desde
 * AdminPage y persistidos en `config/general`.
 */
export const DEFAULT_GENERAL_CONFIG = {
  maintenanceMode: false,
  autoQualityAlerts: true,
  qualityTolerance: 90,
  emailRH: '',
  horaNotificacionRH: '10:00',
  notificarFaltasRH: true,
  lastRHNotificationDate: '',
};

export const ConfigProvider = ({ children }) => {
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [generalConfig, setGeneralConfig] = useState(DEFAULT_GENERAL_CONFIG);
  const [auditLog, setAuditLog] = useState([]);

  const { user } = useContext(AuthContext) || {};

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  useEffect(() => {
    if (!db || !auth) return;

    let unsubscribers = [];

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubscribers.forEach((unsub) => unsub());
      unsubscribers = [];

      if (!user) {
        setLimits(DEFAULT_LIMITS);
        setGeneralConfig(DEFAULT_GENERAL_CONFIG);
        return;
      }

      unsubscribers.push(
        onSnapshot(doc(db, 'config', 'limites'), (snap) => {
          setLimits({ ...DEFAULT_LIMITS, ...(snap.exists() ? snap.data() : {}) });
        })
      );

      unsubscribers.push(
        onSnapshot(doc(db, 'config', 'general'), (snap) => {
          setGeneralConfig({ ...DEFAULT_GENERAL_CONFIG, ...(snap.exists() ? snap.data() : {}) });
        })
      );
    });

    return () => {
      unsubAuth();
      unsubscribers.forEach((unsub) => unsub());
    };
  }, []);

  // ============================================
  // BITÁCORA DE AUDITORÍA (solo Admin)
  // ============================================
  // Se suscribe únicamente si el usuario en sesión es Admin: evita que cada usuario
  // no-Admin reciba un error de permisos en consola en cada sesión (la regla de
  // Firestore ya rechazaría la lectura de todos modos, esto solo evita el ruido).
  useEffect(() => {
    if (!db || !user || user.roleType !== 'admin') {
      setAuditLog([]);
      return;
    }

    const q = query(collection(db, 'audit_log'), orderBy('timestamp', 'desc'), fbLimit(limits.auditLogLimit));
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach((doc) => list.push(doc.data()));
      setAuditLog(list);
    });

    return () => unsub();
  }, [user, limits.auditLogLimit]);

  /**
   * Actualiza un límite (Admin). Crea el documento de configuración si todavía no existe.
   */
  const updateLimit = useCallback(async (field, value) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const numericValue = Math.max(1, Number(value) || 1);
    try {
      await setDoc(doc(db, 'config', 'limites'), { [field]: numericValue }, { merge: true });
      logAudit({ user, module: 'config', action: 'Cambió un límite de historial', details: `${field} = ${numericValue}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar límite de configuración:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Actualiza un campo de la configuración general (Modo Mantenimiento, alertas de
   * calidad automáticas o tolerancia de calidad exigida). Crea el documento si todavía
   * no existe.
   */
  const updateGeneralConfig = useCallback(async (field, value) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    try {
      await setDoc(doc(db, 'config', 'general'), { [field]: value }, { merge: true });
      logAudit({ user, module: 'config', action: 'Cambió la configuración general', details: `${field} = ${value}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al actualizar configuración general:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  const value = useMemo(
    () => ({ limits, updateLimit, generalConfig, updateGeneralConfig, auditLog }),
    [limits, updateLimit, generalConfig, updateGeneralConfig, auditLog]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
};

ConfigProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
