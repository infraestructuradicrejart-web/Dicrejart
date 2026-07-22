/**
 * @file EditorVisualPage.jsx
 * @description Editor Visual de Asignaciones de Dicrejart — un lienzo tipo grafo de nodos
 * para crear y relacionar Proyectos, Juegos, Actividades, Áreas y Colaboradores, conectado
 * a los datos reales de la aplicación (no es una copia ni un sistema paralelo).
 * Conectado en tiempo real con Cloud Firestore por proyecto.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 * @requires firebase/firestore
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import useToast from '../../hooks/useToast';
import useProduccion from '../../hooks/useProduccion';
import useActividades from '../../hooks/useActividades';
import useOperarios from '../../hooks/useOperarios';
import useAuth from '../../hooks/useAuth';
import { AREA_SEQUENCE_DEPENDENCIES, isAreaBlockedBySequence } from '../../context/ProduccionContext';
import { AREAS_CATALOG } from '../../data/areasConfig';
import { NON_PRODUCTION_AREAS } from '../../data/nonProductionAreasConfig';
import styles from './EditorVisualPage.module.css';

/** Ancho/alto aproximado de un nodo, usado para calcular dónde dibujar cada línea */
const NODE_WIDTH = 214;
const NODE_HEIGHT = 80;

/** Tipos de nodo disponibles, con su color de marca y si permiten crear un registro nuevo */
const NODE_TYPES = {
  proyecto: { icon: '🗂️', label: 'Proyecto', colorVar: 'var(--color-secondary)', allowCreate: true },
  juego: { icon: '🎮', label: 'Juego', colorVar: 'var(--color-tiffany-blue)', allowCreate: true },
  area: { icon: '🏭', label: 'Área', colorVar: 'var(--color-princeton-orange)', allowCreate: false },
  actividad: { icon: '📌', label: 'Actividad', colorVar: 'var(--color-golden-yellow)', allowCreate: true },
  colaborador: { icon: '👷', label: 'Colaborador', colorVar: 'var(--color-purple-x11)', allowCreate: false },
  bloque: { icon: '📦', label: 'Bloque de Actividades', colorVar: 'var(--color-alert)', allowCreate: true },
};

/** Áreas seleccionables al crear un Bloque: las 8 de manufactura + las no productivas (ej. Diseño) */
const ALL_BLOCK_AREAS = [...AREAS_CATALOG, ...NON_PRODUCTION_AREAS];

const PRIORITY_OPTIONS = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
];

const PROJECT_STATUS_OPTIONS = [
  { value: 'diseno', label: 'En Diseño' },
  { value: 'progreso', label: 'En Progreso' },
  { value: 'pausado', label: 'Pausado' },
];

let nodeSeq = Date.now();
const nextNodeId = () => {
  nodeSeq += 1;
  return `n-${nodeSeq}`;
};

let edgeSeq = Date.now();
const nextEdgeId = () => {
  edgeSeq += 1;
  return `e-${edgeSeq}`;
};

const bezierPath = (p1, p2) => {
  const dx = Math.max(60, Math.abs(p2.x - p1.x) * 0.5);
  return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
};

/**
 * Componente EditorVisualPage - Editor visual tipo grafo para crear/relacionar entidades
 * @component
 * @returns {ReactElement}
 */
