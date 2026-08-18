/**
 * @file overtimeUtils.js
 * @description Deriva, a partir del horario autorizado de un colaborador (startHour,
 * endHour y la fecha), en qué bloque(s) del día cae el tiempo extra: matutino (antes de
 * la hora normal de entrada) y/o vespertino (después de la hora normal de salida — más
 * temprano los sábados). Se usa en Operarios (al autorizar), Calidad (al verificar) y en
 * el reporte diario a RH, para no repetir la misma cuenta en tres lugares.
 * @author Dicrejart Dev Team
 */

const BASE_START_HOUR = 8;
const BASE_END_HOUR_WEEKDAY = 18;
const BASE_END_HOUR_SATURDAY = 13;

const pad = (h) => String(h).padStart(2, '0');

/**
 * Convierte una hora decimal (donde .5 son 30 minutos, ej. 17.5) al formato "HH:MM" para
 * mostrarla — se usa en vez de `${pad(h)}:00` en cuanto las horas de tiempo extra dejaron
 * de ser siempre números enteros.
 * @param {number|string} h - Hora en decimal (ej. 17, 17.5)
 * @returns {string} Hora en formato "HH:MM" (ej. "17:00", "17:30")
 */
export const formatHourLabel = (h) => {
  const value = Number(h);
  const hour = Math.floor(value);
  const minutes = Math.round((value - hour) * 60);
  return `${pad(hour)}:${pad(minutes)}`;
};

/**
 * Genera opciones { value, label } de hora en incrementos de 30 minutos entre startHour y
 * endHour (inclusive). `labelFor(hour)` permite conservar una etiqueta descriptiva propia
 * en horas en punto específicas (ej. "08:00 (Entrada Normal)"); las demás marcas (medias
 * horas y horas en punto sin etiqueta propia) usan el formato simple "HH:MM".
 * @param {number} startHour
 * @param {number} endHour
 * @param {(hour: number) => string|null} [labelFor]
 * @returns {Array<{value: string, label: string}>}
 */
export const buildHalfHourOptions = (startHour, endHour, labelFor = null) => {
  const options = [];
  for (let h = startHour; h <= endHour; h += 0.5) {
    const explicitLabel = labelFor ? labelFor(h) : null;
    options.push({ value: String(h), label: explicitLabel || formatHourLabel(h) });
  }
  return options;
};

/**
 * Genera las opciones de "Cantidad de Horas" (en incrementos de 30 minutos) para la
 * solicitud simple de tiempo extra de un Encargado — cada opción muestra a qué hora de
 * reloj resulta esa cantidad, según el bloque (matutino resta de las 8:00, vespertino
 * suma a las 18:00), igual que ya mostraban las opciones originales en horas enteras.
 * @param {number} maxHours - Tope de horas para ese bloque (2 matutino, 4 vespertino)
 * @param {'matutino'|'vespertino'} bloque
 * @returns {Array<{value: string, label: string}>}
 */
export const buildOvertimeCountOptions = (maxHours, bloque) => {
  const options = [];
  for (let h = 0.5; h <= maxHours; h += 0.5) {
    const resultHour = bloque === 'matutino' ? BASE_START_HOUR - h : BASE_END_HOUR_WEEKDAY + h;
    const isMax = h === maxHours;
    const plural = h === 1 ? '' : 's';
    const accion = bloque === 'matutino' ? 'Entrada' : 'Salida';
    options.push({
      value: String(h),
      label: `${h} hora${plural} extra${plural} (${accion} ${formatHourLabel(resultHour)}${isMax ? ' — Máx' : ''})`,
    });
  }
  return options;
};

/**
 * @param {number} startHour - Hora de entrada autorizada (0-23, admite medias horas)
 * @param {number} endHour - Hora de salida autorizada (0-23, admite medias horas)
 * @param {string} authorizedDate - Fecha YYYY-MM-DD de la jornada
 * @returns {{
 *   earlyHours: number, earlyRange: string|null,
 *   lateHours: number, lateRange: string|null,
 *   baseStartHour: number, baseEndHour: number,
 * }}
 */
export const getOvertimeBlocks = (startHour, endHour, authorizedDate) => {
  const isSaturday = authorizedDate ? new Date(`${authorizedDate}T00:00:00`).getDay() === 6 : false;
  const baseEndHour = isSaturday ? BASE_END_HOUR_SATURDAY : BASE_END_HOUR_WEEKDAY;

  const earlyHours = startHour < BASE_START_HOUR ? BASE_START_HOUR - startHour : 0;
  const lateHours = endHour > baseEndHour ? endHour - baseEndHour : 0;

  return {
    earlyHours,
    earlyRange: earlyHours > 0 ? `${formatHourLabel(startHour)} - ${formatHourLabel(BASE_START_HOUR)}` : null,
    lateHours,
    lateRange: lateHours > 0 ? `${formatHourLabel(baseEndHour)} - ${formatHourLabel(endHour)}` : null,
    baseStartHour: BASE_START_HOUR,
    baseEndHour,
  };
};
