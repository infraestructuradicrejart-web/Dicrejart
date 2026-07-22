/**
 * @file useToast.js
 * @description Hook de conveniencia para consumir el ToastContext
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { ToastContext } from '../context/ToastContext';

/**
 * Hook para mostrar notificaciones toast desde cualquier componente
 * Debe usarse dentro de un árbol envuelto por <ToastProvider>
 *
 * @returns {{showToast: function, success: function, danger: function, warning: function, info: function}}
 *
 * @example
 * const toast = useToast();
 * toast.success('Registro guardado exitosamente');
 * toast.danger('Por favor completa todos los campos obligatorios.');
 */
const useToast = () => {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast debe usarse dentro de un <ToastProvider>');
  }

  return context;
};

export default useToast;
