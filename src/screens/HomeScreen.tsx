import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { SegmentedControl } from '../components/SegmentedControl';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { mergeActivity } from '../lib/activity';
import type { Run, Workout } from '../types/models';

const RECENT_LIMIT = 3;

type Filter = 'all' | 'lift' | 'run';

// Check-in itself only happens from the Log tab (starting a workout or
// logging a run) so it can be GPS-verified against the exact location
// you're about to log against -- Home has no check-in UI or status at all.
export function HomeScreen() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      supabase.auth
        .getUser()
        .then(async ({ data: { user } }) => {
          if (cancelled) return;
          setLoadError(null);
          if (!user) {
            setIsLoading(false);
            return;
          }

          const [workoutsRes, runsRes] = await Promise.all([
            supabase
              .from('workouts')
              .select('id, user_id, gym_id, title, exercises, started_at, updated_at')
              .eq('user_id', user.id)
              .order('started_at', { ascending: false })
              .limit(RECENT_LIMIT),
            supabase
              .from('runs')
              .select('id, user_id, park_id, distance_km, duration_seconds, pace_seconds_per_km, created_at')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(RECENT_LIMIT),
          ]);
          if (cancelled) return;

          const firstError = workoutsRes.error ?? runsRes.error;
          if (firstError) {
            setLoadError(firstError.message);
            setIsLoading(false);
            return;
          }

          setWorkouts(
            (workoutsRes.data ?? []).map((row) => ({
              id: row.id,
              userId: row.user_id,
              gymId: row.gym_id,
              title: row.title,
              exercises: row.exercises ?? [],
              startedAt: row.started_at,
              updatedAt: row.updated_at,
            })),
          );
          setRunHistory(
            (runsRes.data ?? []).map((row) => ({
              id: row.id,
              userId: row.user_id,
              parkId: row.park_id,
              distanceKm: row.distance_km,
              durationSeconds: row.duration_seconds,
              paceSecondsPerKm: row.pace_seconds_per_km,
              createdAt: row.created_at,
            })),
          );
          setIsLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setLoadError(err instanceof Error ? err.message : 'Failed to load your home screen');
          setIsLoading(false);
        });

      return () => {
        cancelled = true;
      };
      // retryCount isn't read in the body -- it's a dependency purely to
      // force this callback to re-run when the ErrorState Retry button
      // bumps it, which is exactly what the dependency array is for.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [retryCount]),
  );

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setRetryCount((c) => c + 1)} />;
  }

  if (isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  const merged = mergeActivity(workouts, runHistory);
  const visibleActivity = filter === 'all' ? merged.slice(0, RECENT_LIMIT) : merged.filter((item) => item.kind === filter);

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Home</Text>
        <View style={styles.spacer} />
        <Text style={styles.sectionTitle}>Recent activity</Text>
        <View style={styles.spacerSmall} />
        <SegmentedControl
          options={[
            { value: 'all', label: 'All' },
            { value: 'lift', label: 'Lift' },
            { value: 'run', label: 'Run' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <View style={styles.spacerSmall} />
        {visibleActivity.length === 0 ? (
          <Text style={styles.emptyBody}>Nothing logged yet.</Text>
        ) : (
          visibleActivity.map((item) => (
            <Card key={item.id} style={styles.activityCard}>
              <Text style={styles.activityLabel}>{item.label}</Text>
              <Text style={styles.activityDetail}>{item.detail}</Text>
              <Text style={styles.activityTimestamp}>{item.timestamp}</Text>
            </Card>
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
  sectionTitle: {
    fontSize: theme.typography.size.lg,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  spacer: {
    height: theme.spacing.lg,
  },
  spacerSmall: {
    height: theme.spacing.sm,
  },
  activityCard: {
    marginBottom: theme.spacing.sm,
  },
  activityLabel: {
    fontSize: theme.typography.size.base,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  activityDetail: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  activityTimestamp: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  emptyBody: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
  },
});
