/**
 * @file roleAccess.js
 * @description Reglas de acceso por rol para la navegación de la aplicación
 * Centraliza qué secciones puede ver cada tipo de usuario:
 * - 'admin': acceso completo, incluye gestión de usuarios
 * - 'calidad': la sección de Calidad, más Dashboard (estadísticas generales)
 * - 'encargado-area': registra Producción de su propia área, y consulta en
 *   solo lectura (filtrado a su área) Juegos, Actividades y Proyectos, más
 *   Dashboard (estadísticas generales)
 * - 'supervisor-area': solo lectura de Producción de sus áreas asignadas
 *   (`areaIds`), más Dashboard y Reportes (con exportación) de toda la fábrica
 * - 'direccion': solo lectura de Producción (todas las áreas), Juegos, Proyectos,
 *   Actividades, Dashboard y Reportes, EXCEPTO en 'compras' donde autoriza o
 *   regresa requisiciones (única acción de escritura de este rol)
 * - 'compras': gestiona requisiciones de compra de materiales (sección 'compras'), más Dashboard
 *
 * Flujo de Requisiciones de Compra (sección 'compras'):
 *   Supervisor de Área o Encargado de Almacén crea la requisición ('pendiente') ->
 *   Dirección la autoriza ('autorizada') o la regresa con observaciones ('regresada',
 *   el solicitante corrige y reenvía) -> Compras realiza el pago y adjunta el
 *   comprobante ('comprada') -> el solicitante confirma la descarga y cierra ('recibida').
 * Solo Supervisor de Área, Encargado de Almacén y Admin pueden CREAR requisiciones;
 * solo Dirección/Admin autorizan o regresan; solo Compras/Admin marcan como compradas.
 *
 * La exportación de reportes (botones "Exportar") está reservada a
 * 'admin' y 'supervisor-area' incluso dentro de páginas compartidas como el Dashboard.
 * @author Dicrejart Dev Team
 */

import { ROLE_TYPES } from '../data/usersData';

/**
 * Determina la ruta "hogar" a la que debe ir un usuario según su rol
 * Se usa tanto para la redirección raíz ("/") como para cualquier ruta no permitida
 *
 * @param {Object|null} user - Usuario autenticado (o null si no hay sesión)
 * @returns {string} Ruta a la que redirigir
 */
export const getHomeRoute = (user) => {
  if (!user) return '/login';
  if (user.roleType === ROLE_TYPES.CALIDAD) return '/calidad';
  if (user.roleType === ROLE_TYPES.ENCARGADO_AREA) return `/produccion/${user.areaId}`;
  if (user.roleType === ROLE_TYPES.SUPERVISOR_AREA) return '/dashboard';
  if (user.roleType === ROLE_TYPES.DIRECCION) return '/dashboard';
  if (user.roleType === ROLE_TYPES.COMPRAS) return '/compras';
  if (user.roleType === ROLE_TYPES.DISENADOR || user.roleType === ROLE_TYPES.ARQUITECTO) return '/diseno';
  return '/dashboard';
};

/**
 * Indica si un usuario puede acceder a una sección determinada de la app
 *
 * @param {Object} user - Usuario autenticado
 * @param {string} section - Identificador de la sección ('dashboard', 'proyectos',
 *   'juegos', 'produccion', 'operarios', 'actividades', 'calidad', 'reportes', 'admin')
 * @param {string} [areaId] - Id de área de la URL, solo relevante para section === 'produccion'
 * @returns {boolean} true si el usuario puede ver esa sección
 */
export const canAccessSection = (user, section, areaId) => {
  if (!user) return false;

  // El chat interno (global + privado 1 a 1) es visible para cualquier rol, sin excepción
  if (section === 'chat') return true;

  if (user.roleType === ROLE_TYPES.CALIDAD) {
    // Estadísticas generales (Dashboard) visibles para todos los roles, más acceso al
    // padrón de Operarios (préstamos/estado de personal)
    return section === 'calidad' || section === 'dashboard' || section === 'operarios';
  }

  if (user.roleType === ROLE_TYPES.ENCARGADO_AREA) {
    if (section === 'produccion') return Boolean(areaId) && areaId === user.areaId;
    // Solo el Encargado de Almacén genera requisiciones de compra
    if (section === 'compras') return user.areaId === 'almacen';
    // Solo lectura, filtrada a su área dentro de cada página, más estadísticas generales.
    // NO tiene acceso a Operarios: solo Calidad, Supervisor de área y Admin lo tienen.
    return section === 'juegos' || section === 'actividades' || section === 'proyectos' || section === 'dashboard';
  }

  if (user.roleType === ROLE_TYPES.SUPERVISOR_AREA) {
    if (section === 'produccion') return Boolean(areaId) && (user.areaIds || []).includes(areaId);
    return section === 'dashboard' || section === 'reportes' || section === 'compras' || section === 'operarios';
  }

  if (user.roleType === ROLE_TYPES.DIRECCION) {
    // Consulta de avance general (todas las áreas de producción), más autorización de requisiciones
    return (
      section === 'dashboard' ||
      section === 'proyectos' ||
      section === 'juegos' ||
      section === 'produccion' ||
      section === 'actividades' ||
      section === 'reportes' ||
      section === 'compras'
    );
  }

  if (user.roleType === ROLE_TYPES.COMPRAS) {
    return section === 'dashboard' || section === 'compras';
  }

  if (user.roleType === ROLE_TYPES.DISENADOR || user.roleType === ROLE_TYPES.ARQUITECTO) {
    // Jerarquía distinta a la de los Operarios de piso: solo consultan sus propias
    // tareas asignadas (sección "diseno"), sin acceso a Producción, Operarios ni Compras
    return section === 'diseno' || section === 'dashboard';
  }

  // Administrador (o cualquier rol sin restricción definida): acceso total
  return true;
};

/**
 * Indica si el usuario solo puede consultar (solo lectura) una sección,
 * sin poder crear, editar ni eliminar información en ella
 *
 * @param {Object} user - Usuario autenticado
 * @param {string} section - Identificador de la sección
 * @param {string} [areaId] - Área actual dentro de la sección (relevante solo para 'produccion')
 * @returns {boolean} true si la sección debe mostrarse en modo solo lectura
 */
export const isReadOnlySection = (user, section, areaId) => {
  if (!user) return true;

  if (user.roleType === ROLE_TYPES.SUPERVISOR_AREA) {
    // Producto Terminado se opera de verdad (crear tarimas, programar y despachar
    // envíos, recibir entregas) — a diferencia de las demás áreas, donde Supervisor de
    // Área solo autoriza/consulta sin operar directamente. canAccessSection ya exige que
    // esta área esté en su areaIds antes de llegar aquí, así que no hace falta
    // revalidarlo de nuevo.
    if (section === 'produccion' && areaId === 'producto-terminado') return false;
    return section === 'produccion';
  }

  if (user.roleType === ROLE_TYPES.ENCARGADO_AREA) {
    return section === 'juegos' || section === 'actividades' || section === 'proyectos';
  }

  if (user.roleType === ROLE_TYPES.DIRECCION) {
    // Rol de consulta, excepto en 'compras' donde autoriza o regresa requisiciones
    return section !== 'compras';
  }

  if (user.roleType === ROLE_TYPES.DISENADOR || user.roleType === ROLE_TYPES.ARQUITECTO) {
    // Solo consultan sus tareas asignadas, no las editan
    return section === 'diseno';
  }

  return false;
};
