/**
 * @file Button.jsx
 * @description Componente Button reutilizable para Dicrejart
 * Soporta múltiples variantes (primary, secondary, danger), tamaños y estados
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import styles from './Button.module.css';

/**
 * Componente Button - Botón interactivo con animaciones y múltiples variantes
 * 
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {string} [props.variant='primary'] - Variante visual ('primary', 'secondary', 'danger', 'ghost')
 * @param {string} [props.size='md'] - Tamaño del botón ('sm', 'md', 'lg', 'xl')
 * @param {boolean} [props.isLoading=false] - Si true, muestra spinner y desactiva interacción
 * @param {boolean} [props.isDisabled=false] - Si true, desactiva el botón
 * @param {boolean} [props.fullWidth=false] - Si true, el botón ocupa el 100% del ancho
 * @param {string} [props.type='button'] - Tipo de botón ('button', 'submit', 'reset')
 * @param {function} [props.onClick] - Handler para click del botón
 * @param {ReactNode} props.children - Contenido del botón
 * @param {string} [props.className] - Clases CSS adicionales
 * 
 * @returns {ReactElement} Botón renderizado con animaciones Framer Motion
 * 
 * @example
 * // Botón primario
 * <Button variant="primary" size="lg" onClick={handleClick}>
 *   Guardar
 * </Button>
 * 
 * @example
 * // Botón cargando
 * <Button isLoading={isSubmitting} type="submit">
 *   Registrar
 * </Button>
 * 
 * @example
 * // Botón peligroso (rojo)
 * <Button variant="danger" onClick={handleDelete}>
 *   Eliminar
 * </Button>
 */
const Button = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  isDisabled = false,
  fullWidth = false,
  type = 'button',
  onClick,
  children,
  className = '',
  ...props
}) => {
  // Determina si el botón está desactivado (por loading o isDisabled)
  const isButtonDisabled = isLoading || isDisabled;

  // Construye la clase CSS con todas las variantes
  const buttonClass = `
    ${styles.button}
    ${styles[`variant-${variant}`]}
    ${styles[`size-${size}`]}
    ${fullWidth ? styles['full-width'] : ''}
    ${isButtonDisabled ? styles.disabled : ''}
    ${className}
  `.trim();

  // Variantes de animación Framer Motion
  const buttonVariants = {
    // Estado inicial (reposo)
    rest: {
      scale: 1,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
    },
    // Al hacer hover
    hover: {
      scale: 1.05,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
      transition: {
        duration: 0.2,
        ease: 'easeOut',
      },
    },
    // Al hacer click
    tap: {
      scale: 0.98,
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    },
  };

  /**
   * Spinner animation para estado de carga
   * Rotación continua
   */
  const spinnerVariants = {
    animate: {
      rotate: 360,
      transition: {
        duration: 1,
        repeat: Infinity,
        ease: 'linear',
      },
    },
  };

  return (
    <motion.button
      type={type}
      className={buttonClass}
      onClick={onClick}
      disabled={isButtonDisabled}
      variants={buttonVariants}
      initial="rest"
      whileHover={!isButtonDisabled ? 'hover' : 'rest'}
      whileTap={!isButtonDisabled ? 'tap' : 'rest'}
      {...props}
    >
      {/* Mostrar spinner si está en estado de carga */}
      {isLoading ? (
        <motion.span
          className={styles.spinner}
          variants={spinnerVariants}
          animate="animate"
          aria-label="Cargando"
        >
          ⟳
        </motion.span>
      ) : null}

      {/* Contenido del botón */}
      <span className={styles.content}>
        {children}
      </span>
    </motion.button>
  );
};

/**
 * PropTypes para validación de tipos
 * Asegura que las props pasadas sean del tipo correcto
 */
Button.propTypes = {
  variant: PropTypes.oneOf(['primary', 'secondary', 'danger', 'ghost']),
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  isLoading: PropTypes.bool,
  isDisabled: PropTypes.bool,
  fullWidth: PropTypes.bool,
  type: PropTypes.oneOf(['button', 'submit', 'reset']),
  onClick: PropTypes.func,
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
};

/**
 * Valores por defecto
 */
Button.defaultProps = {
  variant: 'primary',
  size: 'md',
  isLoading: false,
  isDisabled: false,
  fullWidth: false,
  type: 'button',
  onClick: () => {},
  className: '',
};

export default Button;
