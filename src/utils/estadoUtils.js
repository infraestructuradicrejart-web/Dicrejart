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
 * cronológico y quedándose con la última entrada de ausencia vigente ese día.
 * Si el colaborador está 'activo' o la ausencia ya terminó / no cubre `dateStr`, retorna null.
 *
 * @param {{estado?: Object, estadoHistorial?: Array<Object>}} op - Operario
 * @param {string} dateStr - Fecha a consultar, formato YYYY-MM-DD
 * @returns {Object|null} La entrada de ausencia vigente ese día, o null si estaba activo
 */
export const getEstadoOnDate = (op, dateStr) => {
  if (!op) return null;

  // Si el colaborador está actualmente en 'activo' y la fecha consultada es hoy o futura:
  const todayStr = new Date().toISOString().split('T')[0];
  if (op.estado?.tipo === 'activo' && dateStr >= (op.estado.desde || todayStr)) {
    return null;
  }

  const raw = [...(op?.estadoHistorial || [])];
  if (op?.estado && op.estado.desde) raw.push(op.estado);

  const entries = raw
    .filter((e) => e && e.desde && !e.anulado && !e.eliminado)
    .sort((a, b) => {
      if (a.desde === b.desde) {
        return String(a.registradoAt || '').localeCompare(String(b.registradoAt || ''));
      }
      return a.desde.localeCompare(b.desde);
    });

  let activeAbsence = null;
  for (const entry of entries) {
    if (entry.desde > dateStr) break;

    // Si se registró un cambio a 'activo', limpia cualquier ausencia previa
    if (entry.tipo === 'activo') {
      activeAbsence = null;
      continue;
    }

    // Una ausencia cubre dateStr si tiene rango [desde, hasta] y dateStr cae dentro,
    // o si no tiene 'hasta' y dateStr coincide exactamente con 'desde'
    const coversDate = entry.hasta
      ? (dateStr >= entry.desde && dateStr <= entry.hasta)
      : (dateStr === entry.desde);

    if (coversDate) {
      activeAbsence = entry;
    } else if (entry.hasta && dateStr > entry.hasta) {
      activeAbsence = null;
    }
  }

  // Si el estado actual vigente es 'activo' y se registró con fecha posterior a la ausencia encontrada
  if (op.estado?.tipo === 'activo' && activeAbsence) {
    const activoRegAt = op.estado.registradoAt || '';
    const absenceRegAt = activeAbsence.registradoAt || '';
    if (activoRegAt && absenceRegAt && activoRegAt >= absenceRegAt && dateStr >= (op.estado.desde || '')) {
      return null;
    }
  }

  return activeAbsence && activeAbsence.tipo !== 'activo' ? activeAbsence : null;
};

/**
 * Atajo booleano: ¿el colaborador estaba ausente (cualquier tipo distinto de 'activo') en
 * `dateStr`?
 * @param {Object} op
 * @param {string} dateStr
 * @returns {boolean}
 */
export const wasAbsentOnDate = (op, dateStr) => Boolean(getEstadoOnDate(op, dateStr));
