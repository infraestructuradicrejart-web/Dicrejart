/**
 * @file CalidadPage.jsx
 * @description Página de Gestión de Calidad e Inspecciones de Dicrejart
 * Permite registrar inspecciones de piezas y calificar el desempeño de los operarios por bloques de horarios
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import useToast from '../../hooks/useToast';
import useOperarios from '../../hooks/useOperarios';
import useCalidad from '../../hooks/useCalidad';
import useProduccion from '../../hooks/useProduccion';
import useAuth from '../../hooks/useAuth';
import PageHeader from '../../components/ui/PageHeader';
import { isReadOnlySection } from '../../utils/roleAccess';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import { getOvertimeBlocks } from '../../utils/overtimeUtils';
import useProgressiveList from '../../hooks/useProgressiveList';
import styles from './CalidadPage.module.css';

/**
 * Áreas de manufactura configuradas
 * @constant
 */
const AREAS = [
  { id: 'almacen', name: 'Almacén' },
  { id: 'corte-laser', name: 'Corte Laser' },
  { id: 'herreria', name: 'Herrería' },
  { id: 'carpinteria', name: 'Carpintería' },
  { id: 'costura-acc', name: 'Costura Accesorios' },
  { id: 'costura-colch', name: 'Costura Colchonetas' },
  { id: 'mantenimiento', name: 'Mantenimiento' },
  { id: 'producto-terminado', name: 'Producto Terminado' },
];

/** Áreas de manufactura que entregan a PT (excluye Producto Terminado, que no se entrega a sí mismo) */
const MANUFACTURING_AREAS = AREAS.filter((a) => a.id !== 'producto-terminado');

/**
 * Tipos comunes de defectos
 * @constant
 */
const DEFECT_TYPES = [
  'Ninguno',
  'Costura Abierta / Defectuosa',
  'Dimensiones fuera de tolerancia',
  'Soldadura porosa / débil',
  'Pintura escurrida / rayada',
  'Madera astillada / mal lijada',
  'Falta de material / herraje',
  'Mancha / suciedad en tela',
  'Otro defecto',
];

/**
 * Genera dinámicamente los bloques de horario laboral basados en la frecuencia global
 * y la hora máxima de salida en taller para ese día.
 *
 * @param {number} blockDuration - Frecuencia de los bloques en horas (1, 2, 3)
 * @param {number} maxEndHour - Hora límite de salida en el taller
 * @returns {Array<Object>} Bloques generados
 */
const generateWorkBlocks = (blockDuration, minStartHour, maxEndHour) => {
  const blocks = [];
  const duration = Number(blockDuration || 2);
  
  let current = Number(minStartHour || 8);
  let blockIndex = 1;
  
  while (current < maxEndHour) {
    const next = Math.min(current + duration, maxEndHour);
    const startStr = String(current).padStart(2, '0');
    const endStr = String(next).padStart(2, '0');
    
    blocks.push({
      id: `b-${current}-${next}`,
      name: `Bloque ${blockIndex}`,
      timeRange: `${startStr}:00 - ${endStr}:00`,
      startHour: current,
      endHour: next,
    });
    
    current = next;
    blockIndex += 1;
  }
  
  return blocks;
};

/**
 * Determina qué bloque de horario está activo en tiempo real
 * @param {Array<Object>} blocks - Bloques de horarios activos
 * @returns {string|null} ID del bloque activo, o null si está fuera de horario laboral
 */
const getLiveBlockId = (blocks) => {
  const now = new Date();
  const currentHour = now.getHours();
  const activeBlock = blocks.find(
    (b) => currentHour >= b.startHour && currentHour < b.endHour
  );
  return activeBlock ? activeBlock.id : null;
};

/**
 * Resuelve la variante visual del Badge según la puntuación
 * @param {number} score
 * @returns {string} Variant name
 */
const getScoreVariant = (score) => {
  if (score >= 9) return 'success';
  if (score >= 7) return 'warning';
  return 'danger';
};

/**
 * Devuelve la URL para mostrar una foto de evidencia ya guardada: las inspecciones
 * guardadas antes de migrar a Firebase Storage tienen sus fotos como texto base64
 * directo (string); las nuevas se guardan como `{ url, path }` de Storage. Este helper
 * permite mostrar ambos formatos sin necesidad de migrar los datos antiguos.
 * @param {string|{url: string, path: string}} photo
 * @returns {string}
 */
const getPhotoSrc = (photo) => (typeof photo === 'string' ? photo : photo?.url);

/**
 * Componente CalidadPage - Gestión de inspecciones y calidad operativa
 * @component
 * @returns {ReactElement} Render de la página de calidad
 */
