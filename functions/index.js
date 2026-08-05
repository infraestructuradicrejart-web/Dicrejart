/**
 * @file index.js
 * @description Cloud Functions de Dicrejart. Aquí viven las únicas operaciones que
 * requieren el SDK de administrador de Firebase (privilegios que nunca deben exponerse
 * en el navegador): restablecer la contraseña de otro usuario, y el flujo de
 * autorización de requisiciones de compra por correo (Dirección autoriza/regresa con un
 * clic desde su correo, sin iniciar sesión en la app).
 * @author Dicrejart Dev Team
 * @requires firebase-admin
 * @requires firebase-functions
 * @requires nodemailer
 */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const APP_BASE_URL = defineString('APP_BASE_URL', { default: 'https://dicrejartapp.web.app' });

/**
 * Crea (una vez por invocación en frío) el transporte SMTP con las credenciales
 * guardadas como secrets. Nunca se guardan en el código ni en variables de entorno planas.
 */
let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST.value(),
      port: Number(SMTP_PORT.value()) || 587,
      secure: Number(SMTP_PORT.value()) === 465,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
    });
  }
  return transporter;
};

/** Envía un correo; nunca lanza — un fallo de correo no debe tumbar la escritura ya hecha en Firestore. */
const sendMail = async ({ to, subject, html }) => {
  if (!to) return;
  try {
    await getTransporter().sendMail({ from: SMTP_USER.value(), to, subject, html });
  } catch (error) {
    console.error('Error al enviar correo:', error);
  }
};

/** Registra una entrada en la bitácora de auditoría, igual que src/utils/auditLog.js del cliente. */
const writeAuditLog = async ({ userId, userName, userRole, module, action, details }) => {
  try {
    const id = `LOG-${Date.now()}-fn`;
    await admin.firestore().collection('audit_log').doc(id).set({
      id,
      timestamp: new Date().toISOString(),
      userId: userId || null,
      userName: userName || 'Desconocido',
      userRole: userRole || null,
      module,
      action,
      details: details || '',
    });
  } catch (error) {
    console.error('Error al registrar bitácora de auditoría:', error);
  }
};

const emailShell = (bodyHtml) => `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto;">
    <div style="background: linear-gradient(90deg, #cc0000, #330066); padding: 16px 20px; border-radius: 10px 10px 0 0;">
      <span style="color: #fff; font-size: 18px; font-weight: bold;">Dicrejart</span>
    </div>
    <div style="border: 1px solid #e5e5e5; border-top: none; padding: 24px 20px; border-radius: 0 0 10px 10px;">
      ${bodyHtml}
    </div>
  </div>
`;

const button = (href, label, color = '#ff3300') => `
  <a href="${href}" style="display:inline-block; background:${color}; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-weight:bold; font-size:14px; margin-right:10px;">
    ${label}
  </a>
`;

const itemsList = (items = []) =>
  `<ul style="padding-left:18px; margin:8px 0;">${items
    .map((it) => `<li>${it.name} — <strong>${it.quantity} ${it.unit}</strong></li>`)
    .join('')}</ul>`;

/**
 * Restablece la contraseña de un usuario. Solo puede invocarla un usuario ya
 * autenticado cuyo perfil en Firestore tenga roleType 'admin' — esta verificación es la
 * única protección real de la operación, ya que cualquier usuario autenticado podría
 * intentar invocar la función directamente.
 */
exports.resetUserPassword = onCall({ cors: true }, async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const callerDoc = await admin.firestore().collection('users').doc(auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().roleType !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo un administrador puede restablecer contraseñas.');
  }

  const { userId, newPassword } = data || {};
  if (!userId || !newPassword || newPassword.length < 6) {
    throw new HttpsError('invalid-argument', 'Falta el usuario o la contraseña debe tener al menos 6 caracteres.');
  }

  await admin.auth().updateUser(userId, { password: newPassword });
  return { ok: true };
});

