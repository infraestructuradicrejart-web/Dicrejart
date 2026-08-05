/**
 * @file MaterialesContext.jsx
 * @description Contexto de solicitudes de materiales que un área de producción le pide
 * a Almacén (interno, sin proveedores externos ni pago de por medio — para eso existe
 * Compras). Flujo de dos pasos de entrega (para que quede claro quién hizo qué y cuándo):
 * 'pendiente' -> ('lista' | 'rechazada' | 'cancelada'), y 'lista' -> 'recibida' cuando el
 * área confirma que ya recogió el material. Por ahora no verifica existencias reales de
 * Almacén (Dicrejart no tiene inventario propio todavía) — es solo captura de la
 * solicitud y seguimiento de su estatus. Las notificaciones por correo (nueva solicitud a
 * Almacén, lista para recoger o rechazada al solicitante) viven en functions/index.js
 * (onSolicitudMaterialCreated/onSolicitudMaterialUpdated).
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/firestore
 */

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import PropTypes from 'prop-types';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, runTransaction } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { AuthContext } from './AuthContext';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { logAudit } from '../utils/auditLog';

export const MaterialesContext = createContext(null);

/**
 * Reclama el siguiente folio consecutivo (empieza en 1) de forma atómica en una
 * transacción — el id real del documento sigue siendo `MAT-{timestamp}` (garantiza que
 * nunca choque aunque dos solicitudes se creen en el mismo milisegundo); `folio` es solo
 * el número consecutivo para mostrar/ordenar/exportar, guardado en config/materialesFolio.
 */
const getNextMaterialFolio = async () => {
  const counterRef = doc(db, 'config', 'materialesFolio');
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = snap.exists() ? (snap.data().next || 1) : 1;
    tx.set(counterRef, { next: next + 1 }, { merge: true });
    return next;
  });
};

