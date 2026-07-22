/**
 * @file useChat.js
 * @description Hook de conveniencia para consumir el contexto del chat interno
 * @author Dicrejart Dev Team
 * @requires react
 */

import { useContext } from 'react';
import { ChatContext } from '../context/ChatContext';

/**
 * Hook para acceder al chat interno (global + privados 1 a 1)
 * @returns {{
 *   chats: Array<Object>,
 *   activeChatId: string|null,
 *   messages: Array<Object>,
 *   openChat: function,
 *   startPrivateChat: function,
 *   sendMessage: function,
 *   markChatRead: function,
 *   isUnread: function,
 *   totalUnreadCount: number,
 *   getPrivateChatId: function
 * }}
 */
const useChat = () => {
  const context = useContext(ChatContext);

  if (!context) {
    throw new Error('useChat debe usarse dentro de un ChatProvider');
  }

  return context;
};

export default useChat;
