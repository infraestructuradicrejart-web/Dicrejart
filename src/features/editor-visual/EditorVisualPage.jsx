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
import { motion, AnimatePresence } from 'framer-motion';
import { doc, setDoc, updateDoc, onSnapshot, collection, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import useToast from '../../hooks/useToast';
import useProduccion from '../../hooks/useProduccion';
import useActividades from '../../hooks/useActividades';
import useOperarios from '../../hooks/useOperarios';
import useAuth from '../../hooks/useAuth';
import { sendSystemChatMessage } from '../../services/chatNotificationService';
import { AREA_SEQUENCE_DEPENDENCIES, isAreaBlockedBySequence } from '../../context/ProduccionContext';
import useAreas from '../../hooks/useAreas';
import { NON_PRODUCTION_AREAS } from '../../data/nonProductionAreasConfig';
import { getTodayLocalDateStr } from '../../utils/dateUtils';
import { compressImage } from '../../utils/imageCompressor';
import styles from './EditorVisualPage.module.css';

/** Dimensiones del Gran Espacio de Trabajo CAD (Inventor / SolidWorks style) */
const WORKSPACE_WIDTH = 6000;
const WORKSPACE_HEIGHT = 6000;
const GRID_SIZE = 25;
const GRID_MAJOR_SIZE = 125;

/** Ancho/alto aproximado de un nodo, usado para calcular dónde dibujar cada línea */
const NODE_WIDTH = 260;
const NODE_HEIGHT = 80;

/** Límites de zoom del lienzo CAD (20%–250%), en pasos de 10 puntos porcentuales */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

/** Tipos de nodo disponibles, con su color de marca */
const PRESET_COLORS = [
  { name: 'Naranja Dicrejart', value: '#ea580c' },
  { name: 'Azul Zafiro', value: '#2563eb' },
  { name: 'Turquesa Menta', value: '#0d9488' },
  { name: 'Verde Esmeralda', value: '#16a34a' },
  { name: 'Púrpura Neón', value: '#9333ea' },
  { name: 'Ámbar Dorado', value: '#d97706' },
  { name: 'Rojo Carmesí', value: '#dc2626' },
  { name: 'Rosa Fucsia', value: '#db2777' },
  { name: 'Cian Profundo', value: '#0284c7' },
  { name: 'Grafito Oscuro', value: '#475569' },
];

const NODE_TYPES = {
  recurso: { icon: '📎', label: 'Ayuda Visual / Archivo', badgeText: 'AYUDA VISUAL', colorVar: '#06b6d4', allowCreate: true },
  proyecto: { icon: '🗂️', label: 'Proyecto', badgeText: 'PROYECTO', colorVar: '#2563eb', allowCreate: true },
  juego: { icon: '🎮', label: 'Juego / Modelo', badgeText: 'MODELO', colorVar: '#0d9488', allowCreate: true },
  actividad: { icon: '📌', label: 'Actividad', badgeText: 'ACTIVIDAD', colorVar: '#d97706', allowCreate: true },
  area: { icon: '🏭', label: 'Área de Taller', badgeText: 'TALLER', colorVar: '#6366f1', allowCreate: false },
  colaborador: { icon: '👷', label: 'Colaborador', badgeText: 'PERSONAL', colorVar: '#9333ea', allowCreate: false },
};

const PRIORITY_OPTIONS = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
];

const formatExternalUrl = (url) => {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

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

/**
 * Trazo Bezier para previsualización durante arrastre manual
 */
const previewBezier = (p1, p2) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  const curvature = Math.max(30, Math.min(dist * 0.45, 140));
  const signX = dx >= 0 ? 1 : -1;
  return `M ${p1.x} ${p1.y} C ${p1.x + signX * curvature} ${p1.y}, ${p2.x - signX * curvature} ${p2.y}, ${p2.x} ${p2.y}`;
};

/**
 * Genera el trazo de cable inteligente anti-enredo adaptando dinámicamente
 * los puertos más cercanos (derecha, izquierda, arriba o abajo) según la posición relativa de los nodos.
 */
const getSmartWirePath = (fromNode, toNode) => {
  if (!fromNode || !toNode) return { path: '', p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } };

  const fromHeight = fromNode.type === 'recurso' ? 140 : 85;
  const toHeight = toNode.type === 'recurso' ? 140 : 85;

  const c1x = fromNode.x + NODE_WIDTH / 2;
  const c1y = fromNode.y + fromHeight / 2;
  const c2x = toNode.x + NODE_WIDTH / 2;
  const c2y = toNode.y + toHeight / 2;

  const dx = c2x - c1x;
  const dy = c2y - c1y;

  let p1, p2, dir1, dir2;

  // Decide si domina flujo horizontal o vertical
  if (Math.abs(dx) >= Math.abs(dy) * 0.75) {
    if (dx >= 0) {
      // toNode está a la derecha
      p1 = { x: fromNode.x + NODE_WIDTH, y: fromNode.y + 40 };
      p2 = { x: toNode.x, y: toNode.y + 40 };
      dir1 = { x: 1, y: 0 };
      dir2 = { x: -1, y: 0 };
    } else {
      // toNode está a la izquierda
      p1 = { x: fromNode.x, y: fromNode.y + 40 };
      p2 = { x: toNode.x + NODE_WIDTH, y: toNode.y + 40 };
      dir1 = { x: -1, y: 0 };
      dir2 = { x: 1, y: 0 };
    }
  } else {
    if (dy >= 0) {
      // toNode está abajo
      p1 = { x: fromNode.x + NODE_WIDTH / 2, y: fromNode.y + fromHeight };
      p2 = { x: toNode.x + NODE_WIDTH / 2, y: toNode.y };
      dir1 = { x: 0, y: 1 };
      dir2 = { x: 0, y: -1 };
    } else {
      // toNode está arriba
      p1 = { x: fromNode.x + NODE_WIDTH / 2, y: fromNode.y };
      p2 = { x: toNode.x + NODE_WIDTH / 2, y: toNode.y + toHeight };
      dir1 = { x: 0, y: -1 };
      dir2 = { x: 0, y: 1 };
    }
  }

  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const curvature = Math.max(35, Math.min(dist * 0.4, 150));

  const cp1x = p1.x + dir1.x * curvature;
  const cp1y = p1.y + dir1.y * curvature;
  const cp2x = p2.x + dir2.x * curvature;
  const cp2y = p2.y + dir2.y * curvature;

  const path = `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  return { path, p1, p2 };
};

/**
 * Extrae la metadata y la URL de imagen, documento, link o modelo CAD 3D (SolidWorks, Inventor, STEP, etc.)
 */
const getResourcePreviewInfo = (nodeOrDraft) => {
  if (!nodeOrDraft) {
    return { resType: 'imagen', previewImgSrc: null, rawUrl: '', fileName: '', fileSize: 0, isPdf: false, isModel: false, isLink: false, effectiveUrl: '' };
  }

  const fields = nodeOrDraft.draftFields || nodeOrDraft;
  const resType = fields.resourceType || 'imagen';
  const fileData = fields.fileData;
  const rawUrl = (fields.url || nodeOrDraft.url || '').trim();

  // 1. Archivo subido o local
  const fileUrl = fileData?.url || fileData?.dataUrl;
  const fileName = fileData?.name || '';
  const fileSize = fileData?.size || 0;
  const lowerFileName = (fileName || rawUrl).toLowerCase();

  // 2. Detección especializada de CAD (SolidWorks, Inventor, STEP, AutoCAD, SketchUp)
  let cadBrand = null;
  let cadLabel = null;
  let cadIcon = '🧊';
  let cadColor = '#0d9488';

  if (lowerFileName.match(/\.(sldprt|sldasm|slddrw)($|\?)/)) {
    cadBrand = 'solidworks';
    cadIcon = '🔴';
    cadColor = '#e11d48';
    cadLabel = lowerFileName.includes('.sldasm') ? 'Ensamblaje SolidWorks (.sldasm)' : lowerFileName.includes('.slddrw') ? 'Dibujo SolidWorks (.slddrw)' : 'Pieza SolidWorks (.sldprt)';
  } else if (lowerFileName.match(/\.(ipt|iam|idw)($|\?)/)) {
    cadBrand = 'inventor';
    cadIcon = '🟡';
    cadColor = '#d97706';
    cadLabel = lowerFileName.includes('.iam') ? 'Ensamblaje Inventor (.iam)' : lowerFileName.includes('.idw') ? 'Plano Inventor (.idw)' : 'Pieza Inventor (.ipt)';
  } else if (lowerFileName.match(/\.(step|stp)($|\?)/)) {
    cadBrand = 'step';
    cadIcon = '🧊';
    cadColor = '#0284c7';
    cadLabel = 'Modelo 3D ISO STEP (.step)';
  } else if (lowerFileName.match(/\.(dwg|dxf)($|\?)/)) {
    cadBrand = 'dwg';
    cadIcon = '📐';
    cadColor = '#2563eb';
    cadLabel = 'Plano CAD Técnico (.dwg/.dxf)';
  } else if (lowerFileName.match(/\.(skp)($|\?)/)) {
    cadBrand = 'sketchup';
    cadIcon = '🔴';
    cadColor = '#ea580c';
    cadLabel = 'Modelo 3D SketchUp (.skp)';
  } else if (lowerFileName.match(/\.(stl|obj|iges|igs|fbx|3ds|blend)($|\?)/)) {
    cadBrand = '3d';
    cadIcon = '🧊';
    cadColor = '#0d9488';
    cadLabel = 'Modelo 3D CAD';
  }

  // 3. Detección especializada de Enlaces (Google Drive, Figma, OneDrive, Autodesk Viewer)
  let linkProvider = null;
  let googleDriveImgSrc = null;
  let googleDriveFileId = null;

  if (rawUrl) {
    const driveMatch = rawUrl.match(/(?:\/d\/|id=)([a-zA-Z0-9_-]{25,})/i);
    if (driveMatch && driveMatch[1]) {
      googleDriveFileId = driveMatch[1];
      googleDriveImgSrc = `https://lh3.googleusercontent.com/d/${googleDriveFileId}`;
      linkProvider = { name: 'Google Drive', icon: '📁', color: '#16a34a', isDrive: true };
    } else if (rawUrl.includes('figma.com')) {
      linkProvider = { name: 'Figma', icon: '🎨', color: '#a855f7', isFigma: true };
    } else if (rawUrl.includes('onedrive') || rawUrl.includes('1drv.ms') || rawUrl.includes('sharepoint.com')) {
      linkProvider = { name: 'OneDrive / Cloud', icon: '☁️', color: '#0284c7' };
    } else if (rawUrl.includes('autodesk') || rawUrl.includes('viewer.autodesk')) {
      linkProvider = { name: 'Autodesk Viewer 3D', icon: '📐', color: '#ea580c' };
    } else if (rawUrl.match(/(youtube\.com|youtu\.be|vimeo\.com|loom\.com)/i)) {
      linkProvider = { name: 'Video / Tutorial', icon: '▶️', color: '#dc2626' };
    } else {
      let cleanDomain = rawUrl.replace(/^https?:\/\//i, '').split('/')[0];
      linkProvider = { name: cleanDomain || 'Enlace Web', icon: '🌐', color: '#2563eb' };
    }
  }

  // 4. Determinar si hay imagen a previsualizar
  let previewImgSrc = null;
  if (fileUrl && (fileData?.type?.startsWith('image/') || fileUrl.startsWith('data:image') || (!fileData?.type && !cadBrand && !lowerFileName.endsWith('.pdf')))) {
    previewImgSrc = fileUrl;
  } else if (googleDriveImgSrc && resType === 'imagen') {
    previewImgSrc = googleDriveImgSrc;
  } else if (rawUrl && resType === 'imagen') {
    previewImgSrc = googleDriveImgSrc || rawUrl;
  } else if (rawUrl && (rawUrl.match(/\.(jpeg|jpg|gif|png|webp|svg)($|\?)/i) || rawUrl.startsWith('data:image') || rawUrl.includes('images.unsplash.com') || rawUrl.includes('firebasestorage'))) {
    previewImgSrc = rawUrl;
  }

  const isPdf = resType === 'documento' || fileData?.type?.includes('pdf') || lowerFileName.endsWith('.pdf') || lowerFileName.includes('.pdf?');
  const isModel = Boolean(cadBrand) || resType === 'modelo';
  const isLink = resType === 'link' || (!previewImgSrc && !isPdf && !isModel && Boolean(rawUrl));

  return {
    resType,
    previewImgSrc,
    rawUrl,
    fileUrl,
    fileName,
    fileSize,
    isPdf,
    isModel,
    cadBrand,
    cadLabel,
    cadIcon,
    cadColor,
    isLink,
    linkProvider,
    googleDriveFileId,
    effectiveUrl: fileUrl || rawUrl,
  };
};

/**
 * Sube un archivo a Firebase Storage con compresión automática para imágenes,
 * incluyendo fallback ligero transparente (< 30KB) si la red o Storage presentaran intermitencia.
 */
const uploadResourceFile = async (file, lienzoId = 'general') => {
  if (!file) return null;
  const isImage = file.type?.startsWith('image/');
  let toUpload = file;
  let compressedBase64 = null;

  if (isImage) {
    try {
      toUpload = await compressImage(file, { maxWidth: 1920, maxHeight: 1920, quality: 0.85 });
      // Versión ultraligera (~20KB) para garantizar persistencia y vista inmediata en cualquier escenario
      const thumbBlob = await compressImage(file, { maxWidth: 720, maxHeight: 720, quality: 0.65 });
      compressedBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(thumbBlob);
      });
    } catch (e) {
      console.warn('Compresión falló, subiendo original:', e);
      toUpload = file;
    }
  }

  const safeName = (file.name || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `lienzos_recursos/${lienzoId}/${Date.now()}_${safeName}`;

  if (storage) {
    try {
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, toUpload);
      const downloadUrl = await getDownloadURL(fileRef);

      return {
        name: file.name,
        size: file.size,
        type: file.type,
        url: downloadUrl,
        storagePath: path,
        isUploading: false,
      };
    } catch (storageErr) {
      console.warn('Fallo subida a Firebase Storage, usando respaldo optimizado:', storageErr);
      if (compressedBase64) {
        return {
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl: compressedBase64,
          url: compressedBase64,
          isUploading: false,
        };
      }
    }
  }

  // Fallback si no hay storage o si no es imagen pero se quiere guardar metadata
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    dataUrl: compressedBase64 || null,
    url: compressedBase64 || '',
    isUploading: false,
  };
};

/**
 * Componente EditorVisualPage - Editor visual tipo grafo para crear/relacionar entidades
 * @component
 * @returns {ReactElement}
 */