export const MaterialesProvider = ({ children }) => {
  const [solicitudesMateriales, setSolicitudesMateriales] = useState([]);

  const { user } = useContext(AuthContext) || {};
  const { limits } = useContext(ConfigContext) || {};
  const materialesLimit = limits?.materialesLimit || DEFAULT_LIMITS.materialesLimit;

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  useEffect(() => {
    if (!db || !auth) return;

    let unsubSolicitudesMateriales = null;

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (unsubSolicitudesMateriales) unsubSolicitudesMateriales();

      if (!firebaseUser) {
        setSolicitudesMateriales([]);
        return;
      }

      unsubSolicitudesMateriales = onSnapshot(
        query(collection(db, 'solicitudes_materiales'), orderBy('createdAt', 'desc'), limit(materialesLimit)),
        (snapshot) => {
          const list = [];
          snapshot.forEach((docSnap) => list.push(docSnap.data()));
          setSolicitudesMateriales(list);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubSolicitudesMateriales) unsubSolicitudesMateriales();
    };
  }, [materialesLimit]);

  /**
   * Un área solicita materiales a Almacén — solo captura la solicitud, no verifica
   * existencias (Dicrejart no tiene inventario propio todavía).
   */
  const solicitarMateriales = useCallback(async ({ areaId, items, justification, priority, gameId, gameName }) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    if (!areaId) return { ok: false, error: 'Falta el área solicitante.' };
    const validItems = (items || []).filter((it) => it.name?.trim() && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      return { ok: false, error: 'Agrega al menos un material con cantidad mayor a 0.' };
    }
    if (!justification?.trim()) {
      return { ok: false, error: 'Indica la justificación de la solicitud.' };
    }

    const id = `MAT-${Date.now()}`;
    let folio;
    try {
      folio = await getNextMaterialFolio();
    } catch (error) {
      console.error('Error al reclamar folio de solicitud de materiales:', error);
      return { ok: false, error: 'No se pudo generar el folio de la solicitud. Intenta de nuevo.' };
    }

    const nuevaSolicitud = {
      id,
      folio,
      status: 'pendiente',
      areaId,
      items: validItems.map((it) => ({
        name: it.name.trim(),
        itemId: it.itemId || null,
        quantity: Number(it.quantity),
        unit: it.unit?.trim() || '',
      })),
      justification: justification.trim(),
      priority: priority === 'urgente' ? 'urgente' : 'normal',
      gameId: gameId || null,
      gameName: gameName || null,
      requestedBy: user?.name || 'Usuario',
      requestedByUserId: user?.id || null,
      requestedByRole: user?.roleType || null,
      createdAt: new Date().toISOString(),
      reviewedBy: null,
      reviewedByRole: null,
      reviewedAt: null,
      reviewNotes: '',
    };

    try {
      await setDoc(doc(db, 'solicitudes_materiales', id), nuevaSolicitud);
      logAudit({
        user,
        module: 'produccion',
        action: 'Solicitó materiales a Almacén',
        details: `${areaId}: ${validItems.map((it) => `${it.quantity} ${it.unit} ${it.name}`).join(', ')}`,
      });
      return { ok: true, id };
    } catch (error) {
      console.error('Error al solicitar materiales:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Almacén marca que ya juntó los materiales y están listos para que el área los
   * recoja — todavía no es la confirmación final, esa la da el área con
   * confirmarRecepcionMateriales cuando de verdad los tenga en sus manos.
   */
  const marcarMaterialesListos = useCallback(async (solicitudId, notes = '') => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    try {
      await updateDoc(doc(db, 'solicitudes_materiales', solicitudId), {
        status: 'lista',
        reviewedBy: user?.name || 'Almacén',
        reviewedByRole: user?.roleType || null,
        reviewedAt: new Date().toISOString(),
        reviewNotes: notes || '',
      });
      logAudit({ user, module: 'produccion', action: 'Marcó materiales como listos para recoger', details: solicitudId });
      return { ok: true };
    } catch (error) {
      console.error('Error al marcar materiales como listos:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * El área solicitante confirma que ya recogió/recibió el material — cierra el ciclo.
   */
  const confirmarRecepcionMateriales = useCallback(async (solicitudId) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    try {
      await updateDoc(doc(db, 'solicitudes_materiales', solicitudId), {
        status: 'recibida',
        receivedBy: user?.name || 'Usuario',
        receivedAt: new Date().toISOString(),
      });
      logAudit({ user, module: 'produccion', action: 'Confirmó recepción de materiales', details: solicitudId });
      return { ok: true };
    } catch (error) {
      console.error('Error al confirmar recepción de materiales:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Almacén rechaza una solicitud de materiales (motivo obligatorio).
   */
  const rechazarSolicitudMateriales = useCallback(async (solicitudId, notes) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    if (!notes?.trim()) return { ok: false, error: 'Indica el motivo del rechazo.' };
    try {
      await updateDoc(doc(db, 'solicitudes_materiales', solicitudId), {
        status: 'rechazada',
        reviewedBy: user?.name || 'Almacén',
        reviewedByRole: user?.roleType || null,
        reviewedAt: new Date().toISOString(),
        reviewNotes: notes.trim(),
      });
      logAudit({ user, module: 'produccion', action: 'Rechazó solicitud de materiales', details: `${solicitudId}: ${notes.trim()}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al rechazar solicitud de materiales:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * El área solicitante retira su propia solicitud mientras siga 'pendiente'.
   */
  const cancelarSolicitudMateriales = useCallback(async (solicitudId) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    try {
      await updateDoc(doc(db, 'solicitudes_materiales', solicitudId), {
        status: 'cancelada',
        reviewedBy: user?.name || 'Usuario',
        reviewedByRole: user?.roleType || null,
        reviewedAt: new Date().toISOString(),
      });
      logAudit({ user, module: 'produccion', action: 'Canceló solicitud de materiales', details: solicitudId });
      return { ok: true };
    } catch (error) {
      console.error('Error al cancelar solicitud de materiales:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Corrige y reenvía una solicitud RECHAZADA (mismo folio, vuelve a 'pendiente' con la
   * bitácora de revisión limpia) — mismo patrón que "Corregir y Reenviar" en Compras.
   */
  const modificarSolicitudMateriales = useCallback(async (solicitudId, { items, justification, priority, gameId, gameName }) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    const sol = solicitudesMateriales.find((s) => s.id === solicitudId);
    if (!sol) return { ok: false, error: 'Solicitud no encontrada.' };
    if (sol.status !== 'rechazada') {
      return { ok: false, error: 'Solo se puede corregir una solicitud rechazada.' };
    }
    const validItems = (items || []).filter((it) => it.name?.trim() && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      return { ok: false, error: 'Agrega al menos un material con cantidad mayor a 0.' };
    }
    if (!justification?.trim()) {
      return { ok: false, error: 'Indica la justificación de la solicitud.' };
    }

    try {
      await updateDoc(doc(db, 'solicitudes_materiales', solicitudId), {
        status: 'pendiente',
        items: validItems.map((it) => ({
          name: it.name.trim(),
          itemId: it.itemId || null,
          quantity: Number(it.quantity),
          unit: it.unit?.trim() || '',
        })),
        justification: justification.trim(),
        priority: priority === 'urgente' ? 'urgente' : 'normal',
        gameId: gameId || null,
        gameName: gameName || null,
        reviewedBy: null,
        reviewedByRole: null,
        reviewedAt: null,
        reviewNotes: '',
      });
      logAudit({ user, module: 'produccion', action: 'Corrigió y reenvió solicitud de materiales', details: solicitudId });
      return { ok: true };
    } catch (error) {
      console.error('Error al corregir solicitud de materiales:', error);
      return { ok: false, error: error.message };
    }
  }, [solicitudesMateriales, user]);

  /**
   * Elimina una solicitud de materiales — exclusivo de Admin (ver gate en la UI y en
   * firestore.rules), sin restricción de estatus.
   */
  const eliminarSolicitudMateriales = useCallback(async (solicitudId) => {
    if (!db) return { ok: false, error: 'Firestore no inicializado' };
    try {
      await deleteDoc(doc(db, 'solicitudes_materiales', solicitudId));
      logAudit({ user, module: 'produccion', action: 'Eliminó una solicitud de materiales', details: solicitudId });
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar solicitud de materiales:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  const value = useMemo(
    () => ({
      solicitudesMateriales,
      solicitarMateriales,
      marcarMaterialesListos,
      confirmarRecepcionMateriales,
      rechazarSolicitudMateriales,
      cancelarSolicitudMateriales,
      modificarSolicitudMateriales,
      eliminarSolicitudMateriales,
    }),
    [
      solicitudesMateriales,
      solicitarMateriales,
      marcarMaterialesListos,
      confirmarRecepcionMateriales,
      rechazarSolicitudMateriales,
      cancelarSolicitudMateriales,
      modificarSolicitudMateriales,
      eliminarSolicitudMateriales,
    ]
  );

  return <MaterialesContext.Provider value={value}>{children}</MaterialesContext.Provider>;
};

MaterialesProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
