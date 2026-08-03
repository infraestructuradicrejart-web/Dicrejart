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

// Exportadas para que AuthContext pueda limpiarlas al cerrar sesión — de lo contrario
// quedan en localStorage (sobreviven a un logout/login e incluso al cierre automático
// de sesión de 12h) y el próximo login arranca ya bloqueado.
export const LAST_ACTIVITY_KEY = 'dicrejart_last_activity';
export const LOCKED_STATE_KEY = 'dicrejart_is_locked';

/**
 * @param {number} timeoutMs - Milisegundos de inactividad antes de considerar bloqueada la sesión
 * @returns {{locked: boolean, unlock: function}}
 */
const useInactivityLock = (timeoutMs) => {
  const [locked, setLocked] = useState(() => {
    if (localStorage.getItem(LOCKED_STATE_KEY) === 'true') return true;
    
    const storedLast = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (storedLast && Date.now() - parseInt(storedLast, 10) >= timeoutMs) {
      return true;
    }
    return false;
  });

  const lastActivityRef = useRef(Date.now());
  const lastStorageUpdateRef = useRef(0);

  // Sincronizar ref inicial con localStorage al montar
  useEffect(() => {
    const storedLast = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (storedLast) {
      lastActivityRef.current = parseInt(storedLast, 10);
    }
  }, []);

  // Mantener actualizado localStorage cuando cambia el estado de bloqueo
  useEffect(() => {
    if (locked) {
      localStorage.setItem(LOCKED_STATE_KEY, 'true');
    } else {
      localStorage.removeItem(LOCKED_STATE_KEY);
    }
  }, [locked]);

  const registerActivity = useCallback(() => {
    if (locked) return; // Si ya está bloqueado, no registra actividad
    
    const now = Date.now();
    lastActivityRef.current = now;
    
    // Throttle: actualizar localStorage máximo 1 vez por segundo para no afectar el rendimiento
    if (now - lastStorageUpdateRef.current > 1000) {
      localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
      lastStorageUpdateRef.current = now;
    }
  }, [locked]);

  useEffect(() => {
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, registerActivity, { passive: true }));

    const interval = setInterval(() => {
      // Si otra pestaña ya desbloqueó, también nos desbloqueamos (opcional, pero útil)
      if (locked) {
        if (localStorage.getItem(LOCKED_STATE_KEY) !== 'true') {
          setLocked(false);
        }
        return;
      }

      // Sincronizar actividad de otras pestañas
      const storedLast = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10);
      if (storedLast > lastActivityRef.current) {
        lastActivityRef.current = storedLast;
      }

      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        setLocked(true);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, registerActivity));
      clearInterval(interval);
    };
  }, [timeoutMs, locked, registerActivity]);

  const unlock = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    lastStorageUpdateRef.current = now;
    localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
    localStorage.removeItem(LOCKED_STATE_KEY);
    setLocked(false);
  }, []);

  return { locked, unlock };
};

export default useInactivityLock;
