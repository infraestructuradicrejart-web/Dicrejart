/**
 * @file chatNotificationService.js
 * @description Servicio centralizado para enviar notificaciones automáticas y alertas
 * del sistema al Chat Interno (chat global o chats privados de colaboradores) cuando
 * ocurren cancelaciones, eliminaciones o cambios de asignación.
 * @author Dicrejart Dev Team
 */

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const GLOBAL_CHAT_ID = 'global';

const getPrivateChatId = (uidA, uidB) => [uidA, uidB].sort().join('_');

/**
 * Publica un mensaje formateado del sistema en el chat global o en un chat privado
 */
export const sendSystemChatMessage = async ({
  targetUserId = null,
  targetUserName = 'Colaborador',
  text,
  senderId = 'sistema',
  senderName = 'Sistema Dicrejart',
  isGlobal = false,
}) => {
  if (!db || !text?.trim()) return { ok: false };

  try {
    const isPrivate = !isGlobal && Boolean(targetUserId) && targetUserId !== senderId;
    const chatId = isPrivate ? getPrivateChatId(senderId, targetUserId) : GLOBAL_CHAT_ID;
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const nowIso = new Date().toISOString();

    const formattedSenderName = senderName.startsWith('📢') || senderName.startsWith('🤖')
      ? senderName
      : `📢 ${senderName}`;

    // 1. Crear el mensaje en la subcolección de mensajes
    await setDoc(doc(db, 'chats', chatId, 'messages', messageId), {
      id: messageId,
      senderId,
      senderName: formattedSenderName,
      text: text.trim(),
      createdAt: nowIso,
      isSystemAlert: true,
    });

    // 2. Actualizar el documento principal del chat para que aparezca arriba en la lista
    if (isPrivate) {
      await setDoc(
        doc(db, 'chats', chatId),
        {
          id: chatId,
          type: 'private',
          participants: [senderId, targetUserId].sort(),
          participantNames: {
            [senderId]: senderName,
            [targetUserId]: targetUserName,
          },
          lastMessage: text.trim(),
          lastMessageAt: nowIso,
          lastMessageSenderId: senderId,
        },
        { merge: true }
      );
    } else {
      await setDoc(
        doc(db, 'chats', GLOBAL_CHAT_ID),
        {
          id: GLOBAL_CHAT_ID,
          type: 'global',
          lastMessage: text.trim(),
          lastMessageAt: nowIso,
          lastMessageSenderId: senderId,
        },
        { merge: true }
      );
    }

    return { ok: true };
  } catch (error) {
    console.error('Error al enviar mensaje automático al chat:', error);
    return { ok: false, error: error.message };
  }
};

/**
 * Notifica en el chat cuando una actividad / tarea es eliminada o cancelada
 */
export const notifyActivityDeleted = async ({
  activity,
  user,
  operarios = [],
  dynamicAreas = [],
}) => {
  if (!activity) return;

  const operario = operarios.find((o) => o.id === activity.operarioId);
  const areaName = dynamicAreas.find((a) => a.id === activity.areaId)?.name || activity.areaId || 'General';
  const authorName = user?.name || 'Administración';
  const authorId = user?.id || 'admin';
  const title = activity.title || 'Sin título';

  let alertMessage = `⚠️ [Aviso de Tarea] La actividad "${title}" (Área: ${areaName})`;

  if (operario?.name) {
    alertMessage += ` que estaba asignada a @${operario.name}`;
  }

  alertMessage += ` fue eliminada/cancelada por ${authorName}. Ya no es necesario realizar esta actividad.`;

  // Si tiene un colaborador asignado con ID
  if (activity.operarioId) {
    await sendSystemChatMessage({
      targetUserId: activity.operarioId,
      targetUserName: operario?.name || 'Colaborador',
      text: alertMessage,
      senderId: authorId,
      senderName: authorName,
      isGlobal: false,
    });
  }

  // También se notifica en el Chat Global para que supervisores de área estén al tanto
  await sendSystemChatMessage({
    text: alertMessage,
    senderId: authorId,
    senderName: authorName,
    isGlobal: true,
  });
};

/**
 * Notifica en el Chat Global cuando un proyecto completo es eliminado o cancelado
 */
export const notifyProjectDeleted = async ({ project, user }) => {
  if (!project) return;

  const authorName = user?.name || 'Administración';
  const authorId = user?.id || 'admin';
  const projectName = project.name || project.id || 'Proyecto';

  const alertMessage = `🚨 [Aviso de Proyecto] El proyecto "${projectName}" ha sido eliminado/cancelado por ${authorName}. Todos los trabajos, actividades y despieces asociados quedan cancelados.`;

  await sendSystemChatMessage({
    text: alertMessage,
    senderId: authorId,
    senderName: authorName,
    isGlobal: true,
  });
};
