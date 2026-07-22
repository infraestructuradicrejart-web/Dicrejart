/**
 * @file useActividades.js
 * @description Hook de conveniencia para consumir el contexto de actividades
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { ActividadesContext } from '../context/ActividadesContext';

/**
 * Hook para acceder a las actividades operativas no ligadas a un juego
 * @returns {{
 *   actividades: Array<Object>,
 *   addActividad: function,
 *   advanceStatus: function,
 *   deleteActividad: function
 * }}
 */
const useActividades = () => {
  const context = useContext(ActividadesContext);

  if (!context) {
    throw new Error('useActividades debe usarse dentro de un ActividadesProvider');
  }

  return context;
};

export default useActividades;
