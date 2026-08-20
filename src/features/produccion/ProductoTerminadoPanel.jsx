import React, { useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import useToast from '../../hooks/useToast';
import useProduccion from '../../hooks/useProduccion';
import useAuth from '../../hooks/useAuth';
import useOperarios from '../../hooks/useOperarios';
import useProgressiveList from '../../hooks/useProgressiveList';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import { checkOvertimeEligibility } from '../../utils/overtimeRules';
import { getOvertimeBlocks, formatHourLabel, buildHalfHourOptions, buildOvertimeCountOptions } from '../../utils/overtimeUtils';
import { PUESTO_LABELS, PUESTO_ICONS, PUESTO_BADGE_VARIANT } from '../../data/puestoConfig';
import { ESTADO_LABELS, ESTADO_ICONS, ESTADO_BADGE_VARIANT } from '../../data/estadoConfig';
import { ROLE_TYPES } from '../../data/usersData';
import styles from './ProductoTerminadoPanel.module.css';

const getCellValue = (row, pattern) => {
  const key = Object.keys(row).find((k) => pattern.test(k));
  return key ? String(row[key]).trim() : '';
};

const CONTAINER_VARIANTS = {
  initial: { opacity: 0, y: 15 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const ITEM_VARIANTS = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

const AREAS_MAP = {
  almacen: { name: 'Almacén', icon: '📦', color: '#0099CC' },
  'corte-laser': { name: 'Corte Laser', icon: '⚡', color: '#FF3300' },
  herreria: { name: 'Herrería', icon: '🔨', color: '#330066' },
  carpinteria: { name: 'Carpintería', icon: '🪛', color: '#FFCC00' },
  'costura-acc': { name: 'Costura Accesorios', icon: '🧵', color: '#FF9933' },
  'costura-colch': { name: 'Costura Colchonetas', icon: '🪡', color: '#990099' },
  mantenimiento: { name: 'Mantenimiento', icon: '⚙️', color: '#9933FF' },
  'producto-terminado': { name: 'Producto Terminado', icon: '📦', color: '#20C4A8' },
};

export default function ProductoTerminadoPanel({ activeArea, onBack, readOnly }) {
  const {
    juegos,
    proyectos,
    tarimas,
    envios,
    addTarima,
    deleteTarima,
    addEnvio,
    editEnvio,
    updateEnvioStatus,
    deleteEnvio,
    palletizePieces,
    updateGameChecklist,
    receiveAreaDelivery,
    addReceptionEvidence,
    removeReceptionEvidence,
    returnDeliveryForReview,
  } = useProduccion();

  const { user } = useAuth();
  const toast = useToast();

  const {
    operarios,
    solicitudesHorasExtra,
    horasExtra,
    solicitarHorasExtra,
    cancelarSolicitudHoraExtra,
    modificarSolicitudHoraExtra,
    updateOperarioSchedule,
    authorizeOvertimeTasks,
    cancelPendingHorasExtra,
    verifyHorasExtra,
    correctHorasExtraSchedule,
  } = useOperarios();

  const todayStr = getTodayLocalDateStr();
  const isSat = new Date().getDay() === 6;

  const ptOperarios = useMemo(
    () => operarios.filter((op) => op.currentArea === 'producto-terminado'),
    [operarios]
  );

  const ptSolicitudes = useMemo(
    () => solicitudesHorasExtra.filter((s) => s.areaId === 'producto-terminado'),
    [solicitudesHorasExtra]
  );

  const pendingHeCount = useMemo(
    () => ptSolicitudes.filter((s) => s.status === 'pendiente').length,
    [ptSolicitudes]
  );

  const canManageJornada = user?.roleType === ROLE_TYPES.ADMIN || user?.roleType === ROLE_TYPES.SUPERVISOR_AREA;

  // Modales para horas extras y jornada del personal de PT
  const [requestOvertimeModal, setRequestOvertimeModal] = useState({
    isOpen: false,
    operarioId: '',
    fecha: todayStr,
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
  // cero, normalmente igual de largo que un día laboral normal.
  const esFechaDomingo = (fechaStr) => Boolean(fechaStr) && new Date(`${fechaStr}T00:00:00`).getDay() === 0;

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

  const handleOpenRequestOvertimeModal = () => {
    const firstOp = ptOperarios[0]?.id || '';
    const esDomingo = esFechaDomingo(todayStr);
    setRequestOvertimeModal({
      isOpen: true,
      operarioId: firstOp,
      fecha: todayStr,
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
    // fecha — de lo contrario, un domingo con horario ya capturado se quedaba pegado en
    // el formulario al cambiar a OTRO domingo, y la solicitud se podía enviar con el
    // horario equivocado (mismo tipo de error ya corregido en handleDateChange).
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
      fecha: sol.fecha || todayStr,
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
    const res = await cancelarSolicitudHoraExtra(sol.id, 'Cancelada desde vista de Producto Terminado');
    if (res.ok) {
      toast.success(`Solicitud de ${sol.operarioName} cancelada.`);
    } else {
      toast.danger(res.error || 'No se pudo cancelar la solicitud.');
    }
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
    //
    // EXCEPCIÓN: si ya existe una autorización VIGENTE (no cancelada) de HOY para este
    // colaborador, sí se recupera su texto de tareas para no perderlo al redefinir el
    // horario del día — ej. se autorizó tiempo extra matutino en la mañana con su
    // descripción, y en la tarde surge la necesidad de extender también el bloque
    // vespertino: guardar (handleSaveSchedule) cancela esa autorización previa y crea una
    // nueva combinada, así que sin esto el texto de la mañana desaparecía en automático.
    const existingTodayHE = horasExtra.find(
      (h) => h.operarioId === op.id && h.authorizedDate === todayStr && h.verificationStatus !== 'cancelado'
    );
    const inheritedTasks = existingTodayHE?.overtimeTasks || '';
    if (esFechaDomingo(todayStr)) {
      setScheduleModal({
        isOpen: true, collaborator: op, startHour: '8', endHour: '18',
        overtimeHours: '10', authorizedDate: todayStr, overtimeTasks: inheritedTasks,
      });
      return;
    }
    const prefilledStart = Number(op.schedule?.startHour || 8);
    const prefilledEnd = Number(op.schedule?.endHour || (isSat ? 13 : 18));
    const { earlyHours, lateHours } = getOvertimeBlocks(prefilledStart, prefilledEnd, todayStr);
    setScheduleModal({
      isOpen: true,
      collaborator: op,
      startHour: String(prefilledStart),
      endHour: String(prefilledEnd),
      overtimeHours: String(earlyHours + lateHours),
      authorizedDate: todayStr,
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
    // seguían siendo los de la fecha anterior, así que la fecha nueva se podía guardar con
    // el horario de la fecha vieja si no se tocaban a mano. Ahora, si ya existe una
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
    if (!collaborator) return;
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
    const isToday = authorizedDate === todayStr;
    toast.success(
      isToday
        ? `⏱️ Horario actualizado para ${collaborator.name} para hoy (${authorizedDate}). Horas extras: ${overtimeHours}h.`
        : `📅 Horas extra programadas para ${collaborator.name} el ${authorizedDate} (${overtimeHours}h). El horario de hoy no se modificó.`
    );
    handleCloseScheduleModal();
  };

  const toggleOvertimeExpanded = (opId) => {
    setExpandedOvertimeOperarios((prev) => {
      const next = new Set(prev);
      if (next.has(opId)) next.delete(opId);
      else next.add(opId);
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

  // Regresar una entrega notificada al área de origen (error detectado antes de recibirla)
  const [returnModal, setReturnModal] = useState({ isOpen: false, item: null, notes: '' });

  // Gestión de pestañas: 'recepcion' | 'envios' (Personal del Área y Solicitudes de Horas
  // Extras se muestran siempre debajo, fuera de las pestañas — ver más abajo).
  const [activeTab, setActiveTab] = useState('recepcion');

  // Estados para Recepción con Checklist
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [checklistItems, setChecklistItems] = useState([]);
  const [isChecklistEditing, setIsChecklistEditing] = useState(false);
  const [newChecklistItem, setNewChecklistItem] = useState({ text: '', quantity: 1 });

  // Evidencia fotográfica de lo recibido, adjunta desde el modal de Recepción y Checklist
  const [receptionPhotos, setReceptionPhotos] = useState([]);
  const [isUploadingReceptionPhotos, setIsUploadingReceptionPhotos] = useState(false);
  const [receptionPhotoPreview, setReceptionPhotoPreview] = useState(null);

  // Control de Modales
  const [isPalletModalOpen, setIsPalletModalOpen] = useState(false);
  const [isShipmentModalOpen, setIsShipmentModalOpen] = useState(false);
  const [editingShipmentId, setEditingShipmentId] = useState(null);

  // Estados para Creación de Tarima
  const [newPallet, setNewPallet] = useState({
    name: '',
    projectId: '',
    weight: '',
    packingListFile: '',
    selectedBulkItems: {}, // key: "gameId_areaId", value: quantity
    extraItems: [], // [{ name: '', quantity: 1 }]
  });
  const [extraItemInput, setExtraItemInput] = useState({ name: '', quantity: 1 });

  // Estados para Creación de Envío
  const [newShipment, setNewShipment] = useState({
    projectId: '',
    destination: '',
    scheduledDate: '',
    scheduledTime: '',
    driverName: '',
    vehicleInfo: '',
    lockNumber: '',
    selectedTarimas: [], // ids de tarimas
    selectedGames: [], // ids de juegos (totalmente empaquetados)
    extraItems: [], // [{ name: '', quantity: 1 }]
  });
  const [shipmentExtraInput, setShipmentExtraInput] = useState({ name: '', quantity: 1 });

  // ============================================
  // CÁLCULOS Y FILTRADOS - PIEZAS RECIBIDAS
  // ============================================

  // Obtener listado de todas las piezas producidas que han sido recibidas en Producto Terminado
  // y que aún no han sido entarimadas.
  const bulkItemsReceived = useMemo(() => {
    const list = [];
    juegos.forEach((j) => {
      j.areas.forEach((areaId) => {
        const produced = j.producedPieces?.[areaId] || 0;
        const palletized = j.palletizedPieces?.[areaId] || 0;
        const available = Math.max(0, produced - palletized);
        const deliveryStatus = j.areaDeliveryStatus?.[areaId] || 'pendiente';

        // Solo se pueden entarimar si ya fueron recibidas oficialmente en PT
        if (available > 0 && deliveryStatus === 'recibido_pt') {
          list.push({
            gameId: j.id,
            gameName: j.name,
            projectId: j.projectId,
            projectName: j.projectName,
            areaId,
            areaName: AREAS_MAP[areaId]?.name || areaId,
            areaIcon: AREAS_MAP[areaId]?.icon || '⚙️',
            areaColor: AREAS_MAP[areaId]?.color || '#ccc',
            available,
            totalProduced: produced,
            target: j.targetPieces?.[areaId] || 10,
          });
        }
      });
    });
    return list;
  }, [juegos]);

  // Obtener entregas notificadas por las áreas que están pendientes de verificar/recibir en PT
  const pendingDeliveries = useMemo(() => {
    const list = [];
    juegos.forEach((j) => {
      j.areas.forEach((areaId) => {
        const deliveryStatus = j.areaDeliveryStatus?.[areaId] || 'pendiente';
        if (deliveryStatus === 'notificado_pt') {
          list.push({
            gameId: j.id,
            gameName: j.name,
            projectId: j.projectId,
            projectName: j.projectName,
            areaId,
            areaName: AREAS_MAP[areaId]?.name || areaId,
            areaIcon: AREAS_MAP[areaId]?.icon || '⚙️',
            areaColor: AREAS_MAP[areaId]?.color || '#ccc',
            totalProduced: j.producedPieces?.[areaId] || 0,
            target: j.targetPieces?.[areaId] || 10,
            checklist: j.checklist || [],
            // Visto bueno adicional de Calidad, independiente de la aprobación previa a
            // notificar — sin esto, PT no puede recibir (ver CalidadPage.jsx).
            receptionApproved: Boolean(j.receptionApproval?.[areaId]),
            receptionEvidence: j.receptionEvidence?.[areaId] || [],
          });
        }
      });
    });
    return list;
  }, [juegos]);

  // Revela cada una de las 4 listas de esta página en tandas de 15, en vez de pintarlas
  // completas de una vez conforme se acumulan entregas/tarimas/envíos.
  const {
    visibleItems: visiblePendingDeliveries,
    hasMore: hasMorePendingDeliveries,
    remaining: remainingPendingDeliveries,
    showMore: showMorePendingDeliveries,
  } = useProgressiveList(pendingDeliveries);
  const {
    visibleItems: visibleBulkItemsReceived,
    hasMore: hasMoreBulkItemsReceived,
    remaining: remainingBulkItemsReceived,
    showMore: showMoreBulkItemsReceived,
  } = useProgressiveList(bulkItemsReceived);
  const {
    visibleItems: visibleTarimas,
    hasMore: hasMoreTarimas,
    remaining: remainingTarimas,
    showMore: showMoreTarimas,
  } = useProgressiveList(tarimas);
  const {
    visibleItems: visibleEnvios,
    hasMore: hasMoreEnvios,
    remaining: remainingEnvios,
    showMore: showMoreEnvios,
  } = useProgressiveList(envios);

  // Filtrar piezas disponibles para el proyecto seleccionado en el modal de Tarima
  const bulkItemsForSelectedProject = useMemo(() => {
    if (!newPallet.projectId) return [];
    return bulkItemsReceived.filter((item) => item.projectId === newPallet.projectId);
  }, [bulkItemsReceived, newPallet.projectId]);

  // Tarimas disponibles para cargar en el modal de envío (cualquier proyecto)
  const availableTarimas = useMemo(() => {
    return tarimas.filter((t) => {
      if (t.status === 'preparada') return true;
      if (editingShipmentId && newShipment.selectedTarimas[t.id]) return true;
      return false;
    });
  }, [tarimas, editingShipmentId, newShipment.selectedTarimas]);

  // Todos los juegos disponibles para selección de envío (se cargarán con sus respectivas tarimas de forma automática)
  const gamesForShipmentSelection = useMemo(() => {
    const assignedGameIds = new Set();
    envios.forEach((e) => {
      if (editingShipmentId && e.id === editingShipmentId) return;
      e.items.forEach((item) => {
        if (item.type === 'juego') {
          assignedGameIds.add(item.id);
        }
      });
    });
    return juegos.filter((j) => !assignedGameIds.has(j.id));
  }, [juegos, envios, editingShipmentId]);

  // Tarimas que contienen piezas de los juegos seleccionados
  const associatedTarimasForCurrentSelection = useMemo(() => {
    const selectedGameIds = Object.keys(newShipment.selectedGames);
    if (selectedGameIds.length === 0) return [];

    const selectedGameNames = juegos
      .filter((j) => selectedGameIds.includes(j.id))
      .map((j) => j.name);

    return tarimas.filter((t) =>
      t.status === 'preparada' &&
      t.items.some(
        (item) =>
          (item.type === 'juego' && selectedGameIds.includes(item.gameId)) ||
          (item.type === 'juego' && selectedGameNames.some((name) => item.name.startsWith(name)))
      )
    );
  }, [tarimas, juegos, newShipment.selectedGames]);

  // ============================================
  // HANDLERS - GESTIÓN DE TARIMAS
  // ============================================

  const handleOpenPalletModal = () => {
    setIsPalletModalOpen(true);
    if (proyectos.length > 0) {
      setNewPallet({
        name: '',
        projectId: proyectos[0].id,
        selectedBulkItems: {},
        extraItems: [],
      });
    }
  };

  const handleClosePalletModal = () => {
    setIsPalletModalOpen(false);
    setExtraItemInput({ name: '', quantity: 1 });
  };

  const handlePackingListExcelChange = async (e) => {
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

      const extraItems = [];
      rows.forEach((row) => {
        const itemName = getCellValue(row, /descrip|articulo|artículo|nombre|item|name/i);
        const itemQty = Number(getCellValue(row, /cant|pieza|qty|quantity/i)) || 1;
        if (itemName) {
          extraItems.push({ name: itemName, quantity: itemQty });
        }
      });

      if (extraItems.length > 0) {
        setNewPallet((prev) => ({
          ...prev,
          packingListFile: file.name,
          extraItems: [...prev.extraItems, ...extraItems],
        }));
        toast.success(`📊 Se importaron ${extraItems.length} materiales del packing list.`);
      } else {
        toast.warning('No se encontraron columnas de descripción o cantidad válidas en el Excel.');
      }
    } catch (err) {
      toast.danger('No se pudo leer el archivo de packing list. Verifica que sea un Excel válido.');
    } finally {
      e.target.value = '';
    }
  };

  const handleAddExtraItemToPallet = () => {
    if (!extraItemInput.name) return;
    setNewPallet((prev) => ({
      ...prev,
      extraItems: [...prev.extraItems, { ...extraItemInput }],
    }));
    setExtraItemInput({ name: '', quantity: 1 });
  };

  const handleRemoveExtraItemFromPallet = (idx) => {
    setNewPallet((prev) => ({
      ...prev,
      extraItems: prev.extraItems.filter((_, i) => i !== idx),
    }));
  };

  const handleToggleBulkItemForPallet = (key, maxQty) => {
    setNewPallet((prev) => {
      const nextSelected = { ...prev.selectedBulkItems };
      if (nextSelected[key] !== undefined) {
        delete nextSelected[key];
      } else {
        nextSelected[key] = maxQty; // Seleccionar cantidad máxima por defecto
      }
      return { ...prev, selectedBulkItems: nextSelected };
    });
  };

  const handleBulkItemQtyChange = (key, val, maxQty) => {
    const qty = Math.min(maxQty, Math.max(1, Number(val) || 1));
    setNewPallet((prev) => ({
      ...prev,
      selectedBulkItems: {
        ...prev.selectedBulkItems,
        [key]: qty,
      },
    }));
  };

  const handleCreatePalletSubmit = (e) => {
    e.preventDefault();
    if (!newPallet.name || !newPallet.projectId) {
      toast.danger('Por favor introduce un nombre para la tarima y selecciona un proyecto.');
      return;
    }

    const selectedProj = proyectos.find((p) => p.id === newPallet.projectId);
    
    // Armar items de la tarima
    const items = [];
    const gamesPiecesUpdates = {}; // gameId -> { areaId: qty }

    Object.entries(newPallet.selectedBulkItems).forEach(([key, qty]) => {
      const [gameId, areaId] = key.split('_');
      const bulkItemObj = bulkItemsForSelectedProject.find(
        (bi) => bi.gameId === gameId && bi.areaId === areaId
      );

      if (bulkItemObj) {
        items.push({
          type: 'juego',
          gameId: bulkItemObj.gameId,
          // areaId se guarda explícito (no solo en el texto de "name") para poder revertir
          // palletizedPieces si esta tarima se elimina más adelante (ver deleteTarima).
          areaId: bulkItemObj.areaId,
          name: `${bulkItemObj.gameName} (${bulkItemObj.areaName})`,
          quantity: qty,
        });

        if (!gamesPiecesUpdates[gameId]) {
          gamesPiecesUpdates[gameId] = {};
        }
        gamesPiecesUpdates[gameId][areaId] = qty;
      }
    });

    newPallet.extraItems.forEach((extra) => {
      items.push({ type: 'refaccion', name: extra.name, quantity: Number(extra.quantity) });
    });

    if (items.length === 0) {
      toast.warning('Debes agregar al menos una pieza o refacción a la tarima.');
      return;
    }

    // Registrar la creación de la tarima
    addTarima({
      name: newPallet.name,
      projectId: newPallet.projectId,
      projectName: selectedProj?.name || 'Desconocido',
      weight: Number(newPallet.weight) || 0,
      packingListFile: newPallet.packingListFile || '',
      items,
    });

    // Descontar las piezas colocándolas en el estado entarimado
    Object.entries(gamesPiecesUpdates).forEach(([gameId, areaPieces]) => {
      palletizePieces(gameId, areaPieces);
    });

    toast.success('🎨 Tarima consolidada con las piezas seleccionadas.');
    handleClosePalletModal();
  };

  // ============================================
  // HANDLERS - GESTIÓN DE ENVÍOS
  // ============================================

  const handleOpenShipmentModal = () => {
    setIsShipmentModalOpen(true);
    setEditingShipmentId(null);
    setNewShipment({
      scheduledDate: '',
      scheduledTime: '',
      driverName: '',
      vehicleInfo: '',
      lockNumber: '',
      selectedTarimas: {},
      selectedGames: {},
      extraItems: [],
    });
    setShipmentExtraInput({ name: '', quantity: 1, projectName: '', destinationAddress: '' });
  };

  const handleCloseShipmentModal = () => {
    setIsShipmentModalOpen(false);
    setEditingShipmentId(null);
    setShipmentExtraInput({ name: '', quantity: 1, projectName: '', destinationAddress: '' });
  };

  const handleEditShipment = (envio) => {
    setIsShipmentModalOpen(true);
    setEditingShipmentId(envio.id);
    
    const selectedTarimas = {};
    const selectedGames = {};
    const extraItems = [];

    envio.items.forEach(item => {
      if (item.type === 'tarima') {
        selectedTarimas[item.id] = { destinationAddress: item.destinationAddress || '' };
      } else if (item.type === 'juego') {
        selectedGames[item.id] = { destinationAddress: item.destinationAddress || '' };
      } else if (item.type === 'refaccion') {
        extraItems.push({
          name: item.name,
          quantity: item.quantity,
          projectName: item.projectName,
          destinationAddress: item.destinationAddress || '',
        });
      }
    });

    setNewShipment({
      scheduledDate: envio.scheduledDate || '',
      scheduledTime: envio.scheduledTime || '',
      driverName: envio.driverName || '',
      vehicleInfo: envio.vehicleInfo || '',
      lockNumber: envio.lockNumber || '',
      selectedTarimas,
      selectedGames,
      extraItems,
    });
    setShipmentExtraInput({ name: '', quantity: 1, projectName: '', destinationAddress: '' });
  };

  const handleAddExtraItemToShipment = () => {
    if (!shipmentExtraInput.name || !shipmentExtraInput.destinationAddress) {
      toast.danger('Por favor ingresa el nombre de la pieza y su dirección de entrega.');
      return;
    }
    setNewShipment((prev) => ({
      ...prev,
      extraItems: [...prev.extraItems, { ...shipmentExtraInput }],
    }));
    setShipmentExtraInput({ name: '', quantity: 1, projectName: '', destinationAddress: '' });
  };

  const handleRemoveExtraItemFromShipment = (idx) => {
    setNewShipment((prev) => ({
      ...prev,
      extraItems: prev.extraItems.filter((_, i) => i !== idx),
    }));
  };

  const handleToggleTarimaForShipment = (tarimaId) => {
    setNewShipment((prev) => {
      const nextTarimas = { ...prev.selectedTarimas };
      if (nextTarimas[tarimaId]) {
        delete nextTarimas[tarimaId];
      } else {
        nextTarimas[tarimaId] = { destinationAddress: '' };
      }
      return { ...prev, selectedTarimas: nextTarimas };
    });
  };

  const handleTarimaAddressChange = (tarimaId, address) => {
    setNewShipment((prev) => ({
      ...prev,
      selectedTarimas: {
        ...prev.selectedTarimas,
        [tarimaId]: {
          ...prev.selectedTarimas[tarimaId],
          destinationAddress: address,
        },
      },
    }));
  };

  const handleToggleGameForShipment = (gameId) => {
    setNewShipment((prev) => {
      const nextGames = { ...prev.selectedGames };
      if (nextGames[gameId]) {
        delete nextGames[gameId];
      } else {
        nextGames[gameId] = { destinationAddress: '' };
      }
      return { ...prev, selectedGames: nextGames };
    });
  };

  const handleGameAddressChange = (gameId, address) => {
    setNewShipment((prev) => ({
      ...prev,
      selectedGames: {
        ...prev.selectedGames,
        [gameId]: {
          ...prev.selectedGames[gameId],
          destinationAddress: address,
        },
      },
    }));
  };

  const handleCreateShipmentSubmit = (e) => {
    e.preventDefault();
    if (!newShipment.scheduledDate || !newShipment.lockNumber) {
      toast.danger('Por favor completa la fecha y el número de candado.');
      return;
    }

    // Armar items del envío
    const items = [];
    let hasMissingAddress = false;

    // Juegos seleccionados
    Object.entries(newShipment.selectedGames).forEach(([gId, info]) => {
      if (!info.destinationAddress) hasMissingAddress = true;
      const gObj = juegos.find((j) => j.id === gId);
      items.push({
        type: 'juego',
        id: gId,
        name: gObj?.name || gId,
        projectName: gObj?.projectName || 'Desconocido',
        quantity: 1,
        destinationAddress: info.destinationAddress,
      });
    });

    // Añadir automáticamente las tarimas asociadas a los juegos seleccionados
    const autoTarimaIds = new Set(associatedTarimasForCurrentSelection.map((t) => t.id));

    associatedTarimasForCurrentSelection.forEach((t) => {
      // Intentar vincular con la dirección del juego correspondiente
      const relatedGameIds = t.items
        .filter((item) => item.type === 'juego')
        .map((item) => item.gameId);

      const relatedGameNames = t.items
        .filter((item) => item.type === 'juego')
        .map((item) => item.name);

      const matchedGameId = Object.keys(newShipment.selectedGames).find((gId) => {
        const gameObj = juegos.find((j) => j.id === gId);
        return (
          relatedGameIds.includes(gId) ||
          (gameObj && relatedGameNames.some((name) => name.startsWith(gameObj.name)))
        );
      });

      const destAddress = matchedGameId
        ? newShipment.selectedGames[matchedGameId].destinationAddress
        : 'Dirección del Juego';

      items.push({
        type: 'tarima',
        id: t.id,
        name: t.name,
        projectName: t.projectName,
        quantity: 1,
        destinationAddress: destAddress,
      });
    });

    // Añadir las tarimas seleccionadas manualmente (que no se hayan agregado ya de forma automática)
    Object.entries(newShipment.selectedTarimas).forEach(([tId, info]) => {
      if (autoTarimaIds.has(tId)) return;
      if (!info.destinationAddress) hasMissingAddress = true;
      const tObj = tarimas.find((t) => t.id === tId);
      items.push({
        type: 'tarima',
        id: tId,
        name: tObj?.name || tId,
        projectName: tObj?.projectName || 'Desconocido',
        quantity: 1,
        destinationAddress: info.destinationAddress,
      });
    });

    newShipment.extraItems.forEach((extra) => {
      items.push({
        type: 'refaccion',
        name: extra.name,
        projectName: extra.projectName || 'General',
        quantity: Number(extra.quantity),
        destinationAddress: extra.destinationAddress,
      });
    });


    if (hasMissingAddress) {
      toast.danger('Por favor introduce la dirección de entrega de todos los juegos seleccionados.');
      return;
    }

    const envioData = {
      scheduledDate: newShipment.scheduledDate,
      scheduledTime: newShipment.scheduledTime || 'Sin hora',
      driverName: newShipment.driverName || 'Por asignar',
      vehicleInfo: newShipment.vehicleInfo || 'Por asignar',
      lockNumber: newShipment.lockNumber,
      items,
    };

    if (editingShipmentId) {
      editEnvio(editingShipmentId, envioData);
      toast.success('✏️ Envío modificado con éxito.');
    } else {
      addEnvio(envioData);
      toast.success('🚚 Envío programado con éxito. Listo para coordinar carga.');
    }
    
    handleCloseShipmentModal();
  };

  // Handlers para Recepción y Checklist
  const handleOpenReceptionModal = (delivery) => {
    setSelectedDelivery(delivery);
    const existingChecklist = delivery.checklist || [];
    setChecklistItems(existingChecklist.map((item) => ({ ...item, checked: false }))); // Empezar desmarcados para verificar
    setIsChecklistEditing(existingChecklist.length === 0);
    setReceptionPhotos(delivery.receptionEvidence || []);
  };

  const handleCloseReceptionModal = () => {
    setSelectedDelivery(null);
    setChecklistItems([]);
    setIsChecklistEditing(false);
    setNewChecklistItem({ text: '', quantity: 1 });
    setReceptionPhotos([]);
  };

  /**
   * Sube evidencia fotográfica de lo recibido directo al juego/área en edición
   */
  const handleAddReceptionPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !selectedDelivery) return;
    e.target.value = '';
    setIsUploadingReceptionPhotos(true);
    const result = await addReceptionEvidence(selectedDelivery.gameId, selectedDelivery.areaId, files);
    setIsUploadingReceptionPhotos(false);
    if (result.ok) {
      setReceptionPhotos(result.photos);
      toast.success('📷 Evidencia de recepción agregada.');
    } else {
      toast.danger(result.error || 'No se pudo subir la evidencia fotográfica.');
    }
  };

  /**
   * Quita una foto de evidencia de recepción ya guardada (borra también en Storage)
   */
  const handleRemoveReceptionPhoto = async (photo) => {
    if (!selectedDelivery) return;
    const result = await removeReceptionEvidence(selectedDelivery.gameId, selectedDelivery.areaId, photo.path);
    if (result.ok) {
      setReceptionPhotos(result.photos);
    } else {
      toast.danger(result.error || 'No se pudo quitar la evidencia fotográfica.');
    }
  };

  // Regresar una entrega ya notificada al área de origen (error detectado antes de recibirla)
  const handleOpenReturnModal = (item) => {
    setReturnModal({ isOpen: true, item, notes: '' });
  };

  const handleCloseReturnModal = () => {
    setReturnModal({ isOpen: false, item: null, notes: '' });
  };

  const handleSubmitReturnModal = async (e) => {
    e.preventDefault();
    const { item, notes } = returnModal;
    const res = await returnDeliveryForReview(item.gameId, item.areaId, user?.name || 'Producto Terminado', notes);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo regresar la entrega al área.');
      return;
    }
    toast.warning(`↩️ Entrega de "${item.gameName}" regresada a ${item.areaName} para revisión.`);
    handleCloseReturnModal();
  };

  // Total de piezas ya asignadas en el checklist y piezas esperadas del lote manufacturado
  const checklistAssignedQty = checklistItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const checklistExpectedQty = selectedDelivery?.target || 0;
  const checklistRemainingQty = Math.max(0, checklistExpectedQty - checklistAssignedQty);

  const handleAddChecklistItem = () => {
    if (!newChecklistItem.text.trim()) return;
    const qty = Number(newChecklistItem.quantity) || 1;

    if (checklistAssignedQty + qty > checklistExpectedQty) {
      toast.danger(
        `❌ No puedes agregar más piezas de las esperadas. Restan ${checklistRemainingQty} de ${checklistExpectedQty} piezas por asignar en el checklist.`
      );
      return;
    }

    const newItem = {
      id: `item_${Date.now()}`,
      text: newChecklistItem.text.trim(),
      quantity: qty,
      checked: false,
    };
    setChecklistItems((prev) => [...prev, newItem]);
    setNewChecklistItem({ text: '', quantity: 1 });
  };

  const handleRemoveChecklistItem = (id) => {
    setChecklistItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSaveChecklist = () => {
    if (selectedDelivery) {
      updateGameChecklist(selectedDelivery.gameId, checklistItems);
      toast.success('📋 Checklist del juego guardado y actualizado.');
      setIsChecklistEditing(false);
    }
  };

  const handleCheckItem = (id) => {
    setChecklistItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item))
    );
  };

  const handleConfirmReception = () => {
    if (!selectedDelivery) return;

    // Verificar que todo esté marcado como verificado
    const allChecked = checklistItems.every((item) => item.checked);
    if (!allChecked && checklistItems.length > 0) {
      toast.danger('Debes verificar y marcar todos los elementos del checklist antes de confirmar.');
      return;
    }

    receiveAreaDelivery(selectedDelivery.gameId, selectedDelivery.areaId);
    toast.success(`✅ Entrega de "${selectedDelivery.gameName}" (${selectedDelivery.areaName}) recibida correctamente.`);
    handleCloseReceptionModal();
  };

  return (
    <motion.div
      className={styles.panelContainer}
      variants={CONTAINER_VARIANTS}
      initial="initial"
      animate="animate"
    >
      {/* Cabecera del panel */}
      <PageHeader
        title="📦 Centro de Despacho y Producto Terminado (PT)"
        subtitle="Recibe piezas de manufactura, consolida tarimas por proyecto y despacha camiones a ruta."
        shape="anillo"
        accentColor="var(--color-blue-magenta-violet)"
      >
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={handleOpenRequestOvertimeModal}
          style={{ backgroundColor: 'var(--color-secondary)', color: '#ffffff', fontWeight: 'bold' }}
        >
          ⏰ Solicitar Horas Extras
        </Button>
        {onBack && (
          <Button variant="secondary" size="md" onClick={onBack}>
            ⬅ Volver a Manufactura
          </Button>
        )}
      </PageHeader>

      {/* Tabs */}
      <div className={styles.tabsHeader}>
        <button
          className={`${styles.tabButton} ${activeTab === 'recepcion' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('recepcion')}
        >
          📥 Control de Recepción y Tarimas
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'envios' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('envios')}
        >
          🚚 Programación de Envíos ({envios.length})
        </button>
      </div>

      {/* CONTENIDO DE TABS */}
      <AnimatePresence mode="wait">
        {activeTab === 'recepcion' ? (
          <motion.div
            key="recepcion"
            className={styles.sectionGrid}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
          >
            {/* Columna Izquierda: Entregas Pendientes y Recibidas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              
              {/* Sección 1: Entregas Pendientes de Recibir */}
              <div>
                <div className={styles.columnHeader}>
                  <h3 className={styles.columnTitle}>Entregas Pendientes por Recibir</h3>
                  <Badge variant="warning">{pendingDeliveries.length} por verificar</Badge>
                </div>

                <div className={styles.listContainer}>
                  {visiblePendingDeliveries.map((item) => (
                    <motion.div
                      key={`pending_${item.gameId}_${item.areaId}`}
                      className={styles.gameItemCard}
                      variants={ITEM_VARIANTS}
                      style={{ 
                        borderLeft: `4px solid ${item.areaColor}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div className={styles.gameInfo}>
                        <span className={styles.gameName}>
                          {item.areaIcon} {item.gameName} ({item.areaName})
                        </span>
                        <span className={styles.projectTag}>
                          Proyecto: {item.projectName} | Meta: <strong>{item.totalProduced} / {item.target} pzas</strong> completadas
                        </span>
                      </div>
                      {!readOnly && (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenReturnModal(item)}
                            style={{ padding: '6px 12px', fontSize: '12px' }}
                            title="Regresar al área de origen (ej. se detectó un error antes de recibirla)"
                          >
                            ↩️ Regresar
                          </Button>
                          {item.receptionApproved ? (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleOpenReceptionModal(item)}
                              style={{ padding: '6px 12px', fontSize: '12px' }}
                            >
                              📋 Verificar y Recibir
                            </Button>
                          ) : (
                            <span
                              style={{ fontSize: '12px', color: 'var(--color-alert)', fontWeight: 600 }}
                              title="Calidad debe aprobar esta recepción (pestaña de Revisión de Calidad para Entrega a PT) antes de poder recibirla."
                            >
                              ⏳ Esperando aprobación de Calidad para recibir
                            </span>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {pendingDeliveries.length === 0 && (
                    <div style={{
                      padding: 'var(--space-4)',
                      background: 'rgba(16, 185, 129, 0.03)',
                      border: '1px dashed rgba(16, 185, 129, 0.2)',
                      borderRadius: '12px',
                      color: '#065f46',
                      textAlign: 'center',
                      fontSize: '13px'
                    }}>
                      ✨ No hay entregas pendientes de manufactura en este momento.
                    </div>
                  )}
                  {hasMorePendingDeliveries && (
                    <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
                      <Button variant="secondary" size="sm" onClick={showMorePendingDeliveries}>
                        Cargar {Math.min(remainingPendingDeliveries, 15)} más ({remainingPendingDeliveries} restantes)
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Sección 2: Piezas Recibidas y Listas para Entarimar */}
              <div>
                <div className={styles.columnHeader}>
                  <h3 className={styles.columnTitle}>Piezas Listas para Entarimar</h3>
                  <Badge variant="primary">{bulkItemsReceived.length} lotes listos</Badge>
                </div>

                <div className={styles.listContainer}>
                  {visibleBulkItemsReceived.map((item) => (
                    <motion.div
                      key={`received_${item.gameId}_${item.areaId}`}
                      className={styles.gameItemCard}
                      variants={ITEM_VARIANTS}
                      style={{ borderLeft: `4px solid ${item.areaColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <div className={styles.gameInfo}>
                        <span className={styles.gameName}>
                          {item.areaIcon} {item.gameName} ({item.areaName})
                        </span>
                        <span className={styles.projectTag}>
                          Proyecto: {item.projectName} | <strong>{item.available} piezas listas</strong> (de {item.totalProduced} recibidas / meta {item.target})
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-gray-500)', fontStyle: 'italic' }}>
                          Lista para agregar a tarima
                        </span>
                        {!readOnly && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenReturnModal(item)}
                            style={{ padding: '6px 12px', fontSize: '12px' }}
                            title="Regresar este lote al área de origen (ej. se detectó un error antes de entarimar)"
                          >
                            ↩️ Regresar
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  ))}

                  {bulkItemsReceived.length === 0 && (
                    <EmptyState
                      message="No hay piezas listas para entarimar. Recibe lotes de manufactura o consolida los existentes."
                      shape="anillo"
                      color="var(--color-blue-magenta-violet)"
                    />
                  )}
                  {hasMoreBulkItemsReceived && (
                    <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
                      <Button variant="secondary" size="sm" onClick={showMoreBulkItemsReceived}>
                        Cargar {Math.min(remainingBulkItemsReceived, 15)} más ({remainingBulkItemsReceived} restantes)
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Columna Derecha: Tarimas Preparadas */}
            <div>
              <div className={styles.columnHeader}>
                <h3 className={styles.columnTitle}>Tarimas Consolidadas</h3>
                {!readOnly && (
                  <Button variant="primary" size="sm" onClick={handleOpenPalletModal}>
                    ➕ Crear Tarima
                  </Button>
                )}
              </div>

              <div className={styles.listContainer}>
                {visibleTarimas.map((t) => (
                  <Card
                    key={t.id}
                    variant="default"
                    className={`${styles.gameItemCard} ${styles.palletCard}`}
                  >
                    <div style={{ width: '100%' }}>
                      <div className={styles.palletHeader}>
                        <div>
                          <span className={styles.palletTitle}>{t.name}</span>
                          <span style={{ marginLeft: '8px' }}>
                            <Badge variant={t.status === 'preparada' ? 'info' : 'success'}>
                              {t.status.toUpperCase()}
                            </Badge>
                          </span>
                        </div>
                        {!readOnly && t.status === 'preparada' && (
                          <button
                            onClick={() => {
                              deleteTarima(t.id);
                              toast.info('Tarima eliminada. Las piezas que contenía vuelven a estar disponibles para entarimar.');
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontWeight: 'bold' }}
                            title="Eliminar Tarima"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className={styles.palletProject} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div><strong>Proyecto:</strong> {t.projectName}</div>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--color-gray-600)', marginTop: '4px' }}>
                          <span>⚖️ <strong>Peso:</strong> {t.weight || 0} kg</span>
                          {t.packingListFile && <span>📄 <strong>Packing List:</strong> {t.packingListFile}</span>}
                        </div>
                      </div>

                      <div className={styles.palletItemList}>
                        {t.items.map((item, index) => (
                          <div key={index} className={styles.palletItemRow}>
                            <span>
                              {item.type === 'juego' ? '🧩' : '🔧'} {item.name}
                            </span>
                            <strong>{item.quantity} piezas</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                ))}

                {tarimas.length === 0 && (
                  <EmptyState
                    message="No se han configurado tarimas de envío."
                    shape="cacahuate"
                    color="var(--color-blue-magenta-violet)"
                  />
                )}
                {hasMoreTarimas && (
                  <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
                    <Button variant="secondary" size="sm" onClick={showMoreTarimas}>
                      Cargar {Math.min(remainingTarimas, 15)} más ({remainingTarimas} restantes)
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          /* TAB DE ENVÍOS */
          <motion.div
            key="envios"
            className={styles.panelContainer}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
          >
            <div className={styles.columnHeader}>
              <h3 className={styles.columnTitle}>Coordinación de Embarques</h3>
              {!readOnly && (
                <Button variant="primary" size="md" onClick={handleOpenShipmentModal}>
                  🚚 Programar Envío
                </Button>
              )}
            </div>

            <div className={styles.shipmentsGrid}>
              {visibleEnvios.map((e) => (
                <Card key={e.id} variant="default" className={styles.shipmentCard}>
                  <div className={styles.shipmentHeader}>
                    <span className={styles.shipmentId}>{e.id}</span>
                    <Badge
                      variant={
                        e.status === 'enviado'
                          ? 'success'
                          : e.status === 'carga'
                          ? 'warning'
                          : 'primary'
                      }
                    >
                      {e.status === 'enviado'
                        ? 'DESPACHADO'
                        : e.status === 'carga'
                        ? 'EN CARGA'
                        : 'PROGRAMADO'}
                    </Badge>
                  </div>

                  <div className={styles.shipmentDetails}>
                    <div className={styles.shipmentDetailItem}>
                      📅 <span><strong>Fecha:</strong> {e.scheduledDate} a las {e.scheduledTime}</span>
                    </div>
                    <div className={styles.shipmentDetailItem}>
                      🧑‍✈️ <span><strong>Chofer:</strong> {e.driverName}</span>
                    </div>
                    <div className={styles.shipmentDetailItem}>
                      🚛 <span><strong>Unidad:</strong> {e.vehicleInfo}</span>
                    </div>
                    <div className={styles.shipmentDetailItem}>
                      🔒 <span><strong>Candado/Sello:</strong> {e.lockNumber || 'Por registrar'}</span>
                    </div>
                  </div>

                  <div className={styles.shipmentItemsTitle}>Materiales y Destinos del Embarque:</div>
                  <div className={styles.shipmentItemsList}>
                    {e.items.map((item, index) => (
                      <div key={index} className={styles.shipmentItemRow} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px', borderBottom: '1px solid var(--color-gray-100)', paddingBottom: '8px', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontWeight: '600' }}>
                          <span>
                            {item.type === 'tarima' ? '📦' : item.type === 'juego' ? '🧩' : '🔧'} {item.name}
                          </span>
                          <span>x{item.quantity}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                          📁 Proyecto: {item.projectName}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-primary)', fontWeight: 'bold' }}>
                          📍 Destino: {item.destinationAddress || 'No especificada'}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={styles.shipmentActions}>
                    {!readOnly && e.status === 'programado' && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleEditShipment(e)}
                        >
                          ✏️ Editar
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            deleteEnvio(e.id);
                            toast.info(`Envío ${e.id} cancelado.`);
                          }}
                          style={{ color: 'var(--color-danger)' }}
                        >
                          ❌ Cancelar
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================
          TABLERO DE CONTROL: PERSONAL Y HORAS EXTRAS DE PRODUCTO TERMINADO
          ============================================ */}
      <div style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {/* Panel de Personal de Producto Terminado — mismo gate que "Personal del Área"
            en ProduccionPage.jsx: Supervisor de Área/Admin o Encargado de Área. */}
        {(canManageJornada || user?.roleType === ROLE_TYPES.ENCARGADO_AREA) && (
        <Card variant="default">
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', gap: '12px' }}>
            <h3 className={styles.columnTitle} style={{ margin: 0 }}>
              👥 Personal del Área de Producto Terminado ({ptOperarios.length})
            </h3>
          </div>

          {ptOperarios.length === 0 ? (
            <EmptyState
              message="No hay personal asignado a esta área actualmente."
              shape="cacahuate"
              color={activeArea?.color || 'var(--color-gray-300)'}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {ptOperarios.map((op) => {
                // op.schedule NO se limpia al pasar el día — sigue trayendo lo último que
                // se autorizó aunque haya sido hace una semana. Por eso el horario propio
                // (startHour/endHour) solo se muestra si esa autorización es de HOY
                const opRecentHEs = horasExtra.filter(
                  (h) => h.operarioId === op.id && h.authorizedDate === todayStr && h.verificationStatus !== 'cancelado'
                );
                const activeTodayHE = opRecentHEs[0];
                const isOpActive = !op.estado?.tipo || op.estado.tipo === 'activo';
                const hasOvertimeToday = isOpActive && (Boolean(activeTodayHE) || (op.schedule?.overtimeHours > 0 && op.schedule?.authorizedDate === todayStr));
                const effectiveStartHour = activeTodayHE ? activeTodayHE.startHour : (hasOvertimeToday ? op.schedule.startHour : 8);
                const effectiveEndHour = activeTodayHE ? activeTodayHE.endHour : (hasOvertimeToday ? op.schedule.endHour : (isSat ? 13 : 18));
                const effectiveOvertimeHours = activeTodayHE ? activeTodayHE.overtimeHours : (hasOvertimeToday ? op.schedule.overtimeHours : 0);

                const startStr = formatHourLabel(hasOvertimeToday ? effectiveStartHour : 8);
                const endStr = formatHourLabel(hasOvertimeToday ? effectiveEndHour : (isSat ? 13 : 18));
                const isExpanded = expandedOvertimeOperarios.has(op.id);

                return (
                  <div
                    key={op.id}
                    style={{
                      border: '1px solid var(--color-gray-200)', borderRadius: '8px', padding: '12px 16px',
                      display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong>{op.name || 'Sin Nombre'}</strong>
                        <Badge variant={PUESTO_BADGE_VARIANT[op.puesto] || 'neutral'}>
                          {PUESTO_ICONS[op.puesto]} {PUESTO_LABELS[op.puesto]}
                        </Badge>
                        {op.estado?.tipo && op.estado.tipo !== 'activo' && (
                          <Badge variant={ESTADO_BADGE_VARIANT[op.estado.tipo] || 'danger'} size="sm">
                            {ESTADO_ICONS[op.estado.tipo] || '🚫'} {ESTADO_LABELS[op.estado.tipo] || 'Ausente'}
                          </Badge>
                        )}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                        ⏰ Jornada: {startStr} - {endStr}
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
        )}

        {/* Solicitudes de Horas Extras de Producto Terminado */}
        <Card variant="default">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: 'var(--space-4)' }}>
            <h3 className={styles.columnTitle} style={{ margin: 0 }}>
              📋 Solicitudes de Horas Extras — Producto Terminado ({ptSolicitudes.length})
            </h3>
          </div>

          {ptSolicitudes.length === 0 ? (
            <div style={{ padding: '16px', color: 'var(--color-gray-500)', textAlign: 'center', fontSize: '13px' }}>
              No se han registrado solicitudes de horas extras para Producto Terminado todavía. Usa el botón "⏰ Solicitar Horas Extras" de arriba para crear una.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {ptSolicitudes.slice(0, 15).map((sol) => (
                <div
                  key={sol.id}
                  style={{
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
                    gap: '8px', padding: '12px 16px', background: sol.status === 'pendiente' ? '#fffbeb' : '#f8fafc',
                    borderRadius: '8px', border: sol.status === 'pendiente' ? '1px solid #fde68a' : '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong>{sol.operarioName}</strong>
                      <span style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                        (Producto Terminado)
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-gray-800)' }}>
                      ⏱️ <strong>{sol.horas}h</strong> {sol.bloque === 'domingo' ? '(📅 Domingo Completo)' : `extra (${sol.bloque === 'matutino' ? '🌅 Matutino' : '🌆 Vespertino'})`} para el 📅 <strong>{sol.fecha}</strong>
                    </div>
                    {sol.motivo && (
                      <div style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                        Motivo/Tareas: <em>"{sol.motivo}"</em>
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>
                      Solicitado por: <strong>{sol.solicitadoPor}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {sol.status === 'pendiente' && <Badge variant="warning">🟡 Pendiente</Badge>}
                    {sol.status === 'autorizada' && <Badge variant="success">🟢 Autorizada por {sol.revisadoPor}</Badge>}
                    {sol.status === 'rechazada' && <Badge variant="danger">🔴 Rechazada por {sol.revisadoPor}</Badge>}
                    {sol.status === 'cancelada' && <Badge variant="neutral">⚪ Cancelada</Badge>}

                    {(sol.status === 'pendiente' || sol.status === 'autorizada') && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEditOvertimeRequestModal(sol)}
                        >
                          ✏️ Modificar
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelOvertimeRequest(sol)}
                          style={{ color: 'var(--color-alert)' }}
                        >
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
      </div>

      {/* ============================================
          MODAL CREAR TARIMA
          ============================================ */}
      <Modal isOpen={isPalletModalOpen} onClose={handleClosePalletModal} title="Configurar Tarima con Piezas Recibidas">
        <form onSubmit={handleCreatePalletSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Identificador / Nombre de la Tarima</label>
            <input
              type="text"
              required
              className={styles.textInput}
              placeholder="Ej: Tarima A - Estructuras Metálicas"
              value={newPallet.name}
              onChange={(e) => setNewPallet((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Peso Estimado (kg) *</label>
              <input
                type="number"
                min="1"
                required
                className={styles.textInput}
                placeholder="Ej: 350"
                value={newPallet.weight}
                onChange={(e) => setNewPallet((prev) => ({ ...prev, weight: e.target.value }))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Cargar Excel de Packing List (Opcional)</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                id="packing-list-upload"
                onChange={handlePackingListExcelChange}
              />
              <label
                htmlFor="packing-list-upload"
                className={styles.textInput}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  borderStyle: 'dashed',
                  borderColor: 'var(--color-primary)',
                  backgroundColor: 'rgba(255, 30, 30, 0.03)',
                  fontWeight: '600',
                  color: 'var(--color-primary)',
                  height: '42px',
                  padding: '0'
                }}
              >
                📥 {newPallet.packingListFile ? newPallet.packingListFile : 'Subir Archivo Excel'}
              </label>
            </div>
          </div>

          <div className={styles.formGroup}>
            <Select
              label="Proyecto Destino"
              value={newPallet.projectId}
              onChange={(e) =>
                setNewPallet((prev) => ({ ...prev, projectId: e.target.value, selectedBulkItems: {} }))
              }
              options={proyectos.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>

          {/* Listado de piezas libres del proyecto */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Seleccionar Piezas a Colocar en la Tarima</label>
            <div className={styles.itemsSelectionBox} style={{ maxHeight: '260px' }}>
              {bulkItemsForSelectedProject.map((item) => {
                const key = `${item.gameId}_${item.areaId}`;
                const isSelected = newPallet.selectedBulkItems[key] !== undefined;
                const currentVal = newPallet.selectedBulkItems[key] || '';

                return (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--color-gray-100)',
                    }}
                  >
                    <label className={styles.checkboxLabel} style={{ flexGrow: 1 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleBulkItemForPallet(key, item.available)}
                      />
                      <span>
                        {item.areaIcon} {item.gameName} ({item.areaName})
                      </span>
                    </label>
                    
                    {isSelected && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>
                          Cant:
                        </span>
                        <input
                          type="number"
                          min="1"
                          max={item.available}
                          required
                          className={styles.textInput}
                          style={{ width: '65px', padding: '4px var(--space-2)', fontSize: '12px' }}
                          value={currentVal}
                          onChange={(e) =>
                            handleBulkItemQtyChange(key, e.target.value, item.available)
                          }
                        />
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                          / {item.available}
                        </span>
                      </div>
                    )}

                    {!isSelected && (
                      <span style={{ fontSize: '12px', color: 'var(--color-gray-500)', fontWeight: 'bold' }}>
                        {item.available} pzas
                      </span>
                    )}
                  </div>
                );
              })}

              {bulkItemsForSelectedProject.length === 0 && (
                <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                  No hay piezas disponibles para este proyecto en el almacén de PT.
                </span>
              )}
            </div>
          </div>

          {/* Refacciones / Insumos adicionales */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Agregar Refacciones / Material Extra (Opcional)</label>
            <div className={styles.dynamicRow}>
              <input
                type="text"
                className={styles.textInput}
                placeholder="Nombre del material (Ej: Tornillo de expansión 1/2)"
                value={extraItemInput.name}
                style={{ flexGrow: 1 }}
                onChange={(e) => setExtraItemInput((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                type="number"
                min="1"
                className={styles.textInput}
                value={extraItemInput.quantity}
                style={{ width: '80px' }}
                onChange={(e) =>
                  setExtraItemInput((prev) => ({ ...prev, quantity: Math.max(1, Number(e.target.value)) }))
                }
              />
              <Button type="button" variant="secondary" size="md" onClick={handleAddExtraItemToPallet}>
                ＋
              </Button>
            </div>

            {/* Listado temporal de extras agregados */}
            <div className={styles.palletItemList} style={{ marginTop: '8px' }}>
              {newPallet.extraItems.map((item, idx) => (
                <div key={idx} className={styles.palletItemRow}>
                  <span>🔧 {item.name}</span>
                  <div>
                    <strong style={{ marginRight: '12px' }}>x{item.quantity}</strong>
                    <button
                      type="button"
                      onClick={() => handleRemoveExtraItemFromPallet(idx)}
                      style={{ color: 'var(--color-danger)', border: 'none', background: 'none', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.row} style={{ marginTop: '12px' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleClosePalletModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="md">
              Crear Tarima
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================
          MODAL PROGRAMAR ENVÍO
          ============================================ */}
      <Modal isOpen={isShipmentModalOpen} onClose={handleCloseShipmentModal} title={editingShipmentId ? "Editar Embarque / Envío" : "Programar Embarque / Envío"}>
        <form onSubmit={handleCreateShipmentSubmit} className={styles.form}>
          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Fecha Programada</label>
              <input
                type="date"
                required
                className={styles.textInput}
                value={newShipment.scheduledDate}
                onChange={(e) => setNewShipment((prev) => ({ ...prev, scheduledDate: e.target.value }))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Hora Programada</label>
              <input
                type="time"
                className={styles.textInput}
                value={newShipment.scheduledTime}
                onChange={(e) => setNewShipment((prev) => ({ ...prev, scheduledTime: e.target.value }))}
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Chofer Responsable</label>
              <input
                type="text"
                className={styles.textInput}
                placeholder="Nombre del chofer"
                value={newShipment.driverName}
                onChange={(e) => setNewShipment((prev) => ({ ...prev, driverName: e.target.value }))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Vehículo e Identificación</label>
              <input
                type="text"
                className={styles.textInput}
                placeholder="Camión, placas, etc."
                value={newShipment.vehicleInfo}
                onChange={(e) => setNewShipment((prev) => ({ ...prev, vehicleInfo: e.target.value }))}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Número de Candado / Sello de Seguridad *</label>
            <input
              type="text"
              required
              className={styles.textInput}
              placeholder="Ej: LOCK-98124"
              value={newShipment.lockNumber}
              onChange={(e) => setNewShipment((prev) => ({ ...prev, lockNumber: e.target.value }))}
            />
          </div>

          {/* Selección de Tarimas disponibles */}
          <div className={styles.row}>
            <div className={styles.formGroup} style={{ flex: 1 }}>
              <label className={styles.label}>Seleccionar Tarimas a Cargar</label>
              <div className={styles.itemsSelectionBox} style={{ maxHeight: '300px' }}>
                {availableTarimas.map((t) => {
                  const isChecked = newShipment.selectedTarimas[t.id] !== undefined;
                  const addressVal = newShipment.selectedTarimas[t.id]?.destinationAddress || '';
                  return (
                    <div key={t.id} style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', borderBottom: '1px solid var(--color-gray-100)' }}>
                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTarimaForShipment(t.id)}
                        />
                        <span>📦 {t.name} (Proj: {t.projectName} | ⚖️ {t.weight} kg)</span>
                      </label>
                      {isChecked && (
                        <input
                          type="text"
                          required
                          className={styles.textInput}
                          style={{ marginTop: '6px', fontSize: '12px', padding: '6px var(--space-2)' }}
                          placeholder="Ingresa la dirección de entrega de esta tarima"
                          value={addressVal}
                          onChange={(e) => handleTarimaAddressChange(t.id, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}

                {availableTarimas.length === 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                    No hay tarimas preparadas listas en el almacén.
                  </span>
                )}
              </div>
            </div>

            {/* Selección de juegos (con verificación de terminación en PT) */}
            <div className={styles.formGroup} style={{ flex: 1 }}>
              <label className={styles.label}>Seleccionar Juegos Completos Sueltos (Verificados por PT)</label>
              <div className={styles.itemsSelectionBox} style={{ maxHeight: '300px' }}>
                {gamesForShipmentSelection.map((j) => {
                  const isFinishedInPT = j.progress === 100 && j.areaStatus?.['producto-terminado'] === 'completado';
                  const isChecked = newShipment.selectedGames[j.id] !== undefined;
                  const addressVal = newShipment.selectedGames[j.id]?.destinationAddress || '';

                  return (
                    <div key={j.id} style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', borderBottom: '1px solid var(--color-gray-100)' }}>
                      <label className={styles.checkboxLabel} style={{ opacity: isFinishedInPT ? 1 : 0.6 }}>
                        <input
                          type="checkbox"
                          disabled={!isFinishedInPT}
                          checked={isChecked}
                          onChange={() => handleToggleGameForShipment(j.id)}
                        />
                        <span>
                          🧩 {j.name} (Proj: {j.projectName})
                        </span>
                        <span style={{ marginLeft: '6px' }}>
                          <Badge variant={isFinishedInPT ? 'success' : 'danger'}>
                            {isFinishedInPT ? 'RECIBIDO EN PT' : 'EN MANUFACTURA'}
                          </Badge>
                        </span>
                      </label>

                      {isChecked && isFinishedInPT && (
                        <input
                          type="text"
                          required
                          className={styles.textInput}
                          style={{ marginTop: '6px', fontSize: '12px', padding: '6px var(--space-2)' }}
                          placeholder="Ingresa la dirección de entrega de este juego"
                          value={addressVal}
                          onChange={(e) => handleGameAddressChange(j.id, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}

                {gamesForShipmentSelection.length === 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                    No hay juegos sueltos disponibles para cargar.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Refacciones directas en el envío */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Cargar Refacciones / Materiales Sueltos Adicionales (Opcional)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className={styles.dynamicRow}>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="Descripción de la pieza (Ej: Lonas, Tornillería)"
                  value={shipmentExtraInput.name}
                  style={{ flex: 2 }}
                  onChange={(e) => setShipmentExtraInput((prev) => ({ ...prev, name: e.target.value }))}
                />
                <input
                  type="number"
                  min="1"
                  className={styles.textInput}
                  value={shipmentExtraInput.quantity}
                  style={{ width: '80px' }}
                  onChange={(e) =>
                    setShipmentExtraInput((prev) => ({ ...prev, quantity: Math.max(1, Number(e.target.value)) }))
                  }
                />
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="Proyecto de referencia (Ej: Chapultepec)"
                  value={shipmentExtraInput.projectName}
                  style={{ flex: 1 }}
                  onChange={(e) => setShipmentExtraInput((prev) => ({ ...prev, projectName: e.target.value }))}
                />
              </div>
              <div className={styles.dynamicRow}>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="Dirección de entrega de esta refacción"
                  value={shipmentExtraInput.destinationAddress}
                  style={{ flexGrow: 1 }}
                  onChange={(e) => setShipmentExtraInput((prev) => ({ ...prev, destinationAddress: e.target.value }))}
                />
                <Button type="button" variant="secondary" size="md" onClick={handleAddExtraItemToShipment}>
                  ＋ Agregar Refacción
                </Button>
              </div>
            </div>

            <div className={styles.palletItemList} style={{ marginTop: '12px' }}>
              {newShipment.extraItems.map((item, idx) => (
                <div key={idx} className={styles.palletItemRow} style={{ flexDirection: 'column', alignItems: 'flex-start', borderBottom: '1px solid var(--color-gray-100)', paddingBottom: '6px', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>🔧 <strong>{item.name}</strong> (x{item.quantity})</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveExtraItemFromShipment(idx)}
                      style={{ color: 'var(--color-danger)', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      ✕
                    </button>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--color-gray-600)' }}>
                    Proyecto: {item.projectName || 'General'} | Destino: {item.destinationAddress}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.row} style={{ marginTop: '12px' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseShipmentModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="md">
              {editingShipmentId ? 'Guardar Cambios' : 'Programar Envío'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================
          MODAL: REGRESAR ENTREGA AL ÁREA DE ORIGEN
          ============================================ */}
      <Modal
        isOpen={returnModal.isOpen}
        onClose={handleCloseReturnModal}
        title={`↩️ Regresar Entrega: ${returnModal.item?.gameName || ''} (${returnModal.item?.areaName || ''})`}
      >
        <form onSubmit={handleSubmitReturnModal} className={styles.form}>
          <p style={{ fontSize: '12px', color: 'var(--color-gray-600)', marginTop: 0 }}>
            Esto quita la entrega de la cola de Producto Terminado y marca la revisión de Calidad
            de esta área como rechazada, para que el área retrabaje y solicite una nueva revisión
            antes de poder volver a notificar.
          </p>
          <div className={styles.formGroup}>
            <label className={styles.label}>Motivo por el que se regresa</label>
            <textarea
              rows="3"
              required
              className={styles.textInput}
              placeholder="Ej: Se detectó una pieza con medida incorrecta antes de recibir el lote..."
              value={returnModal.notes}
              onChange={(e) => setReturnModal((prev) => ({ ...prev, notes: e.target.value }))}
            />
          </div>
          <div className={styles.row} style={{ marginTop: '12px' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseReturnModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" size="md">
              Regresar al Área
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================
          MODAL: VERIFICACIÓN Y RECEPCIÓN CON CHECKLIST
          ============================================ */}
      <Modal
        isOpen={Boolean(selectedDelivery)}
        onClose={handleCloseReceptionModal}
        title={`📋 Recepción y Checklist: ${selectedDelivery?.gameName} (${selectedDelivery?.areaName})`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <strong>Proyecto:</strong> {selectedDelivery?.projectName} <br />
            <strong>Lote manufacturado:</strong> {selectedDelivery?.totalProduced} / {selectedDelivery?.target} piezas
          </div>

          <div style={{ height: '1px', background: 'var(--color-gray-200)', margin: '8px 0' }} />

          {/* MODO EDICIÓN DEL TEMPLATE CHECKLIST */}
          {isChecklistEditing ? (
            <div>
              <h4 style={{ marginBottom: '8px', color: 'var(--color-secondary)' }}>
                ⚙️ Configurar Checklist (Manual la primera vez o reeditar)
              </h4>

              <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: 'bold', color: checklistRemainingQty === 0 ? 'var(--color-success)' : 'var(--color-gray-600)' }}>
                📦 Piezas asignadas: {checklistAssignedQty} / {checklistExpectedQty} {checklistRemainingQty === 0 && '(completo)'}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="text"
                  placeholder="Descripción del componente (Ej: Postes, Tornillos)"
                  value={newChecklistItem.text}
                  onChange={(e) => setNewChecklistItem(prev => ({ ...prev, text: e.target.value }))}
                  className={styles.textInput}
                  style={{ flexGrow: 1 }}
                  disabled={checklistRemainingQty === 0}
                />
                <input
                  type="number"
                  min="1"
                  max={checklistRemainingQty}
                  placeholder="Cant"
                  value={newChecklistItem.quantity}
                  onChange={(e) => setNewChecklistItem(prev => ({ ...prev, quantity: Math.min(checklistRemainingQty, Math.max(1, Number(e.target.value) || 1)) }))}
                  className={styles.textInput}
                  style={{ width: '70px' }}
                  disabled={checklistRemainingQty === 0}
                />
                <Button type="button" variant="secondary" size="md" onClick={handleAddChecklistItem} disabled={checklistRemainingQty === 0}>
                  ➕ Añadir
                </Button>
              </div>

              <div className={styles.itemsSelectionBox} style={{ maxHeight: '200px', padding: '8px', background: 'var(--color-gray-50)', borderRadius: '8px', border: '1px solid var(--color-gray-200)' }}>
                {checklistItems.map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-gray-100)' }}>
                    <span>🧩 {item.text} <strong>(x{item.quantity})</strong></span>
                    <button
                      type="button"
                      onClick={() => handleRemoveChecklistItem(item.id)}
                      style={{ color: 'var(--color-danger)', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {checklistItems.length === 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--color-gray-500)', display: 'block', textAlign: 'center', padding: '12px' }}>
                    Agrega los componentes/piezas de este juego para crear el checklist.
                  </span>
                )}
              </div>

              <div className={styles.row} style={{ marginTop: '16px' }}>
                {selectedDelivery?.checklist?.length > 0 && (
                  <Button type="button" variant="secondary" size="md" onClick={() => setIsChecklistEditing(false)}>
                    Regresar
                  </Button>
                )}
                <Button 
                  type="button" 
                  variant="primary" 
                  size="md" 
                  onClick={handleSaveChecklist}
                  disabled={checklistItems.length === 0}
                >
                  💾 Guardar Checklist
                </Button>
              </div>
            </div>
          ) : (
            /* MODO VERIFICACIÓN CHECKLIST */
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, color: 'var(--color-secondary)' }}>
                  ✅ Marcar componentes listos y correctos:
                </h4>
                <Button 
                  type="button" 
                  variant="secondary" 
                  size="sm" 
                  onClick={() => setIsChecklistEditing(true)}
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                >
                  ✏️ Reeditar Checklist
                </Button>
              </div>

              <div className={styles.itemsSelectionBox} style={{ maxHeight: '250px', padding: '8px', background: 'var(--color-gray-50)', borderRadius: '8px', border: '1px solid var(--color-gray-200)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {checklistItems.map((item) => (
                  <label 
                    key={item.id} 
                    className={styles.checkboxLabel}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      padding: '8px', 
                      background: item.checked ? 'rgba(16, 185, 129, 0.05)' : 'white',
                      border: '1px solid',
                      borderColor: item.checked ? 'rgba(16, 185, 129, 0.3)' : 'var(--color-gray-200)',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => handleCheckItem(item.id)}
                    />
                    <span style={{ textDecoration: item.checked ? 'line-through' : 'none', color: item.checked ? 'var(--color-gray-500)' : 'var(--color-dark)' }}>
                      <strong>{item.quantity}x</strong> {item.text}
                    </span>
                  </label>
                ))}

                {checklistItems.length === 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--color-gray-500)', display: 'block', textAlign: 'center', padding: '12px' }}>
                    No hay checklist configurado. Usa el botón superior para crearlo.
                  </span>
                )}
              </div>

              {/* EVIDENCIA FOTOGRÁFICA DE LO RECIBIDO */}
              <div className={styles.formGroup} style={{ marginTop: '16px' }}>
                <label className={styles.label}>Evidencia Fotográfica de lo Recibido</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  style={{ display: 'none' }}
                  id="pt-reception-photo-capture"
                  onChange={handleAddReceptionPhotos}
                  disabled={isUploadingReceptionPhotos}
                />
                <label
                  htmlFor="pt-reception-photo-capture"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: isUploadingReceptionPhotos ? 'wait' : 'pointer',
                    border: '1px dashed var(--color-primary)',
                    backgroundColor: 'rgba(255, 51, 0, 0.03)',
                    fontWeight: '600',
                    color: 'var(--color-primary)',
                    height: '42px',
                    borderRadius: '8px',
                    opacity: isUploadingReceptionPhotos ? 0.6 : 1,
                  }}
                >
                  {isUploadingReceptionPhotos ? '⏳ Subiendo...' : '📷 Agregar Evidencia'}
                </label>

                {receptionPhotos.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                    {receptionPhotos.map((photo, idx) => (
                      <div key={photo.path || idx} style={{ position: 'relative' }}>
                        <img
                          src={photo.url}
                          alt={`Evidencia de recepción ${idx + 1}`}
                          style={{
                            width: '64px',
                            height: '64px',
                            objectFit: 'cover',
                            borderRadius: '8px',
                            border: '1px solid var(--color-gray-200)',
                            cursor: 'pointer',
                          }}
                          onClick={() => setReceptionPhotoPreview(photo.url)}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveReceptionPhoto(photo)}
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

              <div className={styles.row} style={{ marginTop: '16px' }}>
                <Button type="button" variant="secondary" size="md" onClick={handleCloseReceptionModal}>
                  Cancelar
                </Button>
                <Button 
                  type="button" 
                  variant="primary" 
                  size="md" 
                  onClick={handleConfirmReception}
                  disabled={checklistItems.length === 0 || !checklistItems.every(i => i.checked)}
                >
                  Confirmar y Recibir Lote
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL: VISTA AMPLIADA DE EVIDENCIA DE RECEPCIÓN */}
      {receptionPhotoPreview && (
        <Modal isOpen={Boolean(receptionPhotoPreview)} onClose={() => setReceptionPhotoPreview(null)} title="📷 Evidencia de Recepción">
          <img src={receptionPhotoPreview} alt="Evidencia de recepción ampliada" style={{ width: '100%', borderRadius: '8px' }} />
        </Modal>
      )}

      {/* MODAL: SOLICITAR HORAS EXTRAS */}
      {requestOvertimeModal.isOpen && (() => {
        const selectedOp = ptOperarios.find((o) => o.id === requestOvertimeModal.operarioId);
        const eligibility = selectedOp
          ? checkOvertimeEligibility(selectedOp, requestOvertimeModal.fecha)
          : { isEligible: true, reason: '' };

        return (
          <Modal
            isOpen={requestOvertimeModal.isOpen}
            onClose={handleCloseRequestOvertimeModal}
            title="⏰ Solicitar Horas Extras — Producto Terminado"
          >
            <form onSubmit={handleSubmitOvertimeRequest}>
              <div className={styles.formGroup}>
                <Select
                  label="Colaborador para Horas Extras"
                  value={requestOvertimeModal.operarioId}
                  onChange={(e) => setRequestOvertimeModal((prev) => ({ ...prev, operarioId: e.target.value }))}
                  required
                  placeholder="-- Selecciona el colaborador --"
                  options={ptOperarios.map((op) => ({
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
                  placeholder="Especifica detalladamente las tareas de empaque / tarimas / despacho..."
                  value={requestOvertimeModal.motivo}
                  onChange={(e) => setRequestOvertimeModal((prev) => ({ ...prev, motivo: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <Button type="button" variant="secondary" onClick={handleCloseRequestOvertimeModal}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={!eligibility.isEligible}>
                  Enviar Solicitud
                </Button>
              </div>
            </form>
          </Modal>
        );
      })()}

      {/* MODAL: MODIFICAR SOLICITUD DE HORAS EXTRAS */}
      {editOvertimeRequestModal.isOpen && editOvertimeRequestModal.solicitud && (() => {
        const sol = editOvertimeRequestModal.solicitud;
        const op = ptOperarios.find((o) => o.id === sol.operarioId);
        const eligibility = checkOvertimeEligibility(op, editOvertimeRequestModal.fecha);

        return (
          <Modal
            isOpen={editOvertimeRequestModal.isOpen}
            onClose={handleCloseEditOvertimeRequestModal}
            title={`✏️ Modificar Solicitud — ${sol.operarioName}`}
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
                  ✅ Colaborador habilitado para solicitar tiempo extra el {editOvertimeRequestModal.fecha}.
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

      {/* MODAL: GESTIÓN DE JORNADA / AUTORIZAR TIEMPO EXTRA */}
      {scheduleModal.isOpen && scheduleModal.collaborator && (
        <Modal
          isOpen={scheduleModal.isOpen}
          onClose={handleCloseScheduleModal}
          title={`Gestión de Jornada: ${scheduleModal.collaborator.name}`}
        >
          <form onSubmit={handleSaveSchedule} className={styles.form}>
            <div style={{ display: 'flex', gap: 'var(--space-5)', padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)', fontSize: 'var(--body-size)' }}>
              <div>
                <strong>Colaborador:</strong> {scheduleModal.collaborator.name}
              </div>
              <div>
                <strong>Área Actual:</strong> Producto Terminado
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
                  placeholder="Ej: Terminar empaque de 20 piezas del pedido X, consolidar tarima para despacho..."
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
              <Button type="button" variant="secondary" onClick={handleCloseScheduleModal} disabled={isSavingSchedule}>
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
                placeholder="Ej: Solo terminó la mitad del empaque, no se consolidó la tarima..."
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
    </motion.div>
  );
}

ProductoTerminadoPanel.propTypes = {
  activeArea: PropTypes.object.isRequired,
  // Ausente para roles restringidos a esta única área (Encargado/Supervisor de Área):
  // el selector general de /produccion no les está permitido, así que no hay a dónde
  // "volver" — el botón simplemente no se muestra (ver ProduccionPage.jsx).
  onBack: PropTypes.func,
  readOnly: PropTypes.bool,
};

ProductoTerminadoPanel.defaultProps = {
  readOnly: false,
};
