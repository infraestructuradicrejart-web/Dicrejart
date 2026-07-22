/**
 * @file useInactivityLock.js
 * @description Hook que detecta inactividad del usuario (sin mover el mouse, teclear,
 * tocar la pantalla, hacer scroll) y expone cuándo la sesión debe mostrarse bloqueada
 * tras cierto tiempo sin actividad. No cierra la sesión real, solo indica el estado.
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
const CHECK_INTERVAL_MS = 5000;

/**
 * @param {number} timeoutMs - Milisegundos de inactividad antes de considerar bloqueada la sesión
 * @returns {{locked: boolean, unlock: function}}
 */
const useInactivityLock = (timeoutMs) => {
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(Date.now());

  const registerActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, registerActivity, { passive: true }));

    const interval = setInterval(() => {
      if (!locked && Date.now() - lastActivityRef.current >= timeoutMs) {
        setLocked(true);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, registerActivity));
      clearInterval(interval);
    };
  }, [timeoutMs, locked, registerActivity]);

  const unlock = useCallback(() => {
    lastActivityRef.current = Date.now();
    setLocked(false);
  }, []);

  return { locked, unlock };
};

export default useInactivityLock;
