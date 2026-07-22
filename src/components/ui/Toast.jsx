/**
 * @file Toast.jsx
 * @description Componente visual de una notificación tipo Toast
 * No mantiene estado propio: es controlado por ToastContext (ver ToastContext.jsx)
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import styles from './Toast.module.css';

/**
 * Íconos por variante de toast
 * @constant
 */
const VARIANT_ICONS = {
  success: '✅',
  danger: '⛔',
  warning: '⚠️',
  info: 'ℹ️',
};

/**
 * Componente Toast - Notificación flotante individual
 *
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {string} props.message - Mensaje a mostrar
 * @param {string} [props.variant='info'] - Variante visual ('success', 'danger', 'warning', 'info')
 * @param {function} props.onDismiss - Handler para cerrar el toast manualmente
 *
 * @returns {ReactElement} Toast renderizado
 */
const Toast = ({ message, variant = 'info', onDismiss }) => {
  const toastClass = `${styles.toast} ${styles[`variant-${variant}`]}`;

  return (
    <motion.div
      className={toastClass}
      role="status"
      layout
      initial={{ opacity: 0, y: -16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 64, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <span className={styles.icon} aria-hidden="true">
        {VARIANT_ICONS[variant]}
      </span>
      <p className={styles.message}>{message}</p>
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Cerrar notificación"
      >
        ✕
      </button>
    </motion.div>
  );
};

/**
 * PropTypes para validación
 */
Toast.propTypes = {
  message: PropTypes.string.isRequired,
  variant: PropTypes.oneOf(['success', 'danger', 'warning', 'info']),
  onDismiss: PropTypes.func.isRequired,
};

/**
 * Valores por defecto
 */
Toast.defaultProps = {
  variant: 'info',
};

export default Toast;
