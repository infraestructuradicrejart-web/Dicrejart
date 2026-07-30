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
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
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
    returnDeliveryForReview,
  } = useProduccion();

  const { user } = useAuth();
  const toast = useToast();

  // Regresar una entrega notificada al área de origen (error detectado antes de recibirla)
  const [returnModal, setReturnModal] = useState({ isOpen: false, item: null, notes: '' });

  // Gestión de pestañas: 'recepcion' | 'envios'
  const [activeTab, setActiveTab] = useState('recepcion');

  // Estados para Recepción con Checklist
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [checklistItems, setChecklistItems] = useState([]);
  const [isChecklistEditing, setIsChecklistEditing] = useState(false);
  const [newChecklistItem, setNewChecklistItem] = useState({ text: '', quantity: 1 });

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
          });
        }
      });
    });
    return list;
  }, [juegos]);

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
  };

  const handleCloseReceptionModal = () => {
    setSelectedDelivery(null);
    setChecklistItems([]);
    setIsChecklistEditing(false);
    setNewChecklistItem({ text: '', quantity: 1 });
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
                  {pendingDeliveries.map((item) => (
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
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenReturnModal(item)}
                            style={{ padding: '6px 12px', fontSize: '12px' }}
                            title="Regresar al área de origen (ej. se detectó un error antes de recibirla)"
                          >
                            ↩️ Regresar
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleOpenReceptionModal(item)}
                            style={{ padding: '6px 12px', fontSize: '12px' }}
                          >
                            📋 Verificar y Recibir
                          </Button>
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
                </div>
              </div>

              {/* Sección 2: Piezas Recibidas y Listas para Entarimar */}
              <div>
                <div className={styles.columnHeader}>
                  <h3 className={styles.columnTitle}>Piezas Listas para Entarimar</h3>
                  <Badge variant="primary">{bulkItemsReceived.length} lotes listos</Badge>
                </div>

                <div className={styles.listContainer}>
                  {bulkItemsReceived.map((item) => (
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
                {tarimas.map((t) => (
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
              {envios.map((e) => (
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
                            if (!e.items || e.items.length === 0) {
                              toast.danger('No se puede iniciar la carga: el envío está vacío. Por favor, edita y agrega elementos primero.');
                              return;
                            }
                            updateEnvioStatus(e.id, 'carga');
                            toast.warning(`🏗️ Carga de envío ${e.id} iniciada.`);
                          }}
                        >
                          🏗️ Iniciar Carga
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
                          Cancelar
                        </Button>
                      </>
                    )}

                    {!readOnly && e.status === 'carga' && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            if (!e.items || e.items.length === 0) {
                              toast.danger('No se puede despachar: el envío está vacío. Por favor, edita y agrega elementos primero.');
                              return;
                            }
                            updateEnvioStatus(e.id, 'enviado');
                            toast.success(`🟢 Envío ${e.id} despachado. ¡Camión en ruta!`);
                          }}
                        >
                          🚚 Despachar Unidad
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            deleteEnvio(e.id);
                            toast.info(`Envío ${e.id} cancelado (se detuvo el proceso de carga).`);
                          }}
                          style={{ color: 'var(--color-danger)' }}
                          title="Detener el proceso de carga y eliminar este envío"
                        >
                          ❌ Cancelar Carga
                        </Button>
                      </>
                    )}

                    {e.status === 'enviado' && (
                      <span style={{ fontSize: '13px', color: 'var(--color-success)', fontWeight: 'bold' }}>
                        ✓ Entregado a Chofer
                      </span>
                    )}
                  </div>
                </Card>
              ))}

              {envios.length === 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <EmptyState
                    message="No hay envíos programados en sistema."
                    shape="trebol"
                    color="var(--color-blue-magenta-violet)"
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
