/**
 * @file operariosData.js
 * @description Datos y utilidades del padrón de operarios de la fábrica
 * Fuente única de verdad para el personal de producción, su área de origen
 * y su área activa (que puede diferir de la de origen mientras está prestado)
 * @author Dicrejart Dev Team
 */

import { AREAS_CATALOG, resolveAreaId } from './areasConfig';

/**
 * Catálogo de las 8 áreas de producción (id + nombre para validar Excel y mostrar en UI)
 * @constant
 */
export const AREAS_OPERARIOS = AREAS_CATALOG;

/**
 * Re-exportado desde areasConfig.js para no romper imports existentes
 * @see resolveAreaId en areasConfig.js
 */
export { resolveAreaId };

/**
 * Padrón inicial de operarios (semilla mock)
 * `homeArea` es el área de origen; `currentArea` es el área activa actual
 * (si difiere de `homeArea`, el operario está prestado)
 * @constant
 */
export const INITIAL_OPERARIOS = [];
