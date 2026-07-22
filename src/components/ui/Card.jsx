/**
 * @file Card.jsx
 * @description Componente Card reutilizable para Dicrejart
 * Contenedor de contenido con elevación, hover effects y estilos consistentes
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import BrandShape from './BrandShape';
import styles from './Card.module.css';

/**
 * Componente Card - Contenedor de contenido con estilo elevado
 * 
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {ReactNode} props.children - Contenido dentro de la card
 * @param {string} [props.variant='default'] - Variante de estilo ('default', 'highlight', 'success', 'warning', 'danger')
 * @param {boolean} [props.hoverable=false] - Si true, la card tiene efecto hover
 * @param {boolean} [props.clickable=false] - Si true, la card parece clickeable
 * @param {function} [props.onClick] - Handler para click
 * @param {string} [props.className] - Clases CSS adicionales
 * @param {boolean} [props.animated=true] - Si true, entra con animación
 * 
 * @returns {ReactElement} Card renderizada
 * 
 * @example
 * // Card simple
 * <Card>
 *   <h3>Título</h3>
 *   <p>Contenido</p>
 * </Card>
 * 
 * @example
 * // Card con hover
 * <Card hoverable onClick={handleClick}>
 *   <p>Haz click en mí</p>
 * </Card>
 * 
 * @example
 * // Card de éxito
 * <Card variant="success">
 *   <p>✓ Operación completada</p>
 * </Card>
 */
const Card = ({
  children,
  variant = 'default',
  hoverable = false,
  clickable = false,
  onClick,
  className = '',
  animated = true,
  shape,
  shapeColor = 'var(--color-primary)',
  ...props
}) => {
  // Construye la clase CSS
  const cardClass = `
    ${styles.card}
    ${styles[`variant-${variant}`]}
    ${hoverable ? styles.hoverable : ''}
    ${clickable ? styles.clickable : ''}
    ${shape ? styles.hasShape : ''}
    ${className}
  `.trim();

  // Variantes de animación
  const cardVariants = {
    // Estado inicial - entra con fade y slide up
    initial: animated ? {
      opacity: 0,
      y: 20,
    } : {},
    
    // Estado final - visible
    animate: animated ? {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.3,
        ease: 'easeOut',
      },
    } : {},
    
    // Hover effect (si es hoverable)
    hover: hoverable ? {
      y: -4,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
      transition: {
        duration: 0.2,
        ease: 'easeOut',
      },
    } : {},
  };

  return (
    <motion.div
      className={cardClass}
      variants={cardVariants}
      initial={animated ? 'initial' : false}
      animate={animated ? 'animate' : false}
      whileHover={hoverable ? 'hover' : false}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      {...props}
    >
      {shape && <BrandShape shape={shape} color={shapeColor} className={styles.cornerShape} />}
      {children}
    </motion.div>
  );
};

/**
 * PropTypes para validación
 */
Card.propTypes = {
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['default', 'highlight', 'success', 'warning', 'danger']),
  hoverable: PropTypes.bool,
  clickable: PropTypes.bool,
  onClick: PropTypes.func,
  className: PropTypes.string,
  animated: PropTypes.bool,
  shape: PropTypes.oneOf(['mancha', 'picos', 'trebol', 'cacahuate', 'arco-doble', 'anillo']),
  shapeColor: PropTypes.string,
};

/**
 * Valores por defecto
 */
Card.defaultProps = {
  variant: 'default',
  hoverable: false,
  clickable: false,
  onClick: () => {},
  className: '',
  animated: true,
  shape: undefined,
  shapeColor: 'var(--color-primary)',
};

export default Card;
