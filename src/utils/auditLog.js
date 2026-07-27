/**
 * @file auditLog.js
 * @description Helper centralizado para registrar la bitácora de auditoría (quién hizo
 * qué, en qué módulo). Es "fire-and-forget": nunca se espera con `await` desde quien lo
 * llama y nunca lanza error hacia afuera, para que registrar la bitácora jamás bloquee ni
 * rompa la acción real que se está auditando.
 * @author Dicrejart Dev Team
 * @requires firebase/firestore
 */

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { auth } from '../config/firebase';

let auditCounter = 0;

/**
 * Registra una entrada en la bitácora de auditoría (colección `audit_log`), visible solo
 * para Admin (reforzado también en `firestore.rules`).
 *
 * @param {Object} params
 * @param {Object} [params.user] - Usuario que ejecuta la acción (de AuthContext).
 * @param {string} params.module - Módulo donde ocurrió la acción (ej. 'produccion').
 * @param {string} params.action - Descripción breve de la acción (ej. "Registró salida de producción").
 * @param {string} [params.details] - Detalle específico (ej. "5 pzas de 'Prueba' en Corte Láser").
 */
export const logAudit = ({ user, module, action, details }) => {
  if (!db) return;
  // No intentar escribir si no hay sesión activa en Firebase Auth (evita error de permisos)
  if (!auth?.currentUser) return;
  auditCounter += 1;
  const id = `LOG-${Date.now()}-${auditCounter}`;

  setDoc(doc(db, 'audit_log', id), {
    id,
    timestamp: new Date().toISOString(),
    userId: user?.id || null,
    userName: user?.name || 'Desconocido',
    userRole: user?.roleType || null,
    module,
    action,
    details: details || '',
  }).catch((error) => {
    console.error('Error al registrar bitácora de auditoría:', error);
  });
};
