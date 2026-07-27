/**
 * @file ComprasPage.jsx
 * @description Página de Requisiciones de Compra de Dicrejart
 * Flujo: Supervisor de Área o Encargado de Almacén crea la requisición (pendiente) ->
 * Dirección la autoriza o la regresa con observaciones -> Compras realiza el pago y
 * adjunta el comprobante (comprada) -> el solicitante confirma y cierra (recibida)
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import useToast from '../../hooks/useToast';
import useAuth from '../../hooks/useAuth';
import useCompras from '../../hooks/useCompras';
import useIsMobile from '../../hooks/useIsMobile';
import { ROLE_TYPES } from '../../data/usersData';
import useAreas from '../../hooks/useAreas';
import { REQUISITION_STATUS_LABELS, PRIORITY_LABELS } from '../../data/comprasData';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import ItemAutocomplete from '../../components/ui/ItemAutocomplete';

/**
 * Determina si un adjunto es un PDF — funciona tanto con un archivo crudo (File, aún no
 * subido) como con un adjunto ya subido a Storage ({url, path, name}).
 */
const isPdfAttachment = (att) => {
  if (!att) return false;
  if (att instanceof File) return att.type === 'application/pdf';
  return Boolean(att.name?.toLowerCase().endsWith('.pdf'));
};

/**
 * URL para previsualizar/descargar un adjunto: si ya se subió a Storage, es su `url`
 * real; si es un archivo crudo aún no subido, se genera un blob: URL local temporal.
 */
const getAttachmentUrl = (att) => (att instanceof File ? URL.createObjectURL(att) : att?.url);

const STATUS_BADGE_VARIANT = {
  pendiente: 'warning',
  regresada: 'danger',
  autorizada: 'primary',
  comprada: 'info',
  recibida: 'success',
};

const TRACKER_STEPS = [
  { key: 'solicitada', label: 'Solicitada' },
  { key: 'autorizacion', label: 'Autorización' },
  { key: 'pago', label: 'Pago' },
  { key: 'recibida', label: 'Recibida' },
];

/**
 * Barra visual de seguimiento del ciclo de vida de una requisición (Solicitada →
 * Autorización → Pago → Recibida), para que el solicitante, Dirección y Compras vean de
 * un vistazo en qué paso va cada una y quién/cuándo actuó, sin tener que leer el estado
 * en texto. Si Dirección la regresó, el paso de Autorización se muestra en rojo como
 * rama terminal en vez de seguir avanzando.
 */
