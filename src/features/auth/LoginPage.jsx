/**
 * @file LoginPage.jsx
 * @description Página de login — panel de marca (morado, logo + mascota DicreJart) a la
 * izquierda y formulario en blanco a la derecha. Diseño tomado del mockup entregado
 * ("login-dicrejart-2b-standalone.html"), conectado a la autenticación real de Firebase.
 * @author Dicrejart Dev Team
 */

import React, { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Logo } from '../../components/ui/Logo';
import BrandShape from '../../components/ui/BrandShape';
import useAuth from '../../hooks/useAuth';
import { getHomeRoute } from '../../utils/roleAccess';
import mascotImg from '../../assets/login/mascota-dicrejart.png';
import trailImg from '../../assets/login/gidi-trail.png';
import logoImg from '../../assets/login/dicrejart-logo-hd.png';
import styles from './LoginPage.module.css';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminName, setAdminName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState('login');
  const [showForgotInfo, setShowForgotInfo] = useState(false);

  const { isAuthenticated, user, login, authError, isSystemEmpty, registerFirstAdmin, loading } = useAuth();
  const location = useLocation();
  // Se conserva también el query string (ej. "?proyectoId=..." del Editor Visual) al
  // regresar de este breve rebote por /login que ocurre mientras se restaura la sesión
  const fromLocation = location.state?.from;
  const from = fromLocation ? `${fromLocation.pathname}${fromLocation.search || ''}` : getHomeRoute(user);

  useEffect(() => {
    setMode(isSystemEmpty ? 'register' : 'login');
  }, [isSystemEmpty]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(async () => {
      await login(email, password);
      setIsSubmitting(false);
    }, 400);
  };

  const handleRegisterAdmin = async (e) => {
    e.preventDefault();
    setRegisterError('');
    if (password !== confirmPassword) {
      setRegisterError('Las contraseñas no coinciden.');
      return;
    }
    if (password.length < 6) {
      setRegisterError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setIsSubmitting(true);
    const res = await registerFirstAdmin(adminName, email, password);
    setIsSubmitting(false);
    if (!res.ok) {
      setRegisterError(res.error);
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingPage}>
        <Logo color="secondary" width={200} />
        <span className={styles.spinnerDark} />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  return (
    <div className={styles.page}>
      {/* ── Panel de marca (logo + mascota) ── */}
      <div className={styles.brandPanel}>
        <BrandShape shape="anillo" color="#9c2d95" className={styles.cornerTL} />
        <BrandShape shape="anillo" color="#6b3fa0" className={styles.cornerTR} />
        <BrandShape shape="anillo" color="#6b3fa0" className={styles.cornerBL} />
        <BrandShape shape="anillo" color="#9c2d95" className={styles.cornerBR} />

        <div className={styles.centerpiece}>
          <BrandShape shape="anillo" color="#ff2f1f" className={styles.centerFlower} />
          <div className={styles.badge}>
            <img src={logoImg} alt="DicreJart Grupo" className={styles.badgeLogo} />
          </div>
        </div>
      </div>

      {/* ── Panel del formulario ── */}
      <div className={styles.formPanel}>
        <motion.div
          className={styles.formCard}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <div className={styles.mobileLogo}>
            <Logo color="primary" width={190} />
          </div>

          <div className={styles.titleRow}>
            <h1 className={styles.title}>
              {mode === 'register' ? 'Configuración inicial' : 'Iniciar sesión'}
            </h1>
            <div className={styles.mascotGroup}>
              <img src={trailImg} alt="" className={styles.mascotTrail} />
              <img src={mascotImg} alt="Mascota DicreJart saltando" className={styles.titleMascot} />
            </div>
          </div>
          <p className={styles.subtitle}>
            {mode === 'register'
              ? 'Crea la cuenta del primer Administrador del sistema'
              : 'Accede a tu panel de DicreJart'}
          </p>

          {mode === 'register' ? (
            <form onSubmit={handleRegisterAdmin} className={styles.form}>
              {registerError && <span className={styles.errorMsg}>⚠ {registerError}</span>}

              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="reg-name">Nombre completo</label>
                <input
                  id="reg-name"
                  type="text"
                  className={styles.input}
                  placeholder="Nombre del Administrador"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="reg-email">Correo electrónico</label>
                <input
                  id="reg-email"
                  type="email"
                  className={styles.input}
                  placeholder="nombre@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="reg-password">Contraseña</label>
                <input
                  id="reg-password"
                  type="password"
                  className={styles.input}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="reg-conf-password">Confirmar contraseña</label>
                <input
                  id="reg-conf-password"
                  type="password"
                  className={styles.input}
                  placeholder="Repite la contraseña"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
                {isSubmitting ? <span className={styles.spinner} /> : 'Registrar y acceder'}
              </button>

              <button type="button" className={styles.toggleModeBtn} onClick={() => setMode('login')}>
                ¿Ya tienes una cuenta? Iniciar sesión
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="login-email">Correo electrónico</label>
                <input
                  id="login-email"
                  type="email"
                  className={styles.input}
                  placeholder="nombre@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>

              <div className={styles.fieldGroup}>
                <div className={styles.labelRow}>
                  <label className={styles.label} htmlFor="login-password">Contraseña</label>
                  <button
                    type="button"
                    className={styles.forgotLink}
                    onClick={() => setShowForgotInfo((v) => !v)}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <input
                  id="login-password"
                  type="password"
                  className={`${styles.input} ${authError ? styles.inputError : ''}`}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                {showForgotInfo && (
                  <span className={styles.infoMsg}>
                    Contacta a un Administrador para restablecer tu contraseña.
                  </span>
                )}
                {authError && <span className={styles.errorMsg}>⚠ {authError}</span>}
              </div>

              <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
                {isSubmitting ? <span className={styles.spinner} /> : 'Iniciar sesión'}
              </button>

              {isSystemEmpty && (
                <button type="button" className={styles.toggleModeBtn} onClick={() => setMode('register')}>
                  ¿No hay administradores registrados? Configurar sistema
                </button>
              )}
            </form>
          )}

          <p className={styles.footerText}>www.grupodicrejart.com</p>
        </motion.div>
      </div>
    </div>
  );
};

export default LoginPage;
