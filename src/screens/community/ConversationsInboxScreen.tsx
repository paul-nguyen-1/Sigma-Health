import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import type { CommunityStackParamList } from '../../navigation/CommunityStack';

type Props = NativeStackScreenProps<CommunityStackParamList, 'ConversationsInbox'>;
type Row = { conversationId: string; type: 'direct' | 'group'; title: string };

// Location conversations are deliberately absent here -- they have zero
// conversation_members rows by design (membership is computed from
// check_ins, not stored), so this query naturally lists direct/group
// only. Sorted by conversation creation, not last-message time, for this
// first pass -- a reasonable simplification with 0 real users so far;
// revisit once real usage makes "most recent activity" ordering matter.
export function ConversationsInboxScreen({ navigation }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setIsLoading(true);
        setLoadError(null);

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        const { data: memberships, error: membershipsError } = await supabase
          .from('conversation_members')
          .select('conversation_id, conversations(id, type, name, created_at)');
        if (cancelled) return;
        if (membershipsError) {
          setLoadError(membershipsError.message);
          setIsLoading(false);
          return;
        }

        // Sorted client-side by conversation creation -- PostgREST's
        // foreign-table .order() reorders each row's embedded object, not
        // the outer list, so it can't produce "most recent first" here.
        type ConversationEmbed = { id: string; type: 'direct' | 'group' | 'location'; name: string | null; created_at: string };
        const conversations = (memberships ?? [])
          .map((m) => m.conversations as unknown as ConversationEmbed | null)
          .filter((c): c is ConversationEmbed => !!c && c.type !== 'location')
          .sort((a, b) => b.created_at.localeCompare(a.created_at));

        const directIds = conversations.filter((c) => c.type === 'direct').map((c) => c.id);
        const otherNameByConversationId = new Map<string, string>();

        if (directIds.length > 0) {
          const { data: otherMembers } = await supabase
            .from('conversation_members')
            .select('conversation_id, user_id')
            .in('conversation_id', directIds)
            .neq('user_id', user.id);
          if (cancelled) return;

          const otherUserIds = [...new Set((otherMembers ?? []).map((m) => m.user_id))];
          if (otherUserIds.length > 0) {
            const { data: profiles } = await supabase
              .from('profiles_public')
              .select('id, display_name')
              .in('id', otherUserIds);
            if (cancelled) return;
            const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
            for (const m of otherMembers ?? []) {
              const name = nameById.get(m.user_id);
              if (name) otherNameByConversationId.set(m.conversation_id, name);
            }
          }
        }

        setRows(
          conversations.map((c) => ({
            conversationId: c.id,
            type: c.type as 'direct' | 'group',
            title: c.type === 'group' ? c.name ?? 'Group' : otherNameByConversationId.get(c.id) ?? 'Direct message',
          })),
        );
        setIsLoading(false);
      }
      load();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [retryCount]),
  );

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setRetryCount((c) => c + 1)} />;
  }
  if (isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Community</Text>
        <View style={styles.spacer} />

        <View style={styles.actionsRow}>
          <View style={styles.actionButton}>
            <Button label="Create group" onPress={() => navigation.navigate('CreateGroup')} />
          </View>
          <View style={styles.actionButton}>
            <Button label="Join group" variant="secondary" onPress={() => navigation.navigate('JoinGroup')} />
          </View>
        </View>
        <View style={styles.spacer} />

        {rows.length === 0 ? (
          <Text style={styles.emptyBody}>No conversations yet.</Text>
        ) : (
          rows.map((row) => (
            <Pressable key={row.conversationId} onPress={() => navigation.navigate('Chat', { conversationId: row.conversationId })}>
              <Card style={styles.rowCard}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowMeta}>{row.type === 'group' ? 'Group' : 'Direct message'}</Text>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: theme.typography.size.xxl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
  },
  spacer: {
    height: theme.spacing.lg,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  emptyBody: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
  },
  rowCard: {
    marginBottom: theme.spacing.sm,
  },
  rowTitle: {
    fontSize: theme.typography.size.base,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  rowMeta: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
});
