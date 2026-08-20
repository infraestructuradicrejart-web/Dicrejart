/**
 * @file estadoConfig.js
 * @description Catálogo compartido del estado de disponibilidad de un colaborador (Operarios):
 * etiquetas, iconos, variantes de Badge y opciones de selección para toda la aplicación.
 * @author Dicrejart Dev Team
 */

export const ESTADO_LABELS = {
  activo: 'En Planta',
  falta: 'Falta (Inasistencia)',
  incapacidad: 'Incapacidad Médica',
  salida_campo: 'Salida Fuera / Actividad Externa',
  actividad_externa: 'Comisión Externa',
  viaje: 'Viaje / Ensamble Foráneo',
  vacaciones: 'Vacaciones / Permiso',
};

export const ESTADO_ICONS = {
  activo: '🟢',
  falta: '🔴',
  incapacidad: '🩺',
  salida_campo: '🚚',
  actividad_externa: '🏢',
  viaje: '✈️',
  vacaciones: '🏖️',
};

export const ESTADO_BADGE_VARIANT = {
  activo: 'success',
  falta: 'danger',
  incapacidad: 'warning',
  salida_campo: 'info',
  actividad_externa: 'primary',
  viaje: 'neutral',
  vacaciones: 'warning',
};

export const ESTADO_OPTIONS = Object.entries(ESTADO_LABELS).map(([value, label]) => ({
  value,
  label: `${ESTADO_ICONS[value]} ${label}`,
}));
