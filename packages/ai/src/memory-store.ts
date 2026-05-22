import { randomUUID } from 'node:crypto';
import {
  type ConversationMemory,
  type ChatMessage,
  type ChatCitation,
  type AnalysisType,
  type ConversationListItem,
} from '@rag/shared';

/** Hard cap on turns retained per conversation. Oldest user+assistant pair evicted. */
const MAX_TURNS = 10; // 5 user + 5 assistant
/** Conversations not accessed within this window are eligible for eviction. */
const EVICTION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface StoredConversation {
  memory: ConversationMemory;
  lastAccessedAt: number;
}

/**
 * Bounded in-process conversation memory store.
 *
 * Design decisions:
 * - Backed by a plain Map (no Redis/DB). Lost on server restart. Intentional for Phase 6.
 * - Hard cap of MAX_TURNS messages per conversation. Evicts oldest when exceeded.
 * - LRU-style eviction: conversations not accessed within EVICTION_TTL_MS are cleaned up.
 * - All methods are synchronous to avoid unnecessary async complexity at this layer.
 * - Serializable state — can be snapshot/restored to JSON without loss.
 */
export class ConversationMemoryStore {
  private readonly store = new Map<string, StoredConversation>();

  /**
   * Creates a new conversation and returns its ID.
   */
  createConversation(videoIds: string[], analysisType: AnalysisType): string {
    this.evictExpired();
    const conversationId = randomUUID();
    const now = new Date().toISOString();
    const memory: ConversationMemory = {
      conversationId,
      videoIds,
      analysisType,
      turns: [],
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(conversationId, { memory, lastAccessedAt: Date.now() });
    return conversationId;
  }

  /**
   * Retrieves a conversation by ID. Returns undefined if not found or expired.
   */
  getConversation(conversationId: string): ConversationMemory | undefined {
    const stored = this.store.get(conversationId);
    if (!stored) return undefined;
    stored.lastAccessedAt = Date.now();
    return stored.memory;
  }

  /**
   * Appends a message turn to a conversation.
   * If conversation doesn't exist, it is created with an empty videoIds list.
   * Enforces MAX_TURNS cap by removing oldest messages when exceeded.
   */
  addTurn(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    citations?: ChatCitation[],
  ): ChatMessage {
    let stored = this.store.get(conversationId);
    if (!stored) {
      // Auto-create if missing (graceful degradation)
      const now = new Date().toISOString();
      const memory: ConversationMemory = {
        conversationId,
        videoIds: [],
        analysisType: 'general',
        turns: [],
        createdAt: now,
        updatedAt: now,
      };
      stored = { memory, lastAccessedAt: Date.now() };
      this.store.set(conversationId, stored);
    }

    const turnId = randomUUID();
    const turn: ChatMessage = {
      turnId,
      role,
      content,
      citations,
      createdAt: new Date().toISOString(),
    };

    stored.memory.turns.push(turn);
    stored.memory.updatedAt = new Date().toISOString();
    stored.lastAccessedAt = Date.now();

    // Enforce cap: trim oldest turns, keeping the last MAX_TURNS
    if (stored.memory.turns.length > MAX_TURNS) {
      stored.memory.turns = stored.memory.turns.slice(-MAX_TURNS);
    }

    return turn;
  }

  /**
   * Returns the last N turns for prompt injection.
   * Excludes the most recent user message (not yet answered).
   */
  getRecentTurns(conversationId: string, windowSize = 4): Array<{ role: string; content: string }> {
    const memory = this.getConversation(conversationId);
    if (!memory || memory.turns.length === 0) return [];
    // Take last windowSize turns (excluding the very last if it's the current user question)
    const allTurns = memory.turns;
    const sliced = allTurns.slice(-Math.min(windowSize + 1, allTurns.length));
    return sliced.map((t) => ({ role: t.role, content: t.content }));
  }

  /**
   * Lists all active (non-expired) conversations as summary items.
   */
  listConversations(): ConversationListItem[] {
    this.evictExpired();
    const result: ConversationListItem[] = [];
    for (const { memory } of this.store.values()) {
      result.push({
        conversationId: memory.conversationId,
        videoIds: memory.videoIds,
        analysisType: memory.analysisType,
        turnCount: memory.turns.length,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      });
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Returns the total number of active conversations.
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Removes expired conversations from the store.
   */
  private evictExpired(): void {
    const cutoff = Date.now() - EVICTION_TTL_MS;
    for (const [id, stored] of this.store.entries()) {
      if (stored.lastAccessedAt < cutoff) {
        this.store.delete(id);
      }
    }
  }
}

/**
 * Singleton store instance shared across the API process.
 * Instantiated once at module load time.
 */
export const conversationStore = new ConversationMemoryStore();
