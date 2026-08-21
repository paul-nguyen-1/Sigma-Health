import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from './supabase';
import type { Message } from '../types/models';

type MessagesState = {
  isLoading: boolean;
  error: string | null;
  // Newest-first, for direct use as an inverted FlatList's data.
  messages: Message[];
  senderNames: Record<string, string>;
  retry: () => void;
  send: (body: string) => Promise<string | null>;
};

// The first Realtime subscription in this codebase -- mirrors the
// useFocusEffect + `let cancelled` cleanup shape already used everywhere
// else (e.g. HomeScreen), just with supabase.removeChannel() as the
// cleanup action instead of only setting a flag. See
// .claude.roadmap.phase3.md §4.
export function useConversationMessages(conversationId: string): MessagesState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      function resolveSenderName(userId: string) {
        setSenderNames((prev) => {
          if (prev[userId]) return prev;
          supabase
            .from('profiles_public')
            .select('id, display_name')
            .eq('id', userId)
            .single()
            .then(({ data }) => {
              if (cancelled || !data) return;
              setSenderNames((p) => ({ ...p, [data.id]: data.display_name }));
            });
          return prev;
        });
      }

      async function loadInitial() {
        setIsLoading(true);
        setError(null);
        // Most recent 50 only -- no pagination yet, a known cut (see
        // .claude.roadmap.phase3.md §8), not something any pilot-scale
        // conversation will hit early on.
        const { data, error: fetchError } = await supabase
          .from('messages')
          .select('id, conversation_id, sender_id, body, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (cancelled) return;
        if (fetchError) {
          setError(fetchError.message);
          setIsLoading(false);
          return;
        }

        const rows: Message[] = (data ?? []).map((row) => ({
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          body: row.body,
          createdAt: row.created_at,
        }));
        setMessages(rows);
        setIsLoading(false);

        const senderIds = [...new Set(rows.map((m) => m.senderId))];
        if (senderIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles_public')
            .select('id, display_name')
            .in('id', senderIds);
          if (cancelled) return;
          const names: Record<string, string> = {};
          for (const p of profiles ?? []) names[p.id] = p.display_name;
          setSenderNames((prev) => ({ ...prev, ...names }));
        }
      }
      loadInitial();

      const channel = supabase
        .channel(`messages:${conversationId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            if (cancelled) return;
            const row = payload.new as {
              id: string;
              conversation_id: string;
              sender_id: string;
              body: string;
              created_at: string;
            };
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              return [
                {
                  id: row.id,
                  conversationId: row.conversation_id,
                  senderId: row.sender_id,
                  body: row.body,
                  createdAt: row.created_at,
                },
                ...prev,
              ];
            });
            resolveSenderName(row.sender_id);
          },
        )
        .subscribe();

      return () => {
        cancelled = true;
        supabase.removeChannel(channel);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId, retryCount]),
  );

  async function send(body: string): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 'Not signed in';
    const { error: insertError } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: user.id, body });
    return insertError ? insertError.message : null;
  }

  return {
    isLoading,
    error,
    messages,
    senderNames,
    retry: () => setRetryCount((c) => c + 1),
    send,
  };
}
