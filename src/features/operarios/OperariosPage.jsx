/**
 * @file OperariosPage.jsx
 * @description Página de Gestión de Operarios de la aplicación Dicrejart
 * Permite cargar el padrón, asignarlos a un área, prestarlos temporalmente
 * y configurar jornadas/horas extras (autorizadas por supervisor).
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 * @requires xlsx
 */

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import useOperarios from '../../hooks/useOperarios';
import useToast from '../../hooks/useToast';
import useAuth from '../../hooks/useAuth';
import useAreas from '../../hooks/useAreas';
import PageHeader from '../../components/ui/PageHeader';
import styles from './OperariosPage.module.css';

// Etiquetas e iconos del estado de disponibilidad del colaborador
const ESTADO_LABELS = {
  activo: 'Activo',
  falta: 'Falta',
  incapacidad: 'Incapacidad',
  viaje: 'Viaje / Ensamble Foráneo',
  actividad_externa: 'Actividad Externa',
  vacaciones: 'Vacaciones',
};
const ESTADO_ICONS = {
  activo: '🟢',
  falta: '🔴',
  incapacidad: '🤒',
  viaje: '✈️',
  actividad_externa: '🏗️',
  vacaciones: '🏖️',
};
const ESTADO_BADGE_VARIANT = {
  activo: 'success',
  falta: 'danger',
  incapacidad: 'warning',
  viaje: 'info',
  actividad_externa: 'primary',
  vacaciones: 'neutral',
};
const TIPO_MOV_LABELS = {
  prestamo: 'Préstamo Temporal',
  cambio_definitivo: 'Cambio Definitivo de Área',
};

/**
 * Componente OperariosPage - Padrón, asignación y préstamo de operarios
 * @component
 * @returns {ReactElement} Render de la página de operarios
 */
