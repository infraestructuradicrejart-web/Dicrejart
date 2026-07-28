/**
 * @file ErrorBoundary.jsx
 * @description Captura errores en tiempo de ejecución de React para evitar la pantalla en blanco
 * y mostrar una interfaz de recuperación intuitiva.
 * @author Dicrejart Dev Team
 */

import React, { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('⚠️ [Dicrejart ErrorBoundary] Capturado error de renderizado:', error, errorInfo);
  }

  handleReload = () => {
    window.sessionStorage.clear();
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '24px',
            backgroundColor: '#f8fafc',
            fontFamily: 'Arial, sans-serif',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              maxWidth: '500px',
              width: '100%',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '32px',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ fontSize: '42px', marginBottom: '12px' }}>⚙️</div>
            <h2 style={{ fontSize: '20px', color: '#1e293b', margin: '0 0 8px 0', fontWeight: 'bold' }}>
              Sincronización de Sesión Requerida
            </h2>
            <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 20px 0', lineHeight: '1.5' }}>
              La aplicación ha recibido una actualización de estado o datos. Haz clic abajo para recargar y sincronizar tu sesión en vivo.
            </p>
            {this.state.error?.message && (
              <div
                style={{
                  fontSize: '12px',
                  backgroundColor: '#fff1f2',
                  color: '#be123c',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  textAlign: 'left',
                  marginBottom: '20px',
                  border: '1px solid #fecdd3',
                  wordBreak: 'break-word',
                }}
              >
                <strong>Detalle técnico:</strong> {this.state.error.message}
              </div>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
              }}
            >
              🔄 Recargar y Sincronizar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
