/**
 * @file vite.config.js
 * @description Configuración de Vite para el proyecto Dicrejart
 * Define las opciones de compilación, servidor de desarrollo y optimizaciones
 * Incluye configuración PWA para instalación como app nativa
 * @author Dicrejart Dev Team
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Configuración de Vite
 * - Puerto de desarrollo: 5173
 * - Soporte para React (JSX)
 * - PWA con Service Worker para instalación
 * - Optimizaciones para producción
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Dicrejart - Sistema de Producción',
        short_name: 'Dicrejart',
        description: 'Sistema integral de gestión de producción, calidad y proyectos para Dicrejart',
        theme_color: '#1a1a2e',
        background_color: '#0f0f1a',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        categories: ['business', 'productivity'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precachear los archivos generados por Vite
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Caché de rutas de navegación (SPA)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Runtime caching para Google Fonts
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 año
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 año
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  
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
