/**
 * @file LockScreen.jsx
 * @description Pantalla de bloqueo por inactividad: cubre toda la app y exige la
 * contraseña del usuario en sesión para continuar. No cierra la sesión real (los
 * contextos y listeners de Firestore siguen activos detrás), solo bloquea la
 * interacción hasta que se confirme la contraseña.
 * @author Dicrejart Dev Team
 * @requires react
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import { Logo } from './Logo';
import Button from './Button';
import useAuth from '../../hooks/useAuth';
import styles from './LockScreen.module.css';

/**
 * @param {Object} props
 * @param {function} props.onUnlock - Se llama cuando la contraseña ingresada es correcta
 */
const LockScreen = ({ onUnlock }) => {
  const { user, verifyPassword, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsChecking(true);
    const ok = await verifyPassword(password);
    setIsChecking(false);

    if (ok) {
      setPassword('');
      onUnlock();
    } else {
      setError('Contraseña incorrecta. Intenta de nuevo.');
    }
  };

  return (
    <div className={styles.overlay}>
      <motion.div
        className={styles.card}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <Logo color="secondary" width={150} />
        <p className={styles.hint}>Sesión bloqueada por inactividad</p>
        <p className={styles.userName}>{user?.name}</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="password"
            autoFocus
            className={styles.input}
            placeholder="Ingresa tu contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <span className={styles.error}>⚠ {error}</span>}
          <Button type="submit" variant="primary" size="md" fullWidth isLoading={isChecking}>
            Desbloquear
          </Button>
        </form>

        <button type="button" className={styles.logoutLink} onClick={logout}>
          Cerrar sesión
        </button>
      </motion.div>
    </div>
  );
};

LockScreen.propTypes = {
  onUnlock: PropTypes.func.isRequired,
};

export default LockScreen;
