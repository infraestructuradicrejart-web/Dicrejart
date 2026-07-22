/**
 * @file useIsMobile.js
 * @description Detecta si el viewport está en el rango "celular" (≤768px). Usa el mismo
 * punto de corte que Sidebar.module.css/MainLayout.module.css ya usan para convertir el
 * sidebar en drawer, así JS y CSS entran en modo móvil exactamente en el mismo ancho.
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useState, useEffect } from 'react';

/** Breakpoint canónico de "celular" para toda la app (JS y CSS) */
export const MOBILE_BREAKPOINT = 768;

/**
 * @param {number} [breakpoint=MOBILE_BREAKPOINT] - Ancho máximo (px) considerado móvil
 * @returns {boolean} true si el viewport actual es ≤ breakpoint
 */
const useIsMobile = (breakpoint = MOBILE_BREAKPOINT) => {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = window.matchMedia(query);
    const handleChange = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return isMobile;
};

export default useIsMobile;
