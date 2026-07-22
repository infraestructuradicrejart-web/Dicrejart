/**
 * @file EmptyState.jsx
 * @description Placeholder de "sin datos" con una figura decorativa del Manual de
 * Identidad Visual de Dicrejart, usado en toda la app en vez de un mensaje de texto plano
 * @author Dicrejart Dev Team
 * @requires react
 */

import React from 'react';
import PropTypes from 'prop-types';
import BrandShape from './BrandShape';
import styles from './EmptyState.module.css';

/**
 * Componente EmptyState - Estado vacío ilustrado
 *
 * @component
 * @param {Object} props
 * @param {string} props.message - Mensaje principal a mostrar
 * @param {('mancha'|'picos'|'trebol'|'cacahuate'|'arco-doble'|'anillo')} [props.shape='trebol'] - Figura decorativa
 * @param {string} [props.color='var(--color-gray-300)'] - Color de la figura
 * @returns {ReactElement} Estado vacío renderizado
 *
 * @example
 * <EmptyState message="No se encontraron juegos activos." shape="trebol" />
 */
const EmptyState = ({ message, shape = 'trebol', color = 'var(--color-gray-300)' }) => {
  return (
    <div className={styles.container}>
      <BrandShape shape={shape} color={color} className={styles.shape} />
      <p className={styles.message}>{message}</p>
    </div>
  );
};

EmptyState.propTypes = {
  message: PropTypes.string.isRequired,
  shape: PropTypes.oneOf(['mancha', 'picos', 'trebol', 'cacahuate', 'arco-doble', 'anillo']),
  color: PropTypes.string,
};

export default EmptyState;