/**
 * Indica si la colección `users` está vacía (para mostrar la pantalla de "registrar el
 * primer administrador" antes de que exista sesión alguna). Es un `onRequest` servido a
 * través del rewrite de Hosting (`/api/checkSystemEmpty`, ver firebase.json) — igual que
 * el flujo de aprobación de requisiciones, no como `onCall`, porque una política de la
 * organización bloquea marcar funciones como invocables públicamente (`allUsers`).
 * Regresa solo un booleano, nunca datos reales de usuarios, así que puede quedar
 * expuesta sin sesión iniciada sin filtrar información.
 */
exports.checkSystemEmpty = onRequest({ cors: true }, async (req, res) => {
  try {
    const snap = await admin.firestore().collection('users').limit(1).get();
    res.json({ empty: snap.empty });
  } catch (error) {
    console.error('Error al verificar si el sistema está vacío:', error);
    res.status(500).json({ empty: false, error: error.message });
  }
});

// ============================================================
// APROBACIÓN DE REQUISICIONES POR CORREO
// ============================================================
// Los tokens de un solo uso viven en `requisicion_approvals/{token}`, generados
// EXCLUSIVAMENTE aquí (con el SDK de administrador) al momento de enviar el correo —
// nunca por el cliente. Un token por usuario Dirección (no uno compartido) permite
// atribuir correctamente quién autorizó/regresó cuando se actúa desde el correo.
// `firestore.rules` bloquea por completo la lectura/escritura de esta colección desde
// la app: si el navegador pudiera crearla, cualquier usuario autenticado podría forjar
// un token con el id de un Dirección real (la colección `users` es de lectura pública)
// y auto-autorizarse cualquier requisición.
const crypto = require('crypto');
const APPROVAL_TOKEN_EXPIRY_DAYS = 7;

