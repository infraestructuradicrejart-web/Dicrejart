/**
 * @file index.jsx
 * @description Entry point de la aplicación React Dicrejart
 * Monta la aplicación en el DOM y carga los estilos globales
 * @author Dicrejart Dev Team
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import ErrorBoundary from './components/ui/ErrorBoundary';

// El script de registro que Vite inyecta por defecto solo instala el Service Worker,
// pero no revisa si ya hay uno nuevo esperando ni recarga la pestaña — con
// registerType: 'autoUpdate' (vite.config.js) esta llamada es la que de verdad detecta
// una versión nueva desplegada y recarga automáticamente, para que una pestaña que ya
// estaba abierta no se quede pegada mostrando código viejo indefinidamente.
registerSW({ immediate: true });

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
