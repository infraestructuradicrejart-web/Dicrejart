/**
 * @file ThemeToggle.jsx
 * @description Botón interactivo y switch para alternar entre Modo Claro y Modo Oscuro
 * Cuenta con micro-animaciones fluidas con framer-motion.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import useTheme from '../../hooks/useTheme';
import styles from './ThemeToggle.module.css';

/**
 * Componente ThemeToggle
 * @param {Object} props
 * @param {'button'|'switch'} [props.variant='button'] - Variante visual: botón circular flotante o switch horizontal
 * @param {string} [props.className] - Clases CSS adicionales
 */
export const ThemeToggle = ({ variant = 'button', className = '' }) => {
  const { isDark, toggleTheme } = useTheme();

  if (variant === 'switch') {
    return (
      <div
        className={`${styles.switchRow} ${className}`}
        onClick={toggleTheme}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleTheme()}
        title={isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-dark)' }}>
          {isDark ? '🌙 Modo Oscuro' : '☀️ Modo Claro'}
        </span>
        <div className={styles.switchPill}>
          <div className={styles.switchKnob}>{isDark ? '🌙' : '☀️'}</div>
        </div>
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      className={`${styles.toggleButton} ${className}`}
      onClick={toggleTheme}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      title={isDark ? '☀️ Cambiar a Modo Claro' : '🌙 Cambiar a Modo Oscuro'}
      aria-label={isDark ? 'Activar Modo Claro' : 'Activar Modo Oscuro'}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={isDark ? 'dark' : 'light'}
          className={styles.iconWrapper}
          initial={{ y: -16, opacity: 0, rotate: -45 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: 16, opacity: 0, rotate: 45 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {isDark ? '🌙' : '☀️'}
        </motion.div>
      </AnimatePresence>
    </motion.button>
  );
};

ThemeToggle.propTypes = {
  variant: PropTypes.oneOf(['button', 'switch']),
  className: PropTypes.string,
};

export default ThemeToggle;
