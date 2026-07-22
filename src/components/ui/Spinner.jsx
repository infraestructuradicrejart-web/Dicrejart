/**
 * @file Spinner.jsx
 * @description Componente Spinner reutilizable para Dicrejart
 * Indicador de carga circular animado, para usarse en secciones o páginas completas
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import styles from './Spinner.module.css';

/**
 * Componente Spinner - Indicador de carga
 *
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {string} [props.size='md'] - Tamaño del spinner ('sm', 'md', 'lg')
 * @param {string} [props.variant='primary'] - Color del spinner ('primary', 'secondary', 'white')
 * @param {string} [props.label] - Texto descriptivo debajo del spinner (opcional)
 * @param {string} [props.className] - Clases CSS adicionales
 *
 * @returns {ReactElement} Spinner renderizado
 *
 * @example
 * <Spinner size="lg" label="Cargando datos..." />
 */
const Spinner = ({ size = 'md', variant = 'primary', label = '', className = '' }) => {
  const spinnerClass = `
    ${styles.spinner}
    ${styles[`size-${size}`]}
    ${styles[`variant-${variant}`]}
    ${className}
  `.trim();

  return (
    <div className={styles.container} role="status" aria-live="polite">
      <motion.span
        className={spinnerClass}
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        aria-hidden="true"
      />
      {label ? (
        <span className={styles.label}>{label}</span>
      ) : (
        <span className={styles['sr-only']}>Cargando</span>
      )}
    </div>
  );
};

/**
 * PropTypes para validación
 */
Spinner.propTypes = {
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  variant: PropTypes.oneOf(['primary', 'secondary', 'white']),
  label: PropTypes.string,
  className: PropTypes.string,
};

/**
 * Valores por defecto
 */
Spinner.defaultProps = {
  size: 'md',
  variant: 'primary',
  label: '',
  className: '',
};

export default Spinner;
