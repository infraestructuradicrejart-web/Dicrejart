/**
 * @file AprobarRequisicionPage.jsx
 * @description Página pública (sin sesión iniciada) a la que llegan los botones del
 * correo de autorización de requisiciones: Dirección revisa el resumen y confirma
 * "Autorizar" o "Regresar" con un clic, sin tener que entrar a la app. La seguridad la
 * da el token de un solo uso de la URL, validado del lado del servidor
 * (Cloud Functions `getRequisicionByToken` / `resolveRequisicionByToken`).
 * @author Dicrejart Dev Team
 * @requires react-router-dom
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/ui/Logo';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { AREAS_CATALOG } from '../../data/areasConfig';
import { PRIORITY_LABELS } from '../../data/comprasData';

/**
 * Llama a las funciones de aprobación vía el rewrite de Firebase Hosting
 * (`/api/...`, ver firebase.json) en vez de `httpsCallable` — así Hosting invoca la
 * función con su propio permiso interno, sin que la función necesite ser pública.
 */
const callApi = async (path, body) => {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'No se pudo completar la solicitud.');
  }
  return data;
};

const pageStyle = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: 'linear-gradient(135deg, #fff5f0 0%, #f3eefc 100%)',
};

const cardStyle = { width: '100%', maxWidth: '560px' };

const labelStyle = { fontSize: '13px', fontWeight: 600, color: 'var(--color-secondary)', display: 'block', marginBottom: '6px' };

const textareaStyle = {
  width: '100%',
  padding: '10px',
  borderRadius: '8px',
  border: '1px solid var(--color-gray-200)',
  fontSize: '13px',
  resize: 'vertical',
};

const AprobarRequisicionPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const initialAccion = searchParams.get('accion') === 'regresar' ? 'regresar' : 'autorizar';

  const [state, setState] = useState('loading'); // loading | ready | submitting | done | error
  const [error, setError] = useState('');
  const [data, setData] = useState(null); // { requisicion, reviewerName }
  const [accion, setAccion] = useState(initialAccion);
  const [notes, setNotes] = useState('');
  const [resultMessage, setResultMessage] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setState('error');
        setError('El enlace no es válido: falta el token de autorización.');
        return;
      }
      try {
        const res = await callApi('getRequisicionByToken', { token });
        setData(res);
        setState('ready');
      } catch (err) {
        setState('error');
        setError(err.message || 'No se pudo cargar la requisición.');
      }
    };
    load();
  }, [token]);

  const handleConfirm = async () => {
    if (accion === 'regresar' && !notes.trim()) {
      setError('Indica el motivo por el que regresas la requisición.');
      return;
    }
    setError('');
    setState('submitting');
    try {
      await callApi('resolveRequisicionByToken', { token, accion, notes });
      setResultMessage(
        accion === 'autorizar'
          ? 'Autorizaste la requisición. Se notificó a Compras para que realice el pago.'
          : 'Regresaste la requisición. Se notificó al solicitante con tus observaciones.'
      );
      setState('done');
    } catch (err) {
      setState('error');
      setError(err.message || 'No se pudo procesar tu decisión.');
    }
  };

  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: '24px' }}>
        <Logo width={180} />
      </div>

      <Card style={cardStyle}>
        {state === 'loading' && (
          <p style={{ textAlign: 'center', padding: '24px', color: 'var(--color-gray-600)' }}>
            ⏳ Cargando requisición...
          </p>
        )}

        {state === 'error' && (
          <div style={{ padding: '8px' }}>
            <h3 style={{ marginTop: 0 }}>⚠️ No se pudo continuar</h3>
            <p style={{ color: 'var(--color-gray-700)' }}>{error}</p>
            <p style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
              Si crees que esto es un error, entra a la app e revisa la requisición directamente desde la sección de Requisiciones.
            </p>
          </div>
        )}

        {state === 'done' && (
          <div style={{ padding: '8px', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>{accion === 'autorizar' ? '✅ Requisición autorizada' : '↩️ Requisición regresada'}</h3>
            <p style={{ color: 'var(--color-gray-700)' }}>{resultMessage}</p>
          </div>
        )}

        {(state === 'ready' || state === 'submitting') && data && (
          <div>
            <h3 style={{ marginTop: 0 }}>
              Hola {data.reviewerName?.split(' ')[0] || ''}, revisa la requisición {data.requisicion.id}
            </h3>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <Badge variant={data.requisicion.priority === 'urgente' ? 'danger' : 'neutral'}>
                {PRIORITY_LABELS[data.requisicion.priority]}
              </Badge>
              <Badge variant="warning">Pendiente de Autorización</Badge>
            </div>

            <p style={{ fontSize: '13px', margin: '4px 0' }}>
              <strong>Área:</strong> {AREAS_CATALOG.find((a) => a.id === data.requisicion.areaId)?.name || data.requisicion.areaId}
            </p>
            <p style={{ fontSize: '13px', margin: '4px 0' }}>
              <strong>Solicitó:</strong> {data.requisicion.requestedBy} • {new Date(data.requisicion.createdAt).toLocaleDateString()}
            </p>
            <p style={{ fontSize: '13px', margin: '8px 0' }}>
              <strong>Justificación:</strong> {data.requisicion.justification}
            </p>

            <div style={{ margin: '10px 0', fontSize: '13px' }}>
              {data.requisicion.items.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--color-gray-100)' }}>
                  <span>🔧 {it.name}</span>
                  <strong>{it.quantity} {it.unit}</strong>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', margin: '16px 0 10px' }}>
              <Button
                type="button"
                variant={accion === 'autorizar' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setAccion('autorizar'); setError(''); }}
                disabled={state === 'submitting'}
              >
                ✅ Autorizar
              </Button>
              <Button
                type="button"
                variant={accion === 'regresar' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setAccion('regresar'); setError(''); }}
                disabled={state === 'submitting'}
              >
                ↩️ Regresar
              </Button>
            </div>

            <label style={labelStyle}>
              {accion === 'autorizar' ? 'Observaciones (opcional)' : 'Motivo por el que la regresas *'}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows="3"
              style={textareaStyle}
              placeholder={accion === 'autorizar' ? 'Ej: Autorizada, dentro del presupuesto del proyecto.' : 'Ej: Falta cotización del proveedor, corrige y reenvía.'}
              disabled={state === 'submitting'}
            />

            {error && <p style={{ color: 'var(--color-danger)', fontSize: '12px', marginTop: '8px' }}>{error}</p>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
              <Button type="button" variant="primary" size="md" onClick={handleConfirm} disabled={state === 'submitting'}>
                {state === 'submitting'
                  ? '⏳ Procesando...'
                  : accion === 'autorizar' ? 'Confirmar Autorización' : 'Confirmar Devolución'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AprobarRequisicionPage;