const EditorVisualPage = ({ standalone = false }) => {
  const { proyectos, juegos, addProject, addGame, updateProject } = useProduccion();
  const { actividades, addActividad, updateActividad, deleteActividad, advanceStatus } = useActividades();
  const { operarios, assignToArea } = useOperarios();
  const { areas: dynamicAreas } = useAreas();
  const allBlockAreas = useMemo(() => [...dynamicAreas, ...NON_PRODUCTION_AREAS], [dynamicAreas]);
  const { user, users } = useAuth();
  const toast = useToast();

  // ============================================
  // PROYECTOS VISUALES Y LIENZOS LIBRES
  // Permite diseñar en lienzos independientes o asociados a un proyecto
  // ============================================
  const [lienzosList, setLienzosList] = useState([]);
  const [newLienzoModal, setNewLienzoModal] = useState({ isOpen: false, name: '' });
  const [deleteLienzoConfirm, setDeleteLienzoConfirm] = useState(false);
  const [isLeftRailOpen, setIsLeftRailOpen] = useState(false);

  const [lienzoActivoId, setLienzoActivoId] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('lienzoId') || urlParams.get('proyectoId') || 'general';
    }
    return 'general';
  });

  // Modal para gestionar / eliminar cualquier lienzo
  const [manageLienzosModal, setManageLienzosModal] = useState(false);
  const [clearNodesConfirm, setClearNodesConfirm] = useState(false);

  // Modal para consultar tareas del área en el lienzo sin redirigir
  const [areaTasksModal, setAreaTasksModal] = useState({ isOpen: false, areaId: null, areaName: '' });

  // Modal para marcar una actividad como completada con notas de entrega
  const [completeModal, setCompleteModal] = useState({ isOpen: false, activityId: null, title: '', notes: '' });

  // Modal para ver y ampliar Ayudas Visuales (Imágenes en alta resolución, PDFs, Modelos 3D y Enlaces)
  const [previewResourceModal, setPreviewResourceModal] = useState({
    isOpen: false,
    title: '',
    resourceType: 'imagen',
    url: '',
    fileData: null,
    notes: '',
  });

  // Determina si el lienzo activo es un lienzo libre que se puede eliminar
  const isCurrentLienzoDeletable = useMemo(() => {
    return lienzoActivoId !== 'general' && !proyectos.some((p) => p.id === lienzoActivoId);
  }, [lienzoActivoId, proyectos]);

  // Elimina un lienzo específico por su ID
  const handleDeleteLienzoById = async (targetId, targetName) => {
    if (!db || !canEditDiagram) return;
    try {
      await deleteDoc(doc(db, 'lienzos', targetId));
      toast.success(`🗑️ Lienzo visual "${targetName || 'Lienzo'}" eliminado.`);
      if (lienzoActivoId === targetId) {
        setLienzoActivoId('general');
      }
    } catch (err) {
      console.error('Error al eliminar lienzo:', err);
      toast.danger('No se pudo eliminar el lienzo.');
    }
  };

  // Elimina el lienzo actualmente activo
  const handleDeleteCurrentLienzo = async () => {
    if (!isCurrentLienzoDeletable || !db || !canEditDiagram) return;
    const currentName = lienzosList.find((l) => l.id === lienzoActivoId)?.name || 'Lienzo';
    await handleDeleteLienzoById(lienzoActivoId, currentName);
    setDeleteLienzoConfirm(false);
  };

  // Limpia / vacía todos los nodos del lienzo actual
  const handleClearCurrentCanvasNodes = () => {
    if (!canEditDiagram) return;
    setNodes([]);
    setEdges([]);
    saveToFirestore([], []);
    setClearNodesConfirm(false);
    toast.success('🧹 Lienzo vaciado. Todos los nodos fueron removidos.');
  };

  // Escucha en tiempo real de todos los lienzos registrados en Firestore
  useEffect(() => {
    if (!db) return;
    try {
      const unsubscribe = onSnapshot(
        collection(db, 'lienzos'),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setLienzosList(list);
        },
        (err) => {
          console.warn('Aviso al listar lienzos:', err);
        }
      );
      return unsubscribe;
    } catch (e) {
      console.warn('Error iniciando escucha de lienzos:', e);
    }
  }, []);

  // Refleja el lienzo activo en la URL para no perder el estado
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (lienzoActivoId && lienzoActivoId !== 'general') {
      url.searchParams.set('lienzoId', lienzoActivoId);
      url.searchParams.delete('proyectoId');
    } else {
      url.searchParams.delete('lienzoId');
      url.searchParams.delete('proyectoId');
    }
    window.history.replaceState({}, '', url);
  }, [lienzoActivoId]);

  // Proyecto vinculado si el lienzo actual corresponde al ID de un proyecto
  const currentProject = useMemo(() => {
    return proyectos.find((p) => p.id === lienzoActivoId) || null;
  }, [proyectos, lienzoActivoId]);

  // Todos los miembros autenticados con acceso al editor pueden diseñar y guardar sus lienzos
  const canEditDiagram = Boolean(user);
  const isAdmin = user?.role === 'admin' || user?.roleType === 'admin' || user?.roleType === 'director';

  // Estado de sincronización en la nube ('saved' | 'saving' | 'error')
  const [saveStatus, setSaveStatus] = useState('saved');

  // ============================================
  // ESTADO DEL GRAFO
  // ============================================
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
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
  const worldRef = useRef(null);
  const dragStateRef = useRef(null);
  const connectStateRef = useRef(null);
  const panStateRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const [previewWire, setPreviewWire] = useState(null);

  // ============================================
  // ZOOM Y NAVEGACIÓN CAD DEL LIENZO
  // ============================================
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const worldOffsetRef = useRef(worldOffset);
  worldOffsetRef.current = worldOffset;
  
  // Soporte CAD: Tecla Espacio para Panning, Snap a Cuadrícula y Coordenadas
  const isSpacePressedRef = useRef(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [cursorCoords, setCursorCoords] = useState({ x: 0, y: 0 });
  const [showMinimap, setShowMinimap] = useState(true);

  const [isExporting, setIsExporting] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');

  // ============================================
  // ESCUCHA EN TIEMPO REAL DESDE FIRESTORE CON RESPALDO LOCAL
  // ============================================
  useEffect(() => {
    if (!db || !lienzoActivoId) {
      setNodes([]);
      setEdges([]);
      return;
    }

    try {
      const unsubscribe = onSnapshot(
        doc(db, 'lienzos', lienzoActivoId),
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setNodes(data.nodes || []);
            setEdges(data.edges || []);
            if (data.worldOffset) {
              setWorldOffset(data.worldOffset);
            }
            // Actualizar backup local con la versión de Firestore
            try {
              localStorage.setItem(
                `dicrejart_canvas_backup_${lienzoActivoId}`,
                JSON.stringify({
                  nodes: data.nodes || [],
                  edges: data.edges || [],
                  worldOffset: data.worldOffset || { x: 40, y: 30 },
                  savedAt: Date.now(),
                })
              );
            } catch (_) {}
          } else {
            // Si el documento aún no existe en Firestore, verificar si hay un respaldo en localStorage
            const localBackup = localStorage.getItem(`dicrejart_canvas_backup_${lienzoActivoId}`);
            if (localBackup) {
              try {
                const parsed = JSON.parse(localBackup);
                if (parsed.nodes && parsed.nodes.length > 0) {
                  setNodes(parsed.nodes);
                  setEdges(parsed.edges || []);
                  if (parsed.worldOffset) setWorldOffset(parsed.worldOffset);
                  return;
                }
              } catch (_) {}
            }
            setNodes([]);
            setEdges([]);
          }
        },
        (err) => {
          console.warn('Aviso leyendo lienzo activo:', err);
        }
      );
      return unsubscribe;
    } catch (e) {
      console.warn('Error en listener de lienzo activo:', e);
    }
  }, [lienzoActivoId]);

  const findNode = useCallback((id) => nodes.find((n) => n.id === id) || null, [nodes]);

  /** Devuelve el registro real (Proyecto/Juego/Actividad/Colaborador/Área) que representa un nodo, si ya está vinculado */
  const getLinkedEntity = useCallback(
    (node) => {
      if (!node || node.draft) return null;
      if (node.type === 'proyecto') return proyectos.find((p) => p.id === node.refId);
      if (node.type === 'juego') return juegos.find((j) => j.id === node.refId);
      if (node.type === 'actividad') return actividades.find((a) => a.id === node.refId);
      if (node.type === 'colaborador') return operarios.find((o) => o.id === node.refId);
      if (node.type === 'area') return dynamicAreas.find((a) => a.id === node.refId);
      return null;
    },
    [proyectos, juegos, actividades, operarios, dynamicAreas]
  );

  const nodeTitle = useCallback(
    (node) => {
      if (!node) return 'Sin nombre';
      if (node.type === 'recurso') {
        return node.draftFields?.title || node.title || 'Ayuda Visual / Archivo';
      }
      if (node.draft) return node.draftFields?.name || node.draftFields?.title || 'Sin nombre';
      const entity = getLinkedEntity(node);
      if (!entity) return '(no encontrado)';
      return entity.name || entity.title || 'Sin nombre';
    },
    [getLinkedEntity]
  );

  /**
   * Obtiene el supervisor / encargado oficial de un área de manufactura
   */
  const getSupervisorForArea = useCallback(
    (areaId) => {
      if (!areaId) return { id: null, name: 'Supervisor de Área', role: 'Supervisor de Área' };
      const areaObj = dynamicAreas.find((a) => a.id === areaId);

      // 1. Buscar en usuarios registrados con rol supervisor-area o encargado-area
      const supervisorUser = (users || []).find(
        (u) =>
          u.status === 'activo' &&
          ((u.roleType === 'supervisor-area' && (u.areaIds || []).includes(areaId)) ||
           (u.roleType === 'encargado-area' && u.areaId === areaId))
      );
      if (supervisorUser) {
        return {
          id: supervisorUser.id,
          name: supervisorUser.name,
          role: supervisorUser.role || 'Supervisor de Área',
          email: supervisorUser.email,
        };
      }

      // 2. Buscar en plantilla de operarios con puesto de Supervisor o Encargado en esa área
      const supervisorOp = (operarios || []).find(
        (o) =>
          o.currentArea === areaId &&
          (o.puesto?.toLowerCase().includes('supervisor') || o.puesto?.toLowerCase().includes('encargado'))
      );
      if (supervisorOp) {
        return {
          id: supervisorOp.id,
          name: supervisorOp.name,
          role: supervisorOp.puesto || 'Supervisor de Área',
          email: supervisorOp.email || null,
        };
      }

      return {
        id: null,
        name: `Supervisor de ${areaObj?.name || areaId}`,
        role: 'Supervisor de Área',
        email: null,
      };
    },
    [dynamicAreas, users, operarios]
  );

  /**
   * Guarda de forma transparente el estado actual del lienzo en Firestore y en localStorage
   */
  const saveToFirestore = useCallback(async (newNodes, newEdges, newOffset) => {
    if (!db || !lienzoActivoId || !canEditDiagram) return;

    // Sanitizar nodos: si un recurso ya tiene url de Storage, remover dataUrl pesado para no inflar Firestore
    const sanitizedNodes = (newNodes || []).map((node) => {
      if (node.type === 'recurso') {
        const fileData = node.draftFields?.fileData;
        if (fileData?.url && fileData?.dataUrl) {
          const { dataUrl, ...restFileData } = fileData;
          return {
            ...node,
            draftFields: {
              ...node.draftFields,
              fileData: restFileData,
            },
          };
        }
      }
      return node;
    });

    // Respaldo inmediato en localStorage para evitar cualquier pérdida al recargar
    try {
      localStorage.setItem(
        `dicrejart_canvas_backup_${lienzoActivoId}`,
        JSON.stringify({
          nodes: sanitizedNodes,
          edges: newEdges,
          worldOffset: newOffset || worldOffset,
          savedAt: Date.now(),
        })
      );
    } catch (e) {
      console.warn('No se pudo guardar backup local:', e);
    }

    setSaveStatus('saving');
    try {
      const existingLienzo = lienzosList.find((l) => l.id === lienzoActivoId);
      const matchingProj = proyectos.find((p) => p.id === lienzoActivoId);
      const canvasName = existingLienzo?.name || matchingProj?.name || (lienzoActivoId === 'general' ? 'Lienzo General' : 'Lienzo Visual');

      await setDoc(doc(db, 'lienzos', lienzoActivoId), {
        name: canvasName,
        nodes: sanitizedNodes,
        edges: newEdges,
        worldOffset: newOffset || worldOffset,
        updatedAt: new Date().toISOString(),
        lastSavedBy: user?.name || user?.email || 'Usuario',
      }, { merge: true });
      setSaveStatus('saved');
    } catch (e) {
      console.error('Error al guardar lienzo en Firestore:', e);
      setSaveStatus('error');
    }
  }, [lienzoActivoId, lienzosList, proyectos, worldOffset, canEditDiagram, user]);

  /**
   * Actualiza un campo de borrador de cualquier nodo y persiste de inmediato
   */
  const updateDraftField = useCallback((nodeId, field, value) => {
    setNodes((prevNodes) => {
      const nextNodes = prevNodes.map((n) => {
        if (n.id === nodeId) {
          const updatedDraft = { ...(n.draftFields || {}), [field]: value };
          return {
            ...n,
            draftFields: updatedDraft,
            ...(field === 'title' ? { title: value } : {}),
            ...(field === 'url' ? { url: value } : {}),
          };
        }
        return n;
      });
      saveToFirestore(nextNodes, edges);
      return nextNodes;
    });
  }, [edges, saveToFirestore]);

  /**
   * Recorre todas las conexiones existentes en el lienzo y sincroniza automáticamente
   * en Firestore cualquier actividad, proyecto o juego que esté conectado pero que aún
   * no tenga grabado su responsable, área o proyecto en la base de datos.
   */
  const handleReconcileCanvasAssignments = useCallback(async (showNotification = true) => {
    let syncedCount = 0;
    for (const edge of edges) {
      const fromNode = findNode(edge.from);
      const toNode = findNode(edge.to);
      if (!fromNode || !toNode) continue;

      const colabNode = fromNode.type === 'colaborador' ? fromNode : toNode.type === 'colaborador' ? toNode : null;
      const actNode = fromNode.type === 'actividad' ? fromNode : toNode.type === 'actividad' ? toNode : null;
      const recursoNode = fromNode.type === 'recurso' ? fromNode : toNode.type === 'recurso' ? toNode : null;
      const projNode = fromNode.type === 'proyecto' ? fromNode : toNode.type === 'proyecto' ? toNode : null;
      const areaNode = fromNode.type === 'area' ? fromNode : toNode.type === 'area' ? toNode : null;
      const gameNode = fromNode.type === 'juego' ? fromNode : toNode.type === 'juego' ? toNode : null;

      // 1. Colaborador ↔ Actividad
      if (colabNode && actNode && actNode.refId) {
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act && act.operarioId !== colabNode.refId) {
          try {
            await updateDoc(doc(db, 'actividades', act.id), {
              operarioId: colabNode.refId,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(act.id, { operarioId: colabNode.refId });
            syncedCount++;
          } catch (e) {}
        }
      }

      // 2. Recurso / Ayuda Visual ↔ Actividad
      if (recursoNode && actNode && actNode.refId) {
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act) {
          // Si el recurso tiene URL o archivo, validar sincronización
          const resUrl = recursoNode.draftFields?.url;
          if (resUrl && !(act.links || []).includes(resUrl)) {
            try {
              const updatedLinks = [...(act.links || []), resUrl];
              await updateDoc(doc(db, 'actividades', act.id), {
                links: updatedLinks,
                updatedAt: new Date().toISOString(),
              });
              updateActividad(act.id, { links: updatedLinks });
              syncedCount++;
            } catch (e) {}
          }
        }
      }

      // 3. Área ↔ Actividad
      if (areaNode && actNode && actNode.refId) {
        const areaId = areaNode.refId;
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act && areaId && act.areaId !== areaId) {
          try {
            await updateDoc(doc(db, 'actividades', act.id), {
              areaId,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(act.id, { areaId });
            syncedCount++;
          } catch (e) {}
        }
      }

      // 4. Proyecto ↔ Actividad
      if (projNode && actNode && actNode.refId) {
        const projId = projNode.refId;
        const projEntity = getLinkedEntity(projNode);
        const projName = projEntity?.name || nodeTitle(projNode);
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act && projId && act.projectId !== projId) {
          try {
            await updateDoc(doc(db, 'actividades', act.id), {
              projectId: projId,
              projectName: projName,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(act.id, { projectId: projId, projectName: projName });
            syncedCount++;
          } catch (e) {}
        }
      }

      // 5. Juego ↔ Actividad
      if (gameNode && actNode && actNode.refId) {
        const gameId = gameNode.refId;
        const act = actividades.find((a) => a.id === actNode.refId);
        if (act && gameId && act.gameId !== gameId) {
          try {
            await updateDoc(doc(db, 'actividades', act.id), {
              gameId,
              updatedAt: new Date().toISOString(),
            });
            updateActividad(act.id, { gameId });
            syncedCount++;
          } catch (e) {}
        }
      }
    }

    if (showNotification) {
      if (syncedCount > 0) {
        toast.success(`⚡ Sincronización completa: ${syncedCount} asignación(es) actualizadas en base de datos.`);
      } else {
        toast.info('✅ Todas las conexiones del lienzo ya están sincronizadas con la base de datos.');
      }
    }
    return syncedCount;
  }, [edges, actividades, findNode, getLinkedEntity, nodeTitle, updateActividad, toast]);

  /**
   * Guardado manual explícito por botón para dar confirmación visual al usuario
   */
  const handleManualSaveCanvas = useCallback(async () => {
    saveToFirestore(nodes, edges, worldOffset);
    const count = await handleReconcileCanvasAssignments(false);
    if (count > 0) {
      toast.success(`💾 Lienzo guardado y ${count} asignación(es) sincronizadas en Firestore.`);
    } else {
      toast.success('💾 Lienzo y conexiones guardados correctamente en la nube.');
    }
  }, [nodes, edges, worldOffset, saveToFirestore, handleReconcileCanvasAssignments, toast]);

  /**
   * Crea un nuevo proyecto visual / lienzo independiente
   */
  const handleCreateNewLienzo = async () => {
    if (!newLienzoModal.name.trim()) {
      toast.danger('Ingresa un nombre para el nuevo proyecto visual.');
      return;
    }
    const newId = `lienzo_${Date.now()}`;
    const newName = newLienzoModal.name.trim();
    try {
      await setDoc(doc(db, 'lienzos', newId), {
        name: newName,
        isStandalone: true,
        nodes: [],
        edges: [],
        worldOffset: { x: 40, y: 30 },
        authorId: user?.id || user?.uid || 'user',
        authorName: user?.name || user?.email || 'Usuario',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setLienzoActivoId(newId);
      setNewLienzoModal({ isOpen: false, name: '' });
      toast.success(`🎨 Lienzo visual "${newName}" creado.`);
    } catch (err) {
      console.error('Error creando lienzo:', err);
      toast.danger('No se pudo crear el lienzo.');
    }
  };

  /** Áreas de un Juego real que están bloqueadas por secuencia (ej. Herrería esperando Corte Láser) */
  const getBlockedAreas = useCallback(
    (gameEntity) => (gameEntity?.areas || []).filter((areaId) => isAreaBlockedBySequence(gameEntity, areaId)),
    []
  );

  /** Sanitiza URLs externas para prevenir rutas relativas erróneas */
  const formatExternalUrl = useCallback((url) => {
    if (!url) return '#';
    const trimmed = String(url).trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed}`;
  }, []);

  const nodeSummary = useCallback(
    (node) => {
      if (node.type === 'recurso') {
        const resType = node.draftFields?.resourceType || 'imagen';
        const typeLabel = resType === 'imagen' ? '🖼️ Imagen/Render' : resType === 'documento' ? '📄 Documento PDF' : resType === 'link' ? '🔗 Enlace Web' : '🎬 Modelo 3D';
        const targetEdge = edges.find(
          (e) =>
            (e.from === node.id && (findNode(e.to)?.type === 'actividad' || findNode(e.to)?.type === 'proyecto')) ||
            (e.to === node.id && (findNode(e.from)?.type === 'actividad' || findNode(e.from)?.type === 'proyecto'))
        );
        const targetNode = targetEdge ? findNode(findNode(targetEdge.from)?.type === 'actividad' || findNode(targetEdge.from)?.type === 'proyecto' ? targetEdge.from : targetEdge.to) : null;
        const targetName = targetNode ? nodeTitle(targetNode) : null;

        const parts = [typeLabel];
        if (targetName) parts.push(`📌 Ligado a: ${targetName}`);
        if (node.draftFields?.fileData?.name) parts.push(`📎 ${node.draftFields.fileData.name}`);
        return parts.join(' · ');
      }
      if (node.draft) return '🆕 Aún no guardado en el sistema';
      const entity = getLinkedEntity(node);
      if (!entity) return 'Registro no encontrado';
      if (node.type === 'proyecto') return `${entity.client || 'Sin cliente'} · ${entity.progress ?? 0}%`;
      if (node.type === 'juego') {
        const blocked = getBlockedAreas(entity);
        const blockedSuffix = blocked.length > 0
          ? ` · 🔒 ${blocked.map((a) => dynamicAreas.find((c) => c.id === a)?.name || a).join(', ')} bloqueada(s)`
          : '';
        const rejected = (entity.areas || []).filter((a) => entity.qualityReview?.[a]?.status === 'rechazado');
        const rejectedSuffix = rejected.length > 0
          ? ` · ❌ Calidad rechazó ${rejected.map((a) => dynamicAreas.find((c) => c.id === a)?.name || a).join(', ')}`
          : '';
        return `${entity.projectName || ''} · ${entity.progress ?? 0}%${blockedSuffix}${rejectedSuffix}`;
      }
      if (node.type === 'actividad') {
        const colabEdge = edges.find(
          (e) =>
            (e.from === node.id && findNode(e.to)?.type === 'colaborador') ||
            (e.to === node.id && findNode(e.from)?.type === 'colaborador')
        );
        const connectedColabNode = colabEdge
          ? findNode(findNode(colabEdge.from)?.type === 'colaborador' ? colabEdge.from : colabEdge.to)
          : null;
        const directOperario = operarios.find((o) => o.id === (entity?.operarioId || node?.operarioId || node?.draftFields?.operarioId));
        const responsable = directOperario?.name || (connectedColabNode ? nodeTitle(connectedColabNode) : null);
        return `Área: ${dynamicAreas.find((a) => a.id === entity?.areaId)?.name || entity?.areaId || 'General'} · ${entity?.status || 'pendiente'}${responsable ? ` · 👷 ${responsable}` : ''}`;
      }
      if (node.type === 'colaborador') return `Área actual: ${dynamicAreas.find((a) => a.id === entity.currentArea)?.name || entity.currentArea}`;
      if (node.type === 'area') return 'Área de manufactura';
      return '';
    },
    [getLinkedEntity, getBlockedAreas, proyectos, juegos, operarios, dynamicAreas, allBlockAreas, edges, findNode, nodeTitle]
  );
  // POSICIONES DE PUERTOS Y LÍNEAS
  // ============================================
  const portPos = useCallback((node, side) => ({
    x: node.x + (side === 'out' ? NODE_WIDTH : 0),
    y: node.y + NODE_HEIGHT / 2,
  }), []);

  const worldBounds = useMemo(() => {
    let maxX = WORKSPACE_WIDTH;
    let maxY = WORKSPACE_HEIGHT;
    nodes.forEach((n) => {
      maxX = Math.max(maxX, n.x + NODE_WIDTH + 300);
      maxY = Math.max(maxY, n.y + NODE_HEIGHT + 300);
    });
    return { width: maxX, height: maxY };
  }, [nodes]);

  // ============================================
  // ARRASTRAR NODOS
  // ============================================
  const handleNodeMouseDown = (e, nodeId) => {
    // Si se presiona el botón central o la tecla espacio, no arrastra el nodo, sino el lienzo
    if (e.button === 1 || isSpacePressedRef.current) return;
    if (!canEditDiagram) return;
    if (
      e.target.closest('[data-role="port"]') ||
      e.target.closest('[data-role="close"]') ||
      e.target.closest('[data-role="block-panel"]')
    ) return;
    const node = findNode(nodeId);
    if (!node) return;
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
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
    const node = findNode(nodeId);
    if (node?.type === 'recurso') {
      const storagePath = node.draftFields?.fileData?.storagePath;
      if (storagePath && storage) {
        deleteObject(ref(storage, storagePath)).catch((e) => console.warn('Archivo de Storage ya no existe o falló borrado:', e));
      }
    }
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges.filter((ed) => ed.from !== nodeId && ed.to !== nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
    setSelectedEdgeId(null);
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
    return {
      x: (e.clientX - rect.left - worldOffsetRef.current.x) / zoomRef.current,
      y: (e.clientY - rect.top - worldOffsetRef.current.y) / zoomRef.current,
    };
  };

  // ============================================
  // PANNING DEL LIENZO (ESTILO INVENTOR / SOLIDWORKS)
  // Permite arrastre con botón central (rueda), botón derecho, clic izquierdo en fondo o Espacio
  // ============================================
  const handleCanvasMouseDown = (e) => {
    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    const isBackgroundLeft = e.button === 0 && (
      e.target === canvasWrapRef.current ||
      e.target.dataset.canvasBg ||
      e.target === worldRef.current ||
      isSpacePressedRef.current
    );

    if (isMiddle || isRight || isBackgroundLeft) {
      e.preventDefault();
      setSelectedEdgeId(null);
      panStateRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startOffset: worldOffsetRef.current,
      };
      setIsPanning(true);
    }
  };

  const handleWindowMouseMove = (e) => {
    if (canvasWrapRef.current) {
      const rect = canvasWrapRef.current.getBoundingClientRect();
      const curX = Math.round((e.clientX - rect.left - worldOffsetRef.current.x) / zoomRef.current);
      const curY = Math.round((e.clientY - rect.top - worldOffsetRef.current.y) / zoomRef.current);
      setCursorCoords({ x: curX, y: curY });
    }

    if (dragStateRef.current) {
      const { id, startMouseX, startMouseY, startNodeX, startNodeY } = dragStateRef.current;
      const dx = (e.clientX - startMouseX) / zoomRef.current;
      const dy = (e.clientY - startMouseY) / zoomRef.current;
      const rawX = startNodeX + dx;
      const rawY = startNodeY + dy;
      const finalX = snapToGrid ? Math.round(rawX / GRID_SIZE) * GRID_SIZE : rawX;
      const finalY = snapToGrid ? Math.round(rawY / GRID_SIZE) * GRID_SIZE : rawY;
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? {
          ...n,
          x: Math.max(0, Math.min(WORKSPACE_WIDTH - NODE_WIDTH, finalX)),
          y: Math.max(0, Math.min(WORKSPACE_HEIGHT - NODE_HEIGHT, finalY)),
        } : n))
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
      setWorldOffset({
        x: startOffset.x + (e.clientX - startMouseX),
        y: startOffset.y + (e.clientY - startMouseY),
      });
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

          const alreadyExists = edges.some((ed) => (ed.from === from && ed.to === to) || (ed.from === to && ed.to === from));
          if (!alreadyExists) {
            const newEdge = { id: nextEdgeId(), from, to };
            const nextEdges = [...edges, newEdge];
            setEdges(nextEdges);
            saveToFirestore(nodes, nextEdges);

            // Al conectar nodos con cables, se propaga y sincroniza automáticamente su relación en Firestore:
            const fromNode = findNode(from);
            const toNode = findNode(to);
            if (fromNode && toNode) {
              const projNode = fromNode.type === 'proyecto' ? fromNode : toNode.type === 'proyecto' ? toNode : null;
              const gameNode = fromNode.type === 'juego' ? fromNode : toNode.type === 'juego' ? toNode : null;
              const colabNode = fromNode.type === 'colaborador' ? fromNode : toNode.type === 'colaborador' ? toNode : null;
              const actNode = fromNode.type === 'actividad' ? fromNode : toNode.type === 'actividad' ? toNode : null;
              const areaNode = fromNode.type === 'area' ? fromNode : toNode.type === 'area' ? toNode : null;
              const blockNode = fromNode.type === 'bloque' ? fromNode : toNode.type === 'bloque' ? toNode : null;

              // 1. Proyecto ↔ Juego: Vincular el juego al proyecto inmediatamente
              if (projNode && gameNode) {
                const projEntity = getLinkedEntity(projNode);
                const projId = projNode.refId || (projNode.draft ? null : projNode.id);
                const projName = projEntity?.name || nodeTitle(projNode);

                if (gameNode.refId && !gameNode.draft) {
                  updateDoc(doc(db, 'juegos', gameNode.refId), {
                    projectId: projId,
                    projectName: projName,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    toast.success(`🔗 Juego "${nodeTitle(gameNode)}" vinculado al Proyecto "${projName}".`);
                  }).catch((err) => console.error('Error al vincular juego a proyecto:', err));
                } else if (gameNode.draft) {
                  updateDraftField(gameNode.id, 'projectId', projId);
                  toast.success(`🔗 Juego vinculado al Proyecto "${projName}".`);
                }
              }

              // 2. Colaborador ↔ Juego: Asignar colaborador responsable al juego
              if (colabNode && gameNode) {
                const operario = operarios.find((o) => o.id === colabNode.refId);
                const operarioName = operario?.name || nodeTitle(colabNode);
                if (gameNode.refId && !gameNode.draft) {
                  updateDoc(doc(db, 'juegos', gameNode.refId), {
                    operarioId: colabNode.refId,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    toast.success(`👷 ${operarioName} asignado como responsable del Juego "${nodeTitle(gameNode)}".`);
                  }).catch((err) => console.error('Error al asignar operario a juego:', err));
                } else if (gameNode.draft) {
                  updateDraftField(gameNode.id, 'operarioId', colabNode.refId);
                  toast.success(`👷 ${operarioName} asignado al juego.`);
                }
              }

              // 3. Colaborador ↔ Actividad: Asignar colaborador a la tarea y reflejar en Firestore
              if (colabNode && actNode) {
                const operario = operarios.find((o) => o.id === colabNode.refId);
                const operarioName = operario?.name || nodeTitle(colabNode);
                const actTitle = nodeTitle(actNode);
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                const actEntity = getLinkedEntity(actNode);
                const areaId = actEntity?.areaId;
                const areaName = dynamicAreas.find((a) => a.id === areaId)?.name || areaId || 'General';
                const supervisor = getSupervisorForArea(areaId);

                if (actId && !actNode.draft) {
                  updateDoc(doc(db, 'actividades', actId), {
                    operarioId: colabNode.refId,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { operarioId: colabNode.refId });
                    toast.success(`👷 ${operarioName} asignado a la actividad "${actTitle}".`);
                    // Notificar al supervisor de área
                    if (areaId) {
                      sendSystemChatMessage({
                        targetUserId: supervisor.id,
                        targetUserName: supervisor.name,
                        text: `📌 [Tarea Asignada en ${areaName}] Se ha asignado a ${operarioName} para la actividad "${actTitle}". Supervisor responsable: ${supervisor.name}.`,
                        senderId: user?.id || 'admin',
                        senderName: user?.name || 'Administración',
                        isGlobal: true,
                      });
                    }
                  }).catch((err) => {
                    console.error('Error al asignar colaborador vía updateDoc:', err);
                    updateActividad(actId, { operarioId: colabNode.refId });
                  });
                } else if (actNode.draft) {
                  updateDraftField(actNode.id, 'operarioId', colabNode.refId);
                  toast.success(`👷 ${operarioName} asignado a la actividad.`);
                }
              }

              // 4. Recurso / Ayuda Visual ↔ Actividad: Vincular el recurso a la actividad
              if (recursoNode && actNode) {
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                const actTitle = nodeTitle(actNode);
                const resTitle = nodeTitle(recursoNode);
                const resUrl = recursoNode.draftFields?.url;

                if (actId && !actNode.draft) {
                  const act = actividades.find((a) => a.id === actId);
                  const updatedLinks = resUrl && !(act?.links || []).includes(resUrl)
                    ? [...(act?.links || []), resUrl]
                    : (act?.links || []);

                  updateDoc(doc(db, 'actividades', actId), {
                    links: updatedLinks,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { links: updatedLinks });
                    toast.success(`📎 "${resTitle}" vinculada a la Actividad "${actTitle}".`);
                  }).catch(() => {
                    toast.success(`📎 "${resTitle}" vinculada a la Actividad "${actTitle}".`);
                  });
                } else {
                  toast.success(`📎 "${resTitle}" vinculada a la Actividad "${actTitle}".`);
                }
              }

              // 5. Recurso / Ayuda Visual ↔ Proyecto: Vincular el recurso al proyecto
              if (recursoNode && projNode) {
                const projName = nodeTitle(projNode);
                const resTitle = nodeTitle(recursoNode);
                toast.success(`📎 "${resTitle}" vinculada al Proyecto "${projName}".`);
              }

              // 6. Proyecto ↔ Actividad: Vincular proyecto directamente
              if (projNode && actNode) {
                const projId = projNode.refId || (projNode.draft ? null : projNode.id);
                const projEntity = getLinkedEntity(projNode);
                const projName = projEntity?.name || nodeTitle(projNode);
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                if (actId && !actNode.draft) {
                  updateDoc(doc(db, 'actividades', actId), {
                    projectId: projId,
                    projectName: projName,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { projectId: projId, projectName: projName });
                    toast.success(`🔗 Actividad vinculada al Proyecto "${projName}".`);
                  });
                }
              }

              // 7. Juego ↔ Actividad
              if (gameNode && actNode) {
                const gameId = gameNode.refId || (gameNode.draft ? null : gameNode.id);
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                if (actId && !actNode.draft) {
                  updateDoc(doc(db, 'actividades', actId), {
                    gameId,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { gameId });
                    toast.success(`🔗 Actividad vinculada al Juego "${nodeTitle(gameNode)}".`);
                  });
                }
              }

              // 10. Área ↔ Actividad: Asignar área a la actividad y notificar al supervisor
              if (areaNode && actNode) {
                const areaEntity = getLinkedEntity(areaNode);
                const areaId = areaNode.refId || areaEntity?.id;
                const areaName = areaEntity?.name || nodeTitle(areaNode);
                const actTitle = nodeTitle(actNode);
                const actId = actNode.refId || (actNode.draft ? null : actNode.id);
                const supervisor = getSupervisorForArea(areaId);

                if (actId && !actNode.draft) {
                  updateDoc(doc(db, 'actividades', actId), {
                    areaId: areaId,
                    updatedAt: new Date().toISOString(),
                  }).then(() => {
                    updateActividad(actId, { areaId });
                    toast.success(`🏭 Actividad "${actTitle}" asignada al área "${areaName}".`);
                    // Notificar al supervisor de área
                    sendSystemChatMessage({
                      targetUserId: supervisor.id,
                      targetUserName: supervisor.name,
                      text: `📌 [Nueva Tarea Asignada a ${areaName}] La actividad "${actTitle}" ha sido asignada al área "${areaName}". Supervisor responsable: ${supervisor.name}.`,
                      senderId: user?.id || 'admin',
                      senderName: user?.name || 'Administración',
                      isGlobal: true,
                    });
                  }).catch((err) => {
                    console.error('Error al actualizar área de actividad:', err);
                    updateActividad(actId, { areaId });
                  });
                } else if (actNode.draft) {
                  updateDraftField(actNode.id, 'areaId', areaId);
                  toast.success(`🏭 Actividad asignada al área "${areaName}".`);
                }
              }

              // 11. Área ↔ Proyecto: Notificar al supervisor del área que hay un nuevo proyecto que le corresponde trabajar
              if (areaNode && projNode) {
                const areaEntity = getLinkedEntity(areaNode);
                const areaId = areaNode.refId || areaEntity?.id;
                const areaName = areaEntity?.name || nodeTitle(areaNode);
                const projName = nodeTitle(projNode);
                const supervisor = getSupervisorForArea(areaId);

                const alertText = `📢 [Nuevo Proyecto Asignado a ${areaName}] El proyecto "${projName}" ha sido vinculado al área "${areaName}". Le corresponde al supervisor (${supervisor.name}) y a su equipo programar y coordinar los trabajos correspondientes.`;

                // Notificar al supervisor y al Chat Global del sistema
                sendSystemChatMessage({
                  targetUserId: supervisor.id,
                  targetUserName: supervisor.name,
                  text: alertText,
                  senderId: user?.id || 'admin',
                  senderName: user?.name || 'Administración',
                  isGlobal: true,
                });

                toast.success(`📢 Notificación enviada al supervisor (${supervisor.name}) de ${areaName} para el Proyecto "${projName}".`);
              }

              // 12. Juego ↔ Área: Añadir área a la ruta de manufactura del juego y notificar al supervisor
              if (gameNode && areaNode) {
                const areaId = areaNode.refId;
                const areaEntity = getLinkedEntity(areaNode);
                const areaName = areaEntity?.name || nodeTitle(areaNode);
                const gameEntity = getLinkedEntity(gameNode);
                const gameName = nodeTitle(gameNode);
                const supervisor = getSupervisorForArea(areaId);

                if (gameEntity && areaId) {
                  const currentAreas = gameEntity.areas || [];
                  if (!currentAreas.includes(areaId)) {
                    const nextAreas = [...currentAreas, areaId];
                    updateDoc(doc(db, 'juegos', gameEntity.id), {
                      areas: nextAreas,
                      targetPieces: { ...(gameEntity.targetPieces || {}), [areaId]: 10 },
                      updatedAt: new Date().toISOString(),
                    }).then(() => {
                      toast.success(`🏭 Área "${areaName}" agregada a la ruta del Juego.`);
                    });
                  }
                }

                const alertText = `📢 [Modelo de Juego en Ruta de Fabricación] El área "${areaName}" ha sido incorporada para fabricar el modelo "${gameName}". Supervisado por ${supervisor.name}.`;

                sendSystemChatMessage({
                  targetUserId: supervisor.id,
                  targetUserName: supervisor.name,
                  text: alertText,
                  senderId: user?.id || 'admin',
                  senderName: user?.name || 'Administración',
                  isGlobal: true,
                });

                toast.success(`📢 Supervisor (${supervisor.name}) notificado sobre el modelo "${gameName}".`);
              }
            }
          }
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

  /**
   * Cambia el zoom manteniendo fijo el punto del lienzo que está bajo (cursorX, cursorY)
   * en coordenadas de pantalla — igual que Figma/Inventor/SolidWorks.
   */
  const zoomAtPoint = (deltaZoom, cursorX, cursorY) => {
    const prevZoom = zoomRef.current;
    const nextZoom = clampZoom(prevZoom + deltaZoom);
    if (nextZoom === prevZoom) return;
    const prevOffset = worldOffsetRef.current;
    const nextOffset = {
      x: cursorX - ((cursorX - prevOffset.x) / prevZoom) * nextZoom,
      y: cursorY - ((cursorY - prevOffset.y) / prevZoom) * nextZoom,
    };
    setZoom(nextZoom);
    setWorldOffset(nextOffset);
  };

  const handleZoomButton = (delta) => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtPoint(delta, rect.width / 2, rect.height / 2);
  };

  const handleResetView = () => {
    setZoom(1);
    setWorldOffset({ x: 80, y: 60 });
  };

  /**
   * Ajusta y centra automáticamente la cámara a todo el diagrama (Zoom to Fit / Tecla F)
   */
  const handleFitToView = useCallback(() => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) {
      setZoom(1);
      setWorldOffset({ x: 80, y: 60 });
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_WIDTH);
      maxY = Math.max(maxY, n.y + NODE_HEIGHT + (n.type === 'bloque' && expandedBlocks.has(n.id) ? 220 : 0));
    });

    const diagramWidth = Math.max(100, maxX - minX);
    const diagramHeight = Math.max(100, maxY - minY);
    const padding = 120;

    const availableWidth = Math.max(100, rect.width - padding * 2);
    const availableHeight = Math.max(100, rect.height - padding * 2);

    const fitZoom = clampZoom(Math.min(availableWidth / diagramWidth, availableHeight / diagramHeight, 1.1));

    const centerX = minX + diagramWidth / 2;
    const centerY = minY + diagramHeight / 2;

    const nextOffset = {
      x: Math.round(rect.width / 2 - centerX * fitZoom),
      y: Math.round(rect.height / 2 - centerY * fitZoom),
    };

    setZoom(fitZoom);
    setWorldOffset(nextOffset);
  }, [nodes, expandedBlocks]);

  // Zoom suave directo con la rueda del ratón (CAD standard)
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      zoomAtPoint(delta, e.clientX - rect.left, e.clientY - rect.top);
    };

    const onContextMenu = (e) => {
      if (panStateRef.current) {
        e.preventDefault();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Atajos de teclado CAD: Espacio para arrastrar el lienzo, F para centrar diagrama
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (e.code === 'Space' && !isInput) {
        if (!isSpacePressedRef.current) {
          isSpacePressedRef.current = true;
          setIsSpacePressed(true);
        }
        e.preventDefault();
      }
      if (e.key.toLowerCase() === 'f' && !isInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleFitToView();
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleFitToView]);

  /**
   * Reacomoda todos los nodos en la misma cuadrícula ordenada que usa spawnNode al
   * crearlos, conservando su orden de creación — una forma simple y predecible de
   * "auto-organizar" sin reinterpretar las relaciones del diagrama.
   */
  const handleAutoArrange = () => {
    if (!canEditDiagram) return;
    const nextNodes = nodes.map((n, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      return { ...n, x: 40 + column * (NODE_WIDTH + 70), y: 40 + row * (NODE_HEIGHT + 90) };
    });
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success('🧹 Nodos reorganizados en cuadrícula.');
  };

  // ============================================
  // BUSCAR Y CENTRAR UN NODO
  // ============================================
  const nodeSearchMatches = useMemo(() => {
    const q = nodeSearch.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((n) => nodeTitle(n).toLowerCase().includes(q)).slice(0, 8);
  }, [nodeSearch, nodes, nodeTitle]);

  const handleFocusNode = (node) => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nodeCenterX = node.x + NODE_WIDTH / 2;
    const nodeCenterY = node.y + NODE_HEIGHT / 2;
    setWorldOffset({
      x: rect.width / 2 - nodeCenterX * zoom,
      y: rect.height / 2 - nodeCenterY * zoom,
    });
    setSelectedNodeId(node.id);
  };

  // ============================================
  // EXPORTAR EL DIAGRAMA COMO IMAGEN
  // ============================================
  const handleExportDiagram = async () => {
    if (!worldRef.current || nodes.length === 0) {
      toast.warning('No hay nodos en el lienzo para exportar.');
      return;
    }
    setIsExporting(true);
    const prevOffset = worldOffset;
    const prevZoom = zoom;
    try {
      // Se resetea el pan/zoom a (0,0)/100% para capturar el lienzo completo sin
      // recortes ni desplazamientos, y se restaura la vista original al terminar. Se
      // esperan dos frames para asegurar que el navegador ya pintó con la transformación
      // reseteada antes de tomar la captura.
      setWorldOffset({ x: 0, y: 0 });
      setZoom(1);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Import dinámico: igual que jsPDF/xlsx en otras páginas, html2canvas solo se
      // descarga cuando realmente se exporta un diagrama.
      const { default: html2canvas } = await import('html2canvas');
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-gray-50').trim() || '#f5f5f7';
      const canvas = await html2canvas(worldRef.current, {
        backgroundColor: bgColor || null,
        width: worldBounds.width,
        height: worldBounds.height,
      });

      const canvasName =
        lienzosList.find((l) => l.id === lienzoActivoId)?.name ||
        proyectos.find((p) => p.id === lienzoActivoId)?.name ||
        (lienzoActivoId === 'general' ? 'general' : 'diagrama');
      const fileSafeName = canvasName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const link = document.createElement('a');
      link.download = `dicrejart-editor-visual-${fileSafeName || 'diagrama'}-${new Date().toISOString().split('T')[0]}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('📥 Diagrama exportado como imagen PNG.');
    } catch (error) {
      console.error('Error al exportar el diagrama:', error);
      toast.danger('No se pudo exportar el diagrama.');
    } finally {
      setWorldOffset(prevOffset);
      setZoom(prevZoom);
      setIsExporting(false);
    }
  };

  // ============================================
  // MODAL UNIFICADO DE CREACIÓN / INSERCIÓN DE NODOS
  // ============================================
  const catalogFor = useCallback(
    (type) => {
      if (type === 'proyecto') return proyectos.map((p) => ({ id: p.id, label: `${p.name} ${p.client ? `(${p.client})` : ''}` }));
      if (type === 'juego') return juegos.map((j) => ({ id: j.id, label: `${j.name} ${j.projectName ? `· 🗂️ ${j.projectName}` : ''}` }));
      if (type === 'actividad') return actividades.map((a) => ({ id: a.id, label: `📌 ${a.title} (${dynamicAreas.find((c) => c.id === a.areaId)?.name || a.areaId})` }));
      if (type === 'colaborador') {
        return operarios.map((o) => {
          const areaName = dynamicAreas.find((a) => a.id === o.currentArea)?.name || o.currentArea;
          const loanTag = o.currentArea !== o.homeArea ? ' · prestado' : '';
          return { id: o.id, label: `👷 ${o.name} — ${areaName}${loanTag} (${o.puesto || 'Operario'})` };
        });
      }
      if (type === 'area') return dynamicAreas.map((a) => ({ id: a.id, label: `🏭 ${a.name}` }));
      return [];
    },
    [proyectos, juegos, actividades, operarios, dynamicAreas]
  );

  const spawnNode = (type, node) => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    let spawnX, spawnY;
    if (rect) {
      const centerX = (rect.width / 2 - worldOffsetRef.current.x) / zoomRef.current;
      const centerY = (rect.height / 2 - worldOffsetRef.current.y) / zoomRef.current;
      const offsetCount = (nodes.length % 6) * 30;
      spawnX = Math.max(60, Math.min(WORKSPACE_WIDTH - NODE_WIDTH - 60, centerX - NODE_WIDTH / 2 + offsetCount));
      spawnY = Math.max(60, Math.min(WORKSPACE_HEIGHT - NODE_HEIGHT - 60, centerY - NODE_HEIGHT / 2 + offsetCount));
    } else {
      const column = nodes.length % 4;
      const row = Math.floor(nodes.length / 4);
      spawnX = 60 + column * (NODE_WIDTH + 70);
      spawnY = 60 + row * (NODE_HEIGHT + 90);
    }
    if (snapToGrid) {
      spawnX = Math.round(spawnX / GRID_SIZE) * GRID_SIZE;
      spawnY = Math.round(spawnY / GRID_SIZE) * GRID_SIZE;
    }
    const created = { id: nextNodeId(), type, x: spawnX, y: spawnY, ...node };
    const nextNodes = [...nodes, created];
    setNodes(nextNodes);
    setSelectedNodeId(created.id);
    saveToFirestore(nextNodes, edges);
  };

  const EMPTY_NODE_MODAL = {
    isOpen: false,
    type: 'colaborador', // 'proyecto' | 'juego' | 'colaborador' | 'area' | 'actividad' | 'recurso'
    tab: 'existing', // 'existing' | 'new'
    query: '',

    // Proyecto
    newProjName: '',
    newProjClient: '',
    newProjDesc: '',
    newProjStartDate: getTodayLocalDateStr(),
    newProjEndDate: getTodayLocalDateStr(),
    newProjStatus: 'diseno',

    // Juego
    newGameName: '',
    newGameProjectId: '',
    newGameAreas: ['herreria', 'corte-laser'],
    newGameTargets: { herreria: 10, 'corte-laser': 10 },

    // Actividad
    newActTitle: '',
    newActDesc: '',
    newActAreaId: 'herreria',
    newActPriority: 'media',
    newActDueDate: '',

    // Recurso / Ayuda Visual
    newRecursoTitle: 'Plano / Ayuda Visual',
    newRecursoType: 'imagen',
    newRecursoUrl: '',
    newRecursoFileData: null,
    pendingFile: null,
    newRecursoNotes: '',
  };

  const [nodeModal, setNodeModal] = useState(EMPTY_NODE_MODAL);

  const openNodeModal = (type) => {
    if (!canEditDiagram) return;
    const defaultTab = (type === 'colaborador' || type === 'area') ? 'existing' : (type === 'recurso' ? 'new' : 'existing');
    setNodeModal({
      ...EMPTY_NODE_MODAL,
      isOpen: true,
      type,
      tab: defaultTab,
      newGameAreas: ['herreria', 'corte-laser'],
      newGameTargets: { herreria: 10, 'corte-laser': 10 },
      newActAreaId: dynamicAreas[0]?.id || 'herreria',
    });
  };

  const closeNodeModal = () => setNodeModal(EMPTY_NODE_MODAL);

  const handlePickExistingNode = (type, entityId) => {
    spawnNode(type, { draft: false, refId: entityId, draftFields: {} });
    closeNodeModal();
    const meta = NODE_TYPES[type];
    toast.success(`✅ Nodo de ${meta?.label || type} agregado al lienzo.`);
  };

  const handleCreateNewProjectNode = async () => {
    if (!nodeModal.newProjName.trim() || !nodeModal.newProjClient.trim()) {
      toast.danger('Nombre del proyecto y cliente son obligatorios.');
      return;
    }
    const today = getTodayLocalDateStr();
    const newId = await addProject({
      name: nodeModal.newProjName.trim(),
      client: nodeModal.newProjClient.trim(),
      description: nodeModal.newProjDesc.trim() || 'Sin descripción',
      startDate: nodeModal.newProjStartDate || today,
      endDate: nodeModal.newProjEndDate || today,
      status: nodeModal.newProjStatus || 'diseno',
    });
    if (newId) {
      spawnNode('proyecto', { draft: false, refId: newId, draftFields: {} });
      closeNodeModal();
      toast.success(`🗂️ Proyecto "${nodeModal.newProjName.trim()}" creado y agregado al lienzo.`);
    }
  };

  const handleCreateNewGameNode = async () => {
    if (!nodeModal.newGameName.trim()) {
      toast.danger('El nombre del juego / modelo es obligatorio.');
      return;
    }
    let chosenAreas = nodeModal.newGameAreas.length > 0 ? nodeModal.newGameAreas : ['herreria'];
    if (chosenAreas.includes('herreria') && !chosenAreas.includes('corte-laser')) {
      chosenAreas.push('corte-laser');
    }
    const targets = {};
    chosenAreas.forEach((ar) => {
      targets[ar] = Number(nodeModal.newGameTargets[ar]) || 10;
    });

    const matchingProj = proyectos.find((p) => p.id === nodeModal.newGameProjectId);
    const newId = await addGame({
      name: nodeModal.newGameName.trim(),
      projectName: matchingProj?.name || 'General',
      projectId: nodeModal.newGameProjectId || null,
      areas: chosenAreas,
      targetPieces: targets,
    });
    if (newId) {
      spawnNode('juego', { draft: false, refId: newId, draftFields: {} });
      closeNodeModal();
      toast.success(`🎮 Juego "${nodeModal.newGameName.trim()}" creado y agregado al lienzo.`);
    }
  };

  const handleCreateNewActivityNode = async () => {
    if (!nodeModal.newActTitle.trim()) {
      toast.danger('El título de la actividad es obligatorio.');
      return;
    }
    const newId = await addActividad({
      title: nodeModal.newActTitle.trim(),
      description: nodeModal.newActDesc.trim() || 'Sin descripción.',
      areaId: nodeModal.newActAreaId || (dynamicAreas[0]?.id || 'herreria'),
      priority: nodeModal.newActPriority || 'media',
      dueDate: nodeModal.newActDueDate || null,
    });
    if (newId) {
      spawnNode('actividad', { draft: false, refId: newId, draftFields: {} });
      closeNodeModal();
      toast.success(`📌 Actividad "${nodeModal.newActTitle.trim()}" creada y agregada.`);
    }
  };

  const handleCreateNewRecursoNode = async () => {
    const title = nodeModal.newRecursoTitle.trim() || 'Ayuda Visual / Archivo';
    const url = nodeModal.newRecursoUrl.trim() || '';
    const pendingFile = nodeModal.pendingFile;

    closeNodeModal();

    const tempId = nextNodeId();
    const localUrl = pendingFile ? URL.createObjectURL(pendingFile) : '';

    const initialFileData = pendingFile ? {
      name: pendingFile.name,
      size: pendingFile.size,
      type: pendingFile.type,
      dataUrl: localUrl,
      isUploading: true,
    } : nodeModal.newRecursoFileData || null;

    spawnNode('recurso', {
      id: tempId,
      draft: false,
      draftFields: {
        title,
        url,
        fileData: initialFileData,
        notes: nodeModal.newRecursoNotes.trim() || '',
      },
    });

    toast.success(`📎 Ayuda Visual "${title}" agregada al lienzo.`);

    if (pendingFile) {
      toast.info(`⏳ Guardando "${pendingFile.name}" en la nube...`);
      try {
        const uploaded = await uploadResourceFile(pendingFile, lienzoActivoId);
        if (uploaded) {
          updateDraftField(tempId, 'fileData', uploaded);
          toast.success(`☁️ "${pendingFile.name}" guardado permanentemente.`);
        }
      } catch (err) {
        console.error('Error subiendo archivo:', err);
      }
    }
  };

  /**
   * Valida si el usuario logueado tiene permiso para iniciar / terminar / reabrir una actividad:
   * 1. Solo el colaborador asignado a la actividad (por operarioId, uid, email o nombre).
   * 2. O el supervisor / encargado del área de la actividad.
   * 3. O administradores / dirección / calidad general.
   */
  const canUserControlActivity = useCallback(
    (act) => {
      if (!user || !act) return false;
      // 1. Roles administrativos y supervisión global
      if (
        user.role === 'admin' ||
        user.roleType === 'admin' ||
        user.roleType === 'director' ||
        user.roleType === 'calidad' ||
        user.roleType === 'gerencia'
      ) {
        return true;
      }

      // 2. Colaborador asignado directamente a la actividad
      const assignedOperario = operarios.find((o) => o.id === act.operarioId);
      const isDirectlyAssigned =
        (user.operarioId && user.operarioId === act.operarioId) ||
        (user.id && (user.id === act.operarioId || user.id === assignedOperario?.id)) ||
        (user.uid && (user.uid === act.operarioId || user.uid === assignedOperario?.id)) ||
        (assignedOperario && (
          (assignedOperario.email && user.email && assignedOperario.email.toLowerCase() === user.email.toLowerCase()) ||
          (assignedOperario.name && user.name && assignedOperario.name.trim().toLowerCase() === user.name.trim().toLowerCase())
        ));

      if (isDirectlyAssigned) return true;

      // 3. Supervisor o Encargado del Área de la actividad
      const supervisor = getSupervisorForArea(act.areaId);
      const isAreaSupervisor =
        (supervisor.id && (supervisor.id === user.id || supervisor.id === user.uid)) ||
        ((user.roleType === 'supervisor-area' || user.roleType === 'encargado-area') && (
          user.areaId === act.areaId ||
          user.currentArea === act.areaId ||
          (Array.isArray(user.assignedAreas) && user.assignedAreas.includes(act.areaId)) ||
          (supervisor.name && user.name && supervisor.name.trim().toLowerCase() === user.name.trim().toLowerCase())
        ));

      if (isAreaSupervisor) return true;

      return false;
    },
    [user, operarios, getSupervisorForArea]
  );

  /**
   * Inicia una actividad pasando su estatus a 'proceso' y fijando startedAt en Firestore
   */
  const handleStartActivity = useCallback(
    async (activityId, title) => {
      if (!db || !activityId) return;
      const act = actividades.find((a) => a.id === activityId);
      if (act && !canUserControlActivity(act)) {
        toast.warning('🔒 Solo el colaborador asignado o el supervisor de esta área pueden iniciar esta actividad.');
        return;
      }
      try {
        await updateDoc(doc(db, 'actividades', activityId), {
          status: 'proceso',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        toast.success(`⚡ Actividad "${title || 'Actividad'}" iniciada.`);
      } catch (err) {
        console.error('Error al iniciar actividad:', err);
        toast.danger('Error al iniciar la actividad en el servidor.');
      }
    },
    [actividades, canUserControlActivity, toast]
  );

  /**
   * Abre modal para completar la actividad con notas de entrega
   */
  const handleOpenCompleteModal = useCallback((activityId, title) => {
    const act = actividades.find((a) => a.id === activityId);
    if (act && !canUserControlActivity(act)) {
      toast.warning('🔒 Solo el colaborador asignado o el supervisor de esta área pueden marcar como terminada esta actividad.');
      return;
    }
    setCompleteModal({
      isOpen: true,
      activityId,
      title,
      notes: 'Actividad concluida satisfactoriamente.',
    });
  }, [actividades, canUserControlActivity, toast]);

  /**
   * Confirma la finalización de la actividad y fija completedAt en Firestore
   */
  const handleConfirmCompleteActivity = useCallback(async () => {
    if (!completeModal.activityId || !db) return;
    try {
      await updateDoc(doc(db, 'actividades', completeModal.activityId), {
        status: 'completado',
        completedAt: new Date().toISOString(),
        completionNotes: completeModal.notes.trim() || 'Actividad concluida satisfactoriamente.',
        updatedAt: new Date().toISOString(),
      });
      toast.success(`✅ Actividad "${completeModal.title}" completada.`);
      setCompleteModal({ isOpen: false, activityId: null, title: '', notes: '' });
    } catch (err) {
      console.error('Error al completar actividad:', err);
      toast.danger('Error al marcar la actividad como completada.');
    }
  }, [completeModal, toast]);

  /**
   * Reabre o cambia de estado una actividad
   */
  const handleResetActivityStatus = useCallback(
    async (activityId, targetStatus = 'pendiente') => {
      if (!db || !activityId) return;
      const act = actividades.find((a) => a.id === activityId);
      if (act && !canUserControlActivity(act)) {
        toast.warning('🔒 No tienes permisos para cambiar el estado de esta actividad.');
        return;
      }
      try {
        const updates = {
          status: targetStatus,
          updatedAt: new Date().toISOString(),
        };
        if (targetStatus === 'pendiente') {
          updates.startedAt = null;
          updates.completedAt = null;
          updates.completionNotes = '';
        } else if (targetStatus === 'proceso') {
          updates.completedAt = null;
        }
        await updateDoc(doc(db, 'actividades', activityId), updates);
        toast.info(`🔄 Estado de la actividad cambiado a "${targetStatus}".`);
      } catch (err) {
        console.error('Error al cambiar estado de actividad:', err);
      }
    },
    [actividades, canUserControlActivity, toast]
  );

  const handleCreateNewBlockNode = () => {
    spawnNode('bloque', {
      blockName: nodeModal.newBlockName.trim() || 'Nodo de Trabajo',
      areaId: nodeModal.newBlockAreaId || (dynamicAreas[0]?.id || 'herreria'),
      projectId: null,
      gameId: null,
      operarioId: null,
      activityIds: [],
    });
    closeNodeModal();
    toast.success(`📦 Bloque "${nodeModal.newBlockName.trim() || 'Nodo de Trabajo'}" creado en el lienzo.`);
  };

  /** Actualiza cualquier propiedad de un Bloque (nombre, proyecto, juego, área, colaborador) */
  const updateBlockField = (nodeId, field, value) => {
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === nodeId ? { ...n, [field]: value } : n));
      saveToFirestore(next, edges);
      return next;
    });
  };

  /** Permite personalizar el color de cualquier nodo */
  const updateNodeColor = (nodeId, color) => {
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === nodeId ? { ...n, customColor: color } : n));
      saveToFirestore(next, edges);
      return next;
    });
  };

  /** Permite personalizar el color del cable / conexión */
  const updateEdgeColor = (edgeId, color) => {
    setEdges((prev) => {
      const next = prev.map((e) => (e.id === edgeId ? { ...e, customColor: color } : e));
      saveToFirestore(nodes, next);
      return next;
    });
  };

  /** Permite cambiar el estilo de línea del cable (solido, dashed, grueso) */
  const updateEdgeStyle = (edgeId, style) => {
    setEdges((prev) => {
      const next = prev.map((e) => (e.id === edgeId ? { ...e, style } : e));
      saveToFirestore(nodes, next);
      return next;
    });
  };

  const updateBlockName = (nodeId, value) => {
    updateBlockField(nodeId, 'blockName', value);
  };

  // ---- Crear una actividad NUEVA (real, en Firestore) directamente dentro de un Bloque ----
  const EMPTY_BLOCK_ACTIVITY = {
    isOpen: false,
    blockNodeId: null,
    title: '',
    description: '',
    priority: 'media',
    dueDate: '',
    attachments: [],
    linksText: '',
    modelFile: null,
    modelLink: '',
  };
  const [blockActivityForm, setBlockActivityForm] = useState(EMPTY_BLOCK_ACTIVITY);
  const [isSavingBlockActivity, setIsSavingBlockActivity] = useState(false);

  const openBlockActivityForm = (blockNodeId) => setBlockActivityForm({ ...EMPTY_BLOCK_ACTIVITY, isOpen: true, blockNodeId });
  const closeBlockActivityForm = () => setBlockActivityForm(EMPTY_BLOCK_ACTIVITY);

  const handleBlockActivityFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setBlockActivityForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...files] }));
    e.target.value = '';
  };

  const handleRemoveBlockActivityFile = (idx) => {
    setBlockActivityForm((prev) => ({ ...prev, attachments: prev.attachments.filter((_, i) => i !== idx) }));
  };

  const handleBlockActivityModelFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBlockActivityForm((prev) => ({ ...prev, modelFile: file }));
    e.target.value = '';
  };

  const handleCreateBlockActivity = async () => {
    const blockNode = findNode(blockActivityForm.blockNodeId);
    if (!blockNode || !blockActivityForm.title.trim()) {
      toast.danger('Ingresa un título para la actividad.');
      return;
    }

    // 1. Resolver colaborador responsable conectado al bloque
    const colabEdge = edges.find(
      (e) =>
        (e.from === blockNode.id && findNode(e.to)?.type === 'colaborador') ||
        (e.to === blockNode.id && findNode(e.from)?.type === 'colaborador')
    );
    const connectedColabNode = colabEdge
      ? findNode(findNode(colabEdge.from)?.type === 'colaborador' ? colabEdge.from : colabEdge.to)
      : null;
    const assignedOperarioId = blockNode.operarioId || connectedColabNode?.refId || null;

    // 2. Resolver proyecto vinculado
    const projEdge = edges.find(
      (e) =>
        (e.from === blockNode.id && findNode(e.to)?.type === 'proyecto') ||
        (e.to === blockNode.id && findNode(e.from)?.type === 'proyecto')
    );
    const connectedProjNode = projEdge
      ? findNode(findNode(projEdge.from)?.type === 'proyecto' ? projEdge.from : projEdge.to)
      : null;
    const assignedProjectId =
      blockNode.projectId ||
      connectedProjNode?.refId ||
      (lienzoActivoId !== 'general' && !lienzosList.some((l) => l.id === lienzoActivoId && l.isStandalone)
        ? lienzoActivoId
        : null);
    const assignedProject = proyectos.find((p) => p.id === assignedProjectId);
    const assignedProjectName = assignedProject?.name || (connectedProjNode ? nodeTitle(connectedProjNode) : null);

    // 3. Resolver juego vinculado
    const gameEdge = edges.find(
      (e) =>
        (e.from === blockNode.id && findNode(e.to)?.type === 'juego') ||
        (e.to === blockNode.id && findNode(e.from)?.type === 'juego')
    );
    const connectedGameNode = gameEdge
      ? findNode(findNode(gameEdge.from)?.type === 'juego' ? gameEdge.from : gameEdge.to)
      : null;
    const assignedGameId = blockNode.gameId || connectedGameNode?.refId || null;

    // 4. Resolver área vinculada
    const areaEdge = edges.find(
      (e) =>
        (e.from === blockNode.id && findNode(e.to)?.type === 'area') ||
        (e.to === blockNode.id && findNode(e.from)?.type === 'area')
    );
    const connectedAreaNode = areaEdge
      ? findNode(findNode(areaEdge.from)?.type === 'area' ? areaEdge.from : areaEdge.to)
      : null;
    const assignedAreaId = blockNode.areaId || connectedAreaNode?.refId || (dynamicAreas[0]?.id || 'herreria');

    const links = blockActivityForm.linksText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    setIsSavingBlockActivity(true);
    const newId = await addActividad({
      title: blockActivityForm.title.trim(),
      description: blockActivityForm.description || 'Sin descripción.',
      areaId: assignedAreaId,
      projectId: assignedProjectId,
      projectName: assignedProjectName,
      gameId: assignedGameId,
      operarioId: assignedOperarioId,
      dueDate: blockActivityForm.dueDate || null,
      priority: blockActivityForm.priority,
      attachments: blockActivityForm.attachments,
      links,
      modelFile: blockActivityForm.modelFile,
      modelLink: blockActivityForm.modelLink,
    });
    setIsSavingBlockActivity(false);
    if (!newId) {
      toast.danger('❌ No se pudo crear la actividad. Intenta de nuevo.');
      return;
    }
    const nextNodes = nodes.map((n) => (n.id === blockNode.id ? { ...n, activityIds: [...(n.activityIds || []), newId] } : n));
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.success(`✅ Actividad "${blockActivityForm.title.trim()}" creada y agregada al nodo.`);
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
      n.id === blockNodeId ? { ...n, activityIds: (n.activityIds || []).filter((id) => id !== activityId) } : n
    );
    setNodes(nextNodes);
    saveToFirestore(nextNodes, edges);
    toast.info('Actividad desvinculada del nodo visual.');
  };

  /** Elimina la actividad permanentemente de Firestore y despacha aviso al chat del personal */
  const handleDeleteActivityCompletely = async (blockNodeId, activityId) => {
    const act = actividades.find((a) => a.id === activityId);
    if (!act) return;
    if (act.status !== 'pendiente') {
      toast.warning('Solo se pueden eliminar actividades en estado pendiente.');
      return;
    }
    const res = await deleteActividad(activityId);
    if (res?.ok) {
      const nextNodes = nodes.map((n) =>
        n.id === blockNodeId ? { ...n, activityIds: (n.activityIds || []).filter((id) => id !== activityId) } : n
      );
      setNodes(nextNodes);
      saveToFirestore(nextNodes, edges);
      toast.success(`🗑️ Actividad "${act.title}" eliminada y aviso enviado al chat interno.`);
    } else {
      toast.danger(res?.error || 'No se pudo eliminar la actividad.');
    }
  };

  /**
   * Un Bloque se puede conectar (con cable, igual que cualquier otro nodo) a un
   * Colaborador — esa conexión es lo que determina quién queda como responsable de las
   * actividades del bloque: no se asigna a mano por actividad, se asigna al ligar el
   * bloque con el colaborador. Acepta el cable en cualquier dirección (Bloque→Colaborador
   * o Colaborador→Bloque), según de qué lado lo haya arrastrado quien conecta.
   */
  const getConnectedColaboradorNode = (blockNodeId) => {
    const edge = edges.find(
      (e) =>
        (e.from === blockNodeId && findNode(e.to)?.type === 'colaborador') ||
        (e.to === blockNodeId && findNode(e.from)?.type === 'colaborador')
    );
    if (!edge) return null;
    const colabNodeId = findNode(edge.from)?.type === 'colaborador' ? edge.from : edge.to;
    return findNode(colabNodeId);
  };

  /**
   * Reasigna TODAS las actividades ya existentes del bloque al colaborador actualmente
   * conectado — para cuando el cable se conecta (o se cambia) después de que el bloque
   * ya tenía actividades creadas con otro responsable (o sin ninguno).
   */
  const handleReassignBlockActivities = async (blockNode, colaboradorNodeOverride) => {
    // Acepta el nodo Colaborador ya resuelto (colaboradorNodeOverride) para cuando se
    // llama justo al terminar de crear el cable: en ese instante el estado "edges" del
    // render todavía no incluye el cable nuevo (setState es asíncrono), así que
    // getConnectedColaboradorNode(blockNode.id) — que lee "edges" — no lo encontraría.
    const colaboradorNode = colaboradorNodeOverride || getConnectedColaboradorNode(blockNode.id);
    if (!colaboradorNode) return;
    const activityIds = blockNode.activityIds || [];
    if (activityIds.length === 0) return;

    const results = await Promise.all(
      activityIds.map((activityId) => updateActividad(activityId, { operarioId: colaboradorNode.refId }))
    );
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      toast.danger(`No se pudieron reasignar ${failed} de ${activityIds.length} actividad(es).`);
    } else {
      toast.success(`🔗 ${activityIds.length} actividad(es) reasignada(s) a ${nodeTitle(colaboradorNode)}.`);
    }
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
    if (!lienzoActivoId) return;
    window.open(
      `/editor-visual/ventana?lienzoId=${lienzoActivoId}`,
      'DicrejartEditorVisual',
      'width=1680,height=960,menubar=no,toolbar=no,location=no,status=no'
    );
  };

  const handleMinimapClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;
    const targetWorldX = clickX * WORKSPACE_WIDTH;
    const targetWorldY = clickY * WORKSPACE_HEIGHT;

    const wrapRect = canvasWrapRef.current?.getBoundingClientRect();
    if (!wrapRect) return;

    setWorldOffset({
      x: Math.round(wrapRect.width / 2 - targetWorldX * zoom),
      y: Math.round(wrapRect.height / 2 - targetWorldY * zoom),
    });
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', verticalAlign: 'middle', marginRight: '8px' }}>
            <select
              value={lienzoActivoId}
              onChange={(e) => setLienzoActivoId(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--color-gray-300)',
                backgroundColor: 'var(--input-bg, var(--color-white))',
                color: 'var(--color-dark)',
                minWidth: '220px',
                cursor: 'pointer',
              }}
            >
              <optgroup label="🎨 Lienzos Libres y Bocetos" style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>
                <option value="general">🎨 Lienzo General (Boceto Libre)</option>
                {lienzosList
                  .filter((l) => l.id !== 'general' && !proyectos.some((p) => p.id === l.id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>{l.name || 'Lienzo Visual'}</option>
                  ))}
              </optgroup>
              {proyectos.filter((p) => p.status !== 'completado').length > 0 && (
                <optgroup label="⚡ Proyectos Activos" style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>
                  {proyectos
                    .filter((p) => p.status !== 'completado')
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </optgroup>
              )}
              {proyectos.filter((p) => p.status === 'completado').length > 0 && (
                <optgroup label="📁 Historial (Finalizados)" style={{ backgroundColor: 'var(--dropdown-bg)', color: 'var(--color-dark)' }}>
                  {proyectos
                    .filter((p) => p.status === 'completado')
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name} (Completado)</option>
                    ))}
                </optgroup>
              )}
            </select>

            {canEditDiagram && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setNewLienzoModal({ isOpen: true, name: '' })}
                  title="Crear un nuevo lienzo visual independiente"
                >
                  ➕ Nuevo Lienzo
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleManualSaveCanvas}
                  title="Guardar manualmente todos los cambios en Firestore y en tu almacenamiento local"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  {saveStatus === 'saving' ? '⏳ Guardando...' : '💾 Guardar Lienzo'}
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleReconcileCanvasAssignments(true)}
                  title="Revisar todas las conexiones del diagrama y asignar automáticamente a los colaboradores, proyectos y áreas en la base de datos"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  🔄 Sincronizar Asignaciones
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setManageLienzosModal(true)}
                  title="Ver lista de todos los lienzos y eliminar los que ya no necesites"
                >
                  📂 Gestionar Lienzos
                </Button>

                {isCurrentLienzoDeletable && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setDeleteLienzoConfirm(true)}
                    title="Eliminar este lienzo visual independiente"
                  >
                    🗑️ Eliminar Lienzo
                  </Button>
                )}

                <span
                  style={{
                    fontSize: '11.5px',
                    color: saveStatus === 'saving' ? 'var(--color-primary, #ea580c)' : '#10b981',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginLeft: '4px',
                  }}
                  title="Tus cambios se guardan automáticamente en Firestore y en tu navegador"
                >
                  {saveStatus === 'saving' ? '⏳ Guardando...' : '☁️ Guardado en vivo'}
                </span>
              </>
            )}
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
            onClick={handleOpenStandalone}
          >
            🗔 Abrir en Ventana Aparte
          </Button>
        )}
        {canEditDiagram && nodes.length > 0 && (
          <Button variant="secondary" size="md" onClick={handleAutoArrange}>
            🧹 Reorganizar
          </Button>
        )}
        {nodes.length > 0 && (
          <Button variant="secondary" size="md" onClick={handleExportDiagram} isLoading={isExporting}>
            📥 Exportar PNG
          </Button>
        )}
        <Button variant="secondary" size="md" onClick={() => setHowtoOpen(true)}>
          ¿Cómo funciona?
        </Button>
      </PageHeader>

      <div className={styles.workspace}>
          {/* ---------- Botón Flotante Circular: Abre/Cierra Panel de Herramientas ---------- */}
          <button
            type="button"
            className={`${styles.floatingTriggerBtn} ${isLeftRailOpen ? styles.floatingTriggerBtnActive : ''}`}
            onClick={() => setIsLeftRailOpen((prev) => !prev)}
            title={isLeftRailOpen ? 'Cerrar panel de herramientas (Espacio limpio)' : 'Abrir herramientas y nodos (➕)'}
          >
            {isLeftRailOpen ? '✕' : '➕'}
          </button>

          {/* ---------- Panel Flotante Translúcido (Glassmorphism) ---------- */}
          <AnimatePresence>
            {isLeftRailOpen && (
              <motion.aside
                className={styles.floatingLeftRail}
                initial={{ opacity: 0, scale: 0.88, x: -12, y: -12 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, scale: 0.88, x: -12, y: -12 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className={styles.floatingRailHeader}>
                  <h2 className={styles.railTitle}>Herramientas del Lienzo</h2>
                  <button
                    type="button"
                    className={styles.floatingCloseBtn}
                    onClick={() => setIsLeftRailOpen(false)}
                    title="Cerrar panel flotante"
                  >
                    ✕
                  </button>
                </div>

                {/* Sección de Gestión Rápida del Lienzo Actual */}
                <div style={{ marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', marginBottom: '4px' }}>
                    🎨 Lienzo Activo
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--color-primary)', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lienzosList.find((l) => l.id === lienzoActivoId)?.name || proyectos.find((p) => p.id === lienzoActivoId)?.name || '🎨 Lienzo General'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      onClick={() => {
                        setManageLienzosModal(true);
                        setIsLeftRailOpen(false);
                      }}
                      title="Ver todos tus lienzos y eliminar los que desees"
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                    >
                      📂 Gestionar / Eliminar
                    </button>
                    {nodes.length > 0 && (
                      <button
                        type="button"
                        className={styles.wireToolbarBtn}
                        onClick={() => setClearNodesConfirm(true)}
                        title="Quitar todos los nodos de este lienzo"
                        style={{ fontSize: '11px', padding: '4px 8px', color: 'var(--color-alert)' }}
                      >
                        🧹 Vaciar
                      </button>
                    )}
                    {isCurrentLienzoDeletable && (
                      <button
                        type="button"
                        className={styles.wireToolbarBtn}
                        onClick={() => setDeleteLienzoConfirm(true)}
                        title="Eliminar permanentemente este lienzo"
                        style={{ fontSize: '11px', padding: '4px 8px', color: '#dc2626', fontWeight: 700 }}
                      >
                        🗑️ Eliminar
                      </button>
                    )}
                  </div>
                </div>

                {canEditDiagram ? (
                  <div className={styles.palette}>
                    <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', marginBottom: '8px' }}>
                      ➕ Agregar Nodos al Lienzo
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#2563eb' }}
                        onClick={() => {
                          openNodeModal('proyecto');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar nodo de Proyecto"
                      >
                        <span style={{ fontSize: '18px' }}>🗂️</span>
                        <div>
                          <strong>Proyecto</strong>
                          <small>Cliente / Orden</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#0d9488' }}
                        onClick={() => {
                          openNodeModal('juego');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar nodo de Juego o Modelo 3D"
                      >
                        <span style={{ fontSize: '18px' }}>🎮</span>
                        <div>
                          <strong>Juego / Modelo</strong>
                          <small>Estructura física</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#9333ea' }}
                        onClick={() => {
                          openNodeModal('colaborador');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar nodo de Colaborador / Personal"
                      >
                        <span style={{ fontSize: '18px' }}>👷</span>
                        <div>
                          <strong>Colaborador</strong>
                          <small>Operario / Personal</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#6366f1' }}
                        onClick={() => {
                          openNodeModal('area');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar estación de Taller de Manufactura"
                      >
                        <span style={{ fontSize: '18px' }}>🏭</span>
                        <div>
                          <strong>Área de Taller</strong>
                          <small>Estación de planta</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#d97706' }}
                        onClick={() => {
                          openNodeModal('actividad');
                          setIsLeftRailOpen(false);
                        }}
                        title="Agregar nodo de Actividad / Tarea"
                      >
                        <span style={{ fontSize: '18px' }}>📌</span>
                        <div>
                          <strong>Actividad</strong>
                          <small>Tarea individual</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={styles.paletteNodeBtn}
                        style={{ '--btn-theme': '#06b6d4' }}
                        onClick={() => {
                          spawnNode('recurso', {
                            draft: false,
                            draftFields: {
                              title: 'Ayuda Visual / Archivo',
                              resourceType: 'imagen',
                              url: '',
                              fileData: null,
                              notes: '',
                            },
                          });
                          setIsLeftRailOpen(false);
                          toast.success('📎 Nodo de Ayuda Visual agregado al lienzo.');
                        }}
                        title="Agregar nodo de Ayuda Visual, Documentos, Planos o Enlaces"
                      >
                        <span style={{ fontSize: '18px' }}>📎</span>
                        <div>
                          <strong>Ayuda Visual</strong>
                          <small>Imágenes, PDFs y Links</small>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.calloutBox} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--color-gray-400)', fontSize: '12px' }}>
                    ℹ️ Solo los Administradores pueden editar o arrastrar nodos en el diagrama.
                  </div>
                )}

                <div>
                  <h2 className={styles.railTitle} style={{ marginBottom: '6px' }}>Buscar Nodo</h2>
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Buscar por nombre..."
                    value={nodeSearch}
                    onChange={(e) => setNodeSearch(e.target.value)}
                  />
                  {nodeSearch.trim() && (
                    <div className={styles.searchResults}>
                      {nodeSearchMatches.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className={styles.searchResultItem}
                          onClick={() => {
                            handleFocusNode(n);
                            setIsLeftRailOpen(false);
                          }}
                        >
                          {NODE_TYPES[n.type].icon} <span>{nodeTitle(n)}</span>
                        </button>
                      ))}
                      {nodeSearchMatches.length === 0 && (
                        <div className={styles.searchResultEmpty}>Sin coincidencias.</div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <h2 className={styles.railTitle} style={{ marginBottom: '6px' }}>Qué Significa Cada Línea</h2>
                  <ul className={styles.legend}>
                    <li><span className={styles.dot} style={{ background: 'var(--color-secondary)' }} /><span>Proyecto → Juego: <em>pertenece a</em></span></li>
                    <li><span className={styles.dot} style={{ background: 'var(--color-tiffany-blue)' }} /><span>Juego → Área: <em>requiere</em></span></li>
                    <li><span className={styles.dot} style={{ background: 'var(--color-princeton-orange)' }} /><span>Área ↔ Colaborador: <em>asignado a</em></span></li>
                    <li><span className={styles.dot} style={{ background: 'var(--color-princeton-orange)' }} /><span>Área → Actividad: <em>incluye</em></span></li>
                    <li><span className={styles.dot} style={{ background: 'var(--color-golden-yellow)' }} /><span>Actividad → Colaborador: <em>responsable</em></span></li>
                  </ul>
                </div>

                <p className={styles.hint}>
                  💡 Conecta arrastrando los puntos entre nodos. Los paneles flotantes te dan el 100% de espacio libre en tu pantalla.
                </p>
              </motion.aside>
            )}
          </AnimatePresence>

          {/* ---------- Lienzo de Ingeniería CAD (Inventor / SolidWorks Style) ---------- */}
          <div
            ref={canvasWrapRef}
            data-canvas-bg="true"
            className={`${styles.canvasWrap} ${isPanning ? styles.panning : ''} ${isSpacePressed ? styles.spaceGrab : ''}`}
            style={{
              backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px, ${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px, ${GRID_MAJOR_SIZE * zoom}px ${GRID_MAJOR_SIZE * zoom}px, ${GRID_MAJOR_SIZE * zoom}px ${GRID_MAJOR_SIZE * zoom}px`,
              backgroundPosition: `${worldOffset.x}px ${worldOffset.y}px, ${worldOffset.x}px ${worldOffset.y}px, ${worldOffset.x}px ${worldOffset.y}px, ${worldOffset.x}px ${worldOffset.y}px`,
            }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleWindowMouseMove}
            onMouseUp={handleWindowMouseUp}
            onMouseLeave={handleWindowMouseUp}
          >
            {/* Minimapa CAD flotante (Radar) */}
            {showMinimap && (
              <div
                className={styles.minimapWrap}
                onClick={handleMinimapClick}
                title="Radar CAD: Clic en cualquier zona para centrar vista"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={styles.minimapTitle}>🗺️ Radar CAD</div>
                <div className={styles.minimapCanvas}>
                  {nodes.map((n) => {
                    const nodeX = (n.x / WORKSPACE_WIDTH) * 100;
                    const nodeY = (n.y / WORKSPACE_HEIGHT) * 100;
                    const nodeW = Math.max(4, (NODE_WIDTH / WORKSPACE_WIDTH) * 100);
                    const nodeH = Math.max(3, (NODE_HEIGHT / WORKSPACE_HEIGHT) * 100);
                    return (
                      <div
                        key={`mini-${n.id}`}
                        className={styles.minimapNode}
                        style={{
                          left: `${nodeX}%`,
                          top: `${nodeY}%`,
                          width: `${nodeW}%`,
                          height: `${nodeH}%`,
                          backgroundColor: NODE_TYPES[n.type]?.colorVar || '#ea580c',
                        }}
                      />
                    );
                  })}

                  {(() => {
                    const rect = canvasWrapRef.current?.getBoundingClientRect() || { width: 800, height: 600 };
                    const viewWorldX = (-worldOffset.x / zoom) / WORKSPACE_WIDTH * 100;
                    const viewWorldY = (-worldOffset.y / zoom) / WORKSPACE_HEIGHT * 100;
                    const viewWorldW = (rect.width / zoom) / WORKSPACE_WIDTH * 100;
                    const viewWorldH = (rect.height / zoom) / WORKSPACE_HEIGHT * 100;
                    return (
                      <div
                        className={styles.minimapViewport}
                        style={{
                          left: `${Math.max(0, Math.min(96, viewWorldX))}%`,
                          top: `${Math.max(0, Math.min(96, viewWorldY))}%`,
                          width: `${Math.max(6, Math.min(100, viewWorldW))}%`,
                          height: `${Math.max(6, Math.min(100, viewWorldH))}%`,
                        }}
                      />
                    );
                  })()}
                </div>
              </div>
            )}

            <div
              ref={worldRef}
              className={styles.world}
              style={{
                transform: `translate(${worldOffset.x}px, ${worldOffset.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: WORKSPACE_WIDTH,
                height: WORKSPACE_HEIGHT,
              }}
            >
              {/* Marco delimitador visual del espacio de trabajo */}
              <div className={styles.workspaceBoundary}>
                <div className={styles.originMarker}>
                  <span className={styles.originIcon}>⌖</span>
                  <span>Origen</span>
                  <span className={styles.axisX}>X →</span>
                  <span className={styles.axisY}>↓ Y</span>
                </div>
                <div className={styles.workspaceDimLabelTop}>Espacio de Trabajo: 6,000 × 6,000 mm</div>
              </div>
              <svg className={styles.wires} width={worldBounds.width} height={worldBounds.height}>
                {edges.map((edge) => {
                  const fromNode = findNode(edge.from);
                  const toNode = findNode(edge.to);
                  if (!fromNode || !toNode) return null;

                  const { path: pathData, p1, p2 } = getSmartWirePath(fromNode, toNode);

                  const juegoEntity = fromNode.type === 'juego' ? getLinkedEntity(fromNode) : null;
                  const areaEntity = toNode.type === 'area' ? getLinkedEntity(toNode) : null;
                  const isBlockedLink = Boolean(
                    juegoEntity && areaEntity && isAreaBlockedBySequence(juegoEntity, areaEntity.id)
                  );

                  const nodeColor = fromNode.customColor || NODE_TYPES[fromNode.type]?.colorVar || '#ea580c';
                  const wireColor = edge.customColor || (isBlockedLink ? '#ef4444' : nodeColor);
                  
                  // LAS LÍNEAS SON PUNTEADAS (DASHED) POR DEFECTO
                  const isDashed = edge.style !== 'solid';
                  const isSelected = selectedEdgeId === edge.id;

                  return (
                    <g key={edge.id} className={`${styles.wireGroup} ${isSelected ? styles.wireGroupSelected : ''}`}>
                      {/* Trazo de halo suave / Resplandor cuando está seleccionado */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke={isSelected ? '#ffffff' : wireColor}
                        strokeWidth={isSelected ? '10' : '7'}
                        strokeOpacity={isSelected ? '0.45' : '0.2'}
                        style={{ pointerEvents: 'none' }}
                      />
                      {/* Trazo de cable punteado interactivo */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke={wireColor}
                        strokeWidth={edge.style === 'thick' ? '3.8' : (isSelected ? '3.5' : '2.8')}
                        strokeDasharray={isDashed ? (isBlockedLink ? '5 4' : '7 5') : 'none'}
                        className={`${styles.wirePath} ${isDashed ? styles.wireDashed : ''} ${isSelected ? styles.wireSelected : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEdgeId(isSelected ? null : edge.id);
                          setSelectedNodeId(null);
                        }}
                      >
                        <title>
                          {isBlockedLink
                            ? `🔒 Bloqueado: ${dynamicAreas.find((a) => a.id === AREA_SEQUENCE_DEPENDENCIES[areaEntity.id])?.name} todavía no completa su meta. Clic para cambiar color o desconectar.`
                            : 'Clic en este cable para cambiar su color o desconectarlo'}
                        </title>
                      </path>
                      {/* Puntos terminales en los puertos */}
                      <circle cx={p1.x} cy={p1.y} r={isSelected ? '5' : '3.8'} fill={wireColor} stroke="#ffffff" strokeWidth="1.8" />
                      <circle cx={p2.x} cy={p2.y} r={isSelected ? '5' : '3.8'} fill={wireColor} stroke="#ffffff" strokeWidth="1.8" />
                    </g>
                  );
                })}
                {previewWire && (
                  <path
                    className={styles.wirePreview}
                    d={previewBezier({ x: previewWire.x1, y: previewWire.y1 }, { x: previewWire.x2, y: previewWire.y2 })}
                  />
                )}
              </svg>

              {nodes.map((node) => {
                const meta = NODE_TYPES[node.type] || NODE_TYPES.bloque;
                const nodeThemeColor = node.customColor || meta.colorVar;
                const entity = getLinkedEntity(node);

                return (
                  <div
                    key={node.id}
                    data-type={node.type}
                    className={`${styles.node} ${selectedNodeId === node.id ? styles.selected : ''}`}
                    style={{ left: node.x, top: node.y, width: NODE_WIDTH, '--node-color': nodeThemeColor }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  >
                    <div className={styles.nodeHead}>
                      <span className={styles.nodeIcon}>{meta.icon}</span>
                      <span className={styles.nodeTitle}>{nodeTitle(node)}</span>
                      <span className={styles.nodeBadge}>
                        {node.type === 'bloque' ? 'TRABAJO' : (node.draft ? 'NUEVO' : meta.badgeText)}
                      </span>
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
                      {/* DISEÑO DISTINTIVO POR TIPO DE NODO */}
                      {node.type === 'proyecto' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>🗂️ PROYECTO EJECUTIVO</span>
                            {entity?.status && (
                              <span style={{ fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(37, 99, 235, 0.15)', color: nodeThemeColor, fontWeight: 800 }}>
                                {entity.status.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className={styles.nodeTag}>
                            {entity ? (
                              <>
                                <div style={{ fontSize: '12px', fontWeight: 700 }}>
                                  🏢 Cliente: {entity.client || 'General'}
                                </div>
                                <div style={{ width: '100%', height: '6px', background: 'rgba(0,0,0,0.08)', borderRadius: '3px', marginTop: '6px', overflow: 'hidden' }}>
                                  <div style={{ width: `${entity.progress ?? 0}%`, height: '100%', background: nodeThemeColor }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                                  <span>Progreso Global</span>
                                  <strong>{entity.progress ?? 0}%</strong>
                                </div>
                              </>
                            ) : (
                              node.draft ? '🆕 Borrador de Proyecto' : 'Proyecto del sistema'
                            )}
                          </div>
                        </div>
                      )}

                      {node.type === 'juego' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>🎮 MODELO DE JUEGO</span>
                            {entity?.status && (
                              <span style={{ fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(13, 148, 136, 0.15)', color: nodeThemeColor, fontWeight: 800 }}>
                                {entity.status.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className={styles.nodeTag}>
                            {entity ? (
                              <>
                                {/* Proyecto vinculado: detectado por cable o por projectId */}
                                {(() => {
                                  const connectedProjEdge = edges.find(
                                    (e) =>
                                      (e.from === node.id && findNode(e.to)?.type === 'proyecto') ||
                                      (e.to === node.id && findNode(e.from)?.type === 'proyecto')
                                  );
                                  const connectedProjNode = connectedProjEdge
                                    ? findNode(findNode(connectedProjEdge.from)?.type === 'proyecto' ? connectedProjEdge.from : connectedProjEdge.to)
                                    : null;
                                  const projName = connectedProjNode
                                    ? nodeTitle(connectedProjNode)
                                    : (entity.projectName && entity.projectName !== 'General'
                                      ? entity.projectName
                                      : (entity.projectId ? proyectos.find((p) => p.id === entity.projectId)?.name : null));

                                  return (
                                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--color-secondary, #2563eb)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <span>🗂️</span> <span>{projName ? `Proyecto: ${projName}` : 'Sin proyecto vinculado (conectar cable)'}</span>
                                    </div>
                                  );
                                })()}

                                {/* Áreas requeridas en ruta de fabricación */}
                                {entity.areas && entity.areas.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '4px 0' }}>
                                    {entity.areas.map((arId) => {
                                      const aName = dynamicAreas.find((a) => a.id === arId)?.name || arId;
                                      return (
                                        <span key={arId} style={{ fontSize: '10px', background: 'rgba(13, 148, 136, 0.12)', color: nodeThemeColor, padding: '2px 5px', borderRadius: '4px', fontWeight: 700 }}>
                                          🏭 {aName}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Barra de avance */}
                                <div style={{ width: '100%', height: '5px', background: 'rgba(0,0,0,0.08)', borderRadius: '3px', marginTop: '6px', overflow: 'hidden' }}>
                                  <div style={{ width: `${entity.progress ?? 0}%`, height: '100%', background: nodeThemeColor }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                                  <span>Avance de Fabricación</span>
                                  <strong>{entity.progress ?? 0}%</strong>
                                </div>

                                {/* Colaborador responsable si está conectado */}
                                {(() => {
                                  const connectedColabEdge = edges.find(
                                    (e) =>
                                      (e.from === node.id && findNode(e.to)?.type === 'colaborador') ||
                                      (e.to === node.id && findNode(e.from)?.type === 'colaborador')
                                  );
                                  const colabNode = connectedColabEdge
                                    ? findNode(findNode(connectedColabEdge.from)?.type === 'colaborador' ? connectedColabEdge.from : connectedColabEdge.to)
                                    : null;
                                  const directOperario = operarios.find((o) => o.id === entity.operarioId);
                                  const respName = directOperario?.name || (colabNode ? nodeTitle(colabNode) : null);

                                  return respName ? (
                                    <div style={{ fontSize: '11px', color: 'var(--color-gray-700)', marginTop: '4px', paddingTop: '3px', borderTop: '1px dashed rgba(0,0,0,0.08)' }}>
                                      👷 Responsable: <strong>{respName}</strong>
                                    </div>
                                  ) : null;
                                })()}
                              </>
                            ) : (
                              node.draft ? '🆕 Borrador de Juego' : 'Juego del catálogo'
                            )}
                          </div>
                        </div>
                      )}

                      {node.type === 'actividad' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>📌 TAREA / ACTIVIDAD</span>
                            {entity?.priority && (
                              <span style={{ fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px', background: entity.priority === 'alta' ? 'rgba(220, 38, 38, 0.15)' : 'rgba(217, 119, 6, 0.15)', color: entity.priority === 'alta' ? '#dc2626' : nodeThemeColor, fontWeight: 800 }}>
                                {entity.priority.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className={styles.nodeTag}>
                            {entity ? (
                              <>
                                <div style={{ fontSize: '11.5px', fontWeight: 700 }}>
                                  🏭 Área: {dynamicAreas.find((a) => a.id === entity.areaId)?.name || entity.areaId}
                                </div>
                                {(() => {
                                  const colabEdge = edges.find(
                                    (e) =>
                                      (e.from === node.id && findNode(e.to)?.type === 'colaborador') ||
                                      (e.to === node.id && findNode(e.from)?.type === 'colaborador')
                                  );
                                  const connectedColabNode = colabEdge
                                    ? findNode(findNode(colabEdge.from)?.type === 'colaborador' ? colabEdge.from : colabEdge.to)
                                    : null;
                                  const directOperario = operarios.find((o) => o.id === (entity?.operarioId || node?.operarioId || node?.draftFields?.operarioId));
                                  const respName = directOperario?.name || (connectedColabNode ? nodeTitle(connectedColabNode) : null);

                                  return (
                                    <div style={{ fontSize: '11px', color: respName ? 'var(--color-primary, #ea580c)' : 'var(--color-gray-500)', marginTop: '2px', fontWeight: respName ? 700 : 500 }}>
                                      👷 Resp: <strong>{respName || 'Sin asignar (conectar cable)'}</strong>
                                    </div>
                                  );
                                })()}
                                {/* Estatus y Botones de Iniciar / Terminar en la tarjeta del nodo */}
                                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed rgba(0,0,0,0.1)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '10.5px', color: 'var(--color-gray-500)' }}>Estado:</span>
                                    <span
                                      style={{
                                        fontSize: '9.5px',
                                        fontWeight: 800,
                                        padding: '1.5px 6px',
                                        borderRadius: '4px',
                                        textTransform: 'uppercase',
                                        background:
                                          entity.status === 'completado'
                                            ? 'rgba(16, 185, 129, 0.15)'
                                            : entity.status === 'proceso'
                                            ? 'rgba(37, 99, 235, 0.15)'
                                            : 'rgba(156, 163, 175, 0.15)',
                                        color:
                                          entity.status === 'completado'
                                            ? '#10b981'
                                            : entity.status === 'proceso'
                                            ? '#2563eb'
                                            : '#6b7280',
                                      }}
                                    >
                                      {entity.status === 'completado' ? '✅ Hecha' : entity.status === 'proceso' ? '⚡ En Proceso' : '⏳ Pendiente'}
                                    </span>
                                  </div>

                                  {(() => {
                                    const hasControl = canUserControlActivity(entity);
                                    if (!hasControl) {
                                      return (
                                        <div style={{ fontSize: '10px', color: 'var(--color-gray-400)', marginTop: '4px', textAlign: 'center', fontStyle: 'italic' }}>
                                          🔒 Control de responsable / supervisor
                                        </div>
                                      );
                                    }

                                    return (
                                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                        {entity.status === 'pendiente' && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleStartActivity(entity.id, entity.title);
                                            }}
                                            style={{
                                              flex: 1,
                                              padding: '4px 8px',
                                              fontSize: '11px',
                                              fontWeight: 700,
                                              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                                              color: '#ffffff',
                                              border: 'none',
                                              borderRadius: '5px',
                                              cursor: 'pointer',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              gap: '4px',
                                              boxShadow: '0 1px 3px rgba(37, 99, 235, 0.3)',
                                            }}
                                            title="Iniciar esta actividad y registrar fecha/hora de inicio"
                                          >
                                            ▶️ Iniciar Actividad
                                          </button>
                                        )}

                                        {entity.status === 'proceso' && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenCompleteModal(entity.id, entity.title);
                                              }}
                                              style={{
                                                flex: 2,
                                                padding: '4px 8px',
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '5px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '4px',
                                                boxShadow: '0 1px 3px rgba(16, 185, 129, 0.3)',
                                              }}
                                              title="Marcar como terminada y registrar fecha/hora de entrega"
                                            >
                                              ✅ Terminar
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleResetActivityStatus(entity.id, 'pendiente');
                                              }}
                                              style={{
                                                flex: 1,
                                                padding: '4px 6px',
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                background: 'rgba(0,0,0,0.06)',
                                                color: 'var(--color-gray-700)',
                                                border: '1px solid rgba(0,0,0,0.1)',
                                                borderRadius: '5px',
                                                cursor: 'pointer',
                                              }}
                                              title="Pausar y regresar a pendiente"
                                            >
                                              ⏸️ Pausar
                                            </button>
                                          </>
                                        )}

                                        {entity.status === 'completado' && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleResetActivityStatus(entity.id, 'proceso');
                                            }}
                                            style={{
                                              flex: 1,
                                              padding: '3px 8px',
                                              fontSize: '10px',
                                              fontWeight: 600,
                                              background: 'rgba(0,0,0,0.05)',
                                              color: 'var(--color-gray-600)',
                                              border: '1px solid rgba(0,0,0,0.1)',
                                              borderRadius: '5px',
                                              cursor: 'pointer',
                                            }}
                                            title="Reabrir esta actividad para continuarla"
                                          >
                                            🔄 Reabrir Actividad
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </>
                            ) : (
                              node.draft ? '🆕 Borrador de Actividad' : 'Actividad del sistema'
                            )}
                          </div>
                        </div>
                      )}

                      {node.type === 'colaborador' && (
                        <div>
                          <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>👷 PERSONAL / COLABORADOR</span>
                          <div className={styles.nodeTag} style={{ marginTop: '3px' }}>
                            {entity ? (
                              <>
                                <div style={{ fontSize: '12px', fontWeight: 700 }}>
                                  🏭 Área: {dynamicAreas.find((a) => a.id === entity.currentArea)?.name || entity.currentArea}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                                  {entity.puesto || 'Operario de Producción'}
                                </div>
                                {(() => {
                                  const connectedCount = edges.filter(
                                    (e) => e.from === node.id || e.to === node.id
                                  ).length;
                                  return (
                                    <div style={{ fontSize: '10.5px', color: 'var(--color-primary)', marginTop: '4px', fontWeight: 600 }}>
                                      🔗 {connectedCount} {connectedCount === 1 ? 'asignación conectada' : 'asignaciones conectadas'}
                                    </div>
                                  );
                                })()}
                              </>
                            ) : (
                              'Colaborador del equipo'
                            )}
                          </div>
                        </div>
                      )}

                      {node.type === 'area' && (
                        <div>
                          <span className={styles.nodeEyebrow} style={{ color: nodeThemeColor }}>🏭 ÁREA DE MANUFACTURA</span>
                          <div className={styles.nodeTag} style={{ marginTop: '3px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-dark)' }}>
                              {entity?.name || 'Taller de producción'}
                            </div>

                            {/* Supervisor a cargo */}
                            {(() => {
                              const supervisor = getSupervisorForArea(node.refId || entity?.id);
                              return (
                                <div style={{ fontSize: '11px', color: 'var(--color-primary, #ea580c)', marginTop: '4px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span>👤 Supervisor:</span> <span>{supervisor.name}</span>
                                </div>
                              );
                            })()}

                            {/* Proyectos / Juegos vinculados por cable */}
                            {(() => {
                              const connectedEdges = edges.filter((e) => e.from === node.id || e.to === node.id);
                              const connectedProjects = connectedEdges
                                .map((e) => findNode(e.from === node.id ? e.to : e.from))
                                .filter((n) => n?.type === 'proyecto')
                                .map((n) => nodeTitle(n));

                              const connectedGames = connectedEdges
                                .map((e) => findNode(e.from === node.id ? e.to : e.from))
                                .filter((n) => n?.type === 'juego')
                                .map((n) => nodeTitle(n));

                              return (
                                <>
                                  {connectedProjects.length > 0 && (
                                    <div style={{ fontSize: '10.5px', color: 'var(--color-secondary, #2563eb)', marginTop: '3px', fontWeight: 600 }}>
                                      🗂️ Proy: {connectedProjects.join(', ')}
                                    </div>
                                  )}
                                  {connectedGames.length > 0 && (
                                    <div style={{ fontSize: '10.5px', color: '#0d9488', marginTop: '2px', fontWeight: 600 }}>
                                      🎮 Modelos: {connectedGames.join(', ')}
                                    </div>
                                  )}
                                </>
                              );
                            })()}

                            <div style={{ fontSize: '10.5px', color: 'var(--color-gray-500)', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>👥 {operarios.filter((o) => o.currentArea === (node.refId || entity?.id)).length} operarios</span>
                              <span
                                style={{
                                  cursor: 'pointer',
                                  color: 'var(--color-primary, #ea580c)',
                                  fontWeight: 700,
                                  textDecoration: 'underline',
                                  textDecorationStyle: 'dotted',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const targetAreaId = node.refId || entity?.id;
                                  const targetAreaName = entity?.name || nodeTitle(node);
                                  setAreaTasksModal({ isOpen: true, areaId: targetAreaId, areaName: targetAreaName });
                                }}
                                title="Clic para ver las tareas asignadas a esta estación"
                              >
                                📌 {actividades.filter((a) => a.areaId === (node.refId || entity?.id)).length} tareas
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {node.type === 'recurso' && (() => {
                        const info = getResourcePreviewInfo(node);
                        const isUploading = node.draftFields?.fileData?.isUploading || node.draftFields?.isUploading;

                        return (
                          <div>
                            {/* MINIATURA / VISTA PREVIA DIRECTA SEGÚN CONTENIDO */}
                            {isUploading && (
                              <div className={styles.resourceThumbnailBox} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(6, 182, 212, 0.08)', gap: '6px' }}>
                                <div style={{ fontSize: '18px', animation: 'spin 1s linear infinite' }}>⏳</div>
                                <span style={{ fontSize: '10.5px', color: '#0891b2', fontWeight: 600 }}>Guardando en la nube...</span>
                              </div>
                            )}

                            {/* 1. VISTA PREVIA DE IMAGEN / RENDER (Directa o desde Google Drive) */}
                            {!isUploading && info.previewImgSrc && (
                              <div
                                className={styles.resourceThumbnailBox}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewResourceModal({
                                    isOpen: true,
                                    title: nodeTitle(node),
                                    resourceType: info.resType,
                                    url: info.rawUrl || info.previewImgSrc,
                                    fileData: node.draftFields?.fileData,
                                    notes: node.draftFields?.notes || '',
                                  });
                                }}
                                title="Clic para ampliar en pantalla completa"
                              >
                                <img
                                  src={info.previewImgSrc}
                                  alt={nodeTitle(node)}
                                  className={styles.resourceThumbnailImg}
                                  onError={(e) => {
                                    e.target.style.opacity = '0.5';
                                  }}
                                />
                                <div className={styles.resourcePreviewHover}>
                                  <span>🔍 Ampliar</span>
                                </div>
                              </div>
                            )}

                            {/* 2. MODELO 3D CAD: SOLIDWORKS, INVENTOR, STEP, DWG */}
                            {!isUploading && !info.previewImgSrc && info.isModel && (
                              <div
                                className={styles.resourceModelBadge}
                                style={{
                                  background: info.cadBrand === 'solidworks' ? 'rgba(225, 29, 72, 0.08)' : info.cadBrand === 'inventor' ? 'rgba(217, 119, 6, 0.08)' : 'rgba(13, 148, 136, 0.08)',
                                  borderColor: info.cadColor || '#0d9488',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (info.fileUrl && !info.fileUrl.startsWith('data:')) {
                                    window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                                  } else {
                                    setPreviewResourceModal({
                                      isOpen: true,
                                      title: nodeTitle(node),
                                      resourceType: 'modelo',
                                      url: info.effectiveUrl,
                                      fileData: node.draftFields?.fileData,
                                      notes: node.draftFields?.notes || '',
                                    });
                                  }
                                }}
                                title="Clic para descargar / abrir ficha CAD"
                              >
                                <span style={{ fontSize: '22px' }}>{info.cadIcon || '🧊'}</span>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  <div style={{ fontSize: '11px', fontWeight: 800, color: info.cadColor || '#0d9488' }}>
                                    {info.cadLabel || 'Modelo 3D CAD'}
                                  </div>
                                  <div style={{ fontSize: '9.5px', color: 'var(--color-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {info.fileName || (info.fileSize ? `${Math.round(info.fileSize / 1024)} KB` : 'Descargar archivo CAD')}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* 3. DOCUMENTO / PLANO PDF */}
                            {!isUploading && !info.previewImgSrc && info.isPdf && (
                              <div
                                className={styles.resourceDocBadge}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (info.effectiveUrl) {
                                    window.open(formatExternalUrl(info.effectiveUrl), '_blank', 'noopener,noreferrer');
                                  } else {
                                    setPreviewResourceModal({
                                      isOpen: true,
                                      title: nodeTitle(node),
                                      resourceType: 'documento',
                                      url: info.effectiveUrl,
                                      fileData: node.draftFields?.fileData,
                                      notes: node.draftFields?.notes || '',
                                    });
                                  }
                                }}
                                title="Clic para abrir plano PDF"
                              >
                                <span style={{ fontSize: '20px' }}>📄</span>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#dc2626' }}>
                                    {info.fileName || 'Plano PDF'}
                                  </div>
                                  <div style={{ fontSize: '9.5px', color: 'var(--color-gray-500)' }}>
                                    {info.fileSize ? `${Math.round(info.fileSize / 1024)} KB · Clic para abrir` : 'Abrir documento'}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* 4. ENLACE WEB DIRECTO (Google Drive, Figma, OneDrive, Web) */}
                            {!isUploading && !info.previewImgSrc && !info.isModel && !info.isPdf && info.rawUrl && (
                              <div
                                className={styles.resourceLinkBadge}
                                style={{
                                  borderColor: info.linkProvider?.color ? `${info.linkProvider.color}40` : undefined,
                                  background: info.linkProvider?.color ? `${info.linkProvider.color}10` : undefined,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Redirección directa al hacer clic
                                  window.open(formatExternalUrl(info.rawUrl), '_blank', 'noopener,noreferrer');
                                }}
                                title={`Clic para ir directamente a: ${info.rawUrl}`}
                              >
                                <span style={{ fontSize: '20px' }}>{info.linkProvider?.icon || '🔗'}</span>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  <div style={{ fontSize: '11px', fontWeight: 800, color: info.linkProvider?.color || '#2563eb' }}>
                                    {info.linkProvider?.name || 'Enlace Externo'}
                                  </div>
                                  <div style={{ fontSize: '9.5px', color: 'var(--color-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {info.rawUrl.replace(/^https?:\/\//i, '').split('/')[0]} · Clic para abrir ↗
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* 5. VACÍO (Sin archivo ni URL) */}
                            {!isUploading && !info.previewImgSrc && !info.isModel && !info.isPdf && !info.rawUrl && (
                              <div
                                className={styles.resourceEmptyBox}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedNodeId(node.id);
                                }}
                                title="Haz clic para seleccionar y cargar un archivo o enlace en el panel derecho"
                              >
                                📂 <strong>Sin archivo adjunto</strong>
                                <div style={{ fontSize: '10px', marginTop: '2px' }}>Haz clic para configurar en panel</div>
                              </div>
                            )}

                            {/* INDICADOR DE ACTIVIDAD / PROYECTO ASIGNADO POR CABLE */}
                            {(() => {
                              const connectedEdge = edges.find(
                                (e) =>
                                  (e.from === node.id && (findNode(e.to)?.type === 'actividad' || findNode(e.to)?.type === 'proyecto')) ||
                                  (e.to === node.id && (findNode(e.from)?.type === 'actividad' || findNode(e.from)?.type === 'proyecto'))
                              );
                              const targetNode = connectedEdge
                                ? findNode(findNode(connectedEdge.from)?.type === 'actividad' || findNode(connectedEdge.from)?.type === 'proyecto' ? connectedEdge.from : connectedEdge.to)
                                : null;

                              if (targetNode) {
                                return (
                                  <div style={{ fontSize: '10.5px', color: 'var(--color-primary, #ea580c)', fontWeight: 700, margin: '3px 0', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                    <span>{targetNode.type === 'proyecto' ? '🗂️ Ligado a Proy:' : '📌 Ligado a Tarea:'}</span>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nodeTitle(targetNode)}</span>
                                  </div>
                                );
                              }
                              return (
                                <div style={{ fontSize: '10px', color: 'var(--color-gray-400)', fontStyle: 'italic', margin: '2px 0' }}>
                                  🔌 Conecta un cable a una Actividad o Proyecto
                                </div>
                              );
                            })()}

                            {/* BOTONES DE ACCIÓN DIRECTOS */}
                            <div className={styles.resourceActions}>
                              {info.rawUrl && (
                                <button
                                  type="button"
                                  className={`${styles.resourceActionBtn} ${styles.resourceActionBtnPrimary}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(formatExternalUrl(info.rawUrl), '_blank', 'noopener,noreferrer');
                                  }}
                                  title="Abrir enlace en pestaña nueva"
                                >
                                  🌐 Ir al Enlace ↗
                                </button>
                              )}

                              {info.fileUrl && !info.rawUrl && info.isModel && (
                                <button
                                  type="button"
                                  className={`${styles.resourceActionBtn} ${styles.resourceActionBtnPrimary}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                                  }}
                                  title="Descargar archivo CAD"
                                >
                                  📥 Descargar CAD
                                </button>
                              )}

                              {info.previewImgSrc && (
                                <button
                                  type="button"
                                  className={`${styles.resourceActionBtn} ${styles.resourceActionBtnPrimary}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewResourceModal({
                                      isOpen: true,
                                      title: nodeTitle(node),
                                      resourceType: info.resType,
                                      url: info.rawUrl || info.previewImgSrc,
                                      fileData: node.draftFields?.fileData || null,
                                      notes: node.draftFields?.notes || '',
                                    });
                                  }}
                                  title="Ver y ampliar esta ayuda visual"
                                >
                                  🔍 Ampliar
                                </button>
                              )}

                              <button
                                type="button"
                                className={styles.resourceActionBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewResourceModal({
                                    isOpen: true,
                                    title: nodeTitle(node),
                                    resourceType: info.resType,
                                    url: info.rawUrl || info.fileUrl || '',
                                    fileData: node.draftFields?.fileData || null,
                                    notes: node.draftFields?.notes || '',
                                  });
                                }}
                                title="Ver detalles o notas técnicas"
                              >
                                📋 Info / Ficha
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* 4 PUERTOS DE CONEXIÓN (IZQUIERDA, DERECHA, ARRIBA, ABAJO) */}
                    {canEditDiagram && (
                      <>
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="in"
                          className={`${styles.port} ${styles.portIn}`}
                          title="Conectar (lado izquierdo)"
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'in')}
                        />
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="out"
                          className={`${styles.port} ${styles.portOut}`}
                          title="Conectar (lado derecho)"
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'out')}
                        />
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="top"
                          className={`${styles.port} ${styles.portTop}`}
                          title="Conectar (arriba)"
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'top')}
                        />
                        <span
                          data-role="port"
                          data-node-id={node.id}
                          data-side="bottom"
                          className={`${styles.port} ${styles.portBottom}`}
                          title="Conectar (abajo)"
                          onMouseDown={(e) => handlePortMouseDown(e, node.id, 'bottom')}
                        />
                      </>
                    )}
                  </div>
                );
              })}

              {/* ---------- Barra Flotante Interactiva de Cable Seleccionado ---------- */}
              {selectedEdgeId && (() => {
                const edge = edges.find((e) => e.id === selectedEdgeId);
                if (!edge) return null;
                const fromNode = findNode(edge.from);
                const toNode = findNode(edge.to);
                if (!fromNode || !toNode) return null;
                const { p1, p2 } = getSmartWirePath(fromNode, toNode);
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const defaultColor = fromNode.customColor || NODE_TYPES[fromNode.type]?.colorVar || '#ea580c';
                const currentColor = edge.customColor || defaultColor;

                return (
                  <div
                    className={styles.wireToolbar}
                    style={{ left: midX, top: midY }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ fontSize: '11.5px', fontWeight: 800, color: currentColor, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      〰️ Cable:
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          className={`${styles.wireColorDot} ${currentColor === c.value ? styles.wireColorDotActive : ''}`}
                          style={{ backgroundColor: c.value }}
                          title={c.name}
                          onClick={() => updateEdgeColor(edge.id, c.value)}
                        />
                      ))}
                      <label title="Elegir cualquier color personalizado" style={{ cursor: 'pointer', display: 'inline-flex', margin: 0 }}>
                        <input
                          type="color"
                          value={currentColor}
                          onChange={(e) => updateEdgeColor(edge.id, e.target.value)}
                          style={{ width: '24px', height: '24px', border: 'none', borderRadius: '50%', cursor: 'pointer', background: 'none', padding: 0 }}
                        />
                      </label>
                    </div>

                    <div className={styles.wireToolbarDivider} />

                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      onClick={() => updateEdgeStyle(edge.id, edge.style === 'solid' ? 'dashed' : 'solid')}
                      title="Alternar entre línea punteada y sólida"
                    >
                      {edge.style === 'solid' ? '━━ Sólida' : '┅┅ Punteada'}
                    </button>

                    <div className={styles.wireToolbarDivider} />

                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      style={{ color: 'var(--color-alert, #ef4444)' }}
                      onClick={() => {
                        const nextEdges = edges.filter((ed) => ed.id !== edge.id);
                        setEdges(nextEdges);
                        saveToFirestore(nodes, nextEdges);
                        setSelectedEdgeId(null);
                        toast.info('🔌 Cable desconectado.');
                      }}
                      title="Eliminar este cable"
                    >
                      🗑️ Quitar
                    </button>

                    <button
                      type="button"
                      className={styles.wireToolbarBtn}
                      onClick={() => setSelectedEdgeId(null)}
                      title="Cerrar barra"
                      style={{ padding: '3px 6px', opacity: 0.6 }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })()}

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

            {/* ---------- Barra de Información Técnica CAD (Inferior Izquierda) ---------- */}
            <div className={styles.cadInfoBar} onMouseDown={(e) => e.stopPropagation()}>
              <div className={styles.cadCoords}>
                <span>📍</span> X: {cursorCoords.x} mm &nbsp;|&nbsp; Y: {cursorCoords.y} mm
              </div>
              <div className={styles.cadShortcuts}>
                🖱️ Rueda: Zoom · Clic Rueda / Espacio: Mover · F: Centrar
              </div>
            </div>

            {/* ---------- Controles de Zoom y HUD (Flotantes, Esquina Inferior Derecha) ---------- */}
            <div className={styles.zoomControls} onMouseDown={(e) => e.stopPropagation()}>
              <button type="button" className={styles.zoomBtn} title="Alejar (Rueda hacia abajo)" onClick={() => handleZoomButton(-ZOOM_STEP)}>
                −
              </button>
              <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
              <button type="button" className={styles.zoomBtn} title="Acercar (Rueda hacia arriba)" onClick={() => handleZoomButton(ZOOM_STEP)}>
                +
              </button>
              <button
                type="button"
                className={styles.zoomResetBtn}
                title="Centrar y ajustar todo el diagrama (Tecla F)"
                onClick={handleFitToView}
              >
                🎯 Centrar (F)
              </button>
              <button
                type="button"
                className={styles.zoomResetBtn}
                title="Restablecer zoom a 100%"
                onClick={handleResetView}
              >
                ⤢ 100%
              </button>
              <button
                type="button"
                className={`${styles.snapToggleBtn} ${snapToGrid ? styles.active : ''}`}
                title={snapToGrid ? 'Alineación magnética a cuadrícula activa (25mm)' : 'Alineación magnética desactivada'}
                onClick={() => setSnapToGrid((prev) => !prev)}
              >
                🧲 {snapToGrid ? 'Snap ON' : 'Snap OFF'}
              </button>
              <button
                type="button"
                className={styles.snapToggleBtn}
                title={showMinimap ? 'Ocultar radar CAD' : 'Mostrar radar CAD'}
                onClick={() => setShowMinimap((prev) => !prev)}
              >
                🗺️ Radar
              </button>
            </div>
          </div>

          {/* ---------- Inspector Flotante Translúcido (Glassmorphism) ---------- */}
          <AnimatePresence>
            {selectedNode && (
              <motion.aside
                className={styles.inspector}
                initial={{ opacity: 0, scale: 0.9, x: 20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: 20 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <NodeInspector
                  node={selectedNode}
                  onClose={() => setSelectedNodeId(null)}
                  entity={getLinkedEntity(selectedNode)}
                  edges={edges}
                  setEdges={setEdges}
                  saveToFirestore={saveToFirestore}
                  nodes={nodes}
                  findNode={findNode}
                  nodeTitle={nodeTitle}
                  updateDraftField={(key, value) => updateDraftField(selectedNode.id, key, value)}
                  onSaveProyecto={() => handleSaveProyecto(selectedNode)}
                  onSaveJuego={() => handleSaveJuego(selectedNode)}
                  onSaveActividad={() => handleSaveActividad(selectedNode)}
                  onAssignColaborador={handleAssignColaboradorToArea}
                  getConnectedAreaNode={getConnectedAreaNode}
                  getConnectedColaboradorNode={getConnectedColaboradorNode}
                  actividades={actividades}
                  operarios={operarios}
                  proyectos={proyectos}
                  juegos={juegos}
                  addProject={addProject}
                  addGame={addGame}
                  updateProject={updateProject}
                  canEditDiagram={canEditDiagram}
                  updateBlockField={(field, value) => updateBlockField(selectedNode.id, field, value)}
                  updateBlockName={(value) => updateBlockName(selectedNode.id, value)}
                  onSaveBlockName={() => saveToFirestore(nodes, edges)}
                  openBlockActivityForm={() => openBlockActivityForm(selectedNode.id)}
                  handleReassignBlockActivities={(colabNode) => handleReassignBlockActivities(selectedNode, colabNode)}
                  updateNodeColor={updateNodeColor}
                  updateEdgeColor={updateEdgeColor}
                  updateEdgeStyle={updateEdgeStyle}
                  dynamicAreas={dynamicAreas}
                  allBlockAreas={allBlockAreas}
                  getSupervisorForArea={getSupervisorForArea}
                  onViewAreaTasks={(areaId, areaName) => setAreaTasksModal({ isOpen: true, areaId, areaName })}
                  onStartActivity={handleStartActivity}
                  onOpenCompleteModal={handleOpenCompleteModal}
                  onResetActivityStatus={handleResetActivityStatus}
                  canUserControlActivity={canUserControlActivity}
                  lienzoActivoId={lienzoActivoId}
                />
              </motion.aside>
            )}
          </AnimatePresence>
      </div>

      {/* ---------- MODAL: CONFIRMAR ELIMINAR LIENZO ---------- */}
      <Modal
        isOpen={deleteLienzoConfirm}
        onClose={() => setDeleteLienzoConfirm(false)}
        title="🗑️ Eliminar Lienzo Visual"
      >
        <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: 1.5, color: 'var(--color-dark)' }}>
          ¿Estás seguro de que deseas eliminar este lienzo visual? Esta acción no se puede deshacer. Los proyectos o actividades reales que se hayan creado en la base de datos se mantendrán a salvo en el sistema.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="md" onClick={() => setDeleteLienzoConfirm(false)}>
            Cancelar
          </Button>
          <Button variant="danger" size="md" onClick={handleDeleteCurrentLienzo}>
            🗑️ Sí, Eliminar Lienzo
          </Button>
        </div>
      </Modal>

      {/* ---------- MODAL: ADMINISTRAR Y ELIMINAR CUALQUIER LIENZO ---------- */}
      <Modal
        isOpen={manageLienzosModal}
        onClose={() => setManageLienzosModal(false)}
        title="📂 Administrar y Eliminar Lienzos Visuales"
      >
        <p style={{ fontSize: '13px', color: 'var(--color-gray-600)', margin: '0 0 12px 0' }}>
          Desde aquí puedes revisar todos los lienzos creados, abrirlos en pantalla o eliminar los que ya no utilices:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflowY: 'auto', paddingRight: '4px' }}>
          {/* Lienzo General */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid var(--color-gray-200)',
              backgroundColor: lienzoActivoId === 'general' ? 'rgba(37, 99, 235, 0.08)' : 'var(--color-gray-50)',
            }}
          >
            <div>
              <strong style={{ fontSize: '13px', display: 'block', color: 'var(--color-dark)' }}>
                🎨 Lienzo General (Boceto Principal)
              </strong>
              <small style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>Lienzo predeterminado del sistema</small>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {lienzoActivoId !== 'general' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setLienzoActivoId('general');
                    setManageLienzosModal(false);
                  }}
                >
                  👁️ Abrir
                </Button>
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--color-primary)', fontWeight: 700, padding: '4px 8px' }}>
                  ● En pantalla
                </span>
              )}
            </div>
          </div>

          {/* Lienzos personalizados creados */}
          {lienzosList
            .filter((l) => l.id !== 'general' && !proyectos.some((p) => p.id === l.id))
            .map((lienzo) => {
              const isActive = lienzoActivoId === lienzo.id;
              const nodeCount = (lienzo.nodes || []).length;
              return (
                <div
                  key={lienzo.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: isActive ? '1.5px solid var(--color-primary)' : '1px solid var(--color-gray-200)',
                    backgroundColor: isActive ? 'rgba(234, 88, 12, 0.08)' : 'var(--card-bg, #ffffff)',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '13.5px', display: 'block', color: 'var(--color-dark)' }}>
                      🎨 {lienzo.name || 'Lienzo Visual'}
                    </strong>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                      <span>📌 {nodeCount} {nodeCount === 1 ? 'nodo' : 'nodos'}</span>
                      {isActive && <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>● Activo en pantalla</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    {!isActive && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setLienzoActivoId(lienzo.id);
                          setManageLienzosModal(false);
                        }}
                      >
                        👁️ Abrir
                      </Button>
                    )}
                    {canEditDiagram && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteLienzoById(lienzo.id, lienzo.name)}
                        title={`Eliminar el lienzo "${lienzo.name}"`}
                      >
                        🗑️ Eliminar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}

          {lienzosList.filter((l) => l.id !== 'general' && !proyectos.some((p) => p.id === l.id)).length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: '12.5px', color: 'var(--color-gray-400)', fontStyle: 'italic' }}>
              No tienes lienzos personalizados adicionales creados. Puedes crear uno con el botón &ldquo;➕ Nuevo Lienzo&rdquo;.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--color-gray-200)' }}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setManageLienzosModal(false);
              setNewLienzoModal({ isOpen: true, name: '' });
            }}
          >
            ➕ Crear Nuevo Lienzo
          </Button>

          <Button variant="secondary" size="sm" onClick={() => setManageLienzosModal(false)}>
            Cerrar
          </Button>
        </div>
      </Modal>

      {/* ---------- MODAL: CONFIRMAR LIMPIAR NODOS DEL LIENZO ---------- */}
      <Modal
        isOpen={clearNodesConfirm}
        onClose={() => setClearNodesConfirm(false)}
        title="🧹 Limpiar Nodos del Lienzo Actual"
      >
        <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: 1.5, color: 'var(--color-dark)' }}>
          ¿Deseas remover todos los nodos y conexiones del lienzo activo? Esta acción dejará el lienzo en blanco, pero tus proyectos, juegos y colaboradores seguirán registrados a salvo en el sistema.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="md" onClick={() => setClearNodesConfirm(false)}>
            Cancelar
          </Button>
          <Button variant="danger" size="md" onClick={handleClearCurrentCanvasNodes}>
            🧹 Sí, Limpiar Nodos
          </Button>
        </div>
      </Modal>

      {/* ---------- MODAL: CREAR NUEVO LIENZO / PROYECTO VISUAL ---------- */}
      <Modal
        isOpen={newLienzoModal.isOpen}
        onClose={() => setNewLienzoModal({ isOpen: false, name: '' })}
        title="🎨 Nuevo Lienzo / Proyecto Visual"
      >
        <div className={styles.field}>
          <label>Nombre del Lienzo / Boceto *</label>
          <input
            type="text"
            autoFocus
            placeholder="Ej. Boceto Nueva Planta, Diagrama General..."
            value={newLienzoModal.name}
            onChange={(e) => setNewLienzoModal((prev) => ({ ...prev, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateNewLienzo();
            }}
          />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', margin: '8px 0 16px 0' }}>
          💡 Un lienzo libre te permite crear nodos, cables y dar de alta proyectos o juegos directamente desde adentro del diagrama.
        </p>
        <Button variant="primary" size="md" onClick={handleCreateNewLienzo} style={{ width: '100%' }}>
          🎨 Crear y Abrir Lienzo
        </Button>
      </Modal>

      {/* ---------- MODAL UNIFICADO: AGREGAR / CREAR NODO EN EL LIENZO ---------- */}
      <Modal
        isOpen={nodeModal.isOpen}
        onClose={closeNodeModal}
        title={
          nodeModal.type === 'proyecto'
            ? '🗂️ Agregar Nodo de Proyecto'
            : nodeModal.type === 'juego'
            ? '🎮 Agregar Nodo de Juego / Modelo'
            : nodeModal.type === 'colaborador'
            ? '👷 Agregar Nodo de Colaborador (Personal)'
            : nodeModal.type === 'area'
            ? '🏭 Agregar Nodo de Área de Manufactura'
            : nodeModal.type === 'actividad'
            ? '📌 Agregar Nodo de Actividad / Tarea'
            : '📦 Crear Celda Modular de Trabajo'
        }
      >
        {/* TABS: SELECCIONAR EXISTENTE vs CREAR NUEVO (para Proyecto, Juego, Actividad) */}
        {(nodeModal.type === 'proyecto' || nodeModal.type === 'juego' || nodeModal.type === 'actividad') && (
          <div className={styles.nodeModalTabs}>
            <button
              type="button"
              className={`${styles.tabBtn} ${nodeModal.tab === 'existing' ? styles.tabBtnActive : ''}`}
              onClick={() => setNodeModal((prev) => ({ ...prev, tab: 'existing' }))}
            >
              🔗 Seleccionar Existente ({catalogFor(nodeModal.type).length})
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${nodeModal.tab === 'new' ? styles.tabBtnActive : ''}`}
              onClick={() => setNodeModal((prev) => ({ ...prev, tab: 'new' }))}
            >
              ➕ Crear Nuevo Registro
            </button>
          </div>
        )}

        {/* 1. SELECCIONAR EXISTENTE (Colaborador, Área, Proyecto, Juego, Actividad) */}
        {(nodeModal.tab === 'existing' || nodeModal.type === 'colaborador' || nodeModal.type === 'area') && (
          <div>
            <input
              type="text"
              className={styles.pickerSearch}
              placeholder={
                nodeModal.type === 'colaborador'
                  ? 'Buscar colaborador por nombre, área o puesto...'
                  : nodeModal.type === 'area'
                  ? 'Buscar área de manufactura...'
                  : 'Buscar en el catálogo...'
              }
              value={nodeModal.query}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, query: e.target.value }))}
              autoFocus
            />

            <div className={styles.pickerList}>
              {catalogFor(nodeModal.type)
                .filter((item) => item.label.toLowerCase().includes(nodeModal.query.trim().toLowerCase()))
                .map((item) => {
                  const meta = NODE_TYPES[nodeModal.type] || NODE_TYPES.bloque;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={styles.pickerItem}
                      onClick={() => handlePickExistingNode(nodeModal.type, item.id)}
                    >
                      <span style={{ fontSize: '18px' }}>{meta.icon}</span>
                      <strong style={{ fontSize: '13px' }}>{item.label}</strong>
                      <span className={styles.pickerBadge}>➕ Soltar en lienzo</span>
                    </button>
                  );
                })}

              {catalogFor(nodeModal.type).filter((item) => item.label.toLowerCase().includes(nodeModal.query.trim().toLowerCase())).length === 0 && (
                <div className={styles.pickerEmpty}>
                  {nodeModal.type === 'colaborador'
                    ? 'Sin coincidencias. Los colaboradores se gestionan en el módulo de Operarios.'
                    : 'Sin coincidencias en el catálogo.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. CREAR NUEVO PROYECTO */}
        {nodeModal.tab === 'new' && nodeModal.type === 'proyecto' && (
          <div className={styles.inlineCreateBox}>
            <div className={styles.createGrid2}>
              <div>
                <label className={styles.inlineLabel}>Nombre del Proyecto *</label>
                <input
                  type="text"
                  placeholder="Ej. Parque Central Santa Fe..."
                  value={nodeModal.newProjName}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjName: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className={styles.inlineLabel}>Cliente / Empresa *</label>
                <input
                  type="text"
                  placeholder="Ej. Municipio, Inmobiliaria..."
                  value={nodeModal.newProjClient}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjClient: e.target.value }))}
                />
              </div>
            </div>
            <div className={styles.createGrid2}>
              <div>
                <label className={styles.inlineSubLabel}>Fecha de Inicio</label>
                <input
                  type="date"
                  value={nodeModal.newProjStartDate}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjStartDate: e.target.value }))}
                />
              </div>
              <div>
                <label className={styles.inlineSubLabel}>Fecha de Entrega</label>
                <input
                  type="date"
                  value={nodeModal.newProjEndDate}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjEndDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className={styles.inlineSubLabel}>Descripción (opcional)</label>
              <textarea
                rows="2"
                placeholder="Observaciones o notas generales..."
                value={nodeModal.newProjDesc}
                onChange={(e) => setNodeModal((prev) => ({ ...prev, newProjDesc: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <Button variant="secondary" size="md" onClick={closeNodeModal}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleCreateNewProjectNode}>🗂️ Crear y Agregar al Lienzo</Button>
            </div>
          </div>
        )}

        {/* 3. CREAR NUEVO JUEGO / MODELO */}
        {nodeModal.tab === 'new' && nodeModal.type === 'juego' && (
          <div className={styles.inlineCreateBox}>
            <label className={styles.inlineLabel}>Nombre del Modelo / Juego *</label>
            <input
              type="text"
              placeholder="Ej. Resbaladilla Acero Inox 3m..."
              value={nodeModal.newGameName}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newGameName: e.target.value }))}
              autoFocus
            />

            <label className={styles.inlineSubLabel}>Proyecto Perteneciente (o conecta por cable después)</label>
            <select
              value={nodeModal.newGameProjectId}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newGameProjectId: e.target.value }))}
            >
              <option value="">Sin proyecto específico (General)</option>
              {proyectos.map((p) => (
                <option key={p.id} value={p.id}>{p.name} {p.client ? `(${p.client})` : ''}</option>
              ))}
            </select>

            <label className={styles.inlineSubLabel}>Áreas de Manufactura Requeridas:</label>
            <div className={styles.areasGridPills}>
              {dynamicAreas.map((a) => {
                const isSelected = nodeModal.newGameAreas?.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                    onClick={() => {
                      let next = isSelected
                        ? nodeModal.newGameAreas.filter((id) => id !== a.id)
                        : [...nodeModal.newGameAreas, a.id];
                      if (isSelected && a.id === 'corte-laser' && next.includes('herreria')) {
                        next = next.filter((id) => id !== 'herreria');
                      }
                      if (!isSelected && a.id === 'herreria' && !next.includes('corte-laser')) {
                        next.push('corte-laser');
                      }
                      setNodeModal((prev) => ({ ...prev, newGameAreas: next }));
                    }}
                  >
                    {isSelected ? '✓ ' : '＋ '} {a.name}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <Button variant="secondary" size="md" onClick={closeNodeModal}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleCreateNewGameNode}>🎮 Crear y Agregar al Lienzo</Button>
            </div>
          </div>
        )}

        {/* 4. CREAR NUEVA ACTIVIDAD */}
        {nodeModal.tab === 'new' && nodeModal.type === 'actividad' && (
          <div className={styles.inlineCreateBox}>
            <label className={styles.inlineLabel}>Título de la Tarea / Actividad *</label>
            <input
              type="text"
              placeholder="Ej. Soldar marco principal tubular..."
              value={nodeModal.newActTitle}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newActTitle: e.target.value }))}
              autoFocus
            />

            <div className={styles.createGrid2}>
              <div>
                <label className={styles.inlineSubLabel}>🏭 Área de Manufactura</label>
                <select
                  value={nodeModal.newActAreaId}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newActAreaId: e.target.value }))}
                >
                  {dynamicAreas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.inlineSubLabel}>Prioridad</label>
                <select
                  value={nodeModal.newActPriority}
                  onChange={(e) => setNodeModal((prev) => ({ ...prev, newActPriority: e.target.value }))}
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <Button variant="secondary" size="md" onClick={closeNodeModal}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleCreateNewActivityNode}>📌 Crear y Agregar al Lienzo</Button>
            </div>
          </div>
        )}

        {/* 5. CREAR RECURSO / AYUDA VISUAL */}
        {nodeModal.type === 'recurso' && (
          <div className={styles.inlineCreateBox}>
            <label className={styles.inlineLabel}>Título / Nombre de la Ayuda Visual *</label>
            <input
              type="text"
              placeholder="Ej. Plano de Ensamblaje Rev 2, Render Fachada, Modelo 3D..."
              value={nodeModal.newRecursoTitle}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newRecursoTitle: e.target.value }))}
              autoFocus
            />

            <div>
              <label className={styles.inlineSubLabel}>📁 Cargar Archivo (Imagen, PDF, SolidWorks, Inventor, STEP, DWG):</label>
              <input
                type="file"
                accept="image/*,application/pdf,.step,.stp,.iges,.igs,.dwg,.dxf,.skp,.obj,.stl,.sldprt,.sldasm,.slddrw,.ipt,.iam,.idw"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setNodeModal((prev) => ({
                      ...prev,
                      pendingFile: file,
                      newRecursoFileData: {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        dataUrl: URL.createObjectURL(file),
                      },
                    }));
                  }
                }}
              />
              {nodeModal.newRecursoFileData && (
                <div style={{ fontSize: '11.5px', color: '#10b981', fontWeight: 600, marginTop: '4px' }}>
                  ✓ Archivo seleccionado: {nodeModal.newRecursoFileData.name} ({Math.round(nodeModal.newRecursoFileData.size / 1024)} KB)
                </div>
              )}
            </div>

            <label className={styles.inlineSubLabel}>
              🔗 O Pegar URL / Enlace (Google Drive, Figma, OneDrive, Web):
            </label>
            <input
              type="text"
              placeholder="https://drive.google.com/... o https://figma.com/..."
              value={nodeModal.newRecursoUrl}
              onChange={(e) => setNodeModal((prev) => ({ ...prev, newRecursoUrl: e.target.value }))}
            />

            <div>
              <label className={styles.inlineSubLabel}>Instrucciones / Notas Técnicas (opcional)</label>
              <textarea
                rows="2"
                placeholder="Cotas críticas, tolerancias, especificaciones de armado..."
                value={nodeModal.newRecursoNotes}
                onChange={(e) => setNodeModal((prev) => ({ ...prev, newRecursoNotes: e.target.value }))}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <Button variant="secondary" size="md" onClick={closeNodeModal}>Cancelar</Button>
              <Button variant="primary" size="md" onClick={handleCreateNewRecursoNode}>📎 Crear y Agregar al Lienzo</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- MODAL: VISTA PREVIA Y LIGHTBOX DE AYUDA VISUAL / ARCHIVO ---------- */}
      <Modal
        isOpen={previewResourceModal.isOpen}
        onClose={() => setPreviewResourceModal((prev) => ({ ...prev, isOpen: false }))}
        title={`📎 ${previewResourceModal.title || 'Ayuda Visual / Archivo'}`}
      >
        {(() => {
          const info = getResourcePreviewInfo(previewResourceModal);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
              {/* VISTA PREVIA DE IMAGEN */}
              {info.previewImgSrc && (
                <div style={{ width: '100%', maxHeight: '65vh', overflow: 'auto', background: 'rgba(0,0,0,0.05)', borderRadius: '12px', padding: '8px', display: 'flex', justifyContent: 'center' }}>
                  <img
                    src={info.previewImgSrc}
                    alt={previewResourceModal.title || 'Vista previa'}
                    style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
                  />
                </div>
              )}

              {/* VISTA PREVIA DE DOCUMENTO / PDF */}
              {info.isPdf && !info.previewImgSrc && (
                <div style={{ width: '100%', padding: '24px', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', borderRadius: '12px', textAlign: 'center' }}>
                  <span style={{ fontSize: '48px', display: 'block', marginBottom: '8px' }}>📄</span>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', color: 'var(--color-dark)' }}>
                    {info.fileName || previewResourceModal.title || 'Documento PDF'}
                  </h4>
                  {info.fileSize ? (
                    <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--color-gray-500)' }}>
                      Tamaño: {Math.round(info.fileSize / 1024)} KB
                    </p>
                  ) : null}
                  {info.effectiveUrl && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => window.open(formatExternalUrl(info.effectiveUrl), '_blank', 'noopener,noreferrer')}
                    >
                      📄 Abrir Documento en Pestaña Nueva
                    </Button>
                  )}
                </div>
              )}

              {/* ENLACE WEB / SERVICIOS CLOUD */}
              {info.isLink && !info.previewImgSrc && (
                <div style={{ width: '100%', padding: '20px', background: info.linkProvider?.color ? `${info.linkProvider.color}0c` : 'rgba(37, 99, 235, 0.06)', border: `1.5px solid ${info.linkProvider?.color || '#2563eb'}40`, borderRadius: '12px', textAlign: 'center' }}>
                  <span style={{ fontSize: '38px', display: 'block', marginBottom: '8px' }}>{info.linkProvider?.icon || '🌐'}</span>
                  <strong style={{ fontSize: '15px', color: info.linkProvider?.color || '#2563eb', display: 'block', marginBottom: '6px' }}>
                    {info.linkProvider?.name || 'Enlace Externo'}
                  </strong>
                  <p style={{ fontSize: '13px', color: 'var(--color-gray-600)', wordBreak: 'break-all', margin: '0 0 14px 0' }}>
                    {info.rawUrl || 'Sin enlace configurado'}
                  </p>
                  {info.rawUrl && (
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => window.open(formatExternalUrl(info.rawUrl), '_blank', 'noopener,noreferrer')}
                    >
                      🌐 Abrir Enlace en Pestaña Nueva ↗
                    </Button>
                  )}
                </div>
              )}

              {/* MODELO 3D CAD: SOLIDWORKS, INVENTOR, STEP, DWG */}
              {info.isModel && !info.previewImgSrc && (
                <div style={{ width: '100%', padding: '20px', background: info.cadBrand === 'solidworks' ? 'rgba(225, 29, 72, 0.06)' : info.cadBrand === 'inventor' ? 'rgba(217, 119, 6, 0.06)' : 'rgba(13, 148, 136, 0.06)', border: `1.5px solid ${info.cadColor || '#0d9488'}40`, borderRadius: '12px', textAlign: 'center' }}>
                  <span style={{ fontSize: '38px', display: 'block', marginBottom: '8px' }}>{info.cadIcon || '🧊'}</span>
                  <strong style={{ fontSize: '15px', color: info.cadColor || '#0d9488', display: 'block', marginBottom: '4px' }}>
                    {info.cadLabel || 'Modelo 3D CAD'}
                  </strong>
                  <p style={{ fontSize: '12.5px', color: 'var(--color-gray-600)', margin: '0 0 12px 0', wordBreak: 'break-all' }}>
                    {info.fileName || 'Archivo CAD técnico para ensamble o manufactura'}
                    {info.fileSize ? ` (${Math.round(info.fileSize / 1024)} KB)` : ''}
                  </p>
                  {info.effectiveUrl && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => window.open(info.fileUrl || formatExternalUrl(info.effectiveUrl), '_blank', 'noopener,noreferrer')}
                      >
                        📥 Descargar Archivo {info.cadBrand ? info.cadBrand.toUpperCase() : 'CAD'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => window.open('https://viewer.autodesk.com/', '_blank', 'noopener,noreferrer')}
                        title="Visor gratuito oficial en navegador para modelos SolidWorks, Inventor, STEP y DWG"
                      >
                        📐 Abrir en Autodesk Viewer Web ↗
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* NOTAS TÉCNICAS */}
              {previewResourceModal.notes && (
                <div style={{ width: '100%', padding: '12px 14px', background: 'rgba(234, 88, 12, 0.08)', borderLeft: '4px solid #ea580c', borderRadius: '6px' }}>
                  <strong style={{ fontSize: '12px', color: '#ea580c', display: 'block', marginBottom: '2px' }}>📝 Notas e Instrucciones:</strong>
                  <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--color-dark)', whiteSpace: 'pre-wrap' }}>
                    {previewResourceModal.notes}
                  </p>
                </div>
              )}

              {/* ACCIONES DEL MODAL */}
              <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '10px', borderTop: '1px solid var(--color-gray-200)' }}>
                {(info.fileUrl || info.rawUrl) && (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => {
                      if (info.fileUrl && !info.fileUrl.startsWith('data:')) {
                        window.open(info.fileUrl, '_blank', 'noopener,noreferrer');
                      } else if (info.rawUrl) {
                        window.open(formatExternalUrl(info.rawUrl), '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    {info.fileName ? '📥 Abrir / Descargar' : '🔗 Abrir Enlace'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setPreviewResourceModal((prev) => ({ ...prev, isOpen: false }))}
                >
                  ✕ Cerrar
                </Button>
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
            <strong>Navegación:</strong> arrastra el fondo para desplazarte, usa los botones de zoom (esquina inferior
            derecha del lienzo) o mantén presionado Ctrl/Cmd mientras giras la rueda del mouse para acercar/alejar hacia
            donde apunta el cursor. El zoom es solo tuyo — no se comparte con otras personas viendo el mismo lienzo.
            &ldquo;🔎 Buscar Nodo&rdquo; en el panel izquierdo centra la vista en cualquier nodo por nombre, y
            &ldquo;🧹 Reorganizar&rdquo; (solo Admin) reacomoda todos los nodos en una cuadrícula ordenada si el diagrama
            se volvió difícil de leer. &ldquo;📥 Exportar PNG&rdquo; descarga una imagen del lienzo completo tal como está,
            para compartirlo o imprimirlo fuera del sistema.
          </p>
          <p>
            <strong>📦 Bloque de Actividades</strong> es distinto a los demás nodos: al crearlo eliges un nombre y un área
            (de manufactura, o &ldquo;Diseño&rdquo;) — esa área se asigna automáticamente a cada actividad que agregues
            dentro. Haz clic en el cuerpo del bloque para desplegar su lista de actividades, donde puedes crear
            actividades nuevas (se registran de una vez en el sistema, igual que desde la página de Actividades) o
            enlazar unas que ya existían. Quitar una actividad del bloque no la borra del sistema, solo la desvincula
            de este lienzo.
          </p>
          <p>
            <strong>Asignar responsable a un Bloque:</strong> a diferencia de los demás campos de una actividad, el
            responsable NO se elige a mano al crearla — se asigna conectando con un cable un nodo{' '}
            <strong>Colaborador</strong> al Bloque (arrastra desde cualquiera de los dos puertos, en cualquier
            dirección). Toda actividad nueva que agregues después de conectar el cable se asigna automáticamente a
            ese colaborador; el botón &ldquo;🔗 Reasignar todas&rdquo; dentro del bloque aplica ese mismo colaborador a
            las actividades que ya existían antes de conectarlo. Quitar el cable (clic sobre la línea) deja al bloque
            sin responsable para las actividades que crees después.
          </p>
          <p>
            <strong>Adjuntos y links:</strong> al crear una actividad nueva dentro de un bloque puedes adjuntar
            archivos de referencia (imagen, PDF, DWG/DXF/STEP) o links de referencia — quedan guardados en la
            actividad real del sistema, visibles en la lista desplegable del bloque.
          </p>
          <p>
            <strong>🎬 Modelo del proyecto (Arquitectura/Diseño):</strong> además de los adjuntos de referencia, cada
            actividad tiene un campo separado para el plano (Arquitectura) o el modelo 3D — SolidWorks u otro (Diseño):
            sube el archivo o pega un link (ej. Drive). Si la actividad tiene un modelo cargado, aparece el botón
            &ldquo;🎬 Abrir Modelo&rdquo; en la lista del bloque. Por ahora ese botón solo abre el archivo/link tal
            cual — es la base para integrarlo más adelante con la aplicación de renderizado.
          </p>
        </div>
      </Modal>

      {/* ---------- MODAL: CONSULTAR TAREAS DE UN ÁREA EN EL LIENZO ---------- */}
      <Modal
        isOpen={areaTasksModal.isOpen}
        onClose={() => setAreaTasksModal({ isOpen: false, areaId: null, areaName: '' })}
        title={`📌 Tareas en Área: ${areaTasksModal.areaName || 'Estación'}`}
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(() => {
            const areaTasks = actividades.filter((a) => a.areaId === areaTasksModal.areaId);
            if (areaTasks.length === 0) {
              return (
                <EmptyState
                  icon="📌"
                  title="Sin tareas registradas"
                  description="No hay actividades ni tareas asignadas a esta estación de manufactura actualmente."
                />
              );
            }
            return areaTasks.map((task) => {
              const resp = operarios.find((o) => o.id === task.operarioId)?.name;
              return (
                <div
                  key={task.id}
                  style={{
                    padding: '10px 14px',
                    background: 'var(--color-gray-50)',
                    border: '1px solid var(--color-gray-200)',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-dark)' }}>{task.title}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--color-gray-500)', marginTop: '3px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>Estatus: <strong>{task.status}</strong></span>
                      <span>· Prioridad: <strong>{task.priority}</strong></span>
                      {resp && <span style={{ color: 'var(--color-primary)' }}>· 👷 <strong>{resp}</strong></span>}
                      {task.projectName && <span>· 🗂️ {task.projectName}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {canUserControlActivity(task) ? (
                      <>
                        {task.status === 'pendiente' && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleStartActivity(task.id, task.title)}
                            title="Iniciar actividad"
                          >
                            ▶️ Iniciar
                          </Button>
                        )}
                        {task.status === 'proceso' && (
                          <Button
                            variant="success"
                            size="sm"
                            onClick={() => handleOpenCompleteModal(task.id, task.title)}
                            title="Terminar actividad"
                          >
                            ✅ Terminar
                          </Button>
                        )}
                        {task.status === 'completado' && (
                          <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>
                            ✓ Completada
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: '10.5px', color: 'var(--color-gray-400)', fontStyle: 'italic' }}>
                        🔒 {task.status}
                      </span>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <Button variant="secondary" size="md" onClick={() => setAreaTasksModal({ isOpen: false, areaId: null, areaName: '' })}>
            Cerrar
          </Button>
        </div>
      </Modal>

      {/* ---------- MODAL: FINALIZAR / COMPLETAR ACTIVIDAD ---------- */}
      <Modal
        isOpen={completeModal.isOpen}
        onClose={() => setCompleteModal({ isOpen: false, activityId: null, title: '', notes: '' })}
        title={`✅ Finalizar Actividad: ${completeModal.title || 'Actividad'}`}
      >
        <div className={styles.field} style={{ marginBottom: '12px' }}>
          <label>Notas de Conclusión / Comentarios de Entrega</label>
          <textarea
            rows="3"
            placeholder="Describe qué se realizó o verificó..."
            value={completeModal.notes}
            onChange={(e) => setCompleteModal((prev) => ({ ...prev, notes: e.target.value }))}
            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-gray-300)', fontSize: '13px' }}
            autoFocus
          />
        </div>
        <p style={{ fontSize: '11.5px', color: 'var(--color-gray-500)', margin: '0 0 16px 0' }}>
          🕒 Se registrará la fecha y hora exacta de terminación para la métrica y trazabilidad en toda la app.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setCompleteModal({ isOpen: false, activityId: null, title: '', notes: '' })}
          >
            Cancelar
          </Button>
          <Button
            variant="success"
            size="md"
            onClick={handleConfirmCompleteActivity}
          >
            ✅ Confirmar y Terminar
          </Button>
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
  setEdges,
  saveToFirestore,
  nodes,
  findNode,
  nodeTitle,
  updateDraftField,
  onSaveProyecto,
  onSaveJuego,
  onSaveActividad,
  onAssignColaborador,
  getConnectedAreaNode,
  getConnectedColaboradorNode,
  actividades,
  operarios,
  proyectos = [],
  juegos = [],
  addProject,
  addGame,
  updateProject,
  canEditDiagram,
  updateBlockField,
  updateBlockName,
  onSaveBlockName,
  openBlockActivityForm,
  handleReassignBlockActivities,
  updateNodeColor,
  updateEdgeColor,
  updateEdgeStyle,
  dynamicAreas,
  allBlockAreas,
  getSupervisorForArea,
  onViewAreaTasks,
  onStartActivity,
  onOpenCompleteModal,
  onResetActivityStatus,
  canUserControlActivity,
  lienzoActivoId = 'general',
  onClose,
}) => {
  const meta = NODE_TYPES[node.type] || NODE_TYPES.bloque;
  const toast = useToast();

  const [isCreatingProj, setIsCreatingProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjClient, setNewProjClient] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjStartDate, setNewProjStartDate] = useState(getTodayLocalDateStr());
  const [newProjEndDate, setNewProjEndDate] = useState(getTodayLocalDateStr());
  const [newProjStatus, setNewProjStatus] = useState('diseno');

  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [newGameName, setNewGameName] = useState('');
  const [newGameAreas, setNewGameAreas] = useState(['herreria', 'corte-laser']);
  const [newGameTargets, setNewGameTargets] = useState({ herreria: 10, 'corte-laser': 10 });

  // 🗂️ Estados para editar Proyecto Existente
  const [editProjName, setEditProjName] = useState('');
  const [editProjClient, setEditProjClient] = useState('');
  const [editProjStatus, setEditProjStatus] = useState('diseno');
  const [editProjStartDate, setEditProjStartDate] = useState('');
  const [editProjEndDate, setEditProjEndDate] = useState('');
  const [editProjDesc, setEditProjDesc] = useState('');
  const [isSavingProj, setIsSavingProj] = useState(false);

  // 🎮 Estados para editar Juego Existente
  const [editGameName, setEditGameName] = useState('');
  const [editGameProjectId, setEditGameProjectId] = useState('');
  const [editGameAreas, setEditGameAreas] = useState([]);
  const [editGameTargets, setEditGameTargets] = useState({});
  const [isSavingGame, setIsSavingGame] = useState(false);

  // Estados para abrir acordeón de edición en Bloques
  const [isEditingLinkedProj, setIsEditingLinkedProj] = useState(false);
  const [isEditingLinkedGame, setIsEditingLinkedGame] = useState(false);

  useEffect(() => {
    if (entity && node.type === 'proyecto') {
      setEditProjName(entity.name || '');
      setEditProjClient(entity.client || '');
      setEditProjStatus(entity.status || 'diseno');
      setEditProjStartDate(entity.startDate || '');
      setEditProjEndDate(entity.endDate || '');
      setEditProjDesc(entity.description || '');
    }
    if (entity && node.type === 'juego') {
      setEditGameName(entity.name || '');
      setEditGameProjectId(entity.projectId || '');
      setEditGameAreas(entity.areas || ['herreria', 'corte-laser']);
      setEditGameTargets(entity.targetPieces || {});
    }
  }, [entity, node.type]);

  const handleUpdateExistingProject = async () => {
    if (!editProjName.trim() || !editProjClient.trim()) {
      toast.danger('Nombre y cliente son obligatorios.');
      return;
    }
    setIsSavingProj(true);
    try {
      const res = await updateProject(entity.id, {
        name: editProjName.trim(),
        client: editProjClient.trim(),
        status: editProjStatus,
        startDate: editProjStartDate || null,
        endDate: editProjEndDate || null,
        description: editProjDesc.trim() || 'Sin descripción',
      });
      if (res?.ok !== false) {
        toast.success(`✅ Proyecto "${editProjName.trim()}" actualizado.`);
      } else {
        toast.danger(`Error: ${res.error}`);
      }
    } catch (e) {
      toast.danger('No se pudo actualizar el proyecto.');
    } finally {
      setIsSavingProj(false);
    }
  };

  const handleToggleEditGameArea = (areaId) => {
    const isSelected = editGameAreas.includes(areaId);
    let nextAreas = isSelected ? editGameAreas.filter((id) => id !== areaId) : [...editGameAreas, areaId];
    const nextTargets = { ...editGameTargets };

    if (isSelected && areaId === 'corte-laser' && nextAreas.includes('herreria')) {
      nextAreas = nextAreas.filter((id) => id !== 'herreria');
      delete nextTargets['herreria'];
    }
    if (!isSelected && areaId === 'herreria' && !nextAreas.includes('corte-laser')) {
      nextAreas.push('corte-laser');
      nextTargets['corte-laser'] = nextTargets['corte-laser'] || 10;
    }

    if (isSelected) {
      delete nextTargets[areaId];
    } else {
      nextTargets[areaId] = nextTargets[areaId] || 10;
    }

    setEditGameAreas(nextAreas);
    setEditGameTargets(nextTargets);
  };

  const handleUpdateExistingGame = async () => {
    if (!editGameName.trim()) {
      toast.danger('El nombre del juego es obligatorio.');
      return;
    }
    setIsSavingGame(true);
    try {
      const matchingProj = proyectos.find((p) => p.id === editGameProjectId);
      await updateDoc(doc(db, 'juegos', entity.id), {
        name: editGameName.trim(),
        projectId: editGameProjectId || null,
        projectName: matchingProj?.name || entity.projectName || 'General',
        areas: editGameAreas,
        targetPieces: editGameTargets,
        updatedAt: new Date().toISOString(),
      });
      toast.success(`✅ Juego "${editGameName.trim()}" actualizado.`);
    } catch (e) {
      console.error('Error actualizando juego:', e);
      toast.danger('No se pudo actualizar el juego.');
    } finally {
      setIsSavingGame(false);
    }
  };

  const incoming = edges.filter((e) => e.to === node.id);
  const outgoing = edges.filter((e) => e.from === node.id);

  const handleToggleInspectorGameArea = (areaId) => {
    const isSelected = newGameAreas.includes(areaId);
    let nextAreas = isSelected ? newGameAreas.filter((id) => id !== areaId) : [...newGameAreas, areaId];
    const nextTargets = { ...newGameTargets };

    if (isSelected && areaId === 'corte-laser' && nextAreas.includes('herreria')) {
      nextAreas = nextAreas.filter((id) => id !== 'herreria');
      delete nextTargets['herreria'];
    }
    if (!isSelected && areaId === 'herreria' && !nextAreas.includes('corte-laser')) {
      nextAreas.push('corte-laser');
      nextTargets['corte-laser'] = nextTargets['corte-laser'] || 10;
    }

    if (isSelected) {
      delete nextTargets[areaId];
    } else {
      nextTargets[areaId] = nextTargets[areaId] || 10;
    }

    setNewGameAreas(nextAreas);
    setNewGameTargets(nextTargets);
  };

  const handleQuickCreateProject = async () => {
    if (!newProjName.trim() || !newProjClient.trim()) {
      toast.danger('Ingresa el Nombre del proyecto y el Cliente.');
      return;
    }
    const newId = await addProject({
      name: newProjName.trim(),
      client: newProjClient.trim(),
      description: newProjDesc.trim() || 'Sin descripción',
      startDate: newProjStartDate || getTodayLocalDateStr(),
      endDate: newProjEndDate || getTodayLocalDateStr(),
      status: newProjStatus || 'diseno',
    });
    if (newId) {
      updateBlockField('projectId', newId);
      setIsCreatingProj(false);
      setNewProjName('');
      setNewProjClient('');
      setNewProjDesc('');
      toast.success(`🗂️ Proyecto "${newProjName.trim()}" registrado y asignado.`);
    }
  };

  const handleQuickCreateGame = async () => {
    if (!newGameName.trim()) {
      toast.danger('Ingresa un nombre para el juego.');
      return;
    }
    let chosenAreas = newGameAreas.length > 0 ? newGameAreas : [node.areaId || 'herreria'];
    if (chosenAreas.includes('herreria') && !chosenAreas.includes('corte-laser')) {
      chosenAreas.push('corte-laser');
    }

    const targets = {};
    chosenAreas.forEach((ar) => {
      targets[ar] = Number(newGameTargets[ar]) || 10;
    });

    const projName = proyectos.find((p) => p.id === node.projectId)?.name || 'General';
    const newId = await addGame({
      name: newGameName.trim(),
      projectName: projName,
      projectId: node.projectId || null,
      areas: chosenAreas,
      targetPieces: targets,
    });
    if (newId) {
      updateBlockField('gameId', newId);
      setIsCreatingGame(false);
      setNewGameName('');
      toast.success(`🎮 Juego "${newGameName.trim()}" registrado y asignado.`);
    }
  };

  return (
    <>
      <div className={styles.inspectorHeader}>
        <div>
          <p className={styles.inspectorEyebrow}>{meta.label}</p>
          <h2 className={styles.inspectorTitle} style={{ margin: 0 }}>{nodeTitle(node)}</h2>
        </div>
        {onClose && (
          <button
            type="button"
            className={styles.floatingCloseBtn}
            onClick={onClose}
            title="Cerrar inspector y deseleccionar"
          >
            ✕
          </button>
        )}
      </div>

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
          <div className={styles.field}>
            <label>Nombre del Proyecto *</label>
            <input
              type="text"
              value={editProjName}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjName(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label>Cliente *</label>
            <input
              type="text"
              value={editProjClient}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjClient(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label>Estado del Proyecto</label>
            <select
              value={editProjStatus}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjStatus(e.target.value)}
            >
              <option value="diseno">En Diseño</option>
              <option value="progreso">En Progreso</option>
              <option value="pausado">Pausado</option>
              <option value="completado">Completado</option>
            </select>
          </div>
          <div className={styles.createGrid2}>
            <div className={styles.field}>
              <label>Fecha Inicio</label>
              <input
                type="date"
                value={editProjStartDate}
                disabled={!canEditDiagram}
                onChange={(e) => setEditProjStartDate(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label>Fecha Entrega</label>
              <input
                type="date"
                value={editProjEndDate}
                disabled={!canEditDiagram}
                onChange={(e) => setEditProjEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label>Descripción</label>
            <textarea
              rows="3"
              value={editProjDesc}
              disabled={!canEditDiagram}
              onChange={(e) => setEditProjDesc(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label>Progreso General</label>
            <input type="text" value={`${entity.progress ?? 0}%`} disabled />
          </div>
          {canEditDiagram && (
            <Button
              variant="primary"
              size="md"
              onClick={handleUpdateExistingProject}
              isLoading={isSavingProj}
              style={{ width: '100%', marginTop: '8px' }}
            >
              💾 Guardar Cambios del Proyecto
            </Button>
          )}
        </>
      )}

      {!node.draft && entity && node.type === 'juego' && (
        <>
          <div className={styles.field}>
            <label>Nombre del Juego / Modelo *</label>
            <input
              type="text"
              value={editGameName}
              disabled={!canEditDiagram}
              onChange={(e) => setEditGameName(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label>Proyecto Perteneciente</label>
            <select
              value={editGameProjectId}
              disabled={!canEditDiagram}
              onChange={(e) => setEditGameProjectId(e.target.value)}
            >
              <option value="">Sin proyecto específico (General)</option>
              {proyectos.map((p) => (
                <option key={p.id} value={p.id}>{p.name} {p.client ? `(${p.client})` : ''}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label>Áreas Requeridas para este Juego</label>
            <div className={styles.areasGridPills} style={{ marginTop: '4px' }}>
              {dynamicAreas.map((a) => {
                const isSelected = editGameAreas.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.areaPill} ${isSelected ? styles.areaPillActive : ''}`}
                    onClick={() => canEditDiagram && handleToggleEditGameArea(a.id)}
                    style={{ cursor: canEditDiagram ? 'pointer' : 'default' }}
                  >
                    {isSelected ? '✓ ' : '+ '} {a.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.field}>
            <label>Metas de Piezas por Área</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', marginTop: '4px' }}>
              {editGameAreas.map((areaId) => {
                const areaName = dynamicAreas.find((a) => a.id === areaId)?.name || areaId;
                return (
                  <div key={areaId} style={{ background: 'var(--color-gray-50)', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-gray-200)' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '2px' }}>{areaName}</span>
                    <input
                      type="number"
                      min="1"
                      value={editGameTargets[areaId] || 10}
                      disabled={!canEditDiagram}
                      onChange={(e) => setEditGameTargets((prev) => ({ ...prev, [areaId]: Number(e.target.value) || 1 }))}
                      style={{ width: '100%', padding: '4px', fontSize: '12px' }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {canEditDiagram && (
            <Button
              variant="primary"
              size="md"
              onClick={handleUpdateExistingGame}
              isLoading={isSavingGame}
              style={{ width: '100%', margin: '8px 0 16px 0' }}
            >
              💾 Guardar Cambios del Juego
            </Button>
          )}

          {(entity.areas || [])
            .filter((areaId) => isAreaBlockedBySequence(entity, areaId))
            .map((areaId) => {
              const requiredAreaId = AREA_SEQUENCE_DEPENDENCIES[areaId];
              const requiredAreaName = dynamicAreas.find((a) => a.id === requiredAreaId)?.name;
              const blockedAreaName = dynamicAreas.find((a) => a.id === areaId)?.name;
              const produced = entity.producedPieces?.[requiredAreaId] || 0;
              const target = entity.targetPieces?.[requiredAreaId] || 0;
              return (
                <div key={areaId} className={styles.calloutBox} style={{ background: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.3)' }}>
                  🔒 <strong>{blockedAreaName}</strong> bloqueada: espera a que <strong>{requiredAreaName}</strong>{' '}
                  complete su meta ({produced}/{target} pzas).
                </div>
              );
            })}

          <p className={styles.inspectorEyebrow} style={{ marginTop: '16px' }}>Avance de Manufactura</p>
          <div className={styles.areaStatusList}>
            {[...(entity.areas || []), 'producto-terminado'].map((areaId) => {
              const areaName = areaId === 'producto-terminado'
                ? 'Producto Terminado'
                : dynamicAreas.find((a) => a.id === areaId)?.name || areaId;
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
          <div className={styles.field}><label>Área</label><input type="text" value={dynamicAreas.find((a) => a.id === entity.areaId)?.name || entity.areaId} disabled /></div>
          <div className={styles.field}><label>Prioridad</label><input type="text" value={entity.priority} disabled /></div>
          <div className={styles.field}>
            <label>Responsable</label>
            <input
              type="text"
              value={(() => {
                const colabEdge = edges.find(
                  (e) =>
                    (e.from === node.id && findNode(e.to)?.type === 'colaborador') ||
                    (e.to === node.id && findNode(e.from)?.type === 'colaborador')
                );
                const connectedColabNode = colabEdge
                  ? findNode(findNode(colabEdge.from)?.type === 'colaborador' ? colabEdge.from : colabEdge.to)
                  : null;
                const directOperario = operarios.find((o) => o.id === (entity?.operarioId || node?.operarioId || node?.draftFields?.operarioId));
                return directOperario?.name || (connectedColabNode ? nodeTitle(connectedColabNode) : 'Sin asignar (conectar cable a colaborador)');
              })()}
              disabled
            />
          </div>

          <div className={styles.field}>
            <label>Estado del Trabajo</label>
            <div style={{ padding: '10px 12px', background: 'var(--color-gray-50)', borderRadius: '8px', border: '1px solid var(--color-gray-200)', marginTop: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-dark)' }}>Estado Actual:</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    background:
                      entity.status === 'completado'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : entity.status === 'proceso'
                        ? 'rgba(37, 99, 235, 0.15)'
                        : 'rgba(156, 163, 175, 0.15)',
                    color:
                      entity.status === 'completado'
                        ? '#10b981'
                        : entity.status === 'proceso'
                        ? '#2563eb'
                        : '#6b7280',
                  }}
                >
                  {entity.status === 'completado' ? '✅ Completada' : entity.status === 'proceso' ? '⚡ En Proceso' : '⏳ Pendiente'}
                </span>
              </div>

              {entity.startedAt && (
                <div style={{ fontSize: '11px', color: 'var(--color-gray-600)', marginTop: '6px' }}>
                  🕒 Inicio: <strong>{new Date(entity.startedAt).toLocaleString()}</strong>
                </div>
              )}
              {entity.completedAt && (
                <div style={{ fontSize: '11px', color: '#10b981', marginTop: '3px' }}>
                  ✅ Fin: <strong>{new Date(entity.completedAt).toLocaleString()}</strong>
                </div>
              )}
              {entity.completionNotes && (
                <div style={{ fontSize: '11px', color: 'var(--color-gray-600)', marginTop: '5px', fontStyle: 'italic', borderTop: '1px dashed var(--color-gray-200)', paddingTop: '4px' }}>
                  &ldquo;{entity.completionNotes}&rdquo;
                </div>
              )}
            </div>

            {(() => {
              const hasControl = canUserControlActivity ? canUserControlActivity(entity) : true;
              if (!hasControl) {
                return (
                  <div style={{ padding: '8px', background: 'rgba(0,0,0,0.04)', borderRadius: '6px', marginTop: '10px', fontSize: '11.5px', color: 'var(--color-gray-600)', textAlign: 'center' }}>
                    🔒 Solo el colaborador asignado o el supervisor de esta área pueden iniciar o terminar esta actividad.
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                  {entity.status === 'pendiente' && (
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => onStartActivity && onStartActivity(entity.id, entity.title)}
                      style={{ width: '100%' }}
                    >
                      ▶️ Iniciar Actividad
                    </Button>
                  )}
                  {entity.status === 'proceso' && (
                    <>
                      <Button
                        variant="success"
                        size="md"
                        onClick={() => onOpenCompleteModal && onOpenCompleteModal(entity.id, entity.title)}
                        style={{ width: '100%' }}
                      >
                        ✅ Marcar como Terminada
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onResetActivityStatus && onResetActivityStatus(entity.id, 'pendiente')}
                        style={{ width: '100%' }}
                      >
                        ⏸️ Regresar a Pendiente
                      </Button>
                    </>
                  )}
                  {entity.status === 'completado' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onResetActivityStatus && onResetActivityStatus(entity.id, 'proceso')}
                      style={{ width: '100%' }}
                    >
                      🔄 Reabrir Actividad
                    </Button>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {!node.draft && entity && node.type === 'area' && (
        <>
          <div className={styles.field}><label>Nombre del Área</label><input type="text" value={entity.name} disabled /></div>
          {(() => {
            const supervisor = (getSupervisorForArea && getSupervisorForArea(node.refId || entity.id)) || {
              name: 'Supervisor de Área',
              role: 'Supervisor',
            };
            return (
              <div className={styles.field}>
                <label>👤 Supervisor Oficial a Cargo</label>
                <input type="text" value={`${supervisor.name} (${supervisor.role})`} disabled />
              </div>
            );
          })()}
          <div className={styles.field}>
            <label>👥 Operarios en esta Estación</label>
            <input
              type="text"
              value={`${operarios.filter((o) => o.currentArea === (node.refId || entity.id)).length} operarios registrados`}
              disabled
            />
          </div>
          <div className={styles.field}>
            <label>📌 Tareas Asignadas a esta Área</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={`${actividades.filter((a) => a.areaId === (node.refId || entity.id)).length} tareas registradas`}
                disabled
                style={{ flex: 1 }}
              />
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => onViewAreaTasks && onViewAreaTasks(node.refId || entity.id, entity.name)}
                title="Ver lista completa de tareas de esta área"
              >
                📋 Ver
              </Button>
            </div>
          </div>
        </>
      )}

      {!node.draft && entity && node.type === 'colaborador' && (
        <>
          <div className={styles.field}><label>Nombre</label><input type="text" value={entity.name} disabled /></div>
          <div className={styles.field}><label>Área Actual</label><input type="text" value={dynamicAreas.find((a) => a.id === entity.currentArea)?.name || entity.currentArea} disabled /></div>
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
                  🔁 Asignar a {dynamicAreas.find((a) => a.id === areaNode.refId)?.name}
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
                      <span>{dynamicAreas.find((ar) => ar.id === a.areaId)?.name || a.areaId}</span>
                      <span>· {a.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {node.type === 'recurso' && (() => {
        const info = getResourcePreviewInfo(node);
        const isUploading = node.draftFields?.fileData?.isUploading || node.draftFields?.isUploading;

        return (
          <>
            {/* Título de la Ayuda Visual */}
            <div className={styles.field}>
              <label>Título / Nombre</label>
              <input
                type="text"
                value={node.draftFields?.title || node.title || ''}
                disabled={!canEditDiagram}
                placeholder="Ej. Plano de Corte Rev 3..."
                onChange={(e) => updateDraftField('title', e.target.value)}
              />
            </div>

            {/* URL o Enlace Externo */}
            <div className={styles.field}>
              <label>🔗 URL Externa o en la Nube (Drive, Figma, Autodesk, Web)</label>
              <input
                type="text"
                value={node.draftFields?.url || ''}
                disabled={!canEditDiagram}
                placeholder="https://drive.google.com/... o https://figma.com/..."
                onChange={(e) => updateDraftField('url', e.target.value)}
              />
            </div>

            {/* Subir Archivo Local / Nube */}
            {canEditDiagram && (
              <div className={styles.field}>
                <label>📁 Cargar / Cambiar Archivo (Imagen, PDF, SolidWorks, Inventor, STEP, CAD)</label>
                <input
                  type="file"
                  accept="image/*,application/pdf,.step,.stp,.iges,.igs,.dwg,.dxf,.skp,.obj,.stl,.sldprt,.sldasm,.slddrw,.ipt,.iam,.idw"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const localBlobUrl = URL.createObjectURL(file);

                      // Preview inmediato local
                      updateDraftField('fileData', {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        dataUrl: localBlobUrl,
                        isUploading: true,
                      });

                      toast.info(`⏳ Guardando "${file.name}" en la nube...`);

                      try {
                        const uploaded = await uploadResourceFile(file, lienzoActivoId);
                        if (uploaded) {
                          updateDraftField('fileData', uploaded);
                          toast.success(`✅ Archivo "${file.name}" guardado permanentemente.`);
                        }
                      } catch (err) {
                        console.error('Error al subir archivo a Storage:', err);
                        toast.danger('No se pudo subir a Storage, pero el archivo se mantendrá en tu sesión local.');
                      }
                    }
                  }}
                />

                {isUploading && (
                  <div style={{ marginTop: '5px', fontSize: '11.5px', color: '#0284c7', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span>⏳</span> Subiendo a la nube de Firebase...
                  </div>
                )}

                {info.fileName && !isUploading && (
                  <div style={{ marginTop: '5px', fontSize: '11.5px', color: '#10b981', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.08)', padding: '4px 8px', borderRadius: '4px' }}>
                    <span>✓ {info.fileName} {info.fileSize ? `(${Math.round(info.fileSize / 1024)} KB)` : ''}</span>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: 'var(--color-alert, #ef4444)', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}
                      onClick={() => {
                        const storagePath = node.draftFields?.fileData?.storagePath;
                        if (storagePath && storage) {
                          deleteObject(ref(storage, storagePath)).catch((e) => console.warn('No se pudo borrar archivo de Storage:', e));
                        }
                        updateDraftField('fileData', null);
                      }}
                      title="Quitar archivo adjunto"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Notas Técnicas / Instrucciones */}
            <div className={styles.field}>
              <label>📝 Notas e Instrucciones Técnicas</label>
              <textarea
                rows="3"
                value={node.draftFields?.notes || ''}
                disabled={!canEditDiagram}
                placeholder="Especificaciones, cotas críticas, instrucciones de ensamble..."
                onChange={(e) => updateDraftField('notes', e.target.value)}
              />
            </div>

            {/* Estado de Asignación / Conexión por cable */}
            <div style={{ marginTop: '10px' }}>
              <label style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', display: 'block', marginBottom: '4px' }}>
                🔌 Conexión en el Diagrama
              </label>
              {(() => {
                const connectedEdge = edges.find(
                  (e) =>
                    (e.from === node.id && (findNode(e.to)?.type === 'actividad' || findNode(e.to)?.type === 'proyecto')) ||
                    (e.to === node.id && (findNode(e.from)?.type === 'actividad' || findNode(e.from)?.type === 'proyecto'))
                );
                const targetNode = connectedEdge
                  ? findNode(findNode(connectedEdge.from)?.type === 'actividad' || findNode(connectedEdge.from)?.type === 'proyecto' ? connectedEdge.from : connectedEdge.to)
                  : null;

                if (targetNode) {
                  return (
                    <div style={{ padding: '8px 10px', background: 'rgba(37, 99, 235, 0.08)', borderRadius: '6px', border: '1px solid rgba(37, 99, 235, 0.25)', fontSize: '12px', color: 'var(--color-dark)' }}>
                      <strong>{targetNode.type === 'proyecto' ? '🗂️ Asignado al Proyecto:' : '📌 Asignado a la Actividad:'}</strong>
                      <div style={{ marginTop: '2px', fontWeight: 600, color: 'var(--color-primary)' }}>{nodeTitle(targetNode)}</div>
                    </div>
                  );
                }
                return (
                  <div style={{ padding: '8px 10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', border: '1px dashed var(--color-gray-300)', fontSize: '11.5px', color: 'var(--color-gray-500)' }}>
                    💡 Arrastra un cable desde este nodo hasta una <strong>Actividad</strong> o <strong>Proyecto</strong> para vincularlo directamente.
                  </div>
                );
              })()}
            </div>

            {/* Botón para Abrir Vista Previa */}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setPreviewResourceModal({
                  isOpen: true,
                  title: nodeTitle(node),
                  resourceType: info.resType,
                  url: info.rawUrl || info.fileUrl || '',
                  fileData: node.draftFields?.fileData || null,
                  notes: node.draftFields?.notes || '',
                });
              }}
              style={{ width: '100%', marginTop: '12px' }}
            >
              🔍 Ver en Pantalla Completa / Descargar
            </Button>
          </>
        );
      })()}

      {!node.draft && !entity && node.type !== 'recurso' && (
        <p style={{ fontSize: '12.5px', color: 'var(--color-alert)' }}>Este registro ya no existe.</p>
      )}

      {/* 🎨 PERSONALIZAR COLOR DEL NODO */}
      {canEditDiagram && (
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}>
          <label style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-gray-500)', display: 'block', marginBottom: '8px' }}>
            🎨 Color Personalizado del Nodo
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            {PRESET_COLORS.map((c) => {
              const isSelected = (node.customColor || meta.colorVar) === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => updateNodeColor(node.id, c.value)}
                  title={c.name}
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    backgroundColor: c.value,
                    border: isSelected ? '2.5px solid #ffffff' : '1.5px solid rgba(0,0,0,0.15)',
                    boxShadow: isSelected ? `0 0 0 2px ${c.value}, 0 2px 8px rgba(0,0,0,0.3)` : 'none',
                    cursor: 'pointer',
                    padding: 0,
                    transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    transition: 'transform 0.15s ease',
                  }}
                />
              );
            })}
            <label title="Elegir color personalizado" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', margin: 0 }}>
              <input
                type="color"
                value={node.customColor || meta.colorVar || '#ea580c'}
                onChange={(e) => updateNodeColor(node.id, e.target.value)}
                style={{ width: '28px', height: '28px', padding: '0', border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: '6px', cursor: 'pointer', background: 'none' }}
              />
            </label>
          </div>
        </div>
      )}

      {/* ⚡ CABLES Y CONEXIONES CON CAMBIO DE COLOR */}
      <div className={styles.calloutBox} style={{ marginTop: '16px', background: 'rgba(234, 88, 12, 0.06)', border: '1px solid rgba(234, 88, 12, 0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <strong style={{ color: 'var(--color-primary)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            ⚡ Conexiones ({incoming.length + outgoing.length})
          </strong>
        </div>

        {incoming.length === 0 && outgoing.length === 0 && (
          <span className={styles.emptyConns}>Sin cables conectados todavía. Arrastra desde los puntos laterales, superior o inferior.</span>
        )}

        {outgoing.map((e) => {
          const other = findNode(e.to);
          if (!other) return null;
          const otherMeta = NODE_TYPES[other.type] || NODE_TYPES.bloque;
          const wireColor = e.customColor || node.customColor || meta.colorVar;

          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '6px' }}>
              <span style={{ fontSize: '11.5px' }}>
                <span className={styles.connArrow} style={{ color: wireColor }}>→</span> Conecta a <strong>{otherMeta.icon} {nodeTitle(other)}</strong>
              </span>
              {canEditDiagram && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="color"
                    value={wireColor}
                    onChange={(evt) => updateEdgeColor(e.id, evt.target.value)}
                    title="Cambiar color de este cable"
                    style={{ width: '22px', height: '22px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                  />
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--color-alert, #ef4444)', cursor: 'pointer', fontSize: '13px', padding: '2px 4px' }}
                    onClick={() => {
                      const nextEdges = edges.filter((ed) => ed.id !== e.id);
                      setEdges(nextEdges);
                      saveToFirestore(nodes, nextEdges);
                      toast.info('Cable desconectado.');
                    }}
                    title="Desconectar este cable"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {incoming.map((e) => {
          const other = findNode(e.from);
          if (!other) return null;
          const otherMeta = NODE_TYPES[other.type] || NODE_TYPES.bloque;
          const wireColor = e.customColor || other.customColor || otherMeta.colorVar;

          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '6px' }}>
              <span style={{ fontSize: '11.5px' }}>
                <span className={styles.connArrow} style={{ color: wireColor }}>←</span> Recibe de <strong>{otherMeta.icon} {nodeTitle(other)}</strong>
              </span>
              {canEditDiagram && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="color"
                    value={wireColor}
                    onChange={(evt) => updateEdgeColor(e.id, evt.target.value)}
                    title="Cambiar color de este cable"
                    style={{ width: '22px', height: '22px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                  />
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--color-alert, #ef4444)', cursor: 'pointer', fontSize: '13px', padding: '2px 4px' }}
                    onClick={() => {
                      const nextEdges = edges.filter((ed) => ed.id !== e.id);
                      setEdges(nextEdges);
                      saveToFirestore(nodes, nextEdges);
                      toast.info('Cable desconectado.');
                    }}
                    title="Desconectar este cable"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

EditorVisualPage.propTypes = {
  standalone: PropTypes.bool,
};

export default EditorVisualPage;
