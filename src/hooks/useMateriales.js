/**
 * @file useMateriales.js
 * @description Hook de conveniencia para consumir el MaterialesContext
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { MaterialesContext } from '../context/MaterialesContext';

/**
 * Hook para acceder a las solicitudes de materiales a Almacén y sus acciones
 * (solicitar, marcar listo para recoger, confirmar recepción, rechazar, cancelar).
 * Debe usarse dentro de un árbol envuelto por <MaterialesProvider>.
 *
 * @returns {{solicitudesMateriales: Array<Object>, solicitarMateriales: function, marcarMaterialesListos: function, confirmarRecepcionMateriales: function, rechazarSolicitudMateriales: function, cancelarSolicitudMateriales: function}}
 */
const useMateriales = () => {
  const context = useContext(MaterialesContext);

  if (!context) {
    throw new Error('useMateriales debe usarse dentro de un <MaterialesProvider>');
  }

  return context;
};

export default useMateriales;
