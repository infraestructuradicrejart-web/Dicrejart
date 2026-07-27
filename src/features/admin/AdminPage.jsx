/**
 * @file AdminPage.jsx
 * @description Vista de Administración de la aplicación Dicrejart
 * Permite gestionar configuraciones generales de manufactura y administrar
 * (consultar, crear, editar y eliminar) los usuarios del sistema y sus roles
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import useToast from '../../hooks/useToast';
import useOperarios from '../../hooks/useOperarios';
import useAuth from '../../hooks/useAuth';
import useConfig from '../../hooks/useConfig';
import { ROLE_TYPES } from '../../data/usersData';
import useAreas from '../../hooks/useAreas';
import PageHeader from '../../components/ui/PageHeader';
import styles from './AdminPage.module.css';

/**
 * Formulario vacío por defecto para crear un usuario nuevo
 * @constant
 */
const EMPTY_USER_FORM = {
  name: '',
  email: '',
  password: '',
  roleType: ROLE_TYPES.ENCARGADO_AREA,
  areaId: '',
  areaIds: [],
  status: 'activo',
};

/**
 * Etiquetas legibles para cada tipo de rol
 * @constant
 */
const ROLE_TYPE_LABELS = {
  [ROLE_TYPES.ADMIN]: 'Administrador',
  [ROLE_TYPES.CALIDAD]: 'Inspector de Calidad',
  [ROLE_TYPES.ENCARGADO_AREA]: 'Encargado de Área',
  [ROLE_TYPES.SUPERVISOR_AREA]: 'Supervisor de Área',
  [ROLE_TYPES.DIRECCION]: 'Dirección',
  [ROLE_TYPES.COMPRAS]: 'Compras',
};

/**
 * Calcula el nombre de rol legible en función del roleType y su(s) área(s)
 *
 * @param {string} roleType
 * @param {string} areaId - Solo relevante para 'encargado-area'
 * @param {Array<string>} areaIds - Solo relevante para 'supervisor-area'
 * @returns {string} Nombre de rol para mostrar en la tabla
 */
const computeRoleLabel = (roleType, areaId, areaIds, dynamicAreas) => {
  if (roleType === ROLE_TYPES.ADMIN) return 'Administrador';
  if (roleType === ROLE_TYPES.CALIDAD) return 'Inspector de Calidad';

  if (roleType === ROLE_TYPES.ENCARGADO_AREA) {
    const areaName = dynamicAreas.find((a) => a.id === areaId)?.name || 'Área';
    return `Encargado de ${areaName}`;
  }

  if (roleType === ROLE_TYPES.SUPERVISOR_AREA) {
    const names = (areaIds || []).map((id) => dynamicAreas.find((a) => a.id === id)?.name || id);
    return names.length > 0 ? `Supervisor de ${names.join(' y ')}` : 'Supervisor de Área';
  }

  if (roleType === ROLE_TYPES.DIRECCION) return 'Dirección';
  if (roleType === ROLE_TYPES.COMPRAS) return 'Compras';

  return 'Usuario';
};

/**
 * Devuelve el texto de área(s) asignada(s) a un usuario, para mostrar en la tabla
 * @param {Object} usr
 * @returns {string}
 */
const getUserAreasText = (usr, dynamicAreas) => {
  if (usr.roleType === ROLE_TYPES.ENCARGADO_AREA) {
    return dynamicAreas.find((a) => a.id === usr.areaId)?.name || usr.areaId || '—';
  }
  if (usr.roleType === ROLE_TYPES.SUPERVISOR_AREA) {
    const names = (usr.areaIds || []).map((id) => dynamicAreas.find((a) => a.id === id)?.name || id);
    return names.length > 0 ? names.join(', ') : '—';
  }
  return '—';
};

/**
 * Componente AdminPage - Panel de administración general
 * @component
 * @returns {ReactElement} Render del componente Admin
 */
