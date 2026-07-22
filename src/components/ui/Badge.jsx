/**
 * @file Badge.jsx
 * @description Componente Badge reutilizable para Dicrejart
 * Insignia compacta para mostrar estados (aprobado, rechazado, activo, etc.)
 * @author Dicrejart Dev Team
 * @requires react
 */

import React from 'react';
import PropTypes from 'prop-types';
import styles from './Badge.module.css';

/**
 * Componente Badge - Insignia de estado
 *
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {ReactNode} props.children - Contenido de la insignia (texto corto)
 * @param {string} [props.variant='neutral'] - Variante visual ('neutral', 'primary', 'success', 'warning', 'danger', 'info')
 * @param {string} [props.size='md'] - Tamaño de la insignia ('sm', 'md')
 * @param {string} [props.className] - Clases CSS adicionales
 *
 * @returns {ReactElement} Badge renderizado
 *
 * @example
 * <Badge variant="success">APROBADO</Badge>
 *
 * @example
 * <Badge variant="danger" size="sm">RECHAZADO</Badge>
 */
const Badge = ({ children, variant = 'neutral', size = 'md', className = '' }) => {
  const badgeClass = `
    ${styles.badge}
    ${styles[`variant-${variant}`]}
    ${styles[`size-${size}`]}
    ${className}
  `.trim();

  return <span className={badgeClass}>{children}</span>;
};

/**
 * PropTypes para validación de tipos
 */
Badge.propTypes = {
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['neutral', 'primary', 'success', 'warning', 'danger', 'info']),
  size: PropTypes.oneOf(['sm', 'md']),
  className: PropTypes.string,
};

/**
 * Valores por defecto
 */
Badge.defaultProps = {
  variant: 'neutral',
  size: 'md',
  className: '',
};

export default Badge;
