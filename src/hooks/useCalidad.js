/**
 * @file useCalidad.js
 * @description Hook de conveniencia para consumir el contexto de calidad
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { CalidadContext } from '../context/CalidadContext';

/**
 * Hook para acceder a las inspecciones de calidad y evaluaciones de desempeño
 * @returns {{
 *   inspecciones: Array<Object>,
 *   evaluaciones: Array<Object>,
 *   addInspeccion: function,
 *   editInspeccion: function,
 *   deleteInspeccion: function,
 *   saveEvaluacion: function,
 *   deleteEvaluacion: function
 * }}
 */
const useCalidad = () => {
  const context = useContext(CalidadContext);

  if (!context) {
    throw new Error('useCalidad debe usarse dentro de un CalidadProvider');
  }

  return context;
};

export default useCalidad;
