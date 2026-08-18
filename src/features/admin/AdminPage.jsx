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
import Switch from '../../components/ui/Switch';
import useToast from '../../hooks/useToast';
import useOperarios from '../../hooks/useOperarios';
import useCalidad from '../../hooks/useCalidad';
import useAuth from '../../hooks/useAuth';
import useConfig from '../../hooks/useConfig';
import { ROLE_TYPES, ROLE_TYPE_LABELS } from '../../data/usersData';
import useAreas from '../../hooks/useAreas';
import PageHeader from '../../components/ui/PageHeader';
import { triggerDailyRHNotification, triggerRHOvertimeNotification } from '../../services/rhNotificationService';
import { canAccessSection, isReadOnlySection } from '../../utils/roleAccess';
import styles from './AdminPage.module.css';

/**
 * Catálogo de secciones para el panel de Permisos por usuario (🔐 Permisos) — mismo
 * orden/íconos que la navegación principal (Sidebar.jsx), más 'admin' y 'produccion' que
 * no viven en esa lista. `hasEdit: true` marca las secciones que ya tienen un concepto
 * centralizado de solo-lectura vs edición (ver isReadOnlySection en roleAccess.js); las
 * demás son "todo o nada" (solo un interruptor de Ver).
 * @constant
 */
const PERMISSION_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', hasEdit: false },
  { id: 'proyectos', label: 'Proyectos', icon: '📋', hasEdit: true },
  { id: 'juegos', label: 'Juegos', icon: '🎮', hasEdit: true },
  { id: 'produccion', label: 'Producción', icon: '🏭', hasEdit: true },
  { id: 'operarios', label: 'Operarios', icon: '👷', hasEdit: false },
  { id: 'actividades', label: 'Actividades', icon: '📌', hasEdit: true },
  { id: 'calidad', label: 'Calidad', icon: '✅', hasEdit: true },
  { id: 'reportes', label: 'Reportes', icon: '📈', hasEdit: false },
  { id: 'compras', label: 'Compras', icon: '🛒', hasEdit: false },
  { id: 'chat', label: 'Chat', icon: '💬', hasEdit: false },
  { id: 'editor-visual', label: 'Editor Visual', icon: '🔗', hasEdit: false },
  { id: 'diseno', label: 'Diseño', icon: '🎨', hasEdit: false },
  { id: 'admin', label: 'Administración', icon: '⚙️', hasEdit: false },
];

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
  // Solo relevante para Diseñador/Arquitecto: id del registro del padrón de Operarios
  // (área "Diseño") al que se vincula esta cuenta, para poder filtrar sus tareas.
  operarioId: '',
  status: 'activo',
};

