/**
 * @file Switch.jsx
 * @description Interruptor de encendido/apagado reutilizable. Extrae el patrón visual
 * que ya existía copiado 3 veces dentro de AdminPage.jsx (Modo Mantenimiento, Alertas de
 * Calidad, Notificar Faltas a RH) para poder usarlo también en el nuevo panel de
 * Permisos por usuario, donde se necesitan muchos interruptores por usuario.
 * @author Dicrejart Dev Team
 * @requires react
 */

import React from 'react';
import PropTypes from 'prop-types';
import styles from './Switch.module.css';

/**
 * Componente Switch - Interruptor deslizante encendido/apagado
 * @component
 * @param {Object} props
 * @param {boolean} props.checked - Estado actual (encendido/apagado)
 * @param {function} props.onChange - Callback al hacer click, recibe el nuevo valor
 * @param {boolean} [props.disabled] - Deshabilita la interacción
 * @param {string} [props.ariaLabel] - Etiqueta accesible cuando no hay texto visible junto al switch
 * @returns {ReactElement}
 */
const Switch = ({ checked, onChange, disabled, ariaLabel }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`${styles.toggle} ${checked ? styles.toggleActive : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className={styles.toggleKnob} />
    </button>
  );
};

Switch.propTypes = {
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  ariaLabel: PropTypes.string,
};

Switch.defaultProps = {
  disabled: false,
  ariaLabel: undefined,
};

export default Switch;
