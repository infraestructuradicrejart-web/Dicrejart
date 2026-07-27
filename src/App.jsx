/**
 * @file App.jsx
 * @description Componente raíz de la aplicación Dicrejart
 * Organiza la estructura principal usando MainLayout y configura el enrutamiento con React Router v6
 * @author Dicrejart Dev Team
 * @requires react
 * @requires react-router-dom
 */

import React, { useState, Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { inventorDb } from './config/firebase';

// Importar pantalla de carga
import { DicrejartLoadingScreen } from './components/ui/LoadingScreen';
import Spinner from './components/ui/Spinner';

// Importar contextos de autenticación, notificaciones y operarios, y guardas de rutas
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ConfigProvider } from './context/ConfigContext';
import { AreasProvider } from './context/AreasContext';
import { OperariosProvider } from './context/OperariosContext';
import { ProduccionProvider } from './context/ProduccionContext';
import { CalidadProvider } from './context/CalidadContext';
import { ActividadesProvider } from './context/ActividadesContext';
import { ComprasProvider } from './context/ComprasContext';
import { ChatProvider } from './context/ChatContext';
import ProtectedRoute from './components/routing/ProtectedRoute';
import RoleRoute from './components/routing/RoleRoute';
import DesktopOnlyRoute from './components/routing/DesktopOnlyRoute';
import useAuth from './hooks/useAuth';
import { getHomeRoute } from './utils/roleAccess';

// Importar componente de layout principal
import MainLayout from './components/layout/MainLayout';

// Importar componentes de páginas (features). LoginPage se mantiene con import
// estático porque es la primera pantalla que ve cualquiera sin sesión iniciada; el
// resto se carga de forma perezosa (un chunk de JS por página, descargado solo al
// entrar a ella) para no engordar el bundle principal con código de páginas que la
// mayoría de los roles ni siquiera puede visitar (ver src/utils/roleAccess.js).
/**
 * Helper para recargar la página automáticamente si falla un import dinámico
 * (por ejemplo, si hubo un nuevo despliegue y los hashes de los chunks cambiaron)
 */
const lazyWithRetry = (componentImport) =>
  lazy(async () => {
    const pageHasAlreadyBeenForceRefreshed = JSON.parse(
      window.sessionStorage.getItem('page-has-been-force-refreshed') || 'false'
    );
    try {
      const component = await componentImport();
      window.sessionStorage.setItem('page-has-been-force-refreshed', 'false');
      return component;
    } catch (error) {
      if (!pageHasAlreadyBeenForceRefreshed) {
        window.sessionStorage.setItem('page-has-been-force-refreshed', 'true');
        window.location.reload();
        // Devolver una promesa que nunca se resuelve para evitar errores mientras recarga
        return new Promise(() => {});
      }
      throw error;
    }
  });

import LoginPage from './features/auth/LoginPage';
const Dashboard = lazyWithRetry(() => import('./features/dashboard/Dashboard'));
const ProyectosPage = lazyWithRetry(() => import('./features/proyectos/ProyectosPage'));
const JuegosPage = lazyWithRetry(() => import('./features/juegos/JuegosPage'));
const ProduccionPage = lazyWithRetry(() => import('./features/produccion/ProduccionPage'));
const OperariosPage = lazyWithRetry(() => import('./features/operarios/OperariosPage'));
const ActividadesPage = lazyWithRetry(() => import('./features/actividades/ActividadesPage'));
const CalidadPage = lazyWithRetry(() => import('./features/calidad/CalidadPage'));
const ReportesPage = lazyWithRetry(() => import('./features/reportes/ReportesPage'));
const AdminPage = lazyWithRetry(() => import('./features/admin/AdminPage'));
const ComprasPage = lazyWithRetry(() => import('./features/compras/ComprasPage'));
const AprobarRequisicionPage = lazyWithRetry(() => import('./features/compras/AprobarRequisicionPage'));
const ChatPage = lazyWithRetry(() => import('./features/chat/ChatPage'));
const EditorVisualPage = lazyWithRetry(() => import('./features/editor-visual/EditorVisualPage'));
const DisenoPage = lazyWithRetry(() => import('./features/diseno/DisenoPage'));

/**
 * Componente interno AppContent
 * Permite usar hooks de react-router-dom (useLocation, useNavigate)
 * para mantener sincronizada la navegación del Sidebar y Header
 * 
 * @returns {ReactElement} Estructura de la aplicación con rutas
 */