/** roleTypes que requieren vincularse a un registro del padrón de Operarios */
const DESIGN_ROLE_TYPES = [ROLE_TYPES.DISENADOR, ROLE_TYPES.ARQUITECTO];

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
  if (roleType === ROLE_TYPES.DISENADOR) return 'Diseñador';
  if (roleType === ROLE_TYPES.ARQUITECTO) return 'Arquitecto';

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
  const { operarios, horasExtra, blockDuration, updateBlockDuration } = useOperarios();
  const { findOrphanedEvaluaciones, deleteOrphanedEvaluaciones } = useCalidad();
  const { users, addUser, updateUser, deleteUser, resetUserPassword, updateUserPermission, resetUserPermission } = useAuth();
  const { limits, updateLimit, generalConfig, updateGeneralConfig, auditLog } = useConfig();
  const { areas: dynamicAreas, addArea, updateArea, deleteArea } = useAreas();
  const toast = useToast();

  // Auditoría manual de evaluaciones huérfanas (colaboradores eliminados cuyas
  // calificaciones de desempeño quedaron en Firestore antes de que deleteOperario
  // empezara a limpiarlas). status: 'idle' | 'loading' | 'done'
  const [orphanCheck, setOrphanCheck] = useState({ status: 'idle', orphaned: [] });

  /** Etiquetas legibles para cada límite dinámico de historial (colecciones tipo bitácora) */
  const LIMIT_FIELDS = [
    { field: 'historialProduccionLimit', label: 'Historial de Producción (por área y global)' },
    { field: 'inspeccionesLimit', label: 'Inspecciones de Calidad' },
    { field: 'evaluacionesLimit', label: 'Evaluaciones de Desempeño' },
    { field: 'actividadesLimit', label: 'Actividades' },
    { field: 'requisicionesLimit', label: 'Requisiciones de Compra' },
    { field: 'movimientosPersonalLimit', label: 'Movimientos de Personal' },
    { field: 'horasExtraLimit', label: 'Autorizaciones de Horas Extra' },
    { field: 'materialesLimit', label: 'Solicitudes de Materiales a Almacén' },
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

  // Modal de Permisos por usuario (🔐) — activar/desactivar por sección, sobrescribiendo
  // lo que el rol del usuario daría por defecto. Guarda solo el id (no una copia del
  // usuario): el usuario efectivo se resuelve en cada render contra `users` (en vivo vía
  // onSnapshot), para que los interruptores reflejen el cambio de inmediato en vez de
  // quedarse con el estado de cuando se abrió el modal.
  const [permissionsModal, setPermissionsModal] = useState({ isOpen: false, userId: null });

  // Modales de Áreas
  const [areaModal, setAreaModal] = useState({ isOpen: false, mode: 'create', editingId: null });
  const [areaForm, setAreaForm] = useState({ id: '', name: '' });
  const [deleteAreaConfirm, setDeleteAreaConfirm] = useState({ isOpen: false, area: null });

  // Modal de vista previa de Notificaciones a RH
  const [rhPreviewModal, setRhPreviewModal] = useState({ isOpen: false, notifRecord: null });

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
  // HANDLERS - AUDITORÍA DE DATOS HUÉRFANOS
  // ============================================
  const handleCheckOrphanedEvaluaciones = async () => {
    setOrphanCheck({ status: 'loading', orphaned: [] });
    const validIds = operarios.map((op) => op.id);
    const result = await findOrphanedEvaluaciones(validIds);

    if (!result.ok) {
      toast.danger(result.error || 'No se pudo revisar las evaluaciones.');
      setOrphanCheck({ status: 'idle', orphaned: [] });
      return;
    }

    setOrphanCheck({ status: 'done', orphaned: result.orphaned });
    if (result.orphaned.length === 0) {
      toast.success('✅ No se encontró ninguna calificación de un colaborador eliminado. Todo el historial corresponde a operarios activos en el padrón.');
    } else {
      toast.warning(`⚠️ Se encontraron ${result.orphaned.length} calificación(es) de colaboradores que ya no existen en el padrón.`);
    }
  };

  const handleCleanOrphanedEvaluaciones = async () => {
    const ids = orphanCheck.orphaned.map((o) => o.id);
    const result = await deleteOrphanedEvaluaciones(ids);
    if (result.ok) {
      toast.success(`🧹 ${ids.length} calificación(es) huérfana(s) eliminada(s).`);
      setOrphanCheck({ status: 'done', orphaned: [] });
    } else {
      toast.danger(result.error || 'No se pudo completar la limpieza.');
    }
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

  const handleOpenPermissionsModal = (usr) => {
    setPermissionsModal({ isOpen: true, userId: usr.id });
  };

  const handleClosePermissionsModal = () => {
    setPermissionsModal({ isOpen: false, userId: null });
  };

  /**
   * Prende/apaga el permiso de Ver (o de Editar) de una sección para el usuario del
   * modal de Permisos abierto. "Editar" implica "Ver": activarlo fuerza Ver a true, y
   * desactivar Ver también apaga Editar.
   */
  const handleTogglePermission = async (userId, section, field, value) => {
    const hasEdit = PERMISSION_SECTIONS.find((s) => s.id === section)?.hasEdit;
    if (field === 'edit' && value) {
      await updateUserPermission(userId, section, 'view', true);
    }
    if (field === 'view' && !value && hasEdit) {
      await updateUserPermission(userId, section, 'edit', false);
    }
    const res = await updateUserPermission(userId, section, field, value);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo actualizar el permiso.');
    }
  };

  const handleResetPermission = async (userId, section) => {
    const res = await resetUserPermission(userId, section);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo restablecer el permiso.');
    }
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
      operarioId: usr.operarioId || '',
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
      // Al cambiar de rol, limpiar los campos de área/vínculo que ya no aplican
      if (name === 'roleType') {
        updated.areaId = '';
        updated.areaIds = [];
        updated.operarioId = '';
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
    if (DESIGN_ROLE_TYPES.includes(userForm.roleType) && !userForm.operarioId) {
      toast.danger('Vincula esta cuenta a un registro del padrón de Operarios (Diseño).');
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
      operarioId: DESIGN_ROLE_TYPES.includes(userForm.roleType) ? userForm.operarioId : null,
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

              {/* Opción RH: Configuración Notificaciones a RH (10:00 AM) */}
              <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', backgroundColor: 'var(--color-gray-50)', borderRadius: '8px', border: '1px solid var(--color-gray-200)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <strong style={{ fontSize: '14px', color: 'var(--color-dark)' }}>📧 Notificación Diaria a Recursos Humanos (RH)</strong>
                    <p style={{ fontSize: '12px', color: 'var(--color-gray-600)', margin: '2px 0 0 0' }}>
                      Envía un reporte diario automático a las 10:00 AM con el personal ausente/faltante.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${styles.toggle} ${generalConfig.notificarFaltasRH !== false ? styles.toggleActive : ''}`}
                    onClick={() => {
                      const nextVal = generalConfig.notificarFaltasRH === false;
                      updateGeneralConfig('notificarFaltasRH', nextVal);
                      toast.info(nextVal ? 'Notificaciones diarias a RH activadas.' : 'Notificaciones a RH desactivadas.');
                    }}
                  >
                    <span className={styles.toggleKnob} />
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '10px', marginTop: '10px' }}>
                  <div>
                    <label htmlFor="email-rh-input" style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-dark)' }}>
                      Correo electrónico de Recursos Humanos:
                    </label>
                    <input
                      id="email-rh-input"
                      type="email"
                      placeholder="ej. recursoshumanos@dicrejart.com (Por definir)"
                      value={generalConfig.emailRH || ''}
                      onChange={(e) => updateGeneralConfig('emailRH', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-gray-300)',
                        marginTop: '4px'
                      }}
                    />
                  </div>

                  <div>
                    <label htmlFor="hora-rh-input" style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-dark)' }}>
                      Hora Envío:
                    </label>
                    <input
                      id="hora-rh-input"
                      type="time"
                      value={generalConfig.horaNotificacionRH || '10:00'}
                      onChange={(e) => updateGeneralConfig('horaNotificacionRH', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-gray-300)',
                        marginTop: '4px',
                        textAlign: 'center'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '8px', borderTop: '1px dashed var(--color-gray-300)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>
                    Último envío: {generalConfig.lastRHNotificationDate ? `Enviado hoy (${generalConfig.lastRHNotificationDate})` : 'Pendiente hoy'}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const res = await triggerDailyRHNotification({
                        operarios,
                        horasExtra,
                        generalConfig,
                        updateGeneralConfig,
                        force: true,
                        user
                      });
                      if (res && res.ok) {
                        toast.success(`📧 Reporte de RH preparado correctamente (${res.absentCount} personal ausente, ${res.horasExtraCount} hora(s) extra autorizadas). Destinatario: ${res.emailTarget}.`);
                        setRhPreviewModal({ isOpen: true, notifRecord: res.record });
                      } else {
                        toast.danger(res?.error || res?.reason || 'No se pudo generar el reporte.');
                      }
                    }}
                  >
                    📧 Probar / Enviar Ahora
                  </Button>
                </div>
              </div>

              {/* Opción RH-2: Correo vespertino/sabatino solo con horas extra autorizadas */}
              <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', backgroundColor: 'var(--color-gray-50)', borderRadius: '8px', border: '1px solid var(--color-gray-200)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <strong style={{ fontSize: '14px', color: 'var(--color-dark)' }}>🕒 Relación de Horas Extra a RH (Tarde)</strong>
                    <p style={{ fontSize: '12px', color: 'var(--color-gray-600)', margin: '2px 0 0 0' }}>
                      Envía solo la relación de personal con horas extra autorizadas hoy: Lun-Vie a las 17:30, sábado a las 12:00 (sin envío en domingo).
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${styles.toggle} ${generalConfig.notificarHorasExtraRH !== false ? styles.toggleActive : ''}`}
                    onClick={() => {
                      const nextVal = generalConfig.notificarHorasExtraRH === false;
                      updateGeneralConfig('notificarHorasExtraRH', nextVal);
                      toast.info(nextVal ? 'Correo de horas extra a RH activado.' : 'Correo de horas extra a RH desactivado.');
                    }}
                  >
                    <span className={styles.toggleKnob} />
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                  <div>
                    <label htmlFor="hora-he-semana-input" style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-dark)' }}>
                      Hora Envío (Lun-Vie):
                    </label>
                    <input
                      id="hora-he-semana-input"
                      type="time"
                      value={generalConfig.horaNotificacionHorasExtraRHSemana || '17:30'}
                      onChange={(e) => updateGeneralConfig('horaNotificacionHorasExtraRHSemana', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-gray-300)',
                        marginTop: '4px',
                        textAlign: 'center'
                      }}
                    />
                  </div>

                  <div>
                    <label htmlFor="hora-he-sabado-input" style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-dark)' }}>
                      Hora Envío (Sábado):
                    </label>
                    <input
                      id="hora-he-sabado-input"
                      type="time"
                      value={generalConfig.horaNotificacionHorasExtraRHSabado || '12:00'}
                      onChange={(e) => updateGeneralConfig('horaNotificacionHorasExtraRHSabado', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-gray-300)',
                        marginTop: '4px',
                        textAlign: 'center'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '8px', borderTop: '1px dashed var(--color-gray-300)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>
                    Último envío: {generalConfig.lastRHOvertimeNotificationDate ? `Enviado hoy (${generalConfig.lastRHOvertimeNotificationDate})` : 'Pendiente hoy'}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const res = await triggerRHOvertimeNotification({
                        horasExtra,
                        generalConfig,
                        updateGeneralConfig,
                        force: true,
                        user,
                        horaLabel: 'Prueba Manual',
                      });
                      if (res && res.ok) {
                        toast.success(`📧 Relación de horas extra preparada correctamente (${res.horasExtraCount} autorización(es)). Destinatario: ${res.emailTarget}.`);
                        setRhPreviewModal({ isOpen: true, notifRecord: res.record });
                      } else {
                        toast.danger(res?.error || res?.reason || 'No se pudo generar el reporte.');
                      }
                    }}
                  >
                    📧 Probar / Enviar Ahora
                  </Button>
                </div>
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
                            <Button variant="ghost" size="sm" onClick={() => handleOpenPermissionsModal(usr)}>
                              🔐 Permisos
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

          {/* AUDITORÍA DE DATOS HUÉRFANOS */}
          <Card variant="default" style={{ marginTop: 'var(--space-5)' }}>
            <h3 className={styles.sectionTitle}>🧹 Auditoría de Datos Huérfanos</h3>
            <p style={{ fontSize: '13px', color: 'var(--color-gray-500)', margin: 'var(--space-2) 0 var(--space-3)' }}>
              Revisa que no queden calificaciones de desempeño ("evaluaciones") de colaboradores que ya fueron
              eliminados del padrón de Operarios.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCheckOrphanedEvaluaciones}
              isLoading={orphanCheck.status === 'loading'}
            >
              🔍 Buscar Calificaciones Huérfanas
            </Button>

            {orphanCheck.status === 'done' && orphanCheck.orphaned.length === 0 && (
              <p style={{ marginTop: 'var(--space-3)', fontSize: '13px', color: 'var(--color-success)' }}>
                ✅ No se encontró ninguna calificación de un colaborador eliminado.
              </p>
            )}

            {orphanCheck.status === 'done' && orphanCheck.orphaned.length > 0 && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <p style={{ fontSize: '13px', color: 'var(--color-alert)', marginBottom: 'var(--space-2)' }}>
                  ⚠️ {orphanCheck.orphaned.length} calificación(es) pertenecen a un colaborador que ya no existe:
                </p>
                <ul style={{ fontSize: '12px', color: 'var(--color-gray-600)', marginBottom: 'var(--space-3)', paddingLeft: 'var(--space-4)' }}>
                  {orphanCheck.orphaned.slice(0, 10).map((o) => (
                    <li key={o.id}>Operario {o.operarioId} — bloque {o.blockId} — calificación {o.score}/10</li>
                  ))}
                  {orphanCheck.orphaned.length > 10 && <li>… y {orphanCheck.orphaned.length - 10} más.</li>}
                </ul>
                <Button variant="danger" size="sm" onClick={handleCleanOrphanedEvaluaciones}>
                  🗑️ Eliminar {orphanCheck.orphaned.length} Calificación(es) Huérfana(s)
                </Button>
              </div>
            )}
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
                { value: ROLE_TYPES.DISENADOR, label: 'Diseñador' },
                { value: ROLE_TYPES.ARQUITECTO, label: 'Arquitecto' },
              ]}
            />
          </div>

          {/* Vínculo a un registro del padrón de Operarios (Diseño), solo para
              Diseñador/Arquitecto — necesario para filtrar sus tareas asignadas */}
          {DESIGN_ROLE_TYPES.includes(userForm.roleType) && (() => {
            const puesto = userForm.roleType === ROLE_TYPES.DISENADOR ? 'disenador' : 'arquitecto';
            const linkedElsewhere = new Set(
              users.filter((u) => u.operarioId && u.id !== userModal.editingId).map((u) => u.operarioId)
            );
            const eligibleOperarios = operarios.filter(
              (op) => op.puesto === puesto && !linkedElsewhere.has(op.id)
            );
            return (
              <div className={styles.formGroup}>
                <Select
                  label="Vincular a Registro de Operarios (Diseño)"
                  name="operarioId"
                  value={userForm.operarioId}
                  onChange={handleUserFormChange}
                  required
                  placeholder="-- Selecciona el registro --"
                  options={eligibleOperarios.map((op) => ({ value: op.id, label: `${op.name} (${op.id})` }))}
                />
                {eligibleOperarios.length === 0 && (
                  <p style={{ fontSize: '11px', color: 'var(--color-alert)', marginTop: 'var(--space-1)' }}>
                    No hay registros de Operarios con puesto &ldquo;{ROLE_TYPE_LABELS[userForm.roleType]}&rdquo; disponibles
                    para vincular. Da de alta primero a esta persona desde Operarios → Nuevo Operario.
                  </p>
                )}
              </div>
            );
          })()}

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

      {/* MODAL: PERMISOS POR USUARIO (🔐) */}
      {permissionsModal.isOpen && users.find((u) => u.id === permissionsModal.userId) && (() => {
        const usr = users.find((u) => u.id === permissionsModal.userId);
        const overrides = usr.permissionOverrides || {};
        return (
          <Modal
            isOpen={permissionsModal.isOpen}
            onClose={handleClosePermissionsModal}
            title={`🔐 Permisos de ${usr.name}`}
          >
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: 0, marginBottom: 'var(--space-4)' }}>
              Cada cambio se aplica de inmediato. Sin ningún interruptor tocado, este
              colaborador se comporta según su rol (<strong>{usr.role}</strong>) — normal.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxHeight: '55vh', overflowY: 'auto' }}>
              {PERMISSION_SECTIONS.map((section) => {
                const sectionOverride = overrides[section.id];
                const hasOverride = sectionOverride !== undefined;
                // Solo informativo (aquí no hay un área específica de por medio): para
                // Encargado/Supervisor de Área, el acceso real a Producción depende
                // además del área asignada, ver canAccessSection en roleAccess.js.
                const roleDefaultView = canAccessSection(usr, section.id);
                const roleDefaultEdit = !isReadOnlySection(usr, section.id);
                const effectiveView = sectionOverride?.view ?? roleDefaultView;
                const effectiveEdit = sectionOverride?.edit ?? roleDefaultEdit;

                return (
                  <div
                    key={section.id}
                    style={{
                      padding: 'var(--space-3)',
                      borderRadius: '8px',
                      border: '1px solid var(--color-gray-200)',
                      background: hasOverride ? 'rgba(255, 51, 0, 0.03)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div>
                        <strong style={{ fontSize: '14px' }}>{section.icon} {section.label}</strong>
                        <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-gray-500)' }}>
                          Por defecto (rol {usr.role}): {roleDefaultView ? 'Sí' : 'No'}
                          {section.hasEdit ? ` ver / ${roleDefaultEdit ? 'Sí' : 'No'} editar` : ''}
                          {hasOverride && ' — personalizado'}
                        </p>
                      </div>
                      {hasOverride && (
                        <button
                          type="button"
                          onClick={() => handleResetPermission(usr.id, section.id)}
                          title="Restablecer al valor del rol"
                          style={{ border: 'none', background: 'none', color: 'var(--color-gray-500)', cursor: 'pointer', fontSize: '16px' }}
                        >
                          ↺
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-2)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px', cursor: 'pointer' }}>
                        <Switch
                          checked={effectiveView}
                          onChange={(value) => handleTogglePermission(usr.id, section.id, 'view', value)}
                          ariaLabel={`Ver ${section.label}`}
                        />
                        Ver
                      </label>
                      {section.hasEdit && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px', cursor: 'pointer' }}>
                          <Switch
                            checked={effectiveEdit}
                            onChange={(value) => handleTogglePermission(usr.id, section.id, 'edit', value)}
                            ariaLabel={`Editar ${section.label}`}
                          />
                          Editar
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button type="button" variant="secondary" size="md" onClick={handleClosePermissionsModal}>
                Cerrar
              </Button>
            </div>
          </Modal>
        );
      })()}

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

      {/* MODAL: VISTA PREVIA DE NOTIFICACIÓN A RH (10:00 AM o correo de horas extra) */}
      {rhPreviewModal.isOpen && rhPreviewModal.notifRecord && (
        <Modal
          isOpen={rhPreviewModal.isOpen}
          onClose={() => setRhPreviewModal({ isOpen: false, notifRecord: null })}
          title={rhPreviewModal.notifRecord.type === 'horas_extra' ? '📧 Relación de Horas Extra para RH' : '📧 Reporte Diario para Recursos Humanos (RH)'}
          size="lg"
        >
          <div style={{ padding: '4px 0' }}>
            <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '16px', fontSize: '13px' }}>
              <p style={{ margin: '0 0 4px 0' }}><strong>Destinatario RH:</strong> <span style={{ color: '#2563eb', fontWeight: 'bold' }}>{rhPreviewModal.notifRecord.emailRH}</span></p>
              <p style={{ margin: '0 0 4px 0' }}><strong>Fecha:</strong> {rhPreviewModal.notifRecord.date}</p>
              <p style={{ margin: '0 0 4px 0' }}><strong>Total Horas Extra Autorizadas:</strong> <Badge variant={rhPreviewModal.notifRecord.horasExtraCount > 0 ? 'warning' : 'neutral'}>{rhPreviewModal.notifRecord.horasExtraCount || 0} autorización(es)</Badge></p>
              {rhPreviewModal.notifRecord.type !== 'horas_extra' && (
                <>
                  <p style={{ margin: '0 0 4px 0' }}><strong>Total Personal Ausente:</strong> <Badge variant={rhPreviewModal.notifRecord.absentCount > 0 ? 'danger' : 'success'}>{rhPreviewModal.notifRecord.absentCount} colaborador(es)</Badge></p>
                  <p style={{ margin: 0 }}><strong>Verificaciones/Correcciones de Días Anteriores:</strong> <Badge variant={rhPreviewModal.notifRecord.verifiedPreviousDaysCount > 0 ? 'danger' : 'neutral'}>{rhPreviewModal.notifRecord.verifiedPreviousDaysCount || 0} registro(s)</Badge></p>
                </>
              )}
            </div>

            <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden', maxHeight: '420px', overflowY: 'auto' }}>
              <div dangerouslySetInnerHTML={{ __html: rhPreviewModal.notifRecord.bodyHtml }} />
            </div>

            <div className={styles.formActions} style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                ✅ Registro guardado en la bitácora de notificaciones Firestore.
              </span>
              <Button type="button" variant="primary" size="md" onClick={() => setRhPreviewModal({ isOpen: false, notifRecord: null })}>
                Entendido / Cerrar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  );
};

export default AdminPage;
