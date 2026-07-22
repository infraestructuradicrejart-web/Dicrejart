/**
 * @file useConfig.js
 * @description Hook de conveniencia para consumir el contexto de Configuración global
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { ConfigContext } from '../context/ConfigContext';

/**
 * Hook para acceder a la configuración global de la app (límites dinámicos de historial)
 * @returns {{ limits: Object, updateLimit: function }}
 */
const useConfig = () => {
  const context = useContext(ConfigContext);

  if (!context) {
    throw new Error('useConfig debe usarse dentro de un ConfigProvider');
  }

  return context;
};

export default useConfig;
