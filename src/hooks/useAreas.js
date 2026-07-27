/**
 * @file useAreas.js
 * @description Hook de conveniencia para consumir el contexto de Áreas de Producción
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { AreasContext } from '../context/AreasContext';

/**
 * Hook para acceder a la configuración dinámica de áreas.
 * @returns {{
 *   areas: Array<{id: string, name: string}>,
 *   isLoading: boolean,
 *   resolveAreaId: function,
 *   addArea: function,
 *   updateArea: function,
 *   deleteArea: function
 * }}
 */
const useAreas = () => {
  const context = useContext(AreasContext);

  if (!context) {
    throw new Error('useAreas debe usarse dentro de un AreasProvider');
  }

  return context;
};

export default useAreas;
