/**
 * @file ToastContext.jsx
 * @description Contexto de notificaciones tipo Toast de la aplicación Dicrejart
 * Reemplaza el uso de alert() nativo por notificaciones flotantes no bloqueantes
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { createContext, useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence } from 'framer-motion';
import Toast from '../components/ui/Toast';
import styles from './ToastContext.module.css';

/**
 * Duración por defecto (ms) que un toast permanece visible antes de auto-cerrarse
 * @constant
 */
const DEFAULT_DURATION = 4000;

/**
 * Contexto de notificaciones Toast
 * @constant
 */
export const ToastContext = createContext(null);

/**
 * Proveedor de notificaciones Toast
 * Envuelve la aplicación y expone la función `showToast` a través de useToast()
 *
 * @component
 * @param {Object} props
 * @param {ReactNode} props.children - Árbol de componentes que consumirá el contexto
 * @returns {ReactElement} Proveedor de contexto de toasts + contenedor visual
 */
export const ToastProvider = ({ children }) => {
  // ============================================
  // ESTADO
  // ============================================

  /**
   * Cola de toasts activos actualmente en pantalla
   */
  const [toasts, setToasts] = useState([]);

  // ============================================
  // ACCIONES
  // ============================================

  /**
   * Elimina un toast de la cola por su id
   * @param {number} id
   */
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  /**
   * Encola un nuevo toast y programa su cierre automático
   *
   * @param {string} message - Mensaje a mostrar
   * @param {'success'|'danger'|'warning'|'info'} [variant='info'] - Variante visual
   * @param {number} [duration=DEFAULT_DURATION] - Tiempo en ms antes de auto-cerrarse
   */
  const showToast = useCallback(
    (message, variant = 'info', duration = DEFAULT_DURATION) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => dismissToast(id), duration);
    },
    [dismissToast]
  );

  /**
   * Atajos por variante, para uso ergonómico: toast.success('...')
   */
  const value = useMemo(
    () => ({
      showToast,
      success: (message, duration) => showToast(message, 'success', duration),
      danger: (message, duration) => showToast(message, 'danger', duration),
      warning: (message, duration) => showToast(message, 'warning', duration),
      info: (message, duration) => showToast(message, 'info', duration),
    }),
    [showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Contenedor fijo de toasts, siempre visible sobre el resto de la app */}
      <div className={styles.container} aria-live="polite" aria-atomic="true">
        <AnimatePresence>
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              message={toast.message}
              variant={toast.variant}
              onDismiss={() => dismissToast(toast.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

ToastProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
