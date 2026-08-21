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
import type { ProfileStackParamList } from '../../navigation/ProfileStack';

type Props = NativeStackScreenProps<ProfileStackParamList, 'FollowList'>;
type Row = { id: string; displayName: string };

// One screen for both followers and following, of self or another user --
// same list shape either way, only which column of `follows` is queried
// differs. follows is public-read (migration 0023), so this works for
// anyone's list, not just your own.
export function FollowListScreen({ route, navigation }: Props) {
  const { userId, mode, title } = route.params;
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

        // Explicit branches, not a dynamic column name, so the query
        // result stays a plain typed shape instead of a union TS can't
        // index into.
        const { data: follows, error: followsError } =
          mode === 'followers'
            ? await supabase.from('follows').select('follower_id').eq('followed_id', userId)
            : await supabase.from('follows').select('followed_id').eq('follower_id', userId);
        if (cancelled) return;
        if (followsError) {
          setLoadError(followsError.message);
          setIsLoading(false);
          return;
        }

        const otherIds = (follows ?? []).map((f) => ('follower_id' in f ? f.follower_id : f.followed_id));
        if (otherIds.length === 0) {
          setRows([]);
          setIsLoading(false);
          return;
        }

        const { data: profiles, error: profilesError } = await supabase
          .from('profiles_public')
          .select('id, display_name')
          .in('id', otherIds);
        if (cancelled) return;
        if (profilesError) {
          setLoadError(profilesError.message);
          setIsLoading(false);
          return;
        }

        setRows((profiles ?? []).map((p) => ({ id: p.id, displayName: p.display_name })));
        setIsLoading(false);
      }
      load();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, mode, retryCount]),
  );

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setRetryCount((c) => c + 1)} />;
  }

  return (
    <ScreenContainer>
      <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
      <View style={styles.spacer} />
      <Text style={styles.title}>{title}</Text>
      <View style={styles.spacer} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {isLoading ? null : rows.length === 0 ? (
          <Text style={styles.emptyBody}>Nobody here yet.</Text>
        ) : (
          rows.map((row) => (
            <Pressable key={row.id} onPress={() => navigation.push('OtherProfile', { userId: row.id })}>
              <Card style={styles.rowCard}>
                <Text style={styles.rowTitle}>{row.displayName}</Text>
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
});
