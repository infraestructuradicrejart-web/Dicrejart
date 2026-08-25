/**
 * @file RutaFabricacionView.jsx
 * @description Vista de la Ruta de Fabricación de un Juego: sus áreas en el orden real de
 * producción, con cuota de piezas y Puntos de Calidad opcionales (checklist con evidencia
 * fotográfica — "auditorías a piezas"). Reusa el mismo lenguaje visual de nodos del Editor
 * Visual (EditorVisualPage.module.css: cabecera de color + cuerpo, puertos, iconografía),
 * pero lee/escribe directamente `juegos/{id}` — no el lienzo compartido `lienzos/general` —
 * porque el orden, la cuota y la revisión de calidad ya son responsabilidad de Producción,
 * no del lienzo libre. Exclusiva de juegos con `useManufacturingRoute: true`; los juegos
 * existentes (sin ese flag) no se ven afectados en nada.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires react-router-dom
 */

import React, { useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import useProduccion from '../../hooks/useProduccion';
import useAreas from '../../hooks/useAreas';
import useAuth from '../../hooks/useAuth';
import useToast from '../../hooks/useToast';
import { isAreaBlockedByRoute, AREA_SEQUENCE_DEPENDENCIES } from '../../context/ProduccionContext';
import { canUserEditRoute, isReadOnlySection } from '../../utils/roleAccess';
import RegisterDeliveryModal from './RegisterDeliveryModal';
import evStyles from './EditorVisualPage.module.css';
import styles from './RutaFabricacionView.module.css';

const QUALITY_COLOR = '#16a34a';
const AREA_COLOR = '#6366f1';
const LOCKED_COLOR = '#9CA3AF';

/** Intercambia dos posiciones de un arreglo sin mutar el original */
const swap = (arr, i, j) => {
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/** true si `order` deja alguna dependencia fija (ej. Herrería) antes de su área requerida */
const wouldBreakFixedSequence = (order) =>
  Object.entries(AREA_SEQUENCE_DEPENDENCIES).some(([dependent, required]) => {
    if (!order.includes(dependent) || !order.includes(required)) return false;
    return order.indexOf(dependent) < order.indexOf(required);
  });

/**
 * Tarjeta del Punto de Calidad insertado tras un área: checklist con evidencia fotográfica
 * (reusa qualityReview.{areaId}, ya existente en ProduccionContext) + aprobar/rechazar.
 */
const QualityGateCard = ({ game, areaId, canEdit, toast }) => {
  const {
    addQualityChecklistItem,
    toggleQualityChecklistItem,
    removeQualityChecklistItem,
    addQualityItemPhotos,
    removeQualityItemPhoto,
    approveQualityReview,
    rejectQualityReview,
  } = useProduccion();
  const { user } = useAuth();
  const [newItemText, setNewItemText] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRefs = useRef({});

  const review = game.qualityReview?.[areaId] || {
    checklist: [], status: 'pendiente', reviewedBy: null, reviewedAt: null, notes: '',
  };
  const allChecked = review.checklist.length > 0 && review.checklist.every((it) => it.checked);

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItemText.trim()) return;
    await addQualityChecklistItem(game.id, areaId, newItemText.trim());
    setNewItemText('');
  };

  const handleAddPhotos = async (itemId, files) => {
    if (!files || files.length === 0) return;
    const res = await addQualityItemPhotos(game.id, areaId, itemId, files);
    if (!res.ok) toast.danger(res.error);
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    const res = await approveQualityReview(game.id, areaId, user?.name || 'Usuario', notes);
    setIsSubmitting(false);
    if (res.ok) toast.success('✓ Punto de Calidad aprobado.');
    else toast.danger(res.error);
  };

  const handleReject = async () => {
    setIsSubmitting(true);
    const res = await rejectQualityReview(game.id, areaId, user?.name || 'Usuario', notes);
    setIsSubmitting(false);
    if (res?.ok !== false) toast.info('Punto de Calidad rechazado.');
  };

  return (
    <div className={styles.routeCard} style={{ '--node-color': QUALITY_COLOR }}>
      <div className={evStyles.nodeHead}>
        <span className={evStyles.nodeIcon}>🔍</span>
        <span className={evStyles.nodeTitle}>Punto de Calidad</span>
      </div>
      <div className={evStyles.nodeBody}>
        <span
          className={`${styles.statusPill} ${
            review.status === 'aprobado' ? styles.done : review.status === 'rechazado' ? styles.rejected : styles.pending
          }`}
        >
          {review.status === 'aprobado' ? '✓ Aprobado' : review.status === 'rechazado' ? '✕ Rechazado' : '⏳ Pendiente'}
        </span>

        <div className={styles.checklist}>
          {review.checklist.map((item) => (
            <div key={item.id} className={styles.checklistItem}>
              <label className={styles.checklistLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(item.checked)}
                  disabled={!canEdit}
                  onChange={() => toggleQualityChecklistItem(game.id, areaId, item.id)}
                />
                <span className={item.checked ? styles.checklistTextDone : ''}>{item.text}</span>
              </label>

              {(item.photos || []).length > 0 && (
                <div className={styles.photoRow}>
                  {item.photos.map((photo) => (
                    <div key={photo.path} className={styles.photoThumb}>
                      <img src={photo.url} alt="Evidencia" />
                      {canEdit && (
                        <button
                          type="button"
                          className={styles.photoRemove}
                          title="Quitar foto"
                          onClick={() => removeQualityItemPhoto(game.id, areaId, item.id, photo)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {canEdit && (
                <div className={styles.itemActions}>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    ref={(el) => { fileInputRefs.current[item.id] = el; }}
                    onChange={(e) => handleAddPhotos(item.id, e.target.files)}
                  />
                  <button type="button" className={styles.linkBtn} onClick={() => fileInputRefs.current[item.id]?.click()}>
                    📷 Evidencia
                  </button>
                  <button type="button" className={styles.linkBtnDanger} onClick={() => removeQualityChecklistItem(game.id, areaId, item.id)}>
                    Quitar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <>
            <form className={styles.addItemForm} onSubmit={handleAddItem}>
              <input
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                placeholder="Nuevo punto a revisar..."
                className={styles.addItemInput}
              />
              <button type="submit" className={styles.iconBtn} title="Agregar punto">+</button>
            </form>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas de la revisión (opcional)"
              className={styles.notesInput}
              rows={2}
            />

            <div className={styles.gateApproveRow}>
              <Button variant="primary" size="sm" isDisabled={!allChecked || isSubmitting} isLoading={isSubmitting} onClick={handleApprove}>
                Aprobar
              </Button>
              <Button variant="danger" size="sm" isDisabled={isSubmitting} onClick={handleReject}>
                Rechazar
              </Button>
            </div>
            {!allChecked && (
              <span className={styles.caption}>Marca todos los puntos del checklist antes de aprobar.</span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

QualityGateCard.propTypes = {
  game: PropTypes.object.isRequired,
  areaId: PropTypes.string.isRequired,
  canEdit: PropTypes.bool.isRequired,
  toast: PropTypes.object.isRequired,
};

const RutaFabricacionView = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Vuelve al mismo lienzo del que vino (ver LienzoSwitcherModal.jsx) — sin ?from cae
  // en el lienzo general de siempre, igual que antes de que existieran varios lienzos.
  const backTo = searchParams.get('from') ? `/editor-visual/${searchParams.get('from')}` : '/editor-visual';
  const { juegos, reorderGameAreas, setQualityGate } = useProduccion();
  const { areas: dynamicAreas } = useAreas();
  const { user } = useAuth();
  const toast = useToast();
  const [deliveryAreaId, setDeliveryAreaId] = useState(null);

  const game = juegos.find((j) => j.id === gameId);
  const areaName = (id) => dynamicAreas.find((a) => a.id === id)?.name || id;

  if (!game) {
    return (
      <div className={evStyles.page}>
        <PageHeader title="Ruta de Fabricación" subtitle="Juego no encontrado." shape="arco-doble" accentColor="var(--color-secondary)">
          <Button variant="secondary" size="sm" onClick={() => navigate(backTo)}>← Volver al Lienzo</Button>
        </PageHeader>
        <EmptyState message="No se encontró este juego." />
      </div>
    );
  }

  if (!game.useManufacturingRoute) {
    return (
      <div className={evStyles.page}>
        <PageHeader title={`Ruta de Fabricación — ${game.name}`} subtitle="Este juego no usa Ruta de Fabricación." shape="arco-doble" accentColor="var(--color-secondary)">
          <Button variant="secondary" size="sm" onClick={() => navigate(backTo)}>← Volver al Lienzo</Button>
        </PageHeader>
        <EmptyState message="Este juego se creó antes de la Ruta de Fabricación (o sin activarla) y sigue trabajando en paralelo, como siempre — nada que ver aquí." />
      </div>
    );
  }

  const canEdit = canUserEditRoute(user, game);
  const areas = game.areas || [];

  const moveArea = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= areas.length) return;
    const res = await reorderGameAreas(game.id, swap(areas, index, targetIndex));
    if (!res.ok) toast.danger(res.error);
  };

  const handleToggleGate = async (areaId, hasGate) => {
    const res = await setQualityGate(game.id, areaId, !hasGate);
    if (!res.ok) toast.danger(res.error);
  };

  return (
    <div className={evStyles.page}>
      <PageHeader
        title={`Ruta de Fabricación — ${game.name}`}
        subtitle={`Proyecto: ${game.projectName}. El orden es real: cada área espera a que la anterior complete su meta (y su Punto de Calidad, si tiene uno).`}
        shape="arco-doble"
        accentColor="var(--color-secondary)"
      >
        <Button variant="secondary" size="sm" onClick={() => navigate(backTo)}>← Lienzo General</Button>
      </PageHeader>

      {!canEdit && (
        <div className={`${evStyles.calloutBox} ${styles.readOnlyBanner}`}>
          👁️ Estás viendo esta ruta en modo solo lectura — solo el Encargado del Área, Supervisor, Admin, Dirección o Calidad pueden editarla.
        </div>
      )}

      {areas.length === 0 ? (
        <EmptyState message="Este juego todavía no tiene áreas en su ruta." />
      ) : (
        <div className={styles.chainScroll}>
          <div className={styles.chainRow}>
            {areas.map((areaId, index) => {
              const locked = isAreaBlockedByRoute(game, areaId);
              const produced = game.producedPieces?.[areaId] || 0;
              const target = game.targetPieces?.[areaId] || 0;
              const pct = target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : 0;
              const status = game.areaStatus?.[areaId] || 'pendiente';
              const hasGate = (game.qualityGates || []).includes(areaId);
              const isPinned = Boolean(AREA_SEQUENCE_DEPENDENCIES[areaId]) && areas.includes(AREA_SEQUENCE_DEPENDENCIES[areaId]);
              const canMoveUp = index > 0 && !wouldBreakFixedSequence(swap(areas, index, index - 1));
              const canMoveDown = index < areas.length - 1 && !wouldBreakFixedSequence(swap(areas, index, index + 1));

              return (
                <React.Fragment key={areaId}>
                  <div className={`${styles.routeCard} ${locked ? styles.locked : ''}`} style={{ '--node-color': locked ? LOCKED_COLOR : AREA_COLOR }}>
                    <span className={styles.orderBadge}>{index + 1}</span>
                    {isPinned && (
                      <span className={styles.pinnedBadge} title="Posición fija: siempre después de Corte Láser">📌</span>
                    )}
                    <div className={evStyles.nodeHead}>
                      <span className={evStyles.nodeIcon}>{locked ? '🔒' : '🏭'}</span>
                      <span className={evStyles.nodeTitle}>{areaName(areaId)}</span>
                    </div>
                    <div className={evStyles.nodeBody}>
                      <div className={styles.qtyRow}><span>Piezas</span><span>{produced} / {target}</span></div>
                      <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${pct}%` }} /></div>
                      <span className={`${styles.statusPill} ${status === 'completado' ? styles.done : status === 'proceso' ? styles.progress : styles.pending}`}>
                        {status === 'completado' ? '✓ Completada' : status === 'proceso' ? '● En curso' : locked ? '🔒 Bloqueada' : '💤 Sin iniciar'}
                      </span>

                      {canEdit && (
                        <div className={styles.cardActions}>
                          <button type="button" className={styles.iconBtn} disabled={!canMoveUp} onClick={() => moveArea(index, -1)} title="Mover antes en la ruta">▲</button>
                          <button type="button" className={styles.iconBtn} disabled={!canMoveDown} onClick={() => moveArea(index, 1)} title="Mover después en la ruta">▼</button>
                          <button type="button" className={styles.gateToggle} onClick={() => handleToggleGate(areaId, hasGate)}>
                            {hasGate ? '✅ Calidad activa' : '🔍 + Punto de Calidad'}
                          </button>
                        </div>
                      )}
                      {/* Mismo permiso que ya usa ProduccionPage.jsx para esta área — no
                          el permiso de editar la ruta, que es distinto */}
                      {!locked && status !== 'completado' && !isReadOnlySection(user, 'produccion', areaId) && (
                        <button
                          type="button"
                          className={styles.gateToggle}
                          onClick={() => setDeliveryAreaId(areaId)}
                        >
                          📦 Registrar Entrega
                        </button>
                      )}
                    </div>
                  </div>

                  <div className={styles.connector}><span className={styles.arrow}>→</span></div>

                  {hasGate && (
                    <>
                      <QualityGateCard game={game} areaId={areaId} canEdit={canEdit} toast={toast} />
                      <div className={styles.connector}><span className={styles.arrow}>→</span></div>
                    </>
                  )}
                </React.Fragment>
              );
            })}

            <div className={`${styles.routeCard} ${styles.terminal}`} style={{ '--node-color': '#663399' }}>
              <div className={evStyles.nodeHead}>
                <span className={evStyles.nodeIcon}>🏁</span>
                <span className={evStyles.nodeTitle}>Producto Terminado</span>
              </div>
              <div className={evStyles.nodeBody}>
                <span className={styles.caption}>Recibe cuando todas las áreas de la ruta entreguen su parte.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <RegisterDeliveryModal
        isOpen={Boolean(deliveryAreaId)}
        onClose={() => setDeliveryAreaId(null)}
        game={game}
        areaId={deliveryAreaId}
        areaLabel={deliveryAreaId ? areaName(deliveryAreaId) : ''}
        toast={toast}
      />
    </div>
  );
};

export default RutaFabricacionView;
