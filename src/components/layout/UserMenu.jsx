/**
 * @file UserMenu.jsx
 * @description Círculo flotante con las iniciales del usuario en sesión (con anillo
 * pulsante de "en línea"), fijo en la esquina superior derecha de la app. Es todo lo
 * que queda de la antigua barra superior tras eliminarla: al hacer click abre un menú
 * con perfil, configuración (solo Admin) y cerrar sesión.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import ThemeToggle from '../ui/ThemeToggle';
import styles from './UserMenu.module.css';

/**
 * @param {Object} props
 * @param {string} [props.userName='Administrador'] - Nombre del usuario en sesión
 * @param {string} [props.userEmail=''] - Correo del usuario en sesión
 * @param {Object} [props.user] - Usuario autenticado completo (para revisar el rol)
 * @param {function} [props.onLogout] - Callback para cerrar sesión
 * @param {function} [props.onNavigate] - Callback de navegación (ej. a "admin")
 */
const UserMenu = ({ userName = 'Administrador', userEmail = '', user = null, onLogout, onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = () => setIsOpen((v) => !v);
  const handleClose = () => setIsOpen(false);

  const handleLogoutClick = () => {
    handleClose();
    onLogout?.();
  };

  const menuVariants = {
    initial: { opacity: 0, y: -10, pointerEvents: 'none' },
    animate: { opacity: 1, y: 0, pointerEvents: 'auto' },
  };

  const initials = userName
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className={styles.container}>
      <button
        className={styles['user-button']}
        onClick={handleToggle}
        aria-label={`Menú de usuario - ${userName}`}
        title={`${userName} (${userEmail})`}
      >
        <span className={styles['avatar-ring']}>
          <span className={styles.avatar}>{initials}</span>
        </span>
      </button>

      {isOpen && (
        <motion.div
          className={styles['user-dropdown']}
          variants={menuVariants}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <button className={styles['dropdown-item']} onClick={handleClose}>
            👤 Mi Perfil
          </button>

          {user?.roleType === 'admin' && (
            <button
              className={styles['dropdown-item']}
              onClick={() => {
                handleClose();
                onNavigate?.('admin');
              }}
            >
              ⚙️ Configuración
            </button>
          )}

          <div style={{ padding: '4px 8px' }}>
            <ThemeToggle variant="switch" />
          </div>

          <div className={styles['dropdown-divider']} />

          <button className={`${styles['dropdown-item']} ${styles['logout-item']}`} onClick={handleLogoutClick}>
            🚪 Cerrar Sesión
          </button>
        </motion.div>
      )}
    </div>
  );
};

UserMenu.propTypes = {
  userName: PropTypes.string,
  userEmail: PropTypes.string,
  user: PropTypes.object,
  onLogout: PropTypes.func,
  onNavigate: PropTypes.func,
};

export default UserMenu;
