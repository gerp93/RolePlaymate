export type MessageRole = 'user' | 'assistant' | 'system';

/** One turn in a conversation. Messages are a flat, ordered list -- `seq` is the ordering
 * key rather than `createdAt`, which is only second-granular and can tie on fast turns. */
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** Monotonic within a conversation, allocated inside the insert transaction. */
  seq: number;
  createdAt: string;
}

export interface CreateMessageInput {
  conversationId: string;
  role: MessageRole;
  content: string;
}
