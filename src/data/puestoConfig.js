/**
 * @file puestoConfig.js
 * @description Catálogo compartido del "puesto" de un colaborador (Operarios): distingue
 * al personal de piso (por defecto, el único que existía antes de esto) del
 * departamento de Diseño, que tiene una jerarquía distinta (sin préstamos entre áreas
 * ni jornada/horas extra de manufactura). Fuente única para OperariosPage y DisenoPage,
 * que necesitan las mismas etiquetas/iconos/colores para mostrar el puesto.
 * @author Dicrejart Dev Team
 */

export const PUESTO_LABELS = {
  operario: 'Operario de Piso',
  disenador: 'Diseñador',
  arquitecto: 'Arquitecto',
};

export const PUESTO_ICONS = {
  operario: '👷',
  disenador: '✏️',
  arquitecto: '📐',
};

export const PUESTO_BADGE_VARIANT = {
  operario: 'neutral',
  disenador: 'primary',
  arquitecto: 'info',
};

export const PUESTO_OPTIONS = Object.entries(PUESTO_LABELS).map(([value, label]) => ({
  value,
  label: `${PUESTO_ICONS[value]} ${label}`,
}));

/** Puestos del departamento de Diseño — su única área posible es "diseno", sin excepción */
export const DESIGN_PUESTOS = ['disenador', 'arquitecto'];
