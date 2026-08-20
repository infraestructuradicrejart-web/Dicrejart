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
import ItemAutocomplete from '../../components/ui/ItemAutocomplete';
import useToast from '../../hooks/useToast';
import useOperarios from '../../hooks/useOperarios';
import useProduccion from '../../hooks/useProduccion';
import useMateriales from '../../hooks/useMateriales';
import { isAreaBlockedBySequence, AREA_SEQUENCE_DEPENDENCIES, getFeederDependentAreaId } from '../../context/ProduccionContext';
import useProgressiveList from '../../hooks/useProgressiveList';
import useAuth from '../../hooks/useAuth';
import { isReadOnlySection, canAccessSection } from '../../utils/roleAccess';
import { getOvertimeBlocks, formatHourLabel, buildHalfHourOptions, buildOvertimeCountOptions } from '../../utils/overtimeUtils';
import { getTodayLocalDateStr, getOvertimeWeekRange } from '../../utils/dateUtils';
import { checkOvertimeEligibility } from '../../utils/overtimeRules';
import { ROLE_TYPES } from '../../data/usersData';
import { ESTADO_LABELS, ESTADO_ICONS, ESTADO_BADGE_VARIANT } from '../../data/estadoConfig';
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
    startAreaWork,
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
  const {
    solicitudesMateriales,
    solicitarMateriales,
    marcarMaterialesListos,
    confirmarRecepcionMateriales,
    rechazarSolicitudMateriales,
    cancelarSolicitudMateriales,
    modificarSolicitudMateriales,
    eliminarSolicitudMateriales,
  } = useMateriales();
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

  // Estado para el modal de "Solicitar Materiales a Almacén" (cualquier área que no sea
  // almacén) y para el modal de "Rechazar" que usa Almacén al atender una solicitud
  const [materialModal, setMaterialModal] = useState({
    isOpen: false,
    editingId: null,
    gameId: '',
    items: [{ name: '', itemId: null, quantity: 1, unit: 'pza' }],
    justification: '',
    priority: 'normal',
  });
  const [materialRejectModal, setMaterialRejectModal] = useState({
    isOpen: false,
    solicitudId: null,
    notes: '',
  });
  const [materialDeleteConfirm, setMaterialDeleteConfirm] = useState({
    isOpen: false,
    solicitudId: null,
    folio: null,
  });
  const [showMaterialesHistorial, setShowMaterialesHistorial] = useState(false);
  const [isExportingMaterialPdf, setIsExportingMaterialPdf] = useState(false);
  const [isExportingHorasExtraPdf, setIsExportingHorasExtraPdf] = useState(false);

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
   * Determina si el usuario puede atender (entregar/rechazar) solicitudes de materiales
   * como Almacén: el Encargado de Almacén, un Supervisor de Área que lo tenga entre sus
   * áreas, o Admin — mismo patrón que canReceiveExternalOrders arriba, pero para
   * 'almacen' en vez de 'producto-terminado'.
   */
  const canFulfillMaterialRequests = () => {
    if (!user) return false;
    if (user.roleType === ROLE_TYPES.ADMIN) return true;
    if (user.roleType === ROLE_TYPES.ENCARGADO_AREA) return user.areaId === 'almacen';
    if (user.roleType === ROLE_TYPES.SUPERVISOR_AREA) {
      return (user.areaIds || []).includes('almacen');
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

  const handleResetHorasExtraVerification = async (horasExtraId) => {
    const res = await verifyHorasExtra(horasExtraId, { verificationStatus: 'pendiente', verificationNotes: '' });
    if (!res.ok) { toast.danger(res.error || 'No se pudo restablecer la verificación.'); return; }
    toast.info('↩ Verificación de tiempo extra restablecida a pendiente.');
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
    // La fecha SIEMPRE arranca en hoy, nunca en op.schedule.authorizedDate (la última
    // fecha ya autorizada, que puede ser de días atrás) — si se dejara ese valor por
    // default, el supervisor podía guardar sin darse cuenta de que seguía apuntando a una
    // fecha vieja: authorizeOvertimeTasks sí crearía el registro (pero en esa fecha vieja,
    // invisible en "Tiempo Extra" de hoy) y updateOperarioSchedule se negaría a tocar el
    // horario visible (exige que la fecha sea exactamente hoy) — el guardado "funcionaba"
    // (toast de éxito) pero nada cambiaba en la tabla. Mismo criterio que overtimeTasks,
    // que también arranca vacío en vez de heredar el valor de la autorización anterior.
    const todayForModal = getTodayLocalDateStr();
    const prefilledStart = Number(op.schedule?.startHour || 8);
    const prefilledEnd = Number(op.schedule?.endHour || 18);
    // Si ya existe una autorización VIGENTE (no cancelada) de HOY para este colaborador,
    // se recupera su texto de tareas para no perderlo al redefinir el horario del día —
    // ej. se autorizó tiempo extra matutino en la mañana con su descripción, y en la
    // tarde surge la necesidad de extender también el bloque vespertino: guardar
    // (handleSaveSchedule) cancela esa autorización previa y crea una nueva combinada,
    // así que sin esto el texto de la mañana desaparecía en automático si no se le
    // ocurría al supervisor volver a escribirlo. No aplica a fechas viejas (op.schedule
    // puede traer la última autorización de días atrás, ver nota de abajo).
    const existingTodayHE = horasExtra.find(
      (h) => h.operarioId === op.id && h.authorizedDate === todayForModal && h.verificationStatus !== 'cancelado'
    );
    const inheritedTasks = existingTodayHE?.overtimeTasks || '';
    // Recalcula las horas extra para HOY (no reutiliza op.schedule.overtimeHours tal
    // cual): si hoy es sábado y la última autorización fue un día de semana (o viceversa),
    // el bloque vespertino máximo cambia, así que el número heredado podía ya no ser
    // válido para la fecha con la que en realidad se va a guardar.
    if (esFechaDomingo(todayForModal)) {
      setScheduleModal({
        isOpen: true, collaborator: op, startHour: '8', endHour: '18',
        overtimeHours: '10', authorizedDate: todayForModal, overtimeTasks: inheritedTasks,
      });
      return;
    }
    const { earlyHours, lateHours } = getOvertimeBlocks(prefilledStart, prefilledEnd, todayForModal);
    setScheduleModal({
      isOpen: true,
      collaborator: op,
      startHour: String(prefilledStart),
      endHour: String(prefilledEnd),
      overtimeHours: String(earlyHours + lateHours),
      authorizedDate: todayForModal,
      overtimeTasks: inheritedTasks,
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
    // Cambiar la fecha DENTRO del modal (para reprogramar otro día sin cerrarlo) antes
    // dejaba pegados el horario y las tareas de la fecha con la que se había abierto el
    // modal — solo se recalculaba `overtimeHours`, pero startHour/endHour/overtimeTasks
    // seguían siendo los de la fecha anterior. Si el supervisor no los tocaba a mano, la
    // nueva fecha se guardaba con el horario de la fecha vieja (ej. programó el 19 en la
    // mañana pero quedó con el horario vespertino que tenía el 18). Ahora, si ya existe una
    // autorización vigente para la fecha nueva, se recupera tal cual (para poder editarla);
    // si no existe, se reinicia a "sin tiempo extra" para forzar una elección deliberada.
    const existingHE = horasExtra.find(
      (h) => h.operarioId === scheduleModal.collaborator?.id && h.authorizedDate === dateStr && h.verificationStatus !== 'cancelado'
    );
    if (existingHE) {
      setScheduleModal((prev) => ({
        ...prev,
        authorizedDate: dateStr,
        startHour: String(existingHE.startHour),
        endHour: String(existingHE.endHour),
        overtimeHours: String(existingHE.overtimeHours),
        overtimeTasks: existingHE.overtimeTasks || '',
      }));
      return;
    }
    if (esFechaDomingo(dateStr)) {
      // Domingo es turno completo desde cero — se resetea a un turno normal (08:00-18:00)
      // en vez de arrastrar horas de bloque matutino/vespertino que no aplican aquí.
      setScheduleModal((prev) => ({ ...prev, authorizedDate: dateStr, startHour: '8', endHour: '18', overtimeHours: '10', overtimeTasks: '' }));
      return;
    }
    const newDefaultEnd = new Date(`${dateStr}T00:00:00`).getDay() === 6 ? 13 : 18;
    setScheduleModal((prev) => ({ ...prev, authorizedDate: dateStr, startHour: '8', endHour: String(newDefaultEnd), overtimeHours: '0', overtimeTasks: '' }));
  };

  const handleStartHourChange = (e) => {
    const startVal = Number(e.target.value);
    const endVal = Number(scheduleModal.endHour);
    if (esFechaDomingo(scheduleModal.authorizedDate)) {
      setScheduleModal((prev) => ({ ...prev, startHour: String(startVal), overtimeHours: String(Math.max(0, endVal - startVal)) }));
      return;
    }
    const { earlyHours, lateHours } = getOvertimeBlocks(startVal, endVal, scheduleModal.authorizedDate);
    setScheduleModal((prev) => ({ ...prev, startHour: String(startVal), overtimeHours: String(earlyHours + lateHours) }));
  };

  const handleEndHourChange = (e) => {
    const startVal = Number(scheduleModal.startHour);
    const endVal = Number(e.target.value);
    if (esFechaDomingo(scheduleModal.authorizedDate)) {
      setScheduleModal((prev) => ({ ...prev, endHour: String(endVal), overtimeHours: String(Math.max(0, endVal - startVal)) }));
      return;
    }
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
    startHour: '8',
    endHour: '18',
  });

  const [editOvertimeRequestModal, setEditOvertimeRequestModal] = useState({
    isOpen: false,
    solicitud: null,
    horas: '2',
    bloque: 'vespertino',
    motivo: '',
    fecha: '',
    startHour: '8',
    endHour: '18',
  });

  // Un domingo no es una extensión de la jornada base (8-18) — es un turno completo desde
  // cero, normalmente igual de largo que un día laboral normal. Al elegir una fecha
  // domingo, el formulario cambia solo de "bloque + cantidad de horas" a "hora de entrada
  // / hora de salida" del turno completo.
  const esFechaDomingo = (fechaStr) => Boolean(fechaStr) && new Date(`${fechaStr}T00:00:00`).getDay() === 0;

  const handleOpenRequestOvertimeModal = () => {
    const firstOp = operadoresDisponibles[0]?.id || '';
    const todayForModal = getTodayLocalDateStr();
    const esDomingo = esFechaDomingo(todayForModal);
    setRequestOvertimeModal({
      isOpen: true,
      operarioId: firstOp,
      fecha: todayForModal,
      horas: esDomingo ? '10' : '2',
      bloque: esDomingo ? 'domingo' : 'vespertino',
      motivo: '',
      startHour: '8',
      endHour: '18',
    });
  };

  const handleCloseRequestOvertimeModal = () => {
    setRequestOvertimeModal((prev) => ({ ...prev, isOpen: false }));
  };

  const handleRequestFechaChange = (e) => {
    const newFecha = e.target.value;
    const esDomingo = esFechaDomingo(newFecha);
    // startHour/endHour (solo aplican al bloque 'domingo') se reinician al cambiar de
    // fecha — de lo contrario, un domingo con horario ya capturado (ej. 8:00-15:00) se
    // quedaba pegado en el formulario al cambiar a OTRO domingo, y la solicitud se podía
    // enviar con el horario equivocado si no se ajustaba a mano (mismo tipo de error ya
    // corregido en el modal de autorización directa, ver handleDateChange).
    setRequestOvertimeModal((prev) => ({
      ...prev,
      fecha: newFecha,
      bloque: esDomingo ? 'domingo' : (prev.bloque === 'domingo' ? 'vespertino' : prev.bloque),
      startHour: '8',
      endHour: '18',
      horas: esDomingo ? '10' : prev.horas,
    }));
  };

  const handleRequestDomingoHourChange = (field) => (e) => {
    const value = e.target.value;
    setRequestOvertimeModal((prev) => {
      const next = { ...prev, [field]: value };
      next.horas = String(Math.max(0, Number(next.endHour) - Number(next.startHour)));
      return next;
    });
  };

  const handleSubmitOvertimeRequest = async (e) => {
    e.preventDefault();
    const { operarioId, fecha, horas, bloque, motivo, startHour, endHour } = requestOvertimeModal;
    if (!operarioId) {
      toast.warning('Selecciona un colaborador.');
      return;
    }
    if (bloque === 'domingo' && Number(endHour) <= Number(startHour)) {
      toast.danger('La hora de salida debe ser posterior a la hora de entrada.');
      return;
    }
    const res = await solicitarHorasExtra({ operarioId, fecha, horas: Number(horas), bloque, motivo, startHour, endHour });
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
      startHour: sol.bloque === 'domingo' ? String(sol.startHour ?? 8) : '8',
      endHour: sol.bloque === 'domingo' ? String(sol.endHour ?? 18) : '18',
    });
  };

  const handleCloseEditOvertimeRequestModal = () => {
    setEditOvertimeRequestModal((prev) => ({ ...prev, isOpen: false, solicitud: null }));
  };

  const handleEditRequestFechaChange = (e) => {
    const newFecha = e.target.value;
    const esDomingo = esFechaDomingo(newFecha);
    // Mismo motivo que handleRequestFechaChange: startHour/endHour se reinician al
    // cambiar de fecha, para no arrastrar el horario de domingo de la fecha anterior.
    setEditOvertimeRequestModal((prev) => ({
      ...prev,
      fecha: newFecha,
      bloque: esDomingo ? 'domingo' : (prev.bloque === 'domingo' ? 'vespertino' : prev.bloque),
      startHour: '8',
      endHour: '18',
      horas: esDomingo ? '10' : prev.horas,
    }));
  };

  const handleEditRequestDomingoHourChange = (field) => (e) => {
    const value = e.target.value;
    setEditOvertimeRequestModal((prev) => {
      const next = { ...prev, [field]: value };
      next.horas = String(Math.max(0, Number(next.endHour) - Number(next.startHour)));
      return next;
    });
  };

  const handleSaveEditOvertimeRequest = async (e) => {
    e.preventDefault();
    const { solicitud, horas, bloque, motivo, fecha, startHour, endHour } = editOvertimeRequestModal;
    if (!solicitud) return;
    if (bloque === 'domingo' && Number(endHour) <= Number(startHour)) {
      toast.danger('La hora de salida debe ser posterior a la hora de entrada.');
      return;
    }
    const res = await modificarSolicitudHoraExtra(solicitud.id, { horas: Number(horas), bloque, motivo, fecha, startHour, endHour });
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

  // Juegos de esta área listos para arrancar: ya no están bloqueados por secuencia (ej.
  // Herrería esperando a que Corte Láser complete su parte), todavía no llegan al 100%,
  // y nadie les ha dado el banderazo inicial — sin esta lista, la única forma de
  // enterarse de que un juego ya se desbloqueó era abrir el selector y leer el prefijo
  // de cada opción una por una.
  const readyToStartGames = useMemo(() => {
    if (areaId === 'producto-terminado') return [];
    return filteredJuegos.filter((j) => {
      const target = j.targetPieces?.[areaId] || 10;
      const produced = j.producedPieces?.[areaId] || 0;
      if (produced >= target) return false;
      if (isAreaBlockedBySequence(j, areaId)) return false;
      if (j.areaKickoff?.[areaId]) return false;
      return true;
    });
  }, [filteredJuegos, areaId]);

  // Revela la tabla de juegos asignados en tandas de 15 en vez de pintarla completa.
  const {
    visibleItems: visibleFilteredJuegos,
    hasMore: hasMoreFilteredJuegos,
    remaining: remainingFilteredJuegos,
    showMore: showMoreFilteredJuegos,
  } = useProgressiveList(filteredJuegos, { resetKey: areaId });

  // Operarios asignados temporal o permanentemente a esta área
  const operadoresDisponibles = operarios.filter((op) => op.currentArea === areaId);

  // Solicitudes de materiales a Almacén: las de ESTA área (para cualquier área) y, si
  // esta vista es la de Almacén, las de TODAS las áreas — separadas en "pendientes de
  // atender" (necesitan que Almacén las junte o rechace) vs "ya listas, esperando que
  // el área las recoja" (Almacén ya hizo su parte) vs historial (recibida/rechazada/cancelada)
  const misSolicitudesMateriales = useMemo(
    () => solicitudesMateriales.filter((s) => s.areaId === areaId),
    [solicitudesMateriales, areaId]
  );
  const solicitudesMaterialesPendientes = useMemo(
    () => (areaId === 'almacen' ? solicitudesMateriales.filter((s) => s.status === 'pendiente') : []),
    [solicitudesMateriales, areaId]
  );
  const solicitudesMaterialesListas = useMemo(
    () => (areaId === 'almacen' ? solicitudesMateriales.filter((s) => s.status === 'lista') : []),
    [solicitudesMateriales, areaId]
  );
  const solicitudesMaterialesResueltas = useMemo(
    () => (areaId === 'almacen' ? solicitudesMateriales.filter((s) => s.status === 'recibida' || s.status === 'rechazada' || s.status === 'cancelada') : []),
    [solicitudesMateriales, areaId]
  );

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

  /**
   * Marca el banderazo inicial de esta área para un juego — independiente de registrar
   * piezas, para poder medir cuánto tarda el área en completar su meta. Se usa tanto
   * desde el formulario (juego ya seleccionado) como desde la tarjeta "🎉 Juegos Listos
   * para Iniciar" (cualquier juego de la lista, sin necesidad de seleccionarlo primero);
   * en ese segundo caso además lo deja preseleccionado en el formulario de abajo, listo
   * para capturar piezas de inmediato.
   */
  const handleStartAreaWork = async (game) => {
    const targetGame = game || selectedGameObj;
    if (!targetGame) return;
    const res = await startAreaWork(targetGame.id, areaId);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo registrar el inicio de trabajo.');
      return;
    }
    if (game) {
      setNewLog((prev) => ({ ...prev, gameName: game.name }));
    }
    toast.success(`🚩 Inicio de trabajo registrado para "${targetGame.name}".`);
  };

  // ============================================
  // HANDLERS — SOLICITUD DE MATERIALES A ALMACÉN
  // ============================================

  const handleOpenMaterialModal = () => {
    setMaterialModal({
      isOpen: true,
      editingId: null,
      gameId: selectedGameObj?.id || '',
      items: [{ name: '', itemId: null, quantity: 1, unit: 'pza' }],
      justification: '',
      priority: 'normal',
    });
  };

  /**
   * Abre el mismo modal, pero para corregir y reenviar una solicitud ya RECHAZADA
   * (mismo folio, vuelve a 'pendiente' al guardar) — igual que "Corregir y Reenviar" en Compras.
   */
  const handleOpenEditMaterialModal = (sol) => {
    setMaterialModal({
      isOpen: true,
      editingId: sol.id,
      gameId: sol.gameId || '',
      items: sol.items.map((it) => ({ ...it })),
      justification: sol.justification,
      priority: sol.priority,
    });
  };

  const handleCloseMaterialModal = () => {
    setMaterialModal({
      isOpen: false,
      editingId: null,
      gameId: '',
      items: [{ name: '', itemId: null, quantity: 1, unit: 'pza' }],
      justification: '',
      priority: 'normal',
    });
  };

  const handleMaterialItemChange = (idx, field, value) => {
    setMaterialModal((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    }));
  };

  const handleAddMaterialItemRow = () => {
    setMaterialModal((prev) => ({ ...prev, items: [...prev.items, { name: '', itemId: null, quantity: 1, unit: 'pza' }] }));
  };

  const handleRemoveMaterialItemRow = (idx) => {
    setMaterialModal((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const handleSubmitMaterialRequest = async (e) => {
    e.preventDefault();
    const game = juegos.find((j) => j.id === materialModal.gameId);
    const payload = {
      items: materialModal.items,
      justification: materialModal.justification,
      priority: materialModal.priority,
      gameId: game?.id || null,
      gameName: game?.name || null,
    };
    const res = materialModal.editingId
      ? await modificarSolicitudMateriales(materialModal.editingId, payload)
      : await solicitarMateriales({ areaId, ...payload });
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo enviar la solicitud de materiales.');
      return;
    }
    toast.success(materialModal.editingId ? '📦 Solicitud corregida y reenviada a Almacén.' : '📦 Solicitud de materiales enviada a Almacén.');
    handleCloseMaterialModal();
  };

  const handleCancelMaterialRequest = async (solicitudId) => {
    const res = await cancelarSolicitudMateriales(solicitudId);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo cancelar la solicitud.');
      return;
    }
    toast.warning('Solicitud de materiales cancelada.');
  };

  const handleMarkMaterialReady = async (solicitudId) => {
    const res = await marcarMaterialesListos(solicitudId);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo marcar como listo.');
      return;
    }
    toast.success('✅ Materiales marcados como listos para recoger.');
  };

  const handleConfirmMaterialReceipt = async (solicitudId) => {
    const res = await confirmarRecepcionMateriales(solicitudId);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo confirmar la recepción.');
      return;
    }
    toast.success('📥 Recepción de materiales confirmada.');
  };

  const handleOpenMaterialRejectModal = (solicitudId) => {
    setMaterialRejectModal({ isOpen: true, solicitudId, notes: '' });
  };

  const handleCloseMaterialRejectModal = () => {
    setMaterialRejectModal({ isOpen: false, solicitudId: null, notes: '' });
  };

  const handleSubmitMaterialReject = async (e) => {
    e.preventDefault();
    const res = await rechazarSolicitudMateriales(materialRejectModal.solicitudId, materialRejectModal.notes);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo rechazar la solicitud.');
      return;
    }
    toast.warning('❌ Solicitud de materiales rechazada.');
    handleCloseMaterialRejectModal();
  };

  const handleOpenMaterialDeleteConfirm = (sol) => {
    setMaterialDeleteConfirm({ isOpen: true, solicitudId: sol.id, folio: sol.folio });
  };

  const handleCloseMaterialDeleteConfirm = () => {
    setMaterialDeleteConfirm({ isOpen: false, solicitudId: null, folio: null });
  };

  const handleConfirmDeleteMaterial = async () => {
    const res = await eliminarSolicitudMateriales(materialDeleteConfirm.solicitudId);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo eliminar la solicitud.');
      return;
    }
    toast.success('🗑️ Solicitud de materiales eliminada.');
    handleCloseMaterialDeleteConfirm();
  };

  /**
   * Texto legible del tiempo entre que se creó la solicitud y Almacén respondió
   * (marcó lista o rechazó) — para poder medir qué tan rápido responde Almacén.
   */
  const formatResponseTime = (createdAt, reviewedAt) => {
    if (!createdAt || !reviewedAt) return null;
    const ms = new Date(reviewedAt) - new Date(createdAt);
    if (ms < 0) return null;
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    if (hours < 24) return `${hours}h ${remMinutes}min`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  };

  /**
   * Exporta una solicitud de materiales a PDF, mismo estilo de marca que las
   * requisiciones de Compras (logo, caja de folio/fecha, tabla, bitácora, firmas) pero
   * simplificado al flujo de 2 pasos de materiales (sin pago/proveedor/adjuntos).
   */
  const handleExportMaterialPdf = async (sol) => {
    setIsExportingMaterialPdf(true);
    try {
      const areaName = AREAS_CONFIG.find((a) => a.id === sol.areaId)?.name || sol.areaId;
      const { default: jsPDF } = await import('jspdf');
      const { rasterizeImage, brandShapeToDataUrl, logoUrl } = await import('../../utils/pdfBranding');

      const MARGIN = 14;
      const WIDTH = 182;
      const SECONDARY = [51, 0, 102];
      const PRIMARY = [255, 51, 0];
      const PRINCETON_ORANGE = '#FF9933';
      const BORDER = [209, 213, 219];
      const STRIPE = [243, 244, 246];
      const DARK = [27, 27, 27];
      const GRAY = [107, 114, 128];

      const [logoImg, ringImg] = await Promise.all([
        rasterizeImage(logoUrl),
        rasterizeImage(brandShapeToDataUrl('anillo', PRINCETON_ORANGE, 1)),
      ]);

      const doc = new jsPDF();
      const folioLabel = sol.folio ? `MAT-${String(sol.folio).padStart(4, '0')}` : sol.id;

      const logoH = 15;
      const logoW = logoH * (logoImg.width / logoImg.height);
      doc.addImage(logoImg.dataUrl, 'PNG', MARGIN, 8, logoW, logoH);

      const boxX = MARGIN + WIDTH - 60;
      doc.setDrawColor(...BORDER);
      doc.rect(boxX, 9, 60, 20);
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...SECONDARY);
      doc.text('SOLICITUD DE MATERIALES', boxX + 30, 15, { align: 'center' });
      doc.setFont(undefined, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      doc.text(`Folio: ${folioLabel}`, boxX + 30, 21, { align: 'center' });
      doc.text(`Fecha: ${new Date(sol.createdAt).toLocaleString('es-MX')}`, boxX + 30, 26, { align: 'center' });

      doc.setDrawColor(...PRIMARY);
      doc.setLineWidth(1);
      doc.line(MARGIN, 33, MARGIN + WIDTH, 33);
      doc.setLineWidth(0.2);

      const sectionTitle = (text, titleY) => {
        doc.addImage(ringImg.dataUrl, 'PNG', MARGIN, titleY - 4, 4.5, 4.5 * (ringImg.height / ringImg.width));
        doc.setFont(undefined, 'bold');
        doc.setTextColor(...SECONDARY);
        doc.text(text, MARGIN + 7, titleY);
      };
      let y = 40;
      const gridRowH = 8;
      const responseTime = formatResponseTime(sol.createdAt, sol.reviewedAt);

      const gridRows = [
        [`Área Solicitante: ${areaName}`, `Prioridad: ${sol.priority === 'urgente' ? 'Urgente' : 'Normal'}`],
        [`Solicitó: ${sol.requestedBy || '—'}`, `Estado Actual: ${MATERIAL_STATUS_BADGE[sol.status]?.label || sol.status}`],
        [`Juego: ${sol.gameName || 'Sin vincular'}`, `Tiempo de Respuesta de Almacén: ${responseTime || 'Pendiente'}`],
      ];
      doc.setFontSize(8.5);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...DARK);
      gridRows.forEach((row, i) => {
        const rowY = y + i * gridRowH;
        doc.setDrawColor(...BORDER);
        doc.rect(MARGIN, rowY, WIDTH, gridRowH);
        doc.line(MARGIN + WIDTH / 2, rowY, MARGIN + WIDTH / 2, rowY + gridRowH);
        doc.text(row[0], MARGIN + 3, rowY + gridRowH - 2.8, { maxWidth: WIDTH / 2 - 6 });
        doc.text(row[1], MARGIN + WIDTH / 2 + 3, rowY + gridRowH - 2.8, { maxWidth: WIDTH / 2 - 6 });
      });
      y += gridRows.length * gridRowH + 6;

      sectionTitle('Materiales Solicitados', y);
      y += 5;

      const colWidths = [110, 36, 36];
      const tableHeaders = ['Material', 'Cantidad', 'Unidad'];
      const rowH = 7;
      doc.setFillColor(...SECONDARY);
      doc.rect(MARGIN, y, WIDTH, rowH, 'F');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      let cx = MARGIN;
      tableHeaders.forEach((h, i) => {
        doc.text(h, cx + 3, y + rowH - 2.3);
        cx += colWidths[i];
      });
      y += rowH;

      doc.setFont(undefined, 'normal');
      doc.setFontSize(9);
      sol.items.forEach((it, idx) => {
        if (idx % 2 === 1) {
          doc.setFillColor(...STRIPE);
          doc.rect(MARGIN, y, WIDTH, rowH, 'F');
        }
        doc.setDrawColor(...BORDER);
        doc.rect(MARGIN, y, WIDTH, rowH);
        doc.line(MARGIN + colWidths[0], y, MARGIN + colWidths[0], y + rowH);
        doc.line(MARGIN + colWidths[0] + colWidths[1], y, MARGIN + colWidths[0] + colWidths[1], y + rowH);
        doc.setTextColor(...DARK);
        doc.text(String(it.name), MARGIN + 3, y + rowH - 2.3, { maxWidth: colWidths[0] - 6 });
        doc.text(String(it.quantity), MARGIN + colWidths[0] + 3, y + rowH - 2.3);
        doc.text(String(it.unit), MARGIN + colWidths[0] + colWidths[1] + 3, y + rowH - 2.3);
        y += rowH;
      });
      y += 8;

      sectionTitle('Justificación', y);
      y += 5;
      const justificationLines = doc.splitTextToSize(sol.justification || '—', WIDTH - 8);
      const justBoxH = Math.max(justificationLines.length * 4.5 + 6, 12);
      doc.setDrawColor(...BORDER);
      doc.rect(MARGIN, y, WIDTH, justBoxH);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...DARK);
      doc.text(justificationLines, MARGIN + 4, y + 5.5);
      y += justBoxH + 8;

      const seguimientoLines = [];
      seguimientoLines.push(`- Paso 1 (Solicitud): Registrada por ${sol.requestedBy || '—'} el ${new Date(sol.createdAt).toLocaleString('es-MX')}`);
      if (sol.status === 'rechazada' && sol.reviewedBy) {
        seguimientoLines.push(`- Paso 2 (Respuesta de Almacén): RECHAZADA por ${sol.reviewedBy} el ${new Date(sol.reviewedAt).toLocaleString('es-MX')}`);
        if (sol.reviewNotes) seguimientoLines.push(`  Motivo: ${sol.reviewNotes}`);
      } else if (sol.reviewedBy) {
        seguimientoLines.push(`- Paso 2 (Respuesta de Almacén): LISTA PARA RECOGER, preparada por ${sol.reviewedBy} el ${new Date(sol.reviewedAt).toLocaleString('es-MX')}`);
      } else {
        seguimientoLines.push(`- Paso 2 (Respuesta de Almacén): [PENDIENTE]`);
      }
      if (sol.status === 'recibida' && sol.receivedBy) {
        seguimientoLines.push(`- Paso 3 (Recepción): CONFIRMADA por ${sol.receivedBy} el ${new Date(sol.receivedAt).toLocaleString('es-MX')}`);
      } else if (sol.status === 'lista') {
        seguimientoLines.push(`- Paso 3 (Recepción): [PENDIENTE DE QUE EL ÁREA CONFIRME]`);
      }

      if (y > 245) {
        doc.addPage();
        y = 20;
      }
      sectionTitle('Bitácora', y);
      y += 5;
      const seguimientoWrapped = seguimientoLines.flatMap((line) => doc.splitTextToSize(line, WIDTH - 8));
      const segBoxH = Math.max(seguimientoWrapped.length * 4.5 + 6, 16);
      doc.setDrawColor(...BORDER);
      doc.rect(MARGIN, y, WIDTH, segBoxH);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text(seguimientoWrapped, MARGIN + 4, y + 5);
      y += segBoxH + 8;

      doc.setFont(undefined, 'normal');
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(`Generado el ${new Date().toLocaleString('es-MX')} por ${user?.name || 'Usuario'} — Sistema Dicrejart`, MARGIN, 290);

      doc.save(`Solicitud-Materiales_${folioLabel}_${areaName.replace(/\s+/g, '-')}.pdf`);
    } catch (error) {
      console.error('Error al generar el PDF de la solicitud de materiales:', error);
      toast.danger('No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setIsExportingMaterialPdf(false);
    }
  };

  /**
   * Exporta a PDF las horas extra autorizadas de ESTA área en la semana de horas extra en
   * curso (jueves a miércoles, ver getOvertimeWeekRange) — con fines de control para el
   * supervisor/encargado del área. Solo incluye horario autorizado y total de horas (no
   * correcciones de horario real ni verificación de cumplimiento).
   */
  const handleExportHorasExtraAreaPdf = async () => {
    setIsExportingHorasExtraPdf(true);
    try {
      const { start, end } = getOvertimeWeekRange();
      const areaRecords = horasExtra
        .filter((h) => h.areaId === areaId && h.authorizedDate >= start && h.authorizedDate <= end && h.verificationStatus !== 'cancelado')
        .sort((a, b) => (a.authorizedDate === b.authorizedDate
          ? String(a.operarioName).localeCompare(String(b.operarioName))
          : a.authorizedDate.localeCompare(b.authorizedDate)));

      const { default: jsPDF } = await import('jspdf');
      const { rasterizeImage, logoUrl } = await import('../../utils/pdfBranding');

      const MARGIN = 14;
      const WIDTH = 182;
      const SECONDARY = [51, 0, 102];
      const PRIMARY = [255, 51, 0];
      const BORDER = [209, 213, 219];
      const STRIPE = [243, 244, 246];
      const DARK = [27, 27, 27];

      const logoImg = await rasterizeImage(logoUrl);

      const doc = new jsPDF();
      const areaName = activeArea?.name || areaId;

      const drawHeader = () => {
        const logoH = 15;
        const logoW = logoH * (logoImg.width / logoImg.height);
        doc.addImage(logoImg.dataUrl, 'PNG', MARGIN, 8, logoW, logoH);

        const boxX = MARGIN + WIDTH - 70;
        doc.setDrawColor(...BORDER);
        doc.rect(boxX, 9, 70, 20);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...SECONDARY);
        doc.text('HORAS EXTRA AUTORIZADAS', boxX + 35, 15, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...DARK);
        doc.text(`Área: ${areaName}`, boxX + 35, 21, { align: 'center' });
        doc.text(`Semana: ${start} al ${end}`, boxX + 35, 26, { align: 'center' });

        doc.setDrawColor(...PRIMARY);
        doc.setLineWidth(1);
        doc.line(MARGIN, 33, MARGIN + WIDTH, 33);
        doc.setLineWidth(0.2);
      };

      // Colaborador y Autorizó son las únicas columnas con texto de largo variable (nombres
      // de personas) — el resto siempre cabe en una línea. FONT_SIZE/LINE_H/MIN_ROW_H
      // están calibrados para que, si un nombre necesita más de una línea, la fila crezca
      // en vez de que la segunda línea se encime con la fila de abajo (lo que se veía como
      // "nombres cortados").
      const colWidths = [20, 56, 22, 32, 14, 38];
      const headers = ['Fecha', 'Colaborador', 'Bloque', 'Horario', 'Horas', 'Autorizó'];
      const FONT_SIZE = 8;
      const LINE_H = 4;
      const MIN_ROW_H = 8;
      const TOP_PAD = 5.3;

      const drawTableHeader = (yPos) => {
        doc.setFillColor(...SECONDARY);
        doc.rect(MARGIN, yPos, WIDTH, MIN_ROW_H, 'F');
        doc.setFont(undefined, 'bold');
        doc.setFontSize(FONT_SIZE);
        doc.setTextColor(255, 255, 255);
        let cx = MARGIN;
        headers.forEach((h, i) => {
          doc.text(h, cx + 2, yPos + TOP_PAD);
          cx += colWidths[i];
        });
        return yPos + MIN_ROW_H;
      };

      const describeBloque = (h) => {
        if (h.authorizedDate && new Date(`${h.authorizedDate}T00:00:00`).getDay() === 0) return 'Domingo';
        const { earlyHours, lateHours } = getOvertimeBlocks(h.startHour, h.endHour, h.authorizedDate);
        if (earlyHours > 0 && lateHours > 0) return 'Mat. + Vesp.';
        if (earlyHours > 0) return 'Matutino';
        if (lateHours > 0) return 'Vespertino';
        return '—';
      };

      drawHeader();
      let y = drawTableHeader(42);

      doc.setFont(undefined, 'normal');
      doc.setFontSize(FONT_SIZE);
      let totalHoras = 0;

      if (areaRecords.length === 0) {
        doc.setDrawColor(...BORDER);
        doc.rect(MARGIN, y, WIDTH, MIN_ROW_H);
        doc.setTextColor(...DARK);
        doc.text('No se autorizaron horas extra en esta área durante la semana en curso.', MARGIN + 2, y + TOP_PAD);
        y += MIN_ROW_H;
      }

      areaRecords.forEach((h, idx) => {
        const nameLines = doc.splitTextToSize(String(h.operarioName || '—'), colWidths[1] - 4);
        const authLines = doc.splitTextToSize(String(h.authorizedBy || '—'), colWidths[5] - 4);
        const linesNeeded = Math.max(nameLines.length, authLines.length, 1);
        const currentRowH = Math.max(MIN_ROW_H, TOP_PAD + (linesNeeded - 1) * LINE_H + 3);

        if (y + currentRowH > 280) {
          doc.addPage();
          drawHeader();
          y = drawTableHeader(42);
          doc.setFont(undefined, 'normal');
          doc.setFontSize(FONT_SIZE);
        }
        if (idx % 2 === 1) {
          doc.setFillColor(...STRIPE);
          doc.rect(MARGIN, y, WIDTH, currentRowH, 'F');
        }
        doc.setDrawColor(...BORDER);
        doc.rect(MARGIN, y, WIDTH, currentRowH);
        let cx = MARGIN;
        colWidths.forEach((w) => {
          cx += w;
          doc.line(cx, y, cx, y + currentRowH);
        });

        doc.setTextColor(...DARK);
        cx = MARGIN;
        doc.text(h.authorizedDate || '—', cx + 2, y + TOP_PAD); cx += colWidths[0];
        doc.text(nameLines, cx + 2, y + TOP_PAD); cx += colWidths[1];
        doc.text(describeBloque(h), cx + 2, y + TOP_PAD); cx += colWidths[2];
        doc.text(`${formatHourLabel(h.startHour)}-${formatHourLabel(h.endHour)}`, cx + 2, y + TOP_PAD); cx += colWidths[3];
        doc.text(String(h.overtimeHours ?? '—'), cx + 2, y + TOP_PAD); cx += colWidths[4];
        doc.text(authLines, cx + 2, y + TOP_PAD);
        y += currentRowH;
        totalHoras += Number(h.overtimeHours) || 0;
      });

      if (y + MIN_ROW_H > 280) {
        doc.addPage();
        drawHeader();
        y = 42;
      }
      doc.setFillColor(...STRIPE);
      doc.rect(MARGIN, y, WIDTH, MIN_ROW_H, 'F');
      doc.setDrawColor(...BORDER);
      doc.rect(MARGIN, y, WIDTH, MIN_ROW_H);
      doc.setFont(undefined, 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...SECONDARY);
      doc.text(`Total: ${totalHoras}h en ${areaRecords.length} autorización(es)`, MARGIN + 2, y + TOP_PAD);
      y += MIN_ROW_H + 8;

      doc.setFont(undefined, 'normal');
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(`Generado el ${new Date().toLocaleString('es-MX')} por ${user?.name || 'Usuario'} — Sistema Dicrejart`, MARGIN, 290);

      doc.save(`HorasExtra_${areaName.replace(/\s+/g, '-')}_${start}_a_${end}.pdf`);
    } catch (error) {
      console.error('Error al generar el PDF de horas extra del área:', error);
      toast.danger('No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setIsExportingHorasExtraPdf(false);
    }
  };

  const MATERIAL_STATUS_BADGE = {
    pendiente: { variant: 'warning', label: 'Pendiente' },
    lista: { variant: 'primary', label: 'Lista para Recoger' },
    recibida: { variant: 'success', label: 'Recibida' },
    rechazada: { variant: 'danger', label: 'Rechazada' },
    cancelada: { variant: 'neutral', label: 'Cancelada' },
  };

  /** Folio legible: MAT-0001 si ya tiene folio consecutivo, o el id viejo si no (registros de antes de este cambio). */
  const formatMaterialFolio = (s) => (s.folio ? `MAT-${String(s.folio).padStart(4, '0')}` : s.id);

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

          {!isReadOnly && readyToStartGames.length > 0 && (
            <motion.div variants={itemVariants} style={{ marginBottom: 'var(--space-4)' }}>
              <Card variant="success">
                <h3 className={styles.sectionTitle}>🎉 Juegos Listos para Iniciar ({readyToStartGames.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                  {readyToStartGames.map((j) => (
                    <div
                      key={j.id}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                        padding: '8px 12px', background: 'rgba(16, 185, 129, 0.06)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)',
                      }}
                    >
                      <div>
                        <strong>{j.name}</strong>
                        <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--color-gray-600)' }}>Proyecto: {j.projectName}</span>
                      </div>
                      <Button type="button" variant="primary" size="sm" onClick={() => handleStartAreaWork(j)}>
                        🚩 Iniciar Trabajo
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}

          {/* ============================================
              SOLICITUD DE MATERIALES A ALMACÉN
              ============================================ */}
          {areaId === 'almacen' ? (
            canFulfillMaterialRequests() && (
              <motion.div variants={itemVariants} style={{ marginBottom: 'var(--space-4)' }}>
                <Card variant="default">
                  <h3 className={styles.sectionTitle}>📦 Solicitudes de Materiales Pendientes ({solicitudesMaterialesPendientes.length})</h3>
                  {solicitudesMaterialesPendientes.length === 0 ? (
                    <p style={{ fontSize: '13px', color: 'var(--color-gray-500)', textAlign: 'center', padding: '16px' }}>
                      No hay solicitudes de materiales pendientes de otras áreas.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
                      {solicitudesMaterialesPendientes.map((s) => (
                        <div key={s.id} style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(255, 153, 51, 0.08)', border: '1px solid rgba(255, 153, 51, 0.25)', fontSize: '13px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', marginBottom: '4px' }}>
                            <strong>{formatMaterialFolio(s)} — {AREAS_CONFIG.find((a) => a.id === s.areaId)?.name || s.areaId}</strong>
                            {s.priority === 'urgente' && <Badge variant="danger">🔥 Urgente</Badge>}
                          </div>
                          <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
                            {s.items.map((it, idx) => (
                              <li key={idx}>{it.quantity} {it.unit} — {it.name}</li>
                            ))}
                          </ul>
                          <div style={{ color: 'var(--color-gray-600)', marginBottom: '4px' }}>
                            <em>{s.justification}</em>
                            {s.gameName && <span> — Juego: <strong>{s.gameName}</strong></span>}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginBottom: '8px' }}>
                            Solicitó {s.requestedBy} el {new Date(s.createdAt).toLocaleString('es-MX')}
                          </div>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <Button type="button" variant="primary" size="sm" onClick={() => handleMarkMaterialReady(s.id)}>
                              ✅ Marcar Listo para Recoger
                            </Button>
                            <Button type="button" variant="secondary" size="sm" onClick={() => handleOpenMaterialRejectModal(s.id)}>
                              ❌ Rechazar
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleExportMaterialPdf(s)} isLoading={isExportingMaterialPdf}>
                              📄 PDF
                            </Button>
                            {user?.roleType === ROLE_TYPES.ADMIN && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenMaterialDeleteConfirm(s)} style={{ color: 'var(--color-danger)' }}>
                                🗑️
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {solicitudesMaterialesListas.length > 0 && (
                    <div style={{ marginTop: '16px' }}>
                      <h4 style={{ fontSize: '13px', color: 'var(--color-secondary)', marginBottom: '8px' }}>
                        🚚 Listas, Esperando que las Recojan ({solicitudesMaterialesListas.length})
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {solicitudesMaterialesListas.map((s) => (
                          <div key={s.id} style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(0, 153, 204, 0.06)', border: '1px solid rgba(0, 153, 204, 0.2)', fontSize: '12px' }}>
                            <strong>{formatMaterialFolio(s)} — {AREAS_CONFIG.find((a) => a.id === s.areaId)?.name || s.areaId}</strong>
                            <span style={{ color: 'var(--color-gray-600)' }}> — {s.items.map((it) => it.name).join(', ')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {solicitudesMaterialesResueltas.length > 0 && (
                    <div style={{ marginTop: '16px' }}>
                      <button
                        type="button"
                        onClick={() => setShowMaterialesHistorial((prev) => !prev)}
                        style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        {showMaterialesHistorial ? '▲' : '▼'} Historial ({solicitudesMaterialesResueltas.length})
                      </button>
                      {showMaterialesHistorial && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                          {solicitudesMaterialesResueltas.map((s) => {
                            const responseTime = formatResponseTime(s.createdAt, s.reviewedAt);
                            return (
                            <div key={s.id} style={{ padding: '8px 10px', borderRadius: '6px', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', fontSize: '12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                                <strong>{formatMaterialFolio(s)} — {AREAS_CONFIG.find((a) => a.id === s.areaId)?.name || s.areaId}</strong>
                                <Badge variant={MATERIAL_STATUS_BADGE[s.status]?.variant || 'neutral'}>
                                  {MATERIAL_STATUS_BADGE[s.status]?.label || s.status}
                                </Badge>
                              </div>
                              <div style={{ color: 'var(--color-gray-600)' }}>{s.items.map((it) => it.name).join(', ')}</div>
                              {s.reviewNotes && <div style={{ color: 'var(--color-gray-500)' }}>Motivo: {s.reviewNotes}</div>}
                              {responseTime && <div style={{ color: 'var(--color-gray-500)' }}>⏱️ Respondido en {responseTime}</div>}
                              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  onClick={() => handleExportMaterialPdf(s)}
                                  style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                >
                                  📄 PDF
                                </button>
                                {user?.roleType === ROLE_TYPES.ADMIN && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenMaterialDeleteConfirm(s)}
                                    style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                  >
                                    🗑️ Eliminar
                                  </button>
                                )}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </motion.div>
            )
          ) : (
            !isReadOnly && (
              <motion.div variants={itemVariants} style={{ marginBottom: 'var(--space-4)' }}>
                <Card variant="default">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <h3 className={styles.sectionTitle} style={{ margin: 0 }}>📦 Materiales de Almacén</h3>
                    <Button type="button" variant="secondary" size="sm" onClick={handleOpenMaterialModal}>
                      📦 Solicitar Materiales a Almacén
                    </Button>
                  </div>
                  {misSolicitudesMateriales.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      {misSolicitudesMateriales.map((s) => {
                        const responseTime = formatResponseTime(s.createdAt, s.reviewedAt);
                        return (
                        <div key={s.id} style={{ padding: '8px 10px', borderRadius: '6px', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', fontSize: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                            <strong>{formatMaterialFolio(s)}</strong>
                            <Badge variant={MATERIAL_STATUS_BADGE[s.status]?.variant || 'neutral'}>
                              {MATERIAL_STATUS_BADGE[s.status]?.label || s.status}
                            </Badge>
                          </div>
                          <div>{s.items.map((it) => `${it.quantity} ${it.unit} ${it.name}`).join(', ')}</div>
                          <div style={{ color: 'var(--color-gray-500)', fontSize: '11px' }}>
                            {new Date(s.createdAt).toLocaleString('es-MX')}
                          </div>
                          {s.status === 'rechazada' && s.reviewNotes && (
                            <div style={{ color: 'var(--color-alert)', marginTop: '4px' }}>Motivo del rechazo: {s.reviewNotes}</div>
                          )}
                          {responseTime && <div style={{ color: 'var(--color-gray-500)', marginTop: '2px' }}>⏱️ Respondido en {responseTime}</div>}
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '6px', alignItems: 'center' }}>
                            {s.status === 'pendiente' && (
                              <button
                                type="button"
                                onClick={() => handleCancelMaterialRequest(s.id)}
                                style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-gray-500)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                              >
                                Cancelar solicitud
                              </button>
                            )}
                            {s.status === 'rechazada' && (
                              <Button type="button" variant="secondary" size="sm" onClick={() => handleOpenEditMaterialModal(s)}>
                                ✏️ Corregir y Reenviar
                              </Button>
                            )}
                            {s.status === 'lista' && (
                              <Button type="button" variant="primary" size="sm" onClick={() => handleConfirmMaterialReceipt(s.id)}>
                                📥 Confirmar Recepción
                              </Button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleExportMaterialPdf(s)}
                              style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                            >
                              📄 PDF
                            </button>
                            {user?.roleType === ROLE_TYPES.ADMIN && (
                              <button
                                type="button"
                                onClick={() => handleOpenMaterialDeleteConfirm(s)}
                                style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                              >
                                🗑️ Eliminar
                              </button>
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </motion.div>
            )
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
                      options={filteredJuegos.map((g) => ({
                        value: g.name,
                        label: `${g.name} (${g.projectName})`,
                      }))}
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
                        ) : selectedGameObj.areaKickoff?.[areaId] ? (
                          <div className={styles.bannerInfo}>
                            <strong>🚩 Trabajo Iniciado:</strong>
                            <span>
                              Iniciado el <strong>{new Date(selectedGameObj.areaKickoff[areaId].startedAt).toLocaleString('es-MX')}</strong> por{' '}
                              <strong>{selectedGameObj.areaKickoff[areaId].startedBy}</strong>. Aún no se han registrado piezas de la meta de{' '}
                              <strong>{targetPiecesForArea}</strong>.
                            </span>
                          </div>
                        ) : (
                          <div className={styles.bannerInfo}>
                            <strong>💤 Sin Iniciar:</strong>
                            <span>Aún no se han registrado piezas de la meta de <strong>{targetPiecesForArea}</strong>.</span>
                            <div style={{ marginTop: '8px' }}>
                              <Button type="button" variant="secondary" size="sm" onClick={() => handleStartAreaWork()}>
                                🚩 Iniciar Trabajo en este Juego
                              </Button>
                            </div>
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
              onClick={handleExportHorasExtraAreaPdf}
              isLoading={isExportingHorasExtraPdf}
              title="Descarga las horas extra autorizadas de esta área en la semana en curso (jueves a miércoles)"
            >
              📄 Exportar Horas Extra (PDF)
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
                // op.schedule NO se limpia al pasar el día — sigue trayendo lo último que
                // se autorizó aunque haya sido hace una semana. Por eso el horario propio
                // (startHour/endHour) solo se muestra si esa autorización es de HOY
                // (hasOvertimeToday); si no, se muestra el horario base, igual que ya hace
                // OperariosPage.jsx — antes se mostraba el valor guardado sin importar su
                // fecha, dejando un horario viejo pegado como si fuera el de hoy.
                const isSatToday = new Date().getDay() === 6;
                const defaultEndToday = isSatToday ? 13 : 18;
                const todayStrProd = getTodayLocalDateStr();
                const opRecentHEs = horasExtra.filter(
                  (h) => h.operarioId === op.id && h.authorizedDate === todayStrProd && h.verificationStatus !== 'cancelado'
                );
                const activeTodayHE = opRecentHEs[0];
                const isOpActive = !op.estado?.tipo || op.estado.tipo === 'activo';
                const hasOvertimeToday = isOpActive && (Boolean(activeTodayHE) || (op.schedule?.overtimeHours > 0 && op.schedule?.authorizedDate === todayStrProd));
                const effectiveStartHour = activeTodayHE ? activeTodayHE.startHour : (hasOvertimeToday ? op.schedule.startHour : 8);
                const effectiveEndHour = activeTodayHE ? activeTodayHE.endHour : (hasOvertimeToday ? op.schedule.endHour : defaultEndToday);
                const effectiveOvertimeHours = activeTodayHE ? activeTodayHE.overtimeHours : (hasOvertimeToday ? op.schedule.overtimeHours : 0);

                const startStr = formatHourLabel(hasOvertimeToday ? effectiveStartHour : 8);
                const endStr = formatHourLabel(hasOvertimeToday ? effectiveEndHour : defaultEndToday);
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong>{op.name || 'Sin Nombre'}</strong>
                        {op.estado?.tipo && op.estado.tipo !== 'activo' && (
                          <Badge variant={ESTADO_BADGE_VARIANT[op.estado.tipo] || 'danger'} size="sm">
                            {ESTADO_ICONS[op.estado.tipo] || '🚫'} {ESTADO_LABELS[op.estado.tipo] || 'Ausente'}
                          </Badge>
                        )}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                        ⏰ {startStr} - {endStr}
                        {op.currentArea !== op.homeArea && ' (prestado)'}
                      </span>
                      {hasOvertimeToday && (
                        <Badge variant="warning" size="sm" style={{ width: 'fit-content' }}>
                          +{effectiveOvertimeHours}h Extra hoy
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
                                  {esFechaDomingo(h.authorizedDate) ? (
                                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: '#fdf2f8', color: '#9d174d', border: '1px solid #fbcfe8' }}>
                                      📅 Domingo Completo: {h.overtimeHours}h ({formatHourLabel(h.startHour)}-{formatHourLabel(h.endHour)})
                                    </span>
                                  ) : (
                                    <>
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
                                    </>
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
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '2px' }}>
                                      <span
                                        title={h.verificationNotes ? `${h.verificationNotes} — ${h.verifiedBy}` : h.verifiedBy}
                                        style={{
                                          fontSize: '10.5px', fontWeight: 700,
                                          color: h.verificationStatus === 'cumplido' ? '#15803d' : 'var(--color-alert)',
                                        }}
                                      >
                                        {h.verificationStatus === 'cumplido' ? '✅ Cumplido' : '❌ No Cumplido'} — {h.verifiedBy}
                                      </span>
                                      {h.verificationStatus === 'no_cumplido' && (
                                        <button
                                          type="button"
                                          onClick={() => handleVerifyHorasExtraCumplido(h.id)}
                                          style={{ fontSize: '10px', fontWeight: 600, color: '#15803d', background: 'none', border: '1px solid #15803d', borderRadius: '4px', padding: '1px 5px', cursor: 'pointer' }}
                                          title="Cambiar a Cumplió (en caso de error)"
                                        >
                                          🔄 Cambiar a Cumplió
                                        </button>
                                      )}
                                      {h.verificationStatus === 'cumplido' && (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenHorasExtraRejectModal(h.id)}
                                          style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-alert)', background: 'none', border: '1px solid var(--color-alert)', borderRadius: '4px', padding: '1px 5px', cursor: 'pointer' }}
                                          title="Cambiar a No Cumplió (en caso de error)"
                                        >
                                          🔄 Cambiar a No Cumplió
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleResetHorasExtraVerification(h.id)}
                                        style={{ fontSize: '10px', color: 'var(--color-gray-600)', background: 'none', border: '1px solid var(--color-gray-300)', borderRadius: '4px', padding: '1px 5px', cursor: 'pointer' }}
                                        title="Restablecer a Pendiente"
                                      >
                                        ↩ Pendiente
                                      </button>
                                    </div>
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
                                      <div>⚠️ Entrada real: {formatHourLabel(h.scheduleCorrection.actualStartHour)} (autorizado {formatHourLabel(h.startHour)})</div>
                                    )}
                                    {h.scheduleCorrection.actualEndHour !== h.endHour && (
                                      <div>⚠️ Salida real: {formatHourLabel(h.scheduleCorrection.actualEndHour)} (autorizado {formatHourLabel(h.endHour)})</div>
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
                        gap: '8px', padding: '10px 14px', background: sol.status === 'pendiente' ? 'var(--card-warning-bg)' : 'var(--color-gray-100)',
                        borderRadius: '8px', border: sol.status === 'pendiente' ? '1px solid rgba(255, 204, 0, 0.4)' : '1px solid var(--color-gray-200)',
                        fontSize: '13px',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div>
                          <strong>{sol.operarioName}</strong> — ⏱️ <strong>{sol.horas}h</strong> {sol.bloque === 'domingo' ? '(📅 Domingo Completo)' : `extra (${sol.bloque === 'matutino' ? '🌅 Matutino' : '🌆 Vespertino'})`} para el 📅 <strong>{sol.fecha}</strong>
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

            {esFechaDomingo(scheduleModal.authorizedDate) && (
              <div className={styles.bannerInfo}>
                <strong>📅 Domingo — Turno Completo:</strong>
                <span> Esta fecha cae en domingo, un día que normalmente no es laboral. Indica la hora de entrada y salida del turno completo.</span>
              </div>
            )}

            <div className={styles.formGroup}>
              <Select
                label="Hora de Entrada del Colaborador"
                value={scheduleModal.startHour}
                onChange={handleStartHourChange}
                required
                options={esFechaDomingo(scheduleModal.authorizedDate)
                  ? buildHalfHourOptions(6, 10)
                  : buildHalfHourOptions(6, 8, (h) => ({
                      6: '06:00 AM (Tiempo Extra Temprano)',
                      7: '07:00 AM (Tiempo Extra Temprano)',
                      8: '08:00 AM (Entrada Normal)',
                    }[h])) }
              />
            </div>

            <div className={styles.formGroup}>
              <Select
                label="Hora de Salida del Colaborador"
                value={scheduleModal.endHour}
                onChange={handleEndHourChange}
                required
                options={esFechaDomingo(scheduleModal.authorizedDate)
                  ? buildHalfHourOptions(13, 20)
                  : buildHalfHourOptions(13, 22, (h) => ({
                      13: '13:00 (Salida Normal Sábado)',
                      18: '18:00 (Salida Normal Lunes-Viernes)',
                      19: '19:00 (Tiempo Extra)',
                      20: '20:00 (Tiempo Extra)',
                      21: '21:00 (Tiempo Extra)',
                      22: '22:00 (Tiempo Extra)',
                    }[h])) }
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>{esFechaDomingo(scheduleModal.authorizedDate) ? 'Horas del Turno de Domingo' : 'Horas Extras Autorizadas'}</label>
              {esFechaDomingo(scheduleModal.authorizedDate) ? (
                <div style={{ fontSize: '13px', padding: '8px 10px', backgroundColor: '#fdf2f8', borderRadius: '6px', border: '1px solid #fbcfe8' }}>
                  📅 <strong>Domingo Completo:</strong> {scheduleModal.overtimeHours}h ({formatHourLabel(scheduleModal.startHour)}-{formatHourLabel(scheduleModal.endHour)})
                </div>
              ) : (() => {
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
                      <div style={{ fontSize: '13px', padding: '8px 10px', backgroundColor: 'rgba(0, 153, 204, 0.12)', borderRadius: '6px', border: '1px solid rgba(0, 153, 204, 0.3)', color: 'var(--color-dark)' }}>
                        🌅 <strong>Bloque Matutino:</strong> {earlyHours}h ({earlyRange})
                      </div>
                    )}
                    {lateHours > 0 && (
                      <div style={{ fontSize: '13px', padding: '8px 10px', backgroundColor: 'rgba(255, 153, 51, 0.12)', borderRadius: '6px', border: '1px solid rgba(255, 153, 51, 0.3)', color: 'var(--color-dark)' }}>
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
        for (let hVal = targetHE.startHour; hVal <= baseStartHour; hVal += 0.5) {
          startOptions.push({ value: String(hVal), label: formatHourLabel(hVal) });
        }
        const endOptions = [];
        for (let hVal = baseEndHour; hVal <= targetHE.endHour; hVal += 0.5) {
          endOptions.push({ value: String(hVal), label: formatHourLabel(hVal) });
        }

        return (
          <Modal
            isOpen={scheduleCorrectionModal.isOpen}
            onClose={handleCloseScheduleCorrectionModal}
            title="✏️ Corregir Horario de Tiempo Extra"
          >
            <form onSubmit={handleSubmitScheduleCorrection} className={styles.form}>
              <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: 0 }}>
                Autorizado: {formatHourLabel(targetHE.startHour)} - {formatHourLabel(targetHE.endHour)} el {targetHE.authorizedDate}. Ajusta solo la hora del bloque que en realidad no se cumplió como se autorizó.
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

      {/* MODAL: SOLICITAR MATERIALES A ALMACÉN */}
      {materialModal.isOpen && (
        <Modal isOpen={materialModal.isOpen} onClose={handleCloseMaterialModal} title={materialModal.editingId ? '✏️ Corregir y Reenviar Solicitud' : '📦 Solicitar Materiales a Almacén'}>
          <form onSubmit={handleSubmitMaterialRequest} className={styles.form}>
            <div className={styles.formGroup}>
              <Select
                label="Juego (opcional)"
                value={materialModal.gameId}
                onChange={(e) => setMaterialModal((prev) => ({ ...prev, gameId: e.target.value }))}
                placeholder="-- Sin vincular a un juego --"
                options={filteredJuegos.map((j) => ({ value: j.id, label: `${j.name} (${j.projectName})` }))}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Materiales Solicitados</label>
              {materialModal.items.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'flex-start' }}>
                  <ItemAutocomplete
                    value={{ name: it.name, itemId: it.itemId }}
                    onChange={(val) => {
                      handleMaterialItemChange(idx, 'name', val.name);
                      handleMaterialItemChange(idx, 'itemId', val.itemId);
                    }}
                  />
                  <input
                    type="number"
                    min="1"
                    value={it.quantity}
                    onChange={(e) => handleMaterialItemChange(idx, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                    className={styles.textInput}
                    style={{ width: '70px' }}
                  />
                  <input
                    type="text"
                    placeholder="Unidad"
                    value={it.unit}
                    onChange={(e) => handleMaterialItemChange(idx, 'unit', e.target.value)}
                    className={styles.textInput}
                    style={{ width: '70px' }}
                  />
                  {materialModal.items.length > 1 && (
                    <button type="button" onClick={() => handleRemoveMaterialItemRow(idx)} style={{ border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={handleAddMaterialItemRow}>
                ➕ Agregar Material
              </Button>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Justificación</label>
              <textarea
                className={styles.textarea}
                rows="3"
                required
                placeholder="Ej: Para terminar el ensamble de la estructura del juego X"
                value={materialModal.justification}
                onChange={(e) => setMaterialModal((prev) => ({ ...prev, justification: e.target.value }))}
              />
            </div>

            <div className={styles.formGroup}>
              <Select
                label="Prioridad"
                value={materialModal.priority}
                onChange={(e) => setMaterialModal((prev) => ({ ...prev, priority: e.target.value }))}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'urgente', label: '🔥 Urgente' },
                ]}
              />
            </div>

            <div className={styles.formActions}>
              <Button type="button" variant="secondary" size="md" onClick={handleCloseMaterialModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="md">
                {materialModal.editingId ? 'Reenviar Solicitud' : 'Enviar Solicitud'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: RECHAZAR SOLICITUD DE MATERIALES */}
      {materialRejectModal.isOpen && (
        <Modal isOpen={materialRejectModal.isOpen} onClose={handleCloseMaterialRejectModal} title="❌ Rechazar Solicitud de Materiales">
          <form onSubmit={handleSubmitMaterialReject} className={styles.form}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Motivo del Rechazo</label>
              <textarea
                className={styles.textarea}
                rows="3"
                required
                placeholder="Ej: No hay existencias de este material por el momento"
                value={materialRejectModal.notes}
                onChange={(e) => setMaterialRejectModal((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div className={styles.formActions}>
              <Button type="button" variant="secondary" size="md" onClick={handleCloseMaterialRejectModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="danger" size="md">
                Rechazar Solicitud
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: CONFIRMAR ELIMINACIÓN DE SOLICITUD DE MATERIALES (Admin) */}
      {materialDeleteConfirm.isOpen && (
        <Modal isOpen={materialDeleteConfirm.isOpen} onClose={handleCloseMaterialDeleteConfirm} title="🗑️ Confirmar Eliminación">
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar la solicitud <strong>MAT-{String(materialDeleteConfirm.folio || '').padStart(4, '0')}</strong>?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción no se puede deshacer y eliminará el registro por completo.
            </p>
            <div className={styles.formActions} style={{ marginTop: 'var(--space-4)' }}>
              <Button type="button" variant="secondary" size="md" onClick={handleCloseMaterialDeleteConfirm}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" size="md" onClick={handleConfirmDeleteMaterial}>
                Eliminar Solicitud
              </Button>
            </div>
          </div>
        </Modal>
      )}

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
                  onChange={handleRequestFechaChange}
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
                  ✅ Colaborador habilitado para solicitar {requestOvertimeModal.bloque === 'domingo' ? 'trabajo en domingo' : 'tiempo extra'} el {requestOvertimeModal.fecha}.
                </div>
              )}

              {requestOvertimeModal.bloque === 'domingo' ? (
                <>
                  <div className={styles.bannerInfo} style={{ marginBottom: '12px' }}>
                    <strong>📅 Domingo — Turno Completo:</strong>
                    <span> Esta fecha cae en domingo, un día que normalmente no es laboral. Indica la hora de entrada y salida del turno completo (por default, un turno normal de 08:00 a 18:00).</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className={styles.formGroup}>
                      <Select
                        label="Hora de Entrada"
                        value={requestOvertimeModal.startHour}
                        onChange={handleRequestDomingoHourChange('startHour')}
                        required
                        options={buildHalfHourOptions(6, 10)}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <Select
                        label="Hora de Salida"
                        value={requestOvertimeModal.endHour}
                        onChange={handleRequestDomingoHourChange('endHour')}
                        required
                        options={buildHalfHourOptions(13, 20)}
                      />
                    </div>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: '-4px', marginBottom: '12px' }}>
                    Total del turno: {requestOvertimeModal.horas} hora(s).
                  </p>
                </>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className={styles.formGroup}>
                    <Select
                      label="Bloque de Tiempo"
                      value={requestOvertimeModal.bloque}
                      onChange={(e) => {
                        const newBloque = e.target.value;
                        setRequestOvertimeModal((prev) => {
                          let newHoras = prev.horas;
                          if (newBloque === 'matutino' && Number(newHoras) > 2) {
                            newHoras = '2';
                          }
                          return { ...prev, bloque: newBloque, horas: newHoras };
                        });
                      }}
                      required
                      options={[
                        { value: 'vespertino', label: '🌆 Vespertino (Extensión hasta 22:00 max)' },
                        { value: 'matutino', label: '🌅 Matutino (Entrada desde 6:00 AM max)' },
                      ]}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <Select
                      label="Cantidad de Horas"
                      value={requestOvertimeModal.horas}
                      onChange={(e) => setRequestOvertimeModal((prev) => ({ ...prev, horas: e.target.value }))}
                      required
                      options={buildOvertimeCountOptions(requestOvertimeModal.bloque === 'matutino' ? 2 : 4, requestOvertimeModal.bloque)}
                    />
                  </div>
                </div>
              )}

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
                  onChange={handleEditRequestFechaChange}
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

              {editOvertimeRequestModal.bloque === 'domingo' ? (
                <>
                  <div className={styles.bannerInfo} style={{ marginBottom: '12px' }}>
                    <strong>📅 Domingo — Turno Completo:</strong>
                    <span> Indica la hora de entrada y salida del turno completo de ese domingo.</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className={styles.formGroup}>
                      <Select
                        label="Hora de Entrada"
                        value={editOvertimeRequestModal.startHour}
                        onChange={handleEditRequestDomingoHourChange('startHour')}
                        required
                        options={buildHalfHourOptions(6, 10)}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <Select
                        label="Hora de Salida"
                        value={editOvertimeRequestModal.endHour}
                        onChange={handleEditRequestDomingoHourChange('endHour')}
                        required
                        options={buildHalfHourOptions(13, 20)}
                      />
                    </div>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: '-4px', marginBottom: '12px' }}>
                    Total del turno: {editOvertimeRequestModal.horas} hora(s).
                  </p>
                </>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className={styles.formGroup}>
                    <Select
                      label="Bloque de Tiempo"
                      value={editOvertimeRequestModal.bloque}
                      onChange={(e) => {
                        const newBloque = e.target.value;
                        setEditOvertimeRequestModal((prev) => {
                          let newHoras = prev.horas;
                          if (newBloque === 'matutino' && Number(newHoras) > 2) {
                            newHoras = '2';
                          }
                          return { ...prev, bloque: newBloque, horas: newHoras };
                        });
                      }}
                      required
                      options={[
                        { value: 'vespertino', label: '🌆 Vespertino (Extensión hasta 22:00 max)' },
                        { value: 'matutino', label: '🌅 Matutino (Entrada desde 6:00 AM max)' },
                      ]}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <Select
                      label="Cantidad de Horas"
                      value={editOvertimeRequestModal.horas}
                      onChange={(e) => setEditOvertimeRequestModal((prev) => ({ ...prev, horas: e.target.value }))}
                      required
                      options={buildOvertimeCountOptions(editOvertimeRequestModal.bloque === 'matutino' ? 2 : 4, editOvertimeRequestModal.bloque)}
                    />
                  </div>
                </div>
              )}

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
