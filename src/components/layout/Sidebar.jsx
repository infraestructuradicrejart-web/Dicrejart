/**
 * @file Sidebar.jsx
 * @description Componente Sidebar de la aplicación Dicrejart
 * Muestra navegación de las 8 áreas de producción y enlaces principales
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import { canAccessSection } from '../../utils/roleAccess';
import BrandShape from '../ui/BrandShape';
import useChat from '../../hooks/useChat';
import styles from './Sidebar.module.css';

/**
 * Array con la configuración de las 8 áreas de producción
 * Cada área tiene: id, nombre, ícono, color
 * @constant
 */
const PRODUCTION_AREAS = [
  {
    id: 'almacen',
    name: 'Almacén',
    icon: '📦',
    color: '#0099CC',
  },
  {
    id: 'corte-laser',
    name: 'Corte Laser',
    icon: '⚡',
    color: '#FF3300',
  },
  {
    id: 'herreria',
    name: 'Herrería',
    icon: '🔨',
    color: '#330066',
  },
  {
    id: 'carpinteria',
    name: 'Carpintería',
    icon: '🪛',
    color: '#FFCC00',
  },
  {
    id: 'costura-acc',
    name: 'Costura Accesorios',
    icon: '🧵',
    color: '#FF9933',
  },
  {
    id: 'costura-colch',
    name: 'Costura Colchonetas',
    icon: '🪡',
    color: '#990099',
  },
  {
    id: 'mantenimiento',
    name: 'Mantenimiento',
    icon: '⚙️',
    color: '#9933FF',
  },
  {
    id: 'producto-terminado',
    name: 'Producto Terminado',
    icon: '📦',
    color: '#663399',
  },
];

/**
 * Array con los enlaces principales de navegación
 * @constant
 */
const MAIN_NAVIGATION = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    icon: '📊',
    path: '/dashboard',
  },
  {
    id: 'proyectos',
    name: 'Proyectos',
    icon: '📋',
    path: '/proyectos',
  },
  {
    id: 'juegos',
    name: 'Juegos',
    icon: '🎮',
    path: '/juegos',
  },
  {
    id: 'operarios',
    name: 'Operarios',
    icon: '👷',
    path: '/operarios',
  },
  {
    id: 'actividades',
    name: 'Actividades',
    icon: '📌',
    path: '/actividades',
  },
  {
    id: 'calidad',
    name: 'Calidad',
    icon: '✅',
    path: '/calidad',
  },
  {
    id: 'reportes',
    name: 'Reportes',
    icon: '📈',
    path: '/reportes',
  },
  {
    id: 'compras',
    name: 'Compras',
    icon: '🛒',
    path: '/compras',
  },
  {
    id: 'chat',
    name: 'Chat',
    icon: '💬',
    path: '/chat',
  },
  {
    id: 'editor-visual',
    name: 'Editor Visual',
    icon: '🔗',
    path: '/editor-visual',
  },
  {
    id: 'diseno',
    name: 'Diseño',
    icon: '🎨',
    path: '/diseno',
  },
];

/**
 * Componente Sidebar - Navegación lateral de la aplicación
 * 
 * @component
 * @param {Object} props - Propiedades del componente
 * @param {boolean} [props.isOpen=true] - Si el sidebar está abierto (en mobile)
 * @param {function} [props.onClose] - Callback cuando se cierra el sidebar
 * @param {string} [props.activeItem] - ID del item actualmente seleccionado
 * @param {function} [props.onNavigate] - Callback cuando se navega a un item
 * @param {Object} [props.user] - Usuario autenticado (roleType/areaId), para filtrar por permisos
 *
 * @returns {ReactElement} Sidebar renderizado
 *
 * @example
 * <Sidebar
 *   isOpen={sidebarOpen}
 *   onClose={handleCloseSidebar}
 *   activeItem={currentPage}
 *   onNavigate={handleNavigate}
 * />
 */
