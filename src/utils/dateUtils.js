/**
 * Retorna la fecha local actual (o de un objeto Date/string dado) en formato YYYY-MM-DD.
 * Evita desfasamientos horarios por conversión a UTC de toISOString().
 * @param {Date|string|number} [dateObj]
 * @returns {string} Fecha local en formato YYYY-MM-DD
 */
export const getTodayLocalDateStr = (dateObj = new Date()) => {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Calcula el rango [jueves, miércoles] de la semana de horas extra que contiene
 * `dateStr` — en Dicrejart las horas extra se empiezan a contabilizar el jueves y la
 * semana se corta el miércoles siguiente (no coincide con la semana calendario
 * lunes-domingo), así que el corte semanal de horas extra necesita su propio cálculo de
 * rango en vez del de una semana normal.
 * @param {string} [dateStr] - Fecha YYYY-MM-DD dentro de la semana buscada (hoy por defecto)
 * @returns {{start: string, end: string}} Jueves y miércoles (YYYY-MM-DD) de esa semana
 */
export const getOvertimeWeekRange = (dateStr = getTodayLocalDateStr()) => {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay(); // 0=Dom, 1=Lun, ..., 4=Jue, ..., 6=Sáb
  const daysSinceThu = dow >= 4 ? dow - 4 : dow + 3;
  const start = new Date(d);
  start.setDate(start.getDate() - daysSinceThu);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start: getTodayLocalDateStr(start), end: getTodayLocalDateStr(end) };
};
