/**
 * @file ChatContext.jsx
 * @description Contexto global del chat interno de Dicrejart: un chat global (toda la
 * empresa) y chats privados 1 a 1 entre cualquier par de usuarios. Conectado en tiempo
 * real con Cloud Firestore (mismo patrón `onSnapshot` que el resto de la app).
 * @author Dicrejart Dev Team
 * @requires react
 * @requires firebase/firestore
 */

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import PropTypes from 'prop-types';
import {
  collection,
  doc,
  setDoc,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { AuthContext } from './AuthContext';

export const ChatContext = createContext(null);

const GLOBAL_CHAT_ID = 'global';

/**
 * Id determinístico de un chat privado: siempre el mismo sin importar quién de los dos
 * lo inicia, para que nunca existan dos hilos distintos entre el mismo par de personas.
 */
const getPrivateChatId = (uidA, uidB) => [uidA, uidB].sort().join('_');

export const ChatProvider = ({ children }) => {
  const [globalChat, setGlobalChat] = useState(null);
  const [privateChats, setPrivateChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const { user } = useContext(AuthContext) || {};

  // ============================================
  // ESCUCHA EN TIEMPO REAL: LISTA DE CONVERSACIONES
  // ============================================
  // El chat global es un solo documento fijo; los chats privados se obtienen con una
  // query "participants array-contains mi uid". Se espera a onAuthStateChanged por la
  // misma razón que el resto de los contextos: este Provider envuelve toda la app.
  useEffect(() => {
    if (!db || !auth) return undefined;

    let unsubGlobal = null;
    let unsubPrivate = null;

    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      if (unsubGlobal) unsubGlobal();
      if (unsubPrivate) unsubPrivate();

      if (!fbUser) {
        setGlobalChat(null);
        setPrivateChats([]);
        return;
      }

      unsubGlobal = onSnapshot(doc(db, 'chats', GLOBAL_CHAT_ID), (snap) => {
        setGlobalChat(snap.exists() ? snap.data() : { id: GLOBAL_CHAT_ID, type: 'global' });
      });

      unsubPrivate = onSnapshot(
        query(collection(db, 'chats'), where('participants', 'array-contains', fbUser.uid)),
        (snap) => {
          const list = [];
          snap.forEach((d) => list.push(d.data()));
          list.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
          setPrivateChats(list);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubGlobal) unsubGlobal();
      if (unsubPrivate) unsubPrivate();
    };
  }, []);

  // ============================================
  // ESCUCHA EN TIEMPO REAL: MENSAJES DE LA CONVERSACIÓN ABIERTA
  // ============================================
  // Solo se suscriben los mensajes del chat que está abierto en este momento, no los de
  // todas las conversaciones a la vez.
  useEffect(() => {
    if (!db || !activeChatId) {
      setMessages([]);
      return undefined;
    }
    const unsub = onSnapshot(
      query(collection(db, 'chats', activeChatId, 'messages'), orderBy('createdAt', 'asc')),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        setMessages(list);
      }
    );
    return () => unsub();
  }, [activeChatId]);

  const openChat = useCallback((chatId) => {
    setActiveChatId(chatId);
  }, []);

  /**
   * Asegura que exista el documento de un chat privado entre el usuario actual y otro
   * (lo crea si es la primera vez); regresa el id determinístico de esa conversación.
   */
  const startPrivateChat = useCallback(async (otherUserId, otherUserName) => {
    if (!db || !user) return null;
    const chatId = getPrivateChatId(user.id, otherUserId);
    await setDoc(
      doc(db, 'chats', chatId),
      {
        id: chatId,
        type: 'private',
        participants: [user.id, otherUserId].sort(),
        participantNames: { [user.id]: user.name, [otherUserId]: otherUserName },
      },
      { merge: true }
    );
    return chatId;
  }, [user]);

  const sendMessage = useCallback(async (chatId, text) => {
    if (!db || !user || !text.trim()) return { ok: false };
    try {
      const messageId = `MSG-${Date.now()}`;
      await setDoc(doc(db, 'chats', chatId, 'messages', messageId), {
        id: messageId,
        senderId: user.id,
        senderName: user.name,
        text: text.trim(),
        createdAt: new Date().toISOString(),
      });
      await setDoc(
        doc(db, 'chats', chatId),
        {
          id: chatId,
          lastMessage: text.trim(),
          lastMessageAt: new Date().toISOString(),
          lastMessageSenderId: user.id,
        },
        { merge: true }
      );
      return { ok: true };
    } catch (error) {
      console.error('Error al enviar mensaje de chat:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /**
   * Marca la conversación como vista hasta este momento (limpia el no-leído). Usa
   * `setDoc` con `merge` en vez de `updateDoc` porque se puede abrir el chat global
   * antes de que nadie haya mandado el primer mensaje — en ese caso el documento
   * todavía no existe, y `updateDoc` lanzaría error al no encontrarlo.
   *
   * Importante: el campo anidado se manda como objeto real (`lastReadAt: {uid: ...}`),
   * no como una clave con punto (`'lastReadAt.uid': ...`) — a diferencia de `updateDoc`,
   * `setDoc` con `merge` NO interpreta las claves con punto como rutas anidadas; las
   * guarda tal cual, como un campo literal con un punto en el nombre. Solo el objeto
   * anidado real se fusiona correctamente campo por campo dentro de `lastReadAt`.
   */
  const markChatRead = useCallback(async (chatId) => {
    if (!db || !user) return;
    try {
      await setDoc(
        doc(db, 'chats', chatId),
        {
          id: chatId,
          type: chatId === GLOBAL_CHAT_ID ? 'global' : 'private',
          lastReadAt: { [user.id]: new Date().toISOString() },
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Error al marcar el chat como leído:', error);
    }
  }, [user]);

  const isUnread = useCallback((chat) => {
    if (!chat || !user || !chat.lastMessageAt) return false;
    if (chat.lastMessageSenderId === user.id) return false;
    const lastRead = chat.lastReadAt?.[user.id];
    if (!lastRead) return true;
    return new Date(chat.lastMessageAt) > new Date(lastRead);
  }, [user]);

  /**
   * Elimina una conversación privada solo del lado del usuario actual: no borra el
   * documento ni los mensajes (la otra persona sigue viendo todo con normalidad), solo
   * guarda desde cuándo la ocultó. Si después llega un mensaje nuevo, la conversación
   * reaparece en su lista automáticamente (igual que "eliminar chat" en WhatsApp).
   */
  const deleteConversation = useCallback(async (chatId) => {
    if (!db || !user || chatId === GLOBAL_CHAT_ID) return { ok: false, error: 'No se puede eliminar el chat global.' };
    try {
      await setDoc(
        doc(db, 'chats', chatId),
        { clearedAt: { [user.id]: new Date().toISOString() } },
        { merge: true }
      );
      setActiveChatId((prev) => (prev === chatId ? null : prev));
      return { ok: true };
    } catch (error) {
      console.error('Error al eliminar la conversación:', error);
      return { ok: false, error: error.message };
    }
  }, [user]);

  /** true si el usuario ya "eliminó" esta conversación y no ha llegado nada nuevo desde entonces. */
  const isHiddenForMe = useCallback((chat) => {
    if (!user || chat.id === GLOBAL_CHAT_ID) return false;
    const clearedAt = chat.clearedAt?.[user.id];
    if (!clearedAt) return false;
    if (!chat.lastMessageAt) return true;
    return new Date(chat.lastMessageAt) <= new Date(clearedAt);
  }, [user]);

  const chats = useMemo(() => {
    const list = privateChats.filter((c) => !isHiddenForMe(c));
    if (globalChat) list.unshift(globalChat);
    return list;
  }, [globalChat, privateChats, isHiddenForMe]);

  const totalUnreadCount = useMemo(
    () => chats.filter((c) => c.id !== activeChatId && isUnread(c)).length,
    [chats, isUnread, activeChatId]
  );

  const value = useMemo(
    () => ({
      chats,
      activeChatId,
      messages,
      openChat,
      startPrivateChat,
      sendMessage,
      markChatRead,
      isUnread,
      totalUnreadCount,
      getPrivateChatId,
      deleteConversation,
    }),
    [chats, activeChatId, messages, openChat, startPrivateChat, sendMessage, markChatRead, isUnread, totalUnreadCount, deleteConversation]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

ChatProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
