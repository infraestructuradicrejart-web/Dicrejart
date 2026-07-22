/**
 * @file vite.config.js
 * @description Configuración de Vite para el proyecto Dicrejart
 * Define las opciones de compilación, servidor de desarrollo y optimizaciones
 * @author Dicrejart Dev Team
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuración de Vite
 * - Puerto de desarrollo: 5173
 * - Soporte para React (JSX)
 * - Optimizaciones para producción
 */
export default defineConfig({
  plugins: [react()],
  
  server: {
    // Puerto en el que se ejecuta el servidor de desarrollo
    port: 5173,
    
    // Abre el navegador automáticamente
    open: true,
    
    // Hot Module Replacement para actualizaciones en tiempo real
    hmr: {
      host: 'localhost',
    },

    // Permite acceder al servidor de desarrollo a través de un túnel de ngrok
    // (para compartir un link público temporal sin necesidad de desplegar)
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.dev', '.ngrok.io'],
  },
  
  build: {
    // Directorio de salida para build de producción
    outDir: 'dist',
    
    // Limpia el directorio dist antes de hacer build
    emptyOutDir: true,
    
    // Configuraciones de optimización
    rollupOptions: {
      output: {
        // ManualChunks para optimizar el tamaño del bundle
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'charts': ['recharts'],
          'animations': ['framer-motion'],
        },
      },
    },
  },
  
  // Alias para imports más limpios
  resolve: {
    alias: {
      '@': '/src',
      '@components': '/src/components',
      '@styles': '/src/styles',
      '@hooks': '/src/hooks',
      '@utils': '/src/utils',
      '@data': '/src/data',
      '@context': '/src/context',
    },
  },
});
