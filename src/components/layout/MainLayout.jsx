/**
 * @file MainLayout.jsx
 * @description Componente MainLayout de la aplicación Dicrejart
 * Organiza la estructura principal: Sidebar (left, a toda la altura) y Content (main).
 * Sin barra superior — solo queda el círculo de sesión activa (UserMenu), flotando fijo.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import useIsMobile from '../../hooks/useIsMobile';

// Importar componentes de layout
import UserMenu from './UserMenu';
import Sidebar from './Sidebar';
import BrandBackdrop from '../ui/BrandBackdrop';
import CornerMascot from '../ui/CornerMascot';

// Importar estilos
import styles from './MainLayout.module.css';

/**
 * Componente MainLayout - Layout principal de la aplicación
 * Proporciona la estructura básica: Sidebar lateral a toda la altura, Content flexible
 * 
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {ReactNode} props.children - Contenido principal de la página
 * @param {string} [props.activeItem='dashboard'] - Item actualmente seleccionado en el sidebar
 * @param {function} [props.onNavigate] - Callback cuando se navega a un item
 * @param {string} [props.userName='Administrador'] - Nombre del usuario actual
 * @param {string} [props.userEmail='admin@dicrejart.com'] - Email del usuario
 * @param {Object} [props.user] - Usuario autenticado completo (incluye roleType/areaId), para filtrar el Sidebar
 * @param {function} [props.onLogout] - Callback para logout
 *
 * @returns {ReactElement} Layout principal renderizado
 *
 * @example
 * <MainLayout activeItem="dashboard" onNavigate={handleNav}>
 *   <Dashboard />
 * </MainLayout>
 */
const MainLayout = ({
  children,
  activeItem = 'dashboard',
  onNavigate,
  userName = 'Administrador',
  userEmail = 'admin@dicrejart.com',
  user = null,
  onLogout,
}) => {
  // ============================================
  // ESTADO
  // ============================================

  const isMobile = useIsMobile();

  /**
   * State para controlar si el sidebar está abierto
   * En mobile arranca cerrado (se abre con el botón flotante); en desktop
   * siempre está visible
   */
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobile);

  // Si el dispositivo cruza el breakpoint (redimensionar la ventana, o rotar el
  // teléfono a horizontal en equipos donde eso supera 768px), se resincroniza:
  // siempre abierto en desktop, siempre cerrado al volver a mobile. Sin esto,
  // alguien que cierre el drawer en el teléfono y luego pase a un ancho de
  // escritorio se quedaría sin sidebar visible.
  useEffect(() => {
    setIsSidebarOpen(!isMobile);
  }, [isMobile]);

  // ============================================
  // HANDLERS
  // ============================================

  /**
   * Handler para cerrar el sidebar
   * Se usa cuando se hace click en un item en mobile
   */
  const handleCloseSidebar = () => {
    // En mobile, cerrar el sidebar después de navegar
    if (isMobile) {
      setIsSidebarOpen(false);
    }
  };

  /**
   * Handler para abrir/cerrar el sidebar con el botón flotante (solo visible en mobile)
   */
  const handleToggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  /**
   * Handler para navegación
   * Llama al callback onNavigate y cierra sidebar si es necesario
   * 
   * @param {string} itemId - ID del item a navegar
   */
  const handleNavigate = (itemId) => {
    if (onNavigate) {
      onNavigate(itemId);
    }
    handleCloseSidebar();
  };

  /**
   * Handler para logout
   * Cierra el sidebar y ejecuta el callback de logout
   */
  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    }
  };

  // ============================================
  // VARIANTES DE ANIMACIÓN
  // ============================================

  /**
   * Variantes para el contenido principal
   * Fade in al cargar la página
   */
  const contentVariants = {
    initial: {
      opacity: 0,
      y: 20,
    },
    animate: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
        ease: 'easeOut',
      },
    },
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className={styles.layout}>
      {/* Fondo decorativo de figuras de marca, cambia según la sección activa. */}
      <BrandBackdrop section={activeItem} />

      {/* Botón para abrir/cerrar el sidebar — solo visible en mobile (ver
          .sidebarToggle en MainLayout.module.css); en desktop el sidebar
          siempre está visible y este botón no se muestra. */}
      <button
        type="button"
        className={styles.sidebarToggle}
        onClick={handleToggleSidebar}
        aria-label={isSidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={isSidebarOpen}
      >
        {isSidebarOpen ? '✕' : '☰'}
      </button>

      {/* ============================================
          Círculo de sesión activa — todo lo que queda de la antigua barra
          superior, flotando fijo en la esquina superior derecha.
          ============================================ */}
      <UserMenu
        userName={userName}
        userEmail={userEmail}
        user={user}
        onLogout={handleLogout}
        onNavigate={handleNavigate}
      />

      {/* GIDI, la mascota de Dicrejart, estática en la esquina inferior derecha. */}
      <CornerMascot />

      {/* ============================================
          CONTENEDOR PRINCIPAL (Sidebar + Content)
          ============================================ */}
      <div className={styles['main-container']}>

        {/* ============================================
            SIDEBAR - Navegación lateral
            ============================================ */}
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={handleCloseSidebar}
          activeItem={activeItem}
          onNavigate={handleNavigate}
          user={user}
        />

        {/* ============================================
            CONTENIDO PRINCIPAL
            ============================================ */}
        <motion.main
          className={styles.content}
          variants={contentVariants}
          initial="initial"
          animate="animate"
        >
          {/* Contenedor interno con max-width y padding */}
          <div className={styles['content-wrapper']}>
            {/* Renderizar el contenido pasado como children */}
            {children}
          </div>
        </motion.main>

        {/* ============================================
            OVERLAY para cerrar sidebar en mobile
            ============================================ */}
        {isSidebarOpen && (
          <motion.div
            className={styles.overlay}
            onClick={handleCloseSidebar}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </div>
    </div>
  );
};

/**
 * PropTypes para validación de tipos
 */
MainLayout.propTypes = {
  children: PropTypes.node,
  activeItem: PropTypes.string,
  onNavigate: PropTypes.func,
  userName: PropTypes.string,
  userEmail: PropTypes.string,
  user: PropTypes.object,
  onLogout: PropTypes.func,
};

/**
 * Valores por defecto
 */
MainLayout.defaultProps = {
  children: null,
  activeItem: 'dashboard',
  onNavigate: () => {},
  userName: 'Administrador',
  userEmail: 'admin@dicrejart.com',
  user: null,
  onLogout: () => {},
};

export default MainLayout;