/** Genera un token por cada usuario Dirección y les envía el correo con los botones de un clic. */
const sendApprovalRequestEmails = async (requisicionId, req) => {
  const direccionSnap = await admin.firestore().collection('users').where('roleType', '==', 'direccion').get();
  if (direccionSnap.empty) return;

  const expiresAt = new Date(Date.now() + APPROVAL_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const body = (approveUrl, returnUrl) => emailShell(`
    <h2 style="margin-top:0;">Requisición ${requisicionId} pendiente de tu autorización</h2>
    <p><strong>Área:</strong> ${req.areaId} &nbsp; <strong>Prioridad:</strong> ${req.priority === 'urgente' ? '🔴 Urgente' : 'Normal'}</p>
    <p><strong>Solicitó:</strong> ${req.requestedBy}</p>
    <p><strong>Justificación:</strong> ${req.justification}</p>
    <p><strong>Materiales:</strong></p>
    ${itemsList(req.items)}
    <div style="margin-top:20px;">
      ${button(approveUrl, '✅ Revisar y Autorizar', '#16a34a')}
      ${button(returnUrl, '↩️ Revisar y Regresar', '#dc2626')}
    </div>
    <p style="font-size:12px; color:#777; margin-top:20px;">
      Los botones te llevan a una pantalla de confirmación dentro de la app — no se autoriza ni se regresa nada hasta que confirmes ahí.
    </p>
  `);

  await Promise.all(
    direccionSnap.docs.map(async (userDoc) => {
      const u = userDoc.data();
      if (!u.email) return;
      const token = crypto.randomUUID();
      await admin.firestore().collection('requisicion_approvals').doc(token).set({
        token,
        requisicionId,
        userId: userDoc.id,
        userName: u.name,
        userEmail: u.email,
        used: false,
        createdAt: new Date().toISOString(),
        expiresAt,
      });
      const base = `${APP_BASE_URL.value()}/aprobar-requisicion?token=${token}`;
      await sendMail({
        to: u.email,
        subject: `[Dicrejart] Requisición ${requisicionId} pendiente de autorización`,
        html: body(`${base}&accion=autorizar`, `${base}&accion=regresar`),
      });
    })
  );
};

exports.onRequisicionCreated = onDocumentCreated(
  { document: 'requisiciones/{id}', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (event) => {
    const req = event.data?.data();
    if (!req || req.status !== 'pendiente') return;
    await sendApprovalRequestEmails(event.params.id, req);
  }
);

exports.onRequisicionUpdated = onDocumentUpdated(
  { document: 'requisiciones/{id}', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after || before.status === after.status) return;
    const id = event.params.id;
    const appUrl = APP_BASE_URL.value();

    // Reenviada tras ser regresada: es una nueva revisión pendiente para Dirección
    if (before.status === 'regresada' && after.status === 'pendiente') {
      await sendApprovalRequestEmails(id, after);
      return;
    }

    if (after.status === 'autorizada') {
      const comprasSnap = await admin.firestore().collection('users').where('roleType', '==', 'compras').get();
      const solicitanteSnap = await admin.firestore().collection('users').doc(after.requestedByUserId || '').get();
      await Promise.all([
        ...comprasSnap.docs.map((u) =>
          sendMail({
            to: u.data().email,
            subject: `[Dicrejart] Requisición ${id} autorizada, lista para pago`,
            html: emailShell(`
              <h2 style="margin-top:0;">Requisición ${id} autorizada</h2>
              <p><strong>Área:</strong> ${after.areaId}</p>
              <p>Dirección la autorizó${after.reviewedBy ? ` (${after.reviewedBy})` : ''}. Ya puedes registrar la compra en la app.</p>
              <div style="margin-top:20px;">${button(`${appUrl}/compras`, 'Ir a Requisiciones', '#0099cc')}</div>
            `),
          })
        ),
        sendMail({
          to: solicitanteSnap.exists ? solicitanteSnap.data().email : null,
          subject: `[Dicrejart] Requisición ${id} autorizada`,
          html: emailShell(`
            <h2 style="margin-top:0;">Requisición ${id} autorizada</h2>
            <p>Dirección autorizó tu requisición${after.reviewedBy ? ` (${after.reviewedBy})` : ''}. Ya está en manos de Compras para realizar el pago.</p>
            <div style="margin-top:20px;">${button(`${appUrl}/compras`, 'Ir a Requisiciones', '#0099cc')}</div>
          `),
        }),
      ]);
      return;
    }

    if (after.status === 'regresada') {
      const solicitanteSnap = await admin.firestore().collection('users').doc(after.requestedByUserId || '').get();
      await sendMail({
        to: solicitanteSnap.exists ? solicitanteSnap.data().email : null,
        subject: `[Dicrejart] Requisición ${id} regresada por Dirección`,
        html: emailShell(`
          <h2 style="margin-top:0;">Requisición ${id} regresada</h2>
          <p><strong>Motivo:</strong> ${after.reviewNotes || 'Sin especificar.'}</p>
          <p>Corrígela y reenvíala desde la app para que Dirección la revise de nuevo.</p>
          <div style="margin-top:20px;">${button(`${appUrl}/compras`, 'Ir a Requisiciones', '#ff3300')}</div>
        `),
      });
      return;
    }

    if (after.status === 'comprada') {
      const encargadoSnap = await admin.firestore().collection('users')
        .where('roleType', '==', 'encargado-area')
        .where('areaId', '==', 'almacen')
        .get();
        
      const recipients = encargadoSnap.docs.map((d) => d.data().email).filter(Boolean);

      await Promise.all(
        recipients.map((email) =>
          sendMail({
            to: email,
            subject: `[Dicrejart] Requisición ${id} comprada — confirma su recepción en Almacén`,
            html: emailShell(`
              <h2 style="margin-top:0;">Requisición ${id} comprada</h2>
              <p><strong>Proveedor:</strong> ${after.supplier} &nbsp; <strong>Costo:</strong> $${after.cost}</p>
              <p>Cuando recibas el material y el comprobante, confirma la recepción en la app <strong>Inventor Manager</strong> para integrar los artículos al inventario y cerrar el ciclo.</p>
            `),
          })
        )
      );
      return;
    }

    if (after.status === 'recibida') {
      const roles = ['direccion', 'compras'];
      const snaps = await Promise.all(
        roles.map((r) => admin.firestore().collection('users').where('roleType', '==', r).get())
      );
      const recipients = snaps.flatMap((s) => s.docs.map((d) => d.data().email)).filter(Boolean);
      await Promise.all(
        recipients.map((email) =>
          sendMail({
            to: email,
            subject: `[Dicrejart] Requisición ${id} cerrada (recibida)`,
            html: emailShell(`
              <h2 style="margin-top:0;">Requisición ${id} cerrada</h2>
              <p>${after.receivedBy} confirmó la recepción del material. El ciclo de esta requisición quedó cerrado.</p>
            `),
          })
        )
      );
    }
  }
);

// ============================================================
// SOLICITUDES DE MATERIALES A ALMACÉN (interno, sin Compras de por medio)
// ============================================================
/**
 * Al crearse una solicitud de materiales (siempre en 'pendiente'), avisa por correo al
 * Encargado de Almacén — mismo patrón de búsqueda de destinatario que ya usa la
 * notificación de "comprada" en el flujo de Compras más arriba.
 */
exports.onSolicitudMaterialCreated = onDocumentCreated(
  { document: 'solicitudes_materiales/{id}', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (event) => {
    const sol = event.data?.data();
    if (!sol || sol.status !== 'pendiente') return;

    const encargadoSnap = await admin.firestore().collection('users')
      .where('roleType', '==', 'encargado-area')
      .where('areaId', '==', 'almacen')
      .get();
    const recipients = encargadoSnap.docs.map((d) => d.data().email).filter(Boolean);
    if (recipients.length === 0) return;

    const appUrl = APP_BASE_URL.value();
    const folioLabel = sol.folio ? `MAT-${String(sol.folio).padStart(4, '0')}` : event.params.id;
    await Promise.all(
      recipients.map((email) =>
        sendMail({
          to: email,
          subject: `[Dicrejart] ${folioLabel} — Nueva solicitud de materiales de ${sol.areaId}${sol.priority === 'urgente' ? ' 🔴 URGENTE' : ''}`,
          html: emailShell(`
            <h2 style="margin-top:0;">Solicitud ${folioLabel} — ${sol.areaId}</h2>
            <p><strong>Solicitó:</strong> ${sol.requestedBy} &nbsp; <strong>Prioridad:</strong> ${sol.priority === 'urgente' ? '🔴 Urgente' : 'Normal'}</p>
            ${sol.gameName ? `<p><strong>Juego:</strong> ${sol.gameName}</p>` : ''}
            <p><strong>Justificación:</strong> ${sol.justification}</p>
            <p><strong>Materiales:</strong></p>
            ${itemsList(sol.items)}
            <div style="margin-top:20px;">${button(`${appUrl}/produccion/almacen`, 'Ir a Solicitudes de Materiales', '#0099cc')}</div>
          `),
        })
      )
    );
  }
);

/**
 * Al cambiar de estatus una solicitud de materiales: avisa al solicitante cuando Almacén
 * ya la dejó lista para recoger, o cuando la rechazó (con motivo).
 */
exports.onSolicitudMaterialUpdated = onDocumentUpdated(
  { document: 'solicitudes_materiales/{id}', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after || before.status === after.status) return;
    if (!after.requestedByUserId) return;

    const solicitanteSnap = await admin.firestore().collection('users').doc(after.requestedByUserId).get();
    if (!solicitanteSnap.exists || !solicitanteSnap.data().email) return;
    const appUrl = APP_BASE_URL.value();
    const folioLabel = after.folio ? `MAT-${String(after.folio).padStart(4, '0')}` : event.params.id;

    if (after.status === 'lista') {
      await sendMail({
        to: solicitanteSnap.data().email,
        subject: `[Dicrejart] ${folioLabel} — Tus materiales ya están listos para recoger en Almacén`,
        html: emailShell(`
          <h2 style="margin-top:0;">Materiales listos para recoger — ${folioLabel}</h2>
          <p>Almacén ya preparó lo que solicitaste${after.reviewedBy ? ` (${after.reviewedBy})` : ''}. Pasa a recogerlo y confirma la recepción en la app.</p>
          ${itemsList(after.items)}
          <div style="margin-top:20px;">${button(`${appUrl}/produccion/${after.areaId}`, 'Ir a Mis Solicitudes', '#16a34a')}</div>
        `),
      });
      return;
    }

    if (after.status === 'rechazada') {
      await sendMail({
        to: solicitanteSnap.data().email,
        subject: `[Dicrejart] ${folioLabel} — Tu solicitud de materiales fue rechazada`,
        html: emailShell(`
          <h2 style="margin-top:0;">Solicitud ${folioLabel} rechazada</h2>
          <p><strong>Motivo:</strong> ${after.reviewNotes || 'Sin especificar.'}</p>
          <div style="margin-top:20px;">${button(`${appUrl}/produccion/${after.areaId}`, 'Ir a Mis Solicitudes', '#ff3300')}</div>
        `),
      });
    }
  }
);

// ============================================================
// ALERTAS DE CALIDAD AUTOMÁTICAS
// ============================================================
/**
 * Al registrarse una inspección con score bajo (< 8), avisa por correo al
 * encargado/supervisor del área responsable — solo si el Admin activó la opción
 * "Alertas de Calidad Automáticas" (`config/general.autoQualityAlerts`, activada por
 * defecto). Es un trigger de Firestore (no de la app) para que la alerta salga sin
 * importar quién ni desde dónde se registró la inspección.
 */
exports.onInspeccionCreated = onDocumentCreated(
  { document: 'inspecciones/{id}', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (event) => {
    const insp = event.data?.data();
    if (!insp || typeof insp.score !== 'number' || insp.score >= 8) return;

    const configSnap = await admin.firestore().collection('config').doc('general').get();
    const autoQualityAlerts = configSnap.exists ? configSnap.data().autoQualityAlerts !== false : true;
    if (!autoQualityAlerts) return;

    const [encargadosSnap, supervisoresSnap] = await Promise.all([
      admin.firestore().collection('users')
        .where('roleType', '==', 'encargado-area')
        .where('areaId', '==', insp.areaId)
        .get(),
      admin.firestore().collection('users')
        .where('roleType', '==', 'supervisor-area')
        .where('areaIds', 'array-contains', insp.areaId)
        .get(),
    ]);
    const recipients = [...encargadosSnap.docs, ...supervisoresSnap.docs]
      .map((d) => d.data().email)
      .filter(Boolean);
    if (!recipients.length) return;

    await Promise.all(
      recipients.map((email) =>
        sendMail({
          to: email,
          subject: `[Dicrejart] Alerta de calidad: ${insp.gameName} obtuvo ${insp.score}/10`,
          html: emailShell(`
            <h2 style="margin-top:0;">⚠️ Score de calidad bajo</h2>
            <p><strong>Juego:</strong> ${insp.gameName} &nbsp; <strong>Área:</strong> ${insp.areaId}</p>
            <p><strong>Score:</strong> ${insp.score} / 10 &nbsp; <strong>Estado:</strong> ${insp.status}</p>
            <p>${insp.notes ? insp.notes : 'Sin notas adicionales del inspector.'}</p>
          `),
        })
      )
    );
  }
);

// ============================================================
// NOTIFICACIONES DE TAREAS ASIGNADAS EN DISEÑO
// ============================================================
/**
 * Notifica por correo a quien quede como responsable de una actividad del departamento
 * de Diseño (`areaId === 'diseno'`) — se dispara tanto al crearla ya asignada (el
 * Colaborador ya estaba conectado al Bloque cuando se creó) como al asignarla/reasignarla
 * después (ej. el botón "🔗 Reasignar todas" del bloque, o conectar un Colaborador a un
 * nodo de Actividad suelto). Es la tarea en sí lo que se notifica —no el bloque ni el
 * cable— porque la idea es que la persona entre a CONSULTARLA en la sección Diseño.
 */
const notifyDisenoAssignment = async (actividad) => {
  if (!actividad || actividad.areaId !== 'diseno' || !actividad.operarioId) return;

  const usersSnap = await admin.firestore().collection('users').where('operarioId', '==', actividad.operarioId).get();
  if (usersSnap.empty) return;

  const operarioSnap = await admin.firestore().collection('operarios').doc(actividad.operarioId).get();
  const operarioName = operarioSnap.exists ? operarioSnap.data().name : 'Colaborador';
  const appUrl = APP_BASE_URL.value();

  await Promise.all(
    usersSnap.docs.map((userDoc) => {
      const email = userDoc.data().email;
      if (!email) return null;
      return sendMail({
        to: email,
        subject: `[Dicrejart] Se te asignó la tarea "${actividad.title}"`,
        html: emailShell(`
          <h2 style="margin-top:0;">📌 Nueva tarea asignada</h2>
          <p>Hola ${operarioName}, se te asignó la tarea <strong>"${actividad.title}"</strong> del departamento de Diseño.</p>
          ${actividad.description ? `<p>${actividad.description}</p>` : ''}
          <p><strong>Prioridad:</strong> ${actividad.priority || 'media'} ${actividad.dueDate ? `&nbsp; <strong>Fecha límite:</strong> ${actividad.dueDate}` : ''}</p>
          <p>Entra a la sección Diseño para consultar todos los detalles.</p>
          <div style="margin-top:20px;">${button(`${appUrl}/diseno`, 'Consultar Tarea', '#330066')}</div>
        `),
      });
    })
  );
};

/**
 * Notifica a quien TENÍA la tarea antes de este cambio que ya no es su responsable —
 * ya sea porque se reasignó a alguien más, o porque se quedó sin responsable (el bloque
 * se desconectó del colaborador). La tarea en sí NO se elimina, solo cambia de dueño;
 * el correo lo deja explícito para que no se lea como si la tarea hubiera desaparecido.
 */
const notifyDisenoUnassignment = async (before, after) => {
  if (!before || before.areaId !== 'diseno' || !before.operarioId) return;

  const usersSnap = await admin.firestore().collection('users').where('operarioId', '==', before.operarioId).get();
  if (usersSnap.empty) return;

  const statusText = after.operarioId
    ? 'La tarea se reasignó a otro colaborador.'
    : 'Por ahora la tarea se quedó sin responsable asignado.';

  await Promise.all(
    usersSnap.docs.map((userDoc) => {
      const email = userDoc.data().email;
      if (!email) return null;
      return sendMail({
        to: email,
        subject: `[Dicrejart] Ya no eres responsable de la tarea "${after.title}"`,
        html: emailShell(`
          <h2 style="margin-top:0;">↩️ Tarea reasignada</h2>
          <p>La tarea <strong>"${after.title}"</strong> del departamento de Diseño ya no está bajo tu responsabilidad. ${statusText}</p>
          <p style="font-size:12px; color:#777;">La tarea no se eliminó del sistema, solo cambió de responsable.</p>
        `),
      });
    })
  );
};

// ============================================================
// NOTIFICACIÓN POR CORREO DEL REPORTE DIARIO DE FALTAS A RH
// ============================================================
/**
 * El cliente (rhNotificationService.js, disparado automáticamente a las 10:00 AM o
 * manualmente desde Admin → Configuración) solo GUARDA el reporte ya armado (asunto y
 * HTML) en `notificaciones_rh` — nunca podría enviar el correo real desde el navegador.
 * Esta función es la que de verdad lo despacha por SMTP en cuanto se crea el documento.
 * Si `emailRH` no está configurado todavía, el cliente guarda un texto de aviso en vez de
 * un correo real (ver rhNotificationService.js) — se valida el formato antes de intentar
 * enviarlo para no generar un rebote/error de SMTP con esa cadena.
 */
const isPlausibleEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');

exports.onNotificacionRHCreated = onDocumentCreated(
  { document: 'notificaciones_rh/{notifId}', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (event) => {
    const notif = event.data?.data();
    if (!notif || !isPlausibleEmail(notif.emailRH)) return;

    await sendMail({
      to: notif.emailRH,
      subject: notif.subject,
      html: notif.bodyHtml,
    });
  }
);

exports.onActividadCreated = onDocumentCreated(
  { document: 'actividades/{id}', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (event) => {
    await notifyDisenoAssignment(event.data?.data());
  }
);

exports.onActividadUpdated = onDocumentUpdated(
  { document: 'actividades/{id}', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    // Solo notificar cuando el responsable realmente cambió (asignación nueva o
    // reasignación) — no en cada edición de la actividad (título, estatus, etc.)
    if (before.operarioId === after.operarioId) return;
    await Promise.all([
      notifyDisenoAssignment(after),
      notifyDisenoUnassignment(before, after),
    ]);
  }
);

/**
 * `getRequisicionByToken` y `resolveRequisicionByToken` son funciones HTTP planas
 * (`onRequest`), no `onCall` — porque `onCall` solo es alcanzable si el proyecto puede
 * marcar la función como invocable públicamente (rol "Cloud Run Invoker" a "allUsers"),
 * y una política de la organización del proyecto bloquea agregar ese principal. En vez
 * de eso, estas dos se sirven a través de un rewrite de Firebase Hosting
 * (`/api/requisicion/...` en `firebase.json`) — Hosting ya tiene permiso interno propio
 * de Firebase para invocar la función, sin necesitar `allUsers` ni exponer nada público
 * a nivel de infraestructura. La seguridad real sigue siendo el token de un solo uso.
 */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Valida un token de aprobación y regresa el resumen de la requisición, sin exponer el token de vuelta. */
const validateApprovalToken = async (token) => {
  if (!token) throw new ApiError(400, 'Falta el enlace de aprobación.');
  const approvalRef = admin.firestore().collection('requisicion_approvals').doc(token);
  const approvalSnap = await approvalRef.get();
  if (!approvalSnap.exists) throw new ApiError(404, 'Este enlace no es válido.');

  const approval = approvalSnap.data();
  if (approval.used) throw new ApiError(409, 'Este enlace ya fue utilizado.');
  if (new Date(approval.expiresAt) < new Date()) throw new ApiError(410, 'Este enlace ya expiró.');

  const reqRef = admin.firestore().collection('requisiciones').doc(approval.requisicionId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) throw new ApiError(404, 'La requisición ya no existe.');

  const req = reqSnap.data();
  if (req.status !== 'pendiente') {
    throw new ApiError(409, 'Esta requisición ya fue atendida (por ti o por otra persona de Dirección).');
  }

  return { approvalRef, approval, reqRef, req };
};

/** Regresa el resumen de la requisición para mostrarlo antes de confirmar la acción. Sin sesión iniciada. */
exports.getRequisicionByToken = onRequest({ cors: true }, async (req, res) => {
  try {
    const token = req.method === 'GET' ? req.query.token : req.body?.token;
    const { req: requisicion, approval } = await validateApprovalToken(token);
    res.json({
      ok: true,
      reviewerName: approval.userName,
      requisicion: {
        id: requisicion.id,
        areaId: requisicion.areaId,
        items: requisicion.items,
        justification: requisicion.justification,
        priority: requisicion.priority,
        requestedBy: requisicion.requestedBy,
        createdAt: requisicion.createdAt,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error interno.' });
  }
});

/** Aplica la autorización/devolución vía correo. Sin sesión iniciada — la seguridad la da el token. */
exports.resolveRequisicionByToken = onRequest(
  { cors: true, secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (req, res) => {
    try {
      const { token, accion, notes } = req.body || {};
      if (!['autorizar', 'regresar'].includes(accion)) {
        throw new ApiError(400, 'Acción inválida.');
      }
      if (accion === 'regresar' && !notes?.trim()) {
        throw new ApiError(400, 'Indica el motivo por el que regresas la requisición.');
      }

      const { approvalRef, approval, reqRef } = await validateApprovalToken(token);

      await admin.firestore().runTransaction(async (tx) => {
        const freshReqSnap = await tx.get(reqRef);
        if (!freshReqSnap.exists || freshReqSnap.data().status !== 'pendiente') {
          throw new ApiError(409, 'Esta requisición ya fue atendida.');
        }
        tx.update(reqRef, {
          status: accion === 'autorizar' ? 'autorizada' : 'regresada',
          reviewedBy: `${approval.userName} (vía correo)`,
          reviewedAt: new Date().toISOString(),
          reviewNotes: accion === 'autorizar' ? (notes || 'Autorizada sin observaciones.') : notes,
        });
        tx.update(approvalRef, { used: true, usedAt: new Date().toISOString() });
      });

      await writeAuditLog({
        userId: approval.userId,
        userName: approval.userName,
        userRole: 'direccion',
        module: 'compras',
        action: accion === 'autorizar' ? 'Autorizó una requisición de compra (vía correo)' : 'Regresó una requisición de compra (vía correo)',
        details: `${approval.requisicionId} por ${approval.userName}`,
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Error interno.' });
    }
  }
);