const AdminPage = () => {
  // ============================================
  // ESTADO
  // ============================================
  const { blockDuration, updateBlockDuration } = useOperarios();
  const { users, addUser, updateUser, deleteUser, resetUserPassword } = useAuth();
  const { limits, updateLimit, generalConfig, updateGeneralConfig, auditLog } = useConfig();
  const { areas: dynamicAreas, addArea, updateArea, deleteArea } = useAreas();
  const toast = useToast();

  /** Etiquetas legibles para cada límite dinámico de historial (colecciones tipo bitácora) */
  const LIMIT_FIELDS = [
    { field: 'historialProduccionLimit', label: 'Historial de Producción (por área y global)' },
    { field: 'inspeccionesLimit', label: 'Inspecciones de Calidad' },
    { field: 'evaluacionesLimit', label: 'Evaluaciones de Desempeño' },
    { field: 'actividadesLimit', label: 'Actividades' },
    { field: 'requisicionesLimit', label: 'Requisiciones de Compra' },
    { field: 'movimientosPersonalLimit', label: 'Movimientos de Personal' },
    { field: 'auditLogLimit', label: 'Bitácora de Auditoría' },
  ];

  // Borrador local de los límites: solo se escribe a Firestore hasta que el campo
  // pierde el foco (evita una escritura y una re-suscripción de Firestore por cada
  // tecla presionada mientras el Admin está escribiendo el número)
  const [limitDrafts, setLimitDrafts] = useState(limits);
  const [focusedLimitField, setFocusedLimitField] = useState(null);

  useEffect(() => {
    setLimitDrafts((prev) => {
      const next = { ...prev };
      Object.keys(limits).forEach((key) => {
        if (key !== focusedLimitField) next[key] = limits[key];
      });
      return next;
    });
  }, [limits, focusedLimitField]);

  /**
   * Guarda en Firestore el límite editado cuando el input pierde el foco
   */
  const handleLimitBlur = (field) => {
    setFocusedLimitField(null);
    updateLimit(field, limitDrafts[field]);
  };

  // Modal de creación/edición de usuario
  const [userModal, setUserModal] = useState({ isOpen: false, mode: 'create', editingId: null });
  const [userForm, setUserForm] = useState(EMPTY_USER_FORM);

  // Modales de confirmación personalizados
  const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, user: null });

  // Modal para restablecer la contraseña de un usuario
  const [resetPasswordModal, setResetPasswordModal] = useState({ isOpen: false, userId: null, userName: '' });
  const [resetPasswordForm, setResetPasswordForm] = useState({ newPassword: '', confirmPassword: '' });

  // Modales de Áreas
  const [areaModal, setAreaModal] = useState({ isOpen: false, mode: 'create', editingId: null });
  const [areaForm, setAreaForm] = useState({ id: '', name: '' });
  const [deleteAreaConfirm, setDeleteAreaConfirm] = useState({ isOpen: false, area: null });

  // ============================================
  // HANDLERS - CONFIGURACIÓN
  // ============================================
  const handleToggleMaintenance = () => {
    updateGeneralConfig('maintenanceMode', !generalConfig.maintenanceMode);
  };

  const handleToggleNotifications = () => {
    updateGeneralConfig('autoQualityAlerts', !generalConfig.autoQualityAlerts);
  };

  const handleToleranceChange = (e) => {
    updateGeneralConfig('qualityTolerance', Number(e.target.value));
  };

  // ============================================
  // HANDLERS - GESTIÓN DE ÁREAS
  // ============================================
  const handleOpenCreateAreaModal = () => {
    setAreaForm({ id: '', name: '' });
    setAreaModal({ isOpen: true, mode: 'create', editingId: null });
  };

  const handleOpenEditAreaModal = (area) => {
    setAreaForm({ id: area.id, name: area.name });
    setAreaModal({ isOpen: true, mode: 'edit', editingId: area.id });
  };

  const handleCloseAreaModal = () => {
    setAreaModal({ isOpen: false, mode: 'create', editingId: null });
    setAreaForm({ id: '', name: '' });
  };

  const handleSubmitArea = async (e) => {
    e.preventDefault();
    if (!areaForm.id || !areaForm.name) {
      toast.danger('Completa el ID y el nombre del área.');
      return;
    }

    if (areaModal.mode === 'create') {
      const res = await addArea(areaForm);
      if (!res.ok) {
        toast.danger(res.error);
        return;
      }
      toast.success(`Área ${areaForm.name} creada correctamente.`);
    } else {
      const res = await updateArea(areaModal.editingId, { name: areaForm.name });
      if (!res.ok) {
        toast.danger(res.error);
        return;
      }
      toast.success(`Área actualizada correctamente.`);
    }
    handleCloseAreaModal();
  };

  const handleDeleteArea = (area) => {
    setDeleteAreaConfirm({ isOpen: true, area });
  };

  const handleConfirmDeleteArea = async () => {
    if (!deleteAreaConfirm.area) return;
    const res = await deleteArea(deleteAreaConfirm.area.id);
    if (!res.ok) {
      toast.danger(res.error);
    } else {
      toast.success(`Área eliminada.`);
    }
    setDeleteAreaConfirm({ isOpen: false, area: null });
  };

  // ============================================
  // HANDLERS - GESTIÓN DE USUARIOS
  // ============================================
  /**
   * Abre el modal para restablecer la contraseña de un usuario
   */
  const handleOpenResetPasswordModal = (usr) => {
    setResetPasswordForm({ newPassword: '', confirmPassword: '' });
    setResetPasswordModal({ isOpen: true, userId: usr.id, userName: usr.name });
  };

  const handleCloseResetPasswordModal = () => {
    setResetPasswordModal({ isOpen: false, userId: null, userName: '' });
    setResetPasswordForm({ newPassword: '', confirmPassword: '' });
  };

  /**
   * Valida y envía la contraseña nueva a la Cloud Function `resetUserPassword`
   */
  const handleSubmitResetPassword = async (e) => {
    e.preventDefault();
    const { newPassword, confirmPassword } = resetPasswordForm;

    if (newPassword.length < 6) {
      toast.danger('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.danger('Las contraseñas no coinciden.');
      return;
    }

    const result = await resetUserPassword(resetPasswordModal.userId, newPassword);
    if (result.ok) {
      toast.success(`🔑 Contraseña restablecida para ${resetPasswordModal.userName}.`);
      handleCloseResetPasswordModal();
    } else {
      toast.danger(result.error || 'No se pudo restablecer la contraseña.');
    }
  };

  const handleOpenCreateModal = () => {
    setUserForm(EMPTY_USER_FORM);
    setUserModal({ isOpen: true, mode: 'create', editingId: null });
  };

  const handleOpenEditModal = (usr) => {
    setUserForm({
      name: usr.name,
      email: usr.email,
      password: usr.password,
      roleType: usr.roleType,
      areaId: usr.areaId || '',
      areaIds: usr.areaIds || [],
      status: usr.status,
    });
    setUserModal({ isOpen: true, mode: 'edit', editingId: usr.id });
  };

  const handleCloseUserModal = () => {
    setUserModal({ isOpen: false, mode: 'create', editingId: null });
    setUserForm(EMPTY_USER_FORM);
  };

  const handleUserFormChange = (e) => {
    const { name, value } = e.target;
    setUserForm((prev) => {
      const updated = { ...prev, [name]: value };
      // Al cambiar de rol, limpiar los campos de área que ya no aplican
      if (name === 'roleType') {
        updated.areaId = '';
        updated.areaIds = [];
      }
      return updated;
    });
  };

  const handleToggleSupervisorArea = (areaId) => {
    setUserForm((prev) => {
      const isSelected = prev.areaIds.includes(areaId);
      return {
        ...prev,
        areaIds: isSelected ? prev.areaIds.filter((id) => id !== areaId) : [...prev.areaIds, areaId],
      };
    });
  };

  const handleSubmitUser = async (e) => {
    e.preventDefault();

    if (!userForm.name || !userForm.email || !userForm.password) {
      toast.danger('Por favor completa nombre, correo y contraseña.');
      return;
    }
    if (userForm.roleType === ROLE_TYPES.ENCARGADO_AREA && !userForm.areaId) {
      toast.danger('Selecciona el área a cargo del Encargado.');
      return;
    }
    if (userForm.roleType === ROLE_TYPES.SUPERVISOR_AREA && userForm.areaIds.length === 0) {
      toast.danger('Selecciona al menos un área para el Supervisor.');
      return;
    }

    const payload = {
      name: userForm.name,
      email: userForm.email,
      password: userForm.password,
      roleType: userForm.roleType,
      role: computeRoleLabel(userForm.roleType, userForm.areaId, userForm.areaIds, dynamicAreas),
      areaId: userForm.roleType === ROLE_TYPES.ENCARGADO_AREA ? userForm.areaId : null,
      areaIds: userForm.roleType === ROLE_TYPES.SUPERVISOR_AREA ? userForm.areaIds : undefined,
      status: userForm.status,
    };

    const result =
      userModal.mode === 'edit' ? await updateUser(userModal.editingId, payload) : await addUser(payload);

    if (!result.ok) {
      toast.danger(result.error);
      return;
    }

    toast.success(
      userModal.mode === 'edit' ? '✅ Usuario actualizado correctamente.' : '✅ Usuario creado correctamente.'
    );
    handleCloseUserModal();
  };

  const handleDeleteUser = (usr) => {
    setDeleteConfirmation({
      isOpen: true,
      user: usr,
    });
  };

  const handleConfirmDeleteUser = async () => {
    const usr = deleteConfirmation.user;
    if (!usr) return;

    const result = await deleteUser(usr.id);
    if (!result.ok) {
      toast.danger(result.error);
    } else {
      toast.success(`Usuario "${usr.name}" eliminado.`);
    }
    setDeleteConfirmation({ isOpen: false, user: null });
  };

  // ============================================
  // ANIMACIONES
  // ============================================
  const containerVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };

  const itemVariants = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  };

  return (
    <motion.div
      className={styles.container}
      variants={containerVariants}
      initial="initial"
      animate="animate"
    >
      {/* Cabecera */}
      <PageHeader
        title="Panel de Administración"
        subtitle="Configura parámetros globales del sistema y gestiona accesos."
        shape="trebol"
        accentColor="var(--color-secondary)"
      />

      <div className={styles.layoutGrid}>
        {/* Columna 1: Ajustes */}
        <motion.div variants={itemVariants}>
          <Card variant="default">
            <h3 className={styles.sectionTitle}>Configuración del Sistema</h3>
            <div className={styles.settingsList}>

              {/* Opción 1: Modo mantenimiento */}
              <div className={styles.settingItem}>
                <div className={styles.settingInfo}>
                  <strong>Modo Mantenimiento</strong>
                  <p>Bloquea accesos de operadores durante actualizaciones de stock.</p>
                </div>
                <button
                  type="button"
                  className={`${styles.toggle} ${generalConfig.maintenanceMode ? styles.toggleActive : ''}`}
                  onClick={handleToggleMaintenance}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              {/* Opción 2: Notificaciones */}
              <div className={styles.settingItem}>
                <div className={styles.settingInfo}>
                  <strong>Alertas de Calidad Automáticas</strong>
                  <p>Envía correos automáticos al encargado/supervisor del área si el score es menor a 8.</p>
                </div>
                <button
                  type="button"
                  className={`${styles.toggle} ${generalConfig.autoQualityAlerts ? styles.toggleActive : ''}`}
                  onClick={handleToggleNotifications}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>

              {/* Opción 3: Tolerancia */}
              <div className={styles.settingGroup}>
                <Select
                  label="Tolerancia de Calidad Exigida"
                  value={generalConfig.qualityTolerance}
                  onChange={handleToleranceChange}
                  options={[
                    { value: 95, label: '95% (Estricto)' },
                    { value: 90, label: '90% (Recomendado)' },
                    { value: 85, label: '85% (Flexible)' },
                  ]}
                />
              </div>

              {/* Opción 4: Frecuencia de Bloques de Evaluación */}
              <div className={styles.settingGroup}>
                <Select
                  label="Frecuencia de Bloques (Evaluación)"
                  value={blockDuration}
                  onChange={(e) => {
                    updateBlockDuration(e.target.value);
                    toast.success(`⏱️ Frecuencia cambiada a bloques de ${e.target.value} hora(s).`);
                  }}
                  options={[
                    { value: 1, label: 'Cada 1 Hora (Detallado)' },
                    { value: 2, label: 'Cada 2 Horas (Recomendado)' },
                    { value: 3, label: 'Cada 3 Horas (Rápido)' },
                  ]}
                />
              </div>

              {/* Opción 5: Límites dinámicos de historial en memoria */}
              <div className={styles.settingGroup}>
                <div className={styles.settingInfo}>
                  <strong>Registros Recientes en Memoria</strong>
                  <p>
                    Cuántos registros recientes de cada bitácora se mantienen cargados en
                    vivo (afecta memoria del navegador, no borra nada de la base de datos).
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                  {LIMIT_FIELDS.map(({ field, label }) => (
                    <div
                      key={field}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}
                    >
                      <label htmlFor={`limit-${field}`} style={{ fontSize: '14px', color: 'var(--color-dark)' }}>
                        {label}
                      </label>
                      <input
                        id={`limit-${field}`}
                        type="number"
                        min="1"
                        value={limitDrafts[field] ?? ''}
                        onFocus={() => setFocusedLimitField(field)}
                        onChange={(e) => setLimitDrafts((prev) => ({ ...prev, [field]: e.target.value }))}
                        onBlur={() => handleLimitBlur(field)}
                        style={{
                          width: '80px',
                          padding: '6px 10px',
                          border: '1px solid var(--color-gray-300)',
                          borderRadius: '6px',
                          textAlign: 'center',
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Columna 2: Usuarios */}
        <motion.div variants={itemVariants} className={styles.usersCol}>
          <Card variant="default">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Usuarios del Sistema</h3>
              <Button variant="primary" size="sm" onClick={handleOpenCreateModal}>
                ➕ Nuevo Usuario
              </Button>
            </div>
            <div className={styles.tableResponsive}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Área(s)</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((usr) => {
                    return (
                      <tr key={usr.id}>
                        <td data-label="Usuario">
                          <div className={styles.userInfoBlock}>
                            <span className={styles.avatarMini}>
                              {usr.name?.[0]?.toUpperCase() || 'U'}
                            </span>
                            <div className={styles.userDetails}>
                              <strong className={styles.userName}>{usr.name}</strong>
                              <span className={styles.userEmail}>{usr.email}</span>
                            </div>
                          </div>
                        </td>
                        <td data-label="Rol" className={styles.userRole}>{usr.role || ROLE_TYPE_LABELS[usr.roleType]}</td>
                        <td data-label="Área(s)" style={{ fontSize: '12px' }}>{getUserAreasText(usr, dynamicAreas)}</td>
                        <td data-label="Estado">
                          <Badge variant={usr.status === 'activo' ? 'success' : 'neutral'}>
                            {usr.status?.toUpperCase() || 'DESCONOCIDO'}
                          </Badge>
                        </td>
                        <td data-label="Acciones">
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            <Button variant="ghost" size="sm" onClick={() => handleOpenEditModal(usr)}>
                              ✏️ Editar
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleOpenResetPasswordModal(usr)}>
                              🔑 Restablecer
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              style={{ color: 'var(--color-danger)' }}
                              onClick={() => handleDeleteUser(usr)}
                            >
                              🗑️
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ÁREAS DE PRODUCCIÓN */}
          <Card variant="default" style={{ marginTop: 'var(--space-5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Áreas de Producción</h3>
              <Button variant="primary" size="sm" onClick={handleOpenCreateAreaModal}>
                ➕ Nueva Área
              </Button>
            </div>
            <div className={styles.tableResponsive}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nombre</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {dynamicAreas.map((area) => (
                    <tr key={area.id}>
                      <td data-label="ID"><code>{area.id}</code></td>
                      <td data-label="Nombre">{area.name}</td>
                      <td data-label="Acciones">
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <Button variant="ghost" size="sm" onClick={() => handleOpenEditAreaModal(area)}>
                            ✏️ Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            style={{ color: 'var(--color-danger)' }}
                            onClick={() => handleDeleteArea(area)}
                          >
                            🗑️
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {dynamicAreas.length === 0 && (
                    <tr>
                      <td colSpan={3} className={styles.emptyCell} style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                        No hay áreas configuradas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Bitácora de Auditoría — solo visible para Admin (esta ruta ya está 100%
          restringida a Admin por RoleRoute + canAccessSection) */}
      <motion.div variants={itemVariants} style={{ marginTop: 'var(--space-5)' }}>
        <Card variant="default">
          <h3 className={styles.sectionTitle}>Bitácora del Sistema</h3>
          <p style={{ fontSize: '13px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-3)' }}>
            Registro de toda acción realizada por cualquier usuario en cualquier módulo. Solo Admin puede verla.
          </p>
          <div className={styles.tableResponsive}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Fecha/Hora</th>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Módulo</th>
                  <th>Acción</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Fecha/Hora" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td data-label="Usuario">{entry.userName}</td>
                    <td data-label="Rol">
                      <Badge variant="neutral">{ROLE_TYPE_LABELS[entry.userRole] || entry.userRole || '—'}</Badge>
                    </td>
                    <td data-label="Módulo" style={{ textTransform: 'capitalize' }}>{entry.module}</td>
                    <td data-label="Acción">{entry.action}</td>
                    <td data-label="Detalle" style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>{entry.details}</td>
                  </tr>
                ))}

                {auditLog.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      Todavía no hay actividad registrada en la bitácora.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>

      {/* MODAL CREAR / EDITAR USUARIO */}
      <Modal
        isOpen={userModal.isOpen}
        onClose={handleCloseUserModal}
        title={userModal.mode === 'edit' ? 'Editar Usuario' : 'Registrar Nuevo Usuario'}
      >
        <form onSubmit={handleSubmitUser} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Nombre Completo</label>
            <input
              type="text"
              name="name"
              className={styles.textInput}
              placeholder="Ej: María López"
              value={userForm.name}
              onChange={handleUserFormChange}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Correo Electrónico</label>
            <input
              type="email"
              name="email"
              className={styles.textInput}
              placeholder="usuario@dicrejart.com"
              value={userForm.email}
              onChange={handleUserFormChange}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Contraseña</label>
            <input
              type="text"
              name="password"
              className={styles.textInput}
              placeholder="Contraseña de acceso"
              value={userForm.password}
              onChange={handleUserFormChange}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <Select
              label="Rol del Usuario"
              name="roleType"
              value={userForm.roleType}
              onChange={handleUserFormChange}
              required
              options={[
                { value: ROLE_TYPES.ADMIN, label: 'Administrador' },
                { value: ROLE_TYPES.CALIDAD, label: 'Inspector de Calidad' },
                { value: ROLE_TYPES.ENCARGADO_AREA, label: 'Encargado de Área' },
                { value: ROLE_TYPES.SUPERVISOR_AREA, label: 'Supervisor de Área' },
                { value: ROLE_TYPES.DIRECCION, label: 'Dirección' },
                { value: ROLE_TYPES.COMPRAS, label: 'Compras' },
              ]}
            />
          </div>

          {/* Área única, solo para Encargado de Área */}
          {userForm.roleType === ROLE_TYPES.ENCARGADO_AREA && (
            <div className={styles.formGroup}>
              <Select
                label="Área a Cargo"
                name="areaId"
                value={userForm.areaId}
                onChange={handleUserFormChange}
                required
                placeholder="-- Selecciona el Área --"
                options={dynamicAreas.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
          )}

          {/* Varias áreas, solo para Supervisor de Área */}
          {userForm.roleType === ROLE_TYPES.SUPERVISOR_AREA && (
            <div className={styles.formGroup}>
              <label className={styles.label}>Áreas Supervisadas</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid var(--color-gray-200)', borderRadius: '6px', padding: '10px' }}>
                {dynamicAreas.map((a) => (
                  <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={userForm.areaIds.includes(a.id)}
                      onChange={() => handleToggleSupervisorArea(a.id)}
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className={styles.formGroup}>
            <Select
              label="Estado"
              name="status"
              value={userForm.status}
              onChange={handleUserFormChange}
              required
              options={[
                { value: 'activo', label: 'Activo' },
                { value: 'inactivo', label: 'Inactivo' },
              ]}
            />
          </div>

          <div className={styles.formActions}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseUserModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="md">
              {userModal.mode === 'edit' ? 'Guardar Cambios' : 'Crear Usuario'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: RESTABLECER CONTRASEÑA DE USUARIO */}
      {resetPasswordModal.isOpen && (
        <Modal
          isOpen={resetPasswordModal.isOpen}
          onClose={handleCloseResetPasswordModal}
          title={`🔑 Restablecer Contraseña: ${resetPasswordModal.userName}`}
        >
          <form onSubmit={handleSubmitResetPassword} className={styles.form}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Contraseña Nueva</label>
              <input
                type="text"
                className={styles.textInput}
                placeholder="Mínimo 6 caracteres"
                value={resetPasswordForm.newPassword}
                onChange={(e) => setResetPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Confirmar Contraseña</label>
              <input
                type="text"
                className={styles.textInput}
                placeholder="Repite la contraseña nueva"
                value={resetPasswordForm.confirmPassword}
                onChange={(e) => setResetPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                required
              />
            </div>

            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
              Se aplica de inmediato — el colaborador deberá usar esta contraseña nueva la próxima vez que inicie sesión.
            </p>

            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button type="button" variant="secondary" size="md" onClick={handleCloseResetPasswordModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="md">
                Restablecer Contraseña
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN DE USUARIO */}
      {deleteConfirmation.isOpen && (
        <Modal
          isOpen={deleteConfirmation.isOpen}
          onClose={() => setDeleteConfirmation({ isOpen: false, user: null })}
          title="🗑️ Confirmar Eliminación"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar al usuario <strong>{deleteConfirmation.user?.name}</strong> ({deleteConfirmation.user?.email})?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción no se puede deshacer y revocará inmediatamente todos los permisos de acceso al sistema.
            </p>
            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setDeleteConfirmation({ isOpen: false, user: null })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={handleConfirmDeleteUser}
              >
                Eliminar Usuario
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CREAR/EDITAR ÁREA */}
      <Modal
        isOpen={areaModal.isOpen}
        onClose={handleCloseAreaModal}
        title={areaModal.mode === 'create' ? 'Crear Nueva Área' : 'Editar Área'}
      >
        <form onSubmit={handleSubmitArea} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>ID del Área</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder="Ej: corte-laser (sin espacios)"
              value={areaForm.id}
              onChange={(e) => setAreaForm({ ...areaForm, id: e.target.value })}
              disabled={areaModal.mode === 'edit'}
              required
            />
            {areaModal.mode === 'create' && (
              <p style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>El ID es permanente y no podrá modificarse luego.</p>
            )}
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Nombre del Área</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder="Ej: Corte Láser"
              value={areaForm.name}
              onChange={(e) => setAreaForm({ ...areaForm, name: e.target.value })}
              required
            />
          </div>
          <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseAreaModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="md">
              {areaModal.mode === 'create' ? 'Crear Área' : 'Guardar Cambios'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CONFIRMAR ELIMINACIÓN DE ÁREA */}
      {deleteAreaConfirm.isOpen && (
        <Modal
          isOpen={deleteAreaConfirm.isOpen}
          onClose={() => setDeleteAreaConfirm({ isOpen: false, area: null })}
          title="🗑️ Confirmar Eliminación"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar el área <strong>{deleteAreaConfirm.area?.name}</strong>?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-danger)', marginBottom: 'var(--space-5)' }}>
              ¡Atención! Eliminar un área podría romper registros históricos que dependan de ella (producción, operarios, etc).
            </p>
            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button type="button" variant="secondary" size="md" onClick={() => setDeleteAreaConfirm({ isOpen: false, area: null })}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" size="md" onClick={handleConfirmDeleteArea}>
                Eliminar Área
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CONFIRMACIÓN DE RESTABLECIMIENTO DE SISTEMA */}
    </motion.div>
  );
};

export default AdminPage;
