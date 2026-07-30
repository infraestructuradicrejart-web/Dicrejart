/**
 * @file useProgressiveList.js
 * @description Revela una lista ya filtrada/ordenada en tandas ("Cargar más") en vez de
 * pintar todos los registros de una vez — usado en tablas y cuadrículas que crecen sin
 * límite (operarios, juegos, requisiciones, etc.).
 * @author Dicrejart Dev Team
 */

import { useState, useEffect } from 'react';

/**
 * @param {Array} items - Lista ya filtrada/ordenada a revelar progresivamente
 * @param {Object} [options]
 * @param {number} [options.initialCount=15] - Cuántos elementos se muestran al inicio
 * @param {number} [options.step=15] - Cuántos elementos se revelan por cada "Cargar más"
 * @param {*} [options.resetKey] - Debe cambiar cuando cambian los filtros/búsqueda que
 *   producen `items`, para que la vista vuelva a empezar desde la primera tanda en vez de
 *   quedar confusamente truncada sobre un resultado distinto.
 * @returns {{visibleItems: Array, hasMore: boolean, remaining: number, showMore: Function}}
 */
export default function useProgressiveList(items, { initialCount = 15, step = 15, resetKey } = {}) {
  const [visibleCount, setVisibleCount] = useState(initialCount);

  useEffect(() => {
    setVisibleCount(initialCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return {
    visibleItems: items.slice(0, visibleCount),
    hasMore: visibleCount < items.length,
    remaining: Math.max(0, items.length - visibleCount),
    showMore: () => setVisibleCount((c) => c + step),
  };
}
