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
import { useUserSports } from '../../lib/useUserSports';
import type { CommunityStackParamList } from '../../navigation/CommunityStack';

type Props = NativeStackScreenProps<CommunityStackParamList, 'ConversationsInbox'>;
type Row = { conversationId: string; type: 'direct' | 'group'; title: string };
type HomeLocation = { locationType: 'gym' | 'park'; locationId: string; name: string; hereCount: number };
type PendingMatch = { matchGroupId: string; parkName: string; paceBucket: string };

// Location conversations are deliberately absent here -- they have zero
// conversation_members rows by design (membership is computed from
// check_ins, not stored), so this query naturally lists direct/group
// only. Sorted by conversation creation, not last-message time, for this
// first pass -- a reasonable simplification with 0 real users so far;
// revisit once real usage makes "most recent activity" ordering matter.
export function ConversationsInboxScreen({ navigation }: Props) {
  const { hasRunning } = useUserSports();
  const [rows, setRows] = useState<Row[]>([]);
  const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(null);
  const [pendingMatches, setPendingMatches] = useState<PendingMatch[]>([]);
  const [isOpeningLocation, setIsOpeningLocation] = useState(false);
  const [respondingMatchId, setRespondingMatchId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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

        // Location-based "matching" is a query, not a table (see
        // .claude.roadmap.phase3.md §0 Case 3) -- who's here now at your
        // home gym/park, reusing the same widened check_ins policy the
        // location channel itself relies on.
        const { data: profile } = await supabase.from('profiles').select('home_gym_id, home_park_id').eq('id', user.id).maybeSingle();
        if (cancelled) return;
        if (profile?.home_gym_id || profile?.home_park_id) {
          const locationType: 'gym' | 'park' = profile.home_gym_id ? 'gym' : 'park';
          const locationId = (profile.home_gym_id ?? profile.home_park_id) as string;
          const table = locationType === 'gym' ? 'gyms' : 'parks';
          const [{ data: location }, { count }] = await Promise.all([
            supabase.from(table).select('name').eq('id', locationId).maybeSingle(),
            supabase
              .from('check_ins')
              .select('id', { count: 'exact', head: true })
              .eq('location_type', locationType)
              .eq('location_id', locationId)
              .gt('expires_at', new Date().toISOString()),
          ]);
          if (cancelled) return;
          if (location) {
            setHomeLocation({ locationType, locationId, name: location.name, hereCount: count ?? 0 });
          }
        }

        const { data: invited } = await supabase
          .from('match_participants')
          .select('match_group_id, match_groups(pace_bucket, parks(name))')
          .eq('user_id', user.id)
          .eq('status', 'invited');
        if (cancelled) return;
        type MatchGroupEmbed = { pace_bucket: string; parks: { name: string } | null };
        setPendingMatches(
          (invited ?? [])
            .map((row) => ({ matchGroupId: row.match_group_id, group: row.match_groups as unknown as MatchGroupEmbed | null }))
            .filter((row): row is { matchGroupId: string; group: MatchGroupEmbed } => !!row.group)
            .map((row) => ({
              matchGroupId: row.matchGroupId,
              paceBucket: row.group.pace_bucket,
              parkName: row.group.parks?.name ?? 'a park',
            })),
        );

        const { data: memberships, error: membershipsError } = await supabase
          .from('conversation_members')
          .select('conversation_id, conversations(id, type, name, created_at)')
          .eq('user_id', user.id);
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

  async function handleOpenLocation() {
    if (!homeLocation) return;
    setIsOpeningLocation(true);
    setActionError(null);
    const { data: conversationId, error } = await supabase.rpc('get_or_create_location_conversation', {
      p_location_type: homeLocation.locationType,
      p_location_id: homeLocation.locationId,
    });
    setIsOpeningLocation(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    navigation.navigate('Chat', { conversationId: conversationId as string });
  }

  async function handleRespondToMatch(matchGroupId: string, accept: boolean) {
    setRespondingMatchId(matchGroupId);
    setActionError(null);
    const { error } = await supabase
      .from('match_participants')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('match_group_id', matchGroupId);
    setRespondingMatchId(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    setRetryCount((c) => c + 1);
  }

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
        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        <View style={styles.spacer} />

        {homeLocation ? (
          <>
            <Pressable onPress={handleOpenLocation} disabled={isOpeningLocation}>
              <Card style={styles.rowCard}>
                <Text style={styles.rowTitle}>{homeLocation.name}</Text>
                <Text style={styles.rowMeta}>
                  {homeLocation.hereCount} {homeLocation.hereCount === 1 ? 'person' : 'people'} here now
                </Text>
              </Card>
            </Pressable>
            <View style={styles.spacer} />
          </>
        ) : null}

        {pendingMatches.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Pending matches</Text>
            <View style={styles.spacerSmall} />
            {pendingMatches.map((match) => (
              <Card key={match.matchGroupId} style={styles.rowCard}>
                <Text style={styles.rowTitle}>Runners near {match.parkName}</Text>
                <Text style={styles.rowMeta}>Pace: {match.paceBucket}</Text>
                <View style={styles.spacerSmall} />
                <View style={styles.actionsRow}>
                  <View style={styles.actionButton}>
                    <Button
                      label="Accept"
                      onPress={() => handleRespondToMatch(match.matchGroupId, true)}
                      disabled={respondingMatchId === match.matchGroupId}
                    />
                  </View>
                  <View style={styles.actionButton}>
                    <Button
                      label="Decline"
                      variant="secondary"
                      onPress={() => handleRespondToMatch(match.matchGroupId, false)}
                      disabled={respondingMatchId === match.matchGroupId}
                    />
                  </View>
                </View>
              </Card>
            ))}
            <View style={styles.spacer} />
          </>
        ) : null}

        <View style={styles.actionsRow}>
          <View style={styles.actionButton}>
            <Button label="Create group" onPress={() => navigation.navigate('CreateGroup')} />
          </View>
          <View style={styles.actionButton}>
            <Button label="Join group" variant="secondary" onPress={() => navigation.navigate('JoinGroup')} />
          </View>
        </View>
        {hasRunning ? (
          <>
            <View style={styles.spacerSmall} />
            <Button label="Find a running match" variant="secondary" onPress={() => navigation.navigate('ProposeMatch')} />
          </>
        ) : null}
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
  spacerSmall: {
    height: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: theme.typography.size.lg,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
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
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginTop: theme.spacing.sm,
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
