/**
 * @file CornerMascot.jsx
 * @description GIDI, la mascota de Dicrejart, flotando fija en la esquina inferior
 * derecha de todas las páginas internas de la app (dentro de MainLayout). Por ahora
 * es solo decorativa; sirve de base para agregarle funciones más adelante.
 * @author Dicrejart Dev Team
 * @requires react
 */

import React from 'react';
import mascotImg from '../../assets/login/mascota-dicrejart.png';
import styles from './CornerMascot.module.css';

/**
 * Componente CornerMascot - GIDI flotando en la esquina inferior derecha
 * @component
 * @returns {ReactElement} Imagen fija de la mascota
 */
const CornerMascot = () => {
  return (
    <div className={styles.container}>
      <img src={mascotImg} alt="GIDI" className={styles.mascot} />
    </div>
  );
};

export default CornerMascot;
