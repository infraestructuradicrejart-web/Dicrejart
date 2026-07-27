/**
 * @file ChatPage.jsx
 * @description Chat interno de Dicrejart: un chat global (toda la empresa) y chats
 * privados 1 a 1 entre cualquier par de usuarios, en tiempo real.
 * @author Dicrejart Dev Team
 * @requires react
 * @requires framer-motion
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import useAuth from '../../hooks/useAuth';
import useChat from '../../hooks/useChat';
import useIsMobile from '../../hooks/useIsMobile';
import styles from './ChatPage.module.css';

/** Iniciales de un nombre completo (hasta 2 palabras) para el avatar circular. */
const getInitials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

/** Regresa {id, name} de la otra persona en un chat privado (no la del usuario actual). */
const getOtherParticipant = (chat, myId) => {
  if (!chat?.participantNames) return null;
  const entry = Object.entries(chat.participantNames).find(([uid]) => uid !== myId);
  return entry ? { id: entry[0], name: entry[1] } : null;
};

const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Detecta si el texto termina en "@algo" (una mención a medio escribir) para mostrar el picker. */
const getMentionQuery = (text) => {
  const match = text.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1] : null;
};

/** Reemplaza la mención a medio escribir al final del texto por el nombre completo elegido. */
const applyMention = (text, name) => text.replace(/@([^\s@]*)$/, `@${name} `);

/** Divide un mensaje en fragmentos, resaltando las menciones "@Nombre Completo" a usuarios reales. */
const renderMessageParts = (text, userNames, styles) => {
  if (userNames.length === 0) return text;
  const pattern = new RegExp(`@(${userNames.map(escapeRegExp).join('|')})`, 'g');
  const parts = text.split(pattern);
  // Al usar un grupo de captura, String.split intercala el texto normal y los nombres capturados
  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <span key={idx} className={styles.mention}>@{part}</span>
    ) : (
      part
    )
  );
};

