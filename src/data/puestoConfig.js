/**
 * @file puestoConfig.js
 * @description Catálogo compartido del "puesto" de un colaborador (Operarios):
 * - Operario de Piso (Áreas de manufactura/fábrica)
 * - Diseñador (Área de Diseño)
 * - Arquitecto (Área de Arquitectura)
 * - Supervisor (Área de Supervisión o Área asignada)
 * - Inspector de Calidad (Área de Calidad / Supervisión)
 * @author Dicrejart Dev Team
 */

export const PUESTO_LABELS = {
  operario: 'Operario de Piso',
  disenador: 'Diseñador',
  arquitecto: 'Arquitecto',
  supervisor: 'Supervisor',
  calidad: 'Inspector de Calidad',
};

export const PUESTO_ICONS = {
  operario: '👷',
  disenador: '✏️',
  arquitecto: '📐',
  supervisor: '📋',
  calidad: '🔍',
};

export const PUESTO_BADGE_VARIANT = {
  operario: 'neutral',
  disenador: 'primary',
  arquitecto: 'info',
  supervisor: 'warning',
  calidad: 'success',
};

export const PUESTO_OPTIONS = Object.entries(PUESTO_LABELS).map(([value, label]) => ({
  value,
  label: `${PUESTO_ICONS[value]} ${label}`,
}));

/** Área asignada por defecto según el puesto seleccionado */
export const PUESTO_DEFAULT_AREA = {
  operario: 'herreria',
  disenador: 'diseno',
  arquitecto: 'arquitectura',
  supervisor: 'supervision',
  calidad: 'supervision',
};

/** Puestos de oficina técnica */
export const TECHNICAL_PUESTOS = ['disenador', 'arquitecto', 'supervisor', 'calidad'];

/** Puestos de diseño y planos */
export const DESIGN_PUESTOS = ['disenador', 'arquitecto'];
