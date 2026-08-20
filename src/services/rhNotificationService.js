/**
 * @file rhNotificationService.js
 * @description Servicio de generación y preparación de notificaciones por correo electrónico
 * a Recursos Humanos (RH) sobre el reporte diario de faltas/ausencias y horas extra
 * autorizadas del personal (10:00 AM).
 * @author Dicrejart Dev Team
 */

import { doc, setDoc, collection, addDoc, runTransaction } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getTodayLocalDateStr, getOvertimeWeekRange } from '../utils/dateUtils';
import { getOvertimeBlocks, formatHourLabel } from '../utils/overtimeUtils';
import { isOperarioAusenteEnFecha } from '../utils/overtimeRules';
import { logAudit } from '../utils/auditLog';

/** Describe en texto el/los bloque(s) de tiempo extra de una autorización (matutino y/o vespertino, o domingo completo). */
const describeOvertimeBlocks = (he) => {
  if (he.authorizedDate && new Date(`${he.authorizedDate}T00:00:00`).getDay() === 0) {
    return `Domingo Completo ${he.overtimeHours}h (${formatHourLabel(he.startHour)}-${formatHourLabel(he.endHour)})`;
  }
  const { earlyHours, earlyRange, lateHours, lateRange } = getOvertimeBlocks(he.startHour, he.endHour, he.authorizedDate);
  const parts = [];
  if (earlyHours > 0) parts.push(`Matutino ${earlyHours}h (${earlyRange})`);
  if (lateHours > 0) parts.push(`Vespertino ${lateHours}h (${lateRange})`);
  return parts.length > 0 ? parts.join(' | ') : `${he.overtimeHours}h (${he.startHour}:00-${he.endHour}:00)`;
};

/**
 * Describe la corrección de horario real que Calidad haya registrado (si el colaborador
 * no llegó/se retiró a la hora autorizada), o null si no hay ninguna. Solo menciona el
 * bloque que en verdad cambió, comparando contra lo originalmente autorizado.
 */