function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  /**
   * Determina el activePage seleccionado para resaltar en el Sidebar
   * @returns {string} ID del item activo en el sidebar
   */
  const getActiveItem = () => {
    const path = location.pathname;
    if (path.startsWith('/dashboard')) return 'dashboard';
    if (path.startsWith('/proyectos')) return 'proyectos';
    if (path.startsWith('/juegos')) return 'juegos';
    if (path.startsWith('/reportes')) return 'reportes';
    if (path.startsWith('/admin')) return 'admin';
    if (path.startsWith('/compras')) return 'compras';
    if (path.startsWith('/calidad')) return 'calidad';
    if (path.startsWith('/operarios')) return 'operarios';
    if (path.startsWith('/actividades')) return 'actividades';
    if (path.startsWith('/editor-visual')) return 'editor-visual';
    if (path.startsWith('/diseno')) return 'diseno';
    if (path.startsWith('/chat')) return 'chat';

    // Si navega a producción, resalta el área activa o el almacén por defecto
    if (path.startsWith('/produccion')) {
      const parts = path.split('/');
      const areaId = parts[2];
      return areaId ? `area-${areaId}` : '';
    }
    
    return 'dashboard';
  };

  /**
   * Handler para la navegación
   * Redirige a las distintas rutas de React Router
   * 
   * @param {string} itemId - ID del item seleccionado en el sidebar o header
   */
  const handleNavigate = (itemId) => {
    if (itemId === 'dashboard') {
      navigate('/dashboard');
    } else if (itemId === 'proyectos') {
      navigate('/proyectos');
    } else if (itemId === 'juegos') {
      navigate('/juegos');
    } else if (itemId === 'reportes') {
      navigate('/reportes');
    } else if (itemId === 'admin') {
      navigate('/admin');
    } else if (itemId === 'compras') {
      navigate('/compras');
    } else if (itemId === 'calidad') {
      navigate('/calidad');
    } else if (itemId === 'operarios') {
      navigate('/operarios');
    } else if (itemId === 'actividades') {
      navigate('/actividades');
    } else if (itemId === 'editor-visual') {
      navigate('/editor-visual');
    } else if (itemId === 'diseno') {
      navigate('/diseno');
    } else if (itemId === 'chat') {
      navigate('/chat');
    } else if (itemId.startsWith('area-')) {
      const areaId = itemId.replace('area-', '');
      navigate(`/produccion/${areaId}`);
    }
  };

  /**
   * Handler para cerrar sesión (logout)
   * Limpia la sesión del AuthContext y redirige a la pantalla de login
   */
  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  useEffect(() => {
    if (inventorDb && user) {
      setTimeout(() => {
        getDocs(collection(inventorDb, 'items')).then(snap => {
          console.info('✅ CONEXIÓN ESTILO ODOO ESTABLECIDA:');
          console.info(`📦 Se leyeron ${snap.docs.length} artículos directamente desde la base de datos de Inventor Manager.`);
        }).catch(err => {
          console.error('❌ Error leyendo inventario cruzado:', err);
        });
      }, 3000);
    }
  }, [user]);

  return (
    <MainLayout
      activeItem={getActiveItem()}
      onNavigate={handleNavigate}
      userName={user?.name}
      userEmail={user?.email}
      user={user}
      onLogout={handleLogout}
    >
      <Routes>
        {/* Redirección raíz a la "ruta hogar" del rol del usuario */}
        <Route path="/" element={<Navigate to={getHomeRoute(user)} replace />} />

        {/* Rutas principales del sistema, cada una protegida según el rol */}
        <Route
          path="/dashboard"
          element={
            <RoleRoute section="dashboard">
              <Dashboard />
            </RoleRoute>
          }
        />
        <Route
          path="/proyectos"
          element={
            <RoleRoute section="proyectos">
              <ProyectosPage />
            </RoleRoute>
          }
        />
        <Route
          path="/juegos"
          element={
            <RoleRoute section="juegos">
              <JuegosPage />
            </RoleRoute>
          }
        />
        <Route
          path="/produccion"
          element={
            <RoleRoute section="produccion">
              <ProduccionPage />
            </RoleRoute>
          }
        />
        <Route
          path="/produccion/:areaId"
          element={
            <RoleRoute section="produccion">
              <ProduccionPage />
            </RoleRoute>
          }
        />
        <Route
          path="/operarios"
          element={
            <RoleRoute section="operarios">
              <OperariosPage />
            </RoleRoute>
          }
        />
        <Route
          path="/actividades"
          element={
            <RoleRoute section="actividades">
              <ActividadesPage />
            </RoleRoute>
          }
        />
        <Route
          path="/calidad"
          element={
            <RoleRoute section="calidad">
              <CalidadPage />
            </RoleRoute>
          }
        />
        <Route
          path="/reportes"
          element={
            <RoleRoute section="reportes">
              <DesktopOnlyRoute
                title="Analítica y Reportes"
                shape="anillo"
                accentColor="var(--color-blue-magenta-violet)"
                message="Los reportes (gráficas y exportación a Excel/PDF) están pensados para pantallas grandes. Ábrelos desde una computadora."
              >
                <ReportesPage />
              </DesktopOnlyRoute>
            </RoleRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <RoleRoute section="admin">
              <AdminPage />
            </RoleRoute>
          }
        />
        <Route
          path="/compras"
          element={
            <RoleRoute section="compras">
              <ComprasPage />
            </RoleRoute>
          }
        />
        <Route
          path="/editor-visual"
          element={
            <RoleRoute section="editor-visual">
              <DesktopOnlyRoute
                title="Editor Visual de Asignaciones"
                shape="arco-doble"
                accentColor="var(--color-secondary)"
                message="El Editor Visual necesita más espacio en pantalla y funciona mejor con mouse. Ábrelo desde una computadora."
              >
                <EditorVisualPage />
              </DesktopOnlyRoute>
            </RoleRoute>
          }
        />
        <Route
          path="/diseno"
          element={
            <RoleRoute section="diseno">
              <DisenoPage />
            </RoleRoute>
          }
        />

        {/* Chat interno (global + privado 1 a 1): visible para cualquier rol, sin
            RoleRoute — el ProtectedRoute de nivel superior ya exige sesión iniciada */}
        <Route path="/chat" element={<ChatPage />} />

        {/* Fallback para cualquier ruta desconocida: manda a la ruta hogar del rol */}
        <Route path="*" element={<Navigate to={getHomeRoute(user)} replace />} />
      </Routes>
    </MainLayout>
  );
}

