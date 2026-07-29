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
 * @param {number} startHour - Hora de entrada autorizada (0-23)
 * @param {number} endHour - Hora de salida autorizada (0-23)
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
    earlyRange: earlyHours > 0 ? `${pad(startHour)}:00 - ${pad(BASE_START_HOUR)}:00` : null,
    lateHours,
    lateRange: lateHours > 0 ? `${pad(baseEndHour)}:00 - ${pad(endHour)}:00` : null,
    baseStartHour: BASE_START_HOUR,
    baseEndHour,
  };
};