const RequisicionTracker = ({ req }) => {
  const isRegresada = req.status === 'regresada';
  // En celular, 4 pasos en fila (mín. ~92px cada uno + líneas de conexión) suman más
  // ancho que la mayoría de pantallas de teléfono, así que dependían de scroll
  // horizontal poco práctico con el dedo y el último paso se veía cortado. En vertical
  // no hace falta ningún scroll: cada paso es una fila completa con su detalle a la par.
  const isMobile = useIsMobile();

  const stepState = (key) => {
    if (key === 'solicitada') return 'completado';
    if (key === 'autorizacion') {
      if (isRegresada) return 'regresado';
      return req.status === 'pendiente' ? 'activo' : 'completado';
    }
    if (key === 'pago') {
      if (isRegresada || req.status === 'pendiente') return 'inactivo';
      return req.status === 'autorizada' ? 'activo' : 'completado';
    }
    // key === 'recibida'
    if (req.status === 'recibida') return 'completado';
    return req.status === 'comprada' ? 'activo' : 'inactivo';
  };

  const stepColor = (state) => {
    if (state === 'completado') return '#16a34a';
    if (state === 'activo') return 'var(--color-primary)';
    if (state === 'regresado') return 'var(--color-danger)';
    return 'var(--color-gray-300)';
  };

  const stepDetail = (key) => {
    if (key === 'solicitada') {
      return `${req.requestedBy || ''}${req.createdAt ? ' · ' + new Date(req.createdAt).toLocaleDateString() : ''}`;
    }
    if (key === 'autorizacion' && req.reviewedBy) {
      return `${req.reviewedBy}${req.reviewedAt ? ' · ' + new Date(req.reviewedAt).toLocaleDateString() : ''}`;
    }
    if (key === 'pago' && req.purchasedBy) {
      return `${req.purchasedBy}${req.purchasedAt ? ' · ' + new Date(req.purchasedAt).toLocaleDateString() : ''}`;
    }
    if (key === 'recibida' && req.receivedBy) {
      return `${req.receivedBy}${req.receivedAt ? ' · ' + new Date(req.receivedAt).toLocaleDateString() : ''}`;
    }
    return '';
  };

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', margin: '10px 0 16px' }}>
        {TRACKER_STEPS.map((step, idx) => {
          const state = stepState(step.key);
          const color = stepColor(state);
          const label = step.key === 'autorizacion' && isRegresada ? 'Regresada' : step.label;
          const detail = stepDetail(step.key);
          const isLast = idx === TRACKER_STEPS.length - 1;
          return (
            <div key={step.key} style={{ display: 'flex', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: state === 'inactivo' ? 'var(--color-white)' : color,
                    border: `2px solid ${color}`,
                    flexShrink: 0,
                  }}
                />
                {!isLast && (
                  <div style={{ width: '2px', flexGrow: 1, minHeight: '24px', background: color, marginTop: '2px' }} />
                )}
              </div>
              <div style={{ paddingBottom: isLast ? 0 : '14px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color }}>{label}</div>
                {detail && (
                  <div style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>{detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', margin: '10px 0 16px', overflowX: 'auto' }}>
      {TRACKER_STEPS.map((step, idx) => {
        const state = stepState(step.key);
        const color = stepColor(state);
        const label = step.key === 'autorizacion' && isRegresada ? 'Regresada' : step.label;
        const detail = stepDetail(step.key);
        return (
          <React.Fragment key={step.key}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '92px' }}>
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: state === 'inactivo' ? 'var(--color-white)' : color,
                  border: `2px solid ${color}`,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: '11px', fontWeight: 700, color, marginTop: '4px', textAlign: 'center' }}>{label}</span>
              {detail && (
                <span style={{ fontSize: '10px', color: 'var(--color-gray-500)', textAlign: 'center' }}>{detail}</span>
              )}
            </div>
            {idx < TRACKER_STEPS.length - 1 && (
              <div style={{ flexGrow: 1, height: '2px', background: color, marginTop: '8px', minWidth: '16px' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const EMPTY_FORM = {
  areaId: '',
  items: [{ name: '', itemId: null, quantity: 1, unit: 'pza' }],
  justification: '',
  priority: 'normal',
  attachments: [],
};

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--color-gray-200)',
  fontSize: '13px',
};

const labelStyle = { fontSize: '13px', fontWeight: 600, color: 'var(--color-secondary)', display: 'block', marginBottom: '4px' };

const ComprasPage = () => {
  const { user, verifyPassword } = useAuth();
  const {
    requisiciones,
    addRequisicion,
    authorizeRequisicion,
    returnRequisicion,
    resubmitRequisicion,
    addPaymentDetails,
    markAsPurchased,
    markAsReceived,
    deleteRequisicion,
  } = useCompras();
  const { areas: dynamicAreas } = useAreas();
  const toast = useToast();

  // Adjunto actualmente en previsualización (cotización, comprobante o datos de pago)
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  // Confirmación antes de eliminar una requisición (solo Admin, ver botón en RequisitionCard)
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, req: null });
  const [isDeletingReq, setIsDeletingReq] = useState(false);

  const handleCloseDeleteConfirm = () => setDeleteConfirm({ isOpen: false, req: null });

  const handleConfirmDeleteRequisicion = async () => {
    setIsDeletingReq(true);
    const res = await deleteRequisicion(deleteConfirm.req.id);
    setIsDeletingReq(false);
    if (res.ok) {
      toast.success(`🗑️ Requisición ${deleteConfirm.req.id} eliminada.`);
      handleCloseDeleteConfirm();
    } else {
      toast.danger(`❌ No se pudo eliminar: ${res.error}`);
    }
  };

  // Si el adjunto ya se subió a Storage, `url` es directo; si es un File aún no
  // subido, se genera un blob: URL local temporal (y se libera al cerrar/cambiar).
  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null);
      return undefined;
    }
    if (previewFile instanceof File) {
      const blobUrl = URL.createObjectURL(previewFile);
      setPreviewUrl(blobUrl);
      return () => URL.revokeObjectURL(blobUrl);
    }
    setPreviewUrl(previewFile.url);
    return undefined;
  }, [previewFile]);

  const isAdmin = user?.roleType === ROLE_TYPES.ADMIN;
  const isDireccion = user?.roleType === ROLE_TYPES.DIRECCION || isAdmin;
  const isCompras = user?.roleType === ROLE_TYPES.COMPRAS || isAdmin;
  const isSolicitante =
    user?.roleType === ROLE_TYPES.SUPERVISOR_AREA ||
    (user?.roleType === ROLE_TYPES.ENCARGADO_AREA && user?.areaId === 'almacen') ||
    isAdmin;

  const solicitanteAreaOptions = useMemo(() => {
    if (isAdmin) return dynamicAreas;
    if (user?.roleType === ROLE_TYPES.SUPERVISOR_AREA) {
      return dynamicAreas.filter((a) => (user.areaIds || []).includes(a.id));
    }
    if (user?.roleType === ROLE_TYPES.ENCARGADO_AREA && user.areaId === 'almacen') {
      return dynamicAreas.filter((a) => a.id === 'almacen');
    }
    return [];
  }, [user, isAdmin, dynamicAreas]);

  // ============================================
  // ESTADO - MODAL DE CREACIÓN / REENVÍO
  // ============================================
  const [formModal, setFormModal] = useState({ isOpen: false, mode: 'create', editingId: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);

  const handleOpenCreateModal = () => {
    setForm({
      ...EMPTY_FORM,
      areaId: solicitanteAreaOptions[0]?.id || '',
    });
    setFormModal({ isOpen: true, mode: 'create', editingId: null });
  };

  const handleOpenEditModal = (req) => {
    setForm({
      areaId: req.areaId,
      items: req.items.map((it) => ({ ...it })),
      justification: req.justification,
      priority: req.priority,
      attachments: req.attachments || [],
    });
    setFormModal({ isOpen: true, mode: 'edit', editingId: req.id });
  };

  const handleCloseFormModal = () => {
    setFormModal({ isOpen: false, mode: 'create', editingId: null });
    setForm(EMPTY_FORM);
  };

  const handleItemChange = (idx, field, value) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    }));
  };

  const handleAddItemRow = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, { name: '', itemId: null, quantity: 1, unit: 'pza' }] }));
  };

  const handleRemoveItemRow = (idx) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  // Los archivos se guardan crudos en el estado del formulario — se suben a Storage
  // hasta que se confirma el envío (ver handleSubmitForm), no al seleccionarlos.
  const handleAttachmentUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...files] }));
    e.target.value = '';
  };

  const handleRemoveAttachment = (idx) => {
    setForm((prev) => ({ ...prev, attachments: prev.attachments.filter((_, i) => i !== idx) }));
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (!form.areaId) {
      toast.danger('Selecciona el área para la que se solicita el material.');
      return;
    }
    const validItems = form.items.filter((it) => it.name.trim() && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      toast.danger('Agrega al menos un material con nombre y cantidad válida.');
      return;
    }
    if (!form.justification.trim()) {
      toast.danger('Describe la justificación de la requisición.');
      return;
    }
    // La cotización del proveedor ahora es opcional.
    // if (form.attachments.length === 0) {
    //   toast.danger('Adjunta la cotización del proveedor para esta requisición.');
    //   return;
    // }

    const areaName = dynamicAreas.find((a) => a.id === form.areaId)?.name || form.areaId;
    setIsSubmittingForm(true);

    let res;
    if (formModal.mode === 'edit') {
      res = await resubmitRequisicion(formModal.editingId, {
        areaId: form.areaId,
        items: validItems,
        justification: form.justification,
        priority: form.priority,
        attachments: form.attachments,
      });
    } else {
      res = await addRequisicion({
        areaId: form.areaId,
        items: validItems,
        justification: form.justification,
        priority: form.priority,
        attachments: form.attachments,
        requestedBy: user.name,
        requestedByUserId: user.id,
        requestedByRole: user.roleType,
      });
    }

    setIsSubmittingForm(false);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo guardar la requisición.');
      return;
    }
    toast.success(
      formModal.mode === 'edit'
        ? `📤 Requisición reenviada para nueva autorización (${areaName}).`
        : `✅ Requisición creada para ${areaName}, enviada a Dirección para autorización.`
    );
    handleCloseFormModal();
  };

  // ============================================
  // ESTADO - MODAL DE REVISIÓN (DIRECCIÓN)
  // ============================================
  const [reviewModal, setReviewModal] = useState({ isOpen: false, req: null, action: 'authorize', notes: '' });

  // Ventana emergente de confirmación de contraseña, previa a abrir la autorización
  const [passwordConfirmModal, setPasswordConfirmModal] = useState({ isOpen: false, req: null, password: '' });

  /** Al presionar "Autorizar" primero se pide confirmar la contraseña; "Regresar" no la requiere */
  const handleOpenReviewModal = (req, action) => {
    if (action === 'authorize') {
      setPasswordConfirmModal({ isOpen: true, req, password: '' });
      return;
    }
    setReviewModal({ isOpen: true, req, action, notes: '' });
  };

  const handleCloseReviewModal = () => {
    setReviewModal({ isOpen: false, req: null, action: 'authorize', notes: '' });
  };

  const handleClosePasswordConfirmModal = () => {
    setPasswordConfirmModal({ isOpen: false, req: null, password: '' });
  };

  const handleSubmitPasswordConfirm = (e) => {
    e.preventDefault();
    if (!verifyPassword(passwordConfirmModal.password)) {
      toast.danger('❌ Contraseña incorrecta.');
      return;
    }
    const { req } = passwordConfirmModal;
    handleClosePasswordConfirmModal();
    setReviewModal({ isOpen: true, req, action: 'authorize', notes: '' });
  };

  const handleSubmitReview = (e) => {
    e.preventDefault();
    const { req, action, notes } = reviewModal;
    if (action === 'return' && !notes.trim()) {
      toast.danger('Indica el motivo por el que regresas la requisición.');
      return;
    }
    if (action === 'authorize') {
      authorizeRequisicion(req.id, user.name, notes);
      toast.success(`✅ Requisición ${req.id} autorizada. Se notificó a Compras.`);
    } else {
      returnRequisicion(req.id, user.name, notes);
      toast.warning(`↩️ Requisición ${req.id} regresada al solicitante para corrección.`);
    }
    handleCloseReviewModal();
  };

  // ============================================
  // ESTADO - MODAL DE COMPRA (COMPRAS)
  // ============================================
  const [purchaseModal, setPurchaseModal] = useState({ isOpen: false, req: null });
  const [purchaseForm, setPurchaseForm] = useState({ supplier: '', cost: '', proof: [] });
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);

  const handleOpenPurchaseModal = (req) => {
    setPurchaseModal({ isOpen: true, req });
    setPurchaseForm({ supplier: '', cost: '', proof: [] });
  };

  const handleClosePurchaseModal = () => {
    setPurchaseModal({ isOpen: false, req: null });
    setPurchaseForm({ supplier: '', cost: '', proof: [] });
  };

  const handleProofUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPurchaseForm((prev) => ({ ...prev, proof: [...prev.proof, ...files] }));
    e.target.value = '';
  };

  const handleRemoveProof = (idx) => {
    setPurchaseForm((prev) => ({ ...prev, proof: prev.proof.filter((_, i) => i !== idx) }));
  };

  const handleSubmitPurchase = async (e) => {
    e.preventDefault();
    if (!purchaseForm.supplier.trim()) {
      toast.danger('Indica el proveedor con quien se realizó la compra.');
      return;
    }
    if (!purchaseForm.cost || Number(purchaseForm.cost) <= 0) {
      toast.danger('Indica el costo total de la compra.');
      return;
    }
    if (purchaseForm.proof.length === 0) {
      toast.danger('Adjunta al menos un comprobante de pago.');
      return;
    }
    setIsSubmittingPurchase(true);
    const res = await markAsPurchased(purchaseModal.req.id, {
      purchasedBy: user.name,
      supplier: purchaseForm.supplier,
      cost: Number(purchaseForm.cost),
      purchaseProof: purchaseForm.proof,
    });
    setIsSubmittingPurchase(false);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudo registrar la compra.');
      return;
    }
    toast.success(`💳 Compra registrada para ${purchaseModal.req.id}. Se notificó al solicitante y a Dirección.`);
    handleClosePurchaseModal();
  };

  const handleConfirmReceipt = (req) => {
    markAsReceived(req.id, user.name);
    toast.success(`📦 Requisición ${req.id} cerrada como recibida.`);
  };

  // ============================================
  // ESTADO - MODAL DE DATOS DE PAGO (SOLICITANTE)
  // ============================================
  const [paymentModal, setPaymentModal] = useState({ isOpen: false, req: null });
  const [paymentForm, setPaymentForm] = useState({ paymentDetails: '', paymentDetailsFile: [] });
  const [isSubmittingPaymentInfo, setIsSubmittingPaymentInfo] = useState(false);

  const handleOpenPaymentModal = (req) => {
    setPaymentModal({ isOpen: true, req });
    setPaymentForm({
      paymentDetails: req.paymentDetails || '',
      paymentDetailsFile: req.paymentDetailsFile || [],
    });
  };

  const handleClosePaymentModal = () => {
    setPaymentModal({ isOpen: false, req: null });
    setPaymentForm({ paymentDetails: '', paymentDetailsFile: [] });
  };

  const handlePaymentFileUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPaymentForm((prev) => ({ ...prev, paymentDetailsFile: [...prev.paymentDetailsFile, ...files] }));
    e.target.value = '';
  };

  const handleRemovePaymentFile = (idx) => {
    setPaymentForm((prev) => ({ ...prev, paymentDetailsFile: prev.paymentDetailsFile.filter((_, i) => i !== idx) }));
  };

  const handleSubmitPaymentInfo = async (e) => {
    e.preventDefault();
    if (!paymentForm.paymentDetails.trim() && paymentForm.paymentDetailsFile.length === 0) {
      toast.warning('Agrega el texto con los datos de pago o adjunta un archivo con esa información.');
      return;
    }
    setIsSubmittingPaymentInfo(true);
    const res = await addPaymentDetails(paymentModal.req.id, {
      paymentDetails: paymentForm.paymentDetails,
      paymentDetailsFile: paymentForm.paymentDetailsFile,
    });
    setIsSubmittingPaymentInfo(false);
    if (!res.ok) {
      toast.danger(res.error || 'No se pudieron guardar los datos de pago.');
      return;
    }
    toast.success(`💳 Datos de pago guardados para ${paymentModal.req.id}.`);
    handleClosePaymentModal();
  };

  // ============================================
  // FILTRADO POR ROL
  // ============================================
  const pendientesAutorizacion = useMemo(
    () => requisiciones.filter((r) => r.status === 'pendiente'),
    [requisiciones]
  );
  const autorizadasPendientesCompra = useMemo(
    () => requisiciones.filter((r) => r.status === 'autorizada'),
    [requisiciones]
  );
  const misSolicitudes = useMemo(() => {
    if (isAdmin) return requisiciones;
    return requisiciones.filter((r) => r.requestedByUserId === user?.id);
  }, [requisiciones, isAdmin, user]);

  const containerVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };
  const itemVariants = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  };

  // ============================================
  // COMPONENTE INTERNO - ENLACE DE ADJUNTO (PREVISUALIZAR + DESCARGAR)
  // ============================================
  const AttachmentLink = ({ att, icon = '📎' }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <button
        type="button"
        onClick={() => setPreviewFile(att)}
        style={{
          fontSize: '12px', color: 'var(--color-primary)', textDecoration: 'underline',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
        }}
        title="Ver previsualización"
      >
        {icon} {att.name}
      </button>
      <a href={att.url} download={att.name} title="Descargar archivo" style={{ fontSize: '12px', textDecoration: 'none' }}>
        ⬇️
      </a>
    </span>
  );

  // ============================================
  // COMPONENTE INTERNO - TARJETA DE REQUISICIÓN
  // ============================================
  const RequisitionCard = ({ req, children }) => {
    const areaName = dynamicAreas.find((a) => a.id === req.areaId)?.name || req.areaId;
    return (
      <Card variant="default" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: '14px' }}>{req.id} — {areaName}</strong>
            <div style={{ fontSize: '12px', color: 'var(--color-gray-600)' }}>
              Solicitó: {req.requestedBy} • {new Date(req.createdAt).toLocaleDateString()}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <Badge variant={req.priority === 'urgente' ? 'danger' : 'neutral'}>{PRIORITY_LABELS[req.priority]}</Badge>
            <Badge variant={STATUS_BADGE_VARIANT[req.status]}>{REQUISITION_STATUS_LABELS[req.status]}</Badge>
          </div>
        </div>

        <RequisicionTracker req={req} />

        <div style={{ margin: '10px 0', fontSize: '13px' }}>
          {req.items.map((it, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--color-gray-100)' }}>
              <span>🔧 {it.name}</span>
              <strong>{it.quantity} {it.unit}</strong>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '13px', color: 'var(--color-gray-700)', margin: '0 0 8px 0' }}>
          <strong>Justificación:</strong> {req.justification}
        </p>

        {req.attachments && req.attachments.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-secondary)' }}>📄 Cotización:</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
              {req.attachments.map((att, idx) => (
                <AttachmentLink key={idx} att={att} />
              ))}
            </div>
          </div>
        )}

        {(req.paymentDetails || (req.paymentDetailsFile && req.paymentDetailsFile.length > 0)) && (
          <div style={{ background: 'rgba(153, 51, 255, 0.06)', borderLeft: '3px solid var(--color-purple-x11)', padding: '8px 10px', borderRadius: '4px', fontSize: '12px', marginBottom: '8px' }}>
            <strong>💳 Datos de Pago del Proveedor:</strong>
            {req.paymentDetails && <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{req.paymentDetails}</p>}
            {req.paymentDetailsFile && req.paymentDetailsFile.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
                {req.paymentDetailsFile.map((att, idx) => (
                  <AttachmentLink key={idx} att={att} icon="📄" />
                ))}
              </div>
            )}
          </div>
        )}

        {req.status === 'regresada' && req.reviewNotes && (
          <div style={{ background: 'rgba(220, 38, 38, 0.06)', borderLeft: '3px solid var(--color-danger)', padding: '8px 10px', borderRadius: '4px', fontSize: '12px', marginBottom: '8px' }}>
            <strong>Motivo de Dirección:</strong> {req.reviewNotes}
          </div>
        )}

        {req.status === 'autorizada' && req.reviewNotes && (
          <div style={{ background: 'rgba(16, 185, 129, 0.06)', borderLeft: '3px solid var(--color-success)', padding: '8px 10px', borderRadius: '4px', fontSize: '12px', marginBottom: '8px' }}>
            <strong>Autorizado por {req.reviewedBy}:</strong> {req.reviewNotes}
          </div>
        )}

        {(req.status === 'comprada' || req.status === 'recibida') && (
          <div style={{ background: 'rgba(0, 153, 204, 0.06)', borderLeft: '3px solid var(--color-tiffany-blue)', padding: '8px 10px', borderRadius: '4px', fontSize: '12px', marginBottom: '8px' }}>
            <div><strong>Proveedor:</strong> {req.supplier} • <strong>Costo:</strong> ${req.cost}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px' }}>
              {(req.purchaseProof || []).map((att, idx) => (
                <AttachmentLink key={idx} att={att} icon="🧾" />
              ))}
            </div>
          </div>
        )}

        {isAdmin && req.status !== 'recibida' && req.status !== 'comprada' && (
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--color-gray-100)', display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteConfirm({ isOpen: true, req })}
              style={{ color: 'var(--color-danger)' }}
            >
              🗑️ Eliminar Requisición
            </Button>
          </div>
        )}

        {children}
      </Card>
    );
  };

  return (
    <motion.div variants={containerVariants} initial="initial" animate="animate">
      <PageHeader
        title="Requisiciones de Compra"
        subtitle="Solicita, autoriza y da seguimiento a la compra de materiales para las áreas y la fábrica."
        shape="arco-doble"
        accentColor="var(--color-princeton-orange)"
      >
        {isSolicitante && solicitanteAreaOptions.length > 0 && (
          <Button variant="primary" size="md" onClick={handleOpenCreateModal}>
            ➕ Nueva Requisición
          </Button>
        )}
      </PageHeader>

      {/* SECCIÓN: PENDIENTES DE AUTORIZACIÓN (DIRECCIÓN) */}
      {isDireccion && (
        <motion.div variants={itemVariants} style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={{ marginBottom: '10px' }}>🕓 Pendientes de tu Autorización ({pendientesAutorizacion.length})</h3>
          {pendientesAutorizacion.length === 0 && (
            <EmptyState message="No hay requisiciones pendientes de autorización." shape="arco-doble" color="var(--color-princeton-orange)" />
          )}
          {pendientesAutorizacion.map((req) => (
            <RequisitionCard key={req.id} req={req}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="primary" size="sm" onClick={() => handleOpenReviewModal(req, 'authorize')}>
                  ✅ Autorizar
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleOpenReviewModal(req, 'return')}>
                  ↩️ Regresar
                </Button>
              </div>
            </RequisitionCard>
          ))}
        </motion.div>
      )}

      {/* SECCIÓN: AUTORIZADAS, PENDIENTES DE COMPRA (COMPRAS) */}
      {isCompras && (
        <motion.div variants={itemVariants} style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={{ marginBottom: '10px' }}>💳 Autorizadas — Pendientes de Compra ({autorizadasPendientesCompra.length})</h3>
          {autorizadasPendientesCompra.length === 0 && (
            <EmptyState message="No hay requisiciones autorizadas pendientes de compra." shape="anillo" color="var(--color-tiffany-blue)" />
          )}
          {autorizadasPendientesCompra.map((req) => (
            <RequisitionCard key={req.id} req={req}>
              <Button variant="primary" size="sm" onClick={() => handleOpenPurchaseModal(req)}>
                💳 Registrar Compra
              </Button>
            </RequisitionCard>
          ))}
        </motion.div>
      )}

      {/* SECCIÓN: MIS SOLICITUDES (SOLICITANTE) */}
      {isSolicitante && (
        <motion.div variants={itemVariants} style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={{ marginBottom: '10px' }}>📋 {isAdmin ? 'Todas las Solicitudes' : 'Mis Solicitudes'} ({misSolicitudes.length})</h3>
          {misSolicitudes.length === 0 && (
            <EmptyState message="Aún no has creado ninguna requisición." shape="cacahuate" color="var(--color-princeton-orange)" />
          )}
          {misSolicitudes.map((req) => (
            <RequisitionCard key={req.id} req={req}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {req.status === 'regresada' && (
                  <Button variant="primary" size="sm" onClick={() => handleOpenEditModal(req)}>
                    ✏️ Corregir y Reenviar
                  </Button>
                )}
                {['autorizada', 'comprada', 'recibida'].includes(req.status) && (
                  <Button variant="secondary" size="sm" onClick={() => handleOpenPaymentModal(req)}>
                    {req.paymentDetails || (req.paymentDetailsFile && req.paymentDetailsFile.length > 0)
                      ? '✏️ Editar Datos de Pago'
                      : '💳 Agregar Datos de Pago (opcional)'}
                  </Button>
                )}
                {req.status === 'comprada' && (
                  <Button variant="primary" size="sm" onClick={() => handleConfirmReceipt(req)}>
                    ✅ Confirmar Recepción del Comprobante
                  </Button>
                )}
              </div>
            </RequisitionCard>
          ))}
        </motion.div>
      )}

      {/* SECCIÓN: HISTORIAL GENERAL (DIRECCIÓN / COMPRAS / ADMIN) */}
      {(isDireccion || isCompras) && (
        <motion.div variants={itemVariants}>
          <h3 style={{ marginBottom: '10px' }}>📚 Historial General ({requisiciones.length})</h3>
          {requisiciones.map((req) => (
            <RequisitionCard key={req.id} req={req} />
          ))}
        </motion.div>
      )}

      {/* ============================================
          MODAL: CREAR / CORREGIR Y REENVIAR REQUISICIÓN
          ============================================ */}
      <Modal
        isOpen={formModal.isOpen}
        onClose={handleCloseFormModal}
        title={formModal.mode === 'edit' ? 'Corregir y Reenviar Requisición' : 'Nueva Requisición de Compra'}
      >
        <form onSubmit={handleSubmitForm} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <Select
              label="Área Solicitante"
              value={form.areaId}
              onChange={(e) => setForm((prev) => ({ ...prev, areaId: e.target.value }))}
              required
              options={solicitanteAreaOptions.map((a) => ({ value: a.id, label: a.name }))}
            />
          </div>

          <div>
            <label style={labelStyle}>Materiales Solicitados</label>
            {form.items.map((it, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'flex-start' }}>
                <ItemAutocomplete
                  value={{ name: it.name, itemId: it.itemId }}
                  onChange={(val) => {
                    handleItemChange(idx, 'name', val.name);
                    handleItemChange(idx, 'itemId', val.itemId);
                  }}
                />
                <input
                  type="number"
                  min="1"
                  value={it.quantity}
                  onChange={(e) => handleItemChange(idx, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                  style={{ ...inputStyle, width: '70px' }}
                />
                <input
                  type="text"
                  placeholder="Unidad"
                  value={it.unit}
                  onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                  style={{ ...inputStyle, width: '70px' }}
                />
                {form.items.length > 1 && (
                  <button type="button" onClick={() => handleRemoveItemRow(idx)} style={{ border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={handleAddItemRow}>
              ➕ Agregar Material
            </Button>
          </div>

          <div>
            <label style={labelStyle}>Justificación</label>
            <textarea
              value={form.justification}
              onChange={(e) => setForm((prev) => ({ ...prev, justification: e.target.value }))}
              placeholder="Describe la necesidad y el uso que se le dará al material..."
              rows="3"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <Select
              label="Prioridad"
              value={form.priority}
              onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'urgente', label: 'Urgente' },
              ]}
            />
          </div>

          <div>
            <label style={labelStyle}>Cotización del Proveedor (Opcional)</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              style={{ display: 'none' }}
              id="requisicion-attachments"
              onChange={handleAttachmentUpload}
              disabled={isSubmittingForm}
            />
            <label
              htmlFor="requisicion-attachments"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                cursor: isSubmittingForm ? 'wait' : 'pointer', border: '1px dashed var(--color-primary)',
                backgroundColor: 'rgba(255, 153, 51, 0.06)', fontWeight: 600, color: 'var(--color-primary)',
                height: '42px', borderRadius: '8px', opacity: isSubmittingForm ? 0.6 : 1,
              }}
            >
              📎 Adjuntar Cotización (PDF o imagen)
            </label>
            <span style={{ fontSize: '11px', color: 'var(--color-gray-500)', display: 'block', marginTop: '4px' }}>
              Puedes adjuntar más de un archivo si la cotización tiene varias páginas o incluye otros documentos.
            </span>
            {form.attachments.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {form.attachments.map((att, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span>📄 {att.name}</span>
                    <button type="button" onClick={() => handleRemoveAttachment(idx)} style={{ border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseFormModal} disabled={isSubmittingForm}>Cancelar</Button>
            <Button type="submit" variant="primary" size="md" disabled={isSubmittingForm}>
              {isSubmittingForm ? '⏳ Guardando...' : (formModal.mode === 'edit' ? 'Reenviar Requisición' : 'Crear Requisición')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================
          MODAL: AUTORIZAR / REGRESAR (DIRECCIÓN)
          ============================================ */}
      <Modal
        isOpen={reviewModal.isOpen}
        onClose={handleCloseReviewModal}
        title={reviewModal.action === 'authorize' ? `✅ Autorizar ${reviewModal.req?.id}` : `↩️ Regresar ${reviewModal.req?.id}`}
      >
        <form onSubmit={handleSubmitReview} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={labelStyle}>
            {reviewModal.action === 'authorize' ? 'Observaciones (opcional)' : 'Motivo por el que se regresa *'}
          </label>
          <textarea
            value={reviewModal.notes}
            onChange={(e) => setReviewModal((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder={reviewModal.action === 'authorize' ? 'Ej: Autorizada, dentro del presupuesto del proyecto.' : 'Ej: Falta cotización del proveedor, corrige y reenvía.'}
            rows="3"
            style={{ ...inputStyle, resize: 'vertical' }}
            required={reviewModal.action === 'return'}
          />

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseReviewModal}>Cancelar</Button>
            <Button type="submit" variant="primary" size="md">
              {reviewModal.action === 'authorize' ? 'Confirmar Autorización' : 'Confirmar Devolución'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================
          MODAL: CONFIRMAR CONTRASEÑA DE DIRECCIÓN (PREVIO A AUTORIZAR)
          ============================================ */}
      <Modal
        isOpen={passwordConfirmModal.isOpen}
        onClose={handleClosePasswordConfirmModal}
        title={`🔒 Confirmar Identidad: ${passwordConfirmModal.req?.id || ''}`}
      >
        <form onSubmit={handleSubmitPasswordConfirm} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ fontSize: '12px', color: 'var(--color-gray-600)', margin: 0 }}>
            Por seguridad, toda autorización requiere confirmar tu contraseña de Dirección.
          </p>
          <div>
            <label style={labelStyle}>Contraseña *</label>
            <input
              type="password"
              value={passwordConfirmModal.password}
              onChange={(e) => setPasswordConfirmModal((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="Ingresa tu contraseña"
              style={inputStyle}
              required
              autoFocus
              autoComplete="current-password"
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleClosePasswordConfirmModal}>Cancelar</Button>
            <Button type="submit" variant="primary" size="md">Confirmar</Button>
          </div>
        </form>
      </Modal>

      {/* ============================================
          MODAL: REGISTRAR COMPRA (COMPRAS)
          ============================================ */}
      <Modal
        isOpen={purchaseModal.isOpen}
        onClose={handleClosePurchaseModal}
        title={`💳 Registrar Compra: ${purchaseModal.req?.id}`}
      >
        <form onSubmit={handleSubmitPurchase} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={labelStyle}>Proveedor</label>
            <input
              type="text"
              value={purchaseForm.supplier}
              onChange={(e) => setPurchaseForm((prev) => ({ ...prev, supplier: e.target.value }))}
              placeholder="Ej: Ferretería Industrial del Norte"
              style={inputStyle}
              required
            />
          </div>
          <div>
            <label style={labelStyle}>Costo Total ($)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={purchaseForm.cost}
              onChange={(e) => setPurchaseForm((prev) => ({ ...prev, cost: e.target.value }))}
              style={inputStyle}
              required
            />
          </div>
          <div>
            <label style={labelStyle}>Comprobante de Pago (factura, ticket, transferencia) *</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              style={{ display: 'none' }}
              id="purchase-proof-upload"
              onChange={handleProofUpload}
              disabled={isSubmittingPurchase}
            />
            <label
              htmlFor="purchase-proof-upload"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                cursor: isSubmittingPurchase ? 'wait' : 'pointer', border: '1px dashed var(--color-primary)',
                backgroundColor: 'rgba(0, 153, 204, 0.06)', fontWeight: 600, color: 'var(--color-primary)',
                height: '42px', borderRadius: '8px', opacity: isSubmittingPurchase ? 0.6 : 1,
              }}
            >
              🧾 Adjuntar Comprobante
            </label>
            {purchaseForm.proof.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {purchaseForm.proof.map((att, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span>📄 {att.name}</span>
                    <button type="button" onClick={() => handleRemoveProof(idx)} style={{ border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleClosePurchaseModal} disabled={isSubmittingPurchase}>Cancelar</Button>
            <Button type="submit" variant="primary" size="md" disabled={isSubmittingPurchase}>
              {isSubmittingPurchase ? '⏳ Guardando...' : 'Confirmar Compra'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================
          MODAL: DATOS DE PAGO DEL PROVEEDOR (SOLICITANTE)
          ============================================ */}
      <Modal
        isOpen={paymentModal.isOpen}
        onClose={handleClosePaymentModal}
        title={`💳 Datos de Pago: ${paymentModal.req?.id}`}
      >
        <form onSubmit={handleSubmitPaymentInfo} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ fontSize: '12px', color: 'var(--color-gray-600)', margin: 0 }}>
            Ambos campos son opcionales — llénalos solo si la cotización adjunta no incluye ya los datos de pago del proveedor.
          </p>
          <div>
            <label style={labelStyle}>Datos de Pago (banco, cuenta, CLABE, etc.)</label>
            <textarea
              value={paymentForm.paymentDetails}
              onChange={(e) => setPaymentForm((prev) => ({ ...prev, paymentDetails: e.target.value }))}
              placeholder="Ej: Banco XYZ, Cuenta 1234567890, CLABE 012345678901234567, a nombre de..."
              rows="4"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={labelStyle}>O Adjunta un PDF/Imagen con los Datos de Pago</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              style={{ display: 'none' }}
              id="payment-details-file-upload"
              onChange={handlePaymentFileUpload}
              disabled={isSubmittingPaymentInfo}
            />
            <label
              htmlFor="payment-details-file-upload"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                cursor: isSubmittingPaymentInfo ? 'wait' : 'pointer', border: '1px dashed var(--color-purple-x11)',
                backgroundColor: 'rgba(153, 51, 255, 0.06)', fontWeight: 600, color: 'var(--color-purple-x11)',
                height: '42px', borderRadius: '8px', opacity: isSubmittingPaymentInfo ? 0.6 : 1,
              }}
            >
              📄 Adjuntar Archivo
            </label>
            {paymentForm.paymentDetailsFile.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {paymentForm.paymentDetailsFile.map((att, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span>📄 {att.name}</span>
                    <button type="button" onClick={() => handleRemovePaymentFile(idx)} style={{ border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleClosePaymentModal} disabled={isSubmittingPaymentInfo}>Cancelar</Button>
            <Button type="submit" variant="primary" size="md" disabled={isSubmittingPaymentInfo}>
              {isSubmittingPaymentInfo ? '⏳ Guardando...' : 'Guardar Datos de Pago'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================
          MODAL: PREVISUALIZACIÓN DE ADJUNTOS
          ============================================ */}
      <Modal
        isOpen={Boolean(previewFile)}
        onClose={() => setPreviewFile(null)}
        title={`👁️ ${previewFile?.name || ''}`}
      >
        {previewFile && previewUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {isPdfAttachment(previewFile) ? (
              <iframe
                src={previewUrl}
                title={previewFile.name}
                style={{ width: '100%', height: '65vh', border: '1px solid var(--color-gray-200)', borderRadius: '8px' }}
              />
            ) : (
              <img
                src={previewUrl}
                alt={previewFile.name}
                style={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: '8px' }}
              />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <a href={previewUrl} download={previewFile.name} style={{ textDecoration: 'none' }}>
                <Button type="button" variant="primary" size="sm">⬇️ Descargar</Button>
              </a>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- MODAL: CONFIRMAR ELIMINACIÓN DE REQUISICIÓN (solo Admin) ---------- */}
      <Modal isOpen={deleteConfirm.isOpen} onClose={handleCloseDeleteConfirm} title="🗑️ Eliminar Requisición">
        {deleteConfirm.req && (
          <div style={{ padding: 'var(--space-2) 0' }}>
            <p style={{ marginBottom: 'var(--space-4)' }}>
              ¿Eliminar la requisición <strong>{deleteConfirm.req.id}</strong> ({AREAS_CATALOG.find((a) => a.id === deleteConfirm.req.areaId)?.name || deleteConfirm.req.areaId})?
            </p>
            <p style={{ fontSize: '12.5px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
              Esta acción es permanente: se borra el registro y todos sus archivos adjuntos (cotización, datos de pago, comprobante de compra). No se puede deshacer.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="md" onClick={handleCloseDeleteConfirm}>Cancelar</Button>
              <Button variant="danger" size="md" onClick={handleConfirmDeleteRequisicion} isLoading={isDeletingReq}>
                Eliminar Definitivamente
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};

export default ComprasPage;
