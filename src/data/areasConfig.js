/**
 * @file areasConfig.js
 * @description Catálogo único de las 8 áreas de producción de Dicrejart
 * Fuente compartida para resolver nombres de área provenientes de Excel
 * (usado por la carga de Operarios, Juegos y Actividades)
 * @author Dicrejart Dev Team
 */

/**
 * Catálogo de las 8 áreas de producción (id + nombre)
 * @constant
 */
export const AREAS_CATALOG = [
  { id: 'almacen', name: 'Almacén' },
  { id: 'corte-laser', name: 'Corte Laser' },
  { id: 'herreria', name: 'Herrería' },
  { id: 'carpinteria', name: 'Carpintería' },
  { id: 'costura-acc', name: 'Costura Accesorios' },
  { id: 'costura-colch', name: 'Costura Colchonetas' },
  { id: 'mantenimiento', name: 'Mantenimiento' },
  { id: 'producto-terminado', name: 'Producto Terminado' },
];

/**
 * Rango Unicode de marcas diacríticas combinantes (U+0300 - U+036F)
 * Construido con String.fromCharCode para evitar caracteres combinantes literales en el código fuente
 * @constant
 */
const DIACRITICS_PATTERN = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g'
);

/**
 * Quita diacríticos (acentos) y normaliza a minúsculas para comparar texto de forma flexible
 * @param {string} value
 * @returns {string}
 */
const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .trim()
    .toLowerCase();

/**
 * Resuelve un valor de área proveniente de un Excel (puede venir como id
 * "corte-laser" o como nombre "Corte Laser") al id canónico del área
 *
 * @param {string} rawValue - Valor crudo de la celda de área
 * @returns {string|null} El id del área si hay coincidencia, o null si no se reconoce
 */
export const resolveAreaId = (rawValue) => {
  const normalized = normalize(rawValue);
  
  // Mapeo flexible de sinónimos o subpalabras comunes en el Excel
  if (/laser/i.test(normalized)) return 'corte-laser';
  if (/herreria|soldadura|metal/i.test(normalized)) return 'herreria';
  if (/carpinteria|madera/i.test(normalized)) return 'carpinteria';
  if (/colchoneta/i.test(normalized)) return 'costura-colch';
  if (/costura/i.test(normalized)) return 'costura-acc'; // Fallback a accesorios si no es colchoneta
  if (/almacen/i.test(normalized)) return 'almacen';
  if (/mantenimiento|pintura/i.test(normalized)) return 'mantenimiento';
  if (/terminado|pt|empaque/i.test(normalized)) return 'producto-terminado';

  const match = AREAS_CATALOG.find(
    (area) => normalize(area.id) === normalized || normalize(area.name) === normalized
  );
  return match ? match.id : null;
};

/**
 * Normaliza texto libre (para comparar nombres de proyectos, juegos, etc.)
 * @param {string} value
 * @returns {string}
 */
export const normalizeText = normalize;
