/**
 * @file PageHeader.jsx
 * @description Encabezado de página estandarizado para toda la aplicación Dicrejart
 * Aplica el lenguaje visual del Manual de Identidad: tarjeta redondeada grande,
 * título en Outfit, barra de acento de color y una figura decorativa de marca
 * ("Gráficos Auxiliares" del manual) sangrada en la esquina
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import BrandShape from './BrandShape';
import styles from './PageHeader.module.css';

/**
 * Componente PageHeader - Encabezado visual de cada sección de la app
 *
 * @component
 * @param {Object} props
 * @param {string} props.title - Título principal de la página
 * @param {string} [props.subtitle] - Texto de apoyo bajo el título
 * @param {('mancha'|'picos'|'trebol'|'cacahuate'|'arco-doble'|'anillo')} [props.shape='anillo'] - Figura de marca decorativa
 * @param {string} [props.accentColor='var(--color-primary)'] - Color de la barra de acento y la figura
 * @param {ReactNode} [props.children] - Acciones (botones) alineadas a la derecha del encabezado
 * @returns {ReactElement} Encabezado renderizado
 *
 * @example
 * <PageHeader title="Líneas de Juegos" subtitle="Diseña y monitorea..." shape="picos" accentColor="var(--color-golden-yellow)">
 *   <Button variant="primary">Registrar Nuevo Juego</Button>
 * </PageHeader>
 */
const PageHeader = ({ title, subtitle, shape = 'anillo', accentColor = 'var(--color-primary)', children }) => {
  return (
    <motion.div
      className={styles.banner}
      style={{ '--accent-color': accentColor }}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <BrandShape shape={shape} color={accentColor} className={styles.shape} />

      <div className={styles.content}>
        <div className={styles.text}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>

        {children && <div className={styles.actions}>{children}</div>}
      </div>
    </motion.div>
  );
};

PageHeader.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  shape: PropTypes.oneOf(['mancha', 'picos', 'trebol', 'cacahuate', 'arco-doble', 'anillo']),
  accentColor: PropTypes.string,
  children: PropTypes.node,
};

export default PageHeader;
