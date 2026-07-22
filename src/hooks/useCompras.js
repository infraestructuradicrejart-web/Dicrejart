/**
 * @file useCompras.js
 * @description Hook de conveniencia para consumir el contexto de Requisiciones de Compra
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { ComprasContext } from '../context/ComprasContext';

/**
 * Hook para acceder al módulo de Requisiciones de Compra
 * @returns {{
 *   requisiciones: Array<Object>,
 *   addRequisicion: function,
 *   authorizeRequisicion: function,
 *   returnRequisicion: function,
 *   resubmitRequisicion: function,
 *   addPaymentDetails: function,
 *   markAsPurchased: function,
 *   markAsReceived: function
 * }}
 */
const useCompras = () => {
  const context = useContext(ComprasContext);

  if (!context) {
    throw new Error('useCompras debe usarse dentro de un ComprasProvider');
  }

  return context;
};

export default useCompras;
