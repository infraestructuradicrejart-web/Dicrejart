/**
 * @file useOperarios.js
 * @description Hook de conveniencia para consumir el OperariosContext
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { OperariosContext } from '../context/OperariosContext';

/**
 * Hook para acceder al padrón de operarios y sus acciones (asignar, prestar, importar)
 * Debe usarse dentro de un árbol envuelto por <OperariosProvider>
 *
 * @returns {{operarios: Array<Object>, assignToArea: function, returnToHomeArea: function, importFromExcel: function, deleteOperario: function, clearAllOperarios: function}}
 */
const useOperarios = () => {
  const context = useContext(OperariosContext);

  if (!context) {
    throw new Error('useOperarios debe usarse dentro de un <OperariosProvider>');
  }

  return context;
};

export default useOperarios;
