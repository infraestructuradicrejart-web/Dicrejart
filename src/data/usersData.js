/**
 * @file usersData.js
 * @description Datos simulados de usuarios y credenciales para autenticación mock
 * Fuente única de verdad para usuarios del sistema (login y panel de administración)
 * @author Dicrejart Dev Team
 */

/**
 * Tipos de rol reconocidos por el sistema de permisos (ver roleAccess.js)
 * - 'admin': acceso completo a toda la aplicación, incluye gestión de usuarios
 * - 'calidad': acceso único a la página de Calidad
 * - 'encargado-area': registra producción de su propia área (`areaId`) y consulta
 *   (solo lectura, filtrado a su área) Juegos, Actividades y Proyectos
 * - 'supervisor-area': solo lectura de Producción de sus áreas asignadas (`areaIds`),
 *   más Dashboard y Reportes generales de toda la fábrica
 * - 'direccion': solo lectura de Producción (todas las áreas), Juegos, Proyectos,
 *   Actividades, Dashboard y Reportes. Rol de supervisión y consulta de avance general
 * - 'compras': gestiona requisiciones de compra de materiales para áreas/fábrica
 * - 'disenador' / 'arquitecto': personal del departamento de Diseño (jerarquía distinta
 *   a la de los Operarios de piso). Inician sesión como Usuario y solo consultan (sin
 *   editar) las tareas que se les asignaron, vinculadas a su propio registro del padrón
 *   de Operarios (área "Diseño") a través de `operarioId` en su perfil de Usuario
 * @constant
 */
export const ROLE_TYPES = {
  ADMIN: 'admin',
  CALIDAD: 'calidad',
  ENCARGADO_AREA: 'encargado-area',
  SUPERVISOR_AREA: 'supervisor-area',
  DIRECCION: 'direccion',
  COMPRAS: 'compras',
  DISENADOR: 'disenador',
  ARQUITECTO: 'arquitecto',
};

/**
 * Etiquetas legibles de cada rol — fuente única compartida por AdminPage (tabla de
 * Usuarios), la Bitácora del Sistema y el Historial de Movimientos de Operarios, para
 * no repetir el mismo mapeo en cada pantalla que necesite mostrar "qué rol hizo esto".
 * @constant
 */
export const ROLE_TYPE_LABELS = {
  [ROLE_TYPES.ADMIN]: 'Administrador',
  [ROLE_TYPES.CALIDAD]: 'Inspector de Calidad',
  [ROLE_TYPES.ENCARGADO_AREA]: 'Encargado de Área',
  [ROLE_TYPES.SUPERVISOR_AREA]: 'Supervisor de Área',
  [ROLE_TYPES.DIRECCION]: 'Dirección',
  [ROLE_TYPES.COMPRAS]: 'Compras',
  [ROLE_TYPES.DISENADOR]: 'Diseñador',
  [ROLE_TYPES.ARQUITECTO]: 'Arquitecto',
};

// ============================================
// USUARIOS MOCK (con credenciales de acceso)
// ============================================
export const MOCK_USERS = [
  {
    id: 'USR-01',
    name: 'Administrador Dicrejart',
    email: 'admin@dicrejart.com',
    password: 'admin123',
    role: 'Administrador',
    roleType: ROLE_TYPES.ADMIN,
    areaId: null,
    status: 'activo',
  },
  {
    id: 'USR-02',
    name: 'Ana Sofía Ruiz',
    email: 'ana.ruiz@dicrejart.com',
    password: 'calidad123',
    role: 'Inspector Calidad',
    roleType: ROLE_TYPES.CALIDAD,
    areaId: null,
    status: 'activo',
  },
  {
    id: 'USR-03',
    name: 'Pedro Gómez',
    email: 'pedro.gomez@dicrejart.com',
    password: 'almacen123',
    role: 'Encargado de Almacén',
    roleType: ROLE_TYPES.ENCARGADO_AREA,
    areaId: 'almacen',
    status: 'activo',
  },
  {
    id: 'USR-04',
    name: 'Juan Martínez',
    email: 'juan.martinez@dicrejart.com',
    password: 'laser123',
    role: 'Encargado de Corte Láser',
    roleType: ROLE_TYPES.ENCARGADO_AREA,
    areaId: 'corte-laser',
    status: 'activo',
  },
  {
    id: 'USR-05',
    name: 'Silvia Delgado',
    email: 'silvia.delgado@dicrejart.com',
    password: 'costura123',
    role: 'Encargada de Costura Colchonetas',
    roleType: ROLE_TYPES.ENCARGADO_AREA,
    areaId: 'costura-colch',
    status: 'activo',
  },
  {
    id: 'USR-06',
    name: 'Roberto Aguilar',
    email: 'roberto.aguilar@dicrejart.com',
    password: 'supervisor123',
    role: 'Supervisor de Herrería y Corte Láser',
    roleType: ROLE_TYPES.SUPERVISOR_AREA,
    areaId: null,
    areaIds: ['herreria', 'corte-laser'],
    status: 'activo',
  },
  {
    id: 'USR-07',
    name: 'Fernanda Castillo',
    email: 'fernanda.castillo@dicrejart.com',
    password: 'direccion123',
    role: 'Dirección',
    roleType: ROLE_TYPES.DIRECCION,
    areaId: null,
    status: 'activo',
  },
  {
    id: 'USR-08',
    name: 'Marco Villaseñor',
    email: 'marco.villasenor@dicrejart.com',
    password: 'compras123',
    role: 'Compras',
    roleType: ROLE_TYPES.COMPRAS,
    areaId: null,
    status: 'activo',
  },
  {
    id: 'USR-09',
    name: 'Carlos Mendoza',
    email: 'carlos.mendoza@dicrejart.com',
    password: 'supervisor123',
    role: 'Supervisor de Costura y Producto Terminado',
    roleType: ROLE_TYPES.SUPERVISOR_AREA,
    areaId: null,
    areaIds: ['costura-colch', 'costura-acc', 'producto-terminado'],
    status: 'activo',
  },
];

/**
 * Busca un usuario que coincida con email y contraseña dentro de una lista de usuarios
 * Simula la validación de credenciales que en producción haría un backend
 *
 * @param {Array<Object>} users - Lista de usuarios donde buscar (con password incluido)
 * @param {string} email - Correo ingresado en el formulario de login
 * @param {string} password - Contraseña ingresada en el formulario de login
 * @returns {Object|null} Usuario encontrado (sin password) o null si no coincide
 */
export const findUserByCredentials = (users, email, password) => {
  const match = users.find(
    (user) =>
      user.email.toLowerCase() === String(email).toLowerCase().trim() &&
      user.password === password
  );

  if (!match) {
    return null;
  }

  // No exponer la contraseña fuera de este módulo
  const { password: _password, ...safeUser } = match;
  return safeUser;
};
