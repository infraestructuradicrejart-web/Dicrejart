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

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import useOperarios from '../../hooks/useOperarios';
import useToast from '../../hooks/useToast';
import useAuth from '../../hooks/useAuth';
import useAreas from '../../hooks/useAreas';
import { NON_PRODUCTION_AREAS } from '../../data/nonProductionAreasConfig';
import { ROLE_TYPE_LABELS } from '../../data/usersData';
import { PUESTO_LABELS, PUESTO_ICONS, PUESTO_BADGE_VARIANT, PUESTO_OPTIONS, DESIGN_PUESTOS } from '../../data/puestoConfig';
import { ESTADO_LABELS, ESTADO_ICONS, ESTADO_BADGE_VARIANT, ESTADO_OPTIONS } from '../../data/estadoConfig';
import useConfig from '../../hooks/useConfig';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import { triggerDailyRHNotification } from '../../services/rhNotificationService';
import { formatHourLabel } from '../../utils/overtimeUtils';
import useProgressiveList from '../../hooks/useProgressiveList';
import PageHeader from '../../components/ui/PageHeader';
import styles from './OperariosPage.module.css';

const TIPO_MOV_LABELS = {
  prestamo: 'Préstamo Temporal',
  cambio_definitivo: 'Cambio Definitivo de Área',
};

