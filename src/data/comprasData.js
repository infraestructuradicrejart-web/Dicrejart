/**
 * @file comprasData.js
 * @description Datos simulados y catálogos del módulo de Requisiciones de Compra
 * @author Dicrejart Dev Team
 */

/**
 * Estatus posibles de una requisición de compra, en orden del flujo:
 * pendiente (creada, esperando revisión de Dirección) ->
 * autorizada (Dirección aprobó, notifica a Compras) o regresada (Dirección la devuelve con observaciones) ->
 * comprada (Compras realizó el pago y adjuntó el comprobante) ->
 * recibida (el solicitante confirma la descarga del comprobante / cierre)
 * @constant
 */
export const REQUISITION_STATUS_LABELS = {
  pendiente: 'Pendiente de Autorización',
  regresada: 'Regresada (requiere corrección)',
  autorizada: 'Autorizada, Pendiente de Compra',
  comprada: 'Comprada',
  recibida: 'Recibida / Cerrada',
};

/**
 * Niveles de prioridad de una requisición
 * @constant
 */
export const PRIORITY_LABELS = {
  normal: 'Normal',
  urgente: 'Urgente',
};

/**
 * Requisiciones de ejemplo para poblar el módulo en la demo
 * @constant
 */
export const MOCK_REQUISICIONES = [];
