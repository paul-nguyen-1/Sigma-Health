import React, { useCallback, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import { useConversationMessages } from '../../lib/useConversationMessages';
import { formatTimestamp } from '../../lib/format';
import type { CommunityStackParamList } from '../../navigation/CommunityStack';

type Props = NativeStackScreenProps<CommunityStackParamList, 'Chat'>;
type HeaderInfo = { title: string; inviteCode: string | null; hereCount: number | null };

// First FlatList in this codebase (every other list so far is a .map()
// inside a ScrollView, fine at the bounded sizes those screens deal
// with) -- a chat's message list is the first thing that genuinely needs
// virtualization. Uses `inverted` (standard chat pattern) against
// useConversationMessages' newest-first array. See
// .claude.roadmap.phase3.md §4.
export function ChatScreen({ route, navigation }: Props) {
  const { conversationId } = route.params;
  const [header, setHeader] = useState<HeaderInfo | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const { isLoading, error, messages, senderNames, retry, send } = useConversationMessages(conversationId);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function loadHeader() {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        setCurrentUserId(user.id);

        const { data: conversation, error: convError } = await supabase
          .from('conversations')
          .select('type, name, invite_code, location_type, location_id')
          .eq('id', conversationId)
          .single();
        if (cancelled) return;
        if (convError || !conversation) {
          setHeaderError(convError?.message ?? 'Conversation not found');
          return;
        }

        if (conversation.type === 'group') {
          setHeader({ title: conversation.name ?? 'Group', inviteCode: conversation.invite_code, hereCount: null });
          return;
        }

        if (conversation.type === 'location' && conversation.location_type && conversation.location_id) {
          const table = conversation.location_type === 'gym' ? 'gyms' : 'parks';
          const [{ data: location }, { count }] = await Promise.all([
            supabase.from(table).select('name').eq('id', conversation.location_id).maybeSingle(),
            supabase
              .from('check_ins')
              .select('id', { count: 'exact', head: true })
              .eq('location_type', conversation.location_type)
              .eq('location_id', conversation.location_id)
              .gt('expires_at', new Date().toISOString()),
          ]);
          if (cancelled) return;
          setHeader({ title: location?.name ?? 'Location', inviteCode: null, hereCount: count ?? 0 });
          return;
        }

        const { data: other } = await supabase
          .from('conversation_members')
          .select('user_id')
          .eq('conversation_id', conversationId)
          .neq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;

        if (other) {
          const { data: profile } = await supabase
            .from('profiles_public')
            .select('display_name')
            .eq('id', other.user_id)
            .single();
          if (cancelled) return;
          setHeader({ title: profile?.display_name ?? 'Direct message', inviteCode: null, hereCount: null });
        } else {
          setHeader({ title: 'Direct message', inviteCode: null, hereCount: null });
        }
      }
      loadHeader();
      return () => {
        cancelled = true;
      };
    }, [conversationId]),
  );

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setIsSending(true);
    setSendError(null);
    const err = await send(body);
    setIsSending(false);
    if (err) {
      setSendError(err);
      return;
    }
    setDraft('');
  }

  if (error) {
    return <ErrorState message={error} onRetry={retry} />;
  }
  if (headerError) {
    return <ErrorState message={headerError} onRetry={() => navigation.goBack()} />;
  }

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.headerRow}>
        <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
      <Text style={styles.title}>{header?.title ?? '…'}</Text>
      {header?.inviteCode ? <Text style={styles.inviteCode}>Invite code: {header.inviteCode}</Text> : null}
      {header?.hereCount !== null && header?.hereCount !== undefined ? (
        <Text style={styles.inviteCode}>
          {header.hereCount} {header.hereCount === 1 ? 'person' : 'people'} here now
        </Text>
      ) : null}
      <View style={styles.spacer} />

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages}
        inverted
        keyExtractor={(item) => item.id}
        ListEmptyComponent={!isLoading ? <Text style={styles.emptyBody}>No messages yet — say hi.</Text> : null}
        renderItem={({ item }) => {
          const isOwn = item.senderId === currentUserId;
          return (
            <View style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>
              <Card style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther] as object}>
                {!isOwn ? <Text style={styles.messageSender}>{senderNames[item.senderId] ?? '…'}</Text> : null}
                <Text style={[styles.messageBody, isOwn && styles.messageBodyOwn]}>{item.body}</Text>
                <Text style={[styles.messageTime, isOwn && styles.messageTimeOwn]}>{formatTimestamp(item.createdAt)}</Text>
              </Card>
            </View>
          );
        }}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.composerRow}>
          <View style={styles.composerInput}>
            <TextField label="" value={draft} onChangeText={setDraft} placeholder="Message…" />
          </View>
          <Button label={isSending ? '…' : 'Send'} onPress={handleSend} disabled={isSending || !draft.trim()} />
        </View>
        {sendError ? <Text style={styles.error}>{sendError}</Text> : null}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 0,
  },
  headerRow: {
    alignItems: 'flex-start',
  },
  title: {
    fontSize: theme.typography.size.xl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
  },
  inviteCode: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  spacer: {
    height: theme.spacing.sm,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingVertical: theme.spacing.sm,
  },
  emptyBody: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
  messageRow: {
    marginVertical: theme.spacing.xs / 2,
    flexDirection: 'row',
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '78%',
    paddingVertical: theme.spacing.sm,
  },
  bubbleOwn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  bubbleOther: {
    backgroundColor: theme.colors.surface,
  },
  messageSender: {
    fontSize: theme.typography.size.xs,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs / 2,
  },
  messageBody: {
    fontSize: theme.typography.size.base,
    color: theme.colors.text,
  },
  messageBodyOwn: {
    color: theme.colors.primaryText,
  },
  messageTime: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs / 2,
  },
  messageTimeOwn: {
    color: theme.colors.primaryText,
    opacity: 0.8,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  composerInput: {
    flex: 1,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
  },
});
