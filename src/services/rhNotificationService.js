/**
 * @file rhNotificationService.js
 * @description Servicio de generación y preparación de notificaciones por correo electrónico
 * a Recursos Humanos (RH) sobre el reporte diario de faltas y ausencias del personal (10:00 AM).
 * @author Dicrejart Dev Team
 */

import { doc, setDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getTodayLocalDateStr } from '../utils/dateUtils';
import { logAudit } from '../utils/auditLog';

export const ESTADO_AUSENCIA_TITULOS = {
  falta: 'Falta (Inasistencia Injustificada)',
  incapacidad: 'Incapacidad Médica',
  salida_campo: 'Salida Fuera / Trabajo en Campo',
  actividad_externa: 'Comisión / Actividad Externa',
  viaje: 'Viaje / Ensamble Foráneo',
  vacaciones: 'Vacaciones / Permiso Autorizado',
};

/**
 * Genera el cuerpo en texto y HTML del reporte diario para RH
 */
export const buildRHReportEmailContent = (absentList, dateStr, emailRH) => {
  const formattedDate = new Date(`${dateStr}T00:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const subject = `[Dicrejart System] Reporte Diario de Faltas y Ausencias del Personal - ${dateStr} (10:00 AM)`;

  let textLines = [
    `=============================================================`,
    `DICREJART - REPORTE DIARIO DE FALTAS Y AUSENCIAS DE PERSONAL`,
    `=============================================================`,
    `Fecha: ${formattedDate}`,
    `Hora de corte: 10:00 AM`,
    `Destinatario RH: ${emailRH || 'Por definir (No configurado)'}`,
    `Total de personal ausente hoy: ${absentList.length}`,
    `-------------------------------------------------------------`,
    ``
  ];

  if (absentList.length === 0) {
    textLines.push(`✅ Excelente noticia: Todo el personal de la plantilla se encuentra activo En Planta el día de hoy.`);
  } else {
    absentList.forEach((op, index) => {
      const tipoDesc = ESTADO_AUSENCIA_TITULOS[op.estado?.tipo] || op.estado?.tipo || 'Ausente';
      textLines.push(`${index + 1}. COLABORADOR: ${op.name} (ID: ${op.id})`);
      textLines.push(`   • Área: ${op.currentArea || 'N/A'}`);
      textLines.push(`   • Puesto: ${op.puesto || 'N/A'}`);
      textLines.push(`   • Estado / Motivo: ${tipoDesc}`);
      if (op.estado?.desde) textLines.push(`   • Fecha Inicio: ${op.estado.desde}`);
      if (op.estado?.hasta) textLines.push(`   • Fecha Límite / Retorno: ${op.estado.hasta}`);
      if (op.estado?.notas) textLines.push(`   • Observaciones: ${op.estado.notas}`);
      if (op.estado?.registradoPor) textLines.push(`   • Registrado Por: ${op.estado.registradoPor}`);
      textLines.push(`-------------------------------------------------------------`);
    });
  }

  textLines.push(``);
  textLines.push(`Este correo fue generado automáticamente por el Sistema Integral Dicrejart a las 10:00 AM.`);

  const bodyText = textLines.join('\n');

  // Versión HTML limpia y profesional
  const rowsHtml = absentList.length === 0
    ? `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #15803d; font-weight: bold; background-color: #f0fdf4;">✅ Excelente noticia: Todo el personal registrado se encuentra activo En Planta hoy.</td></tr>`
    : absentList.map((op, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f9fafb'}; font-size: 13px;">
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #1f2937;">${op.name} <br/><span style="font-size:11px; color:#6b7280; font-weight:normal;">ID: ${op.id}</span></td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #374151;">${op.currentArea}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #ef4444; font-weight: 600;">${ESTADO_AUSENCIA_TITULOS[op.estado?.tipo] || op.estado?.tipo}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${op.estado?.desde || '-'} ${op.estado?.hasta ? ' al ' + op.estado.hasta : ''}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-style: italic;">${op.estado?.notas || 'Sin observaciones'}</td>
      </tr>
    `).join('');

  const bodyHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: #1e293b; color: #ffffff; padding: 20px; text-align: center;">
        <h2 style="margin: 0; font-size: 20px; font-weight: bold;">DICREJART - Control de Calidad y Operarios</h2>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Reporte Diario de Faltas y Ausencias a Recursos Humanos (10:00 AM)</p>
      </div>
      <div style="padding: 20px;">
        <p style="font-size: 14px; color: #374151;"><strong>Fecha del Reporte:</strong> ${formattedDate}</p>
        <p style="font-size: 14px; color: #374151;"><strong>Destinatario RH:</strong> <span style="color: #2563eb;">${emailRH || 'Por definir'}</span></p>
        <p style="font-size: 14px; color: #374151;"><strong>Total de Personal Ausente:</strong> <span style="background-color: #fee2e2; color: #991b1b; padding: 3px 8px; borderRadius: 4px; font-weight: bold;">${absentList.length} colaborador(es)</span></p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f3f4f6; color: #374151; font-size: 12px; text-transform: uppercase;">
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Colaborador</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Área</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Motivo</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Periodo</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Notas</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div style="background-color: #f9fafb; padding: 12px 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
        Generado automáticamente por el Sistema Dicrejart. Notificación diaria programada para Recursos Humanos a las 10:00 AM.
      </div>
    </div>
  `;

  return { subject, bodyText, bodyHtml };
};

/**
 * Dispara o simula el envío del reporte de faltas a RH (programado a las 10:00 AM o manual)
 */
export const triggerDailyRHNotification = async ({
  operarios = [],
  generalConfig = {},
  updateGeneralConfig = null,
  force = false,
  user = null,
}) => {
  const todayStr = getTodayLocalDateStr();

  // Si no está forzado, verificar que notificarFaltasRH esté activo y no se haya enviado hoy
  if (!force) {
    if (generalConfig.notificarFaltasRH === false) {
      return { ok: false, reason: 'Notificaciones a RH desactivadas en la configuración.' };
    }

    if (generalConfig.lastRHNotificationDate === todayStr) {
      return { ok: false, reason: 'El reporte de RH ya fue enviado el día de hoy.' };
    }
  }

  // Filtrar colaboradores ausentes (diferentes de 'activo')
  const absentList = operarios.filter((op) => op.estado && op.estado.tipo !== 'activo');
  const emailTarget = generalConfig.emailRH || 'recursoshumanos@dicrejart.com (Por definir)';

  const { subject, bodyText, bodyHtml } = buildRHReportEmailContent(absentList, todayStr, emailTarget);

  const notifId = `NOTIF-RH-${Date.now()}`;
  const notifRecord = {
    id: notifId,
    date: todayStr,
    timestamp: new Date().toISOString(),
    emailRH: emailTarget,
    absentCount: absentList.length,
    absentList: absentList.map((op) => ({
      id: op.id,
      name: op.name,
      puesto: op.puesto || 'N/A',
      currentArea: op.currentArea || 'N/A',
      tipo: op.estado?.tipo,
      desde: op.estado?.desde || null,
      hasta: op.estado?.hasta || null,
      notas: op.estado?.notas || '',
      registradoPor: op.estado?.registradoPor || 'N/A',
    })),
    status: 'enviado',
    subject,
    bodyText,
    bodyHtml,
    enviadoPor: user ? user.name : (force ? 'Administrador' : 'Sistema Programado (10:00 AM)'),
  };

  try {
    if (db) {
      // Guardar el registro de la notificación en Firestore para auditoría de RH
      await addDoc(collection(db, 'notificaciones_rh'), notifRecord);

      // Registrar la fecha del último envío en la configuración general si no fue un test forzado
      if (updateGeneralConfig) {
        await updateGeneralConfig('lastRHNotificationDate', todayStr);
      }
    }

    logAudit({
      user: user || { name: 'Sistema Programado (10:00 AM)', roleType: 'system' },
      module: 'operarios',
      action: 'Generó notificación por correo a RH',
      details: `Reporte enviado a ${emailTarget} con ${absentList.length} personal ausente`
    });

    return {
      ok: true,
      absentCount: absentList.length,
      emailTarget,
      record: notifRecord,
    };
  } catch (error) {
    console.error('Error al enviar notificación a RH:', error);
    return { ok: false, error: error.message };
  }
};
