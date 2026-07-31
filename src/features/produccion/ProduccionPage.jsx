/**
 * @file ProduccionPage.jsx
 * @description Página de Registro e Historial de Producción por Área de Dicrejart
 * Soporta vistas individuales para las 8 áreas de manufactura, mostrando metas de piezas en tiempo real,
 * previsualización interactiva de progresos y bloqueos contra sobreproducción.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires react-router-dom
 * @requires framer-motion
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import useToast from '../../hooks/useToast';
import useOperarios from '../../hooks/useOperarios';
import useProduccion from '../../hooks/useProduccion';
import { isAreaBlockedBySequence, AREA_SEQUENCE_DEPENDENCIES, getFeederDependentAreaId } from '../../context/ProduccionContext';
import useProgressiveList from '../../hooks/useProgressiveList';
import useAuth from '../../hooks/useAuth';
import { isReadOnlySection, canAccessSection } from '../../utils/roleAccess';
import { getOvertimeBlocks } from '../../utils/overtimeUtils';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import { checkOvertimeEligibility } from '../../utils/overtimeRules';
import { ROLE_TYPES } from '../../data/usersData';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import ProductoTerminadoPanel from './ProductoTerminadoPanel';
import styles from './ProduccionPage.module.css';

/**
 * Tipos de componente externo más comunes; "Otro" permite un nombre libre
 * @constant
 */
const EXTERNAL_COMPONENT_TYPES = [
  'Piezas de Fibra de Vidrio',
  'Letreros Iluminados',
  'Otro',
];

const EMPTY_EXTERNAL_ORDER_FORM = {
  componentType: EXTERNAL_COMPONENT_TYPES[0],
  customComponentName: '',
  supplier: '',
  quantity: 1,
  unit: 'pza',
  expectedDeliveryDate: '',
};

/**
 * Indica si un juego ya recibió físicamente al menos una pieza de proveedor externo.
 * A diferencia de una simple verificación "todas recibidas", esta exige que exista
 * al menos una orden: un juego sin ninguna pieza externa registrada NO cuenta como lista
 * para el trabajo LED, ya que las luces se instalan sobre la pieza física ya entregada.
 */
const hasReceivedExternalPiecesForModal = (game) => {
  const orders = game?.externalOrders || [];
  return orders.length > 0 && orders.every((o) => o.status === 'recibido');
};

/**
 * Las 8 áreas con sus metadatos
 * @constant
 */
const AREAS_CONFIG = [
  { id: 'almacen', name: 'Almacén', icon: '📦', color: '#0099CC', desc: 'Control de inventario, materias primas y despachos.' },
  { id: 'corte-laser', name: 'Corte Laser', icon: '⚡', color: '#FF3300', desc: 'Corte de perfiles metálicos y paneles con alta precisión.' },
  { id: 'herreria', name: 'Herrería', icon: '🔨', color: '#330066', desc: 'Soldadura, esmerilado y ensamble de estructuras de metal.' },
  { id: 'carpinteria', name: 'Carpintería', icon: '🪛', color: '#FFCC00', desc: 'Corte, tallado e impermeabilización de partes de madera.' },
  { id: 'costura-acc', name: 'Costura Accesorios', icon: '🧵', color: '#FF9933', desc: 'Confección de redes, cuerdas y fundas de accesorios.' },
  { id: 'costura-colch', name: 'Costura Colchonetas', icon: '🪡', color: '#990099', desc: 'Tapicería y costura de bloques de colchoneta y protección.' },
  { id: 'mantenimiento', name: 'Mantenimiento', icon: '⚙️', color: '#9933FF', desc: 'Puesta a punto de máquinas, pintura y control preventivo.' },
  { id: 'producto-terminado', name: 'Producto Terminado', icon: '📦', color: '#663399', desc: 'Ensamble final, empaque, certificación y despacho.' },
];

/**
 * Componente ProduccionPage - Módulo de manufactura y logs por área
 * @component
 * @returns {ReactElement} Render de la vista de producción
 */
