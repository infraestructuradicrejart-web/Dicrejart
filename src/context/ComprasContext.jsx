/**
 * @file ComprasContext.jsx
 * @description Contexto global del módulo de Requisiciones de Compra de Dicrejart.
 * Conectado en tiempo real con Cloud Firestore.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/firestore
 */

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import PropTypes from 'prop-types';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { ConfigContext, DEFAULT_LIMITS } from './ConfigContext';
import { AuthContext } from './AuthContext';
import { logAudit } from '../utils/auditLog';
import { uploadAttachments, deleteEvidencePhotos } from '../utils/evidenceStorage';

/** Separa un arreglo de adjuntos en los ya subidos ({url,path,name}) y los archivos
 * crudos (File) pendientes de subir — así se sabe cuáles hay que mandar a Storage y
 * cuáles simplemente conservar tal cual. */
const splitAttachments = (items = []) => ({
  existing: items.filter((it) => !(it instanceof File)),
  newFiles: items.filter((it) => it instanceof File),
});

export const ComprasContext = createContext(null);

// Los tokens de aprobación por correo (colección `requisicion_approvals`) se generan
// del lado del servidor, dentro de las Cloud Functions `onRequisicionCreated` /
// `onRequisicionUpdated` (functions/index.js), nunca aquí en el cliente: si el
// navegador pudiera escribir esos documentos, cualquier usuario autenticado podría
// forjar uno con el id de un usuario Dirección real (la colección `users` es de
// lectura pública) y auto-autorizarse cualquier requisición sin que Dirección
// interviniera. Por eso `firestore.rules` bloquea por completo la escritura de esa
// colección desde el cliente — solo el SDK de administrador (backend) puede crearla.

