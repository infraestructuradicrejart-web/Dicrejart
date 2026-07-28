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
