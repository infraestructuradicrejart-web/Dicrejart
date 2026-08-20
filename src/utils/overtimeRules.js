/**
 * @file overtimeRules.js
 * @description Utilidades y reglas de negocio para la gestión de horas extras en Dicrejart.
 * Incluye la regla de bloqueo automático por inasistencia (penalización de 7 días naturales)
 * y el cálculo dinámico de franjas de horario (Matutino vs Vespertino).
 * @author Dicrejart Dev Team
 */

import { getTodayLocalDateStr } from './dateUtils';

/**
 * Nombres y descripciones de los tipos de ausencia
 */
export const AUSENCIA_TITULOS = {
  falta: 'Falta (Inasistencia)',
  incapacidad: 'Incapacidad Médica',
  salida_campo: 'Salida Fuera / Actividad Externa',
  viaje: 'Viaje / Ensamble Foráneo',
  actividad_externa: 'Comisión Externa',
  vacaciones: 'Vacaciones / Permiso',
};

/**
 * Determina si un colaborador está ausente en una fecha específica (por falta, incapacidad, vacaciones, etc.)
 * Si no tiene fecha 'hasta', una falta o salida de campo es solo para ese día ('desde'), no indefinida.
 */
export const isOperarioAusenteEnFecha = (estado, targetDateStr = getTodayLocalDateStr()) => {
  if (!estado || !estado.tipo || estado.tipo === 'activo') return false;
  const desde = estado.desde || targetDateStr;
  const hasta = estado.hasta;
  if (hasta) {
    return targetDateStr >= desde && targetDateStr <= hasta;
  }
  // Si no tiene fecha 'hasta':
  // Para falta o salida a campo aplica únicamente en el día de la inasistencia (desde)
  if (estado.tipo === 'falta' || estado.tipo === 'salida_campo') {
    return targetDateStr === desde;
  }
  // Para incapacidad o vacaciones sin 'hasta', aplica a partir de 'desde'
  return targetDateStr >= desde;
};

/**
 * Evalúa si un colaborador es elegible para solicitar o realizar horas extras en la fecha solicitada.
 * Regla de Inasistencia: Si el colaborador registró una 'falta' dentro de los 7 días naturales
 * anteriores a targetDateStr, queda BLOQUEADO AUTOMÁTICAMENTE para horas extras durante esos 7 días.
 * Si la falta fue corregida o eliminada (colaborador en estado 'activo'), se desbloquea de inmediato.
 *
 * @param {Object} operario - Objeto completo del colaborador
 * @param {string} targetDateStr - Fecha para la cual se piden horas extras (YYYY-MM-DD)
 * @returns {{ isEligible: boolean, reason: string, blockedUntil: string|null }}
 */
export const checkOvertimeEligibility = (operario, targetDateStr = getTodayLocalDateStr()) => {
  if (!operario) {
    return { isEligible: false, reason: 'Colaborador no encontrado.', blockedUntil: null };
  }

  const targetDateObj = new Date(`${targetDateStr}T00:00:00`);

  // 1. Verificar si tiene una ausencia activa en la fecha solicitada
  if (isOperarioAusenteEnFecha(operario.estado, targetDateStr)) {
    const tipo = operario.estado.tipo;
    const desde = operario.estado.desde || targetDateStr;
    const hasta = operario.estado.hasta;

    return {
      isEligible: false,
      reason: `⛔ No disponible: El colaborador está registrado como ${AUSENCIA_TITULOS[tipo] || tipo} (${operario.estado.notas || 'Sin notas'})`,
      blockedUntil: hasta || desde,
    };
  }

  // 2. Si el colaborador está actualmente en 'activo' (En Planta) y fue corregido de un error,
  // solo se consideran faltas no anuladas ni rectificadas
  const historial = operario.estadoHistorial || [];
  const faltas = (operario.estado && operario.estado.tipo !== 'activo' && operario.estado.tipo === 'falta')
    ? [...historial.filter((h) => h && h.tipo === 'falta'), operario.estado]
    : historial.filter((h) => h && h.tipo === 'falta');

  const todayStr = getTodayLocalDateStr();

  for (const faltaRecord of faltas) {
    if (faltaRecord.anulado || faltaRecord.eliminado) continue;
    const fechaFaltaStr = faltaRecord.desde || (faltaRecord.registradoAt ? faltaRecord.registradoAt.split('T')[0] : null);
    if (!fechaFaltaStr) continue;

    // Si el estado actual es 'activo' y se corrigió con fecha posterior o igual al registro de la falta
    if (operario.estado?.tipo === 'activo') {
      const fechaActivoStr = operario.estado.desde || (operario.estado.registradoAt ? operario.estado.registradoAt.split('T')[0] : todayStr);
      if (
        fechaActivoStr >= fechaFaltaStr &&
        operario.estado.registradoAt &&
        faltaRecord.registradoAt &&
        operario.estado.registradoAt >= faltaRecord.registradoAt
      ) {
        continue;
      }
    }

    const fechaFaltaObj = new Date(`${fechaFaltaStr}T00:00:00`);
    const diffTime = targetDateObj.getTime() - fechaFaltaObj.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));

    // Si la falta ocurrió entre 0 y 6 días antes de la fecha solicitada (bloqueo de 7 días naturales)
    if (diffDays >= 0 && diffDays < 7) {
      const fechaDesbloqueoObj = new Date(fechaFaltaObj);
      fechaDesbloqueoObj.setDate(fechaDesbloqueoObj.getDate() + 7);
      const fechaDesbloqueoStr = fechaDesbloqueoObj.toISOString().split('T')[0];

      return {
        isEligible: false,
        reason: `⛔ Bloqueado automáticamente: El colaborador registró una inasistencia el ${fechaFaltaStr}. Penalización activa de 7 días naturales sin horas extras (desbloqueo el ${fechaDesbloqueoStr}).`,
        blockedUntil: fechaDesbloqueoStr,
        fechaFalta: fechaFaltaStr,
      };
    }
  }

  return { isEligible: true, reason: 'Elegible para horas extras.', blockedUntil: null };
};

