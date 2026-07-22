/**
 * @file Select.jsx
 * @description Componente Select reutilizable para Dicrejart
 * Desplegable con estilo consistente al resto de los campos de formulario (ver Input.jsx)
 * @author Dicrejart Dev Team
 * @requires react
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import styles from './Select.module.css';

/**
 * Componente Select - Campo de selección de una opción entre varias
 *
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {string} [props.label] - Etiqueta descriptiva del campo
 * @param {string|number} [props.value] - Valor controlado seleccionado
 * @param {function} [props.onChange] - Handler para cambios en el valor
 * @param {Array<{value: string|number, label: string}>} props.options - Opciones disponibles
 * @param {string} [props.placeholder] - Opción deshabilitada mostrada cuando no hay valor elegido
 * @param {string} [props.error] - Mensaje de error a mostrar
 * @param {string} [props.helperText] - Texto de ayuda adicional
 * @param {boolean} [props.required=false] - Si el campo es requerido
 * @param {boolean} [props.disabled=false] - Si el campo está deshabilitado
 * @param {string} [props.name] - Nombre del campo (para handlers genéricos por evento)
 * @param {string} [props.className] - Clases CSS adicionales
 *
 * @returns {ReactElement} Select renderizado
 *
 * @example
 * <Select
 *   label="Área Auditada"
 *   name="areaId"
 *   value={areaId}
 *   onChange={handleChange}
 *   options={AREAS.map((a) => ({ value: a.id, label: a.name }))}
 * />
 */
const Select = ({
  label = '',
  value,
  onChange,
  options = [],
  placeholder = '',
  error = '',
  helperText = '',
  required = false,
  disabled = false,
  name,
  className = '',
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const hasError = Boolean(error);

  const wrapperClass = `
    ${styles['select-wrapper']}
    ${isFocused ? styles.focused : ''}
    ${hasError ? styles.error : ''}
    ${disabled ? styles.disabled : ''}
    ${className}
  `.trim();

  return (
    <div className={styles.container}>
      {label && (
        <label className={styles.label} htmlFor={name}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}

      <div className={wrapperClass}>
        <select
          id={name}
          name={name}
          className={styles.select}
          value={value}
          onChange={onChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          required={required}
          aria-label={label || name}
          aria-invalid={hasError}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={styles['dropdown-icon']} aria-hidden="true">
          ▼
        </span>
      </div>

      {hasError && <div className={styles['error-message']}>{error}</div>}
      {helperText && !hasError && (
        <div className={styles['helper-text']}>{helperText}</div>
      )}
    </div>
  );
};

/**
 * PropTypes para validación
 */
Select.propTypes = {
  label: PropTypes.string,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onChange: PropTypes.func,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      label: PropTypes.string.isRequired,
    })
  ).isRequired,
  placeholder: PropTypes.string,
  error: PropTypes.string,
  helperText: PropTypes.string,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  name: PropTypes.string,
  className: PropTypes.string,
};

/**
 * Valores por defecto
 */
Select.defaultProps = {
  label: '',
  value: '',
  onChange: () => {},
  placeholder: '',
  error: '',
  helperText: '',
  required: false,
  disabled: false,
  name: undefined,
  className: '',
};

export default Select;
