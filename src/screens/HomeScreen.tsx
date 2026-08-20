import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { SegmentedControl } from '../components/SegmentedControl';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { mergeActivity } from '../lib/activity';
import type { PersonalRecord, Run } from '../types/models';

const CHECK_IN_DURATION_MS = 3 * 60 * 60 * 1000;
const RECENT_LIMIT = 3;

type HomeLocation = { type: 'gym' | 'park'; id: string } | null;
type Filter = 'all' | 'lift' | 'run';

export function HomeScreen() {
  const [homeLocation, setHomeLocation] = useState<HomeLocation>(null);
  const [checkInExpiresAt, setCheckInExpiresAt] = useState<string | null>(null);
  const [prHistory, setPrHistory] = useState<PersonalRecord[]>([]);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(async ({ data: { user } }) => {
        setIsLoading(true);
        setLoadError(null);
        if (!user) return;

        const [profileRes, checkInRes, prsRes, runsRes] = await Promise.all([
          supabase.from('profiles').select('home_gym_id, home_park_id').eq('id', user.id).maybeSingle(),
          supabase
            .from('check_ins')
            .select('expires_at')
            .eq('user_id', user.id)
            .gt('expires_at', new Date().toISOString())
            .order('checked_in_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('personal_records')
            .select('id, user_id, gym_id, lift_name, weight, reps, calculated_1rm, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(RECENT_LIMIT),
          supabase
            .from('runs')
            .select('id, user_id, park_id, distance_km, duration_seconds, pace_seconds_per_km, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(RECENT_LIMIT),
        ]);

        const firstError = profileRes.error ?? checkInRes.error ?? prsRes.error ?? runsRes.error;
        if (firstError) {
          setLoadError(firstError.message);
          setIsLoading(false);
          return;
        }

        if (profileRes.data?.home_gym_id) {
          setHomeLocation({ type: 'gym', id: profileRes.data.home_gym_id });
        } else if (profileRes.data?.home_park_id) {
          setHomeLocation({ type: 'park', id: profileRes.data.home_park_id });
        }

        setCheckInExpiresAt(checkInRes.data?.expires_at ?? null);

        setPrHistory(
          (prsRes.data ?? []).map((row) => ({
            id: row.id,
            userId: row.user_id,
            gymId: row.gym_id,
            liftName: row.lift_name,
            weight: row.weight,
            reps: row.reps,
            calculated1rm: row.calculated_1rm,
            createdAt: row.created_at,
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
        setLoadError(err instanceof Error ? err.message : 'Failed to load your home screen');
        setIsLoading(false);
      });
  }, [retryCount]);

  async function handleCheckIn() {
    if (!homeLocation) return;
    setError(null);
    setIsCheckingIn(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsCheckingIn(false);
      return;
    }
    const expiresAt = new Date(Date.now() + CHECK_IN_DURATION_MS).toISOString();
    const { error: insertError } = await supabase.from('check_ins').insert({
      user_id: user.id,
      location_type: homeLocation.type,
      location_id: homeLocation.id,
      expires_at: expiresAt,
    });
    setIsCheckingIn(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setCheckInExpiresAt(expiresAt);
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setRetryCount((c) => c + 1)} />;
  }

  if (isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  const isCheckedIn = !!checkInExpiresAt;
  const merged = mergeActivity(prHistory, runHistory);
  const visibleActivity = filter === 'all' ? merged.slice(0, RECENT_LIMIT) : merged.filter((item) => item.kind === filter);

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Home</Text>
        <View style={styles.spacer} />
        <Card>
          {isCheckedIn ? (
            <Text style={styles.checkInStatus}>
              Checked in until{' '}
              {new Date(checkInExpiresAt as string).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          ) : (
            <>
              <Text style={styles.checkInStatus}>Not checked in</Text>
              <View style={styles.spacerSmall} />
              <Button
                label={isCheckingIn ? 'Checking in…' : "I'm here now"}
                onPress={handleCheckIn}
                disabled={isCheckingIn || !homeLocation}
              />
            </>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Card>
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
  checkInStatus: {
    fontSize: theme.typography.size.base,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
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
  emptyBody: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginTop: theme.spacing.sm,
  },
});
