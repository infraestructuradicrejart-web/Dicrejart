/**
 * @file nonProductionAreasConfig.js
 * @description Catálogo de áreas que NO son de manufactura (ej. Diseño) — separado a
 * propósito de AREAS_CATALOG (las 8 áreas de producción), que alimenta la secuencia de
 * producción, los colores de área y el tracking por área de ProduccionPage. Estas áreas
 * son solo para agrupar actividades (ej. en los "Bloques" del Editor Visual) y todavía
 * no tienen colaboradores reales dados de alta en el sistema.
 * @author Dicrejart Dev Team
 */

/**
 * Catálogo de áreas no productivas (id + nombre)
 * @constant
 */
export const NON_PRODUCTION_AREAS = [
  { id: 'diseno', name: 'Diseño' },
];