const OperariosPage = () => {
  // ============================================
  // ESTADO Y HOOKS
  // ============================================
  const {
    operarios,
    returnToHomeArea,
    updateOperarioSchedule,
    importFromExcel,
    deleteOperario,
    clearAllOperarios,
    movimientos,
    requestMovimiento,
    authorizeMovimientoOrigen,
    authorizeMovimientoDestino,
    rejectMovimiento,
    setOperarioEstado,
  } = useOperarios();

  const { user } = useAuth();
  const { areas: dynamicAreas } = useAreas();
  const toast = useToast();

  const fileInputRef = useRef(null);
  const [areaFilter, setAreaFilter] = useState('todas');

  // Estado para el modal de edición de jornada / horas extras
  const [scheduleModal, setScheduleModal] = useState({
    isOpen: false,
    collaborator: null,
    startHour: '8',
    endHour: '18',
    overtimeHours: '0',
    authorizedDate: '',
  });

  // Estado para el modal de solicitud de préstamo/cambio de área
  const [movRequestModal, setMovRequestModal] = useState({
    isOpen: false,
    operario: null,
    tipo: 'prestamo',
    toAreaId: '',
    fechaFinEstimada: '',
    motivo: '',
  });

  // Estado para el modal de cambio de disponibilidad del colaborador
  const [estadoModal, setEstadoModal] = useState({
    isOpen: false,
    operario: null,
    tipo: 'activo',
    desde: '',
    hasta: '',
    notas: '',
  });

  // Estado para el modal de autorización (correo + contraseña del área que autoriza)
  const [authModal, setAuthModal] = useState({
    isOpen: false,
    movimiento: null,
    stage: null,
    email: '',
    password: '',
    loading: false,
  });

  // Estado para el modal de rechazo de un movimiento
  const [rejectModal, setRejectModal] = useState({ isOpen: false, movimiento: null, notas: '' });

  // Confirmaciones de eliminación personalizadas
  const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, operario: null });
  const [clearAllConfirmation, setClearAllConfirmation] = useState({ isOpen: false });

  // Solo los administradores pueden autorizar y modificar jornadas
  const canManageSchedule = user?.roleType === 'admin';

  // ============================================
  // HELPERS
  // ============================================
  const getAreaName = (areaId) =>
    dynamicAreas.find((a) => a.id === areaId)?.name || areaId;

  // Arma el tooltip del badge de disponibilidad, dejando explícito cuando no hay
  // fecha de regreso definida (incapacidad/viaje/actividad externa sin "hasta")
  const getEstadoTooltip = (estado) => {
    if (!estado || estado.tipo === 'activo') return '';
    const desde = estado.desde ? `Desde: ${estado.desde}` : '';
    const hasta = `Hasta: ${estado.hasta || 'sin fecha definida'}`;
    const notas = estado.notas ? `Notas: ${estado.notas}` : '';
    return [desde, hasta, notas].filter(Boolean).join(' · ');
  };

  // Determina si el usuario logueado puede actuar (solicitar movimiento, marcar
  // estado) en nombre del área indicada: Admin siempre, Encargado/Supervisor solo
  // si esa área es la suya
  const canActOnArea = (areaId) => {
    if (!user) return false;
    if (user.roleType === 'admin') return true;
    // Calidad no está atado a una sola área (como Admin) — puede gestionar personal de cualquier área
    if (user.roleType === 'calidad') return true;
    if (user.roleType === 'supervisor-area') return (user.areaIds || []).includes(areaId);
    return false;
  };

  // ============================================
  // HANDLERS
  // ============================================

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);

      if (rows.length === 0) {
        toast.warning('El archivo no contiene filas para importar.');
        return;
      }

      const { added, skipped, duplicates } = await importFromExcel(rows);

      if (added > 0) {
        toast.success(
          `✅ ${added} operario${added === 1 ? '' : 's'} importado${added === 1 ? '' : 's'} correctamente.`
        );
      }
      if (duplicates > 0) {
        toast.info(
          `ℹ️ ${duplicates} colaborador${duplicates === 1 ? '' : 'es'} duplicado${duplicates === 1 ? '' : 's'} omitido${duplicates === 1 ? '' : 's'} por ya existir.`
        );
      }
      if (skipped > 0) {
        toast.warning(
          `⚠️ ${skipped} fila${skipped === 1 ? '' : 's'} omitida${skipped === 1 ? '' : 's'} (nombre o área no reconocidos).`
        );
      }
    } catch (error) {
      toast.danger('No se pudo leer el archivo. Verifica que sea un Excel válido (.xlsx).');
    } finally {
      e.target.value = '';
    }
  };

  const handleReturn = (operario) => {
    returnToHomeArea(operario.id);
    toast.success(`${operario.name} regresó a su área de origen (${getAreaName(operario.homeArea)}).`);
  };

  // Solicitud de préstamo / cambio definitivo de área
  const handleOpenMovRequestModal = (op) => {
    setMovRequestModal({
      isOpen: true,
      operario: op,
      tipo: 'prestamo',
      toAreaId: '',
      fechaFinEstimada: '',
      motivo: '',
    });
  };

  const handleCloseMovRequestModal = () => {
    setMovRequestModal({ isOpen: false, operario: null, tipo: 'prestamo', toAreaId: '', fechaFinEstimada: '', motivo: '' });
  };

  const handleSubmitMovRequest = async (e) => {
    e.preventDefault();
    const { operario, tipo, toAreaId, fechaFinEstimada, motivo } = movRequestModal;
    if (!toAreaId) {
      toast.warning('Selecciona un área destino.');
      return;
    }

    const result = await requestMovimiento({
      operarioId: operario.id,
      toAreaId,
      tipo,
      fechaFinEstimada,
      motivo,
      solicitadoPor: user?.name || 'Usuario',
    });

    if (result.ok) {
      toast.success(
        `Solicitud de ${tipo === 'prestamo' ? 'préstamo' : 'cambio definitivo'} creada. Pendiente de autorización de ${getAreaName(operario.currentArea)}.`
      );
      handleCloseMovRequestModal();
    } else {
      toast.danger(result.error || 'No se pudo crear la solicitud.');
    }
  };

  // Cambio de estado / disponibilidad del colaborador
  const handleOpenEstadoModal = (op) => {
    const todayStr = new Date().toISOString().split('T')[0];
    setEstadoModal({
      isOpen: true,
      operario: op,
      tipo: op.estado?.tipo || 'activo',
      desde: op.estado?.desde || todayStr,
      hasta: op.estado?.hasta || '',
      notas: '',
    });
  };

  const handleCloseEstadoModal = () => {
    setEstadoModal({ isOpen: false, operario: null, tipo: 'activo', desde: '', hasta: '', notas: '' });
  };

  const handleSubmitEstado = async (e) => {
    e.preventDefault();
    const { operario, tipo, desde, hasta, notas } = estadoModal;

    const result = await setOperarioEstado(operario.id, { tipo, desde, hasta: hasta || null, notas }, user?.name || 'Usuario');

    if (result.ok) {
      toast.success(`Estado de ${operario.name} actualizado a "${ESTADO_LABELS[tipo]}".`);
      handleCloseEstadoModal();
    } else {
      toast.danger(result.error || 'No se pudo actualizar el estado.');
    }
  };

  // Autorización de movimientos (correo + contraseña de quien autoriza)
  const handleOpenAuthModal = (mov) => {
    const stage = mov.status === 'pendiente_origen' ? 'origen' : 'destino';
    setAuthModal({ isOpen: true, movimiento: mov, stage, email: '', password: '', loading: false });
  };

  const handleCloseAuthModal = () => {
    setAuthModal({ isOpen: false, movimiento: null, stage: null, email: '', password: '', loading: false });
  };

  const handleSubmitAuth = async (e) => {
    e.preventDefault();
    const { movimiento, stage, email, password } = authModal;
    setAuthModal((prev) => ({ ...prev, loading: true }));

    const authorize = stage === 'origen' ? authorizeMovimientoOrigen : authorizeMovimientoDestino;
    const result = await authorize(movimiento.id, email, password);

    if (result.ok) {
      toast.success('✅ Movimiento autorizado correctamente.');
      handleCloseAuthModal();
    } else {
      toast.danger(result.error || 'No se pudo autorizar el movimiento.');
      setAuthModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // Rechazo de movimientos
  const handleOpenRejectModal = (mov) => {
    setRejectModal({ isOpen: true, movimiento: mov, notas: '' });
  };

  const handleCloseRejectModal = () => {
    setRejectModal({ isOpen: false, movimiento: null, notas: '' });
  };

  const handleSubmitReject = async (e) => {
    e.preventDefault();
    const result = await rejectMovimiento(rejectModal.movimiento.id, user?.name || 'Usuario', rejectModal.notas);

    if (result.ok) {
      toast.success('Movimiento rechazado.');
      handleCloseRejectModal();
    } else {
      toast.danger(result.error || 'No se pudo rechazar el movimiento.');
    }
  };

  const handleDelete = (op) => {
    setDeleteConfirmation({
      isOpen: true,
      operario: op,
    });
  };

  const handleConfirmDelete = async () => {
    const op = deleteConfirmation.operario;
    if (!op) return;
    await deleteOperario(op.id);
    toast.success(`🗑️ Operario ${op.name} eliminado de la base de datos.`);
    setDeleteConfirmation({ isOpen: false, operario: null });
  };

  const handleClearAll = () => {
    setClearAllConfirmation({ isOpen: true });
  };

  const handleConfirmClearAll = async () => {
    await clearAllOperarios();
    toast.success('💥 Todo el padrón de operarios ha sido vaciado de la base de datos.');
    setClearAllConfirmation({ isOpen: false });
  };

  // Modales de Jornada
  const handleOpenScheduleModal = (op) => {
    const todayStr = new Date().toISOString().split('T')[0];
    setScheduleModal({
      isOpen: true,
      collaborator: op,
      startHour: String(op.schedule?.startHour || 8),
      endHour: String(op.schedule?.endHour || 18),
      overtimeHours: String(op.schedule?.overtimeHours || 0),
      authorizedDate: op.schedule?.authorizedDate || todayStr,
    });
  };

  const handleCloseScheduleModal = () => {
    setScheduleModal({
      isOpen: false,
      collaborator: null,
      startHour: '8',
      endHour: '18',
      overtimeHours: '0',
      authorizedDate: '',
    });
  };

  const getIsSaturdayFromDate = (dateStr) => {
    if (!dateStr) return false;
    const date = new Date(dateStr + 'T00:00:00');
    return date.getDay() === 6; // 6 es Sábado
  };

  const handleDateChange = (e) => {
    const dateStr = e.target.value;
    const startVal = Number(scheduleModal.startHour);
    const endVal = Number(scheduleModal.endHour);

    const isSaturday = getIsSaturdayFromDate(dateStr);
    const baseEnd = isSaturday ? 13 : 18;

    const earlyOvertime = startVal < 8 ? 8 - startVal : 0;
    const lateOvertime = endVal > baseEnd ? endVal - baseEnd : 0;

    setScheduleModal((prev) => ({
      ...prev,
      authorizedDate: dateStr,
      overtimeHours: String(earlyOvertime + lateOvertime),
    }));
  };

  const handleStartHourChange = (e) => {
    const startVal = Number(e.target.value);
    const endVal = Number(scheduleModal.endHour);

    const isSaturday = getIsSaturdayFromDate(scheduleModal.authorizedDate);
    const baseEnd = isSaturday ? 13 : 18;

    const earlyOvertime = startVal < 8 ? 8 - startVal : 0;
    const lateOvertime = endVal > baseEnd ? endVal - baseEnd : 0;

    setScheduleModal((prev) => ({
      ...prev,
      startHour: String(startVal),
      overtimeHours: String(earlyOvertime + lateOvertime),
    }));
  };

  const handleEndHourChange = (e) => {
    const startVal = Number(scheduleModal.startHour);
    const endVal = Number(e.target.value);

    const isSaturday = getIsSaturdayFromDate(scheduleModal.authorizedDate);
    const baseEnd = isSaturday ? 13 : 18;

    const earlyOvertime = startVal < 8 ? 8 - startVal : 0;
    const lateOvertime = endVal > baseEnd ? endVal - baseEnd : 0;

    setScheduleModal((prev) => ({
      ...prev,
      endHour: String(endVal),
      overtimeHours: String(earlyOvertime + lateOvertime),
    }));
  };

  const handleSaveSchedule = (e) => {
    e.preventDefault();
    const { collaborator, startHour, endHour, overtimeHours, authorizedDate } = scheduleModal;

    updateOperarioSchedule(collaborator.id, {
      startHour: Number(startHour),
      endHour: Number(endHour),
      overtimeHours: Number(overtimeHours),
      authorizedBy: user?.name || 'Supervisor',
      authorizedDate,
    });

    toast.success(`⏱️ Horario actualizado para ${collaborator.name} para la fecha ${authorizedDate}. Horas extras: ${overtimeHours}h.`);
    handleCloseScheduleModal();
  };

  // ============================================
  // FILTRADO
  // ============================================
  const filteredOperarios =
    areaFilter === 'todas' ? operarios : operarios.filter((op) => op.currentArea === areaFilter);

  const prestadosCount = operarios.filter((op) => op.currentArea !== op.homeArea).length;
  
  const todayStr = new Date().toISOString().split('T')[0];
  const overtimeCount = operarios.filter(
    (op) => op.schedule?.overtimeHours > 0 && op.schedule?.authorizedDate === todayStr
  ).length;

  const pendingMovimientos = movimientos.filter(
    (m) => m.status === 'pendiente_origen' || m.status === 'pendiente_destino'
  );
  const historyMovimientos = movimientos
    .filter((m) => m.status === 'autorizado' || m.status === 'rechazado')
    .slice(0, 15);

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
        title="Operarios de Fábrica"
        subtitle="Gestiona el personal activo en el taller, préstamos de áreas y autorización de horas extras."
        shape="cacahuate"
        accentColor="var(--color-purple-x11)"
      >
        <Button variant="primary" size="md" onClick={handleUploadClick}>
          📥 Cargar Excel
        </Button>
        {canManageSchedule && operarios.length > 0 && (
          <Button 
            variant="danger" 
            size="md" 
            onClick={handleClearAll}
            style={{ backgroundColor: 'var(--color-alert)', border: 'none', color: 'white' }}
          >
            🗑️ Vaciar Padrón
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
      </PageHeader>

      {/* KPIs */}
      <div className={styles.kpiGrid}>
        <Card variant="default">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Total de Operarios</span>
            <h3 className={styles.kpiValue}>{operarios.length}</h3>
          </div>
        </Card>
        <Card variant="warning">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Colaboradores Prestados</span>
            <h3 className={styles.kpiValue} style={{ color: 'var(--color-warning)' }}>
              {prestadosCount}
            </h3>
          </div>
        </Card>
        <Card variant="highlight">
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Con Tiempo Extra Autorizado</span>
            <h3 className={styles.kpiValue} style={{ color: 'var(--color-primary)' }}>
              {overtimeCount}
            </h3>
          </div>
        </Card>
      </div>

      {/* Tabla e Historial */}
      <motion.div variants={itemVariants}>
        <Card variant="default">
          <div className={styles.filterBar}>
            <h3 className={styles.sectionTitle}>Padrón de Operarios</h3>
            <div className={styles.filterWrapper}>
              <Select
                label="Filtrar por Área Actual"
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                options={[
                  { value: 'todas', label: 'Todas las Áreas' },
                  ...dynamicAreas.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </div>
          </div>

          <div className={styles.tableResponsive}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Operario</th>
                  <th>Área de Origen</th>
                  <th>Área Actual</th>
                  <th>Jornada / Horario</th>
                  <th>Estado</th>
                  <th>Disponibilidad</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredOperarios.map((op) => {
                  const isPrestado = op.currentArea !== op.homeArea;
                  const isSat = new Date().getDay() === 6;
                  const defaultEnd = isSat ? 13 : 18;

                  const hasOvertimeToday = op.schedule?.overtimeHours > 0 && op.schedule?.authorizedDate === todayStr;
                  const hasOvertimeFuture = op.schedule?.overtimeHours > 0 && op.schedule?.authorizedDate > todayStr;

                  const startStr = String(hasOvertimeToday ? op.schedule.startHour : 8).padStart(2, '0');
                  const endStr = String(hasOvertimeToday ? op.schedule.endHour : defaultEnd).padStart(2, '0');

                  return (
                    <tr key={op.id}>
                      <td data-label="Operario">
                        <div className={styles.userInfoBlock}>
                          <span className={styles.avatarMini}>{op.name[0].toUpperCase()}</span>
                          <div>
                            <strong>{op.name}</strong>
                            <div style={{ fontSize: '10px', color: 'var(--color-gray-400)' }}>ID: {op.id}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Área de Origen">{getAreaName(op.homeArea)}</td>
                      <td data-label="Área Actual" className={styles.areaSelectCell}>{getAreaName(op.currentArea)}</td>
                      <td data-label="Jornada / Horario">
                        <div className={styles.scheduleInfoBlock}>
                          <span>{startStr}:00 - {endStr}:00</span>
                          {hasOvertimeToday && (
                            <div className={styles.overtimeBadgeWrapper}>
                              <Badge variant="warning" size="sm">
                                +{op.schedule.overtimeHours}h Extra
                              </Badge>
                              <span className={styles.authHint} title={`Autorizado por ${op.schedule.authorizedBy} para hoy (${op.schedule.authorizedDate})`}>
                                Autorizado
                              </span>
                            </div>
                          )}
                          {hasOvertimeFuture && (
                            <div className={styles.futureOvertimeHint} title={`Programado por ${op.schedule.authorizedBy}`}>
                              📅 Extra: +{op.schedule.overtimeHours}h el {op.schedule.authorizedDate}
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-label="Estado">
                        {isPrestado ? (
                          <Badge variant="warning">
                            Prestado de {getAreaName(op.homeArea)}
                          </Badge>
                        ) : (
                          <Badge variant="success">En su área</Badge>
                        )}
                      </td>
                      <td data-label="Disponibilidad">
                        <Badge
                          variant={ESTADO_BADGE_VARIANT[op.estado?.tipo || 'activo']}
                          title={getEstadoTooltip(op.estado)}
                        >
                          {ESTADO_ICONS[op.estado?.tipo || 'activo']} {ESTADO_LABELS[op.estado?.tipo || 'activo']}
                        </Badge>
                        {op.estado?.tipo && op.estado.tipo !== 'activo' && (
                          <div style={{ fontSize: '10px', color: 'var(--color-gray-400)', marginTop: '2px' }}>
                            Hasta: {op.estado.hasta || 'sin fecha definida'}
                          </div>
                        )}
                      </td>
                      <td data-label="Acciones">
                        <div className={styles.actionsCell}>
                          {isPrestado && (
                            <Button variant="ghost" size="sm" onClick={() => handleReturn(op)}>
                              ↩ Regresar
                            </Button>
                          )}
                          {canActOnArea(op.currentArea) && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => handleOpenMovRequestModal(op)}>
                                🔁 Mover
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleOpenEstadoModal(op)}>
                                🩺 Estado
                              </Button>
                            </>
                          )}
                          {canManageSchedule && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => handleOpenScheduleModal(op)}>
                                🕒 Jornada
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(op)}
                                style={{ color: 'var(--color-alert)' }}
                              >
                                🗑️ Eliminar
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredOperarios.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.emptyCell}>
                      No hay operarios en esta área.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>

      {/* Solicitudes de Movimiento Pendientes */}
      {pendingMovimientos.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card variant="warning">
            <h3 className={styles.sectionTitle}>🔁 Solicitudes de Movimiento Pendientes</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
              {pendingMovimientos.map((mov) => (
                <div
                  key={mov.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3)',
                    border: '1px solid var(--color-gray-200)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div>
                    <strong>{mov.operarioName}</strong> — {TIPO_MOV_LABELS[mov.tipo]}
                    <div style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                      {getAreaName(mov.fromAreaId)} → {getAreaName(mov.toAreaId)}
                      {mov.motivo && <> · {mov.motivo}</>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-400)' }}>
                      Solicitado por {mov.solicitadoPor} ·{' '}
                      {mov.status === 'pendiente_origen'
                        ? `Falta autorización de ${getAreaName(mov.fromAreaId)}`
                        : `Falta autorización de ${getAreaName(mov.toAreaId)}`}
                      {mov.status === 'pendiente_destino' && mov.origenAutorizadoPor && (
                        <> (origen autorizado por {mov.origenAutorizadoPor})</>
                      )}
                    </div>
                  </div>
                  <div className={styles.actionsCell}>
                    <Button variant="primary" size="sm" onClick={() => handleOpenAuthModal(mov)}>
                      🔑 Autorizar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenRejectModal(mov)}
                      style={{ color: 'var(--color-alert)' }}
                    >
                      ✖ Rechazar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Historial de Movimientos */}
      {historyMovimientos.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card variant="default">
            <h3 className={styles.sectionTitle}>📜 Historial de Movimientos</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              {historyMovimientos.map((mov) => (
                <div
                  key={mov.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderBottom: '1px solid var(--color-gray-100)',
                    fontSize: '13px',
                  }}
                >
                  <div>
                    <strong>{mov.operarioName}</strong> — {TIPO_MOV_LABELS[mov.tipo]}: {getAreaName(mov.fromAreaId)} →{' '}
                    {getAreaName(mov.toAreaId)}
                  </div>
                  {mov.status === 'autorizado' ? (
                    <Badge variant="success">
                      ✅ Autorizado{' '}
                      {mov.destinoAutorizadoPor
                        ? `(${mov.origenAutorizadoPor} + ${mov.destinoAutorizadoPor})`
                        : `por ${mov.origenAutorizadoPor}`}
                    </Badge>
                  ) : (
                    <Badge variant="danger" title={mov.notasRechazo || ''}>
                      ❌ Rechazado por {mov.rechazadoPor}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Modal: Solicitar Préstamo / Cambio Definitivo de Área */}
      {movRequestModal.isOpen && (
        <Modal
          isOpen={movRequestModal.isOpen}
          onClose={handleCloseMovRequestModal}
          title={`Solicitar Movimiento: ${movRequestModal.operario?.name}`}
        >
          <form onSubmit={handleSubmitMovRequest} className={styles.modalForm}>
            <div className={styles.modalMetaInfo}>
              <div>
                <strong>Área Actual:</strong> {getAreaName(movRequestModal.operario?.currentArea)}
              </div>
            </div>

            <div className={styles.formGroup}>
              <Select
                label="Tipo de Movimiento"
                value={movRequestModal.tipo}
                onChange={(e) => setMovRequestModal((prev) => ({ ...prev, tipo: e.target.value }))}
                options={[
                  { value: 'prestamo', label: 'Préstamo Temporal' },
                  { value: 'cambio_definitivo', label: 'Cambio Definitivo de Área' },
                ]}
              />
            </div>

            <div className={styles.formGroup}>
              <Select
                label="Área Destino"
                value={movRequestModal.toAreaId}
                onChange={(e) => setMovRequestModal((prev) => ({ ...prev, toAreaId: e.target.value }))}
                required
                options={[
                  { value: '', label: 'Selecciona...' },
                  ...dynamicAreas.filter((a) => a.id !== movRequestModal.operario?.currentArea).map((a) => ({
                    value: a.id,
                    label: a.name,
                  })),
                ]}
              />
            </div>

            {movRequestModal.tipo === 'prestamo' && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Fecha Estimada de Regreso (opcional)</label>
                <input
                  type="date"
                  className={styles.textInput}
                  value={movRequestModal.fechaFinEstimada}
                  onChange={(e) => setMovRequestModal((prev) => ({ ...prev, fechaFinEstimada: e.target.value }))}
                />
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label}>Motivo</label>
              <input
                type="text"
                className={styles.textInput}
                value={movRequestModal.motivo}
                onChange={(e) => setMovRequestModal((prev) => ({ ...prev, motivo: e.target.value }))}
                placeholder="Ej. Apoyo por pedido urgente en Herrería"
              />
            </div>

            {movRequestModal.tipo === 'cambio_definitivo' && (
              <p style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                ⚠️ Un cambio definitivo requiere autorización de ambas áreas (origen y destino) antes de aplicarse.
              </p>
            )}

            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" onClick={handleCloseMovRequestModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Enviar Solicitud
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Cambiar Estado / Disponibilidad del Colaborador */}
      {estadoModal.isOpen && (
        <Modal
          isOpen={estadoModal.isOpen}
          onClose={handleCloseEstadoModal}
          title={`Cambiar Estado: ${estadoModal.operario?.name}`}
        >
          <form onSubmit={handleSubmitEstado} className={styles.modalForm}>
            <div className={styles.formGroup}>
              <Select
                label="Estado"
                value={estadoModal.tipo}
                onChange={(e) => setEstadoModal((prev) => ({ ...prev, tipo: e.target.value }))}
                options={Object.entries(ESTADO_LABELS).map(([value, label]) => ({
                  value,
                  label: `${ESTADO_ICONS[value]} ${label}`,
                }))}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Desde</label>
              <input
                type="date"
                required
                className={styles.textInput}
                value={estadoModal.desde}
                onChange={(e) => setEstadoModal((prev) => ({ ...prev, desde: e.target.value }))}
              />
            </div>

            {estadoModal.tipo !== 'activo' && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Hasta (opcional)</label>
                <input
                  type="date"
                  className={styles.textInput}
                  value={estadoModal.hasta}
                  onChange={(e) => setEstadoModal((prev) => ({ ...prev, hasta: e.target.value }))}
                />
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label}>Notas</label>
              <input
                type="text"
                className={styles.textInput}
                value={estadoModal.notas}
                onChange={(e) => setEstadoModal((prev) => ({ ...prev, notas: e.target.value }))}
                placeholder="Ej. Incapacidad por IMSS, folio 12345"
              />
            </div>

            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" onClick={handleCloseEstadoModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Guardar Estado
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Autorizar Movimiento (correo + contraseña de quien autoriza) */}
      {authModal.isOpen && (
        <Modal
          isOpen={authModal.isOpen}
          onClose={handleCloseAuthModal}
          title={`Autorizar Movimiento (${authModal.stage === 'origen' ? 'Área Origen' : 'Área Destino'})`}
        >
          <form onSubmit={handleSubmitAuth} className={styles.modalForm}>
            <div className={styles.modalMetaInfo}>
              <div>
                <strong>Colaborador:</strong> {authModal.movimiento?.operarioName}
              </div>
              <div>
                <strong>Autoriza:</strong>{' '}
                {getAreaName(authModal.stage === 'origen' ? authModal.movimiento?.fromAreaId : authModal.movimiento?.toAreaId)}
              </div>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
              Ingresa el correo y contraseña del encargado/supervisor (o administrador) de esa área para confirmar la
              autorización.
            </p>

            <div className={styles.formGroup}>
              <label className={styles.label}>Correo</label>
              <input
                type="email"
                required
                className={styles.textInput}
                value={authModal.email}
                onChange={(e) => setAuthModal((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Contraseña</label>
              <input
                type="password"
                required
                className={styles.textInput}
                value={authModal.password}
                onChange={(e) => setAuthModal((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>

            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" onClick={handleCloseAuthModal} disabled={authModal.loading}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={authModal.loading}>
                {authModal.loading ? 'Verificando...' : '🔑 Confirmar Autorización'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Rechazar Movimiento */}
      {rejectModal.isOpen && (
        <Modal
          isOpen={rejectModal.isOpen}
          onClose={handleCloseRejectModal}
          title={`Rechazar Movimiento: ${rejectModal.movimiento?.operarioName}`}
        >
          <form onSubmit={handleSubmitReject} className={styles.modalForm}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Motivo del Rechazo</label>
              <input
                type="text"
                className={styles.textInput}
                value={rejectModal.notas}
                onChange={(e) => setRejectModal((prev) => ({ ...prev, notas: e.target.value }))}
                placeholder="Ej. El área no puede prescindir del colaborador esta semana"
              />
            </div>
            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" onClick={handleCloseRejectModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="danger">
                Rechazar Movimiento
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal para Editar Jornada / Autorizar Tiempo Extra */}
      {scheduleModal.isOpen && (
        <Modal
          isOpen={scheduleModal.isOpen}
          onClose={handleCloseScheduleModal}
          title={`Gestión de Jornada: ${scheduleModal.collaborator?.name}`}
        >
          <form onSubmit={handleSaveSchedule} className={styles.modalForm}>
            <div className={styles.modalMetaInfo}>
              <div>
                <strong>Colaborador:</strong> {scheduleModal.collaborator?.name}
              </div>
              <div>
                <strong>Área Actual:</strong> {getAreaName(scheduleModal.collaborator?.currentArea)}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Fecha de la Jornada</label>
              <input
                type="date"
                required
                className={styles.textInput}
                value={scheduleModal.authorizedDate}
                onChange={handleDateChange}
              />
            </div>

            <div className={styles.formGroup}>
              <Select
                label="Hora de Entrada del Colaborador"
                value={scheduleModal.startHour}
                onChange={handleStartHourChange}
                required
                options={[
                  { value: '6', label: '06:00 AM (Tiempo Extra Temprano)' },
                  { value: '7', label: '07:00 AM (Tiempo Extra Temprano)' },
                  { value: '8', label: '08:00 AM (Entrada Normal)' },
                ]}
              />
            </div>

            <div className={styles.formGroup}>
              <Select
                label="Hora de Salida del Colaborador"
                value={scheduleModal.endHour}
                onChange={handleEndHourChange}
                required
                options={[
                  { value: '13', label: '13:00 (Salida Normal Sábado)' },
                  { value: '14', label: '14:00' },
                  { value: '15', label: '15:00' },
                  { value: '16', label: '16:00' },
                  { value: '17', label: '17:00' },
                  { value: '18', label: '18:00 (Salida Normal Lunes-Viernes)' },
                  { value: '19', label: '19:00 (Tiempo Extra)' },
                  { value: '20', label: '20:00 (Tiempo Extra)' },
                  { value: '21', label: '21:00 (Tiempo Extra)' },
                  { value: '22', label: '22:00 (Tiempo Extra)' },
                ]}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Horas Extras Autorizadas</label>
              <input
                type="text"
                className={styles.textInputDisabled}
                value={`${scheduleModal.overtimeHours} hora(s)`}
                disabled
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Supervisor que Autoriza</label>
              <input
                type="text"
                className={styles.textInputDisabled}
                value={user?.name || 'Administrador'}
                disabled
              />
            </div>

            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" onClick={handleCloseScheduleModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Guardar y Autorizar
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN DE OPERARIO */}
      {deleteConfirmation.isOpen && (
        <Modal
          isOpen={deleteConfirmation.isOpen}
          onClose={() => setDeleteConfirmation({ isOpen: false, operario: null })}
          title="🗑️ Confirmar Eliminación"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar al colaborador <strong>{deleteConfirmation.operario?.name}</strong>?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción no se puede deshacer y borrará permanentemente sus registros de asistencia y evaluación.
            </p>
            <div className={styles.modalActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDeleteConfirmation({ isOpen: false, operario: null })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleConfirmDelete}
              >
                Eliminar Colaborador
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CONFIRMACIÓN DE VACIADO DE PADRÓN */}
      {clearAllConfirmation.isOpen && (
        <Modal
          isOpen={clearAllConfirmation.isOpen}
          onClose={() => setClearAllConfirmation({ isOpen: false })}
          title="⚠️ Vaciar Padrón de Operarios"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar a <strong>TODOS</strong> los operarios de la base de datos?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción es irreversible y borrará absolutamente todo el listado de colaboradores.
            </p>
            <div className={styles.modalActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setClearAllConfirmation({ isOpen: false })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleConfirmClearAll}
              >
                Vaciar Todo
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  );
};

export default OperariosPage;
