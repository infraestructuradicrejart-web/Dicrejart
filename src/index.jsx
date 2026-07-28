/**
 * @file index.jsx
 * @description Entry point de la aplicación React Dicrejart
 * Monta la aplicación en el DOM y carga los estilos globales
 * @author Dicrejart Dev Team
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ui/ErrorBoundary';

// Importar estilos globales
// El orden es importante: variables → global → animations → responsive
import './styles/variables.css';
import './styles/global.css';
import './styles/animations.css';
import './styles/responsive.css';

/**
 * Montar la aplicación React en el elemento raíz (id="root")
 * 
 * ReactDOM.createRoot() crea un raíz React en el DOM
 * .render() renderiza el componente App dentro del raíz
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