// Opciones del filtro de orden del padrón — "Antigüedad" usa el número de folio
// (OP-01, OP-02...), que se asigna en orden de alta, así que ordena de más antiguo a
// más nuevo sin necesitar una fecha de ingreso guardada aparte.
const SORT_OPTIONS = [
  { value: 'nombre-asc', label: 'Nombre (A-Z)' },
  { value: 'nombre-desc', label: 'Nombre (Z-A)' },
  { value: 'area', label: 'Área' },
  { value: 'estado', label: 'Disponibilidad' },
  { value: 'puesto', label: 'Puesto' },
  { value: 'antiguedad', label: 'Antigüedad (más antiguo primero)' },
];


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
    importFromExcel,
    addOperario,
    updateOperario,
    deleteOperario,
    clearAllOperarios,
    movimientos,
    requestMovimiento,
    authorizeMovimientoOrigen,
    authorizeMovimientoDestino,
    rejectMovimiento,
    setOperarioEstado,
    horasExtra,
    solicitudesHorasExtra,
    autorizarSolicitudHoraExtra,
    rechazarSolicitudHoraExtra,
    cancelarSolicitudHoraExtra,
    modificarSolicitudHoraExtra,
  } = useOperarios();

  const { user, users } = useAuth();
  const { areas: dynamicAreas } = useAreas();
  const { generalConfig, updateGeneralConfig } = useConfig();
  const toast = useToast();

  const fileInputRef = useRef(null);
  const [areaFilter, setAreaFilter] = useState('todas');
  const [estadoFilter, setEstadoFilter] = useState('todos');
  const [nameSearch, setNameSearch] = useState('');
  const [sortOrder, setSortOrder] = useState('nombre-asc');

  // Modal para consultar historial detallado de ausencias y faltas
  const [absencesModal, setAbsencesModal] = useState({
    isOpen: false,
    selectedOperarioId: 'todos',
  });

  // Barra de scroll horizontal duplicada arriba de la tabla: el navegador solo dibuja
  // la barra nativa hasta abajo de un contenedor con overflow-x, así que en una tabla
  // larga hay que bajar hasta el final para poder moverla. Se sincroniza a mano el
  // scrollLeft de un segundo contenedor (arriba, solo con un div "fantasma" del mismo
  // ancho que la tabla real) con el de la tabla — cualquiera de las dos mueve a la otra.
  const topScrollRef = useRef(null);
  const tableWrapRef = useRef(null);
  const isSyncingScrollRef = useRef(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return undefined;
    const updateScrollWidth = () => setTableScrollWidth(el.scrollWidth);
    updateScrollWidth();
    // ResizeObserver (no un listener de "resize" de ventana) para que también se
    // recalcule cuando la tabla cambia de ancho por su propio contenido — ej. al
    // filtrar por área y quedar menos filas, o al aparecer/ocultarse una columna.
    const observer = new ResizeObserver(updateScrollWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleTopScroll = () => {
    if (isSyncingScrollRef.current) { isSyncingScrollRef.current = false; return; }
    if (!topScrollRef.current || !tableWrapRef.current) return;
    isSyncingScrollRef.current = true;
    tableWrapRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  };

  const handleTableScroll = () => {
    if (isSyncingScrollRef.current) { isSyncingScrollRef.current = false; return; }
    if (!topScrollRef.current || !tableWrapRef.current) return;
    isSyncingScrollRef.current = true;
    topScrollRef.current.scrollLeft = tableWrapRef.current.scrollLeft;
  };

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

  // Estado para el modal de autorización (se elige quién autoriza de una lista, y solo se
  // pide su contraseña — el correo se resuelve internamente a partir del usuario elegido)
  const [authModal, setAuthModal] = useState({
    isOpen: false,
    movimiento: null,
    stage: null,
    userId: '',
    password: '',
    loading: false,
  });

  // Estado para el modal de rechazo de un movimiento
  const [rejectModal, setRejectModal] = useState({ isOpen: false, movimiento: null, notas: '' });

  // Confirmaciones de eliminación personalizadas
  const [deleteConfirmation, setDeleteConfirmation] = useState({ isOpen: false, operario: null });
  const [clearAllConfirmation, setClearAllConfirmation] = useState({ isOpen: false });

  // Estado para el modal de alta individual de un nuevo operario
  const [addModal, setAddModal] = useState({ isOpen: false, name: '', areaId: '', puesto: 'operario' });
  const [isAddingOperario, setIsAddingOperario] = useState(false);

  // Estado para el modal de edición de datos (nombre) de un colaborador ya existente
  const [editModal, setEditModal] = useState({ isOpen: false, operario: null, name: '' });
  const [isEditingOperario, setIsEditingOperario] = useState(false);

  // Solo los administradores pueden autorizar y modificar jornadas
  const canManageSchedule = user?.roleType === 'admin';

  // ============================================
  // HELPERS
  // ============================================
  const getAreaName = (areaId) =>
    dynamicAreas.find((a) => a.id === areaId)?.name ||
    NON_PRODUCTION_AREAS.find((a) => a.id === areaId)?.name ||
    areaId;

  /** Fecha/hora legible para cada paso del ciclo de vida de un movimiento (creación,
   * autorización de origen/destino, rechazo) — todos esos pasos guardan su propio ISO
   * timestamp en Firestore; los registros creados antes de este campo simplemente no
   * muestran nada en vez de una fecha inventada. */
  const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString('es-MX') : null);

  /** Etiqueta "Nombre (Rol)" para quien solicitó/autorizó/rechazó un movimiento — el rol
   * puede faltar en movimientos creados antes de que se empezara a guardar. */
  const actorLabel = (name, roleType) =>
    name ? `${name}${roleType && ROLE_TYPE_LABELS[roleType] ? ` (${ROLE_TYPE_LABELS[roleType]})` : ''}` : 'Desconocido';

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

  const handleOpenAddModal = () => {
    setAddModal({ isOpen: true, name: '', areaId: dynamicAreas[0]?.id || '', puesto: 'operario' });
  };

  const handleCloseAddModal = () => {
    setAddModal({ isOpen: false, name: '', areaId: '', puesto: 'operario' });
  };

  /**
   * Al cambiar el Puesto, el área se ajusta automáticamente: Diseño/Arquitectura solo
   * pueden pertenecer al área "Diseño" (única área no productiva hoy), mientras que
   * Operario de Piso vuelve a ofrecer las áreas de manufactura.
   */
  const handleAddModalPuestoChange = (puesto) => {
    setAddModal((prev) => ({
      ...prev,
      puesto,
      areaId: DESIGN_PUESTOS.includes(puesto) ? 'diseno' : (dynamicAreas[0]?.id || ''),
    }));
  };

  const handleSubmitAddOperario = async (e) => {
    e.preventDefault();
    setIsAddingOperario(true);
    const res = await addOperario(addModal.name, addModal.areaId, addModal.puesto);
    setIsAddingOperario(false);
    if (res.ok) {
      toast.success(`✅ ${PUESTO_LABELS[addModal.puesto]} "${addModal.name.trim()}" agregado al padrón.`);
      handleCloseAddModal();
    } else {
      toast.danger(res.error || 'No se pudo agregar el operario.');
    }
  };

  const handleOpenEditModal = (op) => {
    setEditModal({ isOpen: true, operario: op, name: op.name });
  };

  const handleCloseEditModal = () => {
    setEditModal({ isOpen: false, operario: null, name: '' });
  };

  const handleSubmitEditOperario = async (e) => {
    e.preventDefault();
    setIsEditingOperario(true);
    const res = await updateOperario(editModal.operario.id, { name: editModal.name });
    setIsEditingOperario(false);
    if (res.ok) {
      toast.success('✅ Datos del operario actualizados.');
      handleCloseEditModal();
    } else {
      toast.danger(res.error || 'No se pudo editar el operario.');
    }
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
    const todayStr = getTodayLocalDateStr();
    // 'falta' es un marcador de un solo día: si la falta que se muestra es de un día
    // ANTERIOR (pendiente de que el sistema la restablezca sola a "En Planta"), no debe
    // reusarse su fecha como default — si el usuario no la cambia a mano, una falta NUEVA
    // quedaría guardada con `desde` en el pasado, y el restablecimiento automático la
    // vería "ya vencida" y la borraría casi de inmediato (ver evaluateAndResetExpiredEstado
    // en OperariosContext.jsx). Se trata como si el colaborador ya estuviera activo, que es
    // lo que en realidad es en este momento.
    const estadoVencido = op.estado?.tipo === 'falta' && op.estado?.desde && op.estado.desde < todayStr;
    setEstadoModal({
      isOpen: true,
      operario: op,
      tipo: estadoVencido ? 'activo' : (op.estado?.tipo || 'activo'),
      desde: estadoVencido ? todayStr : (op.estado?.desde || todayStr),
      hasta: estadoVencido ? '' : (op.estado?.hasta || ''),
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

  // Autorización de movimientos: se elige de una lista quién autoriza (Admin, Calidad, o
  // el Encargado/Supervisor de esa área específica) y solo se pide su contraseña — el
  // correo para verificarla se resuelve del perfil ya elegido, no se vuelve a capturar.
  const handleOpenAuthModal = (mov) => {
    const stage = mov.status === 'pendiente_origen' ? 'origen' : 'destino';
    setAuthModal({ isOpen: true, movimiento: mov, stage, userId: '', password: '', loading: false });
  };

  const handleCloseAuthModal = () => {
    setAuthModal({ isOpen: false, movimiento: null, stage: null, userId: '', password: '', loading: false });
  };

  // Quién puede autorizar el movimiento en la etapa actual (origen o destino): Admin y
  // Calidad para cualquier área, Encargado de esa área específica, o Supervisor que la
  // cubra — mismo criterio de autoridad que ya valida verifyAreaAuthorizer del lado del
  // servidor; esta lista es solo para que el usuario elija a quién le va a pedir la
  // contraseña, no reemplaza esa verificación.
  const authModalAreaId = authModal.movimiento
    ? (authModal.stage === 'origen' ? authModal.movimiento.fromAreaId : authModal.movimiento.toAreaId)
    : null;
  const authModalCandidates = authModalAreaId
    ? users.filter((u) => {
        if (u.status && u.status !== 'activo') return false;
        if (u.roleType === 'admin' || u.roleType === 'calidad') return true;
        if (u.roleType === 'encargado-area') return u.areaId === authModalAreaId;
        if (u.roleType === 'supervisor-area') return (u.areaIds || []).includes(authModalAreaId);
        return false;
      })
    : [];

  const handleSubmitAuth = async (e) => {
    e.preventDefault();
    const { movimiento, stage, userId, password } = authModal;
    const selectedUser = users.find((u) => u.id === userId);
    if (!selectedUser) {
      toast.danger('Selecciona quién autoriza el movimiento.');
      return;
    }
    setAuthModal((prev) => ({ ...prev, loading: true }));

    const authorize = stage === 'origen' ? authorizeMovimientoOrigen : authorizeMovimientoDestino;
    const result = await authorize(movimiento.id, selectedUser.email, password);

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

  // ============================================
  // FILTRADO
  // ============================================
  const sortOperarios = (list) => {
    const sorted = [...list];
    switch (sortOrder) {
      case 'nombre-desc':
        return sorted.sort((a, b) => String(b?.name || '').localeCompare(String(a?.name || '')));
      case 'area':
        return sorted.sort((a, b) => String(getAreaName(a?.currentArea) || '').localeCompare(String(getAreaName(b?.currentArea) || '')));
      case 'estado':
        return sorted.sort((a, b) =>
          String(ESTADO_LABELS[a?.estado?.tipo || 'activo'] || '').localeCompare(String(ESTADO_LABELS[b?.estado?.tipo || 'activo'] || ''))
        );
      case 'puesto':
        return sorted.sort((a, b) => String(PUESTO_LABELS[a?.puesto] || '').localeCompare(String(PUESTO_LABELS[b?.puesto] || '')));
      case 'antiguedad':
        return sorted.sort((a, b) => {
          const idA = Number(String(a?.id || '').replace(/\D/g, '')) || 0;
          const idB = Number(String(b?.id || '').replace(/\D/g, '')) || 0;
          return idA - idB;
        });
      case 'nombre-asc':
      default:
        return sorted.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    }
  };

  const filteredOperarios = sortOperarios(
    operarios
      .filter((op) => (areaFilter === 'todas' ? true : op.currentArea === areaFilter))
      .filter((op) => {
        if (estadoFilter === 'todos') return true;
        if (estadoFilter === 'activo') return !op.estado?.tipo || op.estado.tipo === 'activo';
        if (estadoFilter === 'ausentes') return op.estado?.tipo && op.estado.tipo !== 'activo';
        return op.estado?.tipo === estadoFilter;
      })
      .filter((op) => (op.name || '').toLowerCase().includes(nameSearch.trim().toLowerCase()))
  );

  // Revela el padrón en tandas de 15 en vez de pintarlo completo de una vez — vuelve a
  // empezar desde la primera tanda cuando cambia el filtro de área, estado, búsqueda o el orden.
  const { visibleItems: visibleOperarios, hasMore: hasMoreOperarios, remaining: remainingOperarios, showMore: showMoreOperarios } = useProgressiveList(
    filteredOperarios,
    { resetKey: `${areaFilter}-${estadoFilter}-${nameSearch}-${sortOrder}` }
  );

  const prestadosCount = operarios.filter((op) => op.currentArea !== op.homeArea).length;
  
  const todayStr = getTodayLocalDateStr();
  const absentCount = operarios.filter((op) => op.estado?.tipo && op.estado.tipo !== 'activo').length;
  const overtimeCount = operarios.filter((op) => {
    const activeTodayHE = horasExtra.find(
      (h) => h.operarioId === op.id && h.authorizedDate === todayStr && h.verificationStatus !== 'cancelado'
    );
    const isOpActive = !op.estado?.tipo || op.estado.tipo === 'activo';
    return isOpActive && (Boolean(activeTodayHE) || (op.schedule?.overtimeHours > 0 && op.schedule?.authorizedDate === todayStr));
  }).length;

  // Historial global y por colaborador de todas las ausencias y faltas registradas
  const allAbsenceRecords = useMemo(() => {
    const records = [];
    operarios.forEach((op) => {
      // Estado actual si está ausente hoy
      if (op.estado && op.estado.tipo && op.estado.tipo !== 'activo') {
        records.push({
          id: `${op.id}-current`,
          operarioId: op.id,
          operarioName: op.name,
          areaId: op.currentArea,
          puesto: op.puesto || 'operario',
          tipo: op.estado.tipo,
          desde: op.estado.desde || todayStr,
          hasta: op.estado.hasta || null,
          notas: op.estado.notas || '',
          registradoPor: op.estado.registradoPor || 'N/A',
          registradoAt: op.estado.registradoAt || new Date().toISOString(),
          isCurrent: true,
        });
      }
      // Historial pasado
      (op.estadoHistorial || []).forEach((hist, idx) => {
        if (hist.tipo && hist.tipo !== 'activo') {
          records.push({
            id: `${op.id}-hist-${idx}`,
            operarioId: op.id,
            operarioName: op.name,
            areaId: op.currentArea,
            puesto: op.puesto || 'operario',
            tipo: hist.tipo,
            desde: hist.desde || (hist.registradoAt ? hist.registradoAt.split('T')[0] : null),
            hasta: hist.hasta || null,
            notas: hist.notas || '',
            registradoPor: hist.registradoPor || 'N/A',
            registradoAt: hist.registradoAt || null,
            isCurrent: false,
          });
        }
      });
    });

    // Ordenar del más reciente al más antiguo
    records.sort((a, b) => {
      const dateA = a.registradoAt || a.desde || '';
      const dateB = b.registradoAt || b.desde || '';
      return dateB.localeCompare(dateA);
    });

    return records;
  }, [operarios, todayStr]);

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
        <Button variant="primary" size="md" onClick={handleOpenAddModal}>
          ➕ Nuevo Operario
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={() => setAbsencesModal({ isOpen: true, selectedOperarioId: 'todos' })}
          title="Consultar historial detallado de todas las faltas, incapacidades y ausencias registradas"
        >
          📋 Historial de Ausencias ({allAbsenceRecords.length})
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={async () => {
            try {
              const res = await triggerDailyRHNotification({
                operarios,
                horasExtra,
                generalConfig,
                updateGeneralConfig,
                force: true,
                user
              });
              if (res && res.ok) {
                toast.success(`📧 Reporte a RH (10:00 AM) preparado para ${res.emailTarget}. Ausencias registradas hoy: ${res.absentCount}.`);
              } else {
                toast.danger(res?.error || res?.reason || 'No se pudo generar el reporte.');
              }
            } catch (error) {
              console.error('Error al probar el envío de RH:', error);
              toast.danger(`No se pudo generar el reporte: ${error.message}`);
            }
          }}
          title="Preparar / Enviar reporte de ausencias de personal para Recursos Humanos (10:00 AM)"
        >
          📧 Notificar RH (10:00 AM)
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
      <div className={styles.kpiGrid} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
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
        <Card
          variant={absentCount > 0 ? 'danger' : 'default'}
          style={{ cursor: 'pointer' }}
          onClick={() => setEstadoFilter((prev) => (prev === 'ausentes' ? 'todos' : 'ausentes'))}
          title="Clic para ver solo colaboradores ausentes hoy"
        >
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Personal Ausente Hoy</span>
            <h3 className={styles.kpiValue} style={{ color: absentCount > 0 ? 'var(--color-alert)' : 'inherit' }}>
              {absentCount}
            </h3>
          </div>
        </Card>
      </div>

      {/* Panel de Supervisión y Autorización de Horas Extras */}
      {(user?.roleType === 'admin' || user?.roleType === 'supervisor-area' || user?.roleType === 'calidad') && solicitudesHorasExtra.length > 0 && (
        <motion.div variants={itemVariants} style={{ marginBottom: 'var(--space-6)' }}>
          <Card variant="default">
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
                  ⏰ Solicitudes de Horas Extras ({solicitudesHorasExtra.filter(s => s.status === 'pendiente').length} Pendientes)
                </h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {solicitudesHorasExtra.map((sol) => (
                <div
                  key={sol.id}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '12px 16px',
                    backgroundColor: sol.status === 'pendiente' ? '#fffbeb' : '#f8fafc',
                    borderRadius: '8px',
                    border: sol.status === 'pendiente' ? '1px solid #fde68a' : '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      ⏱️ <strong>{sol.horas}h</strong> extra ({sol.bloque === 'matutino' ? '🌅 Matutino' : '🌆 Vespertino'}) para el 📅 <strong>{sol.fecha}</strong>
                    </div>
                    {sol.motivo && (
                      <div style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                        Motivo/Tareas: <em>"{sol.motivo}"</em>
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                      Solicitado por: <strong>{sol.solicitadoPor}</strong> ({actorLabel(sol.solicitadoPor, sol.solicitadoPorRole)}) · {formatDateTime(sol.createdAt)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {sol.status === 'pendiente' && <Badge variant="warning">🟡 Pendiente de Revisión</Badge>}
                    {sol.status === 'autorizada' && <Badge variant="success">🟢 Autorizada por {sol.revisadoPor}</Badge>}
                    {sol.status === 'rechazada' && <Badge variant="danger">🔴 Rechazada por {sol.revisadoPor}</Badge>}
                    {sol.status === 'cancelada' && <Badge variant="neutral">⚪ Cancelada ({sol.canceladaPor})</Badge>}

                    {sol.status === 'pendiente' && (user?.roleType === 'admin' || user?.roleType === 'supervisor-area') && (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={async () => {
                            const res = await autorizarSolicitudHoraExtra(sol.id, 'Autorizada desde panel de supervisión');
                            if (res.ok) {
                              toast.success(`✅ Solicitud autorizada para ${sol.operarioName}. Horario actualizado automáticamente.`);
                            } else {
                              toast.danger(res.error || 'Error al autorizar.');
                            }
                          }}
                        >
                          ✅ Autorizar
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          style={{ color: 'var(--color-alert)' }}
                          onClick={async () => {
                            const notes = window.prompt(`Indica el motivo de rechazo para la solicitud de ${sol.operarioName}:`);
                            if (notes === null) return;
                            const res = await rechazarSolicitudHoraExtra(sol.id, notes);
                            if (res.ok) {
                              toast.success(`Solicitud de ${sol.operarioName} rechazada.`);
                            }
                          }}
                        >
                          ❌ Rechazar
                        </Button>
                      </div>
                    )}

                    {(sol.status === 'pendiente' || sol.status === 'autorizada') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (!window.confirm(`¿Seguro que deseas cancelar la solicitud de ${sol.operarioName}?`)) return;
                          const res = await cancelarSolicitudHoraExtra(sol.id, 'Cancelado desde panel de supervisión');
                          if (res.ok) {
                            toast.success(`Solicitud cancelada. Horario de ${sol.operarioName} resincronizado.`);
                          }
                        }}
                      >
                        🚫 Cancelar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Tabla e Historial */}
      <motion.div variants={itemVariants}>
        <Card variant="default">
          <div className={styles.filterBar}>
            <h3 className={styles.sectionTitle}>Padrón de Operarios</h3>
            <div className={styles.filtersGroup}>
              <div className={styles.filterWrapper} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {/* Select.jsx pone su etiqueta ARRIBA de la caja (empujándola hacia abajo);
                    el label flotante de Input.jsx vive DENTRO de la caja, así que usar
                    Input con label="" desalineaba las dos cajas. Se replica manualmente la
                    misma etiqueta/espaciado de Select.module.css para que ambas cajas
                    queden a la misma altura. */}
                <label style={{ fontSize: 'var(--body-size)', color: 'var(--color-gray-600)' }}>Buscar por Nombre</label>
                <Input
                  placeholder="Ej: Juan Pérez..."
                  value={nameSearch}
                  onChange={(e) => setNameSearch(e.target.value)}
                  icon="🔍"
                />
              </div>
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
              <div className={styles.filterWrapper}>
                <Select
                  label="Ordenar por"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  options={SORT_OPTIONS}
                />
              </div>
            </div>
          </div>

          <div className={styles.topScrollbar} ref={topScrollRef} onScroll={handleTopScroll}>
            <div style={{ width: tableScrollWidth, height: 1 }} />
          </div>

          <div className={styles.tableResponsive} ref={tableWrapRef} onScroll={handleTableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Operario</th>
                  <th>Puesto</th>
                  <th className={styles.areaSelectCell}>Área</th>
                  <th>Jornada / Horario</th>
                  <th>Estado</th>
                  <th>Disponibilidad</th>
                  <th className={styles.stickyActionsHeader}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleOperarios.map((op) => {
                  const isPrestado = op.currentArea !== op.homeArea;
                  // El personal de Diseño tiene una jerarquía distinta a la del piso de
                  // manufactura: no aplican préstamos/cambios de área entre áreas de
                  // producción ni jornada/horas extra — solo Estado, Editar y Eliminar.
                  const isDesignStaff = DESIGN_PUESTOS.includes(op.puesto);
                  const isSat = new Date().getDay() === 6;
                  const defaultEnd = isSat ? 13 : 18;

                  const activeTodayHE = horasExtra.find(
                    (h) => h.operarioId === op.id && h.authorizedDate === todayStr && h.verificationStatus !== 'cancelado'
                  );
                  const isOpActive = !op.estado?.tipo || op.estado.tipo === 'activo';
                  const hasOvertimeToday = isOpActive && (Boolean(activeTodayHE) || (op.schedule?.overtimeHours > 0 && op.schedule?.authorizedDate === todayStr));
                  const effectiveStartHour = activeTodayHE ? activeTodayHE.startHour : (hasOvertimeToday ? op.schedule.startHour : 8);
                  const effectiveEndHour = activeTodayHE ? activeTodayHE.endHour : (hasOvertimeToday ? op.schedule.endHour : defaultEnd);
                  const effectiveOvertimeHours = activeTodayHE ? activeTodayHE.overtimeHours : (hasOvertimeToday ? op.schedule.overtimeHours : 0);
                  const effectiveAuthorizedBy = activeTodayHE ? activeTodayHE.authorizedBy : (op.schedule?.authorizedBy || 'Supervisor');

                  // Las autorizaciones para fechas FUTURAS se consultan directo en horas_extra
                  const nextFutureHE = horasExtra
                    .filter((h) => h.operarioId === op.id && h.authorizedDate > todayStr && h.verificationStatus !== 'cancelado')
                    .sort((a, b) => a.authorizedDate.localeCompare(b.authorizedDate))[0];
                  const hasOvertimeFuture = Boolean(nextFutureHE);

                  const startStr = formatHourLabel(hasOvertimeToday ? effectiveStartHour : 8);
                  const endStr = formatHourLabel(hasOvertimeToday ? effectiveEndHour : defaultEnd);

                  return (
                    <tr key={op.id}>
                      <td data-label="Operario">
                        <div className={styles.userInfoBlock}>
                          <span className={styles.avatarMini}>{(op.name || 'O')[0].toUpperCase()}</span>
                          <div>
                            <strong>{op.name || 'Sin Nombre'}</strong>
                            <div style={{ fontSize: '10px', color: 'var(--color-gray-400)' }}>ID: {op.id || 'N/A'}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Puesto">
                        <Badge variant={PUESTO_BADGE_VARIANT[op.puesto]}>
                          {PUESTO_ICONS[op.puesto]} {PUESTO_LABELS[op.puesto]}
                        </Badge>
                      </td>
                      <td data-label="Área" className={styles.areaSelectCell}>{getAreaName(op.currentArea)}</td>
                      <td data-label="Jornada / Horario">
                        <div className={styles.scheduleInfoBlock}>
                          <span>{startStr} - {endStr}</span>
                          {hasOvertimeToday && (
                            <div className={styles.overtimeBadgeWrapper}>
                              <Badge variant="warning" size="sm">
                                +{effectiveOvertimeHours}h Extra
                              </Badge>
                              <span className={styles.authHint} title={`Autorizado por ${effectiveAuthorizedBy} para hoy (${todayStr})`}>
                                Autorizado
                              </span>
                            </div>
                          )}
                          {hasOvertimeFuture && (
                            <div className={styles.futureOvertimeHint} title={`Programado por ${nextFutureHE.authorizedBy}`}>
                              📅 Extra: +{nextFutureHE.overtimeHours}h el {nextFutureHE.authorizedDate}
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <Badge
                            variant={ESTADO_BADGE_VARIANT[op.estado?.tipo || 'activo']}
                            title={getEstadoTooltip(op.estado)}
                          >
                            {ESTADO_ICONS[op.estado?.tipo || 'activo']} {ESTADO_LABELS[op.estado?.tipo || 'activo']}
                          </Badge>
                          {op.estado?.tipo && op.estado.tipo !== 'activo' && (
                            <div style={{ fontSize: '10px', color: 'var(--color-gray-400)' }}>
                              Hasta: {op.estado.hasta || 'sin fecha definida'}
                            </div>
                          )}
                          {((op.estadoHistorial && op.estadoHistorial.some(h => h.tipo && h.tipo !== 'activo')) || (op.estado?.tipo && op.estado.tipo !== 'activo')) && (
                            <button
                              type="button"
                              onClick={() => setAbsencesModal({ isOpen: true, selectedOperarioId: op.id })}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--color-primary)',
                                fontSize: '10px',
                                textDecoration: 'underline',
                                cursor: 'pointer',
                                padding: 0,
                                textAlign: 'left',
                                marginTop: '2px',
                              }}
                              title="Ver historial de ausencias y faltas de este colaborador"
                            >
                              📜 Ver historial
                            </button>
                          )}
                        </div>
                      </td>
                      <td data-label="Acciones" className={styles.stickyActionsCell}>
                        <div className={styles.actionsCell}>
                          {isPrestado && !isDesignStaff && (
                            <Button variant="ghost" size="sm" onClick={() => handleReturn(op)}>
                              ↩ Regresar
                            </Button>
                          )}
                          {canActOnArea(op.currentArea) && (
                            <>
                              {!isDesignStaff && (
                                <Button variant="ghost" size="sm" onClick={() => handleOpenMovRequestModal(op)}>
                                  🔁 Mover
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => handleOpenEstadoModal(op)}>
                                🩺 Estado
                              </Button>
                            </>
                          )}
                          {canManageSchedule && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => handleOpenEditModal(op)}>
                                ✏️ Editar
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
          {hasMoreOperarios && (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
              <Button variant="secondary" onClick={showMoreOperarios}>
                Cargar {Math.min(remainingOperarios, 15)} más ({remainingOperarios} restantes)
              </Button>
            </div>
          )}
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
                    <strong>{mov.operarioName}</strong>{' '}
                    <Badge variant={PUESTO_BADGE_VARIANT[mov.operarioPuesto || 'operario']} size="sm">
                      {PUESTO_ICONS[mov.operarioPuesto || 'operario']} {PUESTO_LABELS[mov.operarioPuesto || 'operario']}
                    </Badge>
                    {' '}— {TIPO_MOV_LABELS[mov.tipo]}
                    <div style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                      {getAreaName(mov.fromAreaId)} → {getAreaName(mov.toAreaId)}
                      {mov.motivo && <> · {mov.motivo}</>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-400)' }}>
                      Solicitado por {actorLabel(mov.solicitadoPor, mov.solicitadoPorRole)}
                      {formatDateTime(mov.createdAt) && <> el {formatDateTime(mov.createdAt)}</>} ·{' '}
                      {mov.status === 'pendiente_origen'
                        ? `Falta autorización de ${getAreaName(mov.fromAreaId)}`
                        : `Falta autorización de ${getAreaName(mov.toAreaId)}`}
                      {mov.status === 'pendiente_destino' && mov.origenAutorizadoPor && (
                        <>
                          {' '}(origen autorizado por {actorLabel(mov.origenAutorizadoPor, mov.origenAutorizadoPorRole)}
                          {formatDateTime(mov.origenAutorizadoAt) && <> el {formatDateTime(mov.origenAutorizadoAt)}</>})
                        </>
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
                    <strong>{mov.operarioName}</strong>{' '}
                    <Badge variant={PUESTO_BADGE_VARIANT[mov.operarioPuesto || 'operario']} size="sm">
                      {PUESTO_ICONS[mov.operarioPuesto || 'operario']} {PUESTO_LABELS[mov.operarioPuesto || 'operario']}
                    </Badge>
                    {' '}— {TIPO_MOV_LABELS[mov.tipo]}: {getAreaName(mov.fromAreaId)} →{' '}
                    {getAreaName(mov.toAreaId)}
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-400)' }}>
                      Solicitado por {actorLabel(mov.solicitadoPor, mov.solicitadoPorRole)}
                      {formatDateTime(mov.createdAt) && <> el {formatDateTime(mov.createdAt)}</>}
                    </div>
                  </div>
                  {mov.status === 'autorizado' ? (
                    <Badge variant="success" title={formatDateTime(mov.destinoAutorizadoAt || mov.origenAutorizadoAt) || ''}>
                      ✅ Autorizado{' '}
                      {mov.destinoAutorizadoPor
                        ? `(${actorLabel(mov.origenAutorizadoPor, mov.origenAutorizadoPorRole)} + ${actorLabel(mov.destinoAutorizadoPor, mov.destinoAutorizadoPorRole)})`
                        : `por ${actorLabel(mov.origenAutorizadoPor, mov.origenAutorizadoPorRole)}`}
                      {formatDateTime(mov.destinoAutorizadoAt || mov.origenAutorizadoAt) && (
                        <> el {formatDateTime(mov.destinoAutorizadoAt || mov.origenAutorizadoAt)}</>
                      )}
                    </Badge>
                  ) : (
                    <Badge variant="danger" title={mov.notasRechazo || ''}>
                      ❌ Rechazado por {actorLabel(mov.rechazadoPor, mov.rechazadoPorRole)}
                      {formatDateTime(mov.rechazadoAt) && <> el {formatDateTime(mov.rechazadoAt)}</>}
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
              <label className={styles.label}>Desde (Fecha de Inicio)</label>
              <input
                type="date"
                required
                className={styles.textInput}
                value={estadoModal.desde}
                onChange={(e) => setEstadoModal((prev) => ({ ...prev, desde: e.target.value }))}
              />
            </div>

            {estadoModal.tipo === 'falta' && (
              <div className={styles.formGroup}>
                <p style={{ fontSize: '12px', color: 'var(--color-primary)', background: 'var(--color-gray-100)', padding: '8px 12px', borderRadius: '6px' }}>
                  ℹ <strong>Inasistencia Diaria:</strong> Las faltas aplican para la jornada de hoy. Al día siguiente, el sistema restablecerá automáticamente el estado del colaborador a <strong>"En Planta"</strong>.
                </p>
              </div>
            )}

            {estadoModal.tipo !== 'activo' && estadoModal.tipo !== 'falta' && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Hasta (Fecha de Término)</label>
                <input
                  type="date"
                  className={styles.textInput}
                  value={estadoModal.hasta}
                  onChange={(e) => setEstadoModal((prev) => ({ ...prev, hasta: e.target.value }))}
                />
                <p style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '4px' }}>
                  • <strong>Tiempo Definido:</strong> Selecciona la fecha final. Al vencer, el estado se restablecerá a "En Planta".<br />
                  • <strong>Tiempo Indefinido:</strong> Deja este campo vacío. Permanecerá ausente hasta que se cambie manualmente.
                </p>
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

      {/* Modal: Autorizar Movimiento (se elige quién autoriza, solo se pide su contraseña) */}
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
              Elige quién de esa área autoriza e ingresa solo su contraseña para confirmar.
            </p>

            {authModalCandidates.length === 0 ? (
              <p style={{ fontSize: '12px', color: 'var(--color-alert)' }}>
                ⚠️ No se encontró ningún Encargado/Supervisor (ni Admin/Calidad) con autoridad sobre esa área.
              </p>
            ) : (
              <div className={styles.formGroup}>
                <label className={styles.label}>¿Quién autoriza?</label>
                <Select
                  value={authModal.userId}
                  onChange={(e) => setAuthModal((prev) => ({ ...prev, userId: e.target.value }))}
                  required
                  placeholder="-- Selecciona quién autoriza --"
                  options={authModalCandidates.map((u) => ({
                    value: u.id,
                    label: `${u.name} (${ROLE_TYPE_LABELS[u.roleType] || u.roleType})`,
                  }))}
                />
              </div>
            )}

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
              <Button type="submit" variant="primary" disabled={authModal.loading || authModalCandidates.length === 0}>
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

      {/* MODAL: ALTA INDIVIDUAL DE UN NUEVO OPERARIO */}
      <Modal isOpen={addModal.isOpen} onClose={handleCloseAddModal} title="➕ Nuevo Operario">
        <form onSubmit={handleSubmitAddOperario}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Nombre Completo</label>
            <input
              type="text"
              className={styles.textInput}
              value={addModal.name}
              onChange={(e) => setAddModal((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ej. Juan Pérez López"
              required
              autoFocus
            />
          </div>

          <div className={styles.formGroup}>
            <Select
              label="Puesto"
              value={addModal.puesto}
              onChange={(e) => handleAddModalPuestoChange(e.target.value)}
              required
              options={PUESTO_OPTIONS}
            />
          </div>

          {DESIGN_PUESTOS.includes(addModal.puesto) ? (
            <div className={styles.formGroup}>
              <label className={styles.label}>Área</label>
              <input type="text" className={styles.textInputDisabled} value="Diseño" disabled />
              <p style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: 'var(--space-1)' }}>
                El departamento de Diseño no forma parte de las áreas de manufactura.
              </p>
            </div>
          ) : (
            <div className={styles.formGroup}>
              <Select
                label="Área de Origen"
                value={addModal.areaId}
                onChange={(e) => setAddModal((prev) => ({ ...prev, areaId: e.target.value }))}
                required
                options={[
                  { value: '', label: 'Selecciona...' },
                  ...dynamicAreas.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </div>
          )}

          <div className={styles.modalActions} style={{ marginTop: 'var(--space-4)' }}>
            <Button type="button" variant="secondary" onClick={handleCloseAddModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={isAddingOperario}>
              Agregar Operario
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: EDITAR DATOS DE UN OPERARIO */}
      <Modal isOpen={editModal.isOpen} onClose={handleCloseEditModal} title="✏️ Editar Operario">
        <form onSubmit={handleSubmitEditOperario}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Nombre Completo</label>
            <input
              type="text"
              className={styles.textInput}
              value={editModal.name}
              onChange={(e) => setEditModal((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ej. Juan Pérez López"
              required
              autoFocus
            />
          </div>

          <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: 'var(--space-2)' }}>
            El área y disponibilidad se editan desde sus propios botones ("🔁 Mover", "🩺 Estado"). La jornada y las horas extra se gestionan desde la página de Producción del área del colaborador.
          </p>

          <div className={styles.modalActions} style={{ marginTop: 'var(--space-4)' }}>
            <Button type="button" variant="secondary" onClick={handleCloseEditModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={isEditingOperario}>
              Guardar Cambios
            </Button>
          </div>
        </form>
      </Modal>

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

      {/* MODAL: HISTORIAL DE AUSENCIAS Y FALTAS */}
      {absencesModal.isOpen && (
        <Modal
          isOpen={absencesModal.isOpen}
          onClose={() => setAbsencesModal({ isOpen: false, selectedOperarioId: 'todos' })}
          title="📋 Historial de Ausencias, Faltas e Incapacidades"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ minWidth: '220px', flex: 1 }}>
                <Select
                  label="Filtrar por Colaborador"
                  value={absencesModal.selectedOperarioId}
                  onChange={(e) => setAbsencesModal((prev) => ({ ...prev, selectedOperarioId: e.target.value }))}
                  options={[
                    { value: 'todos', label: 'Todos los Colaboradores' },
                    ...operarios.map((op) => ({ value: op.id, label: `${op.name} (${getAreaName(op.currentArea)})` })),
                  ]}
                />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-gray-600)', alignSelf: 'flex-end', paddingBottom: '6px' }}>
                Total de registros: <strong>
                  {allAbsenceRecords.filter(r => absencesModal.selectedOperarioId === 'todos' || r.operarioId === absencesModal.selectedOperarioId).length}
                </strong>
              </div>
            </div>

            <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid var(--color-gray-200)', borderRadius: '8px' }}>
              {allAbsenceRecords.filter(r => absencesModal.selectedOperarioId === 'todos' || r.operarioId === absencesModal.selectedOperarioId).length === 0 ? (
                <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                  🟢 No hay registros de ausencias ni faltas para la selección actual.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--color-gray-100)', zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--color-gray-200)' }}>Fecha / Periodo</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--color-gray-200)' }}>Colaborador</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--color-gray-200)' }}>Tipo de Ausencia</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--color-gray-200)' }}>Motivo / Notas</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--color-gray-200)' }}>Registrado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allAbsenceRecords
                      .filter(r => absencesModal.selectedOperarioId === 'todos' || r.operarioId === absencesModal.selectedOperarioId)
                      .map((r) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--color-gray-200)', backgroundColor: r.isCurrent ? '#fff5f5' : 'transparent' }}>
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                            <strong>{r.desde || 'N/A'}</strong>
                            {r.hasta && r.hasta !== r.desde && <span style={{ color: 'var(--color-gray-500)' }}> al {r.hasta}</span>}
                            {r.isCurrent && (
                              <Badge variant="danger" size="sm" style={{ display: 'block', width: 'fit-content', marginTop: '2px' }}>
                                Vigente Hoy
                              </Badge>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <strong>{r.operarioName}</strong>
                            <div style={{ fontSize: '10px', color: 'var(--color-gray-500)' }}>{getAreaName(r.areaId)}</div>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <Badge variant={ESTADO_BADGE_VARIANT[r.tipo] || 'warning'} size="sm">
                              {ESTADO_ICONS[r.tipo]} {ESTADO_LABELS[r.tipo] || r.tipo}
                            </Badge>
                          </td>
                          <td style={{ padding: '8px 10px', color: r.notas ? 'var(--color-gray-800)' : 'var(--color-gray-400)' }}>
                            {r.notas || 'Sin notas'}
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: '11px', color: 'var(--color-gray-600)' }}>
                            {r.registradoPor || 'Sistema'}
                            {r.registradoAt && (
                              <div style={{ fontSize: '9px', color: 'var(--color-gray-400)' }}>
                                {new Date(r.registradoAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className={styles.modalActions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAbsencesModal({ isOpen: false, selectedOperarioId: 'todos' })}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </Modal>
      )}

    </motion.div>
  );
};

export default OperariosPage;