export const ComprasProvider = ({ children }) => {
  const [requisiciones, setRequisiciones] = useState([]);

  const { limits } = useContext(ConfigContext) || {};
  const requisicionesLimit = limits?.requisicionesLimit || DEFAULT_LIMITS.requisicionesLimit;
  const { user } = useContext(AuthContext) || {};

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  // Se espera a onAuthStateChanged y se resuscribe con cada cambio de sesión: este
  // Provider envuelve toda la app (incluida /login), así que suscribirse de inmediato
  // fallaría por falta de permisos antes del login, sin volver a intentarlo después.
  // También se vuelve a suscribir si cambia el límite dinámico configurado por el Admin.
  useEffect(() => {
    if (!db || !auth) return;

    let unsubSnapshot = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubSnapshot) unsubSnapshot();

      if (!user) {
        setRequisiciones([]);
        return;
      }

      unsubSnapshot = onSnapshot(
        query(collection(db, 'requisiciones'), orderBy('createdAt', 'desc'), limit(requisicionesLimit)),
        (snap) => {
          const list = [];
          snap.forEach((doc) => list.push(doc.data()));
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Más recientes primero
          setRequisiciones(list);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubSnapshot) unsubSnapshot();
    };
  }, [requisicionesLimit]);

  /**
   * Crea una nueva requisición de material en Firestore. Los adjuntos (cotización) se
   * suben primero a Firebase Storage — solo se guardan la URL y la ruta en el
   * documento, nunca el archivo completo, porque Firestore tiene un límite de 1 MiB por
   * documento y una sola foto de cotización desde el celular ya lo excede.
   */
  const addRequisicion = useCallback(async (data) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const id = `REQ-${Date.now()}`;
    const { attachments = [], ...restData } = data;

    let uploadedAttachments = [];
    try {
      uploadedAttachments = await uploadAttachments('compras', id, attachments);
    } catch (error) {
      console.error('Error al subir la cotización:', error);
      return { ok: false, error: 'No se pudo subir la cotización (revisa tu conexión). Intenta crear la requisición de nuevo.' };
    }

    const created = {
      id,
      status: 'pendiente',
      attachments: uploadedAttachments,
      paymentDetails: '',
      paymentDetailsFile: [],
      purchaseProof: [],
      reviewNotes: '',
      reviewedBy: null,
      reviewedAt: null,
      purchasedBy: null,
      purchasedAt: null,
      supplier: '',
      cost: null,
      receivedBy: null,
      receivedAt: null,
      createdAt: new Date().toISOString(),
      ...restData,
    };
    try {
      await setDoc(doc(db, 'requisiciones', id), created);
      logAudit({ user, module: 'compras', action: 'Creó una requisición de compra', details: id });
      return { ok: true };
    } catch (error) {
      console.error('Error al registrar requisición en Firestore:', error);
      deleteEvidencePhotos(uploadedAttachments).catch(() => {});
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Dirección autoriza una requisición pendiente
   */
  const authorizeRequisicion = useCallback(async (id, reviewerName, notes) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'requisiciones', id), {
        status: 'autorizada',
        reviewedBy: reviewerName,
        reviewedAt: new Date().toISOString(),
        reviewNotes: notes || 'Autorizada sin observaciones.',
      });
      logAudit({ user, module: 'compras', action: 'Autorizó una requisición de compra', details: `${id} por ${reviewerName}` });
    } catch (error) {
      console.error('Error al autorizar requisición en Firestore:', error);
    }
  }, [user]);

  /**
   * Dirección regresa una requisición señalando un error
   */
  const returnRequisicion = useCallback(async (id, reviewerName, notes) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'requisiciones', id), {
        status: 'regresada',
        reviewedBy: reviewerName,
        reviewedAt: new Date().toISOString(),
        reviewNotes: notes,
      });
      logAudit({ user, module: 'compras', action: 'Regresó una requisición de compra', details: `${id} por ${reviewerName}` });
    } catch (error) {
      console.error('Error al regresar requisición en Firestore:', error);
    }
  }, [user]);

  /**
   * El solicitante corrige y reenvía una requisición regresada. `updates.attachments`
   * puede traer una mezcla de adjuntos ya subidos ({url,path,name}, se conservan tal
   * cual) y archivos nuevos (File, se suben a Storage). Los adjuntos originales que ya
   * no están en la lista final se consideran quitados y se borran de Storage.
   */
  const resubmitRequisicion = useCallback(async (id, updates) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const { attachments = [], ...restUpdates } = updates;
    const { existing, newFiles } = splitAttachments(attachments);

    let uploadedNew = [];
    try {
      uploadedNew = await uploadAttachments('compras', id, newFiles);
    } catch (error) {
      console.error('Error al subir la cotización:', error);
      return { ok: false, error: 'No se pudo subir la cotización nueva (revisa tu conexión). Intenta reenviar de nuevo.' };
    }

    const original = requisiciones.find((r) => r.id === id);
    const removedAttachments = (original?.attachments || []).filter(
      (orig) => orig?.path && !existing.some((e) => e.path === orig.path)
    );

    try {
      await updateDoc(doc(db, 'requisiciones', id), {
        ...restUpdates,
        attachments: [...existing, ...uploadedNew],
        status: 'pendiente',
        reviewNotes: '',
        reviewedBy: null,
        reviewedAt: null,
      });
      logAudit({ user, module: 'compras', action: 'Reenvió una requisición de compra corregida', details: id });
    } catch (error) {
      console.error('Error al reenviar requisición en Firestore:', error);
      deleteEvidencePhotos(uploadedNew).catch(() => {});
      return { ok: false, error: error.message };
    }

    if (removedAttachments.length > 0) {
      deleteEvidencePhotos(removedAttachments).catch(() => {});
    }
    return { ok: true };
  }, [user, requisiciones]);

  /**
   * El solicitante agrega o edita los datos de pago del proveedor. `paymentDetailsFile`
   * puede traer una mezcla de adjuntos ya subidos y archivos nuevos (File), igual que
   * en `resubmitRequisicion`.
   */
  const addPaymentDetails = useCallback(async (id, { paymentDetails, paymentDetailsFile }) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const req = requisiciones.find((r) => r.id === id);
    if (!req) return { ok: false, error: 'Requisición no encontrada' };

    const { existing, newFiles } = splitAttachments(paymentDetailsFile || []);

    let uploadedNew = [];
    try {
      uploadedNew = await uploadAttachments('compras', id, newFiles);
    } catch (error) {
      console.error('Error al subir el archivo de datos de pago:', error);
      return { ok: false, error: 'No se pudo subir el archivo (revisa tu conexión). Intenta de nuevo.' };
    }

    const removed = (req.paymentDetailsFile || []).filter(
      (orig) => orig?.path && !existing.some((e) => e.path === orig.path)
    );

    try {
      await updateDoc(doc(db, 'requisiciones', id), {
        paymentDetails: paymentDetails ?? req.paymentDetails,
        paymentDetailsFile: [...existing, ...uploadedNew],
      });
      logAudit({ user, module: 'compras', action: 'Agregó detalles de pago a una requisición', details: id });
    } catch (error) {
      console.error('Error al agregar detalles de pago en Firestore:', error);
      deleteEvidencePhotos(uploadedNew).catch(() => {});
      return { ok: false, error: error.message };
    }

    if (removed.length > 0) deleteEvidencePhotos(removed).catch(() => {});
    return { ok: true };
  }, [requisiciones, user]);

  /**
   * Compras marca una requisición autorizada como comprada. `purchaseProof` llega como
   * archivos crudos (File) — se suben a Storage antes de guardar el registro.
   */
  const markAsPurchased = useCallback(async (id, { purchasedBy, supplier, cost, purchaseProof }) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    let uploaded = [];
    try {
      uploaded = await uploadAttachments('compras', id, purchaseProof || []);
    } catch (error) {
      console.error('Error al subir el comprobante de compra:', error);
      return { ok: false, error: 'No se pudo subir el comprobante (revisa tu conexión). Intenta registrar la compra de nuevo.' };
    }
    try {
      await updateDoc(doc(db, 'requisiciones', id), {
        status: 'comprada',
        purchasedBy,
        purchasedAt: new Date().toISOString(),
        supplier,
        cost,
        purchaseProof: uploaded,
      });
      logAudit({ user, module: 'compras', action: 'Marcó requisición como comprada', details: `${id} — ${supplier}, $${cost}` });
      return { ok: true };
    } catch (error) {
      console.error('Error al marcar compra en Firestore:', error);
      deleteEvidencePhotos(uploaded).catch(() => {});
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * El solicitante o dirección cierra la requisición al recibir el material
   */
  const markAsReceived = useCallback(async (id, receivedBy) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'requisiciones', id), {
        status: 'recibida',
        receivedBy,
        receivedAt: new Date().toISOString(),
      });
      logAudit({ user, module: 'compras', action: 'Marcó requisición como recibida', details: `${id} por ${receivedBy}` });
    } catch (error) {
      console.error('Error al marcar como recibida en Firestore:', error);
    }
  }, [user]);

  /**
   * Elimina por completo una requisición y sus archivos adjuntos en Storage (cotización,
   * datos de pago, comprobante de compra). Acción irreversible, solo para Admin (ver
   * firestore.rules) — a diferencia de las demás acciones de este contexto, no exige que
   * la requisición esté en un estado particular: un Admin puede necesitar borrar una
   * duplicada o creada por error sin importar en qué paso del flujo esté.
   */
  const deleteRequisicion = useCallback(async (id) => {
    if (!db) return { ok: false, error: 'Firebase no inicializado' };
    const req = requisiciones.find((r) => r.id === id);
    if (!req) return { ok: false, error: 'Requisición no encontrada' };

    try {
      await deleteDoc(doc(db, 'requisiciones', id));
      logAudit({ user, module: 'compras', action: 'Eliminó una requisición de compra', details: id });
    } catch (error) {
      console.error('Error al eliminar requisición en Firestore:', error);
      return { ok: false, error: error.message };
    }

    // Limpieza de Storage best-effort: la requisición ya se borró de Firestore, así que
    // un fallo aquí no se reporta como error al usuario (no hay nada que deshacer).
    const allAttachments = [
      ...(req.attachments || []),
      ...(req.paymentDetailsFile || []),
      ...(req.purchaseProof || []),
    ];
    if (allAttachments.length > 0) {
      deleteEvidencePhotos(allAttachments).catch(() => {});
    }

    return { ok: true };
  }, [requisiciones, user]);

  const value = useMemo(
    () => ({
      requisiciones,
      addRequisicion,
      authorizeRequisicion,
      returnRequisicion,
      resubmitRequisicion,
      addPaymentDetails,
      markAsPurchased,
      markAsReceived,
      deleteRequisicion,
    }),
    [
      requisiciones,
      addRequisicion,
      authorizeRequisicion,
      returnRequisicion,
      resubmitRequisicion,
      addPaymentDetails,
      markAsPurchased,
      markAsReceived,
      deleteRequisicion,
    ]
  );

  return <ComprasContext.Provider value={value}>{children}</ComprasContext.Provider>;
};

ComprasProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
