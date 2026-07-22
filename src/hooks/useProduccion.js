/**
 * @file useProduccion.js
 * @description Hook de conveniencia para consumir el contexto de producción
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { ProduccionContext } from '../context/ProduccionContext';

/**
 * Hook para acceder a los datos de proyectos, juegos y producción de Dicrejart
 * @returns {{
 *   proyectos: Array<Object>,
 *   juegos: Array<Object>,
 *   historialProduccion: Array<Object>,
 *   addProject: function,
 *   addGame: function,
 *   deleteProject: function,
 *   deleteGame: function,
 *   registerProductionLog: function,
 *   editProductionLog: function,
 *   deleteProductionLog: function,
 *   recalculateGameProgress: function
 * }}
 */
const useProduccion = () => {
  const context = useContext(ProduccionContext);

  if (!context) {
    throw new Error('useProduccion debe usarse dentro de un ProduccionProvider');
  }

  return context;
};

export default useProduccion;