const Sidebar = ({
  isOpen = true,
  onClose,
  activeItem = 'dashboard',
  onNavigate,
  user = null,
}) => {
  // ============================================
  // FILTRADO SEGÚN ROL
  // ============================================

  /**
   * Items de navegación principal visibles para el rol del usuario actual
   */
  const visibleNavigation = MAIN_NAVIGATION.filter((item) => canAccessSection(user, item.id));

  // Número de conversaciones con mensajes sin leer, para el badge junto a "Chat"
  const { totalUnreadCount } = useChat();

  /**
   * Áreas de producción visibles: un Encargado de Área solo ve su propia área;
   * Administrador (o roles sin restricción) las ve todas
   */
  const visibleAreas = PRODUCTION_AREAS.filter((area) =>
    canAccessSection(user, 'produccion', area.id)
  );

  // ============================================
  // HANDLERS
  // ============================================

  /**
   * Handler para click en un item de navegación
   * Ejecuta el callback onNavigate con el ID del item
   * 
   * @param {string} itemId - ID del item clickeado
   */
  const handleItemClick = (itemId) => {
    if (onNavigate) {
      onNavigate(itemId);
    }
  };

  /**
   * Handler para click en un área de producción
   * Navega hacia esa área específica
   * 
   * @param {string} areaId - ID del área clickeada
   */
  const handleAreaClick = (areaId) => {
    handleItemClick(`area-${areaId}`);
  };

  // ============================================
  // VARIANTES DE ANIMACIÓN (Framer Motion)
  // ============================================

  /**
   * Variantes para los items de navegación
   * Aparecen con un pequeño delay entre cada uno
   */
  const itemVariants = {
    // Estado inicial - hidden
    initial: {
      opacity: 0,
      x: -20,
    },
    // Estado animado - visible
    animate: {
      opacity: 1,
      x: 0,
    },
  };

  /**
   * Variantes para el contenedor de items
   * Los items aparecen en cascada (staggerChildren)
   */
  const containerVariants = {
    // Estado inicial
    initial: {
      opacity: 0,
    },
    // Estado animado - items aparecen en cascada
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05, // Delay entre cada item
        delayChildren: 0.1,
      },
    },
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <motion.aside
      className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}
      initial={{ x: isOpen ? 0 : -300 }}
      animate={{ x: isOpen ? 0 : -300 }}
    >
      {/* ============================================
          SECCIÓN PRINCIPAL: Navegación general
          ============================================ */}
      {visibleNavigation.length > 0 && (
      <section className={styles.section}>
        {/* Título de la sección */}
        <h2 className={styles['section-title']}>NAVEGACIÓN</h2>

        {/* Contenedor de items */}
        <motion.nav
          className={styles['nav-list']}
          variants={containerVariants}
          initial="initial"
          animate="animate"
        >
          {/* Renderizar cada item de navegación */}
          {visibleNavigation.map((item) => (
            <motion.button
              key={item.id}
              className={`${styles['nav-item']} ${
                activeItem === item.id ? styles.active : ''
              }`}
              onClick={() => handleItemClick(item.id)}
              variants={itemVariants}
              transition={{ duration: 0.3 }}
              title={item.name}
            >
              {/* Ícono del item (con animación mientras haya mensajes sin leer) */}
              <span className={`${styles['nav-icon']} ${item.id === 'chat' && totalUnreadCount > 0 ? styles['nav-icon-unread'] : ''}`}>
                {item.icon}
              </span>

              {/* Nombre del item */}
              <span className={styles['nav-text']}>{item.name}</span>

              {/* Badge de mensajes sin leer, solo en el ítem de Chat */}
              {item.id === 'chat' && totalUnreadCount > 0 && (
                <span className={`${styles['unread-badge']} ${styles['unread-badge-pulse']}`}>{totalUnreadCount}</span>
              )}

              {/* Indicador visual si es activo */}
              {activeItem === item.id && (
                <span className={styles['nav-indicator']} />
              )}
            </motion.button>
          ))}
        </motion.nav>
      </section>
      )}

      {/* ============================================
          SECCIÓN DE ÁREAS: Las áreas de producción visibles para el rol
          ============================================ */}
      {visibleAreas.length > 0 && (
      <section className={styles.section}>
        {/* Título de la sección */}
        <h2 className={styles['section-title']}>ÁREAS DE PRODUCCIÓN</h2>

        {/* Contenedor de áreas */}
        <motion.div
          className={styles['areas-list']}
          variants={containerVariants}
          initial="initial"
          animate="animate"
        >
          {/* Renderizar cada área */}
          {visibleAreas.map((area) => (
            <motion.button
              key={area.id}
              className={`${styles['area-item']} ${
                activeItem === `area-${area.id}` ? styles.active : ''
              }`}
              onClick={() => handleAreaClick(area.id)}
              variants={itemVariants}
              transition={{ duration: 0.3 }}
              title={area.name}
            >
              {/* Indicador de color (pequeño círculo) */}
              <div
                className={styles['area-color']}
                style={{ backgroundColor: area.color }}
              />

              {/* Ícono del área */}
              <span className={styles['area-icon']}>{area.icon}</span>

              {/* Nombre del área */}
              <span className={styles['area-text']}>{area.name}</span>
            </motion.button>
          ))}
        </motion.div>
      </section>
      )}

      {/* ============================================
          SECCIÓN INFERIOR: Info y configuración
          ============================================ */}
      <section className={styles['bottom-section']}>
        {/* Información de FASE */}
        <div className={styles['version-info']}>
          <BrandShape shape="trebol" color="var(--color-accent)" className={styles['version-shape']} />
          <p className={styles['version-text']}>FASE 1: Fundación</p>
          <p className={styles['version-version']}>v1.0.0</p>
        </div>
      </section>
    </motion.aside>
  );
};

/**
 * PropTypes para validación de tipos
 */
Sidebar.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  activeItem: PropTypes.string,
  onNavigate: PropTypes.func,
  user: PropTypes.object,
};

/**
 * Valores por defecto
 */
Sidebar.defaultProps = {
  isOpen: true,
  onClose: () => {},
  activeItem: 'dashboard',
  onNavigate: () => {},
  user: null,
};

export default Sidebar;
