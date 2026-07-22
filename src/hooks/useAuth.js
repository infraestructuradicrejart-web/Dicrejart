/**
 * @file useAuth.js
 * @description Hook de conveniencia para consumir el AuthContext
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Hook para acceder al estado y acciones de autenticación
 * Debe usarse dentro de un árbol envuelto por <AuthProvider>
 *
 * @returns {{user: Object|null, isAuthenticated: boolean, authError: string, login: function, logout: function}}
 */
const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth debe usarse dentro de un <AuthProvider>');
  }

  return context;
};

export default useAuth;
