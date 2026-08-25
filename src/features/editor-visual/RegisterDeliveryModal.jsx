/**
 * @file RegisterDeliveryModal.jsx
 * @description Modal para registrar una entrega de producción (piezas + evidencia) de un
 * área de la Ruta de Fabricación de un Juego — llama a `registerProductionLog`, la MISMA
 * función que ya usa `ProduccionPage.jsx`, así el Dashboard y los KPIs no notan ninguna
 * diferencia según por dónde se capturó. Replica las mismas validaciones que ya aplica esa
 * página (meta alcanzada, meta excedida, área bloqueada por secuencia). Componente
 * compartido: se abre tanto desde `RutaFabricacionView.jsx` (ficha por área) como desde la
 * tarjeta del nodo Juego en `EditorVisualPage.jsx` (lienzo libre), para no duplicar esta
 * lógica en dos lugares.
 * @author Dicrejart Dev Team
 * @requires react
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import useProduccion from '../../hooks/useProduccion';
import useAuth from '../../hooks/useAuth';
import { isAreaBlockedByRoute } from '../../context/ProduccionContext';
import evStyles from './EditorVisualPage.module.css';
import styles from './RutaFabricacionView.module.css';

const RegisterDeliveryModal = ({ isOpen, onClose, game, areaId, areaLabel, toast }) => {
  const { registerProductionLog } = useProduccion();
  const { user } = useAuth();
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!areaId) return null;

  const produced = game.producedPieces?.[areaId] || 0;
  const target = game.targetPieces?.[areaId] || 0;
  const remaining = Math.max(0, target - produced);
  const qty = Number(quantity) || 0;
  const isCompleted = produced >= target;
  const sequenceBlocked = isAreaBlockedByRoute(game, areaId);

  const resetAndClose = () => {
    setQuantity('');
    setNotes('');
    setFiles([]);
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (sequenceBlocked) {
      toast.danger('Esta área está bloqueada por la ruta — todavía no puede recibir entregas.');
      return;
    }
    if (isCompleted) {
      toast.danger('Esta área ya alcanzó su meta de piezas.');
      return;
    }
    if (!qty || qty <= 0) {
      toast.danger('Captura una cantidad válida.');
      return;
    }
    if (produced + qty > target) {
      toast.danger(`Solo faltan ${remaining} pza(s) para completar la meta — captura una cantidad menor.`);
      return;
    }

    setIsSubmitting(true);
    const res = await registerProductionLog({
      areaId,
      quantity: qty,
      operator: user?.name || 'Usuario',
      gameName: game.name,
      notes,
      photos: files,
    });
    setIsSubmitting(false);

    if (res.ok) {
      toast.success(`✓ ${qty} pza(s) registradas en ${areaLabel}.`);
      if (res.photoWarning) toast.info(res.photoWarning);
      resetAndClose();
    } else {
      toast.danger(res.error || 'No se pudo registrar la entrega.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} title={`📦 Registrar Entrega — ${areaLabel}`}>
      {sequenceBlocked ? (
        <div className={`${evStyles.calloutBox} ${styles.readOnlyBanner}`}>
          🔒 Esta área todavía está bloqueada por la ruta — no se pueden registrar entregas hasta que se desbloquee.
        </div>
      ) : isCompleted ? (
        <div className={`${evStyles.calloutBox} ${styles.readOnlyBanner}`}>
          ✓ Esta área ya alcanzó su meta de {target} pza(s).
        </div>
      ) : (
        <form onSubmit={handleSubmit} className={styles.deliveryForm}>
          <p className={styles.caption}>Faltan {remaining} de {target} pza(s) por completar esta área.</p>

          <label className={styles.createLabel} htmlFor="delivery-qty">Cantidad de piezas *</label>
          <input
            id="delivery-qty"
            type="number"
            min="1"
            max={remaining}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={styles.createInput}
            autoFocus
          />

          <label className={styles.createLabel} htmlFor="delivery-notes" style={{ marginTop: '10px' }}>Notas (opcional)</label>
          <textarea
            id="delivery-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={styles.notesInput}
            rows={2}
          />

          <label className={styles.createLabel} style={{ marginTop: '10px' }}>Evidencia fotográfica (opcional)</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />

          <div className={styles.gateApproveRow} style={{ marginTop: '16px' }}>
            <Button type="submit" variant="primary" size="sm" isDisabled={!qty || isSubmitting} isLoading={isSubmitting}>
              Registrar Entrega
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={resetAndClose} isDisabled={isSubmitting}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

RegisterDeliveryModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  game: PropTypes.object.isRequired,
  areaId: PropTypes.string,
  areaLabel: PropTypes.string,
  toast: PropTypes.object.isRequired,
};

export default RegisterDeliveryModal;