const ChatPage = () => {
  const { user, users } = useAuth();
  const { chats, activeChatId, messages, openChat, startPrivateChat, sendMessage, markChatRead, isUnread, deleteConversation } = useChat();
  const isMobile = useIsMobile();
  // En mobile se muestra un solo panel a la vez: la lista, o la conversación abierta
  // (con un botón "←" para volver). En desktop ambos se ven siempre lado a lado, igual
  // que antes.
  const showList = !isMobile || !activeChatId;
  const showConversation = !isMobile || Boolean(activeChatId);
  const [text, setText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, chatId: null, label: '' });
  const messagesEndRef = useRef(null);
  const textInputRef = useRef(null);

  // Nombres reales de usuarios (más largos primero, para que "Miguel Suarez" se
  // reconozca completo antes que solo "Miguel" al resaltar menciones en los mensajes)
  const userNames = useMemo(
    () => [...new Set(users.map((u) => u.name).filter(Boolean))].sort((a, b) => b.length - a.length),
    [users]
  );

  // Autocompletado de menciones (@) mientras se escribe un mensaje
  const mentionQuery = getMentionQuery(text);
  const mentionMatches = useMemo(() => {
    if (activeChatId !== 'global' || mentionQuery === null) return [];
    return users.filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);
  }, [mentionQuery, users, activeChatId]);

  const activeChat = chats.find((c) => c.id === activeChatId) || null;

  // Auto-scroll al último mensaje cada vez que llega uno nuevo
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Marca la conversación abierta como leída (al abrirla y cada vez que llega un mensaje nuevo mientras sigue abierta)
  useEffect(() => {
    if (activeChatId) markChatRead(activeChatId);
  }, [activeChatId, messages.length, markChatRead]);

  const otherUsers = useMemo(() => users.filter((u) => u.id !== user?.id), [users, user]);

  const handleStartChat = async (otherUser) => {
    const chatId = await startPrivateChat(otherUser.id, otherUser.name);
    setPickerOpen(false);
    if (chatId) openChat(chatId);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || !activeChatId) return;
    const value = text;
    setText('');
    await sendMessage(activeChatId, value);
  };

  const handlePickMention = (name) => {
    setText((prev) => applyMention(prev, name));
    textInputRef.current?.focus();
  };

  const handleAskDelete = (chat, label) => {
    setDeleteConfirm({ isOpen: true, chatId: chat.id, label });
  };

  const handleCloseDeleteConfirm = () => {
    setDeleteConfirm({ isOpen: false, chatId: null, label: '' });
  };

  const handleConfirmDelete = async () => {
    await deleteConversation(deleteConfirm.chatId);
    handleCloseDeleteConfirm();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Chat"
        subtitle="Conversa con toda la empresa en el chat global, o directamente con alguien en privado. (Actualizado)"
        shape="mancha"
        accentColor="var(--color-tiffany-blue)"
      />

      <div className={styles.layout}>
        {showList && (
        <div className={styles.sidebarList}>
          <div className={styles.sidebarHeader}>
            <span>Conversaciones</span>
            <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>➕ Nueva</Button>
          </div>
          <div className={styles.chatList}>
            {chats.map((chat) => {
              const isGlobal = chat.id === 'global';
              const other = isGlobal ? null : getOtherParticipant(chat, user.id);
              const label = isGlobal ? 'Chat Global' : (other?.name || 'Usuario');
              const unread = isUnread(chat);
              return (
                <div
                  key={chat.id}
                  className={`${styles.chatRow} ${chat.id === activeChatId ? styles.chatRowActive : ''}`}
                >
                  <button type="button" className={styles.chatRowMain} onClick={() => openChat(chat.id)}>
                    <div className={`${styles.avatar} ${isGlobal ? styles.avatarGlobal : ''}`}>
                      {isGlobal ? '🌐' : getInitials(label)}
                    </div>
                    <div className={styles.chatRowBody}>
                      <div className={styles.chatRowTop}>
                        <span className={styles.chatRowName}>{label}</span>
                        {chat.lastMessageAt && <span className={styles.chatRowTime}>{formatTime(chat.lastMessageAt)}</span>}
                      </div>
                      <div className={styles.chatRowPreview}>{chat.lastMessage || 'Sin mensajes aún'}</div>
                    </div>
                    {unread && <span className={styles.unreadDot} />}
                  </button>
                  {!isGlobal && (
                    <button
                      type="button"
                      className={styles.chatRowDelete}
                      title="Eliminar conversación (solo de tu lado)"
                      onClick={() => handleAskDelete(chat, label)}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {showConversation && (
        <div className={styles.conversation}>
          {!activeChat ? (
            <EmptyState message="Selecciona una conversación para empezar a chatear." shape="mancha" color="var(--color-tiffany-blue)" />
          ) : (
            <>
              <div className={styles.conversationHeader}>
                {isMobile && (
                  <button
                    type="button"
                    className={styles.backButton}
                    onClick={() => openChat(null)}
                    aria-label="Volver a la lista de conversaciones"
                  >
                    ←
                  </button>
                )}
                {activeChat.id === 'global' ? '🌐 Chat Global' : (getOtherParticipant(activeChat, user.id)?.name || 'Usuario')}
              </div>
              <div className={styles.messagesArea}>
                {messages.length === 0 && (
                  <p className={styles.emptyMessages}>Aún no hay mensajes. ¡Escribe el primero!</p>
                )}
                {messages.map((m) => {
                  const mine = m.senderId === user.id;
                  const mentionsMe = user.name && m.text.includes(`@${user.name}`);
                  return (
                    <div key={m.id} className={`${styles.bubbleRow} ${mine ? styles.bubbleRowMine : ''}`}>
                      <div className={`${styles.bubble} ${mine ? styles.bubbleMine : ''} ${mentionsMe && !mine ? styles.bubbleMentioned : ''}`}>
                        {!mine && activeChat.id === 'global' && (
                          <div className={styles.bubbleSender}>{m.senderName}</div>
                        )}
                        <div>{renderMessageParts(m.text, userNames, styles)}</div>
                        <div className={styles.bubbleTime}>{formatTime(m.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={handleSend} className={styles.inputRow}>
                {mentionMatches.length > 0 && (
                  <div className={styles.mentionDropdown}>
                    {mentionMatches.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className={styles.mentionOption}
                        onClick={() => handlePickMention(u.name)}
                      >
                        <span className={styles.mentionOptionAvatar}>{getInitials(u.name)}</span>
                        {u.name}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  ref={textInputRef}
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={activeChatId === 'global' ? "Escribe un mensaje... (usa @ para mencionar a alguien)" : "Escribe un mensaje..."}
                  className={styles.textInput}
                />
                <Button type="submit" variant="primary" size="md" disabled={!text.trim()}>Enviar</Button>
              </form>
            </>
          )}
        </div>
        )}
      </div>

      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="➕ Nueva Conversación" size="sm">
        <div className={styles.pickerList}>
          {otherUsers.length === 0 && <p>No hay otros usuarios registrados todavía.</p>}
          {otherUsers.map((u) => (
            <button key={u.id} type="button" className={styles.pickerRow} onClick={() => handleStartChat(u)}>
              <div className={styles.avatar}>{getInitials(u.name)}</div>
              <div>
                <div className={styles.pickerName}>{u.name}</div>
                <div className={styles.pickerRole}>{u.role}</div>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      <Modal isOpen={deleteConfirm.isOpen} onClose={handleCloseDeleteConfirm} title="🗑️ Eliminar Conversación" size="sm">
        <div style={{ padding: 'var(--space-2) 0' }}>
          <p style={{ marginBottom: 'var(--space-4)' }}>
            ¿Eliminar la conversación con <strong>{deleteConfirm.label}</strong>?
          </p>
          <p style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginBottom: 'var(--space-5)' }}>
            Solo se eliminará de tu lado — {deleteConfirm.label} seguirá viendo la conversación con normalidad. Si te vuelve a escribir, reaparecerá en tu lista.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" size="md" onClick={handleCloseDeleteConfirm}>Cancelar</Button>
            <Button type="button" variant="danger" size="md" onClick={handleConfirmDelete}>Eliminar</Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
};

export default ChatPage;