const ProduccionPage = () => {
  const { areaId } = useParams();
  const navigate = useNavigate();

  // ============================================
  // CONTEXTOS Y ESTADOS
  // ============================================
  const {
    juegos,
    proyectos,
    areaHistorial,
    subscribeAreaHistorial,
    registerProductionLog,
    editProductionLog,
    deleteProductionLog,
    addEvidenceToLog,
    removeEvidenceFromLog,
    notifyAreaDelivery,
    addExternalOrder,
    receiveExternalOrder,
    enableLedWork,
    updateLedStep,
  } = useProduccion();

  const {
    operarios,
    updateOperarioSchedule,
    authorizeOvertimeTasks,
    cancelPendingHorasExtra,
    horasExtra,
    verifyHorasExtra,
    correctHorasExtraSchedule,
    solicitudesHorasExtra,
    solicitarHorasExtra,
    cancelarSolicitudHoraExtra,
    modificarSolicitudHoraExtra,
  } = useOperarios();
  const { user } = useAuth();
  const isReadOnly = isReadOnlySection(user, 'produccion', areaId);

  // Se suscribe al historial de ESTA área (limitado, ver ConfigContext) al entrar, y se
  // desuscribe al salir o cambiar de área. En el selector general (sin areaId, ej. justo
  // después de "Volver a Áreas") no hay a qué suscribirse — llamarlo con areaId undefined
  // armaba un where('areaId','==',undefined), que Firestore rechaza de inmediato.
  useEffect(() => {
    if (!areaId) return undefined;
    const unsubscribe = subscribeAreaHistorial(areaId);
    return unsubscribe;
  }, [areaId, subscribeAreaHistorial]);

  const [newLog, setNewLog] = useState({
    gameName: '',
    quantity: '',
    operator: '',
    notes: '',
  });

  // Evidencia fotográfica pendiente de subir al registrar la salida (aún no existe el log)
  const [newLogPhotos, setNewLogPhotos] = useState([]);
  const [isSubmittingLog, setIsSubmittingLog] = useState(false);

  // Revoca los blob URLs de fotos pendientes (no enviadas) al salir de la página, para
  // no dejarlos retenidos en memoria mientras la pestaña siga viva
  const newLogPhotosRef = useRef(newLogPhotos);
  useEffect(() => { newLogPhotosRef.current = newLogPhotos; }, [newLogPhotos]);
  useEffect(() => {
    return () => { newLogPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)); };
  }, []);

  // Vista ampliada de una foto de evidencia (historial del área)
  const [photoPreview, setPhotoPreview] = useState(null);

  // Estados para la edición de registros
  const [editingLog, setEditingLog] = useState(null);
  const [editForm, setEditForm] = useState({
    quantity: '',
    operator: '',
    notes: '',
  });
  const [editPhotos, setEditPhotos] = useState([]);
  const [isUploadingEditPhotos, setIsUploadingEditPhotos] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Estado para la confirmación de eliminación de registro
  const [deleteConfirmation, setDeleteConfirmation] = useState({
    isOpen: false,
    logId: null,
  });

  const toast = useToast();

  /**
   * Determina si el usuario puede REGISTRAR (crear) órdenes de trabajo a proveedores
   * externos (fibra de vidrio, letreros iluminados) para un juego específico, o gestionar
   * el trabajo de iluminación LED de Mantenimiento: el Encargado del área involucrada,
   * el Supervisor que la supervisa, o Admin
   */
  const canManageAreaWork = (game) => {
    if (!user || !game) return false;
    if (user.roleType === ROLE_TYPES.ADMIN) return true;
    if (user.roleType === ROLE_TYPES.ENCARGADO_AREA) return game.areas.includes(user.areaId);
    if (user.roleType === ROLE_TYPES.SUPERVISOR_AREA) {
      return game.areas.some((a) => (user.areaIds || []).includes(a));
    }
    return false;
  };

  /**
   * Determina si el usuario puede marcar una orden de trabajo externa como RECIBIDA:
   * exclusivo de Producto Terminado (quien siempre recibe físicamente estas piezas), o Admin
   */
  const canReceiveExternalOrders = () => {
    if (!user) return false;
    if (user.roleType === ROLE_TYPES.ADMIN) return true;
    if (user.roleType === ROLE_TYPES.ENCARGADO_AREA) return user.areaId === 'producto-terminado';
    if (user.roleType === ROLE_TYPES.SUPERVISOR_AREA) {
      return (user.areaIds || []).includes('producto-terminado');
    }
    return false;
  };

  /**
   * Determina si el usuario puede gestionar la Jornada / Horas Extra del personal de
   * esta área: Admin o Supervisor de Área. No hace falta revalidar el área en sí, porque
   * `canAccessSection` ya garantiza que si un Supervisor de Área llegó a esta página es
   * porque supervisa esta área en concreto (mismo alcance que antes tenía
   * `canAuthorizeOvertime` en OperariosPage.jsx).
   */
  const canManageJornada = user?.roleType === ROLE_TYPES.ADMIN || user?.roleType === ROLE_TYPES.SUPERVISOR_AREA;

  // ============================================
  // ESTADO - MODAL DE ÓRDENES DE TRABAJO EXTERNAS
  // ============================================
  const [externalOrdersModal, setExternalOrdersModal] = useState({ isOpen: false, gameId: null });
  const [externalOrderForm, setExternalOrderForm] = useState(EMPTY_EXTERNAL_ORDER_FORM);

  const todayStr = new Date().toISOString().split('T')[0];

  // Se deriva del arreglo vivo de `juegos` (no una copia estática) para reflejar altas/recepciones al instante
  const externalOrdersGame = useMemo(
    () => juegos.find((j) => j.id === externalOrdersModal.gameId) || null,
    [juegos, externalOrdersModal.gameId]
  );

  const handleOpenExternalOrdersModal = (game) => {
    setExternalOrdersModal({ isOpen: true, gameId: game.id });
    setExternalOrderForm(EMPTY_EXTERNAL_ORDER_FORM);
  };

  const handleCloseExternalOrdersModal = () => {
    setExternalOrdersModal({ isOpen: false, gameId: null });
    setExternalOrderForm(EMPTY_EXTERNAL_ORDER_FORM);
  };

  const handleSubmitExternalOrder = (e) => {
    e.preventDefault();
    const componentName =
      externalOrderForm.componentType === 'Otro'
        ? externalOrderForm.customComponentName.trim()
        : externalOrderForm.componentType;

    if (!componentName) {
      toast.danger('Especifica el nombre de la pieza o componente.');
      return;
    }
    if (!externalOrderForm.supplier.trim()) {
      toast.danger('Indica el proveedor externo encargado de esta pieza.');
      return;
    }
    if (!externalOrderForm.expectedDeliveryDate) {
      toast.danger('Indica la fecha de entrega establecida con el proveedor.');
      return;
    }

    addExternalOrder(externalOrdersModal.gameId, {
      componentName,
      supplier: externalOrderForm.supplier,
      quantity: Number(externalOrderForm.quantity) || 1,
      unit: externalOrderForm.unit,
      expectedDeliveryDate: externalOrderForm.expectedDeliveryDate,
    });
    toast.success(`🛠️ Orden de trabajo registrada con ${externalOrderForm.supplier}.`);
    setExternalOrderForm(EMPTY_EXTERNAL_ORDER_FORM);
  };

  const handleReceiveExternalOrder = (order) => {
    if (!canReceiveExternalOrders()) {
      toast.danger('Solo Producto Terminado puede marcar una pieza externa como recibida.');
      return;
    }
    receiveExternalOrder(externalOrdersModal.gameId, order.id, user.name);
    toast.success(`✅ Pieza "${order.componentName}" marcada como recibida.`);
  };

  // ============================================
  // ESTADO - MODAL DE TRABAJO LED (MANTENIMIENTO)
  // ============================================
  const [ledWorkModal, setLedWorkModal] = useState({ isOpen: false, gameId: null });

  // Se deriva del arreglo vivo de `juegos` para reflejar los cambios de inmediato
  const ledWorkGame = useMemo(
    () => juegos.find((j) => j.id === ledWorkModal.gameId) || null,
    [juegos, ledWorkModal.gameId]
  );

  const handleOpenLedWorkModal = (game) => setLedWorkModal({ isOpen: true, gameId: game.id });
  const handleCloseLedWorkModal = () => setLedWorkModal({ isOpen: false, gameId: null });

  const handleEnableLedWork = () => {
    enableLedWork(ledWorkModal.gameId);
    toast.success('💡 Se activó el trabajo de iluminación LED para este juego.');
  };

  const handleToggleLedStep = (stepKey, currentValue) => {
    const result = updateLedStep(ledWorkModal.gameId, stepKey, !currentValue);
    if (!result.ok) {
      toast.danger(result.error);
      return;
    }
    toast.success('✅ Progreso de iluminación LED actualizado.');
  };

  // ============================================
  // ESTADO Y HANDLERS - JORNADA / HORAS EXTRA DEL PERSONAL DEL ÁREA
  // ============================================
  const [scheduleModal, setScheduleModal] = useState({
    isOpen: false,
    collaborator: null,
    startHour: '8',
    endHour: '18',
    overtimeHours: '0',
    authorizedDate: '',
    overtimeTasks: '',
  });
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [expandedOvertimeOperarios, setExpandedOvertimeOperarios] = useState(() => new Set());
  const [horasExtraRejectModal, setHorasExtraRejectModal] = useState({ isOpen: false, horasExtraId: null, notes: '' });
  const [scheduleCorrectionModal, setScheduleCorrectionModal] = useState({
    isOpen: false,
    horasExtraId: null,
    actualStartHour: '',
    actualEndHour: '',
    reason: '',
  });

  const toggleOvertimeExpanded = (operarioId) => {
    setExpandedOvertimeOperarios((prev) => {
      const next = new Set(prev);
      if (next.has(operarioId)) next.delete(operarioId);
      else next.add(operarioId);
      return next;
    });
  };

  const handleVerifyHorasExtraCumplido = async (horasExtraId) => {
    const res = await verifyHorasExtra(horasExtraId, { verificationStatus: 'cumplido', verificationNotes: '' });
    if (!res.ok) { toast.danger(res.error || 'No se pudo registrar la verificación.'); return; }
    toast.success('✅ Tareas de tiempo extra marcadas como cumplidas.');
  };

  const handleOpenHorasExtraRejectModal = (horasExtraId) => {
    setHorasExtraRejectModal({ isOpen: true, horasExtraId, notes: '' });
  };

  const handleCloseHorasExtraRejectModal = () => {
    setHorasExtraRejectModal({ isOpen: false, horasExtraId: null, notes: '' });
  };

  const handleSubmitHorasExtraReject = async (e) => {
    e.preventDefault();
    const res = await verifyHorasExtra(horasExtraRejectModal.horasExtraId, {
      verificationStatus: 'no_cumplido',
      verificationNotes: horasExtraRejectModal.notes,
    });
    if (!res.ok) { toast.danger(res.error || 'No se pudo registrar la verificación.'); return; }
    toast.warning('❌ Tareas de tiempo extra marcadas como no cumplidas.');
    handleCloseHorasExtraRejectModal();
  };

  const handleOpenScheduleCorrectionModal = (h) => {
    setScheduleCorrectionModal({
      isOpen: true,
      horasExtraId: h.id,
      actualStartHour: String(h.startHour),
      actualEndHour: String(h.endHour),
      reason: '',
    });
  };

  const handleCloseScheduleCorrectionModal = () => {
    setScheduleCorrectionModal({ isOpen: false, horasExtraId: null, actualStartHour: '', actualEndHour: '', reason: '' });
  };

  const handleSubmitScheduleCorrection = async (e) => {
    e.preventDefault();
    const { horasExtraId, actualStartHour, actualEndHour, reason } = scheduleCorrectionModal;
    const res = await correctHorasExtraSchedule(horasExtraId, { actualStartHour, actualEndHour, reason });
    if (!res.ok) { toast.danger(res.error || 'No se pudo guardar la corrección de horario.'); return; }
    toast.success('⚠️ Horario de tiempo extra corregido correctamente.');
    handleCloseScheduleCorrectionModal();
  };

  const handleOpenScheduleModal = (op) => {
    const todayStr2 = getTodayLocalDateStr();
    setScheduleModal({
      isOpen: true,
      collaborator: op,
      startHour: String(op.schedule?.startHour || 8),
      endHour: String(op.schedule?.endHour || 18),
      overtimeHours: String(op.schedule?.overtimeHours || 0),
      authorizedDate: op.schedule?.authorizedDate || todayStr2,
      overtimeTasks: '',
    });
  };

  const handleCloseScheduleModal = () => {
    setScheduleModal({
      isOpen: false, collaborator: null, startHour: '8', endHour: '18',
      overtimeHours: '0', authorizedDate: '', overtimeTasks: '',
    });
  };

  const handleDateChange = (e) => {
    const dateStr = e.target.value;
    const startVal = Number(scheduleModal.startHour);
    const endVal = Number(scheduleModal.endHour);
    const { earlyHours, lateHours } = getOvertimeBlocks(startVal, endVal, dateStr);
    setScheduleModal((prev) => ({ ...prev, authorizedDate: dateStr, overtimeHours: String(earlyHours + lateHours) }));
  };

  const handleStartHourChange = (e) => {
    const startVal = Number(e.target.value);
    const endVal = Number(scheduleModal.endHour);
    const { earlyHours, lateHours } = getOvertimeBlocks(startVal, endVal, scheduleModal.authorizedDate);
    setScheduleModal((prev) => ({ ...prev, startHour: String(startVal), overtimeHours: String(earlyHours + lateHours) }));
  };

  const handleEndHourChange = (e) => {
    const startVal = Number(scheduleModal.startHour);
    const endVal = Number(e.target.value);
    const { earlyHours, lateHours } = getOvertimeBlocks(startVal, endVal, scheduleModal.authorizedDate);
    setScheduleModal((prev) => ({ ...prev, endHour: String(endVal), overtimeHours: String(earlyHours + lateHours) }));
  };

  const handleSaveSchedule = async (e) => {
    e.preventDefault();
    const { collaborator, startHour, endHour, overtimeHours, authorizedDate, overtimeTasks } = scheduleModal;
    if (Number(overtimeHours) > 0 && !overtimeTasks.trim()) {
      toast.danger('Debes indicar las tareas a realizar durante el tiempo extra.');
      return;
    }
    setIsSavingSchedule(true);
    await cancelPendingHorasExtra(collaborator.id, authorizedDate);
    if (Number(overtimeHours) > 0) {
      const res = await authorizeOvertimeTasks(collaborator.id, {
        startHour: Number(startHour), endHour: Number(endHour), overtimeHours: Number(overtimeHours),
        overtimeTasks, authorizedDate,
      });
      if (!res.ok) {
        setIsSavingSchedule(false);
        toast.danger(res.error || 'No se pudo registrar la autorización de horas extra.');
        return;
      }
    }
    await updateOperarioSchedule(collaborator.id, {
      startHour: Number(startHour), endHour: Number(endHour), overtimeHours: Number(overtimeHours),
      authorizedBy: user?.name || 'Supervisor', authorizedDate,
    });
    setIsSavingSchedule(false);
    const isToday = authorizedDate === getTodayLocalDateStr();
    toast.success(
      isToday
        ? `⏱️ Horario actualizado para ${collaborator.name} para hoy (${authorizedDate}). Horas extras: ${overtimeHours}h.`
        : `📅 Horas extra programadas para ${collaborator.name} el ${authorizedDate} (${overtimeHours}h). El horario de hoy no se modificó.`
    );
    handleCloseScheduleModal();
  };

  // Modal de Solicitud de Horas Extras por Encargado
  const [requestOvertimeModal, setRequestOvertimeModal] = useState({
    isOpen: false,
    operarioId: '',
    fecha: getTodayLocalDateStr(),
    horas: '2',
    bloque: 'vespertino',
    motivo: '',
  });

  const [editOvertimeRequestModal, setEditOvertimeRequestModal] = useState({
    isOpen: false,
    solicitud: null,
    horas: '2',
    bloque: 'vespertino',
    motivo: '',
    fecha: '',
  });

  const handleOpenRequestOvertimeModal = () => {
    const firstOp = operadoresDisponibles[0]?.id || '';
    setRequestOvertimeModal({
      isOpen: true,
      operarioId: firstOp,
      fecha: getTodayLocalDateStr(),
      horas: '2',
      bloque: 'vespertino',
      motivo: '',
    });
  };

  const handleCloseRequestOvertimeModal = () => {
    setRequestOvertimeModal((prev) => ({ ...prev, isOpen: false }));
  };

  const handleSubmitOvertimeRequest = async (e) => {
    e.preventDefault();
    const { operarioId, fecha, horas, bloque, motivo } = requestOvertimeModal;
    if (!operarioId) {
      toast.warning('Selecciona un colaborador.');
      return;
    }
    const res = await solicitarHorasExtra({ operarioId, fecha, horas: Number(horas), bloque, motivo });
    if (res.ok) {
      toast.success('✅ Solicitud de horas extras enviada a revisión del supervisor.');
      handleCloseRequestOvertimeModal();
    } else {
      toast.danger(res.error || 'No se pudo registrar la solicitud.');
    }
  };

  const handleOpenEditOvertimeRequestModal = (sol) => {
    setEditOvertimeRequestModal({
      isOpen: true,
      solicitud: sol,
      horas: String(sol.horas),
      bloque: sol.bloque || 'vespertino',
      motivo: sol.motivo || '',
      fecha: sol.fecha || getTodayLocalDateStr(),
    });
  };

  const handleCloseEditOvertimeRequestModal = () => {
    setEditOvertimeRequestModal((prev) => ({ ...prev, isOpen: false, solicitud: null }));
  };

  const handleSaveEditOvertimeRequest = async (e) => {
    e.preventDefault();
    const { solicitud, horas, bloque, motivo, fecha } = editOvertimeRequestModal;
    if (!solicitud) return;
    const res = await modificarSolicitudHoraExtra(solicitud.id, { horas: Number(horas), bloque, motivo, fecha });
    if (res.ok) {
      toast.success('✅ Solicitud de horas extras actualizada.');
      handleCloseEditOvertimeRequestModal();
    } else {
      toast.danger(res.error || 'No se pudo modificar la solicitud.');
    }
  };

  const handleCancelOvertimeRequest = async (sol) => {
    if (!window.confirm(`¿Seguro que deseas cancelar la solicitud de horas extras de ${sol.operarioName}?`)) return;
    const res = await cancelarSolicitudHoraExtra(sol.id, 'Cancelada desde vista de área de producción');
    if (res.ok) {
      toast.success(`Solicitud de ${sol.operarioName} cancelada.`);
    } else {
      toast.danger(res.error || 'No se pudo cancelar la solicitud.');
    }
  };

  // ============================================
  // HANDLERS
  // ============================================
  const handleBackToSelector = () => {
    navigate('/produccion');
  };

  const handleAreaSelect = (id) => {
    navigate(`/produccion/${id}`);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewLog((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // ============================================
  // FILTRADO Y CÁLCULOS
  // ============================================
  const activeArea = AREAS_CONFIG.find((a) => a.id === areaId);
  const filteredHistorial = areaHistorial[areaId] || [];

  // Encargado de Área / Supervisor de Área tienen acceso a "producción" SOLO para su(s)
  // área(s) asignada(s) (ver roleAccess.js: exige un areaId concreto) — el selector
  // general en /produccion (sin areaId) les está vetado por RoleRoute. Sin esta
  // verificación, "Volver a Áreas" los mandaba a una ruta que el guard rebota de
  // inmediato, y esa vuelta se veía como pantalla en blanco.
  const canViewAreaSelector = canAccessSection(user, 'produccion');
  
  // Juegos activos que involucran esta área (o producto-terminado que las consolida todas)
  const filteredJuegos = useMemo(() => {
    if (areaId === 'producto-terminado') {
      return juegos; // Consolida todos los juegos para entrega final
    }
    return juegos.filter((j) => j.areas.includes(areaId));
  }, [juegos, areaId]);

  // Revela la tabla de juegos asignados en tandas de 15 en vez de pintarla completa.
  const {
    visibleItems: visibleFilteredJuegos,
    hasMore: hasMoreFilteredJuegos,
    remaining: remainingFilteredJuegos,
    showMore: showMoreFilteredJuegos,
  } = useProgressiveList(filteredJuegos, { resetKey: areaId });

  // Operarios asignados temporal o permanentemente a esta área
  const operadoresDisponibles = operarios.filter((op) => op.currentArea === areaId);

  // Datos dinámicos del juego seleccionado actualmente en el formulario
  const selectedGameObj = useMemo(() => {
    return juegos.find((j) => j.name === newLog.gameName);
  }, [juegos, newLog.gameName]);

  const targetPiecesForArea = selectedGameObj?.targetPieces?.[areaId] || 0;
  const producedPiecesForArea = selectedGameObj?.producedPieces?.[areaId] || 0;
  const remainingPiecesForArea = Math.max(0, targetPiecesForArea - producedPiecesForArea);

  // Validaciones del input digitado
  const qtyDigitada = Number(newLog.quantity) || 0;
  const totalProyectado = producedPiecesForArea + qtyDigitada;
  const isCompleted = producedPiecesForArea >= targetPiecesForArea;
  const isExceeded = totalProyectado > targetPiecesForArea;

  // Bloqueo por secuencia entre áreas (ej. Herrería requiere que Corte Láser ya haya
  // completado el material de este juego antes de poder registrar producción)
  const sequenceBlocked = selectedGameObj ? isAreaBlockedBySequence(selectedGameObj, areaId) : false;
  const requiredAreaId = AREA_SEQUENCE_DEPENDENCIES[areaId] || null;
  const requiredAreaName = AREAS_CONFIG.find((a) => a.id === requiredAreaId)?.name;
  const requiredAreaProduced = selectedGameObj?.producedPieces?.[requiredAreaId] || 0;
  const requiredAreaTarget = selectedGameObj?.targetPieces?.[requiredAreaId] || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newLog.gameName || !newLog.quantity || !newLog.operator) {
      toast.danger('Por favor completa todos los campos obligatorios.');
      return;
    }

    const qty = Number(newLog.quantity);
    if (qty <= 0) {
      toast.warning('La cantidad debe ser un número entero mayor a 0.');
      return;
    }

    if (isCompleted) {
      toast.danger('❌ No se puede registrar producción. La meta del área para este juego ya ha sido completada al 100%.');
      return;
    }

    if (sequenceBlocked) {
      toast.danger(`🔒 No se puede registrar producción. ${requiredAreaName} todavía no completa su meta para este juego (${requiredAreaProduced}/${requiredAreaTarget} pzas).`);
      return;
    }

    if (isExceeded) {
      toast.danger(`❌ No se puede registrar. La cantidad excede la meta faltante por ${totalProyectado - targetPiecesForArea} piezas.`);
      return;
    }

    setIsSubmittingLog(true);
    const result = await registerProductionLog({
      areaId,
      quantity: qty,
      operator: newLog.operator,
      gameName: newLog.gameName,
      notes: newLog.notes,
      photos: newLogPhotos.map((p) => p.file),
    });
    setIsSubmittingLog(false);

    if (!result?.ok) {
      toast.danger(result?.error || 'No se pudo guardar el registro de producción.');
      return;
    }

    newLogPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setNewLogPhotos([]);
    setNewLog((prev) => ({
      ...prev,
      quantity: '',
      notes: '',
    }));

    if (result.photoWarning) {
      toast.warning(`⚠️ ${result.photoWarning}`);
    } else {
      toast.success('✅ Registro de producción guardado exitosamente.');
    }
  };

  /**
   * Agrega fotos capturadas al formulario de nuevo registro (previsualización local, aún sin subir)
   */
  const handleCaptureNewLogPhotos = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const withPreviews = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setNewLogPhotos((prev) => [...prev, ...withPreviews]);
    e.target.value = '';
  };

  /**
   * Quita una foto pendiente del formulario de nuevo registro y libera su blob URL
   */
  const handleRemoveNewLogPhoto = (idx) => {
    setNewLogPhotos((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleEditLogClick = (log) => {
    setEditingLog(log);
    setEditForm({
      quantity: String(log.quantity),
      operator: log.operator,
      notes: log.notes,
    });
    setEditPhotos(log.photos || []);
    setIsEditModalOpen(true);
  };

  /**
   * Sube nuevas fotos de evidencia directo al registro que ya existe en edición
   */
  const handleAddEditPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !editingLog) return;
    e.target.value = '';
    setIsUploadingEditPhotos(true);
    const result = await addEvidenceToLog(editingLog.id, files);
    setIsUploadingEditPhotos(false);
    if (result.ok) {
      setEditPhotos(result.photos);
      toast.success('📷 Evidencia agregada al registro.');
    } else {
      toast.danger(result.error || 'No se pudo subir la evidencia fotográfica.');
    }
  };

  /**
   * Quita una foto ya guardada del registro en edición (borra también en Storage)
   */
  const handleRemoveEditPhoto = async (photo) => {
    if (!editingLog) return;
    const result = await removeEvidenceFromLog(editingLog.id, photo.path);
    if (result.ok) {
      setEditPhotos(result.photos);
    } else {
      toast.danger(result.error || 'No se pudo quitar la evidencia fotográfica.');
    }
  };

  const handleSaveEditLog = async (e) => {
    e.preventDefault();
    if (!editingLog) return;
    const qty = Number(editForm.quantity) || 0;
    if (qty <= 0) {
      toast.danger('La cantidad debe ser mayor a 0.');
      return;
    }
    const res = await editProductionLog(editingLog.id, {
      quantity: qty,
      operator: editForm.operator,
      notes: editForm.notes,
    });
    if (res.ok) {
      toast.success('📝 Registro de producción modificado con éxito.');
      setIsEditModalOpen(false);
      setEditingLog(null);
    } else {
      toast.danger(res.error || 'Error al modificar el registro.');
    }
  };

  const handleDeleteLogClick = (logId) => {
    setDeleteConfirmation({
      isOpen: true,
      logId,
    });
  };

  const handleConfirmDeleteLog = async () => {
    const { logId } = deleteConfirmation;
    if (!logId) return;

    const res = await deleteProductionLog(logId);
    if (res.ok) {
      toast.success('🗑️ Registro de producción eliminado.');
    } else {
      toast.danger(res.error || 'Error al eliminar el registro.');
    }
    setDeleteConfirmation({ isOpen: false, logId: null });
  };

  // Porcentajes para la barra de previsualización interactiva
  const pctActual = useMemo(() => {
    if (targetPiecesForArea === 0) return 0;
    return (producedPiecesForArea / targetPiecesForArea) * 100;
  }, [producedPiecesForArea, targetPiecesForArea]);

  const pctProyectado = useMemo(() => {
    if (targetPiecesForArea === 0) return 0;
    // Si excede, el segmento proyectado solo llena hasta el 100% de la barra
    if (isExceeded) {
      return ((targetPiecesForArea - producedPiecesForArea) / targetPiecesForArea) * 100;
    }
    return (qtyDigitada / targetPiecesForArea) * 100;
  }, [qtyDigitada, producedPiecesForArea, targetPiecesForArea, isExceeded]);

  // Construye las opciones descriptivas para el dropdown selector de juegos
  const gameOptions = useMemo(() => {
    return filteredJuegos.map((j) => {
      const target = j.targetPieces?.[areaId] || 10;
      const produced = j.producedPieces?.[areaId] || 0;
      const completed = produced >= target;
      
      let prefix = '💤 Sin Iniciar';
      if (completed) prefix = '✓ Completado';
      else if (produced > 0) prefix = '⏳ En Proceso';
      if (isAreaBlockedBySequence(j, areaId)) prefix = '🔒 Bloqueado';

      return {
        value: j.name,
        label: `[${prefix}] ${j.name} (${produced}/${target} pzas) • Proyecto: ${j.projectName}`,
      };
    });
  }, [filteredJuegos, areaId]);

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

  // ============================================
  // RENDER 1: SELECTOR DE ÁREAS (Si no hay areaId en la URL)
  // ============================================
  if (!areaId) {
    return (
      <motion.div
        className={styles.selectorContainer}
        variants={containerVariants}
        initial="initial"
        animate="animate"
      >
        <PageHeader
          title="Producción por Áreas"
          subtitle="Selecciona un área de producción para registrar trabajos y revisar historial."
          shape="cacahuate"
          accentColor="var(--color-primary)"
        />

        <motion.div className={styles.areasGrid} variants={containerVariants}>
          {AREAS_CONFIG.map((area) => (
            <motion.div
              key={area.id}
              variants={itemVariants}
              whileHover={{ y: -5, boxShadow: 'var(--shadow-lg)' }}
              onClick={() => handleAreaSelect(area.id)}
              className={styles.areaCard}
              style={{ borderLeftColor: area.color }}
            >
              <div className={styles.areaHeader}>
                <span className={styles.areaIcon}>{area.icon}</span>
                <span className={styles.badge} style={{ backgroundColor: area.color }}>
                  Área
                </span>
              </div>
              <h3 className={styles.areaTitle}>{area.name}</h3>
              <p className={styles.areaDesc}>{area.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    );
  }

  if (areaId === 'producto-terminado') {
    return (
      <ProductoTerminadoPanel
        activeArea={activeArea}
        onBack={canViewAreaSelector ? handleBackToSelector : undefined}
        readOnly={isReadOnly}
      />
    );
  }

  // ============================================
  // RENDER 2: REGISTRO DE TRABAJO EN ÁREA SELECCIONADA
  // ============================================
  return (
    <motion.div
      className={styles.areaViewContainer}
      variants={containerVariants}
      initial="initial"
      animate="animate"
    >
      {/* Cabecera del área */}
      <div className={styles.areaViewHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {canViewAreaSelector && (
            <Button variant="secondary" size="md" onClick={handleBackToSelector}>
              ⬅ Volver a Áreas
            </Button>
          )}
          <div className={styles.areaViewTitleBlock}>
            <div
              className={styles.areaColorIndicator}
              style={{ backgroundColor: activeArea?.color }}
            />
            <h2 className={styles.areaViewTitle}>
              {activeArea?.icon} Panel de {activeArea?.name}
            </h2>
          </div>
        </div>

        {/* Botón de Solicitar Horas Extras visible para Encargados, Supervisores y Admin */}
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={handleOpenRequestOvertimeModal}
          style={{ backgroundColor: 'var(--color-secondary)', color: '#ffffff', fontWeight: 'bold' }}
        >
          ⏰ Solicitar Horas Extras
        </Button>
      </div>

      {isReadOnly && (
        <div className={styles.bannerInfo} style={{ marginBottom: 'var(--space-4)' }}>
          <strong>👁️ Modo de Solo Lectura:</strong>
          <span> Como Supervisor de Área, puedes consultar el avance y el historial de esta área, pero no registrar producción.</span>
        </div>
      )}

      <div className={styles.layoutColumns}>
        {/* Columna 1: Formulario (oculto en modo solo lectura) */}
        {!isReadOnly && (
        <motion.div variants={itemVariants} className={styles.formCol}>
          <Card variant="default">
            <h3 className={styles.sectionTitle}>Registrar Salida de Producción</h3>
            <form onSubmit={handleSubmit} className={styles.form}>
              
              {/* Selector de Juego */}
              <div className={styles.formGroup}>
                <Select
                  label="Juego / Módulo en Proceso"
                  name="gameName"
                  value={newLog.gameName}
                  onChange={handleInputChange}
                  required
                  placeholder={
                    filteredJuegos.length === 0
                      ? 'No hay juegos activos que requieran esta área'
                      : '-- Selecciona el Juego --'
                  }
                  options={gameOptions}
                />
                
                {/* Banners de estado dinámicos */}
                {selectedGameObj && (
                  <>
                    {selectedGameObj.activeDefects?.[areaId] && (
                      <div className={styles.bannerDanger} style={{ borderLeft: '4px solid var(--color-danger)', marginBottom: '8px' }}>
                        <strong>⚠️ Defecto de Calidad Reportado:</strong>
                        <span>Calidad detectó una pieza defectuosa en esta área. Retrabájala y solicita una nueva inspección; esto es solo informativo y no bloquea el registro de producción ni la entrega a PT.</span>
                      </div>
                    )}
                    {sequenceBlocked ? (
                      <div className={styles.bannerDanger} style={{ borderLeft: '4px solid var(--color-alert)' }}>
                        <strong>🔒 Bloqueado por Secuencia:</strong>
                        <span>
                          {requiredAreaName} todavía no completa su meta para este juego
                          (<strong>{requiredAreaProduced}/{requiredAreaTarget}</strong> pzas). {activeArea?.name} no
                          puede iniciar hasta que el material esté listo.
                        </span>
                      </div>
                    ) : isCompleted ? (
                      <div className={styles.bannerSuccess}>
                        <strong>✓ Producción Finalizada:</strong>
                        <span>La meta de <strong>{targetPiecesForArea}</strong> piezas para este juego en esta área ha sido completada al 100%. Registro de piezas cerrado. Usa la tabla de abajo para notificar la entrega a Producto Terminado.</span>
                      </div>
                    ) : producedPiecesForArea > 0 ? (
                      <div className={styles.bannerWarning}>
                        <strong>⏳ Producción en Proceso:</strong>
                        <span>Se han registrado <strong>{producedPiecesForArea}</strong> de <strong>{targetPiecesForArea}</strong> piezas. Faltan <strong>{remainingPiecesForArea}</strong> para completar.</span>
                      </div>
                    ) : (
                      <div className={styles.bannerInfo}>
                        <strong>💤 Sin Iniciar:</strong>
                        <span>Aún no se han registrado piezas de la meta de <strong>{targetPiecesForArea}</strong>.</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Selector de Operador */}
              <div className={styles.formGroup}>
                <Select
                  label="Operador Responsable"
                  name="operator"
                  value={newLog.operator}
                  onChange={handleInputChange}
                  required
                  placeholder="-- Selecciona el Operador --"
                  options={operadoresDisponibles.map((op) => ({
                    value: op.name,
                    label: op.currentArea === op.homeArea ? op.name : `${op.name} (prestado)`,
                  }))}
                />
              </div>

              {/* Cantidad */}
              <div className={styles.formGroup}>
                <Input
                  label="Cantidad Producida (Piezas / Módulos) *"
                  type="number"
                  name="quantity"
                  placeholder={remainingPiecesForArea > 0 ? `Restan: ${remainingPiecesForArea}` : 'Ej: 5'}
                  value={newLog.quantity}
                  onChange={handleInputChange}
                  required
                  disabled={isCompleted || sequenceBlocked}
                />

                {/* Previsualización Interactiva de Avance */}
                {selectedGameObj && !isCompleted && !sequenceBlocked && (
                  <div className={styles.progressContainerMini}>
                    <div className={styles.progressLabels}>
                      <span>Avance en {activeArea?.name}</span>
                      <strong>
                        {qtyDigitada > 0 ? (
                          isExceeded ? (
                            <span style={{ color: 'var(--color-alert)' }}>SOBREPRODUCCIÓN</span>
                          ) : (
                            `${producedPiecesForArea} + ${qtyDigitada} / ${targetPiecesForArea} pzas`
                          )
                        ) : (
                          `${producedPiecesForArea} / ${targetPiecesForArea} pzas (${Math.round(pctActual)}%)`
                        )}
                      </strong>
                    </div>
                    <div className={styles.progressTrack}>
                      {/* Avance Guardado */}
                      <div 
                        className={styles.progressSegmentActual} 
                        style={{ width: `${pctActual}%` }} 
                      />
                      {/* Avance Proyectado */}
                      {qtyDigitada > 0 && (
                        <div 
                          className={isExceeded ? styles.progressSegmentExcedido : styles.progressSegmentProyectado} 
                          style={{ width: `${pctProyectado}%` }} 
                        />
                      )}
                    </div>
                    {isExceeded && (
                      <span className={styles.exceededMessage}>
                        ⚠️ Excede la meta de esta área por {totalProyectado - targetPiecesForArea} pieza(s). Por favor corrige el valor.
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Notas de Producción */}
              <div className={styles.formGroup}>
                <label className={styles.label}>Notas / Observaciones</label>
                <textarea
                  name="notes"
                  className={styles.textarea}
                  placeholder="Detalla pormenores, especificaciones del material, etc..."
                  value={newLog.notes}
                  onChange={handleInputChange}
                  rows="3"
                />
              </div>

              {/* Evidencia Fotográfica */}
              <div className={styles.formGroup}>
                <label className={styles.label}>Evidencia Fotográfica (Opcional)</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  style={{ display: 'none' }}
                  id="production-photo-capture"
                  onChange={handleCaptureNewLogPhotos}
                />
                <label
                  htmlFor="production-photo-capture"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    border: '1px dashed var(--color-primary)',
                    backgroundColor: 'rgba(255, 51, 0, 0.03)',
                    fontWeight: '600',
                    color: 'var(--color-primary)',
                    height: '42px',
                    borderRadius: '8px',
                  }}
                >
                  📷 Tomar Foto / Adjuntar Evidencia
                </label>

                {newLogPhotos.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                    {newLogPhotos.map((photo, idx) => (
                      <div key={idx} style={{ position: 'relative' }}>
                        <img
                          src={photo.previewUrl}
                          alt={`Evidencia ${idx + 1}`}
                          style={{
                            width: '64px',
                            height: '64px',
                            objectFit: 'cover',
                            borderRadius: '8px',
                            border: '1px solid var(--color-gray-200)',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveNewLogPhoto(idx)}
                          title="Quitar evidencia"
                          style={{
                            position: 'absolute',
                            top: '-6px',
                            right: '-6px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: 'var(--color-alert)',
                            color: '#fff',
                            border: 'none',
                            fontSize: '11px',
                            lineHeight: 1,
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={isCompleted || isExceeded || sequenceBlocked || !newLog.gameName || !newLog.quantity || !newLog.operator || isSubmittingLog}
              >
                {isSubmittingLog ? '⏳ Guardando...' : '💾 Registrar Trabajo'}
              </Button>
            </form>
          </Card>
        </motion.div>
        )}

        {/* Columna 2: Historial */}
        <motion.div variants={itemVariants} className={styles.historyCol}>
          <Card variant="default">
            <h3 className={styles.sectionTitle}>Historial del Área</h3>
            <div className={styles.historyList}>
              {filteredHistorial.map((log) => (
                <div key={log.id} className={styles.logCard}>
                  <div className={styles.logHeader}>
                    <strong className={styles.logGame}>{log.gameName}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Badge variant={log.status === 'aprobado' ? 'success' : 'danger'}>
                        {log.status.toUpperCase()}
                      </Badge>
                      {!isReadOnly && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => handleEditLogClick(log)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--color-primary)',
                              cursor: 'pointer',
                              fontSize: '14px',
                              padding: '2px',
                              borderRadius: '4px',
                              transition: 'background-color 0.2s',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            title="Editar registro"
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteLogClick(log.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--color-alert)',
                              cursor: 'pointer',
                              fontSize: '14px',
                              padding: '2px',
                              borderRadius: '4px',
                              transition: 'background-color 0.2s',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            title="Eliminar registro"
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 51, 0, 0.05)')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            🗑️
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.logMeta}>
                    <span>Cant: <strong>{log.quantity}</strong></span>
                    <span>Op: <strong>{log.operator}</strong></span>
                    <span>Fecha: <strong>{new Date(log.date).toLocaleDateString()}</strong></span>
                  </div>
                  {log.notes && <p className={styles.logNotes}>{log.notes}</p>}
                  {log.photos && log.photos.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {log.photos.map((photo, idx) => (
                        <img
                          key={photo.path || idx}
                          src={photo.url}
                          alt={`Evidencia ${idx + 1} de ${log.gameName}`}
                          style={{
                            width: '48px',
                            height: '48px',
                            objectFit: 'cover',
                            borderRadius: '6px',
                            border: '1px solid var(--color-gray-200)',
                            cursor: 'pointer',
                          }}
                          onClick={() => setPhotoPreview(photo.url)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {filteredHistorial.length === 0 && (
                <EmptyState
                  message="No se han registrado salidas en esta área todavía."
                  shape="cacahuate"
                  color={activeArea?.color || 'var(--color-gray-300)'}
                />
              )}
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Tablero de Control: Juegos y Proyectos Asignados a esta Área */}
      <motion.div variants={itemVariants} style={{ marginTop: 'var(--space-6)' }}>
        <Card variant="default">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: 'var(--space-4)' }}>
            <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
              📋 Juegos y Proyectos Asignados a {activeArea?.name}
            </h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Badge variant="danger">
                {filteredJuegos.filter(j => (j.producedPieces?.[areaId] || 0) === 0).length} Pendientes
              </Badge>
              <Badge variant="warning">
                {filteredJuegos.filter(j => {
                  const p = j.producedPieces?.[areaId] || 0;
                  const t = j.targetPieces?.[areaId] || 10;
                  return p > 0 && p < t;
                }).length} En Proceso
              </Badge>
              <Badge variant="success">
                {filteredJuegos.filter(j => (j.producedPieces?.[areaId] || 0) >= (j.targetPieces?.[areaId] || 10)).length} Completados
              </Badge>
            </div>
          </div>

          <div className={styles.tableResponsive}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Juego / Módulo</th>
                  <th>Proyecto / Cliente</th>
                  <th>Piezas Producidas</th>
                  <th style={{ width: '200px' }}>Progreso del Área</th>
                  <th>Estado</th>
                  <th>Entrega a PT</th>
                  <th>Fecha Límite</th>
                  <th>Piezas Externas</th>
                  {areaId === 'mantenimiento' && <th>Iluminación LED</th>}
                </tr>
              </thead>
              <tbody>
                {visibleFilteredJuegos.map((j) => {
                  const target = j.targetPieces?.[areaId] || 10;
                  const produced = j.producedPieces?.[areaId] || 0;
                  const pct = Math.min(100, Math.round((produced / target) * 100));
                  const isFinished = produced >= target;
                  const isStarted = produced > 0;
                  const deliveryStatus = j.areaDeliveryStatus?.[areaId] || 'pendiente';
                  const qualityStatus = j.qualityReview?.[areaId]?.status || 'pendiente';
                  const isQualityApproved = qualityStatus === 'aprobado';
                  // Si esta área alimenta a otra del mismo juego (ej. Corte Láser → Herrería),
                  // su entrega es un traspaso interno — no pasa por Calidad ni se notifica a PT.
                  const feederDependentAreaId = getFeederDependentAreaId(j, areaId);
                  const feederDependentAreaName = feederDependentAreaId
                    ? AREAS_CONFIG.find((a) => a.id === feederDependentAreaId)?.name || feederDependentAreaId
                    : null;

                  const proj = proyectos?.find((p) => p.id === j.projectId);
                  const clientName = proj?.client || 'Cliente General';
                  const limitDate = proj?.endDate ? new Date(proj.endDate).toLocaleDateString() : 'Sin fecha';

                  const externalOrders = j.externalOrders || [];
                  const pendingCount = externalOrders.filter((o) => o.status === 'pendiente').length;
                  const delayedCount = externalOrders.filter(
                    (o) => o.status === 'pendiente' && o.expectedDeliveryDate < todayStr
                  ).length;

                  const ledSteps = j.ledWork?.steps;
                  const ledDoneCount = ledSteps ? Object.values(ledSteps).filter(Boolean).length : 0;

                  return (
                    <tr key={j.id} style={{ borderBottom: '1px solid var(--color-gray-100)' }}>
                      <td data-label="Juego / Módulo" style={{ fontWeight: '600', padding: '12px 8px' }}>🧩 {j.name}</td>
                      <td data-label="Proyecto / Cliente">
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: '500' }}>{j.projectName}</span>
                          <span style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>{clientName}</span>
                        </div>
                      </td>
                      <td data-label="Piezas Producidas" style={{ fontWeight: 'bold' }}>
                        {produced} / {target} pzas
                      </td>
                      <td data-label="Progreso del Área">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className={styles.progressTrack} style={{ flexGrow: 1, margin: 0, height: '8px' }}>
                            <div
                              className={styles.progressSegmentActual}
                              style={{ width: `${pct}%`, backgroundColor: activeArea?.color }}
                            />
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: 'bold', minWidth: '35px' }}>{pct}%</span>
                        </div>
                      </td>
                      <td data-label="Estado">
                        <Badge variant={isFinished ? 'success' : isStarted ? 'warning' : 'danger'}>
                          {isFinished ? 'COMPLETADO' : isStarted ? 'EN PROCESO' : 'PENDIENTE'}
                        </Badge>
                      </td>
                      <td data-label="Entrega a PT">
                        {feederDependentAreaId ? (
                          <span
                            style={{ fontSize: '12px', color: 'var(--color-gray-500)', fontStyle: 'italic' }}
                            title={`Esta área entrega su material directo a ${feederDependentAreaName} (proceso interno) — no pasa por Calidad ni se notifica a Producto Terminado.`}
                          >
                            ➜ Pasa a {feederDependentAreaName}
                          </span>
                        ) : !isFinished ? (
                          <span style={{ color: 'var(--color-gray-400)' }}>—</span>
                        ) : deliveryStatus === 'pendiente' && !isQualityApproved ? (
                          <Badge variant="warning">
                            {qualityStatus === 'rechazado' ? '❌ Rechazado' : '⏳ Esperando Calidad'}
                          </Badge>
                        ) : deliveryStatus === 'pendiente' && isQualityApproved ? (
                          canManageAreaWork(j) ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                notifyAreaDelivery(j.id, areaId);
                                toast.success(`🔔 Se ha notificado la entrega de "${j.name}" a Producto Terminado.`);
                              }}
                            >
                              🔔 Notificar
                            </Button>
                          ) : (
                            <Badge variant="warning">🔔 Pendiente de Notificar</Badge>
                          )
                        ) : deliveryStatus === 'notificado_pt' ? (
                          <Badge variant="warning">📨 Notificado</Badge>
                        ) : (
                          <Badge variant="success">✅ Recibido</Badge>
                        )}
                      </td>
                      <td data-label="Fecha Límite" style={{ color: 'var(--color-gray-600)', fontSize: '13px' }}>📅 {limitDate}</td>
                      <td data-label="Piezas Externas">
                        <button
                          type="button"
                          onClick={() => handleOpenExternalOrdersModal(j)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
                            border: '1px solid var(--color-gray-200)', borderRadius: '6px', padding: '4px 10px',
                            background: delayedCount > 0 ? 'rgba(220, 38, 38, 0.08)' : 'var(--color-white)',
                            cursor: 'pointer', fontWeight: 600,
                            color: delayedCount > 0 ? 'var(--color-danger)' : 'var(--color-secondary)',
                          }}
                        >
                          🛠️ {externalOrders.length === 0 ? 'Sin piezas externas' : `${externalOrders.length} orden(es)`}
                          {delayedCount > 0 && ` · ${delayedCount} retrasada(s)`}
                          {delayedCount === 0 && pendingCount > 0 && ` · ${pendingCount} pendiente(s)`}
                        </button>
                      </td>
                      {areaId === 'mantenimiento' && (
                        <td data-label="Iluminación LED">
                          <button
                            type="button"
                            onClick={() => handleOpenLedWorkModal(j)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
                              border: '1px solid var(--color-gray-200)', borderRadius: '6px', padding: '4px 10px',
                              background: 'var(--color-white)', cursor: 'pointer', fontWeight: 600,
                              color: 'var(--color-secondary)',
                            }}
                          >
                            💡 {!j.ledWork?.required ? 'No aplica' : `${ledDoneCount}/3 tareas`}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}

                {filteredJuegos.length === 0 && (
                  <tr>
                    <td colSpan={areaId === 'mantenimiento' ? 9 : 8} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-gray-500)' }}>
                      No hay juegos activos asignados a esta área actualmente.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {hasMoreFilteredJuegos && (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
              <Button variant="secondary" onClick={showMoreFilteredJuegos}>
                Cargar {Math.min(remainingFilteredJuegos, 15)} más ({remainingFilteredJuegos} restantes)
              </Button>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Tablero de Control: Personal del Área y Solicitud de Horas Extras */}
      {(canManageJornada || user?.roleType === ROLE_TYPES.ENCARGADO_AREA) && (
      <motion.div variants={itemVariants} style={{ marginTop: 'var(--space-6)' }}>
        <Card variant="default">
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', gap: '12px' }}>
            <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
              👥 Personal del Área
            </h3>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleOpenRequestOvertimeModal}
            >
              ⏰ Solicitar Horas Extras
            </Button>
          </div>

          {operadoresDisponibles.length === 0 ? (
            <EmptyState
              message="No hay personal asignado a esta área actualmente."
              shape="cacahuate"
              color={activeArea?.color || 'var(--color-gray-300)'}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {operadoresDisponibles.map((op) => {
                const startStr = String(op.schedule?.startHour ?? 8).padStart(2, '0');
                const endStr = String(op.schedule?.endHour ?? 18).padStart(2, '0');
                const hasOvertimeToday = op.schedule?.overtimeHours > 0 && op.schedule?.authorizedDate === getTodayLocalDateStr();
                // Solo las horas extra del DÍA EN CURSO (no canceladas): las pendientes siguen
                // mostrando los botones de verificar, y las ya verificadas muestran el resultado
                // y el comentario, en vez de desaparecer de la vista al verificarse. El histórico
                // de días anteriores se consulta desde Operarios, no aquí.
                const opRecentHEs = horasExtra.filter(
                  (h) => h.operarioId === op.id && h.authorizedDate === getTodayLocalDateStr() && h.verificationStatus !== 'cancelado'
                );
                const isExpanded = expandedOvertimeOperarios.has(op.id);

                return (
                  <div
                    key={op.id}
                    style={{
                      border: '1px solid var(--color-gray-200)', borderRadius: '8px', padding: '10px 12px',
                      display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
                      <strong>{op.name || 'Sin Nombre'}</strong>
                      <span style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                        ⏰ {startStr}:00 - {endStr}:00
                        {op.currentArea !== op.homeArea && ' (prestado)'}
                      </span>
                      {hasOvertimeToday && (
                        <Badge variant="warning" size="sm" style={{ width: 'fit-content' }}>
                          +{op.schedule.overtimeHours}h Extra hoy
                        </Badge>
                      )}

                      {canManageJornada && opRecentHEs.length > 0 && (
                        <div style={{ marginTop: '4px', minWidth: '260px' }}>
                          <button
                            type="button"
                            onClick={() => toggleOvertimeExpanded(op.id)}
                            style={{
                              fontSize: '10.5px', fontWeight: 700, color: 'var(--color-secondary)',
                              background: 'rgba(255, 153, 51, 0.1)', border: '1px solid rgba(255, 153, 51, 0.3)',
                              borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', width: '100%', textAlign: 'left',
                            }}
                          >
                            🕒 Tiempo Extra ({opRecentHEs.length}) {isExpanded ? '▲' : '▼'}
                          </button>
                          {isExpanded && opRecentHEs.map((h) => {
                            const { earlyHours, earlyRange, lateHours, lateRange } = getOvertimeBlocks(h.startHour, h.endHour, h.authorizedDate);
                            return (
                              <div
                                key={h.id}
                                style={{
                                  marginTop: '2px', padding: '6px 8px', borderRadius: '6px',
                                  background: 'rgba(255, 153, 51, 0.08)', border: '1px solid rgba(255, 153, 51, 0.25)',
                                  fontSize: '11px',
                                }}
                              >
                                <div style={{ fontWeight: 600, color: 'var(--color-secondary)', marginBottom: '2px' }}>
                                  🕒 {h.authorizedDate} — Tareas ({h.overtimeHours}h):
                                </div>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                  {earlyHours > 0 && (
                                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                                      🌅 Matutino: {earlyHours}h ({earlyRange})
                                    </span>
                                  )}
                                  {lateHours > 0 && (
                                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa' }}>
                                      🌆 Vespertino: {lateHours}h ({lateRange})
                                    </span>
                                  )}
                                </div>
                                <div style={{ color: 'var(--color-gray-700)', marginBottom: '4px' }}>{h.overtimeTasks}</div>
                                {h.verificationStatus === 'pendiente' ? (
                                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                    <button
                                      type="button"
                                      onClick={() => handleVerifyHorasExtraCumplido(h.id)}
                                      style={{ fontSize: '10.5px', fontWeight: 700, color: '#15803d', background: 'none', border: '1px solid #15803d', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                                    >
                                      ✅ Cumplió
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenHorasExtraRejectModal(h.id)}
                                      style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--color-alert)', background: 'none', border: '1px solid var(--color-alert)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                                    >
                                      ❌ No Cumplió
                                    </button>
                                  </div>
                                ) : (
                                  // Ya verificado (por Calidad o por un Supervisor) — se muestra el
                                  // resultado, quién lo verificó y el comentario (tooltip con
                                  // verificationNotes), en vez de que el registro desaparezca sin dejar
                                  // rastro visible para el área/colaborador.
                                  <div style={{ marginBottom: '4px' }}>
                                    <span
                                      title={h.verificationNotes ? `${h.verificationNotes} — ${h.verifiedBy}` : h.verifiedBy}
                                      style={{
                                        fontSize: '10.5px', fontWeight: 700,
                                        color: h.verificationStatus === 'cumplido' ? '#15803d' : 'var(--color-alert)',
                                      }}
                                    >
                                      {h.verificationStatus === 'cumplido' ? '✅ Cumplido' : '❌ No Cumplido'} — {h.verifiedBy}
                                    </span>
                                    {h.verificationStatus === 'no_cumplido' && h.verificationNotes && (
                                      <div style={{ marginTop: '2px', fontSize: '10.5px', color: 'var(--color-gray-700)' }}>
                                        Comentario: {h.verificationNotes}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleOpenScheduleCorrectionModal(h)}
                                  style={{ fontSize: '10.5px', fontWeight: 700, color: '#374151', background: 'none', border: '1px solid var(--color-gray-400)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                                >
                                  ✏️ Corregir Horario
                                </button>
                                {h.scheduleCorrection && (
                                  <div style={{ marginTop: '4px', fontSize: '10.5px', color: '#b91c1c' }}>
                                    {h.scheduleCorrection.actualStartHour !== h.startHour && (
                                      <div>⚠️ Entrada real: {String(h.scheduleCorrection.actualStartHour).padStart(2, '0')}:00 (autorizado {String(h.startHour).padStart(2, '0')}:00)</div>
                                    )}
                                    {h.scheduleCorrection.actualEndHour !== h.endHour && (
                                      <div>⚠️ Salida real: {String(h.scheduleCorrection.actualEndHour).padStart(2, '0')}:00 (autorizado {String(h.endHour).padStart(2, '0')}:00)</div>
                                    )}
                                    <div>Motivo: {h.scheduleCorrection.reason} — Corrigió: {h.scheduleCorrection.correctedBy}</div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {canManageJornada && (
                      <Button variant="ghost" size="sm" onClick={() => handleOpenScheduleModal(op)}>
                        🕒 Jornada
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </motion.div>
      )}

      {/* Tablero de Solicitudes de Horas Extras del Área — Visible para Encargados, Supervisores y Admin */}
      {(() => {
        const areaSolicitudes = solicitudesHorasExtra.filter((s) => s.areaId === areaId);
        return (
          <motion.div variants={itemVariants} style={{ marginTop: 'var(--space-6)' }}>
            <Card variant="default">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: 'var(--space-4)' }}>
                <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
                  📋 Solicitudes de Horas Extras — {activeArea?.name}
                </h3>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleOpenRequestOvertimeModal}
                  style={{ backgroundColor: 'var(--color-secondary)', color: '#ffffff', fontWeight: 'bold' }}
                >
                  ⏰ Solicitar Horas Extras
                </Button>
              </div>

              {areaSolicitudes.length === 0 ? (
                <div style={{ padding: '16px', color: 'var(--color-gray-500)', textAlign: 'center', fontSize: '13px' }}>
                  No se han registrado solicitudes de horas extras para esta área todavía. Haz clic en "Solicitar Horas Extras" para crear una.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {areaSolicitudes.slice(0, 15).map((sol) => (
                    <div
                      key={sol.id}
                      style={{
                        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
                        gap: '8px', padding: '10px 14px', background: sol.status === 'pendiente' ? '#fffbeb' : 'var(--color-gray-50)',
                        borderRadius: '8px', border: sol.status === 'pendiente' ? '1px solid #fde68a' : '1px solid var(--color-gray-200)',
                        fontSize: '13px',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div>
                          <strong>{sol.operarioName}</strong> — ⏱️ <strong>{sol.horas}h</strong> extra ({sol.bloque === 'matutino' ? '🌅 Matutino' : '🌆 Vespertino'}) para el 📅 <strong>{sol.fecha}</strong>
                        </div>
                        {sol.motivo && <div style={{ color: 'var(--color-gray-600)', fontSize: '12px' }}>Motivo/Tareas: <em>"{sol.motivo}"</em></div>}
                        <div style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                          Solicitado por: <strong>{sol.solicitadoPor}</strong> · {new Date(sol.createdAt).toLocaleDateString()} {new Date(sol.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {sol.status === 'pendiente' && <Badge variant="warning">🟡 Pendiente de Autorización</Badge>}
                        {sol.status === 'autorizada' && <Badge variant="success">🟢 Autorizada por {sol.revisadoPor}</Badge>}
                        {sol.status === 'rechazada' && <Badge variant="danger">🔴 Rechazada por {sol.revisadoPor}</Badge>}
                        {sol.status === 'cancelada' && <Badge variant="neutral">⚪ Cancelada ({sol.canceladaPor})</Badge>}

                        {(sol.status === 'pendiente' || sol.status === 'autorizada') && (
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenEditOvertimeRequestModal(sol)}>
                              ✏️ Modificar
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleCancelOvertimeRequest(sol)} style={{ color: 'var(--color-alert)' }}>
                              🚫 Cancelar
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
        );
      })()}

      {/* ============================================
          MODAL: ÓRDENES DE TRABAJO A PROVEEDORES EXTERNOS
          ============================================ */}
      <Modal
        isOpen={externalOrdersModal.isOpen}
        onClose={handleCloseExternalOrdersModal}
        title={`🛠️ Piezas Externas: ${externalOrdersGame?.name || ''}`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: '12px', color: 'var(--color-gray-600)', margin: 0 }}>
            Piezas encargadas a proveedores externos (ej. fibra de vidrio, letreros iluminados) que no
            fabrica ninguna de las 8 áreas, pero que deben llegar antes de poder completar Producto Terminado.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(externalOrdersGame?.externalOrders || []).map((order) => {
              const isDelayed = order.status === 'pendiente' && order.expectedDeliveryDate < todayStr;
              return (
                <div
                  key={order.id}
                  style={{
                    border: '1px solid var(--color-gray-200)', borderRadius: '8px', padding: '10px 12px',
                    borderLeft: `4px solid ${order.status === 'recibido' ? 'var(--color-success)' : isDelayed ? 'var(--color-danger)' : 'var(--color-warning)'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div>
                      <strong style={{ fontSize: '13px' }}>{order.componentName}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                        Proveedor: {order.supplier} • {order.quantity} {order.unit}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                        Entrega estimada: {new Date(`${order.expectedDeliveryDate}T00:00:00`).toLocaleDateString()}
                      </div>
                      {order.status === 'recibido' && (
                        <div style={{ fontSize: '12px', color: 'var(--color-success)' }}>
                          ✅ Recibido por {order.receivedBy} el {new Date(order.receivedDate).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <Badge variant={order.status === 'recibido' ? 'success' : isDelayed ? 'danger' : 'warning'}>
                      {order.status === 'recibido' ? 'RECIBIDO' : isDelayed ? 'RETRASADO' : 'PENDIENTE'}
                    </Badge>
                  </div>
                  {order.status === 'pendiente' && canReceiveExternalOrders() && (
                    <Button
                      variant="secondary"
                      size="sm"
                      style={{ marginTop: '8px' }}
                      onClick={() => handleReceiveExternalOrder(order)}
                    >
                      ✅ Marcar Recibido (Producto Terminado)
                    </Button>
                  )}
                  {order.status === 'pendiente' && !canReceiveExternalOrders() && (
                    <span style={{ display: 'block', marginTop: '8px', fontSize: '11px', color: 'var(--color-gray-500)' }}>
                      Solo Producto Terminado puede marcar esta pieza como recibida.
                    </span>
                  )}
                </div>
              );
            })}

            {(externalOrdersGame?.externalOrders || []).length === 0 && (
              <EmptyState
                message="Este juego no tiene piezas de proveedores externos registradas."
                shape="cacahuate"
                color="var(--color-gray-300)"
              />
            )}
          </div>

          {canManageAreaWork(externalOrdersGame) && (
            <form onSubmit={handleSubmitExternalOrder} className={styles.form} style={{ borderTop: '1px solid var(--color-gray-100)', paddingTop: 'var(--space-4)' }}>
              <h4 className={styles.sectionTitle} style={{ marginBottom: 'var(--space-2)' }}>➕ Nueva Orden de Trabajo</h4>

              <div className={styles.formGroup}>
                <Select
                  label="Tipo de Pieza"
                  value={externalOrderForm.componentType}
                  onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, componentType: e.target.value }))}
                  options={EXTERNAL_COMPONENT_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </div>

              {externalOrderForm.componentType === 'Otro' && (
                <div className={styles.formGroup}>
                  <label className={styles.label}>Especifica la Pieza</label>
                  <input
                    type="text"
                    className={styles.textarea}
                    placeholder="Ej: Cubierta de Lona Reforzada"
                    value={externalOrderForm.customComponentName}
                    onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, customComponentName: e.target.value }))}
                  />
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.label}>Proveedor Externo</label>
                <input
                  type="text"
                  className={styles.textarea}
                  placeholder="Ej: Fibras Industriales de Occidente"
                  value={externalOrderForm.supplier}
                  onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, supplier: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <div className={styles.formGroup} style={{ flex: 1 }}>
                  <label className={styles.label}>Cantidad</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.textarea}
                    value={externalOrderForm.quantity}
                    onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, quantity: Math.max(1, Number(e.target.value) || 1) }))}
                  />
                </div>
                <div className={styles.formGroup} style={{ flex: 1 }}>
                  <label className={styles.label}>Unidad</label>
                  <input
                    type="text"
                    className={styles.textarea}
                    value={externalOrderForm.unit}
                    onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, unit: e.target.value }))}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Fecha de Entrega Establecida con el Proveedor</label>
                <input
                  type="date"
                  className={styles.textarea}
                  value={externalOrderForm.expectedDeliveryDate}
                  onChange={(e) => setExternalOrderForm((prev) => ({ ...prev, expectedDeliveryDate: e.target.value }))}
                />
              </div>

              <Button type="submit" variant="primary" size="md">
                🛠️ Registrar Orden de Trabajo
              </Button>
            </form>
          )}
        </div>
      </Modal>

      {/* ============================================
          MODAL: TRABAJO DE ILUMINACIÓN LED (MANTENIMIENTO)
          ============================================ */}
      <Modal
        isOpen={ledWorkModal.isOpen}
        onClose={handleCloseLedWorkModal}
        title={`💡 Iluminación LED: ${ledWorkGame?.name || ''}`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: '12px', color: 'var(--color-gray-600)', margin: 0 }}>
            Algunas resbaladillas llevan instalación de luces LED. Mantenimiento se encarga de instalarlas,
            entregar el tablero eléctrico correspondiente y revisar que todo funcione correctamente.
          </p>

          {!ledWorkGame?.ledWork?.required ? (
            <>
              <EmptyState
                message="Este juego aún no tiene activado el trabajo de iluminación LED."
                shape="cacahuate"
                color="var(--color-gray-300)"
              />
              {canManageAreaWork(ledWorkGame) && (
                <Button variant="primary" size="md" onClick={handleEnableLedWork}>
                  💡 Este Juego Requiere Instalación de LED
                </Button>
              )}
            </>
          ) : (
            <>
              {!hasReceivedExternalPiecesForModal(ledWorkGame) && (
                <div className={styles.bannerWarning}>
                  <strong>⏳ {(ledWorkGame?.externalOrders || []).length === 0 ? 'Sin Piezas Externas Registradas' : 'Piezas Externas Pendientes'}:</strong>
                  <span>
                    {(ledWorkGame?.externalOrders || []).length === 0
                      ? ' Este juego no tiene ninguna pieza externa (fibra de vidrio) registrada todavía; regístrala antes de continuar con la iluminación LED.'
                      : ' Aún hay piezas de proveedores externos sin recibir; no se puede completar el trabajo LED hasta que Producto Terminado las reciba.'}
                  </span>
                </div>
              )}

              {[
                { key: 'instalacionLed', label: 'Instalación de Luces LED' },
                { key: 'tableroElectrico', label: 'Entrega de Tablero Eléctrico' },
                { key: 'revisionFuncionamiento', label: 'Revisión de Funcionamiento' },
              ].map(({ key, label }) => {
                const checked = Boolean(ledWorkGame.ledWork.steps?.[key]);
                const canToggleOn = checked || hasReceivedExternalPiecesForModal(ledWorkGame);
                return (
                  <label
                    key={key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                      border: '1px solid var(--color-gray-200)', borderRadius: '8px',
                      background: checked ? 'rgba(16, 185, 129, 0.05)' : 'var(--color-white)',
                      cursor: canManageAreaWork(ledWorkGame) && canToggleOn ? 'pointer' : 'not-allowed',
                      opacity: canToggleOn ? 1 : 0.6,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canManageAreaWork(ledWorkGame) || !canToggleOn}
                      onChange={() => handleToggleLedStep(key, checked)}
                    />
                    <span style={{ fontSize: '13px', textDecoration: checked ? 'line-through' : 'none', color: checked ? 'var(--color-gray-500)' : 'var(--color-dark)' }}>
                      {label}
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      </Modal>

      {/* ============================================
          MODAL: EDITAR REGISTRO DE PRODUCCIÓN
          ============================================ */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingLog(null);
        }}
        title={`✏️ Editar Registro: ${editingLog?.gameName || ''}`}
      >
        <form onSubmit={handleSaveEditLog} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Cantidad Producida</label>
            <input
              type="number"
              min="1"
              className={styles.textarea}
              style={{ width: '100%' }}
              value={editForm.quantity}
              onChange={(e) => setEditForm((prev) => ({ ...prev, quantity: e.target.value }))}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Colaborador / Operario</label>
            <select
              className={styles.textarea}
              style={{ width: '100%', height: '40px', backgroundColor: 'var(--color-bg-light)', border: '1px solid var(--color-gray-300)', borderRadius: '6px' }}
              value={editForm.operator}
              onChange={(e) => setEditForm((prev) => ({ ...prev, operator: e.target.value }))}
              required
            >
              <option value="" disabled>Selecciona el operario responsable</option>
              {operadoresDisponibles.map((op) => (
                <option key={op.id} value={op.name}>
                  {op.currentArea === op.homeArea ? op.name : `${op.name} (prestado)`}
                </option>
              ))}
              {editForm.operator && !operadoresDisponibles.some((op) => op.name === editForm.operator) && (
                <option value={editForm.operator}>{editForm.operator}</option>
              )}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Notas / Observaciones</label>
            <textarea
              className={styles.textarea}
              style={{ width: '100%' }}
              value={editForm.notes}
              onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
              rows="3"
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Evidencia Fotográfica</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              style={{ display: 'none' }}
              id="production-edit-photo-capture"
              onChange={handleAddEditPhotos}
              disabled={isUploadingEditPhotos}
            />
            <label
              htmlFor="production-edit-photo-capture"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: isUploadingEditPhotos ? 'wait' : 'pointer',
                border: '1px dashed var(--color-primary)',
                backgroundColor: 'rgba(255, 51, 0, 0.03)',
                fontWeight: '600',
                color: 'var(--color-primary)',
                height: '42px',
                borderRadius: '8px',
                opacity: isUploadingEditPhotos ? 0.6 : 1,
              }}
            >
              {isUploadingEditPhotos ? '⏳ Subiendo...' : '📷 Agregar Evidencia'}
            </label>

            {editPhotos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                {editPhotos.map((photo, idx) => (
                  <div key={photo.path || idx} style={{ position: 'relative' }}>
                    <img
                      src={photo.url}
                      alt={`Evidencia ${idx + 1}`}
                      style={{
                        width: '64px',
                        height: '64px',
                        objectFit: 'cover',
                        borderRadius: '8px',
                        border: '1px solid var(--color-gray-200)',
                        cursor: 'pointer',
                      }}
                      onClick={() => setPhotoPreview(photo.url)}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveEditPhoto(photo)}
                      title="Quitar evidencia"
                      style={{
                        position: 'absolute',
                        top: '-6px',
                        right: '-6px',
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: 'var(--color-alert)',
                        color: '#fff',
                        border: 'none',
                        fontSize: '11px',
                        lineHeight: 1,
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => {
                setIsEditModalOpen(false);
                setEditingLog(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="md">
              Guardar Cambios
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: VISTA AMPLIADA DE EVIDENCIA FOTOGRÁFICA */}
      {photoPreview && (
        <Modal isOpen={Boolean(photoPreview)} onClose={() => setPhotoPreview(null)} title="📷 Evidencia Fotográfica">
          <img src={photoPreview} alt="Evidencia fotográfica ampliada" style={{ width: '100%', borderRadius: '8px' }} />
        </Modal>
      )}

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN DE REGISTRO DE PRODUCCIÓN */}
      {deleteConfirmation.isOpen && (
        <Modal
          isOpen={deleteConfirmation.isOpen}
          onClose={() => setDeleteConfirmation({ isOpen: false, logId: null })}
          title="🗑️ Confirmar Eliminación"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar este registro de producción?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción descontará automáticamente las piezas del avance general del juego y recalculará los reportes.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setDeleteConfirmation({ isOpen: false, logId: null })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={handleConfirmDeleteLog}
              >
                Eliminar Registro
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================
          MODAL: GESTIÓN DE JORNADA / AUTORIZAR TIEMPO EXTRA
          ============================================ */}
      {scheduleModal.isOpen && (
        <Modal
          isOpen={scheduleModal.isOpen}
          onClose={handleCloseScheduleModal}
          title={`Gestión de Jornada: ${scheduleModal.collaborator?.name}`}
        >
          <form onSubmit={handleSaveSchedule} className={styles.form}>
            <div style={{ display: 'flex', gap: 'var(--space-5)', padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)', fontSize: 'var(--body-size)' }}>
              <div>
                <strong>Colaborador:</strong> {scheduleModal.collaborator?.name}
              </div>
              <div>
                <strong>Área Actual:</strong> {activeArea?.name}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Fecha de la Jornada</label>
              <input
                type="date"
                required
                className={styles.textarea}
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
              {(() => {
                const { earlyHours, earlyRange, lateHours, lateRange } = getOvertimeBlocks(
                  Number(scheduleModal.startHour),
                  Number(scheduleModal.endHour),
                  scheduleModal.authorizedDate
                );
                if (earlyHours === 0 && lateHours === 0) {
                  return (
                    <input type="text" className={styles.textarea} style={{ backgroundColor: 'var(--color-gray-100)', cursor: 'not-allowed' }} value="0 hora(s) — sin tiempo extra" disabled />
                  );
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {earlyHours > 0 && (
                      <div style={{ fontSize: '13px', padding: '8px 10px', backgroundColor: '#eff6ff', borderRadius: '6px', border: '1px solid #bfdbfe' }}>
                        🌅 <strong>Bloque Matutino:</strong> {earlyHours}h ({earlyRange})
                      </div>
                    )}
                    {lateHours > 0 && (
                      <div style={{ fontSize: '13px', padding: '8px 10px', backgroundColor: '#fff7ed', borderRadius: '6px', border: '1px solid #fed7aa' }}>
                        🌆 <strong>Bloque Vespertino:</strong> {lateHours}h ({lateRange})
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                      Total: {scheduleModal.overtimeHours} hora(s)
                    </div>
                  </div>
                );
              })()}
            </div>

            {Number(scheduleModal.overtimeHours) > 0 && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Tareas a Realizar en el Tiempo Extra *</label>
                <textarea
                  className={styles.textarea}
                  rows="3"
                  required
                  placeholder="Ej: Terminar ensamble de 20 piezas del pedido X, lijado final de mesas..."
                  value={scheduleModal.overtimeTasks}
                  onChange={(e) => setScheduleModal((prev) => ({ ...prev, overtimeTasks: e.target.value }))}
                />
                <p style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: 'var(--space-1)' }}>
                  Calidad revisará después que estas tareas realmente se hayan cumplido.
                </p>
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label}>Supervisor que Autoriza</label>
              <input
                type="text"
                className={styles.textarea}
                style={{ backgroundColor: 'var(--color-gray-100)', cursor: 'not-allowed' }}
                value={user?.name || 'Administrador'}
                disabled
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <Button type="button" variant="secondary" onClick={handleCloseScheduleModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" isLoading={isSavingSchedule}>
                Guardar y Autorizar
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Marcar tareas de tiempo extra como "No Cumplido" (requiere motivo) */}
      {horasExtraRejectModal.isOpen && (
        <Modal
          isOpen={horasExtraRejectModal.isOpen}
          onClose={handleCloseHorasExtraRejectModal}
          title="❌ Tareas de Tiempo Extra No Cumplidas"
        >
          <form onSubmit={handleSubmitHorasExtraReject} className={styles.form}>
            <div className={styles.formGroup}>
              <label className={styles.label}>¿Qué no se cumplió?</label>
              <textarea
                rows="3"
                required
                className={styles.textarea}
                placeholder="Ej: Solo terminó la mitad del pedido, no se realizó el lijado final..."
                value={horasExtraRejectModal.notes}
                onChange={(e) => setHorasExtraRejectModal((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <Button type="button" variant="secondary" onClick={handleCloseHorasExtraRejectModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="danger">
                Confirmar No Cumplido
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Corregir horario real de tiempo extra */}
      {scheduleCorrectionModal.isOpen && (() => {
        const targetHE = horasExtra.find((h) => h.id === scheduleCorrectionModal.horasExtraId);
        if (!targetHE) return null;
        const { earlyHours, lateHours, baseStartHour, baseEndHour } = getOvertimeBlocks(targetHE.startHour, targetHE.endHour, targetHE.authorizedDate);

        const startOptions = [];
        for (let hVal = targetHE.startHour; hVal <= baseStartHour; hVal += 1) {
          startOptions.push({ value: String(hVal), label: `${String(hVal).padStart(2, '0')}:00` });
        }
        const endOptions = [];
        for (let hVal = baseEndHour; hVal <= targetHE.endHour; hVal += 1) {
          endOptions.push({ value: String(hVal), label: `${String(hVal).padStart(2, '0')}:00` });
        }

        return (
          <Modal
            isOpen={scheduleCorrectionModal.isOpen}
            onClose={handleCloseScheduleCorrectionModal}
            title="✏️ Corregir Horario de Tiempo Extra"
          >
            <form onSubmit={handleSubmitScheduleCorrection} className={styles.form}>
              <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: 0 }}>
                Autorizado: {String(targetHE.startHour).padStart(2, '0')}:00 - {String(targetHE.endHour).padStart(2, '0')}:00 el {targetHE.authorizedDate}. Ajusta solo la hora del bloque que en realidad no se cumplió como se autorizó.
              </p>

              {earlyHours > 0 && (
                <div className={styles.formGroup}>
                  <Select
                    label="Hora Real de Entrada (bloque matutino)"
                    value={scheduleCorrectionModal.actualStartHour}
                    onChange={(e) => setScheduleCorrectionModal((prev) => ({ ...prev, actualStartHour: e.target.value }))}
                    required
                    options={startOptions}
                  />
                </div>
              )}

              {lateHours > 0 && (
                <div className={styles.formGroup}>
                  <Select
                    label="Hora Real de Salida (bloque vespertino)"
                    value={scheduleCorrectionModal.actualEndHour}
                    onChange={(e) => setScheduleCorrectionModal((prev) => ({ ...prev, actualEndHour: e.target.value }))}
                    required
                    options={endOptions}
                  />
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.label}>Motivo de la Corrección</label>
                <textarea
                  className={styles.textarea}
                  rows="3"
                  required
                  placeholder="Ej: Llegó a las 8:00 en vez de las 6:00 autorizadas, no se realizó el bloque matutino completo..."
                  value={scheduleCorrectionModal.reason}
                  onChange={(e) => setScheduleCorrectionModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <Button type="button" variant="secondary" onClick={handleCloseScheduleCorrectionModal}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary">
                  Guardar Corrección
                </Button>
              </div>
            </form>
          </Modal>
        );
      })()}

      {/* MODAL: SOLICITAR HORAS EXTRAS */}
      {requestOvertimeModal.isOpen && (() => {
        const selectedOpObj = operarios.find((o) => o.id === requestOvertimeModal.operarioId);
        const eligibility = checkOvertimeEligibility(selectedOpObj, requestOvertimeModal.fecha);

        return (
          <Modal
            isOpen={requestOvertimeModal.isOpen}
            onClose={handleCloseRequestOvertimeModal}
            title="⏰ Solicitar Horas Extras para Colaborador"
          >
            <form onSubmit={handleSubmitOvertimeRequest}>
              <div className={styles.formGroup}>
                <Select
                  label="Colaborador"
                  value={requestOvertimeModal.operarioId}
                  onChange={(e) => setRequestOvertimeModal((prev) => ({ ...prev, operarioId: e.target.value }))}
                  required
                  options={operadoresDisponibles.map((op) => ({
                    value: op.id,
                    label: `${op.name} (${op.puesto || 'operario'})`,
                  }))}
                />
              </div>

              <div className={styles.formGroup}>
                <Input
                  type="date"
                  label="Fecha de las Horas Extras"
                  value={requestOvertimeModal.fecha}
                  onChange={(e) => setRequestOvertimeModal((prev) => ({ ...prev, fecha: e.target.value }))}
                  required
                />
              </div>

              {/* AVISO DE ELEGIBILIDAD / BLOQUEO POR FALTA U OTRA AUSENCIA */}
              {!eligibility.isEligible ? (
                <div
                  style={{
                    padding: '12px',
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    borderRadius: '8px',
                    border: '1px solid #fca5a5',
                    fontSize: '13px',
                    lineHeight: '1.4',
                    marginBottom: '16px',
                    fontWeight: 600,
                  }}
                >
                  {eligibility.reason}
                </div>
              ) : (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#f0fdf4',
                    color: '#166534',
                    borderRadius: '8px',
                    border: '1px solid #bbf7d0',
                    fontSize: '12px',
                    marginBottom: '16px',
                  }}
                >
                  ✅ Colaborador habilitado para solicitar tiempo extra el {requestOvertimeModal.fecha}.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className={styles.formGroup}>
                  <Select
                    label="Cantidad de Horas"
                    value={requestOvertimeModal.horas}
                    onChange={(e) => setRequestOvertimeModal((prev) => ({ ...prev, horas: e.target.value }))}
                    required
                    options={[
                      { value: '1', label: '1 hora extra' },
                      { value: '2', label: '2 horas extras' },
                      { value: '3', label: '3 horas extras' },
                      { value: '4', label: '4 horas extras' },
                    ]}
                  />
                </div>

                <div className={styles.formGroup}>
                  <Select
                    label="Bloque de Tiempo"
                    value={requestOvertimeModal.bloque}
                    onChange={(e) => setRequestOvertimeModal((prev) => ({ ...prev, bloque: e.target.value }))}
                    required
                    options={[
                      { value: 'vespertino', label: '🌆 Vespertino (Extensión de Salida)' },
                      { value: 'matutino', label: '🌅 Matutino (Entrada Anticipada)' },
                    ]}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Motivo / Tareas Asignadas</label>
                <textarea
                  className={styles.textarea}
                  rows="3"
                  required
                  placeholder="Especifica detalladamente las tareas que realizará en el tiempo extra..."
                  value={requestOvertimeModal.motivo}
                  onChange={(e) => setRequestOvertimeModal((prev) => ({ ...prev, motivo: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <Button type="button" variant="secondary" onClick={handleCloseRequestOvertimeModal}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={!eligibility.isEligible}>
                  Enviar a Revisión de Supervisor
                </Button>
              </div>
            </form>
          </Modal>
        );
      })()}

      {/* MODAL: MODIFICAR SOLICITUD DE HORAS EXTRAS */}
      {editOvertimeRequestModal.isOpen && editOvertimeRequestModal.solicitud && (() => {
        const sol = editOvertimeRequestModal.solicitud;
        const op = operarios.find((o) => o.id === sol.operarioId);
        const eligibility = checkOvertimeEligibility(op, editOvertimeRequestModal.fecha);

        return (
          <Modal
            isOpen={editOvertimeRequestModal.isOpen}
            onClose={handleCloseEditOvertimeRequestModal}
            title={`✏️ Modificar Solicitud de Horas Extras — ${sol.operarioName}`}
          >
            <form onSubmit={handleSaveEditOvertimeRequest}>
              <div className={styles.formGroup}>
                <Input
                  type="date"
                  label="Fecha de las Horas Extras"
                  value={editOvertimeRequestModal.fecha}
                  onChange={(e) => setEditOvertimeRequestModal((prev) => ({ ...prev, fecha: e.target.value }))}
                  required
                />
              </div>

              {!eligibility.isEligible && (
                <div
                  style={{
                    padding: '12px',
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    borderRadius: '8px',
                    border: '1px solid #fca5a5',
                    fontSize: '13px',
                    lineHeight: '1.4',
                    marginBottom: '16px',
                    fontWeight: 600,
                  }}
                >
                  {eligibility.reason}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className={styles.formGroup}>
                  <Select
                    label="Cantidad de Horas"
                    value={editOvertimeRequestModal.horas}
                    onChange={(e) => setEditOvertimeRequestModal((prev) => ({ ...prev, horas: e.target.value }))}
                    required
                    options={[
                      { value: '1', label: '1 hora extra' },
                      { value: '2', label: '2 horas extras' },
                      { value: '3', label: '3 horas extras' },
                      { value: '4', label: '4 horas extras' },
                    ]}
                  />
                </div>

                <div className={styles.formGroup}>
                  <Select
                    label="Bloque de Tiempo"
                    value={editOvertimeRequestModal.bloque}
                    onChange={(e) => setEditOvertimeRequestModal((prev) => ({ ...prev, bloque: e.target.value }))}
                    required
                    options={[
                      { value: 'vespertino', label: '🌆 Vespertino (Extensión de Salida)' },
                      { value: 'matutino', label: '🌅 Matutino (Entrada Anticipada)' },
                    ]}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Motivo / Tareas Asignadas</label>
                <textarea
                  className={styles.textarea}
                  rows="3"
                  required
                  value={editOvertimeRequestModal.motivo}
                  onChange={(e) => setEditOvertimeRequestModal((prev) => ({ ...prev, motivo: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <Button type="button" variant="secondary" onClick={handleCloseEditOvertimeRequestModal}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={!eligibility.isEligible}>
                  Guardar Cambios
                </Button>
              </div>
            </form>
          </Modal>
        );
      })()}
    </motion.div>
  );
};

export default ProduccionPage;