const EditorVisualPage = ({ standalone = false }) => {
  const { proyectos, juegos, addProject, addGame } = useProduccion();
  const { actividades, addActividad, deleteActividad } = useActividades();
  const { operarios, assignToArea } = useOperarios();
  const { user } = useAuth();
  const toast = useToast();

  // ============================================
  // PROYECTO ACTIVO (Lienzo por Proyecto)
  // ============================================
  const [proyectoActivoId, setProyectoActivoId] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('proyectoId') || '';
    }
    return '';
  });

  // Refleja el proyecto activo en la URL para que la selección sobreviva a un
  // refresco de página (sin esto, recargar perdía de vista qué lienzo se estaba viendo)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (proyectoActivoId) {
      url.searchParams.set('proyectoId', proyectoActivoId);
    } else {
      url.searchParams.delete('proyectoId');
    }
    window.history.replaceState({}, '', url);
  }, [proyectoActivoId]);

  // Solo los administradores pueden modificar y guardar diagramas
  const canEditDiagram = user?.roleType === 'admin';

  // ============================================
  // ESTADO DEL GRAFO
  // ============================================
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [worldOffset, setWorldOffset] = useState({ x: 40, y: 30 });
  const [howtoOpen, setHowtoOpen] = useState(false);
  // Qué Bloques tienen su lista de actividades desplegada — solo local (no se guarda en
  // Firestore), cada quien decide qué tiene abierto en su propia pantalla.
  const [expandedBlocks, setExpandedBlocks] = useState(() => new Set());
  const toggleBlockExpanded = (nodeId) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };
  // Confirmación antes de borrar un Bloque que ya tiene actividades reales adentro
  const [deleteBlockConfirm, setDeleteBlockConfirm] = useState({ isOpen: false, nodeId: null });

  const canvasWrapRef = useRef(null);
  const dragStateRef = useRef(null);
  const connectStateRef = useRef(null);
  const panStateRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const [previewWire, setPreviewWire] = useState(null);

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE
  // ============================================
  useEffect(() => {
    if (!db || !proyectoActivoId) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const unsubscribe = onSnapshot(doc(db, 'lienzos', proyectoActivoId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setNodes(data.nodes || []);
        setEdges(data.edges || []);
        if (data.worldOffset) {
          setWorldOffset(data.worldOffset);
        }
      } else {
        // Inicializar el lienzo vacío en Firestore
        setDoc(doc(db, 'lienzos', proyectoActivoId), {
          nodes: [],
          edges: [],
          worldOffset: { x: 40, y: 30 },
        });
      }
    });

    return unsubscribe;
  }, [proyectoActivoId]);

  /**
   * Guarda de forma transparente el estado actual del lienzo en Firestore
   */
  const saveToFirestore = useCallback(async (newNodes, newEdges, newOffset) => {
    if (!db || !proyectoActivoId || !canEditDiagram) return;
    try {
      await setDoc(doc(db, 'lienzos', proyectoActivoId), {
        nodes: newNodes,
        edges: newEdges,
        worldOffset: newOffset || worldOffset,
      });
    } catch (e) {
      console.error('Error al guardar lienzo en Firestore:', e);
    }
  }, [proyectoActivoId, worldOffset, canEditDiagram]);

  const findNode = useCallback((id) => nodes.find((n) => n.id === id) || null, [nodes]);

  /** Devuelve el registro real (Proyecto/Juego/Actividad/Colaborador/Área) que representa un nodo, si ya está vinculado */
  const getLinkedEntity = useCallback(
    (node) => {
      if (!node || node.draft) return null;
      if (node.type === 'proyecto') return proyectos.find((p) => p.id === node.refId);
      if (node.type === 'juego') return juegos.find((j) => j.id === node.refId);
      if (node.type === 'actividad') return actividades.find((a) => a.id === node.refId);
      if (node.type === 'colaborador') return operarios.find((o) => o.id === node.refId);
      if (node.type === 'area') return AREAS_CATALOG.find((a) => a.id === node.refId);
      return null;
    },
    [proyectos, juegos, actividades, operarios]
  );

  const nodeTitle = useCallback(
    (node) => {
      // Un Bloque no representa un único registro real (Firestore) sino un grupo de
      // actividades, así que no pasa por getLinkedEntity — su "entidad" es su propio nombre.
      if (node.type === 'bloque') return node.blockName || 'Bloque sin nombre';
      if (node.draft) return node.draftFields.name || node.draftFields.title || 'Sin nombre';
      const entity = getLinkedEntity(node);
      if (!entity) return '(no encontrado)';
      return entity.name || entity.title || 'Sin nombre';
    },
    [getLinkedEntity]
  );

  /** Áreas de un Juego real que están bloqueadas por secuencia (ej. Herrería esperando Corte Láser) */
  const getBlockedAreas = useCallback(
    (gameEntity) => (gameEntity?.areas || []).filter((areaId) => isAreaBlockedBySequence(gameEntity, areaId)),
    []
  );

  const nodeSummary = useCallback(
    (node) => {
      if (node.type === 'bloque') {
        const areaName = ALL_BLOCK_AREAS.find((a) => a.id === node.areaId)?.name || node.areaId;
        const count = node.activityIds?.length || 0;
        return `${areaName} · ${count} actividad${count === 1 ? '' : 'es'}`;
      }
      if (node.draft) return '🆕 Aún no guardado en el sistema';
      const entity = getLinkedEntity(node);
      if (!entity) return 'Registro no encontrado';
      if (node.type === 'proyecto') return `${entity.client || 'Sin cliente'} · ${entity.progress ?? 0}%`;
      if (node.type === 'juego') {
        const blocked = getBlockedAreas(entity);
        const blockedSuffix = blocked.length > 0
          ? ` · 🔒 ${blocked.map((a) => AREAS_CATALOG.find((c) => c.id === a)?.name || a).join(', ')} bloqueada(s)`
          : '';
        const rejected = (entity.areas || []).filter((a) => entity.qualityReview?.[a]?.status === 'rechazado');
        const rejectedSuffix = rejected.length > 0
          ? ` · ❌ Calidad rechazó ${rejected.map((a) => AREAS_CATALOG.find((c) => c.id === a)?.name || a).join(', ')}`
          : '';
        return `${entity.projectName || ''} · ${entity.progress ?? 0}%${blockedSuffix}${rejectedSuffix}`;
      }
      if (node.type === 'actividad') {
        const responsable = operarios.find((o) => o.id === entity.operarioId)?.name;
        return `Área: ${AREAS_CATALOG.find((a) => a.id === entity.areaId)?.name || entity.areaId} · ${entity.status}${responsable ? ` · 👷 ${responsable}` : ''}`;
      }
      if (node.type === 'colaborador') return `Área actual: ${AREAS_CATALOG.find((a) => a.id === entity.currentArea)?.name || entity.currentArea}`;
      if (node.type === 'area') return 'Área de manufactura';
      return '';
    },
    [getLinkedEntity, getBlockedAreas, operarios]
  );

  // ============================================
  // POSICIONES DE PUERTOS Y LÍNEAS
  // ============================================
  const portPos = useCallback((node, side) => ({
    x: node.x + (side === 'out' ? NODE_WIDTH : 0),
    y: node.y + NODE_HEIGHT / 2,
  }), []);

  const worldBounds = useMemo(() => {
    let maxX = 500;
    let maxY = 500;
    nodes.forEach((n) => {
      maxX = Math.max(maxX, n.x + NODE_WIDTH + 260);
      maxY = Math.max(maxY, n.y + NODE_HEIGHT + 160);
    });
    return { width: maxX, height: maxY };
  }, [nodes]);

  // ============================================
  // ARRASTRAR NODOS
  // ============================================
  const handleNodeMouseDown = (e, nodeId) => {
    if (!canEditDiagram) return;
    if (
      e.target.closest('[data-role="port"]') ||
      e.target.closest('[data-role="close"]') ||
      e.target.closest('[data-role="block-panel"]')
    ) return;
    const node = findNode(nodeId);
    if (!node) return;
    setSelectedNodeId(nodeId);
    dragStateRef.current = {
      id: nodeId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
    };
    e.preventDefault();
  };

  /** Quita un nodo del lienzo (y sus cables) — ya decidido, sin más preguntas */
  const performDeleteNode = (nodeId) => {
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges.filter((ed) => ed.from !== nodeId && ed.to !== nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
    saveToFirestore(nextNodes, nextEdges);
  };

  const handleCloseNode = (nodeId) => {
    if (!canEditDiagram) return;
    const node = findNode(nodeId);
    // Un Bloque con actividades reales adentro no se borra directo: hay que confirmar
    // primero si también se eliminan esas actividades del sistema (ver handleConfirmDeleteBlockWithActivities).
    if (node?.type === 'bloque' && (node.activityIds || []).length > 0) {
      setDeleteBlockConfirm({ isOpen: true, nodeId });
      return;
    }
    performDeleteNode(nodeId);
  };

  const closeDeleteBlockConfirm = () => setDeleteBlockConfirm({ isOpen: false, nodeId: null });

  /**
   * Confirma el borrado de un Bloque junto con TODAS sus actividades reales. Es todo o
   * nada: si alguna actividad ya tiene avance (no está "pendiente") y no se puede borrar,
   * se aborta por completo — el bloque tampoco se elimina.
   */
  const handleConfirmDeleteBlockWithActivities = async () => {
    const node = findNode(deleteBlockConfirm.nodeId);
    if (!node) {
      closeDeleteBlockConfirm();
      return;
    }

    const linkedActivities = (node.activityIds || [])
      .map((id) => actividades.find((a) => a.id === id))
      .filter(Boolean);

    const blocked = linkedActivities.find((a) => a.status !== 'pendiente');
    if (blocked) {
      toast.danger(`No se puede eliminar: "${blocked.title}" ya tiene avance (${blocked.status}). Cámbiala a pendiente o elimínala manualmente desde Actividades antes de borrar el bloque.`);
      return;
    }

    for (const activity of linkedActivities) {
      // eslint-disable-next-line no-await-in-loop
      const res = await deleteActividad(activity.id);
      if (!res.ok) {
        toast.danger(`No se pudo eliminar "${activity.title}": ${res.error}`);
        return;
      }
    }

    performDeleteNode(node.id);
    toast.success('🗑️ Bloque y sus actividades eliminados.');
    closeDeleteBlockConfirm();
  };

  const handlePortMouseDown = (e, nodeId, side) => {
    if (!canEditDiagram) return;
    e.preventDefault();
    e.stopPropagation();
    connectStateRef.current = { fromId: nodeId, side };
    setPreviewWire({ x1: 0, y1: 0, x2: 0, y2: 0 });
  };

  const localPoint = (e) => {
    const rect = canvasWrapRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left - worldOffset.x, y: e.clientY - rect.top - worldOffset.y };
  };

  const handleCanvasMouseDown = (e) => {
    if (e.target !== canvasWrapRef.current && !e.target.dataset.canvasBg) return;
    panStateRef.current = { startMouseX: e.clientX, startMouseY: e.clientY, startOffset: worldOffset };
    setIsPanning(true);
  };

  const handleWindowMouseMove = (e) => {
    if (dragStateRef.current) {
      const { id, startMouseX, startMouseY, startNodeX, startNodeY } = dragStateRef.current;
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, x: Math.max(0, startNodeX + dx), y: Math.max(0, startNodeY + dy) } : n))
      );
    } else if (connectStateRef.current) {
      const { fromId, side } = connectStateRef.current;
      const fromNode = findNode(fromId);
      if (!fromNode) return;
      const start = portPos(fromNode, side === 'out' ? 'out' : 'in');
      const end = localPoint(e);
      setPreviewWire(
        side === 'out'
          ? { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
          : { x1: end.x, y1: end.y, x2: start.x, y2: start.y }
      );
    } else if (panStateRef.current) {
      const { startMouseX, startMouseY, startOffset } = panStateRef.current;
      setWorldOffset({ x: startOffset.x + (e.clientX - startMouseX), y: startOffset.y + (e.clientY - startMouseY) });
    }
  };

  const handleWindowMouseUp = (e) => {
    let dragNodeId = null;
    if (dragStateRef.current) {
      dragNodeId = dragStateRef.current.id;
      dragStateRef.current = null;
    }

    if (dragNodeId) {
      setNodes((latestNodes) => {
        saveToFirestore(latestNodes, edges);
        return latestNodes;
      });
    }

    if (connectStateRef.current) {
      const portEl = e.target.closest('[data-role="port"]');
      if (portEl) {
        const targetId = portEl.dataset.nodeId;
        const targetSide = portEl.dataset.side;
        const { fromId, side } = connectStateRef.current;
        if (targetId !== fromId && targetSide !== side) {
          const from = side === 'out' ? fromId : targetId;
          const to = side === 'out' ? targetId : fromId;
          setEdges((latestEdges) => {
            const alreadyExists = latestEdges.some((ed) => ed.from === from && ed.to === to);
            if (!alreadyExists) {
              const nextEdges = [...latestEdges, { id: nextEdgeId(), from, to }];
              saveToFirestore(nodes, nextEdges);
              return nextEdges;
            }
            return latestEdges;
          });
        }
      }
      connectStateRef.current = null;
      setPreviewWire(null);
    }

    if (panStateRef.current) {
      panStateRef.current = null;
      setIsPanning(false);
      setWorldOffset((latestOffset) => {
        saveToFirestore(nodes, edges, latestOffset);
        return latestOffset;
      });
    }
  };

  // ============================================
  // PICKER: BUSCAR EXISTENTE O CREAR NUEVO
  // ============================================
  const [picker, setPicker] = useState({ isOpen: false, type: null, query: '' });

  const catalogFor = useCallback(
    (type) => {
      if (type === 'proyecto') return proyectos.map((p) => ({ id: p.id, label: p.name }));
      if (type === 'juego') return juegos.map((j) => ({ id: j.id, label: `${j.name} (${j.projectName})` }));
      if (type === 'actividad') return actividades.map((a) => ({ id: a.id, label: a.title }));
      if (type === 'colaborador') {
        return operarios.map((o) => {
          const areaName = AREAS_CATALOG.find((a) => a.id === o.currentArea)?.name || o.currentArea;
          const loanTag = o.currentArea !== o.homeArea ? ' · prestado' : '';
          return { id: o.id, label: `${o.name} — ${areaName}${loanTag}` };
        });
      }
      if (type === 'area') return AREAS_CATALOG.map((a) => ({ id: a.id, label: a.name }));
      return [];
    },
    [proyectos, juegos, actividades, operarios]
  );

  const openPicker = (type) => {
    if (!canEditDiagram) return;
    setPicker({ isOpen: true, type, query: '' });
  };
  
  const closePicker = () => setPicker({ isOpen: false, type: null, query: '' });

  const spawnNode = (type, node) => {
    const column = nodes.length % 4;
    const row = Math.floor(nodes.length / 4);
    const spawnX = 40 + column * (NODE_WIDTH + 70);
    const spawnY = 40 + row * (NODE_HEIGHT + 90);
    const created = { id: nextNodeId(), type, x: spawnX, y: spawnY, ...node };
    const nextNodes = [...nodes, created];
    setNodes(nextNodes);
    setSelectedNodeId(created.id);
    saveToFirestore(nextNodes, edges);
  };

  const handlePickExisting = (type, entityId) => {
    spawnNode(type, { draft: false, refId: entityId, draftFields: {} });
    closePicker();
  };

  const handleCreateNewDraft = (type, name) => {
    const draftDefaults = {
      proyecto: { name, client: '', status: 'diseno' },
      juego: { name, meta_piezas: '10' },
      actividad: { title: name, description: '', priority: 'media', dueDate: '' },
    }[type];
    spawnNode(type, { draft: true, refId: null, draftFields: draftDefaults });
    closePicker();
  };

  const filteredCatalog = useMemo(() => {
    if (!picker.type) return [];
    const q = picker.query.trim().toLowerCase();
    return catalogFor(picker.type).filter((c) => c.label.toLowerCase().includes(q));
  }, [picker.type, picker.query, catalogFor]);

  // ============================================
  // BLOQUES: contenedores de actividades reales, agrupadas por área
  // ============================================
  // A diferencia de los demás tipos de nodo, un Bloque no representa un solo registro de
  // Firestore que se busca o se crea — necesita su propio nombre y un área desde el
  // arranque, así que su botón de la paleta abre este modal en vez del picker genérico.
  const [blockSetup, setBlockSetup] = useState({ isOpen: false, name: '', areaId: '' });

  const openBlockSetup = () => {
    if (!canEditDiagram) return;
    setBlockSetup({ isOpen: true, name: '', areaId: '' });
  };

  const closeBlockSetup = () => setBlockSetup({ isOpen: false, name: '', areaId: '' });

  const handleCreateBlock = () => {
    if (!blockSetup.name.trim() || !blockSetup.areaId) {
      toast.danger('Ingresa un nombre y selecciona un área para el bloque.');
      return;
    }
    spawnNode('bloque', {
      blockName: blockSetup.name.trim(),
      areaId: blockSetup.areaId,
      activityIds: [],
    });
    closeBlockSetup();
  };

  /** Cambia el nombre de un Bloque (la única propiedad editable directamente en el lienzo) */
  const updateBlockName = (nodeId, value) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, blockName: value } : n)));
  };

  /** true si el área del bloque es una de las 8 de manufactura (con Operarios reales asignables) */
  const isProductionArea = (areaId) => AREAS_CATALOG.some((a) => a.id === areaId);

  // ---- Crear una actividad NUEVA (real, en Firestore) directamente dentro de un Bloque ----
  const EMPTY_BLOCK_ACTIVITY = { isOpen: false, blockNodeId: null, title: '', description: '', priority: 'media', dueDate: '', operarioId: '' };
  const [blockActivityForm, setBlockActivityForm] = useState(EMPTY_BLOCK_ACTIVITY);

  const openBlockActivityForm = (blockNodeId) => setBlockActivityForm({ ...EMPTY_BLOCK_ACTIVITY, isOpen: true, blockNodeId });
  const closeBlockActivityForm = () => setBlockActivityForm(EMPTY_BLOCK_ACTIVITY);

  const handleCreateBlockActivity = async () => {
    const blockNode = findNode(blockActivityForm.blockNodeId);
    if (!blockNode || !blockActivityForm.title.trim()) {
      toast.danger('Ingresa un título para la actividad.');
      return;
    }
    const newId = await addActividad({
      title: blockActivityForm.title.trim(),
      description: blockActivityForm.description || 'Sin descripción.',
      areaId: blockNode.areaId,
      operarioId: blockActivityForm.operarioId || null,
      dueDate: blockActivityForm.dueDate || null,
      priority: blockActivityForm.priority,
    });
    if (!newId) {
      toast.danger('❌ No se pudo crear la actividad. Intenta de nuevo.');
      return;
    }
    const nextNodes = nodes.map((n) => (n.id === blockNode.id ? { ...n, activityIds: [...n.activityIds, newId] } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Actividad "${blockActivityForm.title.trim()}" creada y agregada al bloque.`);
    closeBlockActivityForm();
  };

  // ---- Enlazar al Bloque una actividad que YA existe en el sistema (sin crear una nueva) ----
  const [blockLinkPicker, setBlockLinkPicker] = useState({ isOpen: false, blockNodeId: null, query: '' });

  const openBlockLinkPicker = (blockNodeId) => setBlockLinkPicker({ isOpen: true, blockNodeId, query: '' });
  const closeBlockLinkPicker = () => setBlockLinkPicker({ isOpen: false, blockNodeId: null, query: '' });

  const blockLinkCandidates = useMemo(() => {
    const blockNode = findNode(blockLinkPicker.blockNodeId);
    if (!blockNode) return [];
    const q = blockLinkPicker.query.trim().toLowerCase();
    return actividades.filter(
      (a) => !blockNode.activityIds.includes(a.id) && a.title.toLowerCase().includes(q)
    );
  }, [blockLinkPicker.blockNodeId, blockLinkPicker.query, actividades, findNode]);

  const handleLinkExistingActivity = (activityId) => {
    const blockNode = findNode(blockLinkPicker.blockNodeId);
    if (!blockNode) return;
    const nextNodes = nodes.map((n) => (n.id === blockNode.id ? { ...n, activityIds: [...n.activityIds, activityId] } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    closeBlockLinkPicker();
  };

  /** Quita una actividad del Bloque (solo la desvincula de este lienzo; no la borra del sistema) */
  const handleUnlinkActivity = (blockNodeId, activityId) => {
    const nextNodes = nodes.map((n) =>
      n.id === blockNodeId ? { ...n, activityIds: n.activityIds.filter((id) => id !== activityId) } : n
    );
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
  };

  // ============================================
  // GUARDAR BORRADORES EN EL SISTEMA (acciones reales)
  // ============================================
  const handleSaveProyecto = async (node) => {
    const newId = await addProject({ name: node.draftFields.name, client: node.draftFields.client, status: node.draftFields.status });
    if (!newId) {
      toast.danger('❌ No se pudo guardar el Proyecto. Intenta de nuevo.');
      return;
    }
    const nextNodes = nodes.map((n) => (n.id === node.id ? { ...n, draft: false, refId: newId } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Proyecto "${node.draftFields.name}" creado en el sistema.`);
  };

  const handleSaveJuego = async (node) => {
    const projectEdge = edges.find((e) => e.to === node.id && findNode(e.from)?.type === 'proyecto');
    if (!projectEdge) {
      toast.danger('Conecta este Juego a un Proyecto antes de guardarlo.');
      return;
    }
    const projectNode = findNode(projectEdge.from);
    if (projectNode.draft) {
      toast.danger('Primero guarda el Proyecto conectado, luego este Juego.');
      return;
    }
    const areaEdges = edges.filter((e) => e.from === node.id && findNode(e.to)?.type === 'area');
    if (areaEdges.length === 0) {
      toast.danger('Conecta al menos un Área a este Juego antes de guardarlo.');
      return;
    }
    const areas = areaEdges.map((e) => findNode(e.to).refId);
    const targetPieces = {};
    areas.forEach((areaId) => {
      targetPieces[areaId] = Number(node.draftFields.meta_piezas) || 10;
    });

    const newId = await addGame({ name: node.draftFields.name, projectId: projectNode.refId, areas, targetPieces });
    if (!newId) {
      toast.danger('❌ No se pudo guardar el Juego. Intenta de nuevo.');
      return;
    }
    const nextNodes = nodes.map((n) => (n.id === node.id ? { ...n, draft: false, refId: newId } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Juego "${node.draftFields.name}" creado en el sistema.`);
  };

  const handleSaveActividad = async (node) => {
    const areaEdge = edges.find((e) => e.to === node.id && findNode(e.from)?.type === 'area');
    if (!areaEdge) {
      toast.danger('Conecta esta Actividad a un Área antes de guardarla.');
      return;
    }
    const areaId = findNode(areaEdge.from).refId;
    const colabEdge = edges.find((e) => e.from === node.id && findNode(e.to)?.type === 'colaborador');
    const operarioId = colabEdge ? findNode(colabEdge.to).refId : null;

    const newId = await addActividad({
      title: node.draftFields.title,
      description: node.draftFields.description || 'Sin descripción.',
      areaId,
      operarioId,
      dueDate: node.draftFields.dueDate || null,
      priority: node.draftFields.priority || 'media',
    });
    if (!newId) {
      toast.danger('❌ No se pudo guardar la Actividad. Intenta de nuevo.');
      return;
    }

    const nextNodes = nodes.map((n) => (n.id === node.id ? { ...n, draft: false, refId: newId } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Actividad "${node.draftFields.title}" creada en el sistema.`);
  };

  const updateDraftField = (nodeId, key, value) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, draftFields: { ...n.draftFields, [key]: value } } : n))
    );
  };

  // ============================================
  // REASIGNAR COLABORADOR A ÁREA (acción real)
  // ============================================
  const getConnectedAreaNode = (colabNodeId) => {
    const edge = edges.find((e) => e.to === colabNodeId && findNode(e.from)?.type === 'area');
    if (!edge) return null;
    return findNode(edge.from);
  };

  const handleAssignColaboradorToArea = (colaboradorEntity, areaNode) => {
    assignToArea(colaboradorEntity.id, areaNode.refId);
    toast.success(`🔁 ${colaboradorEntity.name} fue reasignado a ${nodeTitle(areaNode)}.`);
  };

  const handleOpenStandalone = () => {
    if (!proyectoActivoId) {
      toast.warning('Por favor selecciona un proyecto primero.');
      return;
    }
    window.open(
      `/editor-visual/ventana?proyectoId=${proyectoActivoId}`,
      'DicrejartEditorVisual',
      'width=1680,height=960,menubar=no,toolbar=no,location=no,status=no'
    );
  };

  // ============================================
  // ANIMACIONES
  // ============================================
  const containerVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.3 } },
  };

  const selectedNode = findNode(selectedNodeId);

  return (
    <motion.div className={`${styles.page} ${standalone ? styles.standalonePage : ''}`} variants={containerVariants} initial="initial" animate="animate">
      <PageHeader
        title="Editor Visual de Asignaciones"
        subtitle="Crea y relaciona Proyectos, Juegos, Actividades, Áreas y Colaboradores arrastrando conexiones."
        shape="arco-doble"
        accentColor="var(--color-secondary)"
      >
        {!standalone && (
          <div style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }}>
            <select
              value={proyectoActivoId}
              onChange={(e) => setProyectoActivoId(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--color-gray-700)',
                backgroundColor: 'var(--color-dark)',
                color: 'white',
                minWidth: '200px',
                cursor: 'pointer',
              }}
            >
              <option value="">Seleccionar Proyecto...</option>
              {proyectos.filter((p) => p.status !== 'completado').length > 0 && (
                <optgroup label="⚡ Proyectos Activos" style={{ backgroundColor: 'var(--color-dark)', color: 'white' }}>
                  {proyectos
                    .filter((p) => p.status !== 'completado')
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </optgroup>
              )}
              {proyectos.filter((p) => p.status === 'completado').length > 0 && (
                <optgroup label="📁 Historial (Finalizados)" style={{ backgroundColor: 'var(--color-dark)', color: 'white' }}>
                  {proyectos
                    .filter((p) => p.status === 'completado')
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name} (Completado)</option>
                    ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
        {standalone && (
          <Button variant="secondary" size="md" onClick={() => window.close()}>
            ✕ Cerrar Ventana
          </Button>
        )}
        {!standalone && (
          <Button
            variant="secondary"
            size="md"
            disabled={!proyectoActivoId}
            onClick={handleOpenStandalone}
          >
            🗔 Abrir en Ventana Aparte
          </Button>
        )}
        <Button variant="secondary" size="md" onClick={() => setHowtoOpen(true)}>
          ¿Cómo funciona?
        </Button>
      </PageHeader>

      {proyectoActivoId ? (
        <div className={styles.workspace}>
          {/* ---------- Rail: paleta + leyenda ---------- */}
          <aside className={styles.rail}>
            {canEditDiagram ? (
              <div>
                <h2 className={styles.railTitle}>Agregar Nodo</h2>
                <div className={styles.palette}>
                  {Object.entries(NODE_TYPES).map(([type, meta]) => (
                    <button
                      key={type}
                      type="button"
                      className={styles.paletteChip}
                      style={{ '--chip-color': meta.colorVar }}
                      onClick={() => (type === 'bloque' ? openBlockSetup() : openPicker(type))}
                    >
                      {meta.icon} {meta.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.calloutBox} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--color-gray-400)', fontSize: '12px' }}>
                ℹ️ Solo los Administradores pueden editar o arrastrar nodos en el diagrama.
              </div>
            )}

            <div>
              <h2 className={styles.railTitle}>Qué Significa Cada Línea</h2>
              <ul className={styles.legend}>
                <li><span className={styles.dot} style={{ background: 'var(--color-secondary)' }} /><span>Proyecto → Juego: <em>pertenece a</em></span></li>
                <li><span className={styles.dot} style={{ background: 'var(--color-tiffany-blue)' }} /><span>Juego → Área: <em>requiere</em></span></li>
                <li><span className={styles.dot} style={{ background: 'var(--color-princeton-orange)' }} /><span>Área ↔ Colaborador: <em>asignado a</em></span></li>
                <li><span className={styles.dot} style={{ background: 'var(--color-princeton-orange)' }} /><span>Área → Actividad: <em>incluye</em></span></li>
                <li><span className={styles.dot} style={{ background: 'var(--color-golden-yellow)' }} /><span>Actividad → Colaborador: <em>responsable</em></span></li>
              </ul>
            </div>

            <p className={styles.hint}>
              Arrastra desde el punto derecho de un nodo hasta el punto izquierdo de otro para conectar. Haz clic
              en un nodo para ver o guardar sus datos a la derecha. Arrastra el fondo del lienzo para desplazarte
              si tienes varios nodos. Ningún cambio real ocurre hasta que lo confirmes explícitamente en el panel
              derecho.
            </p>
          </aside>

          {/* ---------- Lienzo ---------- */}
          <div
            ref={canvasWrapRef}
            data-canvas-bg="true"
            className={`${styles.canvasWrap} ${isPanning ? styles.panning : ''}`}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleWindowMouseMove}
            onMouseUp={handleWindowMouseUp}
            onMouseLeave={handleWindowMouseUp}
          >
            <div
              className={styles.world}
              style={{ transform: `translate(${worldOffset.x}px, ${worldOffset.y}px)`, width: worldBounds.width, height: worldBounds.height }}
            >
              <svg className={styles.wires} width={worldBounds.width} height={worldBounds.height}>
                {edges.map((edge) => {
                  const fromNode = findNode(edge.from);
                  const toNode = findNode(edge.to);
                  if (!fromNode || !toNode) return null;
                  const p1 = portPos(fromNode, 'out');
                  const p2 = portPos(toNode, 'in');

                  const juegoEntity = fromNode.type === 'juego' ? getLinkedEntity(fromNode) : null;
                  const areaEntity = toNode.type === 'area' ? getLinkedEntity(toNode) : null;
                  const isBlockedLink = Boolean(
                    juegoEntity && areaEntity && isAreaBlockedBySequence(juegoEntity, areaEntity.id)
                  );

                  return (
                    <path
                      key={edge.id}
                      d={bezierPath(p1, p2)}
                      className={styles.wirePath}
                      stroke={isBlockedLink ? 'var(--color-alert)' : NODE_TYPES[fromNode.type].colorVar}
                      strokeDasharray={isBlockedLink ? '7 5' : undefined}
                      onClick={() => {
                        if (!canEditDiagram) return;
                        const nextEdges = edges.filter((e) => e.id !== edge.id);
                        setEdges(nextEdges);
                        saveToFirestore(nodes, nextEdges);
                      }}
                    >
                      <title>
                        {isBlockedLink
                          ? `🔒 Bloqueado: ${AREAS_CATALOG.find((a) => a.id === AREA_SEQUENCE_DEPENDENCIES[areaEntity.id])?.name} todavía no completa su meta. Clic para eliminar esta conexión.`
                          : 'Clic para eliminar esta conexión'}
                      </title>
                    </path>
                  );
                })}
                {previewWire && (
                  <path className={styles.wirePreview} d={bezierPath({ x: previewWire.x1, y: previewWire.y1 }, { x: previewWire.x2, y: previewWire.y2 })} />
                )}
              </svg>

              {nodes.map((node) => {
                const meta = NODE_TYPES[node.type];
                return (
                  <div
                    key={node.id}
                    className={`${styles.node} ${selectedNodeId === node.id ? styles.selected : ''}`}
                    style={{ left: node.x, top: node.y, width: NODE_WIDTH, '--node-color': meta.colorVar }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  >
                    <div className={styles.nodeHead}>
                      <span className={styles.nodeIcon}>{meta.icon}</span>
                      <span className={styles.nodeTitle}>{nodeTitle(node)}</span>
                      {node.type !== 'area' && node.type !== 'bloque' && (
                        <span className={styles.nodeBadge}>{node.draft ? '🆕 Nuevo' : '🔗 Existente'}</span>
                      )}
                      {canEditDiagram && (
                        <button
                          type="button"
                          data-role="close"
                          className={styles.nodeClose}
                          title="Quitar del lienzo"
                          onClick={() => handleCloseNode(node.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div
                      className={styles.nodeBody}
                      onMouseDown={(e) => node.type === 'bloque' && e.stopPropagation()}
                      onClick={() => node.type === 'bloque' && toggleBlockExpanded(node.id)}
                      style={node.type === 'bloque' ? { cursor: 'pointer' } : undefined}
                    >
                      <span className={styles.nodeEyebrow}>{meta.label}</span>
                      <span className={styles.nodeTag}>
                        {nodeSummary(node)}
                        {node.type === 'bloque' && (
                          <span style={{ float: 'right' }}>{expandedBlocks.has(node.id) ? '▲' : '▼'}</span>
                        )}
                      </span>
                    </div>

                    {node.type === 'bloque' && expandedBlocks.has(node.id) && (
                      <div
                        data-role="block-panel"
                        className={styles.blockDropdown}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        {(node.activityIds || []).length === 0 && (
                          <p className={styles.blockDropdownEmpty}>Aún no hay actividades en este bloque.</p>
                        )}
                        {(node.activityIds || []).map((activityId) => {
                          const act = actividades.find((a) => a.id === activityId);
                          if (!act) return null;
                          const responsable = operarios.find((o) => o.id === act.operarioId)?.name;
                          return (
                            <div key={activityId} className={styles.blockDropdownItem}>
                              <div>
                                <strong>📌 {act.title}</strong>
                                <div className={styles.blockDropdownMeta}>
                                  <span>{act.status}</span>
                                  <span>· {act.priority}</span>
                                  {responsable && <span>· 👷 {responsable}</span>}
                                </div>
                              </div>
                              {canEditDiagram && (
                                <button
                                  type="button"
                                  className={styles.blockDropdownRemove}
                                  title="Quitar del bloque"
                                  onClick={() => handleUnlinkActivity(node.id, activityId)}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {canEditDiagram && (
                          <div className={styles.blockDropdownActions}>
                            <button type="button" className={styles.blockDropdownAction} onClick={() => openBlockActivityForm(node.id)}>
                              ➕ Nueva actividad
                            </button>
                            <button type="button" className={styles.blockDropdownAction} onClick={() => openBlockLinkPicker(node.id)}>
                              🔗 Existente
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {canEditDiagram && (
                      <>
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="in"
                          className={`${styles.port} ${styles.portIn}`}
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'in')}
                        />
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="out"
                          className={`${styles.port} ${styles.portOut}`}
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'out')}
                        />
                      </>
                    )}
                  </div>
                );
              })}

              {nodes.length === 0 && (
                <div style={{ position: 'absolute', left: 40, top: 40, width: 360 }}>
                  <EmptyState
                    message="Agrega tu primer nodo desde la paleta de la izquierda para empezar."
                    shape="mancha"
                    color="var(--color-secondary)"
                  />
                </div>
              )}
            </div>
          </div>

          {/* ---------- Inspector ---------- */}
          {selectedNode && (
            <aside className={styles.inspector}>
              <NodeInspector
                node={selectedNode}
                entity={getLinkedEntity(selectedNode)}
                edges={edges}
                findNode={findNode}
                nodeTitle={nodeTitle}
                updateDraftField={(key, value) => updateDraftField(selectedNode.id, key, value)}
                onSaveProyecto={() => handleSaveProyecto(selectedNode)}
                onSaveJuego={() => handleSaveJuego(selectedNode)}
                onSaveActividad={() => handleSaveActividad(selectedNode)}
                onAssignColaborador={handleAssignColaboradorToArea}
                getConnectedAreaNode={getConnectedAreaNode}
                actividades={actividades}
                operarios={operarios}
                canEditDiagram={canEditDiagram}
                updateBlockName={(value) => updateBlockName(selectedNode.id, value)}
                onSaveBlockName={() => saveToFirestore(nodes, edges)}
              />
            </aside>
          )}
        </div>
      ) : (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <EmptyState
            title="Selecciona un Proyecto"
            description="Para comenzar a diseñar o ver la asignación de nodos, selecciona uno de los proyectos activos en el menú superior."
            icon="🗂️"
          />
        </div>
      )}

      {/* ---------- MODAL: PICKER ---------- */}
      <Modal isOpen={picker.isOpen} onClose={closePicker} title={picker.type ? `Agregar ${NODE_TYPES[picker.type].label}` : 'Agregar'}>
        <input
          type="text"
          autoFocus
          className={styles.pickerSearch}
          placeholder={picker.type && NODE_TYPES[picker.type].allowCreate ? 'Buscar existente o escribir un nombre nuevo...' : 'Buscar en el catálogo...'}
          value={picker.query}
          onChange={(e) => setPicker((prev) => ({ ...prev, query: e.target.value }))}
        />
        <div className={styles.pickerList}>
          {filteredCatalog.map((entry) => (
            <button key={entry.id} type="button" className={styles.pickerItem} onClick={() => handlePickExisting(picker.type, entry.id)}>
              {NODE_TYPES[picker.type]?.icon} <span>{entry.label}</span>
              <span className={styles.pickerBadge}>🔗 existente</span>
            </button>
          ))}
          {picker.type && NODE_TYPES[picker.type].allowCreate && picker.query.trim() && !filteredCatalog.some((c) => c.label.toLowerCase() === picker.query.trim().toLowerCase()) && (
            <button
              type="button"
              className={`${styles.pickerItem} ${styles.pickerCreate}`}
              onClick={() => handleCreateNewDraft(picker.type, picker.query.trim())}
            >
              ➕ <span>Crear &ldquo;{picker.query.trim()}&rdquo; como nuevo</span>
            </button>
          )}
          {filteredCatalog.length === 0 && !(picker.type && NODE_TYPES[picker.type].allowCreate && picker.query.trim()) && (
            <div className={styles.pickerEmpty}>
              {picker.type === 'colaborador'
                ? 'Sin coincidencias. Los colaboradores se dan de alta desde la página de Operarios.'
                : 'Sin coincidencias.'}
            </div>
          )}
        </div>
      </Modal>

      {/* ---------- MODAL: CREAR BLOQUE ---------- */}
      <Modal isOpen={blockSetup.isOpen} onClose={closeBlockSetup} title="📦 Nuevo Bloque de Actividades">
        <div className={styles.field}>
          <label>Nombre del bloque</label>
          <input
            type="text"
            autoFocus
            placeholder="Ej. Corte Láser — Semana 32"
            value={blockSetup.name}
            onChange={(e) => setBlockSetup((prev) => ({ ...prev, name: e.target.value }))}
          />
        </div>
        <div className={styles.field}>
          <label>Área</label>
          <select
            value={blockSetup.areaId}
            onChange={(e) => setBlockSetup((prev) => ({ ...prev, areaId: e.target.value }))}
          >
            <option value="">Seleccionar área...</option>
            <optgroup label="🏭 Áreas de manufactura">
              {AREAS_CATALOG.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
            <optgroup label="✏️ Otras áreas">
              {NON_PRODUCTION_AREAS.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className={styles.calloutBox} style={{ background: 'rgba(255, 51, 0, 0.06)', border: '1px solid rgba(255, 51, 0, 0.2)' }}>
          Todas las actividades que crees dentro de este bloque quedarán asignadas a esta área automáticamente.
        </div>
        <Button variant="primary" size="md" onClick={handleCreateBlock} style={{ marginTop: '10px' }}>
          Crear Bloque
        </Button>
      </Modal>

      {/* ---------- MODAL: NUEVA ACTIVIDAD DENTRO DE UN BLOQUE ---------- */}
      <Modal isOpen={blockActivityForm.isOpen} onClose={closeBlockActivityForm} title="📌 Nueva Actividad">
        <div className={styles.field}>
          <label>Título</label>
          <input
            type="text"
            autoFocus
            value={blockActivityForm.title}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, title: e.target.value }))}
          />
        </div>
        <div className={styles.field}>
          <label>Descripción</label>
          <textarea
            rows="3"
            value={blockActivityForm.description}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        </div>
        <div className={styles.field}>
          <label>Prioridad</label>
          <select
            value={blockActivityForm.priority}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, priority: e.target.value }))}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label>Fecha Límite</label>
          <input
            type="date"
            value={blockActivityForm.dueDate}
            onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, dueDate: e.target.value }))}
          />
        </div>
        {(() => {
          const blockNode = findNode(blockActivityForm.blockNodeId);
          if (!blockNode) return null;
          if (!isProductionArea(blockNode.areaId)) {
            return (
              <div className={styles.calloutBox} style={{ background: 'rgba(153, 51, 255, 0.08)', border: '1px solid rgba(153, 51, 255, 0.25)' }}>
                ℹ️ El área &ldquo;{ALL_BLOCK_AREAS.find((a) => a.id === blockNode.areaId)?.name}&rdquo; todavía no tiene
                colaboradores dados de alta en el sistema — la actividad se creará sin responsable asignado.
              </div>
            );
          }
          const areaOperarios = operarios.filter((o) => o.currentArea === blockNode.areaId);
          return (
            <div className={styles.field}>
              <label>Responsable (opcional)</label>
              <select
                value={blockActivityForm.operarioId}
                onChange={(e) => setBlockActivityForm((prev) => ({ ...prev, operarioId: e.target.value }))}
              >
                <option value="">Sin asignar</option>
                {areaOperarios.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          );
        })()}
        <Button variant="primary" size="md" onClick={handleCreateBlockActivity} style={{ marginTop: '10px' }}>
          💾 Crear y agregar al bloque
        </Button>
      </Modal>

      {/* ---------- MODAL: ENLAZAR ACTIVIDAD EXISTENTE A UN BLOQUE ---------- */}
      <Modal isOpen={blockLinkPicker.isOpen} onClose={closeBlockLinkPicker} title="🔗 Enlazar Actividad Existente">
        <input
          type="text"
          autoFocus
          className={styles.pickerSearch}
          placeholder="Buscar actividad existente..."
          value={blockLinkPicker.query}
          onChange={(e) => setBlockLinkPicker((prev) => ({ ...prev, query: e.target.value }))}
        />
        <div className={styles.pickerList}>
          {blockLinkCandidates.map((a) => (
            <button key={a.id} type="button" className={styles.pickerItem} onClick={() => handleLinkExistingActivity(a.id)}>
              📌 <span>{a.title}</span>
              <span className={styles.pickerBadge}>{AREAS_CATALOG.find((ar) => ar.id === a.areaId)?.name || a.areaId}</span>
            </button>
          ))}
          {blockLinkCandidates.length === 0 && (
            <div className={styles.pickerEmpty}>Sin coincidencias.</div>
          )}
        </div>
      </Modal>

      {/* ---------- MODAL: CONFIRMAR BORRADO DE BLOQUE CON ACTIVIDADES ---------- */}
      <Modal isOpen={deleteBlockConfirm.isOpen} onClose={closeDeleteBlockConfirm} title="🗑️ Eliminar Bloque">
        {(() => {
          const node = findNode(deleteBlockConfirm.nodeId);
          if (!node) return null;
          const count = (node.activityIds || []).length;
          return (
            <div style={{ padding: 'var(--space-2) 0' }}>
              <p style={{ marginBottom: 'var(--space-4)' }}>
                El bloque <strong>{node.blockName}</strong> tiene <strong>{count}</strong> actividad{count === 1 ? '' : 'es'} real
                {count === 1 ? '' : 'es'} en el sistema.
              </p>
              <p style={{ fontSize: '12.5px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
                Para eliminar el bloque, esas actividades también se eliminarán del sistema (no solo se desvincularán).
                Si prefieres conservarlas, cancela y quítalas del bloque una por una con &ldquo;✕&rdquo; antes de borrarlo.
                Una actividad que ya tenga avance (no esté &ldquo;pendiente&rdquo;) impedirá el borrado por completo.
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <Button variant="secondary" size="md" onClick={closeDeleteBlockConfirm}>Cancelar</Button>
                <Button variant="danger" size="md" onClick={handleConfirmDeleteBlockWithActivities}>Eliminar bloque y actividades</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ---------- MODAL: CÓMO FUNCIONA ---------- */}
      <Modal isOpen={howtoOpen} onClose={() => setHowtoOpen(false)} title="¿Cómo funciona el Editor Visual?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13.5px', lineHeight: 1.6, color: 'var(--color-gray-700)' }}>
          <p>
            Cada tarjeta (nodo) representa un Proyecto, Juego, Actividad, Área o Colaborador real de Dicrejart.
            Puedes vincular uno ya existente o crear uno nuevo desde la paleta de la izquierda.
          </p>
          <p>
            <strong>El lienzo se auto-guarda en tiempo real en la nube.</strong> Un nodo nuevo (🆕) se crea en el sistema
            hasta que presionas &ldquo;Guardar en el Sistema&rdquo; en su panel derecho — ahí se valida que tenga las
            conexiones necesarias (por ejemplo, un Juego nuevo necesita estar conectado a un Proyecto y a al menos
            un Área antes de poder guardarse).
          </p>
          <p>
            Área es un catálogo cerrado de las 8 áreas de manufactura; nunca se crea una nueva desde aquí.
            Colaborador siempre se vincula a un Operario ya existente — para dar de alta gente nueva, usa la
            página de Operarios — pero sí puedes reasignarlo de área desde el panel derecho.
          </p>
          <p>
            El botón &ldquo;🗔 Abrir en Ventana Aparte&rdquo; abre este mismo editor en una ventana independiente, sin la barra lateral.
            Como ahora está conectado a Firebase, **cualquier cambio que realices en cualquiera de las dos ventanas se reflejará instantáneamente en la otra en tiempo real**.
          </p>
          <p>
            <strong>📦 Bloque de Actividades</strong> es distinto a los demás nodos: no se conecta con cables. Al crearlo eliges
            un nombre y un área (de manufactura, o &ldquo;Diseño&rdquo;) — esa área se asigna automáticamente a cada actividad
            que agregues dentro. Haz clic en el bloque para abrir su panel derecho, donde puedes crear actividades nuevas
            (se registran de una vez en el sistema, igual que desde la página de Actividades) o enlazar unas que ya existían.
            Quitar una actividad del bloque no la borra del sistema, solo la desvincula de este lienzo.
          </p>
        </div>
      </Modal>
    </motion.div>
  );
};

/**
 * Panel de inspección del nodo seleccionado: muestra datos reales (si ya existe) o
 * un formulario editable de borrador (si aún no se ha guardado en el sistema)
 */
const NodeInspector = ({
  node,
  entity,
  edges,
  findNode,
  nodeTitle,
  updateDraftField,
  onSaveProyecto,
  onSaveJuego,
  onSaveActividad,
  onAssignColaborador,
  getConnectedAreaNode,
  actividades,
  operarios,
  canEditDiagram,
  updateBlockName,
  onSaveBlockName,
}) => {
  const meta = NODE_TYPES[node.type];

  const incoming = edges.filter((e) => e.to === node.id);
  const outgoing = edges.filter((e) => e.from === node.id);

  return (
    <>
      <p className={styles.inspectorEyebrow}>{meta.label}</p>
      <h2 className={styles.inspectorTitle}>{nodeTitle(node)}</h2>

      {node.draft && node.type === 'proyecto' && (
        <>
          <div className={styles.field}>
            <label>Nombre</label>
            <input type="text" value={node.draftFields.name} disabled={!canEditDiagram} onChange={(e) => updateDraftField('name', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Cliente</label>
            <input type="text" value={node.draftFields.client} disabled={!canEditDiagram} onChange={(e) => updateDraftField('client', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Estado</label>
            <select value={node.draftFields.status} disabled={!canEditDiagram} onChange={(e) => updateDraftField('status', e.target.value)}>
              {PROJECT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {canEditDiagram && <Button variant="primary" size="md" onClick={onSaveProyecto}>💾 Guardar en el Sistema</Button>}
        </>
      )}

      {node.draft && node.type === 'juego' && (
        <>
          <div className={styles.field}>
            <label>Nombre</label>
            <input type="text" value={node.draftFields.name} disabled={!canEditDiagram} onChange={(e) => updateDraftField('name', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Meta de Piezas por Área</label>
            <input type="number" min="1" value={node.draftFields.meta_piezas} disabled={!canEditDiagram} onChange={(e) => updateDraftField('meta_piezas', e.target.value)} />
          </div>
          <div className={styles.calloutBox} style={{ background: 'rgba(0, 153, 204, 0.08)', border: '1px solid rgba(0, 153, 204, 0.25)' }}>
            Conecta este Juego a un <strong>Proyecto</strong> y a al menos un <strong>Área</strong> antes de guardar.
          </div>
          {canEditDiagram && <Button variant="primary" size="md" onClick={onSaveJuego} style={{ marginTop: '10px' }}>💾 Guardar en el Sistema</Button>}
        </>
      )}

      {node.draft && node.type === 'actividad' && (
        <>
          <div className={styles.field}>
            <label>Título</label>
            <input type="text" value={node.draftFields.title} disabled={!canEditDiagram} onChange={(e) => updateDraftField('title', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Descripción</label>
            <textarea rows="3" value={node.draftFields.description} disabled={!canEditDiagram} onChange={(e) => updateDraftField('description', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Prioridad</label>
            <select value={node.draftFields.priority} disabled={!canEditDiagram} onChange={(e) => updateDraftField('priority', e.target.value)}>
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Fecha Límite</label>
            <input type="date" value={node.draftFields.dueDate} disabled={!canEditDiagram} onChange={(e) => updateDraftField('dueDate', e.target.value)} />
          </div>
          <div className={styles.calloutBox} style={{ background: 'rgba(255, 204, 0, 0.12)', border: '1px solid rgba(255, 204, 0, 0.35)' }}>
            Conecta esta Actividad a un <strong>Área</strong> antes de guardar (el Colaborador responsable es opcional).
          </div>
          {canEditDiagram && <Button variant="primary" size="md" onClick={onSaveActividad} style={{ marginTop: '10px' }}>💾 Guardar en el Sistema</Button>}
        </>
      )}

      {!node.draft && entity && node.type === 'proyecto' && (
        <>
          <div className={styles.field}><label>Nombre</label><input type="text" value={entity.name} disabled /></div>
          <div className={styles.field}><label>Cliente</label><input type="text" value={entity.client || ''} disabled /></div>
          <div className={styles.field}><label>Estado</label><input type="text" value={entity.status} disabled /></div>
          <div className={styles.field}><label>Progreso</label><input type="text" value={`${entity.progress ?? 0}%`} disabled /></div>
        </>
      )}

      {!node.draft && entity && node.type === 'juego' && (
        <>
          <div className={styles.field}><label>Nombre</label><input type="text" value={entity.name} disabled /></div>
          <div className={styles.field}><label>Proyecto</label><input type="text" value={entity.projectName} disabled /></div>
          <div className={styles.field}><label>Estado</label><input type="text" value={entity.status} disabled /></div>
          <div className={styles.field}><label>Progreso</label><input type="text" value={`${entity.progress ?? 0}%`} disabled /></div>
          {(entity.areas || [])
            .filter((areaId) => isAreaBlockedBySequence(entity, areaId))
            .map((areaId) => {
              const requiredAreaId = AREA_SEQUENCE_DEPENDENCIES[areaId];
              const requiredAreaName = AREAS_CATALOG.find((a) => a.id === requiredAreaId)?.name;
              const blockedAreaName = AREAS_CATALOG.find((a) => a.id === areaId)?.name;
              const produced = entity.producedPieces?.[requiredAreaId] || 0;
              const target = entity.targetPieces?.[requiredAreaId] || 0;
              return (
                <div key={areaId} className={styles.calloutBox} style={{ background: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.3)' }}>
                  🔒 <strong>{blockedAreaName}</strong> bloqueada: espera a que <strong>{requiredAreaName}</strong>{' '}
                  complete su meta ({produced}/{target} pzas).
                </div>
              );
            })}

          <p className={styles.inspectorEyebrow} style={{ marginTop: '16px' }}>Manufactura por Área</p>
          <div className={styles.areaStatusList}>
            {[...(entity.areas || []), 'producto-terminado'].map((areaId) => {
              const areaName = areaId === 'producto-terminado'
                ? 'Producto Terminado'
                : AREAS_CATALOG.find((a) => a.id === areaId)?.name || areaId;
              const produced = entity.producedPieces?.[areaId] || 0;
              const target = entity.targetPieces?.[areaId] || 0;
              const areaStat = entity.areaStatus?.[areaId] || 'pendiente';
              const delivery = entity.areaDeliveryStatus?.[areaId] || 'pendiente';
              const quality = entity.qualityReview?.[areaId]?.status;
              return (
                <div key={areaId} className={styles.areaStatusRow}>
                  <strong>{areaName}</strong>
                  <div className={styles.areaStatusMeta}>
                    <span>{produced}/{target} pzas</span>
                    <span>· {areaStat}</span>
                    {areaId !== 'producto-terminado' && (
                      <span style={{ color: quality === 'aprobado' ? 'var(--color-tiffany-blue)' : quality === 'rechazado' ? 'var(--color-alert)' : 'var(--color-gray-500)' }}>
                        · Calidad: {quality === 'aprobado' ? '✅ Aprobado' : quality === 'rechazado' ? '❌ Rechazado' : '⏳ Pendiente'}
                      </span>
                    )}
                    {delivery !== 'pendiente' && <span>· Entrega PT: {delivery.replace('_', ' ')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!node.draft && entity && node.type === 'actividad' && (
        <>
          <div className={styles.field}><label>Título</label><input type="text" value={entity.title} disabled /></div>
          <div className={styles.field}><label>Área</label><input type="text" value={AREAS_CATALOG.find((a) => a.id === entity.areaId)?.name || entity.areaId} disabled /></div>
          <div className={styles.field}><label>Estado</label><input type="text" value={entity.status} disabled /></div>
          <div className={styles.field}><label>Prioridad</label><input type="text" value={entity.priority} disabled /></div>
          <div className={styles.field}>
            <label>Responsable</label>
            <input type="text" value={operarios.find((o) => o.id === entity.operarioId)?.name || 'Sin asignar'} disabled />
          </div>
        </>
      )}

      {!node.draft && entity && node.type === 'area' && (
        <div className={styles.field}><label>Nombre del Área</label><input type="text" value={entity.name} disabled /></div>
      )}

      {!node.draft && entity && node.type === 'colaborador' && (
        <>
          <div className={styles.field}><label>Nombre</label><input type="text" value={entity.name} disabled /></div>
          <div className={styles.field}><label>Área Actual</label><input type="text" value={AREAS_CATALOG.find((a) => a.id === entity.currentArea)?.name || entity.currentArea} disabled /></div>
          {(() => {
            const areaNode = getConnectedAreaNode(node.id);
            if (!areaNode) return null;
            const alreadyThere = areaNode.refId === entity.currentArea;
            return alreadyThere ? (
              <div className={styles.calloutBox} style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                ✅ Ya está asignado a esta área conectada.
              </div>
            ) : (
              canEditDiagram && (
                <Button variant="primary" size="md" onClick={() => onAssignColaborador(entity, areaNode)}>
                  🔁 Asignar a {AREAS_CATALOG.find((a) => a.id === areaNode.refId)?.name}
                </Button>
              )
            );
          })()}

          <p className={styles.inspectorEyebrow} style={{ marginTop: '16px' }}>Responsable De</p>
          {(() => {
            const asignadas = actividades.filter((a) => a.operarioId === entity.id);
            if (asignadas.length === 0) {
              return <span className={styles.emptyConns}>Sin actividades asignadas todavía.</span>;
            }
            return (
              <div className={styles.areaStatusList}>
                {asignadas.map((a) => (
                  <div key={a.id} className={styles.areaStatusRow}>
                    <strong>📌 {a.title}</strong>
                    <div className={styles.areaStatusMeta}>
                      <span>{AREAS_CATALOG.find((ar) => ar.id === a.areaId)?.name || a.areaId}</span>
                      <span>· {a.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {node.type === 'bloque' && (
        <>
          <div className={styles.field}>
            <label>Nombre del bloque</label>
            <input
              type="text"
              value={node.blockName}
              disabled={!canEditDiagram}
              onChange={(e) => updateBlockName(e.target.value)}
              onBlur={onSaveBlockName}
            />
          </div>
          <div className={styles.field}>
            <label>Área</label>
            <input type="text" value={ALL_BLOCK_AREAS.find((a) => a.id === node.areaId)?.name || node.areaId} disabled />
          </div>
          <div className={styles.calloutBox} style={{ background: 'rgba(255, 51, 0, 0.06)', border: '1px solid rgba(255, 51, 0, 0.2)' }}>
            Haz clic en el cuerpo del bloque (en el lienzo) para desplegar o cerrar su lista de actividades.
          </div>
        </>
      )}

      {!node.draft && !entity && node.type !== 'bloque' && (
        <p style={{ fontSize: '12.5px', color: 'var(--color-alert)' }}>Este registro ya no existe.</p>
      )}

      <div className={styles.calloutBox} style={{ marginTop: '18px', background: 'rgba(255, 51, 0, 0.06)', border: '1px solid rgba(255, 51, 0, 0.2)' }}>
        <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--color-primary)' }}>Conexiones</strong>
        {incoming.length === 0 && outgoing.length === 0 && <span className={styles.emptyConns}>Sin conexiones todavía.</span>}
        {incoming.map((e) => {
          const other = findNode(e.from);
          return other ? (
            <div key={e.id} className={styles.connRow}><span className={styles.connArrow}>←</span><span>{NODE_TYPES[other.type].icon} {nodeTitle(other)}</span></div>
          ) : null;
        })}
        {outgoing.map((e) => {
          const other = findNode(e.to);
          return other ? (
            <div key={e.id} className={styles.connRow}><span className={styles.connArrow}>→</span><span>{NODE_TYPES[other.type].icon} {nodeTitle(other)}</span></div>
          ) : null;
        })}
      </div>
    </>
  );
};

EditorVisualPage.propTypes = {
  standalone: PropTypes.bool,
};

export default EditorVisualPage;
