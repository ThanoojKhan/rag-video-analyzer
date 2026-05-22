import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, AnalysisType, StreamingEvent, ChatRequest } from '@rag/shared';
import { getApiBaseUrl } from './config';

export interface UseChatOptions {
  conversationId?: string;
  videoIds: string[];
  analysisType: AnalysisType;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
}

export function useChat({
  conversationId: initialConversationId,
  videoIds,
  analysisType,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track active conversation ID
  const conversationIdRef = useRef<string | undefined>(initialConversationId);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      setError(null);
      setIsLoading(true);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const userMessage: ChatMessage = {
        turnId: crypto.randomUUID(),
        role: 'user',
        content: content.trim(),
        createdAt: new Date().toISOString(),
      };

      const tempAssistantId = crypto.randomUUID();
      const tempAssistantMessage: ChatMessage = {
        turnId: tempAssistantId,
        role: 'assistant',
        content: '',
        citations: [],
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage, tempAssistantMessage]);

      const requestPayload: ChatRequest = {
        message: content.trim(),
        videoIds,
        analysisType,
        conversationId: conversationIdRef.current,
        stream: true,
        limit: 8,
      };

      try {
        const response = await fetch(`${getApiBaseUrl()}/api/v1/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          let errMessage = `HTTP ${response.status} ${response.statusText}`;
          try {
            const body = await response.json();
            if (body.error) errMessage = body.error;
          } catch {
            // ignore parsing error for non-JSON bodies
          }
          throw new Error(errMessage);
        }

        const body = response.body;
        if (!body) throw new Error('No response body');

        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let streamDone = false;
        while (!streamDone) {
          const { value, done } = await reader.read();
          if (done) {
            streamDone = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // keep the last partial line in buffer

          for (const line of lines) {
            if (line.trim() === '') continue;
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              if (dataStr === '[DONE]') continue; // Legacy SSE closure, although our API sends a 'done' event

              try {
                const event = JSON.parse(dataStr) as StreamingEvent;

                if (event.type === 'token') {
                  setMessages((prev) => {
                    const newMsgs = [...prev];
                    if (newMsgs.length > 0) {
                      const last = newMsgs[newMsgs.length - 1];
                      if (last && last.turnId === tempAssistantId) {
                        newMsgs[newMsgs.length - 1] = {
                          ...last,
                          content: last.content + event.content,
                        };
                      }
                    }
                    return newMsgs;
                  });
                } else if (event.type === 'citation') {
                  setMessages((prev) => {
                    const newMsgs = [...prev];
                    if (newMsgs.length > 0) {
                      const last = newMsgs[newMsgs.length - 1];
                      if (last && last.turnId === tempAssistantId) {
                        const newCitations = [...(last.citations || [])];
                        if (!newCitations.some((c) => c.refIndex === event.citation.refIndex)) {
                          newCitations.push(event.citation);
                        }
                        newMsgs[newMsgs.length - 1] = { ...last, citations: newCitations };
                      }
                    }
                    return newMsgs;
                  });
                } else if (event.type === 'error') {
                  setError(event.message);
                  setIsLoading(false);
                  return; // abort further processing
                } else if (event.type === 'done') {
                  conversationIdRef.current = event.conversationId;
                  // Update final state if needed
                  setMessages((prev) => {
                    const newMsgs = [...prev];
                    if (newMsgs.length > 0) {
                      const last = newMsgs[newMsgs.length - 1];
                      if (last && last.turnId === tempAssistantId) {
                        newMsgs[newMsgs.length - 1] = { ...last, turnId: event.turnId };
                      }
                    }
                    return newMsgs;
                  });
                }
              } catch (e) {
                console.error('Failed to parse SSE line', line, e);
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, videoIds, analysisType],
  );

  return { messages, isLoading, error, sendMessage };
}
