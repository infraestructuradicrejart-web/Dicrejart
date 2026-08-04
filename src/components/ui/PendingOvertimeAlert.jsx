/**
 * @file PendingOvertimeAlert.jsx
 * @description Recordatorio para el rol Inspector de Calidad de que hay horas extra
 * pendientes de verificar. Aparece justo después de un login real con contraseña o de
 * desbloquear la pantalla de inactividad — nunca por solo navegar entre páginas — y
 * únicamente si hay pendientes "verificables" (el turno ya ocurrió, ver
 * isOvertimeVerifiable en overtimeRules.js). Se puede cerrar, pero eso no lo desactiva
 * permanentemente: vuelve a aparecer en el siguiente login/desbloqueo mientras sigan
 * quedando pendientes, y se oculta solo en cuanto el conteo llega a 0.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires react-router-dom
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import useOperarios from '../../hooks/useOperarios';
import { ROLE_TYPES } from '../../data/usersData';
import { isOvertimeVerifiable } from '../../utils/overtimeRules';
import Modal from './Modal';
import Button from './Button';

/**
 * Componente PendingOvertimeAlert
 * @component
 * @param {Object} props
 * @param {boolean} props.locked - Estado actual del bloqueo por inactividad, para
 *   detectar la transición bloqueado → desbloqueado (ver ProtectedRoute.jsx)
 * @returns {ReactElement|null}
 */
const PendingOvertimeAlert = ({ locked }) => {
  const { user, loginEventId } = useAuth();
  const { horasExtra } = useOperarios();
  const navigate = useNavigate();

  // Arranca oculta: sin un login real o un desbloqueo de por medio (ej. recargar la
  // página con una sesión ya restaurada), no debe aparecer sola.
  const [dismissed, setDismissed] = useState(true);
  const wasLockedRef = useRef(locked);

  // Reaparece en cada login real con contraseña (loginEventId solo avanza ahí, ver
  // AuthContext.jsx — nunca en una restauración silenciosa de sesión).
  useEffect(() => {
    setDismissed(false);
  }, [loginEventId]);

  // Reaparece en cada transición bloqueado → desbloqueado.
  useEffect(() => {
    if (wasLockedRef.current && !locked) {
      setDismissed(false);
    }
    wasLockedRef.current = locked;
  }, [locked]);

  const pendingCount = useMemo(() => {
    if (user?.roleType !== ROLE_TYPES.CALIDAD) return 0;
    return horasExtra.filter((h) => h.verificationStatus === 'pendiente' && isOvertimeVerifiable(h)).length;
  }, [horasExtra, user]);

  if (user?.roleType !== ROLE_TYPES.CALIDAD) return null;

  const isOpen = !dismissed && pendingCount > 0;

  return (
    <Modal isOpen={isOpen} onClose={() => setDismissed(true)} title="🕒 Horas Extra Pendientes de Verificar">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-dark)', lineHeight: 1.5 }}>
          Hay <strong>{pendingCount}</strong> autorización{pendingCount === 1 ? '' : 'es'} de tiempo extra
          (de hoy o de días anteriores) cuyo turno ya concluyó y todavía nadie confirmó si
          se cumplieron las tareas asignadas.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" size="md" onClick={() => setDismissed(true)}>
            Cerrar
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => {
              setDismissed(true);
              navigate('/calidad', { state: { openTab: 'horasExtra' } });
            }}
          >
            Ir a Verificar
          </Button>
        </div>
      </div>
    </Modal>
  );
};

PendingOvertimeAlert.propTypes = {
  locked: PropTypes.bool.isRequired,
};

export default PendingOvertimeAlert;
