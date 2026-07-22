/**
 * @file Modal.jsx
 * @description Componente Modal genérico y animado con Framer Motion
 * Proporciona diálogos modales accesibles y con transiciones suaves
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 * @requires prop-types
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './Modal.module.css';

/**
 * Componente Modal - Contenedor superpuesto para formularios o confirmaciones
 * 
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {boolean} props.isOpen - Indica si el modal está visible
 * @param {function} props.onClose - Callback disparado al cerrar el modal
 * @param {string} [props.title] - Título en el encabezado del modal
 * @param {ReactNode} props.children - Contenido interno
 * 
 * @returns {ReactElement|null} Modal renderizado o null si está cerrado
 */
const Modal = ({ isOpen, onClose, title, children, size }) => {
  // Manejar el cierre con la tecla Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Evitar scroll en el fondo cuando el modal está abierto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Variantes para el fondo difuminado
  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  // Variantes para el cuerpo del diálogo
  const modalVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { type: 'spring', duration: 0.4, bounce: 0.15 },
    },
    exit: {
      opacity: 0,
      scale: 0.95,
      y: 15,
      transition: { duration: 0.25 },
    },
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className={styles.wrapper}>
          {/* Fondo / Backdrop */}
          <motion.div
            className={styles.backdrop}
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={onClose}
          />

          {/* Diálogo */}
          <div className={`${styles.container} ${styles[size] || styles.md}`}>
            <motion.div
              className={styles.dialog}
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
            >
              {/* Encabezado */}
              <header className={styles.header}>
                <h3 id="modal-title" className={styles.title}>
                  {title}
                </h3>
                <button
                  className={styles.closeButton}
                  onClick={onClose}
                  aria-label="Cerrar modal"
                >
                  ✕
                </button>
              </header>

              {/* Contenido */}
              <div className={styles.body}>{children}</div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
};

Modal.defaultProps = {
  title: '',
  size: 'md',
};

export default Modal;
