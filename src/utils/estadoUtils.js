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

  const raw = [...(op?.estadoHistorial || [])];
  if (op?.estado && op.estado.desde) raw.push(op.estado);

  const entries = raw
    .filter((e) => e && e.desde && !e.anulado && !e.eliminado)
    .sort((a, b) => (a.desde === b.desde
      ? String(a.registradoAt || '').localeCompare(String(b.registradoAt || ''))
      : a.desde.localeCompare(b.desde)));

  let activeAbsence = null;
  for (const entry of entries) {
    if (entry.desde > dateStr) break;

    // Un regreso a 'activo' (con fecha real, no el auto-restablecimiento que usa
    // desde:null y por eso ni siquiera entra a `entries`) cierra cualquier ausencia previa.
    if (entry.tipo === 'activo') {
      activeAbsence = null;
      continue;
    }

    // Una ausencia cubre dateStr si:
    // - Tiene 'hasta': cubre el rango [desde, hasta].
    // - Sin 'hasta' y es 'falta' o 'salida_campo': son eventos de un solo día (desde).
    // - Sin 'hasta' y es cualquier otro tipo (viaje, incapacidad, vacaciones...): ausencia
    //   ABIERTA — cubre desde 'desde' en adelante indefinidamente, hasta que se registre
    //   un regreso a 'activo' o se le agregue un 'hasta'. Antes esto se trataba igual que
    //   falta (solo el día exacto de 'desde'), así que alguien de viaje sin fecha de
    //   regreso conocida aparecía "activo" desde el segundo día en adelante y se le podía
    //   calificar en Calidad como si estuviera en planta.
    const coversDate = entry.hasta
      ? (dateStr >= entry.desde && dateStr <= entry.hasta)
      : (entry.tipo === 'falta' || entry.tipo === 'salida_campo')
        ? entry.desde === dateStr
        : dateStr >= entry.desde;

    activeAbsence = coversDate ? entry : null;
  }

  return activeAbsence;
};

/**
 * Atajo booleano: ¿el colaborador estaba ausente (cualquier tipo distinto de 'activo') en
 * `dateStr`?
 * @param {Object} op
 * @param {string} dateStr
 * @returns {boolean}
 */
export const wasAbsentOnDate = (op, dateStr) => Boolean(getEstadoOnDate(op, dateStr));
