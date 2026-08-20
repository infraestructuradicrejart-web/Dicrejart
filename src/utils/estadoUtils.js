/**
 * @file estadoUtils.js
 * @description Reconstruye el estado de disponibilidad (activo/falta/incapacidad/etc.) de
 * un colaborador para una fecha ESPECÍFICA — no la "vigente ahora mismo" — a partir de
 * `estado` (el actual) y `estadoHistorial` (el registro cronológico de cada cambio, ver
 * OperariosContext.jsx → setOperarioEstado). Se usa en cualquier vista que consulte un día
 * distinto de hoy (ej. Calidad al calificar bloques de fechas previas): leer directamente
 * `op.estado` ahí mostraba la disponibilidad ACTUAL del colaborador aplicada por error a la
 * fecha consultada — alguien ausente hoy pero activo el día que se está revisando aparecía
 * bloqueado sin razón, y viceversa.
 * @author Dicrejart Dev Team
 */

/**
 * Reconstruye qué estado tenía un colaborador en `dateStr`, recorriendo su historial
 * cronológico y quedándose con la última entrada cuyo rango (`desde`-`hasta`) cubre esa
 * fecha. `falta` es un marcador de un solo día (cubre únicamente `desde`, igual que su
 * restablecimiento automático al día siguiente, ver evaluateAndResetExpiredEstado).
 *
 * @param {{estado?: Object, estadoHistorial?: Array<Object>}} op - Operario
 * @param {string} dateStr - Fecha a consultar, formato YYYY-MM-DD
 * @returns {Object|null} La entrada de ausencia vigente ese día, o null si estaba activo
 */
export const getEstadoOnDate = (op, dateStr) => {
  const raw = [...(op?.estadoHistorial || [])];
  if (op?.estado && op.estado.desde) raw.push(op.estado);

  const entries = raw
    .filter((e) => e && e.desde)
    .sort((a, b) => (a.desde === b.desde
      ? String(a.registradoAt || '').localeCompare(String(b.registradoAt || ''))
      : a.desde.localeCompare(b.desde)));

  let active = null;
  for (const entry of entries) {
    if (entry.desde > dateStr) break;
    const coversDate = entry.tipo === 'falta'
      ? entry.desde === dateStr
      : (!entry.hasta || entry.hasta >= dateStr);
    active = coversDate ? entry : null;
  }
  return active;
};

/**
 * Atajo booleano: ¿el colaborador estaba ausente (cualquier tipo distinto de 'activo') en
 * `dateStr`?
 * @param {Object} op
 * @param {string} dateStr
 * @returns {boolean}
 */
export const wasAbsentOnDate = (op, dateStr) => Boolean(getEstadoOnDate(op, dateStr));
