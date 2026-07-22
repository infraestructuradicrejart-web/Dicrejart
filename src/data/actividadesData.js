/**
 * @file actividadesData.js
 * @description Datos simulados de actividades operativas no ligadas a un juego
 * (mantenimiento, capacitación, limpieza, etc.), asignables a un área y,
 * opcionalmente, a un operario específico dentro de esa área
 * @author Dicrejart Dev Team
 */

// ============================================
// ACTIVIDADES MOCK
// ============================================
export const MOCK_ACTIVIDADES = [];

/**
 * Etiquetas legibles para cada nivel de prioridad
 * @constant
 */
export const PRIORITY_LABELS = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

/**
 * Etiquetas legibles para cada estatus de actividad
 * @constant
 */
export const ACTIVITY_STATUS_LABELS = {
  pendiente: 'Pendiente',
  proceso: 'En Proceso',
  completado: 'Completado',
};