/**
 * Calcula los horarios de inicio y fin ajustados sumando las horas extras al bloque Matutino o Vespertino.
 *
 * @param {number} baseStart - Hora de inicio base (ej. 8); en bloque 'domingo' es la hora
 *   de entrada REAL de ese turno (no hay jornada base que extender un domingo)
 * @param {number} baseEnd - Hora de fin base (ej. 18 o 13 los sábados); en bloque
 *   'domingo' es la hora de salida REAL de ese turno
 * @param {number} overtimeHours - Cantidad de horas extras (ej. 2); ignorado en bloque
 *   'domingo', se recalcula directo de baseStart/baseEnd
 * @param {'matutino'|'vespertino'|'domingo'} bloque - Bloque de tiempo extra
 * @returns {{ startHour: number, endHour: number, overtimeHours: number, bloque: string }}
 */
/**
 * Indica si una autorización de tiempo extra ya puede verificarse (¿de verdad se
 * cumplieron las tareas asignadas?) — no tiene sentido preguntarlo antes de que el turno
 * en cuestión haya ocurrido.
 * - Fecha anterior a hoy: siempre verificable (el día ya pasó completo).
 * - Fecha futura: nunca verificable todavía (no se ha trabajado ese tiempo extra).
 * - Fecha de HOY: verificable solo si ya pasó la hora de salida del bloque (`endHour`).
 *
 * @param {{authorizedDate: string, endHour: number}} h - Registro de horas_extra
 * @param {Date} [now] - Momento a evaluar (por defecto, ahora)
 * @returns {boolean}
 */
export const isOvertimeVerifiable = (h, now = new Date()) => {
  if (!h?.authorizedDate) return false;
  const todayStr = getTodayLocalDateStr(now);
  if (h.authorizedDate < todayStr) return true;
  if (h.authorizedDate > todayStr) return false;
  const currentDecimalHour = now.getHours() + now.getMinutes() / 60;
  return currentDecimalHour >= Number(h.endHour);
};

export const calculateScheduleFromOvertime = (baseStart = 8, baseEnd = 18, overtimeHours = 0, bloque = 'vespertino') => {
  // Domingo es un turno completo desde cero, no una extensión de una jornada base — se
  // usan las horas de entrada/salida tal cual, sin los topes de 6:00/22:00 que sí aplican
  // a matutino/vespertino (esos topes asumen que ya existe una jornada 8-18 de por medio).
  if (bloque === 'domingo') {
    return { startHour: baseStart, endHour: baseEnd, overtimeHours: Math.max(0, baseEnd - baseStart), bloque: 'domingo' };
  }

  const hours = Number(overtimeHours) || 0;
  if (hours <= 0) {
    return { startHour: baseStart, endHour: baseEnd, overtimeHours: 0, bloque };
  }

  if (bloque === 'matutino') {
    // Las horas extras matutinas inician a las 6:00 AM como máximo (máximo 2h antes de las 8:00 AM)
    const effectiveHours = Math.min(hours, Math.max(0, baseStart - 6));
    const newStart = Math.max(6, baseStart - effectiveHours);
    return {
      startHour: newStart,
      endHour: baseEnd,
      overtimeHours: effectiveHours,
      bloque: 'matutino',
    };
  }

  // Bloque 'vespertino': las horas extras terminan a las 22:00 (10:00 PM) como máximo (hasta 4h después de las 18:00 PM)
  const effectiveHours = Math.min(hours, Math.max(0, 22 - baseEnd));
  const newEnd = Math.min(22, baseEnd + effectiveHours);
  return {
    startHour: baseStart,
    endHour: newEnd,
    overtimeHours: effectiveHours,
    bloque: 'vespertino',
  };
};