const describeScheduleCorrection = (he) => {
  const correction = he.scheduleCorrection;
  if (!correction) return null;
  const parts = [];
  if (correction.actualStartHour !== he.startHour) {
    parts.push(`Entrada real ${formatHourLabel(correction.actualStartHour)} (autorizado ${formatHourLabel(he.startHour)})`);
  }
  if (correction.actualEndHour !== he.endHour) {
    parts.push(`Salida real ${formatHourLabel(correction.actualEndHour)} (autorizado ${formatHourLabel(he.endHour)})`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(' / ')} — Motivo: ${correction.reason} — Corrigió: ${correction.correctedBy}`;
};

const VERIFICATION_LABELS = {
  pendiente: '⏳ Pendiente de Verificar',
  cumplido: '✅ Cumplido',
  no_cumplido: '❌ No Cumplido',
  cancelado: '🚫 Cancelado',
};

/**
 * Describe el resultado de la verificación de cumplimiento (Cumplido/No Cumplido), o null
 * si todavía está pendiente — la justificación (`verificationNotes`) es obligatoria en
 * OperariosContext.jsx cuando se marca "No Cumplido", así que siempre queda registrada
 * aquí junto con quién verificó.
 */
const describeVerification = (he) => {
  if (!he.verificationStatus || he.verificationStatus === 'pendiente') return null;
  const label = VERIFICATION_LABELS[he.verificationStatus] || he.verificationStatus;
  if (he.verificationStatus === 'no_cumplido') {
    return `${label} — Motivo: ${he.verificationNotes || 'Sin motivo registrado'} (Verificó: ${he.verifiedBy || 'N/A'})`;
  }
  if (he.verificationStatus === 'cumplido') {
    return `${label} (Verificó: ${he.verifiedBy || 'N/A'})`;
  }
  return label;
};

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
export const buildRHReportEmailContent = (absentList, dateStr, emailRH, horasExtraList = [], verifiedPreviousDaysList = []) => {
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
  textLines.push(`=============================================================`);
  textLines.push(`HORAS EXTRA AUTORIZADAS HOY`);
  textLines.push(`=============================================================`);
  textLines.push(`Total de autorizaciones hoy: ${horasExtraList.length}`);
  textLines.push(`-------------------------------------------------------------`);
  textLines.push(``);

  if (horasExtraList.length === 0) {
    textLines.push(`No se autorizaron horas extra el día de hoy.`);
  } else {
    horasExtraList.forEach((he, index) => {
      textLines.push(`${index + 1}. COLABORADOR: ${he.operarioName} (ID: ${he.operarioId})`);
      textLines.push(`   • Área: ${he.areaId || 'N/A'}`);
      textLines.push(`   • Puesto: ${he.operarioPuesto || 'N/A'}`);
      textLines.push(`   • Horas Extra Autorizadas: ${describeOvertimeBlocks(he)}`);
      textLines.push(`   • Tareas a Realizar: ${he.overtimeTasks || 'N/A'}`);
      textLines.push(`   • Autorizó: ${he.authorizedBy || 'N/A'}`);
      const verificationText = describeVerification(he);
      if (verificationText) {
        textLines.push(`   • Verificación: ${verificationText}`);
      }
      const correctionText = describeScheduleCorrection(he);
      if (correctionText) {
        textLines.push(`   • ⚠️ Horario Corregido: ${correctionText}`);
      }
      textLines.push(`-------------------------------------------------------------`);
    });
  }

  // La verificación de cumplimiento y la corrección de horario normalmente ocurren un día
  // DESPUÉS de que se autorizó el tiempo extra (una vez que el turno ya pasó) — sin esta
  // sección, esos comentarios/cambios nunca aparecerían en el reporte diario, porque para
  // cuando se registran ya no caen dentro de "Horas Extra Autorizadas Hoy".
  textLines.push(``);
  textLines.push(`=============================================================`);
  textLines.push(`VERIFICACIONES Y CORRECCIONES DE HORAS EXTRA DE DÍAS ANTERIORES`);
  textLines.push(`=============================================================`);
  textLines.push(`Total de registros: ${verifiedPreviousDaysList.length}`);
  textLines.push(`-------------------------------------------------------------`);
  textLines.push(``);

  if (verifiedPreviousDaysList.length === 0) {
    textLines.push(`No se registraron verificaciones ni correcciones de horas extra de días anteriores.`);
  } else {
    verifiedPreviousDaysList.forEach((he, index) => {
      textLines.push(`${index + 1}. COLABORADOR: ${he.operarioName} (ID: ${he.operarioId})`);
      textLines.push(`   • Área: ${he.areaId || 'N/A'}`);
      textLines.push(`   • Fecha de Autorización Original: ${he.authorizedDate}`);
      textLines.push(`   • Horas Extra Autorizadas: ${describeOvertimeBlocks(he)}`);
      const verificationText = describeVerification(he);
      if (verificationText) {
        textLines.push(`   • Verificación: ${verificationText}`);
      }
      const correctionText = describeScheduleCorrection(he);
      if (correctionText) {
        textLines.push(`   • ⚠️ Horario Corregido: ${correctionText}`);
      }
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

  const horasExtraRowsHtml = horasExtraList.length === 0
    ? `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #6b7280; background-color: #f9fafb;">No se autorizaron horas extra el día de hoy.</td></tr>`
    : horasExtraList.map((he, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f9fafb'}; font-size: 13px;">
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #1f2937;">${he.operarioName} <br/><span style="font-size:11px; color:#6b7280; font-weight:normal;">ID: ${he.operarioId}</span></td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #374151;">${he.areaId || 'N/A'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #92400e; font-weight: 600;">${describeOvertimeBlocks(he)}${describeVerification(he) ? `<br/><span style="font-size:11px; color:${he.verificationStatus === 'no_cumplido' ? '#b91c1c' : '#15803d'}; font-weight:600;">${describeVerification(he)}</span>` : ''}${describeScheduleCorrection(he) ? `<br/><span style="font-size:11px; color:#b91c1c; font-weight:600;">⚠️ ${describeScheduleCorrection(he)}</span>` : ''}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${he.overtimeTasks || 'N/A'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">${he.authorizedBy || 'N/A'}</td>
      </tr>
    `).join('');

  const verifiedPreviousDaysRowsHtml = verifiedPreviousDaysList.length === 0
    ? `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #6b7280; background-color: #f9fafb;">No se registraron verificaciones ni correcciones de horas extra de días anteriores.</td></tr>`
    : verifiedPreviousDaysList.map((he, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f9fafb'}; font-size: 13px;">
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #1f2937;">${he.operarioName} <br/><span style="font-size:11px; color:#6b7280; font-weight:normal;">ID: ${he.operarioId}</span></td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #374151;">${he.areaId || 'N/A'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${he.authorizedDate} <br/><span style="font-size:11px; color:#6b7280;">${describeOvertimeBlocks(he)}</span></td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: ${he.verificationStatus === 'no_cumplido' ? '#b91c1c' : '#15803d'}; font-weight: 600;">${describeVerification(he) || 'N/A'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #b91c1c;">${describeScheduleCorrection(he) || '—'}</td>
      </tr>
    `).join('');

  const bodyHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: #1e293b; color: #ffffff; padding: 20px; text-align: center;">
        <h2 style="margin: 0; font-size: 20px; font-weight: bold;">DICREJART - Control de Calidad y Operarios</h2>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Reporte Diario de Faltas/Ausencias y Horas Extra Autorizadas (10:00 AM)</p>
      </div>
      <div style="padding: 20px;">
        <p style="font-size: 14px; color: #374151;"><strong>Fecha del Reporte:</strong> ${formattedDate}</p>
        <p style="font-size: 14px; color: #374151;"><strong>Destinatario RH:</strong> <span style="color: #2563eb;">${emailRH || 'Por definir'}</span></p>
        <h3 style="font-size: 15px; color: #1f2937; border-bottom: 2px solid #1e293b; padding-bottom: 6px;">📋 Faltas y Ausencias</h3>
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

        <h3 style="font-size: 15px; color: #1f2937; border-bottom: 2px solid #1e293b; padding-bottom: 6px; margin-top: 28px;">🕒 Horas Extra Autorizadas</h3>
        <p style="font-size: 14px; color: #374151;"><strong>Total de Autorizaciones Hoy:</strong> <span style="background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-weight: bold;">${horasExtraList.length} autorización(es)</span></p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f3f4f6; color: #374151; font-size: 12px; text-transform: uppercase;">
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Colaborador</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Área</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Horas</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Tareas</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Autorizó</th>
            </tr>
          </thead>
          <tbody>
            ${horasExtraRowsHtml}
          </tbody>
        </table>

        <h3 style="font-size: 15px; color: #1f2937; border-bottom: 2px solid #1e293b; padding-bottom: 6px; margin-top: 28px;">🔍 Verificaciones y Correcciones de Horas Extra (Días Anteriores)</h3>
        <p style="font-size: 14px; color: #374151;"><strong>Total de Registros:</strong> <span style="background-color: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-weight: bold;">${verifiedPreviousDaysList.length} registro(s)</span></p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f3f4f6; color: #374151; font-size: 12px; text-transform: uppercase;">
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Colaborador</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Área</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Autorización Original</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Verificación</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Corrección de Horario</th>
            </tr>
          </thead>
          <tbody>
            ${verifiedPreviousDaysRowsHtml}
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
 * Genera el cuerpo en texto y HTML del correo vespertino/sabatino de RH, que a diferencia
 * del reporte de las 10:00 AM SOLO incluye la relación de personal con horas extra
 * autorizadas el día de hoy (sin faltas ni verificaciones de días anteriores).
 */
export const buildRHOvertimeReportEmailContent = (horasExtraList, dateStr, emailRH, horaLabel) => {
  const formattedDate = new Date(`${dateStr}T00:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const subject = `[Dicrejart System] Relación de Horas Extra Autorizadas - ${dateStr} (${horaLabel})`;

  let textLines = [
    `=============================================================`,
    `DICREJART - RELACIÓN DE HORAS EXTRA AUTORIZADAS`,
    `=============================================================`,
    `Fecha: ${formattedDate}`,
    `Hora de corte: ${horaLabel}`,
    `Destinatario RH: ${emailRH || 'Por definir (No configurado)'}`,
    `Total de autorizaciones hoy: ${horasExtraList.length}`,
    `-------------------------------------------------------------`,
    ``
  ];

  if (horasExtraList.length === 0) {
    textLines.push(`No se autorizaron horas extra el día de hoy.`);
  } else {
    horasExtraList.forEach((he, index) => {
      textLines.push(`${index + 1}. COLABORADOR: ${he.operarioName} (ID: ${he.operarioId})`);
      textLines.push(`   • Área: ${he.areaId || 'N/A'}`);
      textLines.push(`   • Puesto: ${he.operarioPuesto || 'N/A'}`);
      textLines.push(`   • Horas Extra Autorizadas: ${describeOvertimeBlocks(he)}`);
      textLines.push(`   • Tareas a Realizar: ${he.overtimeTasks || 'N/A'}`);
      textLines.push(`   • Autorizó: ${he.authorizedBy || 'N/A'}`);
      textLines.push(`-------------------------------------------------------------`);
    });
  }

  textLines.push(``);
  textLines.push(`Este correo fue generado automáticamente por el Sistema Integral Dicrejart a las ${horaLabel}.`);

  const bodyText = textLines.join('\n');

  const rowsHtml = horasExtraList.length === 0
    ? `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #6b7280; background-color: #f9fafb;">No se autorizaron horas extra el día de hoy.</td></tr>`
    : horasExtraList.map((he, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f9fafb'}; font-size: 13px;">
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #1f2937;">${he.operarioName} <br/><span style="font-size:11px; color:#6b7280; font-weight:normal;">ID: ${he.operarioId}</span></td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #374151;">${he.areaId || 'N/A'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #92400e; font-weight: 600;">${describeOvertimeBlocks(he)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${he.overtimeTasks || 'N/A'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">${he.authorizedBy || 'N/A'}</td>
      </tr>
    `).join('');

  const bodyHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: #1e293b; color: #ffffff; padding: 20px; text-align: center;">
        <h2 style="margin: 0; font-size: 20px; font-weight: bold;">DICREJART - Control de Calidad y Operarios</h2>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Relación de Horas Extra Autorizadas (${horaLabel})</p>
      </div>
      <div style="padding: 20px;">
        <p style="font-size: 14px; color: #374151;"><strong>Fecha del Reporte:</strong> ${formattedDate}</p>
        <p style="font-size: 14px; color: #374151;"><strong>Destinatario RH:</strong> <span style="color: #2563eb;">${emailRH || 'Por definir'}</span></p>
        <h3 style="font-size: 15px; color: #1f2937; border-bottom: 2px solid #1e293b; padding-bottom: 6px;">🕒 Horas Extra Autorizadas</h3>
        <p style="font-size: 14px; color: #374151;"><strong>Total de Autorizaciones Hoy:</strong> <span style="background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-weight: bold;">${horasExtraList.length} autorización(es)</span></p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f3f4f6; color: #374151; font-size: 12px; text-transform: uppercase;">
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Colaborador</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Área</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Horas</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Tareas</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Autorizó</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div style="background-color: #f9fafb; padding: 12px 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
        Generado automáticamente por el Sistema Dicrejart. Notificación programada para Recursos Humanos a las ${horaLabel}.
      </div>
    </div>
  `;

  return { subject, bodyText, bodyHtml };
};

/**
 * Dispara o simula el envío del correo vespertino/sabatino de RH con la relación de horas
 * extra autorizadas hoy (de lunes a viernes a las 17:30, sábado a las 12:00 — ver el
 * chequeo de horario en OperariosContext.jsx). Reutiliza el mismo candado atómico por día
 * que triggerDailyRHNotification, pero en su propio campo (`lastRHOvertimeNotificationDate`)
 * para no interferir con el reporte de las 10:00 AM.
 */
export const triggerRHOvertimeNotification = async ({
  horasExtra = [],
  generalConfig = {},
  updateGeneralConfig = null,
  force = false,
  user = null,
  horaLabel = '',
}) => {
  const todayStr = getTodayLocalDateStr();

  if (!force) {
    if (generalConfig.notificarHorasExtraRH === false) {
      return { ok: false, reason: 'Notificación de horas extra a RH desactivada en la configuración.' };
    }

    if (!db) return { ok: false, reason: 'Firestore no está inicializado.' };

    try {
      await runTransaction(db, async (tx) => {
        const configRef = doc(db, 'config', 'general');
        const snap = await tx.get(configRef);
        const currentLastDate = snap.exists() ? snap.data().lastRHOvertimeNotificationDate : null;
        if (currentLastDate === todayStr) {
          throw new Error('ALREADY_SENT');
        }
        tx.set(configRef, { lastRHOvertimeNotificationDate: todayStr }, { merge: true });
      });
    } catch (error) {
      if (error.message === 'ALREADY_SENT') {
        return { ok: false, reason: 'El correo de horas extra ya fue enviado el día de hoy.' };
      }
      console.error('Error al reclamar el envío de horas extra a RH:', error);
      return { ok: false, error: error.message };
    }
  }

  const horasExtraList = horasExtra.filter((he) => he.authorizedDate === todayStr && he.verificationStatus !== 'cancelado');
  const emailTarget = generalConfig.emailRH || 'recursoshumanos@dicrejart.com (Por definir)';
  const label = horaLabel || new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  const { subject, bodyText, bodyHtml } = buildRHOvertimeReportEmailContent(horasExtraList, todayStr, emailTarget, label);

  const notifId = `NOTIF-RH-HE-${Date.now()}`;
  const notifRecord = {
    id: notifId,
    type: 'horas_extra',
    date: todayStr,
    timestamp: new Date().toISOString(),
    emailRH: emailTarget,
    horasExtraCount: horasExtraList.length,
    horasExtraList: horasExtraList.map((he) => ({
      operarioId: he.operarioId,
      operarioName: he.operarioName,
      operarioPuesto: he.operarioPuesto || 'N/A',
      areaId: he.areaId || 'N/A',
      overtimeHours: he.overtimeHours,
      startHour: he.startHour,
      endHour: he.endHour,
      overtimeTasks: he.overtimeTasks || '',
      authorizedBy: he.authorizedBy || 'N/A',
    })),
    status: 'enviado',
    subject,
    bodyText,
    bodyHtml,
    enviadoPor: user ? user.name : (force ? 'Administrador' : `Sistema Programado (${label})`),
  };

  try {
    if (db) {
      await addDoc(collection(db, 'notificaciones_rh'), notifRecord);

      // Igual que en triggerDailyRHNotification: solo se reclama el candado del día si NO
      // fue un test forzado, para que probar el botón "Enviar Ahora" no bloquee el envío
      // automático real programado para más tarde ese mismo día.
      if (!force && updateGeneralConfig) {
        await updateGeneralConfig('lastRHOvertimeNotificationDate', todayStr);
      }
    }

    logAudit({
      user: user || { name: `Sistema Programado (${label})`, roleType: 'system' },
      module: 'operarios',
      action: 'Generó notificación de horas extra a RH',
      details: `Reporte enviado a ${emailTarget} con ${horasExtraList.length} autorización(es) de horas extra`
    });

    return {
      ok: true,
      horasExtraCount: horasExtraList.length,
      emailTarget,
      record: notifRecord,
    };
  } catch (error) {
    console.error('Error al enviar notificación de horas extra a RH:', error);
    return { ok: false, error: error.message };
  }
};

/**
 * Genera el cuerpo en texto y HTML del resumen SEMANAL de horas extra — la semana de
 * horas extra de Dicrejart corre de jueves a miércoles (no lunes-domingo), ver
 * getOvertimeWeekRange en dateUtils.js. Agrupa por área y, dentro de cada área, por
 * colaborador, sumando sus horas extra acumuladas en la semana.
 */
export const buildRHWeeklyOvertimeSummaryEmailContent = (weeklyHorasExtra, weekStart, weekEnd, emailRH) => {
  const formatFecha = (dateStr) => new Date(`${dateStr}T00:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const subject = `[Dicrejart System] Resumen Semanal de Horas Extra - ${weekStart} al ${weekEnd}`;

  // Agrupar por operario (sumando todas sus autorizaciones de la semana)
  const byOperario = new Map();
  weeklyHorasExtra.forEach((he) => {
    if (!byOperario.has(he.operarioId)) {
      byOperario.set(he.operarioId, {
        operarioId: he.operarioId,
        operarioName: he.operarioName,
        operarioPuesto: he.operarioPuesto || 'N/A',
        areaId: he.areaId || 'N/A',
        totalHours: 0,
        authCount: 0,
      });
    }
    const entry = byOperario.get(he.operarioId);
    entry.totalHours += Number(he.overtimeHours) || 0;
    entry.authCount += 1;
  });

  // Agrupar esos totales por área, orden descendente de horas dentro de cada área
  const byArea = new Map();
  Array.from(byOperario.values()).forEach((entry) => {
    if (!byArea.has(entry.areaId)) byArea.set(entry.areaId, []);
    byArea.get(entry.areaId).push(entry);
  });
  byArea.forEach((list) => list.sort((a, b) => b.totalHours - a.totalHours));

  const totalHorasGeneral = Array.from(byOperario.values()).reduce((sum, e) => sum + e.totalHours, 0);
  const totalColaboradores = byOperario.size;

  let textLines = [
    `=============================================================`,
    `DICREJART - RESUMEN SEMANAL DE HORAS EXTRA`,
    `=============================================================`,
    `Semana: ${formatFecha(weekStart)} al ${formatFecha(weekEnd)}`,
    `Destinatario RH: ${emailRH || 'Por definir (No configurado)'}`,
    `Total de horas extra acumuladas: ${totalHorasGeneral}h entre ${totalColaboradores} colaborador(es)`,
    `-------------------------------------------------------------`,
    ``,
  ];

  if (totalColaboradores === 0) {
    textLines.push(`No se registraron horas extra esta semana.`);
  } else {
    Array.from(byArea.entries()).forEach(([areaId, entries]) => {
      textLines.push(`ÁREA: ${areaId}`);
      entries.forEach((e) => {
        textLines.push(`  • ${e.operarioName} (${e.operarioPuesto}, ID: ${e.operarioId}): ${e.totalHours}h en ${e.authCount} autorización(es)`);
      });
      textLines.push(``);
    });
  }

  textLines.push(`Este correo fue generado automáticamente por el Sistema Integral Dicrejart.`);
  const bodyText = textLines.join('\n');

  const areaRowsHtml = totalColaboradores === 0
    ? `<tr><td colspan="4" style="padding: 16px; text-align: center; color: #6b7280; background-color: #f9fafb;">No se registraron horas extra esta semana.</td></tr>`
    : Array.from(byArea.entries()).map(([areaId, entries]) => entries.map((e, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f9fafb'}; font-size: 13px;">
        ${i === 0 ? `<td rowspan="${entries.length}" style="padding: 10px; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; font-weight: bold; color: #1f2937; vertical-align: top; text-transform: uppercase; font-size: 12px;">${areaId}</td>` : ''}
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #1f2937;">${e.operarioName} <br/><span style="font-size:11px; color:#6b7280; font-weight:normal;">${e.operarioPuesto} — ID: ${e.operarioId}</span></td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #92400e; font-weight: 700; text-align: center;">${e.totalHours}h</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280; text-align: center;">${e.authCount}</td>
      </tr>
    `).join('')).join('');

  const bodyHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: #1e293b; color: #ffffff; padding: 20px; text-align: center;">
        <h2 style="margin: 0; font-size: 20px; font-weight: bold;">DICREJART - Control de Calidad y Operarios</h2>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Resumen Semanal de Horas Extra (Jueves a Miércoles)</p>
      </div>
      <div style="padding: 20px;">
        <p style="font-size: 14px; color: #374151;"><strong>Semana:</strong> ${formatFecha(weekStart)} al ${formatFecha(weekEnd)}</p>
        <p style="font-size: 14px; color: #374151;"><strong>Destinatario RH:</strong> <span style="color: #2563eb;">${emailRH || 'Por definir'}</span></p>
        <p style="font-size: 14px; color: #374151;"><strong>Total Acumulado:</strong> <span style="background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-weight: bold;">${totalHorasGeneral}h entre ${totalColaboradores} colaborador(es)</span></p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f3f4f6; color: #374151; font-size: 12px; text-transform: uppercase;">
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Área</th>
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Colaborador</th>
              <th style="padding: 10px; text-align: center; border-bottom: 2px solid #d1d5db;">Horas Extra</th>
              <th style="padding: 10px; text-align: center; border-bottom: 2px solid #d1d5db;">Autorizaciones</th>
            </tr>
          </thead>
          <tbody>
            ${areaRowsHtml}
          </tbody>
        </table>
      </div>
      <div style="background-color: #f9fafb; padding: 12px 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
        Generado automáticamente por el Sistema Dicrejart. Corte semanal de horas extra: jueves a miércoles.
      </div>
    </div>
  `;

  return { subject, bodyText, bodyHtml };
};

/**
 * Dispara o simula el envío del resumen semanal de horas extra a RH (programado para los
 * miércoles, o manual). Usa su propio candado atómico (`lastRHWeeklySummaryDate`) para no
 * interferir con las otras dos notificaciones de RH.
 */
export const triggerRHWeeklyOvertimeSummary = async ({
  horasExtra = [],
  generalConfig = {},
  updateGeneralConfig = null,
  force = false,
  user = null,
  weekRange = null,
}) => {
  const todayStr = getTodayLocalDateStr();

  if (!force) {
    if (generalConfig.notificarResumenSemanalRH === false) {
      return { ok: false, reason: 'Resumen semanal de horas extra desactivado en la configuración.' };
    }

    if (!db) return { ok: false, reason: 'Firestore no está inicializado.' };

    try {
      await runTransaction(db, async (tx) => {
        const configRef = doc(db, 'config', 'general');
        const snap = await tx.get(configRef);
        const currentLastDate = snap.exists() ? snap.data().lastRHWeeklySummaryDate : null;
        if (currentLastDate === todayStr) {
          throw new Error('ALREADY_SENT');
        }
        tx.set(configRef, { lastRHWeeklySummaryDate: todayStr }, { merge: true });
      });
    } catch (error) {
      if (error.message === 'ALREADY_SENT') {
        return { ok: false, reason: 'El resumen semanal ya fue enviado el día de hoy.' };
      }
      console.error('Error al reclamar el envío del resumen semanal a RH:', error);
      return { ok: false, error: error.message };
    }
  }

  const { start, end } = weekRange || getOvertimeWeekRange(todayStr);
  const weeklyList = horasExtra.filter((he) => he.authorizedDate >= start && he.authorizedDate <= end && he.verificationStatus !== 'cancelado');
  const emailTarget = generalConfig.emailRH || 'recursoshumanos@dicrejart.com (Por definir)';

  const { subject, bodyText, bodyHtml } = buildRHWeeklyOvertimeSummaryEmailContent(weeklyList, start, end, emailTarget);

  const totalHoras = weeklyList.reduce((sum, he) => sum + (Number(he.overtimeHours) || 0), 0);
  const totalColaboradores = new Set(weeklyList.map((he) => he.operarioId)).size;

  const notifId = `NOTIF-RH-WK-${Date.now()}`;
  const notifRecord = {
    id: notifId,
    type: 'resumen_semanal',
    date: todayStr,
    weekStart: start,
    weekEnd: end,
    timestamp: new Date().toISOString(),
    emailRH: emailTarget,
    totalHoras,
    totalColaboradores,
    status: 'enviado',
    subject,
    bodyText,
    bodyHtml,
    enviadoPor: user ? user.name : (force ? 'Administrador' : 'Sistema Programado (Miércoles)'),
  };

  try {
    if (db) {
      await addDoc(collection(db, 'notificaciones_rh'), notifRecord);

      if (!force && updateGeneralConfig) {
        await updateGeneralConfig('lastRHWeeklySummaryDate', todayStr);
      }
    }

    logAudit({
      user: user || { name: 'Sistema Programado (Miércoles)', roleType: 'system' },
      module: 'operarios',
      action: 'Generó resumen semanal de horas extra a RH',
      details: `Semana ${start} al ${end}: ${totalHoras}h entre ${totalColaboradores} colaborador(es)`,
    });

    return {
      ok: true,
      weekStart: start,
      weekEnd: end,
      totalHoras,
      totalColaboradores,
      emailTarget,
      record: notifRecord,
    };
  } catch (error) {
    console.error('Error al enviar resumen semanal de horas extra a RH:', error);
    return { ok: false, error: error.message };
  }
};

/**
 * Dispara o simula el envío del reporte de faltas a RH (programado a las 10:00 AM o manual)
 */
export const triggerDailyRHNotification = async ({
  operarios = [],
  horasExtra = [],
  generalConfig = {},
  updateGeneralConfig = null,
  force = false,
  user = null,
}) => {
  const todayStr = getTodayLocalDateStr();

  // Si no está forzado, verificar que notificarFaltasRH esté activo y reclamar el envío
  // de HOY de forma atómica. Cada sesión abierta (cada dispositivo/pestaña con la app
  // abierta) corre este mismo chequeo por su cuenta cada minuto, y además el useEffect que
  // lo dispara en OperariosContext.jsx se vuelve a ejecutar cada vez que cambian los
  // operarios/horasExtra (varias veces por minuto en horas pico) — sin una transacción, dos
  // (o tres) de esas evaluaciones casi simultáneas leían `lastRHNotificationDate` ANTES de
  // que la escritura de la primera terminara de propagarse por el listener en tiempo real,
  // así que todas pasaban el chequeo y cada una creaba su propio documento en
  // `notificaciones_rh` — y cada documento nuevo dispara un correo real por SMTP (ver
  // functions/index.js → onNotificacionRHCreated). La transacción hace que solo la primera
  // en llegar "gane" el día; el resto ve el candado ya tomado y se retira sin enviar nada.
  if (!force) {
    if (generalConfig.notificarFaltasRH === false) {
      return { ok: false, reason: 'Notificaciones a RH desactivadas en la configuración.' };
    }

    if (!db) return { ok: false, reason: 'Firestore no está inicializado.' };

    try {
      await runTransaction(db, async (tx) => {
        const configRef = doc(db, 'config', 'general');
        const snap = await tx.get(configRef);
        const currentLastDate = snap.exists() ? snap.data().lastRHNotificationDate : null;
        if (currentLastDate === todayStr) {
          throw new Error('ALREADY_SENT');
        }
        tx.set(configRef, { lastRHNotificationDate: todayStr }, { merge: true });
      });
    } catch (error) {
      if (error.message === 'ALREADY_SENT') {
        return { ok: false, reason: 'El reporte de RH ya fue enviado el día de hoy.' };
      }
      console.error('Error al reclamar el envío diario a RH:', error);
      return { ok: false, error: error.message };
    }
  }

  // Filtrar colaboradores ausentes (diferentes de 'activo' en la fecha de hoy)
  const absentList = operarios.filter((op) => isOperarioAusenteEnFecha(op.estado, todayStr));
  // Horas extra autorizadas HOY (se excluyen las canceladas, ver cancelPendingHorasExtra
  // en OperariosContext.jsx — un registro cancelado ya no representa una autorización vigente)
  const horasExtraList = horasExtra.filter((he) => he.authorizedDate === todayStr && he.verificationStatus !== 'cancelado');
  // Verificaciones (cumplido/no_cumplido) y correcciones de horario registradas HOY, pero
  // de autorizaciones de un día ANTERIOR — la verificación normalmente ocurre después de
  // que el turno ya pasó, así que sin esto esos comentarios/cambios (con su justificación
  // obligatoria) nunca llegarían a aparecer en ningún reporte a RH.
  const verifiedPreviousDaysList = horasExtra.filter((he) => {
    if (he.authorizedDate === todayStr) return false;
    const verifiedToday = he.verifiedAt && he.verifiedAt.startsWith(todayStr) && he.verificationStatus !== 'pendiente' && he.verificationStatus !== 'cancelado';
    const correctedToday = he.scheduleCorrection?.correctedAt && he.scheduleCorrection.correctedAt.startsWith(todayStr);
    return verifiedToday || correctedToday;
  });
  const emailTarget = generalConfig.emailRH || 'recursoshumanos@dicrejart.com (Por definir)';

  const { subject, bodyText, bodyHtml } = buildRHReportEmailContent(absentList, todayStr, emailTarget, horasExtraList, verifiedPreviousDaysList);

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
    horasExtraCount: horasExtraList.length,
    horasExtraList: horasExtraList.map((he) => ({
      operarioId: he.operarioId,
      operarioName: he.operarioName,
      operarioPuesto: he.operarioPuesto || 'N/A',
      areaId: he.areaId || 'N/A',
      overtimeHours: he.overtimeHours,
      startHour: he.startHour,
      endHour: he.endHour,
      overtimeTasks: he.overtimeTasks || '',
      authorizedBy: he.authorizedBy || 'N/A',
      verificationStatus: he.verificationStatus || 'pendiente',
      verificationNotes: he.verificationNotes || '',
      verifiedBy: he.verifiedBy || null,
      scheduleCorrection: he.scheduleCorrection || null,
    })),
    verifiedPreviousDaysCount: verifiedPreviousDaysList.length,
    verifiedPreviousDaysList: verifiedPreviousDaysList.map((he) => ({
      operarioId: he.operarioId,
      operarioName: he.operarioName,
      operarioPuesto: he.operarioPuesto || 'N/A',
      areaId: he.areaId || 'N/A',
      authorizedDate: he.authorizedDate,
      overtimeHours: he.overtimeHours,
      startHour: he.startHour,
      endHour: he.endHour,
      authorizedBy: he.authorizedBy || 'N/A',
      verificationStatus: he.verificationStatus || 'pendiente',
      verificationNotes: he.verificationNotes || '',
      verifiedBy: he.verifiedBy || null,
      scheduleCorrection: he.scheduleCorrection || null,
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

      // Registrar la fecha del último envío en la configuración general SOLO si no fue un
      // test forzado ("📧 Probar / Enviar Ahora" desde Admin) — antes esto se guardaba
      // siempre, así que probar el botón en pleno día "reclamaba" el candado del envío
      // automático de HOY, y el disparo real programado (10:00 AM) ya no se enviaba
      // después porque veía el día ya marcado como enviado.
      if (!force && updateGeneralConfig) {
        await updateGeneralConfig('lastRHNotificationDate', todayStr);
      }
    }

    logAudit({
      user: user || { name: 'Sistema Programado (10:00 AM)', roleType: 'system' },
      module: 'operarios',
      action: 'Generó notificación por correo a RH',
      details: `Reporte enviado a ${emailTarget} con ${absentList.length} personal ausente y ${horasExtraList.length} autorización(es) de horas extra`
    });

    return {
      ok: true,
      absentCount: absentList.length,
      horasExtraCount: horasExtraList.length,
      emailTarget,
      record: notifRecord,
    };
  } catch (error) {
    console.error('Error al enviar notificación a RH:', error);
    return { ok: false, error: error.message };
  }
};