const CalidadPage = () => {
  // ============================================
  // ESTADO Y CONTEXTOS
  // ============================================
  // Permite llegar directo a una pestaña específica (ej. desde la alerta de horas extra
  // pendientes en PendingOvertimeAlert.jsx, que navega con state: { openTab: 'horasExtra' })
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(() => location.state?.openTab || 'auditoria');
  const [evalAreaId, setEvalAreaId] = useState('corte-laser');
  
  // Auditoría de Juegos (Pestaña 1)
  const {
    inspecciones,
    evaluaciones,
    addInspeccion,
    editInspeccion,
    deleteInspeccion,
    saveEvaluacion,
    addEvidenceToInspeccion,
    removeEvidenceFromInspeccion,
  } = useCalidad();
  const [newInspection, setNewInspection] = useState({
    areaId: 'corte-laser',
    gameName: '',
    inspector: '',
    score: '10',
    status: 'aprobado',
    pieceName: '',
    hasDefect: false,
    defectType: 'Ninguno',
    defectAction: 'retrabajo',
    notes: '',
    photos: [],
  });

  // Revoca los blob URLs de fotos pendientes (no enviadas) al salir de la página, para
  // no dejarlos retenidos en memoria mientras la pestaña siga viva
  const newInspectionPhotosRef = useRef(newInspection.photos);
  useEffect(() => { newInspectionPhotosRef.current = newInspection.photos; }, [newInspection.photos]);
  useEffect(() => {
    return () => { newInspectionPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)); };
  }, []);

  // Seguimiento de pieza: 'nueva' (pieza recién detectada) o 'seguimiento' (continuación
  // de una pieza ya existente, elegida explícitamente por su ID único, nunca por nombre)
  const [followUpMode, setFollowUpMode] = useState('nueva');
  const [followUpTargetId, setFollowUpTargetId] = useState('');

  // Estados para edición de auditorías de calidad
  const [editingInspection, setEditingInspection] = useState(null);
  const [editInspectionForm, setEditInspectionForm] = useState({
    status: 'aprobado',
    pieceName: '',
    defectType: '',
    defectAction: 'retrabajo',
    notes: '',
  });
  const [isEditInspectionModalOpen, setIsEditInspectionModalOpen] = useState(false);
  const [editInspectionPhotos, setEditInspectionPhotos] = useState([]);
  const [isUploadingEditInspectionPhotos, setIsUploadingEditInspectionPhotos] = useState(false);

  // Estado para la confirmación de eliminación de auditoría
  const [deleteConfirmation, setDeleteConfirmation] = useState({
    isOpen: false,
    inspectionId: null,
    gameName: '',
  });

  // Foto de evidencia mostrada en grande dentro del modal de vista previa
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isSubmittingInspection, setIsSubmittingInspection] = useState(false);

  const [evalModal, setEvalModal] = useState({
    isOpen: false,
    collaborator: null,
    block: null,
    score: '10',
    notes: '',
  });

  const { operarios, blockDuration, updateBlockDuration, horasExtra, verifyHorasExtra, correctHorasExtraSchedule } = useOperarios();
  const {
    juegos,
    addQualityChecklistItem,
    removeQualityChecklistItem,
    toggleQualityChecklistItem,
    approveQualityReview,
    rejectQualityReview,
    approveReceptionForPT,
  } = useProduccion();
  const { user } = useAuth();
  const toast = useToast();
  const isReadOnly = isReadOnlySection(user, 'calidad');

  // Revisión de Calidad para Entrega a PT (Pestaña 3)
  const [reviewAreaId, setReviewAreaId] = useState('corte-laser');
  const [reviewGameName, setReviewGameName] = useState('');
  const [newReviewItemText, setNewReviewItemText] = useState('');
  const [rejectModal, setRejectModal] = useState({ isOpen: false, notes: '' });

  // Verificación de horas extra ("¿de verdad se hicieron las tareas asignadas?") — ya
  // NO se autoriza tiempo extra desde Calidad (eso quedó en Operarios, a cargo del
  // supervisor del área o Admin); aquí solo se consulta y se marca el cumplimiento.
  const [horasExtraRejectModal, setHorasExtraRejectModal] = useState({ isOpen: false, horasExtraId: null, notes: '' });
  // Desplegable de tarjetas de tiempo extra por colaborador — colapsado por defecto para
  // que la tarjeta no se vuelva interminable en móvil (una tarjeta = un <tr> apilado ahí).
  const [expandedOvertimeOperarios, setExpandedOvertimeOperarios] = useState(() => new Set());
  // Corrección del horario REAL de tiempo extra (llegó/se retiró distinto a lo autorizado)
  const [scheduleCorrectionModal, setScheduleCorrectionModal] = useState({
    isOpen: false,
    horasExtraId: null,
    actualStartHour: '',
    actualEndHour: '',
    reason: '',
  });

  // Tick para forzar el recálculo del bloque activo cada 30 segundos
  const [tick, setTick] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => getTodayLocalDateStr());
  const tableContainerRef = useRef(null);

  // Pestaña "🕒 Horas Extra": junta TODAS las autorizaciones pendientes de verificar (de
  // cualquier fecha, no solo hoy) en un solo lugar, con un filtro opcional por fecha —
  // antes solo se podían revisar de una en una, día por día, desde la fecha seleccionada
  // arriba o desde el desplegable de "hoy" en Producción/Producto Terminado.
  const [pendingHEDateFilter, setPendingHEDateFilter] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Sincronizar inspector con el usuario logueado en tiempo real
  useEffect(() => {
    if (user?.name) {
      setNewInspection((prev) => ({
        ...prev,
        inspector: user.name,
      }));
    }
  }, [user]);

  // ============================================
  // GENERACIÓN DINÁMICA DE BLOQUES
  // ============================================
  const areaOperarios = useMemo(() => {
    return operarios.filter((op) => op.currentArea === evalAreaId);
  }, [operarios, evalAreaId]);

  // Revela los colaboradores del área en tandas de 15 en vez de pintar la tabla completa
  // de una vez — vuelve a empezar desde la primera tanda al cambiar de área o de fecha.
  const {
    visibleItems: visibleAreaOperarios,
    hasMore: hasMoreAreaOperarios,
    remaining: remainingAreaOperarios,
    showMore: showMoreAreaOperarios,
  } = useProgressiveList(areaOperarios, { resetKey: `${evalAreaId}-${selectedDate}` });

  const todayStr = useMemo(() => getTodayLocalDateStr(), []);
  // OJO: el horario extendido (horas extra) se calcula para la fecha SELECCIONADA en el
  // navegador de arriba (selectedDate), no para "hoy" — de lo contrario, al consultar un
  // día previo con horas extra ya autorizadas, esos bloques (ej. 06:00-08:00 o
  // 18:00-20:00) ni siquiera se generarían como columnas, y las evaluaciones de ese
  // colaborador en ese día se verían "totalmente bloqueadas" (N/A) sin explicación.
  const isSelectedDateSaturday = useMemo(() => new Date(`${selectedDate}T00:00:00`).getDay() === 6, [selectedDate]);
  const defaultEnd = useMemo(() => (isSelectedDateSaturday ? 13 : 18), [isSelectedDateSaturday]);

  // Encontrar el horario de entrada más temprano registrado para la fecha seleccionada,
  // consultando el registro auditable por fecha (horas_extra) en vez del campo "vigente
  // hoy" operarios.schedule
  const minStartHour = useMemo(() => {
    return areaOperarios.reduce((min, op) => {
      const dateRecord = horasExtra.find(
        (h) => h.operarioId === op.id && h.authorizedDate === selectedDate && h.verificationStatus !== 'cancelado'
      );
      const opStart = dateRecord ? dateRecord.startHour : 8;
      return opStart < min ? opStart : min;
    }, 8);
  }, [areaOperarios, selectedDate, horasExtra]);

  // Encontrar el horario de salida más tarde registrado para la fecha seleccionada
  const maxEndHour = useMemo(() => {
    return areaOperarios.reduce((max, op) => {
      const dateRecord = horasExtra.find(
        (h) => h.operarioId === op.id && h.authorizedDate === selectedDate && h.verificationStatus !== 'cancelado'
      );
      const opEnd = dateRecord ? dateRecord.endHour : defaultEnd;
      return opEnd > max ? opEnd : max;
    }, defaultEnd);
  }, [areaOperarios, defaultEnd, selectedDate, horasExtra]);

  // Generar bloques correspondientes a la duración elegida y la jornada extendida máxima
  const activeBlocks = useMemo(() => {
    return generateWorkBlocks(blockDuration, minStartHour, maxEndHour);
  }, [blockDuration, minStartHour, maxEndHour]);

  // Determinar bloque activo en curso
  const liveBlockId = useMemo(() => {
    return getLiveBlockId(activeBlocks);
  }, [activeBlocks, tick]);

  // Evaluaciones correspondientes a la fecha seleccionada en el calendario
  const dailyEvaluaciones = useMemo(() => {
    return evaluaciones.filter((ev) => {
      const evDate = ev.date || (ev.createdAt ? ev.createdAt.split('T')[0] : null);
      return evDate ? evDate === selectedDate : selectedDate === todayStr;
    });
  }, [evaluaciones, selectedDate, todayStr]);

  // Auto-scroll dinámico hacia la columna del bloque actual (EN CURSO)
  useEffect(() => {
    if (activeTab === 'evaluaciones' && liveBlockId) {
      const timer = setTimeout(() => {
        const container = tableContainerRef.current;
        if (container) {
          const activeHeader = container.querySelector(`.${styles.activeBlockHeader}`);
          if (activeHeader) {
            const containerWidth = container.offsetWidth;
            const headerOffsetLeft = activeHeader.offsetLeft;
            const headerWidth = activeHeader.offsetWidth;
            
            // Centrar suavemente el bloque activo en el contenedor scrollable
            container.scrollTo({
              left: headerOffsetLeft - (containerWidth / 2) + (headerWidth / 2),
              behavior: 'smooth',
            });
          }
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [activeTab, liveBlockId, blockDuration, evalAreaId]);

  // ============================================
  // MÉTRICAS CONDICIONALES
  // ============================================
  
  // Tab 1: Auditoría de Juegos
  const totalInspecciones = inspecciones.length;
  const aprobadas = inspecciones.filter((i) => i.status === 'aprobado').length;
  const defectuosas = totalInspecciones - aprobadas;
  const tasaAprobacion = totalInspecciones > 0
    ? ((aprobadas / totalInspecciones) * 100).toFixed(1)
    : '0.0';

  // Línea de tiempo por pieza: agrupa las inspecciones que comparten pieceTrackingId
  // (las inspecciones antiguas sin ese campo se muestran como una línea de tiempo de un
  // solo paso). Cada grupo se ordena cronológicamente y los grupos se ordenan por su
  // actividad más reciente primero.
  const pieceChains = useMemo(() => {
    const groups = new Map();
    inspecciones.forEach((ins) => {
      const key = ins.pieceTrackingId || ins.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ins);
    });
    return Array.from(groups.values())
      .map((steps) => steps.slice().sort((a, b) => new Date(a.date) - new Date(b.date)))
      .sort((a, b) => new Date(b[b.length - 1].date) - new Date(a[a.length - 1].date));
  }, [inspecciones]);

  const isChainOpen = (chain) => {
    const last = chain[chain.length - 1];
    return ['retrabajo', 'reutilizacion'].includes(last.defectAction);
  };

  const pendingReinspectionCount = useMemo(
    () => pieceChains.filter(isChainOpen).length,
    [pieceChains]
  );

  // Piezas con retrabajo/reclasificación pendiente, disponibles para elegir como
  // seguimiento explícito por su ID único (nunca por nombre, ya que puede haber varias
  // piezas con el mismo nombre en el mismo juego/área)
  const openPendingChains = useMemo(() => pieceChains.filter(isChainOpen), [pieceChains]);

  const selectedFollowUpChain = useMemo(
    () => openPendingChains.find((chain) => chain[chain.length - 1].id === followUpTargetId) || null,
    [openPendingChains, followUpTargetId]
  );

  // Tab 2: Evaluaciones de Colaboradores
  const totalEvals = evaluaciones.length;
  const evalPromedio = totalEvals > 0 
    ? (evaluaciones.reduce((acc, curr) => acc + curr.score, 0) / totalEvals).toFixed(1)
    : '0.0';
  const uniqueEvaluados = new Set(evaluaciones.map((e) => e.operarioId)).size;
  const totalColaboradoresArea = areaOperarios.length;
  const alertasDesempeno = evaluaciones.filter((e) => e.score < 7).length;

  // Tab 3: Revisión de Calidad para Entrega a PT
  const allReviewPairs = useMemo(() => {
    const pairs = [];
    juegos.forEach((j) => {
      j.areas.forEach((areaId) => {
        const target = j.targetPieces?.[areaId] || 1;
        const produced = j.producedPieces?.[areaId] || 0;
        pairs.push({
          game: j,
          areaId,
          review: j.qualityReview?.[areaId],
          isReady: produced >= target,
        });
      });
    });
    return pairs;
  }, [juegos]);

  const reviewStats = useMemo(() => ({
    aprobados: allReviewPairs.filter((p) => p.review?.status === 'aprobado').length,
    rechazados: allReviewPairs.filter((p) => p.review?.status === 'rechazado').length,
    pendientesListos: allReviewPairs.filter(
      (p) => p.isReady && (!p.review || p.review.status !== 'aprobado')
    ).length,
  }), [allReviewPairs]);

  // La cola cubre dos tipos de pendiente: (a) el checklist de calidad aún sin aprobar, o
  // (b) el checklist ya aprobado pero el área ya notificó su entrega a PT y todavía falta
  // el visto bueno de recepción. Sin el caso (b), en cuanto se aprobaba el checklist la
  // entrega desaparecía de esta lista — y como reviewAreaId/reviewGameName (los Select de
  // abajo) son estado local que se resetea a su valor por defecto al salir y volver a esta
  // página, no quedaba ninguna forma de volver a encontrarla desde la UI (parecía que el
  // registro se había borrado, aunque seguía intacto en Firestore).
  const reviewQueue = useMemo(
    () => allReviewPairs
      .filter((p) => {
        const needsChecklistApproval = p.isReady && (!p.review || p.review.status !== 'aprobado');
        const deliveryStatus = p.game.areaDeliveryStatus?.[p.areaId];
        const needsReceptionApproval =
          (deliveryStatus === 'notificado_pt' || deliveryStatus === 'recibido_pt') &&
          !p.game.receptionApproval?.[p.areaId];
        return needsChecklistApproval || needsReceptionApproval;
      })
      .map((p) => ({
        ...p,
        pendingReason: (p.isReady && (!p.review || p.review.status !== 'aprobado')) ? 'checklist' : 'recepcion',
      })),
    [allReviewPairs]
  );

  // Todas las autorizaciones de tiempo extra pendientes de verificar, de cualquier fecha
  // (o de una fecha específica si pendingHEDateFilter está puesto) — ordenadas de más
  // antigua a más reciente, para que lo que lleva más tiempo esperando salga primero.
  const pendingHEList = useMemo(
    () => horasExtra
      .filter((h) => h.verificationStatus === 'pendiente' && (!pendingHEDateFilter || h.authorizedDate === pendingHEDateFilter))
      .sort((a, b) => (a.authorizedDate < b.authorizedDate ? -1 : a.authorizedDate > b.authorizedDate ? 1 : 0)),
    [horasExtra, pendingHEDateFilter]
  );

  const reviewGamesForArea = useMemo(
    () => juegos.filter((j) => j.areas.includes(reviewAreaId)),
    [juegos, reviewAreaId]
  );

  const reviewGameObj = useMemo(
    () => juegos.find((j) => j.name === reviewGameName),
    [juegos, reviewGameName]
  );

  const reviewData = reviewGameObj?.qualityReview?.[reviewAreaId] || { checklist: [], status: 'pendiente', notes: '' };
  const reviewTarget = reviewGameObj?.targetPieces?.[reviewAreaId] || 1;
  const reviewProduced = reviewGameObj?.producedPieces?.[reviewAreaId] || 0;
  const reviewAreaReady = reviewProduced >= reviewTarget;

  // ============================================
  // HANDLERS
  // ============================================
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewInspection((prev) => {
      const updated = { ...prev, [name]: value };
      
      if (name === 'status') {
        const isDefect = value === 'defectuoso';
        updated.hasDefect = isDefect;
        updated.score = isDefect ? 0 : 10;
        updated.defectType = isDefect ? (prev.defectType === 'Ninguno' ? '' : prev.defectType) : 'Ninguno';
        updated.defectAction = isDefect ? (prev.defectAction === 'Ninguna' ? 'retrabajo' : prev.defectAction) : 'Ninguna';
      }
      return updated;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newInspection.gameName) {
      toast.danger('Por favor selecciona el juego que fue inspeccionado.');
      return;
    }
    if (followUpMode === 'seguimiento' && !followUpTargetId) {
      toast.danger('Selecciona a qué pieza (por su ID) le estás dando seguimiento.');
      return;
    }

    // Si no tiene defecto, asegurar que el tipo de defecto sea "Ninguno"
    const finalDefectType = newInspection.hasDefect ? (newInspection.defectType || 'Desconocido') : 'Ninguno';

    setIsSubmittingInspection(true);
    const result = await addInspeccion({
      areaId: newInspection.areaId,
      gameName: newInspection.gameName,
      inspector: newInspection.inspector,
      status: newInspection.hasDefect ? 'defectuoso' : 'aprobado',
      score: Number(newInspection.score),
      pieceName: newInspection.pieceName || 'General',
      defectType: finalDefectType,
      notes: newInspection.notes || 'Inspección finalizada.',
      photos: newInspection.photos.map((p) => p.file),
      defectAction: newInspection.hasDefect ? (newInspection.defectAction || 'retrabajo') : 'Ninguna',
      previousInspeccionId: followUpMode === 'seguimiento' ? followUpTargetId : null,
    });
    setIsSubmittingInspection(false);

    if (!result?.ok) {
      toast.danger(result?.error || 'No se pudo registrar la inspección.');
      return;
    }

    newInspection.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setNewInspection({
      areaId: 'corte-laser',
      gameName: '',
      inspector: user?.name || 'Inspector',
      score: '10',
      status: 'aprobado',
      pieceName: '',
      hasDefect: false,
      defectType: 'Ninguno',
      defectAction: 'retrabajo',
      notes: '',
      photos: [],
    });
    setFollowUpMode('nueva');
    setFollowUpTargetId('');

    if (result.photoWarning) {
      toast.warning(`⚠️ ${result.photoWarning}`);
    } else {
      toast.success('✅ Inspección de calidad registrada.');
    }
  };

  /**
   * Cuando el inspector elige de la lista a qué pieza existente le está dando
   * seguimiento, se precargan área/juego/nombre de pieza desde esa misma pieza para
   * evitar que por error quede enlazada a un juego/área distinto al original.
   */
  const handleSelectFollowUpTarget = (inspeccionId) => {
    setFollowUpTargetId(inspeccionId);
    const chain = openPendingChains.find((c) => c[c.length - 1].id === inspeccionId);
    if (chain) {
      const last = chain[chain.length - 1];
      setNewInspection((prev) => ({ ...prev, areaId: last.areaId, gameName: last.gameName, pieceName: last.pieceName }));
    }
  };

  /**
   * Agrega fotos capturadas con la cámara del dispositivo (o del almacenamiento) como
   * evidencia pendiente de la inspección en curso; la compresión y subida real ocurre
   * después, al guardar, dentro de CalidadContext
   */
  const handleCapturePhotos = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const withPreviews = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setNewInspection((prev) => ({
      ...prev,
      photos: [...prev.photos, ...withPreviews],
    }));
    toast.success(`📷 ${files.length} evidencia(s) fotográfica(s) agregada(s).`);
    e.target.value = '';
  };

  /**
   * Quita una foto pendiente de la inspección en curso y libera su blob URL
   */
  const handleRemovePhoto = (index) => {
    setNewInspection((prev) => {
      URL.revokeObjectURL(prev.photos[index].previewUrl);
      return { ...prev, photos: prev.photos.filter((_, i) => i !== index) };
    });
  };

  const handleEditInspectionClick = (ins) => {
    setEditingInspection(ins);
    setEditInspectionForm({
      status: ins.status,
      pieceName: ins.pieceName,
      defectType: ins.defectType === 'Ninguno' ? '' : ins.defectType,
      defectAction: ins.defectAction || 'retrabajo',
      notes: ins.notes,
    });
    setEditInspectionPhotos(ins.photos || []);
    setIsEditInspectionModalOpen(true);
  };

  /**
   * Sube nuevas fotos de evidencia directo a la inspección que ya existe en edición
   */
  const handleAddEditInspectionPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !editingInspection) return;
    e.target.value = '';
    setIsUploadingEditInspectionPhotos(true);
    const result = await addEvidenceToInspeccion(editingInspection.id, files);
    setIsUploadingEditInspectionPhotos(false);
    if (result.ok) {
      setEditInspectionPhotos(result.photos);
      toast.success('📷 Evidencia agregada a la inspección.');
    } else {
      toast.danger(result.error || 'No se pudo subir la evidencia fotográfica.');
    }
  };

  /**
   * Quita una foto ya guardada de la inspección en edición (borra también en Storage)
   */
  const handleRemoveEditInspectionPhoto = async (photo) => {
    if (!editingInspection || typeof photo === 'string') return;
    const result = await removeEvidenceFromInspeccion(editingInspection.id, photo.path);
    if (result.ok) {
      setEditInspectionPhotos(result.photos);
    } else {
      toast.danger(result.error || 'No se pudo quitar la evidencia fotográfica.');
    }
  };

  const handleSaveEditInspection = async (e) => {
    e.preventDefault();
    if (!editingInspection) return;
    
    const isDefect = editInspectionForm.status === 'defectuoso';
    const finalDefectType = isDefect ? (editInspectionForm.defectType || 'Desconocido') : 'Ninguno';
    const finalDefectAction = isDefect ? (editInspectionForm.defectAction || 'retrabajo') : 'Ninguna';

    const res = await editInspeccion(editingInspection.id, {
      status: editInspectionForm.status,
      score: isDefect ? 0 : 10,
      pieceName: editInspectionForm.pieceName || 'General',
      defectType: finalDefectType,
      defectAction: finalDefectAction,
      notes: editInspectionForm.notes || 'Inspección modificada.',
    });

    if (res.ok) {
      toast.success('📝 Inspección de calidad modificada con éxito.');
      setIsEditInspectionModalOpen(false);
      setEditingInspection(null);
    } else {
      toast.danger(res.error || 'Error al modificar la inspección.');
    }
  };

  const handleDeleteInspection = (ins) => {
    setDeleteConfirmation({
      isOpen: true,
      inspectionId: ins.id,
      gameName: ins.gameName,
    });
  };

  const handleConfirmDelete = async () => {
    const id = deleteConfirmation.inspectionId;
    if (!id) return;

    const res = await deleteInspeccion(id);
    if (res.ok) {
      toast.success('🗑️ Inspección de calidad eliminada.');
    } else {
      toast.danger(res.error || 'Error al eliminar la inspección.');
    }
    setDeleteConfirmation({ isOpen: false, inspectionId: null, gameName: '' });
  };

  // Handlers para Revisión de Calidad para Entrega a PT
  const handleSelectReviewArea = (e) => {
    setReviewAreaId(e.target.value);
    setReviewGameName('');
  };

  const handleOpenReviewFromQueue = (pair) => {
    setReviewAreaId(pair.areaId);
    setReviewGameName(pair.game.name);
  };

  const handleAddReviewItem = () => {
    if (!newReviewItemText.trim() || !reviewGameObj) return;
    addQualityChecklistItem(reviewGameObj.id, reviewAreaId, newReviewItemText.trim());
    setNewReviewItemText('');
  };

  const handleToggleReviewItem = (itemId) => {
    toggleQualityChecklistItem(reviewGameObj.id, reviewAreaId, itemId);
  };

  const handleRemoveReviewItem = (itemId) => {
    removeQualityChecklistItem(reviewGameObj.id, reviewAreaId, itemId);
  };

  const handleApproveReview = async () => {
    const result = await approveQualityReview(reviewGameObj.id, reviewAreaId, user.name, '');
    if (!result.ok) {
      toast.danger(result.error);
      return;
    }
    toast.success('✅ Revisión aprobada. El área ya puede notificar su entrega a Producto Terminado.');
  };

  const handleOpenRejectModal = () => setRejectModal({ isOpen: true, notes: '' });
  const handleCloseRejectModal = () => setRejectModal({ isOpen: false, notes: '' });

  const handleSubmitReject = (e) => {
    e.preventDefault();
    if (!rejectModal.notes.trim()) {
      toast.danger('Indica qué no cumplió para que el área pueda corregirlo.');
      return;
    }
    rejectQualityReview(reviewGameObj.id, reviewAreaId, user.name, rejectModal.notes);
    toast.warning('↩️ Revisión rechazada; el área deberá retrabajar y solicitar una nueva revisión.');
    handleCloseRejectModal();
  };

  const handlePrevDay = () => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    setSelectedDate(`${yyyy}-${mm}-${dd}`);
  };

  const handleNextDay = () => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    setSelectedDate(`${yyyy}-${mm}-${dd}`);
  };

  const handleToday = () => {
    setSelectedDate(getTodayLocalDateStr());
  };

  const ESTADO_AUSENCIA_DESCRIP = {
    falta: 'Falta (Inasistencia)',
    incapacidad: 'Incapacidad Médica',
    salida_campo: 'Salida Fuera / Actividad Externa',
    actividad_externa: 'Comisión Externa',
    viaje: 'Viaje / Ensamble Foráneo',
    vacaciones: 'Vacaciones / Permiso',
  };

  // Handlers para Evaluaciones
  const handleOpenEvalModal = (collaborator, block, existingEval, isPastBlock = false) => {
    if (collaborator.estado?.tipo !== 'activo') {
      const estadoNombre = ESTADO_AUSENCIA_DESCRIP[collaborator.estado?.tipo] || collaborator.estado?.tipo || 'Ausente';
      toast.warning(`No se puede evaluar el desempeño de ${collaborator.name}. Estado actual: ${estadoNombre}. Solo el personal "En Planta" es evaluable.`);
      return;
    }

    setEvalModal({
      isOpen: true,
      collaborator,
      block,
      score: existingEval ? String(existingEval.score) : '10',
      notes: existingEval ? existingEval.notes : '',
      isPastBlockEdit: Boolean(isPastBlock),
    });
  };

  const handleCloseEvalModal = () => {
    setEvalModal({
      isOpen: false,
      collaborator: null,
      block: null,
      score: '10',
      notes: '',
      isPastBlockEdit: false,
    });
  };

  const handleSaveEval = async (e) => {
    e.preventDefault();
    const { collaborator, block, score, notes, isPastBlockEdit } = evalModal;

    if (!notes.trim()) {
      toast.warning('Por favor ingresa observaciones antes de guardar.');
      return;
    }

    const res = await saveEvaluacion(collaborator.id, block.id, Number(score), notes, selectedDate, isPastBlockEdit);

    if (res && res.ok) {
      if (isPastBlockEdit) {
        toast.warning(
          `⚠️ ALERTA DE AUDITORÍA: Se registró la modificación del bloque previo "${block.name}" (${selectedDate}) para ${collaborator.name}. Evento guardado en la bitácora a las ${new Date().toLocaleTimeString('es-MX')} por ${user?.name || 'Usuario'}.`
        );
      } else if (res.wasUpdate) {
        toast.success(`📝 Evaluación actualizada para ${collaborator.name}.`);
      } else {
        toast.success(`✅ Calificación registrada para ${collaborator.name}.`);
      }
    } else {
      toast.danger(res?.error || 'No se pudo guardar la evaluación.');
    }

    handleCloseEvalModal();
  };

  // Verificar (o rechazar) el cumplimiento de las tareas de un registro de horas extra
  const handleVerifyHorasExtraCumplido = async (horasExtraId) => {
    const res = await verifyHorasExtra(horasExtraId, { verificationStatus: 'cumplido', verificationNotes: '' });
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo registrar la verificación.');
      return;
    }
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
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo registrar la verificación.');
      return;
    }
    toast.warning('❌ Tareas de tiempo extra marcadas como no cumplidas.');
    handleCloseHorasExtraRejectModal();
  };

  const toggleOvertimeExpanded = (operarioId) => {
    setExpandedOvertimeOperarios((prev) => {
      const next = new Set(prev);
      if (next.has(operarioId)) next.delete(operarioId);
      else next.add(operarioId);
      return next;
    });
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
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo guardar la corrección de horario.');
      return;
    }
    toast.success('⚠️ Horario de tiempo extra corregido correctamente.');
    handleCloseScheduleCorrectionModal();
  };

  // ============================================
  // VARIANTES DE ANIMACIÓN
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
        title="Aseguramiento de Calidad"
        subtitle={
          activeTab === 'auditoria'
            ? 'Inspecciona productos y garantiza los estándares de Dicrejart.'
            : activeTab === 'revision'
            ? 'Aprueba el checklist de calidad antes de que un área notifique su entrega a Producto Terminado.'
            : activeTab === 'horasExtra'
            ? 'Verifica si las tareas asignadas durante el tiempo extra realmente se cumplieron, de cualquier fecha.'
            : 'Evalúa y califica el desempeño en tiempo real de los colaboradores en taller.'
        }
        shape="mancha"
        accentColor="var(--color-dark-magenta)"
      />

      {/* Pestañas de Navegación */}
      <div className={styles.tabsContainer}>
        <button
          className={`${styles.tabBtn} ${activeTab === 'auditoria' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('auditoria')}
        >
          📋 Auditoría de Juegos
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'revision' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('revision')}
        >
          ✅ Revisión para Entrega a PT
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'evaluaciones' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('evaluaciones')}
        >
          👥 Desempeño de Colaboradores
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'horasExtra' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('horasExtra')}
        >
          🕒 Horas Extra Pendientes ({horasExtra.filter((h) => h.verificationStatus === 'pendiente').length})
        </button>
      </div>

      {/* ============================================
          TARJETAS DE MÉTRICAS (KPIs Condicionales)
          ============================================ */}
      <div className={styles.kpiGrid}>
        {activeTab === 'auditoria' ? (
          <>
            <Card variant="highlight">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Tasa de Aprobación</span>
                <h3 className={styles.kpiValue} style={{ color: 'var(--color-secondary)' }}>{tasaAprobacion}%</h3>
                <p className={styles.kpiFooter}>Inspección global</p>
              </div>
            </Card>
            <Card variant="default">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Total Inspecciones</span>
                <h3 className={styles.kpiValue}>{totalInspecciones}</h3>
                <p className={styles.kpiFooter}>Órdenes auditadas</p>
              </div>
            </Card>
            <Card variant="success">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Piezas Aprobadas</span>
                <h3 className={styles.kpiValue} style={{ color: 'var(--color-success)' }}>{aprobadas}</h3>
                <p className={styles.kpiFooter}>Libres de defectos</p>
              </div>
            </Card>
            <Card variant="danger">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Defectuosas / Rechazos</span>
                <h3 className={styles.kpiValue} style={{ color: 'var(--color-alert)' }}>{defectuosas}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', marginTop: '6px', color: 'var(--color-gray-600)', borderTop: '1px solid var(--color-gray-200)', paddingTop: '4px' }}>
                  <span>🛠️ Re-trabajos: <strong>{inspecciones.filter(i => i.defectAction === 'retrabajo').length}</strong></span>
                  <span>🗑️ Desechos / Scrap: <strong>{inspecciones.filter(i => i.defectAction === 'desecho').length}</strong></span>
                  <span>♻️ Reutilizadas: <strong>{inspecciones.filter(i => i.defectAction === 'reutilizacion').length}</strong></span>
                </div>
              </div>
            </Card>
            <Card variant="warning">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Piezas Pendientes de Re-inspección</span>
                <h3 className={styles.kpiValue} style={{ color: 'var(--color-princeton-orange)' }}>{pendingReinspectionCount}</h3>
                <p className={styles.kpiFooter}>Con retrabajo/reclasificación sin cerrar</p>
              </div>
            </Card>
          </>
        ) : activeTab === 'revision' ? (
          <>
            <Card variant="danger">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Listos, Pendientes de Aprobar</span>
                <h3 className={styles.kpiValue} style={{ color: 'var(--color-alert)' }}>{reviewStats.pendientesListos}</h3>
                <p className={styles.kpiFooter}>Al 100% de piezas, sin aprobación</p>
              </div>
            </Card>
            <Card variant="success">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Aprobados</span>
                <h3 className={styles.kpiValue} style={{ color: 'var(--color-success)' }}>{reviewStats.aprobados}</h3>
                <p className={styles.kpiFooter}>Ya pueden notificar entrega a PT</p>
              </div>
            </Card>
            <Card variant="default">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Rechazados</span>
                <h3 className={styles.kpiValue}>{reviewStats.rechazados}</h3>
                <p className={styles.kpiFooter}>Esperando retrabajo y nueva revisión</p>
              </div>
            </Card>
          </>
        ) : (
          <>
            <Card variant="highlight">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Nota Promedio Desempeño</span>
                <h3 className={styles.kpiValue} style={{ color: 'var(--color-secondary)' }}>{evalPromedio} / 10</h3>
                <p className={styles.kpiFooter}>Calificación de personal</p>
              </div>
            </Card>
            <Card variant="default">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Colaboradores en Área</span>
                <h3 className={styles.kpiValue}>{totalColaboradoresArea}</h3>
                <p className={styles.kpiFooter}>Personal activo asignado</p>
              </div>
            </Card>
            <Card variant="success">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Evaluados Hoy</span>
                <h3 className={styles.kpiValue} style={{ color: 'var(--color-success)' }}>{uniqueEvaluados}</h3>
                <p className={styles.kpiFooter}>Con al menos una evaluación</p>
              </div>
            </Card>
            <Card variant="danger">
              <div className={styles.kpiContent}>
                <span className={styles.kpiLabel}>Alertas Desempeño</span>
                <h3 className={styles.kpiValue} style={{ color: alertasDesempeno > 0 ? 'var(--color-alert)' : 'var(--color-gray-600)' }}>
                  {alertasDesempeno}
                </h3>
                <p className={styles.kpiFooter}>Calificación menor a 7</p>
              </div>
            </Card>
          </>
        )}
      </div>

      {/* ============================================
          CONTENIDO DE PESTAÑAS
          ============================================ */}
      
      {/* 1. AUDITORÍA DE JUEGOS */}
      {activeTab === 'auditoria' && (
        <div className={styles.layoutColumns}>
          {/* Registro */}
          <motion.div variants={itemVariants}>
            <Card variant="default">
              <h3 className={styles.sectionTitle}>Registrar Auditoría de Calidad</h3>
              <form onSubmit={handleSubmit} className={styles.form}>

                {/* Tipo de Auditoría: pieza nueva o seguimiento por ID de una ya existente */}
                <div className={styles.formGroup}>
                  <label className={styles.label}>Tipo de Auditoría</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => { setFollowUpMode('nueva'); setFollowUpTargetId(''); }}
                      style={{
                        flex: 1, padding: '10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                        border: followUpMode === 'nueva' ? '2px solid var(--color-secondary)' : '1px solid var(--color-gray-200)',
                        background: followUpMode === 'nueva' ? 'rgba(51, 0, 102, 0.05)' : 'var(--color-white)',
                        color: followUpMode === 'nueva' ? 'var(--color-secondary)' : 'var(--color-gray-600)',
                      }}
                    >
                      🆕 Pieza Nueva
                    </button>
                    <button
                      type="button"
                      onClick={() => setFollowUpMode('seguimiento')}
                      style={{
                        flex: 1, padding: '10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                        border: followUpMode === 'seguimiento' ? '2px solid var(--color-secondary)' : '1px solid var(--color-gray-200)',
                        background: followUpMode === 'seguimiento' ? 'rgba(51, 0, 102, 0.05)' : 'var(--color-white)',
                        color: followUpMode === 'seguimiento' ? 'var(--color-secondary)' : 'var(--color-gray-600)',
                      }}
                    >
                      🔗 Seguimiento de Pieza Existente
                    </button>
                  </div>
                </div>

                {followUpMode === 'seguimiento' && (
                  <div className={styles.formGroup}>
                    <Select
                      label="¿A qué pieza le das seguimiento? (por su ID) *"
                      value={followUpTargetId}
                      onChange={(e) => handleSelectFollowUpTarget(e.target.value)}
                      required
                      placeholder="-- Selecciona el ID de la pieza --"
                      options={openPendingChains.map((chain) => {
                        const last = chain[chain.length - 1];
                        const areaName = AREAS.find((a) => a.id === last.areaId)?.name || last.areaId;
                        return {
                          value: last.id,
                          label: `${last.pieceTrackingId || last.id} — ${last.gameName} · ${areaName} · ${last.pieceName} (${new Date(last.date).toLocaleDateString()})`,
                        };
                      })}
                    />
                    {openPendingChains.length === 0 && (
                      <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                        No hay piezas pendientes de re-revisión en este momento.
                      </span>
                    )}
                  </div>
                )}

                {/* Área */}
                <div className={styles.formGroup}>
                  <Select
                    label="Área Auditada"
                    name="areaId"
                    value={newInspection.areaId}
                    onChange={handleInputChange}
                    required
                    disabled={followUpMode === 'seguimiento'}
                    options={AREAS.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </div>

                {/* Juego */}
                <div className={styles.formGroup}>
                  <Select
                    label="Juego Inspeccionado"
                    name="gameName"
                    value={newInspection.gameName}
                    onChange={handleInputChange}
                    required
                    disabled={followUpMode === 'seguimiento'}
                    placeholder="-- Selecciona el Juego --"
                    options={juegos.map((j) => ({
                      value: j.name,
                      label: `${j.name} (${j.projectName})`,
                    }))}
                  />
                </div>

                {/* Interruptor de Defecto */}
                <div className={styles.formGroup} style={{ marginBottom: 'var(--space-2)' }}>
                  <label className={styles.checkboxLabel} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newInspection.hasDefect}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setNewInspection((prev) => ({
                          ...prev,
                          hasDefect: checked,
                          defectType: checked ? '' : 'Ninguno',
                          status: checked ? 'defectuoso' : 'aprobado',
                          score: checked ? '7' : '10',
                        }));
                      }}
                    />
                    <span style={{ fontWeight: '600', fontSize: '13px', color: 'var(--color-secondary)' }}>
                      ⚠️ ¿La pieza/componente cuenta con algún defecto?
                    </span>
                  </label>
                </div>

                {/* Pieza Revisada y Tipo de Defecto */}
                <div className={styles.row}>
                  <div className={styles.formGroup}>
                    <Input
                      label="Pieza / Componente Revisado *"
                      name="pieceName"
                      placeholder="Ej: Poste principal, Red escaladora"
                      value={newInspection.pieceName}
                      onChange={handleInputChange}
                      disabled={followUpMode === 'seguimiento'}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <Input
                      label={newInspection.hasDefect ? "Tipo de Defecto *" : "Tipo de Defecto (Desactivado)"}
                      name="defectType"
                      placeholder={newInspection.hasDefect ? "Ej: Soldadura porosa, Astilla" : "Sin defecto (Aprobado)"}
                      value={newInspection.hasDefect ? newInspection.defectType : ''}
                      onChange={handleInputChange}
                      disabled={!newInspection.hasDefect}
                      required={newInspection.hasDefect}
                    />
                  </div>
                </div>

                {followUpMode === 'seguimiento' && selectedFollowUpChain && (
                  <div className={styles.bannerInfo} style={{ marginBottom: 'var(--space-3)' }}>
                    <strong>🔗 {selectedFollowUpChain[selectedFollowUpChain.length - 1].pieceTrackingId || selectedFollowUpChain[selectedFollowUpChain.length - 1].id}:</strong>
                    <span>
                      {' '}Esta nueva revisión se enlazará a esa pieza (quedó en{' '}
                      {selectedFollowUpChain[selectedFollowUpChain.length - 1].defectAction === 'retrabajo' ? 'retrabajo' : 'reclasificación'}
                      {' '}el {new Date(selectedFollowUpChain[selectedFollowUpChain.length - 1].date).toLocaleDateString()}).
                    </span>
                  </div>
                )}

                {/* Destino / Acción de la Pieza Defectuosa */}
                {newInspection.hasDefect && (
                  <div className={styles.formGroup}>
                    <Select
                      label="Destino / Acción de la Pieza Defectuosa *"
                      name="defectAction"
                      value={newInspection.defectAction || 'retrabajo'}
                      onChange={handleInputChange}
                      required
                      options={[
                        { value: 'retrabajo', label: '🛠️ Re-trabajo (Corregir / Cortar para dar la medida exacta)' },
                        { value: 'desecho', label: '🗑️ Desecho / Scrap (Desechar material por completo)' },
                        { value: 'reutilizacion', label: '♻️ Reutilización / Reclasificación (Aprovechar para otra pieza menor)' },
                      ]}
                    />
                  </div>
                )}

                {/* Resultado de Inspección */}
                <div className={styles.formGroup}>
                  <Select
                    label="Resultado de Inspección *"
                    name="status"
                    value={newInspection.status}
                    onChange={handleInputChange}
                    required
                    options={[
                      { value: 'aprobado', label: 'Pasa (Aprobado)' },
                      { value: 'defectuoso', label: 'No Pasa (Con Defectos)' },
                    ]}
                  />
                </div>

                {/* Inspector */}
                <div className={styles.formGroup}>
                  <Input
                    label="Inspector Encargado"
                    name="inspector"
                    value={newInspection.inspector}
                    onChange={handleInputChange}
                    disabled
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
                    id="quality-photo-capture"
                    onChange={handleCapturePhotos}
                  />
                  <label
                    htmlFor="quality-photo-capture"
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

                  {newInspection.photos.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                      {newInspection.photos.map((photo, idx) => (
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
                            onClick={() => handleRemovePhoto(idx)}
                            title="Quitar evidencia"
                            style={{
                              position: 'absolute',
                              top: '-6px',
                              right: '-6px',
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              background: 'var(--color-danger)',
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

                {/* Notas */}
                <div className={styles.formGroup}>
                  <label className={styles.label}>Observaciones y Detalles del Defecto</label>
                  <textarea
                    name="notes"
                    className={styles.textarea}
                    placeholder="Detalla las especificaciones no cumplidas..."
                    value={newInspection.notes}
                    onChange={handleInputChange}
                    rows="3"
                  />
                </div>

                <Button type="submit" variant="primary" size="md" disabled={isSubmittingInspection}>
                  {isSubmittingInspection ? '⏳ Guardando...' : '⚡ Registrar Inspección'}
                </Button>
              </form>
            </Card>
          </motion.div>

          {/* Historial */}
          <motion.div variants={itemVariants} className={styles.historyCol}>
            <Card variant="default">
              <h3 className={styles.sectionTitle}>Historial de Auditorías</h3>
              <div className={styles.historyList}>
                {pieceChains.map((chain) => {
                  const last = chain[chain.length - 1];
                  const areaInfo = AREAS.find((a) => a.id === last.areaId);
                  const chainOpen = isChainOpen(chain);
                  return (
                    <div key={chain[0].pieceTrackingId || chain[0].id} className={styles.chainCard}>
                      <div className={styles.chainHeader}>
                        <div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--color-secondary)', display: 'block' }}>
                            {last.pieceTrackingId || last.id}
                          </span>
                          <strong className={styles.insGame}>{last.gameName}</strong>
                          <span className={styles.insArea}>
                            {areaInfo?.name || last.areaId}{last.pieceName ? ` · ${last.pieceName}` : ''}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {chain.length > 1 && (
                            <Badge variant="info">🔗 {chain.length} revisiones</Badge>
                          )}
                          <Badge variant={chainOpen ? 'warning' : last.status === 'aprobado' ? 'success' : 'danger'}>
                            {chainOpen
                              ? '⏳ Pendiente de re-revisión'
                              : last.status === 'aprobado' ? 'PASA' : 'NO PASA'}
                          </Badge>
                        </div>
                      </div>

                      <div className={styles.chainSteps}>
                        {chain.map((ins, idx) => (
                          <div key={ins.id} className={styles.chainStep}>
                            <span className={styles.chainStepDot} />
                            {idx < chain.length - 1 && <span className={styles.chainStepLine} />}
                            <div className={styles.chainStepBody}>
                              <div className={styles.insHeader}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-gray-500)', textTransform: 'uppercase' }}>
                                  {idx === 0 ? 'Auditoría original' : `Re-revisión ${idx}`}
                                </span>
                                <div className={styles.insBadgeBlock} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Badge variant={ins.status === 'aprobado' ? 'success' : 'danger'}>
                                    {ins.status === 'aprobado' ? 'PASA' : 'NO PASA'}
                                  </Badge>
                                  {!isReadOnly && (
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button
                                        type="button"
                                        onClick={() => handleEditInspectionClick(ins)}
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
                                        title="Editar inspección"
                                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                      >
                                        ✏️
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteInspection(ins)}
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
                                        title="Eliminar inspección"
                                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 51, 0, 0.05)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                      >
                                        🗑️
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              {(ins.defectType !== 'Ninguno' || ins.pieceName) && (
                                <div className={styles.defectTypeAlert}>
                                  {ins.pieceName && <span><strong>Pieza:</strong> {ins.pieceName} | </span>}
                                  <strong>Defecto:</strong> {ins.defectType}
                                  {ins.defectAction && ins.defectAction !== 'Ninguna' && (
                                    <div style={{ marginTop: '4px' }}>
                                      <strong>Destino: </strong>
                                      <Badge variant={ins.defectAction === 'retrabajo' ? 'warning' : ins.defectAction === 'desecho' ? 'danger' : 'info'}>
                                        {ins.defectAction === 'retrabajo'
                                          ? '🛠️ Re-trabajo (Corregir)'
                                          : ins.defectAction === 'desecho'
                                          ? '🗑️ Desecho / Scrap'
                                          : '♻️ Reclasificación'}
                                      </Badge>
                                    </div>
                                  )}
                                </div>
                              )}
                              <p className={styles.insNotes}>{ins.notes}</p>
                              {ins.photos && ins.photos.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0' }}>
                                  {ins.photos.map((photo, photoIdx) => (
                                    <img
                                      key={photo?.path || photoIdx}
                                      src={getPhotoSrc(photo)}
                                      alt={`Evidencia ${photoIdx + 1} de ${ins.gameName}`}
                                      onClick={() => setPhotoPreview(getPhotoSrc(photo))}
                                      style={{
                                        width: '52px',
                                        height: '52px',
                                        objectFit: 'cover',
                                        borderRadius: '6px',
                                        border: '1px solid var(--color-gray-200)',
                                        cursor: 'pointer',
                                      }}
                                    />
                                  ))}
                                </div>
                              )}
                              <span className={styles.insMeta}>
                                Auditor: {ins.inspector} • {new Date(ins.date).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* 3. REVISIÓN DE CALIDAD PARA ENTREGA A PT */}
      {activeTab === 'revision' && (
        <div className={styles.layoutColumns}>
          {/* Cola de áreas listas sin aprobar */}
          <motion.div variants={itemVariants}>
            <Card variant="default">
              <h3 className={styles.sectionTitle}>Listos para Revisar ({reviewQueue.length})</h3>
              <div className={styles.historyList}>
                {reviewQueue.map((pair) => {
                  const areaInfo = AREAS.find((a) => a.id === pair.areaId);
                  return (
                    <button
                      key={pair.game.id + pair.areaId}
                      type="button"
                      onClick={() => handleOpenReviewFromQueue(pair)}
                      className={styles.insCard}
                      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none' }}
                    >
                      <div className={styles.insHeader}>
                        <div>
                          <strong className={styles.insGame}>{pair.game.name}</strong>
                          <span className={styles.insArea}>{areaInfo?.name || pair.areaId}</span>
                        </div>
                        <Badge variant={pair.pendingReason === 'recepcion' ? 'primary' : pair.review?.status === 'rechazado' ? 'danger' : 'warning'}>
                          {pair.pendingReason === 'recepcion' ? 'FALTA APROBAR RECEPCIÓN' : pair.review?.status === 'rechazado' ? 'RECHAZADO' : 'SIN REVISAR'}
                        </Badge>
                      </div>
                      <p className={styles.insNotes}>Proyecto: {pair.game.projectName}</p>
                    </button>
                  );
                })}
                {reviewQueue.length === 0 && (
                  <p style={{ fontSize: '13px', color: 'var(--color-gray-500)', textAlign: 'center', padding: '16px' }}>
                    No hay áreas al 100% esperando aprobación de Calidad en este momento.
                  </p>
                )}
              </div>
            </Card>
          </motion.div>

          {/* Detalle / gestión del checklist */}
          <motion.div variants={itemVariants} className={styles.historyCol}>
            <Card variant="default">
              <h3 className={styles.sectionTitle}>Checklist de Revisión</h3>

              <div className={styles.row}>
                <div className={styles.formGroup}>
                  <Select
                    label="Área"
                    value={reviewAreaId}
                    onChange={handleSelectReviewArea}
                    options={MANUFACTURING_AREAS.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </div>
                <div className={styles.formGroup}>
                  <Select
                    label="Juego"
                    value={reviewGameName}
                    onChange={(e) => setReviewGameName(e.target.value)}
                    placeholder="-- Selecciona el Juego --"
                    options={reviewGamesForArea.map((j) => ({ value: j.name, label: `${j.name} (${j.projectName})` }))}
                  />
                </div>
              </div>

              {reviewGameObj && (
                <>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0' }}>
                    <Badge variant={
                      reviewData.status === 'aprobado' ? 'success' : reviewData.status === 'rechazado' ? 'danger' : 'warning'
                    }>
                      {reviewData.status === 'aprobado' ? 'APROBADO' : reviewData.status === 'rechazado' ? 'RECHAZADO' : 'PENDIENTE'}
                    </Badge>
                    <span style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                      Producción del área: {reviewProduced} / {reviewTarget} pzas {reviewAreaReady ? '(100% ✓)' : '(aún en proceso)'}
                    </span>
                  </div>

                  {reviewData.status === 'rechazado' && reviewData.notes && (
                    <div className={styles.bannerDanger} style={{ marginBottom: '10px' }}>
                      <strong>❌ Motivo del rechazo:</strong>
                      <span> {reviewData.notes}</span>
                    </div>
                  )}
                  {reviewData.status === 'aprobado' && (
                    <div className={styles.bannerSuccess} style={{ marginBottom: '10px' }}>
                      <strong>✅ Aprobado por {reviewData.reviewedBy}:</strong>
                      <span> El área ya puede notificar su entrega a Producto Terminado.</span>
                    </div>
                  )}

                  {/* Aprobación ADICIONAL, independiente de la anterior: cuando el área ya
                      notificó la entrega, Calidad da un visto bueno como testigo antes de
                      que Producto Terminado pueda recibirla — sin checklist ni motivo. */}
                  {(() => {
                    const reviewDeliveryStatus = reviewGameObj.areaDeliveryStatus?.[reviewAreaId] || 'pendiente';
                    if (reviewDeliveryStatus !== 'notificado_pt' && reviewDeliveryStatus !== 'recibido_pt') return null;
                    const receptionApproval = reviewGameObj.receptionApproval?.[reviewAreaId];
                    return (
                      <div className={receptionApproval ? styles.bannerSuccess : styles.bannerWarning} style={{ marginBottom: '10px' }}>
                        {receptionApproval ? (
                          <>
                            <strong>✅ Recepción aprobada por {receptionApproval.approvedBy}:</strong>
                            <span> Producto Terminado ya puede recibir esta entrega.</span>
                          </>
                        ) : (
                          <>
                            <strong>⏳ Falta aprobación para recibir:</strong>
                            <span> El área ya notificó la entrega — confirma que todo está correcto para que Producto Terminado pueda recibirla.</span>
                            <div style={{ marginTop: '8px' }}>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={async () => {
                                  const res = await approveReceptionForPT(reviewGameObj.id, reviewAreaId, user.name, user.roleType);
                                  if (!res.ok) {
                                    toast.danger(res.error || 'No se pudo aprobar la recepción.');
                                    return;
                                  }
                                  toast.success('✅ Recepción aprobada. Producto Terminado ya puede recibir esta entrega.');
                                }}
                              >
                                ✅ Aprobado por Calidad para Recibir
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  <div className={styles.itemsSelectionBox} style={{ maxHeight: '220px', padding: '8px', background: 'var(--color-gray-50)', borderRadius: '8px', border: '1px solid var(--color-gray-200)', marginBottom: '10px' }}>
                    {reviewData.checklist.map((item) => (
                      <label
                        key={item.id}
                        className={styles.checkboxLabel}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' }}
                      >
                        <input type="checkbox" checked={item.checked} onChange={() => handleToggleReviewItem(item.id)} />
                        <span style={{ flexGrow: 1, textDecoration: item.checked ? 'line-through' : 'none', color: item.checked ? 'var(--color-gray-500)' : 'var(--color-dark)' }}>
                          {item.text}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveReviewItem(item.id)}
                          style={{ border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                          ✕
                        </button>
                      </label>
                    ))}
                    {reviewData.checklist.length === 0 && (
                      <span style={{ fontSize: '12px', color: 'var(--color-gray-500)', display: 'block', textAlign: 'center', padding: '12px' }}>
                        Aún no hay puntos de revisión para esta combinación de juego y área. Agrega los que consideres necesarios.
                      </span>
                    )}
                  </div>

                  <div className={styles.dynamicRow} style={{ marginBottom: '14px' }}>
                    <input
                      type="text"
                      className={styles.textInput}
                      placeholder="Ej: Soldaduras sin porosidad, medidas dentro de tolerancia..."
                      value={newReviewItemText}
                      style={{ flexGrow: 1 }}
                      onChange={(e) => setNewReviewItemText(e.target.value)}
                    />
                    <Button type="button" variant="secondary" size="md" onClick={handleAddReviewItem}>
                      ➕ Agregar Punto
                    </Button>
                  </div>

                  <div className={styles.row}>
                    <Button type="button" variant="secondary" size="md" onClick={handleOpenRejectModal}>
                      ↩️ Rechazar
                    </Button>
                    <Button type="button" variant="primary" size="md" onClick={handleApproveReview}>
                      ✅ Aprobar Entrega a PT
                    </Button>
                  </div>
                </>
              )}

              {!reviewGameObj && (
                <p style={{ fontSize: '13px', color: 'var(--color-gray-500)', textAlign: 'center', padding: '16px' }}>
                  Selecciona un área y un juego para ver o construir su checklist de revisión.
                </p>
              )}
            </Card>
          </motion.div>
        </div>
      )}

      {/* 2. EVALUACIÓN DE DESEMPEÑO DE COLABORADORES */}
      {activeTab === 'evaluaciones' && (
        <div className={styles.evaluacionesSection}>
          {/* Tarjeta de Filtro y Navegador por Calendario */}
          <motion.div variants={itemVariants}>
            <Card variant="default" className={styles.filterCard} style={{ marginBottom: '16px' }}>
              <div className={styles.evalFilterBar} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                {/* Navegación por Calendario */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <Button variant="secondary" size="sm" onClick={handlePrevDay} title="Ver calificaciones del día anterior">
                    ◀ Anterior
                  </Button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-dark)' }}>
                      📅 Fecha:
                    </label>
                    <input
                      type="date"
                      className={styles.dateInput}
                      style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--color-gray-300)', fontWeight: 'bold' }}
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                    />
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleNextDay} title="Ver calificaciones del día siguiente">
                    Siguiente ▶
                  </Button>
                  {selectedDate !== todayStr && (
                    <Button variant="primary" size="sm" onClick={handleToday}>
                      📍 Ir a Hoy
                    </Button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className={styles.evalSelectWrapper} style={{ minWidth: '180px' }}>
                    <Select
                      label="Selecciona Área"
                      value={evalAreaId}
                      onChange={(e) => setEvalAreaId(e.target.value)}
                      options={AREAS.map((a) => ({ value: a.id, label: a.name }))}
                    />
                  </div>
                  <div className={styles.evalSelectWrapper} style={{ minWidth: '170px' }}>
                    <Select
                      label="⏱️ Bloques"
                      value={String(blockDuration)}
                      onChange={(e) => updateBlockDuration(e.target.value)}
                      options={[
                        { value: '1', label: 'Cada 1 Hora' },
                        { value: '2', label: 'Cada 2 Horas' },
                        { value: '3', label: 'Cada 3 Horas' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              {/* Indicador de Modo y Resumen de Evaluaciones */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--color-gray-200)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Badge variant={selectedDate === todayStr ? 'success' : 'warning'} size="sm">
                    {selectedDate === todayStr ? '🟢 En Vivo (Jornada Hoy)' : '📜 Consulta Histórica de Fecha'}
                  </Badge>
                  <span style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
                    Total evaluaciones registradas el {selectedDate}: <strong>{dailyEvaluaciones.length}</strong>
                  </span>
                </div>
                {selectedDate !== todayStr && (
                  <span style={{ fontSize: '11px', color: '#b45309', fontWeight: '500' }}>
                    ⚠️ Puede modificar bloques de fechas previas; cada cambio generará alerta y registro en bitácora.
                  </span>
                )}
              </div>
            </Card>
          </motion.div>

          {/* Tabla de Evaluaciones de Horarios */}
          <motion.div variants={itemVariants} className={styles.tableCardContainer}>
            <Card variant="default" className={styles.tableCard}>
              <div className={styles.tableResponsive} ref={tableContainerRef}>
                <table className={styles.evalTable}>
                  <thead>
                    <tr>
                      <th className={styles.colaboradorColHeader}>Colaborador & Promedios</th>
                      {activeBlocks.map((block) => {
                        const isActive = selectedDate === todayStr && block.id === liveBlockId;
                        return (
                          <th 
                            key={block.id} 
                            className={`${styles.blockHeader} ${isActive ? styles.activeBlockHeader : ''}`}
                          >
                            <div className={styles.blockHeaderContent}>
                              <span className={styles.blockNameText}>{block.name}</span>
                              <span className={styles.blockTimeRangeText}>{block.timeRange}</span>
                              {isActive && (
                                <Badge variant="success" size="sm" className={styles.liveBadge}>
                                  <span className={styles.pulseDot} />
                                  EN CURSO
                                </Badge>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAreaOperarios.map((op) => {
                      // Horario real de ESTE colaborador para la fecha seleccionada (no solo
                      // "hoy") — se consulta horas_extra por fecha en vez de operarios.schedule,
                      // que solo refleja el día vigente actual.
                      const opDateOvertimeRecord = horasExtra.find(
                        (h) => h.operarioId === op.id && h.authorizedDate === selectedDate && h.verificationStatus !== 'cancelado'
                      );
                      const opStartHour = opDateOvertimeRecord ? opDateOvertimeRecord.startHour : 8;
                      const opEndHour = opDateOvertimeRecord ? opDateOvertimeRecord.endHour : defaultEnd;

                      // Promedios diarios e históricos del colaborador
                      const opDailyEvals = dailyEvaluaciones.filter((ev) => ev.operarioId === op.id);
                      const opDailyAvg = opDailyEvals.length > 0 ? (opDailyEvals.reduce((a, c) => a + Number(c.score), 0) / opDailyEvals.length).toFixed(1) : null;

                      const opOverallEvals = evaluaciones.filter((ev) => ev.operarioId === op.id);
                      const opOverallAvg = opOverallEvals.length > 0 ? (opOverallEvals.reduce((a, c) => a + Number(c.score), 0) / opOverallEvals.length).toFixed(1) : null;

                      // Determinar el primer bloque válido asignado al horario de este colaborador
                      const firstValidBlockIndex = activeBlocks.findIndex(
                        (b) => b.startHour >= opStartHour && b.endHour <= opEndHour
                      );

                      return (
                        <tr key={op.id}>
                          <td className={styles.colaboradorCell}>
                            <div className={styles.userInfoBlock} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className={styles.avatarMini}>{(op.name || 'O')[0].toUpperCase()}</span>
                                <div className={styles.userDetails}>
                                  <strong className={styles.userName}>{op.name || 'Sin Nombre'}</strong>
                                  <span className={styles.userRole}>ID: {op.id || 'N/A'}</span>
                                </div>
                              </div>

                              {/* Medidores de Promedios */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '2px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 'bold', color: opDailyAvg ? (opDailyAvg >= 8 ? '#15803d' : '#b45309') : 'var(--color-gray-500)', backgroundColor: opDailyAvg ? 'rgba(34, 197, 94, 0.12)' : 'var(--color-gray-100)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.05)' }}>
                                  Promedio Día ({selectedDate}): {opDailyAvg ? `⭐ ${opDailyAvg} / 10` : 'Sin eval hoy'}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--color-gray-600)', backgroundColor: 'var(--color-gray-100)', padding: '2px 6px', borderRadius: '4px' }}>
                                  Promedio General: {opOverallAvg ? `📊 ${opOverallAvg} / 10 (${opOverallEvals.length} eval)` : 'Sin historial'}
                                </span>
                              </div>

                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                                <span style={{ fontSize: '10px', color: 'var(--color-gray-600)', backgroundColor: 'var(--color-gray-100)', padding: '2px 6px', borderRadius: '4px' }}>
                                  ⏰ {String(opStartHour).padStart(2, '0')}:00 - {String(opEndHour).padStart(2, '0')}:00
                                </span>
                                {opDateOvertimeRecord && (
                                  <Badge variant="warning" size="sm">
                                    🔥 Extra (+{opDateOvertimeRecord.overtimeHours}h)
                                  </Badge>
                                )}
                              </div>
                              {/* Tareas de tiempo extra autorizadas para la FECHA seleccionada arriba
                                  (no solo "hoy") — autorizar quedó en Operarios (supervisor del área o
                                  Admin); aquí Calidad solo consulta y verifica si de verdad se cumplieron. */}
                              {(() => {
                                // Los "cancelado" (autorización retirada o reemplazada antes de
                                // verificarse, ver cancelPendingHorasExtra) no se muestran — ya no
                                // hay nada real que Calidad deba revisar de esos.
                                const opHorasExtraToday = horasExtra.filter(
                                  (h) => h.operarioId === op.id && h.authorizedDate === selectedDate && h.verificationStatus !== 'cancelado'
                                );
                                if (opHorasExtraToday.length === 0) return null;

                                const isExpanded = expandedOvertimeOperarios.has(op.id);
                                const hasCorrection = opHorasExtraToday.some((h) => h.scheduleCorrection);

                                return (
                                  <div style={{ marginTop: '2px' }}>
                                    <button
                                      type="button"
                                      onClick={() => toggleOvertimeExpanded(op.id)}
                                      style={{
                                        fontSize: '10.5px',
                                        fontWeight: 700,
                                        color: 'var(--color-secondary)',
                                        background: 'rgba(255, 153, 51, 0.1)',
                                        border: '1px solid rgba(255, 153, 51, 0.3)',
                                        borderRadius: '4px',
                                        padding: '3px 8px',
                                        cursor: 'pointer',
                                        width: '100%',
                                        textAlign: 'left',
                                      }}
                                    >
                                      🕒 Tiempo Extra ({opHorasExtraToday.length}){hasCorrection ? ' ⚠️' : ''} {isExpanded ? '▲' : '▼'}
                                    </button>

                                    {isExpanded && opHorasExtraToday.map((h) => {
                                  const { earlyHours, earlyRange, lateHours, lateRange } = getOvertimeBlocks(h.startHour, h.endHour, h.authorizedDate);
                                  return (
                                  <div
                                    key={h.id}
                                    style={{
                                      marginTop: '2px',
                                      padding: '6px 8px',
                                      borderRadius: '6px',
                                      background: 'rgba(255, 153, 51, 0.08)',
                                      border: '1px solid rgba(255, 153, 51, 0.25)',
                                      fontSize: '11px',
                                    }}
                                  >
                                    <div style={{ fontWeight: 600, color: 'var(--color-secondary)', marginBottom: '2px' }}>
                                      🕒 Tareas del tiempo extra ({h.overtimeHours}h):
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                      {Boolean(h.authorizedDate) && new Date(`${h.authorizedDate}T00:00:00`).getDay() === 0 ? (
                                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: '#fdf2f8', color: '#9d174d', border: '1px solid #fbcfe8' }}>
                                          📅 Domingo Completo: {h.overtimeHours}h ({String(h.startHour).padStart(2, '0')}:00-{String(h.endHour).padStart(2, '0')}:00)
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
                                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
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
                                      <span
                                        title={h.verificationNotes ? `${h.verificationNotes} — ${h.verifiedBy}` : h.verifiedBy}
                                        style={{
                                          fontSize: '10.5px',
                                          fontWeight: 700,
                                          color: h.verificationStatus === 'cumplido' ? '#15803d' : 'var(--color-alert)',
                                        }}
                                      >
                                        {h.verificationStatus === 'cumplido' ? '✅ Cumplido' : '❌ No Cumplido'} — {h.verifiedBy}
                                      </span>
                                    )}
                                    {/* Corregir el horario REAL es un concepto aparte de verificar si se
                                        hicieron las tareas — se muestra sin importar verificationStatus. */}
                                    <div style={{ marginTop: '4px' }}>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenScheduleCorrectionModal(h)}
                                        style={{ fontSize: '10.5px', fontWeight: 700, color: '#374151', background: 'none', border: '1px solid var(--color-gray-400)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                                      >
                                        ✏️ Corregir Horario
                                      </button>
                                    </div>
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
                                );
                              })()}
                            </div>
                          </td>
                          {activeBlocks.map((block, blockIndex) => {
                            const opHasBlock = block.startHour >= opStartHour && block.endHour <= opEndHour;
                            
                            const isOvertimeBlock = block.startHour < 8 || block.startHour >= defaultEnd;

                            const isLive = selectedDate === todayStr && block.id === liveBlockId;
                            // Un bloque de HOY que aún no llega (empieza después de la hora
                            // actual) no es "pasado" — antes cualquier bloque que no fuera el
                            // vivo se trataba como "previo" y quedaba editable, lo que permitía
                            // abrir y calificar bloques FUTUROS por error.
                            const currentHour = new Date().getHours();
                            const isFutureBlock = selectedDate === todayStr && !isLive && block.startHour > currentHour;
                            const isPastBlock = selectedDate < todayStr || (selectedDate === todayStr && !isLive && !isFutureBlock);
                            const isOpAbsent = Boolean(op.estado?.tipo && op.estado.tipo !== 'activo');

                            const existingEval = dailyEvaluaciones.find(
                              (ev) => ev.operarioId === op.id && ev.blockId === block.id
                            );

                            if (!opHasBlock) {
                              return (
                                <td
                                  key={block.id}
                                  data-label={block.name}
                                  className={styles.disabledCell}
                                  title="Fuera de su jornada asignada"
                                >
                                  <span className={styles.naText}>N/A</span>
                                </td>
                              );
                            }

                            if (isFutureBlock) {
                              return (
                                <td
                                  key={block.id}
                                  data-label={block.name}
                                  className={styles.disabledCell}
                                  title="Este bloque todavía no llega — no se puede evaluar por adelantado"
                                >
                                  <span className={styles.naText}>🔒 Aún no llega</span>
                                </td>
                              );
                            }

                            return (
                              <td
                                key={block.id}
                                data-label={block.name}
                                className={`${styles.evalCell} ${isLive ? styles.activeBlockCell : ''} ${isOvertimeBlock ? styles.overtimeBlockCell : ''}`}
                              >
                                {existingEval ? (
                                  !isOpAbsent ? (
                                    <button
                                      type="button"
                                      className={styles.scoreContainer}
                                      onClick={() => handleOpenEvalModal(op, block, existingEval, isPastBlock)}
                                      title={isPastBlock ? "Clic para editar calificación/observaciones de bloque previo (Registra alerta y bitácora con hora y autor)" : "Clic para editar observaciones"}
                                    >
                                      <Badge variant={getScoreVariant(existingEval.score)}>
                                        ⭐ {existingEval.score} / 10
                                      </Badge>
                                      {isPastBlock && (
                                        <span style={{ fontSize: '11px', display: 'inline-block', marginTop: '2px' }} title="Bloque previo - Clic para editar">
                                          ✏️
                                        </span>
                                      )}
                                      {existingEval.notes && (
                                        <span className={styles.evalNote} title={existingEval.notes}>
                                          {existingEval.notes}
                                        </span>
                                      )}
                                    </button>
                                  ) : (
                                    <div
                                      className={styles.scoreContainerDisabled}
                                      title={`No editable: El colaborador está ${op.estado?.tipo}`}
                                    >
                                      <Badge variant={getScoreVariant(existingEval.score)}>
                                        ⭐ {existingEval.score} / 10
                                      </Badge>
                                      <span className={styles.evalNote} title={existingEval.notes}>
                                        {existingEval.notes}
                                      </span>
                                    </div>
                                  )
                                ) : isOpAbsent ? (
                                  blockIndex === firstValidBlockIndex ? (
                                    <span
                                      className={styles.closedBlockLabel}
                                      style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', borderColor: '#fca5a5', whiteSpace: 'nowrap' }}
                                      title={`No evaluable: El colaborador no está En Planta (${ESTADO_AUSENCIA_DESCRIP[op.estado?.tipo] || op.estado?.tipo})`}
                                    >
                                      🚫 {ESTADO_AUSENCIA_DESCRIP[op.estado?.tipo] || 'Ausente'}
                                    </span>
                                  ) : (
                                    <span
                                      style={{ color: 'var(--color-gray-400)', fontSize: '13px', fontWeight: 'bold' }}
                                      title={`Inactivo (${ESTADO_AUSENCIA_DESCRIP[op.estado?.tipo] || op.estado?.tipo})`}
                                    >
                                      —
                                    </span>
                                  )
                                ) : isLive ? (
                                  <div className={styles.calificarBtnContainer}>
                                    <button
                                      type="button"
                                      className={`${styles.calificarBtn} ${styles.pulseCalificarBtn} ${isOvertimeBlock ? styles.overtimeCalificarBtn : ''}`}
                                      onClick={() => handleOpenEvalModal(op, block, null, false)}
                                    >
                                      ＋ Calificar
                                    </button>
                                    {isOvertimeBlock && <span className={styles.overtimeIndicatorText}>Extra</span>}
                                  </div>
                                ) : (
                                  <div className={styles.calificarBtnContainer}>
                                    <button
                                      type="button"
                                      className={`${styles.calificarBtn}`}
                                      style={{
                                        backgroundColor: '#fffbe6',
                                        color: '#d48806',
                                        borderColor: '#ffe58f',
                                        fontSize: '13px',
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}
                                      onClick={() => handleOpenEvalModal(op, block, null, true)}
                                      title="Evaluar / Registrar observaciones en este bloque previo (Genera auditoría)"
                                    >
                                      ✍️
                                    </button>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {areaOperarios.length === 0 && (
                      <tr>
                        <td colSpan={activeBlocks.length + 1} className={styles.emptyCell}>
                          No hay colaboradores asignados a esta área actualmente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {hasMoreAreaOperarios && (
                <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
                  <Button variant="secondary" onClick={showMoreAreaOperarios}>
                    Cargar {Math.min(remainingAreaOperarios, 15)} más ({remainingAreaOperarios} restantes)
                  </Button>
                </div>
              )}
            </Card>
          </motion.div>
        </div>
      )}

      {/* 4. HORAS EXTRA PENDIENTES DE VERIFICAR (de cualquier fecha, con filtro opcional) */}
      {activeTab === 'horasExtra' && (
        <motion.div variants={itemVariants}>
          <Card variant="default">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: '16px' }}>
              <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>Filtrar por Fecha</label>
                <input
                  type="date"
                  className={styles.textInput}
                  value={pendingHEDateFilter}
                  onChange={(e) => setPendingHEDateFilter(e.target.value)}
                />
              </div>
              {pendingHEDateFilter && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setPendingHEDateFilter('')}>
                  ✕ Quitar Filtro
                </Button>
              )}
              <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                Mostrando {pendingHEList.length} pendiente{pendingHEList.length === 1 ? '' : 's'}
                {pendingHEDateFilter ? ` del ${pendingHEDateFilter}` : ' (todas las fechas)'}
              </span>
            </div>

            {pendingHEList.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--color-gray-500)', textAlign: 'center', padding: '24px' }}>
                {pendingHEDateFilter
                  ? 'No hay horas extra pendientes de verificar en esa fecha.'
                  : '✅ No hay horas extra pendientes de verificar.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {pendingHEList.map((h) => {
                  const { earlyHours, earlyRange, lateHours, lateRange } = getOvertimeBlocks(h.startHour, h.endHour, h.authorizedDate);
                  const esDomingo = Boolean(h.authorizedDate) && new Date(`${h.authorizedDate}T00:00:00`).getDay() === 0;
                  return (
                    <div
                      key={h.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: 'rgba(255, 153, 51, 0.08)',
                        border: '1px solid rgba(255, 153, 51, 0.25)',
                        fontSize: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', marginBottom: '4px' }}>
                        <strong style={{ color: 'var(--color-secondary)' }}>
                          📅 {h.authorizedDate} — {h.operarioName} <span style={{ fontWeight: 400, color: 'var(--color-gray-600)' }}>({AREAS.find((a) => a.id === h.areaId)?.name || h.areaId})</span>
                        </strong>
                        <span style={{ fontWeight: 700 }}>{h.overtimeHours}h</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
                        {esDomingo ? (
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: '#fdf2f8', color: '#9d174d', border: '1px solid #fbcfe8' }}>
                            📅 Domingo Completo: {h.overtimeHours}h ({String(h.startHour).padStart(2, '0')}:00-{String(h.endHour).padStart(2, '0')}:00)
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
                      <div style={{ color: 'var(--color-gray-700)', marginBottom: '6px' }}>{h.overtimeTasks}</div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
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
                        <button
                          type="button"
                          onClick={() => handleOpenScheduleCorrectionModal(h)}
                          style={{ fontSize: '10.5px', fontWeight: 700, color: '#374151', background: 'none', border: '1px solid var(--color-gray-400)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                        >
                          ✏️ Corregir Horario
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Modal para Registrar/Editar Evaluación de Colaborador */}
      {evalModal.isOpen && (
        <Modal
          isOpen={evalModal.isOpen}
          onClose={handleCloseEvalModal}
          title={`${evalModal.isPastBlockEdit ? '⚠️ Modificación de Bloque Previo' : 'Evaluación de Desempeño'}: ${evalModal.collaborator?.name}`}
        >
          <form onSubmit={handleSaveEval} className={styles.modalForm}>
            {evalModal.isPastBlockEdit && (
              <div style={{ backgroundColor: '#fffbe6', border: '1px solid #ffe58f', borderRadius: '6px', padding: '10px 14px', marginBottom: '12px' }}>
                <p style={{ margin: 0, fontSize: '12px', color: '#873800', fontWeight: 'bold' }}>
                  ⚠️ AVISO DE AUDITORÍA: Estás modificando un bloque de tiempo previo ({evalModal.block?.name} — Fecha {selectedDate}).
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#612500' }}>
                  El sistema emitirá una alerta y registrará en bitácora la hora exacta ({new Date().toLocaleTimeString('es-MX')}) y el responsable ({user?.name || 'Usuario'}).
                </p>
              </div>
            )}

            <div className={styles.modalMetaInfo}>
              <div>
                <strong>Área:</strong> {AREAS.find((a) => a.id === evalAreaId)?.name}
              </div>
              <div>
                <strong>Horario:</strong> {evalModal.block?.name} ({evalModal.block?.timeRange})
              </div>
            </div>

            <div className={styles.formGroup}>
              <Select
                label="Calificación del Desempeño"
                value={evalModal.score}
                onChange={(e) => setEvalModal({ ...evalModal, score: e.target.value })}
                required
                options={[
                  { value: '10', label: '10 - Excelente' },
                  { value: '9', label: '9 - Muy Bueno' },
                  { value: '8', label: '8 - Bueno' },
                  { value: '7', label: '7 - Aceptable' },
                  { value: '6', label: '6 - Deficiente' },
                  { value: '5', label: '5 - Crítico' },
                  { value: '4', label: '4 - Inaceptable' },
                  { value: '3', label: '3 - Grave' },
                  { value: '2', label: '2 - Muy Grave' },
                  { value: '1', label: '1 - Sin Desempeño' },
                ]}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Observaciones y Comentarios</label>
              <textarea
                className={styles.textarea}
                placeholder="Describe el comportamiento, cumplimiento de seguridad, orden y calidad del operario..."
                value={evalModal.notes}
                onChange={(e) => setEvalModal({ ...evalModal, notes: e.target.value })}
                required
                rows="4"
              />
            </div>

            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" onClick={handleCloseEvalModal}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Guardar Evaluación
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: MARCAR TAREAS DE TIEMPO EXTRA COMO "NO CUMPLIDO" (requiere motivo) */}
      {horasExtraRejectModal.isOpen && (
        <Modal
          isOpen={horasExtraRejectModal.isOpen}
          onClose={handleCloseHorasExtraRejectModal}
          title="❌ Tareas de Tiempo Extra No Cumplidas"
        >
          <form onSubmit={handleSubmitHorasExtraReject} className={styles.modalForm}>
            <div className={styles.formGroup}>
              <label className={styles.label}>¿Qué no se cumplió?</label>
              <textarea
                rows="3"
                required
                placeholder="Ej: Solo terminó la mitad del pedido, no se realizó el lijado final..."
                value={horasExtraRejectModal.notes}
                onChange={(e) => setHorasExtraRejectModal((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div className={styles.modalActions}>
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

      {/* MODAL: CORREGIR HORARIO REAL DE TIEMPO EXTRA (llegó/se retiró distinto a lo autorizado) */}
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
            <form onSubmit={handleSubmitScheduleCorrection} className={styles.modalForm}>
              <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: 0 }}>
                Autorizado: {String(targetHE.startHour).padStart(2, '0')}:00 - {String(targetHE.endHour).padStart(2, '0')}:00. Ajusta solo la hora del bloque que en realidad no se cumplió como se autorizó.
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
                  rows="3"
                  required
                  placeholder="Ej: Llegó a las 8:00 en vez de las 6:00 autorizadas, no se realizó el bloque matutino completo..."
                  value={scheduleCorrectionModal.reason}
                  onChange={(e) => setScheduleCorrectionModal((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </div>

              <div className={styles.modalActions}>
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

      {/* MODAL: VISTA AMPLIADA DE EVIDENCIA FOTOGRÁFICA */}
      {photoPreview && (
        <Modal
          isOpen={Boolean(photoPreview)}
          onClose={() => setPhotoPreview(null)}
          title="📷 Evidencia Fotográfica"
        >
          <img
            src={photoPreview}
            alt="Evidencia fotográfica ampliada"
            style={{ width: '100%', borderRadius: '8px', display: 'block' }}
          />
        </Modal>
      )}

      {/* MODAL: RECHAZAR REVISIÓN DE CALIDAD */}
      <Modal
        isOpen={rejectModal.isOpen}
        onClose={handleCloseRejectModal}
        title={`↩️ Rechazar Revisión: ${reviewGameObj?.name || ''}`}
      >
        <form onSubmit={handleSubmitReject} className={styles.modalForm}>
          <div className={styles.formGroup}>
            <label className={styles.label}>¿Qué no cumplió? *</label>
            <textarea
              className={styles.textarea}
              placeholder="Ej: Se encontraron rebabas sin lijar en 3 piezas, favor de retrabajar y solicitar nueva revisión."
              value={rejectModal.notes}
              onChange={(e) => setRejectModal((prev) => ({ ...prev, notes: e.target.value }))}
              rows="4"
              required
            />
          </div>
          <div className={styles.modalActions}>
            <Button type="button" variant="secondary" onClick={handleCloseRejectModal}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Confirmar Rechazo
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: EDITAR AUDITORÍA DE CALIDAD */}
      {isEditInspectionModalOpen && (
        <Modal
          isOpen={isEditInspectionModalOpen}
          onClose={() => {
            setIsEditInspectionModalOpen(false);
            setEditingInspection(null);
          }}
          title={`✏️ Editar Auditoría: ${editingInspection?.gameName || ''}`}
        >
          <form onSubmit={handleSaveEditInspection} className={styles.modalForm} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className={styles.formGroup}>
              <Select
                label="Resultado de Inspección *"
                value={editInspectionForm.status}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditInspectionForm((prev) => ({
                    ...prev,
                    status: val,
                    defectType: val === 'aprobado' ? '' : prev.defectType,
                    defectAction: val === 'aprobado' ? 'Ninguna' : (prev.defectAction === 'Ninguna' ? 'retrabajo' : prev.defectAction),
                  }));
                }}
                required
                options={[
                  { value: 'aprobado', label: 'Pasa (Aprobado)' },
                  { value: 'defectuoso', label: 'No Pasa (Con Defectos)' },
                ]}
              />
            </div>

            <div className={styles.formGroup}>
              <Input
                label="Pieza / Componente Revisado *"
                value={editInspectionForm.pieceName}
                onChange={(e) => setEditInspectionForm((prev) => ({ ...prev, pieceName: e.target.value }))}
                required
              />
            </div>

            {editInspectionForm.status === 'defectuoso' && (
              <>
                <div className={styles.formGroup}>
                  <Input
                    label="Tipo de Defecto *"
                    placeholder="Ej: Soldadura porosa, Madera rota"
                    value={editInspectionForm.defectType}
                    onChange={(e) => setEditInspectionForm((prev) => ({ ...prev, defectType: e.target.value }))}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <Select
                    label="Destino / Acción de la Pieza Defectuosa *"
                    value={editInspectionForm.defectAction}
                    onChange={(e) => setEditInspectionForm((prev) => ({ ...prev, defectAction: e.target.value }))}
                    required
                    options={[
                      { value: 'retrabajo', label: '🛠️ Re-trabajo (Corregir / Cortar)' },
                      { value: 'desecho', label: '🗑️ Desecho / Scrap (Desechar material)' },
                      { value: 'reutilizacion', label: '♻️ Reutilización / Reclasificación' },
                    ]}
                  />
                </div>
              </>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label}>Observaciones y Detalles del Defecto</label>
              <textarea
                className={styles.textarea}
                value={editInspectionForm.notes}
                onChange={(e) => setEditInspectionForm((prev) => ({ ...prev, notes: e.target.value }))}
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
                id="quality-edit-photo-capture"
                onChange={handleAddEditInspectionPhotos}
                disabled={isUploadingEditInspectionPhotos}
              />
              <label
                htmlFor="quality-edit-photo-capture"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: isUploadingEditInspectionPhotos ? 'wait' : 'pointer',
                  border: '1px dashed var(--color-primary)',
                  backgroundColor: 'rgba(255, 51, 0, 0.03)',
                  fontWeight: '600',
                  color: 'var(--color-primary)',
                  height: '42px',
                  borderRadius: '8px',
                  opacity: isUploadingEditInspectionPhotos ? 0.6 : 1,
                }}
              >
                {isUploadingEditInspectionPhotos ? '⏳ Subiendo...' : '📷 Agregar Evidencia'}
              </label>

              {editInspectionPhotos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                  {editInspectionPhotos.map((photo, idx) => (
                    <div key={(typeof photo === 'object' && photo.path) || idx} style={{ position: 'relative' }}>
                      <img
                        src={getPhotoSrc(photo)}
                        alt={`Evidencia ${idx + 1}`}
                        style={{
                          width: '64px',
                          height: '64px',
                          objectFit: 'cover',
                          borderRadius: '8px',
                          border: '1px solid var(--color-gray-200)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setPhotoPreview(getPhotoSrc(photo))}
                      />
                      {typeof photo !== 'string' && (
                        <button
                          type="button"
                          onClick={() => handleRemoveEditInspectionPhoto(photo)}
                          title="Quitar evidencia"
                          style={{
                            position: 'absolute',
                            top: '-6px',
                            right: '-6px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: 'var(--color-danger)',
                            color: '#fff',
                            border: 'none',
                            fontSize: '11px',
                            lineHeight: 1,
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.modalActions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsEditInspectionModalOpen(false);
                  setEditingInspection(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Guardar Cambios
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN */}
      {deleteConfirmation.isOpen && (
        <Modal
          isOpen={deleteConfirmation.isOpen}
          onClose={() => setDeleteConfirmation({ isOpen: false, inspectionId: null, gameName: '' })}
          title="⚠️ Confirmar Eliminación"
        >
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--body-size)', color: 'var(--color-dark)' }}>
              ¿Estás seguro de que deseas eliminar la inspección de calidad para el juego <strong>{deleteConfirmation.gameName}</strong>?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción es irreversible y actualizará automáticamente el estado de defectos del juego y las métricas en los reportes.
            </p>
            <div className={styles.modalActions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDeleteConfirmation({ isOpen: false, inspectionId: null, gameName: '' })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleConfirmDelete}
              >
                Eliminar Registro
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  );
};

export default CalidadPage;
