/**
 * @file ProtectedRoute.jsx
 * @description Guarda de rutas que requieren sesión iniciada
 * Redirige a /login si no hay usuario autenticado, conservando la ruta
 * original para regresar a ella después de iniciar sesión
 * @author Dicrejart Dev Team
 * @requires react
 * @requires react-router-dom
 */

import React from 'react';
import PropTypes from 'prop-types';
import { Navigate, useLocation } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import useConfig from '../../hooks/useConfig';
import useInactivityLock from '../../hooks/useInactivityLock';
import { Logo } from '../ui/Logo';
import Button from '../ui/Button';
import LockScreen from '../ui/LockScreen';

// Tiempo sin actividad (mouse, teclado, touch, scroll) antes de bloquear la sesión
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Componente ProtectedRoute
 * Envuelve contenido que solo debe verse con sesión iniciada
 *
 * @component
 * @param {Object} props
 * @param {ReactNode} props.children - Contenido a proteger
 * @returns {ReactElement} Children si hay sesión, o redirección a /login
 */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading, user, logout } = useAuth();
  const { generalConfig } = useConfig();
  const location = useLocation();
  // Se llama siempre, sin importar `loading`/`isAuthenticated` (reglas de los Hooks) —
  // mientras no haya sesión sus listeners de actividad no le hacen daño a nadie, y
  // `locked` nunca importa porque los `return` de abajo nunca llegan a usarlo.
  const { locked, unlock } = useInactivityLock(INACTIVITY_TIMEOUT_MS);

  // Mientras se restaura la sesión (ej. justo después de un refresco de página) no se
  // sabe todavía si hay usuario o no; redirigir de una vez a /login perdería la ruta
  // y los parámetros de búsqueda actuales en el rebote. Se espera a que `loading`
  // termine antes de decidir.
  if (loading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Modo Mantenimiento: bloquea el acceso de cualquiera que no sea Admin. Se revisa
  // aquí (y no en AuthContext) porque ConfigProvider ya envuelve a ProtectedRoute y
  // necesita tanto el rol del usuario en sesión como la config persistida en Firestore.
  if (generalConfig.maintenanceMode && user?.roleType !== 'admin') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-5)',
          padding: 'var(--space-6)',
          textAlign: 'center',
          background: 'var(--color-dark, #1a1a2e)',
        }}
      >
        <Logo color="white" width={180} />
        <h1 style={{ color: '#fff', fontSize: '24px', margin: 0 }}>🚧 Sistema en Mantenimiento</h1>
        <p style={{ color: 'var(--color-gray-300, #ccc)', maxWidth: 420 }}>
          Un administrador está realizando actualizaciones. Intenta de nuevo en unos minutos.
        </p>
        <Button variant="secondary" size="md" onClick={logout}>
          Cerrar sesión
        </Button>
      </div>
    );
  }

  // La app sigue montada detrás (no se pierde estado en pantalla ni se cae ningún
  // listener de Firestore): la pantalla de bloqueo solo se dibuja encima.
  return (
    <>
      {children}
      {locked && <LockScreen onUnlock={unlock} />}
    </>
  );
};

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ProtectedRoute;
