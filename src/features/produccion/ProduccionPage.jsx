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
import { isAreaBlockedBySequence, AREA_SEQUENCE_DEPENDENCIES } from '../../context/ProduccionContext';
import useAuth from '../../hooks/useAuth';
import { isReadOnlySection, canAccessSection } from '../../utils/roleAccess';
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

  const { operarios } = useOperarios();
  const { user } = useAuth();
  const isReadOnly = isReadOnlySection(user, 'produccion');

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
  const deliveryStatus = selectedGameObj?.areaDeliveryStatus?.[areaId] || 'pendiente';
  const qualityReviewForArea = selectedGameObj?.qualityReview?.[areaId];
  const qualityStatus = qualityReviewForArea?.status || 'pendiente';
  const isQualityApproved = qualityStatus === 'aprobado';

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
      <div className={styles.areaViewHeader}>
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div className={styles.bannerSuccess}>
                          <strong>✓ Producción Finalizada:</strong>
                          <span>La meta de <strong>{targetPiecesForArea}</strong> piezas para este juego en esta área ha sido completada al 100%. Registro de piezas cerrado.</span>
                        </div>
                        {deliveryStatus === 'pendiente' && !isQualityApproved && (
                          <div className={styles.bannerDanger} style={{ marginTop: '4px' }}>
                            <strong>{qualityStatus === 'rechazado' ? '❌ Calidad Rechazó la Revisión:' : '⏳ Esperando Aprobación de Calidad:'}</strong>
                            <span>
                              {qualityStatus === 'rechazado'
                                ? (qualityReviewForArea?.notes || 'Corrige lo señalado por Calidad y solicita una nueva revisión.')
                                : 'Calidad debe aprobar el checklist de revisión de esta área antes de poder notificar la entrega a Producto Terminado.'}
                            </span>
                          </div>
                        )}
                        {deliveryStatus === 'pendiente' && isQualityApproved && (
                          <div style={{ marginTop: '4px' }}>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                notifyAreaDelivery(selectedGameObj.id, areaId);
                                toast.success(`🔔 Se ha notificado la entrega de "${selectedGameObj.name}" a Producto Terminado.`);
                              }}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                            >
                              🔔 Notificar Entrega a Producto Terminado
                            </Button>
                          </div>
                        )}
                        {deliveryStatus === 'notificado_pt' && (
                          <div className={styles.bannerWarning} style={{ marginTop: '4px', borderLeftColor: 'var(--color-primary)' }}>
                            <strong>⏳ Entrega Notificada:</strong>
                            <span>Esperando que Producto Terminado (PT) verifique con el checklist y reciba el lote.</span>
                          </div>
                        )}
                        {deliveryStatus === 'recibido_pt' && (
                          <div className={styles.bannerSuccess} style={{ marginTop: '4px' }}>
                            <strong>✅ Entrega Recibida:</strong>
                            <span>El lote de piezas de esta área ya fue verificado y recibido en Producto Terminado.</span>
                          </div>
                        )}
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
                  <th>Fecha Límite</th>
                  <th>Piezas Externas</th>
                  {areaId === 'mantenimiento' && <th>Iluminación LED</th>}
                </tr>
              </thead>
              <tbody>
                {filteredJuegos.map((j) => {
                  const target = j.targetPieces?.[areaId] || 10;
                  const produced = j.producedPieces?.[areaId] || 0;
                  const pct = Math.min(100, Math.round((produced / target) * 100));
                  const isFinished = produced >= target;
                  const isStarted = produced > 0;

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
                    <td colSpan={areaId === 'mantenimiento' ? 8 : 7} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-gray-500)' }}>
                      No hay juegos activos asignados a esta área actualmente.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>

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
    </motion.div>
  );
};

export default ProduccionPage;
