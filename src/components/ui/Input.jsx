/**
 * @file Input.jsx
 * @description Componente Input reutilizable para Dicrejart
 * Soporta validación visual, error messages, y múltiples tipos
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './Input.module.css';

/**
 * Componente Input - Campo de entrada de datos
 * 
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {string} [props.type='text'] - Tipo de input (text, email, password, number, date, etc)
 * @param {string} props.label - Etiqueta descriptiva del campo
 * @param {string} [props.placeholder] - Texto de placeholder
 * @param {string} [props.value] - Valor controlado del input
 * @param {function} [props.onChange] - Handler para cambios en el valor
 * @param {string} [props.error] - Mensaje de error a mostrar
 * @param {string} [props.helperText] - Texto de ayuda adicional
 * @param {boolean} [props.required=false] - Si el campo es requerido
 * @param {boolean} [props.disabled=false] - Si el campo está deshabilitado
 * @param {boolean} [props.isSuccess=false] - Si el valor es válido/correcto
 * @param {string} [props.icon] - Ícono para mostrar al lado del input (emoji o símbolo)
 * @param {string} [props.className] - Clases CSS adicionales
 * 
 * @returns {ReactElement} Input renderizado
 * 
 * @example
 * // Input simple
 * <Input
 *   label="Nombre"
 *   placeholder="Ingresa tu nombre"
 *   value={name}
 *   onChange={(e) => setName(e.target.value)}
 * />
 * 
 * @example
 * // Input con validación
 * <Input
 *   type="email"
 *   label="Email"
 *   value={email}
 *   onChange={handleEmailChange}
 *   error={emailError}
 *   isSuccess={isEmailValid}
 * />
 */
const Input = ({
  type = 'text',
  label,
  placeholder,
  value,
  onChange,
  error,
  helperText,
  required = false,
  disabled = false,
  isSuccess = false,
  icon,
  className = '',
  ...props
}) => {
  // Estado local para focus visual
  const [isFocused, setIsFocused] = useState(false);

  // Determina el estado visual del input
  const hasError = Boolean(error);
  const showSuccess = isSuccess && !hasError && value;

  // Clases CSS
  const inputWrapperClass = `
    ${styles['input-wrapper']}
    ${isFocused ? styles.focused : ''}
    ${hasError ? styles.error : ''}
    ${showSuccess ? styles.success : ''}
    ${disabled ? styles.disabled : ''}
    ${className}
  `.trim();

  /**
   * Handler para cambios en el input
   * Ejecuta el callback onChange si se proporciona
   */
  const handleChange = (e) => {
    if (onChange) {
      onChange(e);
    }
  };

  /**
   * Handler para focus del input
   */
  const handleFocus = () => {
    setIsFocused(true);
  };

  /**
   * Handler para blur del input
   */
  const handleBlur = () => {
    setIsFocused(false);
  };

  // Variantes de animación para el label
  const labelVariants = {
    // Label en su posición original (abajo del input)
    initial: {
      y: 0,
      opacity: 1,
      fontSize: '14px',
    },
    // Label flotante (arriba, pequeño)
    float: {
      y: -24,
      opacity: 1,
      fontSize: '12px',
    },
  };

  // Determina si el label debe flotar
  const shouldFloatLabel = isFocused || value;

  return (
    <div className={styles.container}>
      {/* Wrapper del input con bordes y sombra */}
      <div className={inputWrapperClass}>
        {/* Ícono (opcional) - lado izquierdo */}
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}

        {/* Contenedor del input y label */}
        <div className={styles['input-group']}>
          {/* Input */}
          <input
            type={type}
            className={styles.input}
            placeholder={placeholder || label}
            value={value}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            required={required}
            aria-label={label}
            aria-invalid={hasError}
            aria-describedby={hasError ? `${label}-error` : undefined}
            {...props}
          />

          {/* Label flotante */}
          {label && (
            <motion.label
              className={styles.label}
              variants={labelVariants}
              animate={shouldFloatLabel ? 'float' : 'initial'}
              transition={{ duration: 0.2 }}
            >
              {label}
              {required && <span className={styles.required}>*</span>}
            </motion.label>
          )}
        </div>

        {/* Indicadores de estado (ícono de validación) */}
        <div className={styles['status-icons']}>
          {/* Ícono de error */}
          <AnimatePresence>
            {hasError && (
              <motion.span
                className={styles['icon-error']}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ duration: 0.2 }}
                aria-hidden="true"
              >
                ✕
              </motion.span>
            )}
          </AnimatePresence>

          {/* Ícono de éxito */}
          <AnimatePresence>
            {showSuccess && (
              <motion.span
                className={styles['icon-success']}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ duration: 0.2 }}
                aria-hidden="true"
              >
                ✓
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Mensaje de error (si existe) */}
      <AnimatePresence>
        {hasError && (
          <motion.div
            className={styles['error-message']}
            id={`${label}-error`}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Texto de ayuda (si no hay error) */}
      <AnimatePresence>
        {helperText && !hasError && (
          <motion.div
            className={styles['helper-text']}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {helperText}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * PropTypes para validación
 */
Input.propTypes = {
  type: PropTypes.string,
  label: PropTypes.string,
  placeholder: PropTypes.string,
  value: PropTypes.string,
  onChange: PropTypes.func,
  error: PropTypes.string,
  helperText: PropTypes.string,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  isSuccess: PropTypes.bool,
  icon: PropTypes.string,
  className: PropTypes.string,
};

/**
 * Valores por defecto
 */
Input.defaultProps = {
  type: 'text',
  label: '',
  placeholder: '',
  value: '',
  onChange: () => {},
  error: '',
  helperText: '',
  required: false,
  disabled: false,
  isSuccess: false,
  icon: '',
  className: '',
};

export default Input;
