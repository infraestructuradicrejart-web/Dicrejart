/**
 * @file useTheme.js
 * @description Hook personalizado para acceder y manipular el tema global de la aplicación (Modo Claro / Modo Oscuro)
 * @author Dicrejart Dev Team
 * @returns {{ theme: 'light'|'dark', isDark: boolean, toggleTheme: () => void, setTheme: (t: 'light'|'dark') => void }}
 */

import { useContext } from 'react';
import { ThemeContext } from '../context/ThemeContext';

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe ser utilizado dentro de un ThemeProvider');
  }
  return context;
};

export default useTheme;