/**
 * Componente principal App - Raíz del sistema
 * Encapsula la aplicación en el Router de React y el AuthProvider
 * Define la ruta pública de login y protege el resto de la app
 *
 * @returns {ReactElement} Router wrapper
 */
function App() {
  const [isLoading, setIsLoading] = useState(true);

  if (isLoading) {
    return <DicrejartLoadingScreen onLoadComplete={() => setIsLoading(false)} duration={3500} />;
  }

  return (
    <Router>
      <ToastProvider>
        <AuthProvider>
          <ConfigProvider>
            <AreasProvider>
              <OperariosProvider>
                <ProduccionProvider>
                  <CalidadProvider>
                    <ActividadesProvider>
                      <ComprasProvider>
                        <ChatProvider>
                        {/* Suspense único a este nivel: cubre también las rutas anidadas dentro
                            de AppContent, ya que un límite de Suspense atrapa cualquier
                            componente lazy() en todo su subárbol sin importar la profundidad.
                            Antes no tenía fallback (`null`): mientras se descargaba el chunk de
                            JS de la página la pantalla se quedaba en blanco sin ningún aviso. Se
                            probó reutilizar la pantalla de carga de marca (figuras rebotando,
                            anillos girando) aquí también, pero al aparecer y desaparecer en
                            menos de un segundo entre secciones se sentía como que la app se
                            trababa, no como una transición — por eso es un spinner simple
                            sobre fondo blanco, no la pantalla animada completa (esa se reserva
                            para el arranque inicial de la app, ver `isLoading` más abajo). */}
                        <Suspense
                          fallback={
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', width: '100%', background: '#ffffff' }}>
                              <Spinner size="lg" label="Cargando..." />
                            </div>
                          }
                        >
                        <Routes>
                          {/* Ruta pública: login */}
                          <Route path="/login" element={<LoginPage />} />

                          {/* Ruta pública: confirmación de autorización de requisiciones desde
                              el correo de Dirección — sin sesión iniciada, protegida por el
                              token de un solo uso de la URL (ver AprobarRequisicionPage.jsx) */}
                          <Route path="/aprobar-requisicion" element={<AprobarRequisicionPage />} />

                          {/* Editor Visual en ventana aparte: sin Sidebar/Header, para aprovechar
                              todo el espacio cuando se abre desde el botón "Abrir en Ventana Aparte" */}
                          <Route
                            path="/editor-visual/ventana"
                            element={
                              <ProtectedRoute>
                                <RoleRoute section="editor-visual">
                                  <DesktopOnlyRoute
                                    title="Editor Visual de Asignaciones"
                                    shape="arco-doble"
                                    accentColor="var(--color-secondary)"
                                    message="El Editor Visual necesita más espacio en pantalla y funciona mejor con mouse. Ábrelo desde una computadora."
                                  >
                                    <EditorVisualPage standalone />
                                  </DesktopOnlyRoute>
                                </RoleRoute>
                              </ProtectedRoute>
                            }
                          />

                          {/* Resto de la app: requiere sesión iniciada */}
                          <Route
                            path="/*"
                            element={
                              <ProtectedRoute>
                                <AppContent />
                              </ProtectedRoute>
                            }
                          />
                        </Routes>
                        </Suspense>
                        </ChatProvider>
                      </ComprasProvider>
                    </ActividadesProvider>
                  </CalidadProvider>
                </ProduccionProvider>
              </OperariosProvider>
            </AreasProvider>
          </ConfigProvider>
        </AuthProvider>
      </ToastProvider>
    </Router>
  );
}

export default App;
