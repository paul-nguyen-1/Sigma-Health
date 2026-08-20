import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ErrorState } from '../components/ErrorState';
import { ShareCard } from '../components/ShareCard';
import { SegmentedControl } from '../components/SegmentedControl';
import { CheckInLocationModal } from '../components/CheckInLocationModal';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { formatPace, formatTimestamp } from '../lib/format';
import { useUserSports } from '../lib/useUserSports';
import { summarizeWorkout } from '../types/models';
import type { Run, Workout } from '../types/models';
import type { LogStackParamList } from '../navigation/LogStack';

type Mode = 'lift' | 'run';
type ShareData = { eyebrow: string; headline: string; detail: string };
type LocationRef = { id: string; name: string };
type Props = NativeStackScreenProps<LogStackParamList, 'LogList'>;

const CHECK_IN_DURATION_MS = 3 * 60 * 60 * 1000;

export function LogScreen({ navigation, route }: Props) {
  const {
    isLoading: sportsLoading,
    error: sportsError,
    hasLifting,
    hasRunning,
    runningSportId,
    retry: retrySports,
  } = useUserSports();
  const runPlanSession = route.params?.runPlanSession ?? null;
  const [modeOverride, setModeOverride] = useState<Mode | null>(runPlanSession ? 'run' : null);
  const mode: Mode | null = sportsLoading ? null : (modeOverride ?? (hasLifting ? 'lift' : 'run'));

  const [distanceKm, setDistanceKm] = useState(runPlanSession ? String(runPlanSession.target.distanceKm) : '');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [location, setLocation] = useState<LocationRef | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRetryCount, setHistoryRetryCount] = useState(0);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const shareCardRef = useRef<View>(null);

  async function fetchWorkouts(userId: string): Promise<Workout[]> {
    const { data, error: fetchError } = await supabase
      .from('workouts')
      .select('id, user_id, gym_id, title, exercises, started_at, updated_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(20);
    if (fetchError) throw new Error(fetchError.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      gymId: row.gym_id,
      title: row.title,
      exercises: row.exercises ?? [],
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    }));
  }

  async function fetchRunHistory(userId: string): Promise<Run[]> {
    const { data, error: fetchError } = await supabase
      .from('runs')
      .select('id, user_id, park_id, distance_km, duration_seconds, pace_seconds_per_km, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (fetchError) throw new Error(fetchError.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      parkId: row.park_id,
      distanceKm: row.distance_km,
      durationSeconds: row.duration_seconds,
      paceSecondsPerKm: row.pace_seconds_per_km,
      createdAt: row.created_at,
    }));
  }

  // Handles arriving here (already mounted, tab navigators keep screens
  // alive) with a new plan-session hand-off from Home -- the useState
  // initializers above only cover the first mount. Deferred to a
  // microtask so these setState calls aren't synchronous within the
  // effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!runPlanSession) return;
    Promise.resolve().then(() => {
      setModeOverride('run');
      setDistanceKm(String(runPlanSession.target.distanceKm));
    });
    // Only userPlanSessionId identifies a genuinely new hand-off --
    // runPlanSession's object identity changes on every route.params
    // read even when it's the same hand-off, which would re-run this
    // every render if included directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runPlanSession?.userPlanSessionId]);

  // useFocusEffect: coming back from WorkoutSessionScreen after
  // starting/editing a session needs this list to refetch, same reason
  // Home/Profile switched off mount-only effects earlier.
  useFocusEffect(
    useCallback(() => {
      if (!mode) return;
      let cancelled = false;
      supabase.auth
        .getUser()
        .then(({ data: { user } }) => {
          setHistoryError(null);
          if (!user) return;
          const fetch =
            mode === 'lift'
              ? fetchWorkouts(user.id).then((w) => {
                  if (!cancelled) setWorkouts(w);
                })
              : fetchRunHistory(user.id).then((r) => {
                  if (!cancelled) setRunHistory(r);
                });
          return fetch;
        })
        .catch((err) => {
          if (cancelled) return;
          setHistoryError(err instanceof Error ? err.message : 'Failed to load your history');
        });
      return () => {
        cancelled = true;
      };
      // historyRetryCount isn't read in the body -- it's a dependency
      // purely to force this to re-run when the ErrorState Retry button
      // bumps it, which is exactly what the dependency array is for.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, historyRetryCount]),
  );

  async function handleLogRun() {
    setError(null);
    if (!location) {
      setError('Pick a park first.');
      return;
    }
    const distanceNum = parseFloat(distanceKm);
    const durationNum = parseFloat(durationMinutes);
    if (!Number.isFinite(distanceNum) || distanceNum <= 0 || !Number.isFinite(durationNum) || durationNum <= 0) {
      setError('Enter a distance and duration.');
      return;
    }
    setIsSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsSubmitting(false);
      return;
    }
    const { data: inserted, error: insertError } = await supabase
      .from('runs')
      .insert({ user_id: user.id, park_id: location.id, distance_km: distanceNum, duration_seconds: Math.round(durationNum * 60) })
      .select('id, user_id, park_id, distance_km, duration_seconds, pace_seconds_per_km, created_at')
      .single();
    if (insertError || !inserted) {
      setIsSubmitting(false);
      setError(insertError?.message ?? 'Could not log that run.');
      return;
    }

    const expiresAt = new Date(Date.now() + CHECK_IN_DURATION_MS).toISOString();
    await supabase
      .from('check_ins')
      .insert({ user_id: user.id, location_type: 'park', location_id: location.id, expires_at: expiresAt });

    if (runPlanSession) {
      await supabase
        .from('user_plan_sessions')
        .update({ completed_at: new Date().toISOString(), run_id: inserted.id })
        .eq('id', runPlanSession.userPlanSessionId);
    }

    setIsSubmitting(false);
    setDistanceKm('');
    setDurationMinutes('');
    setShareData({
      eyebrow: 'Run logged',
      headline: `${inserted.distance_km} km`,
      detail: formatPace(inserted.pace_seconds_per_km),
    });
    setRunHistory((prev) => [
      {
        id: inserted.id,
        userId: inserted.user_id,
        parkId: inserted.park_id,
        distanceKm: inserted.distance_km,
        durationSeconds: inserted.duration_seconds,
        paceSecondsPerKm: inserted.pace_seconds_per_km,
        createdAt: inserted.created_at,
      },
      ...prev,
    ]);
  }

  async function handleShare() {
    setIsSharing(true);
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 0.9 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      // Sharing is a nice-to-have on top of an already-saved log -- a
      // failed capture/share isn't worth surfacing as a blocking error.
    }
    setIsSharing(false);
  }

  if (sportsError) {
    return <ErrorState message={sportsError} onRetry={retrySports} />;
  }

  if (historyError) {
    return <ErrorState message={historyError} onRetry={() => setHistoryRetryCount((c) => c + 1)} />;
  }

  if (sportsLoading || !mode) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Log</Text>
        <View style={styles.spacer} />
        <SegmentedControl
          options={[
            { value: 'lift', label: 'Lift' },
            { value: 'run', label: 'Run' },
          ]}
          value={mode}
          onChange={setModeOverride}
        />
        <View style={styles.spacer} />
        <Button label="Browse plans" variant="secondary" onPress={() => navigation.navigate('PlanBrowse')} />
        <View style={styles.spacer} />

        {mode === 'lift' ? (
          <Button label="Start workout" onPress={() => navigation.navigate('WorkoutSession', { workoutId: null })} />
        ) : (
          <>
            <Text style={styles.label}>Location</Text>
            <Pressable onPress={() => setPickerVisible(true)}>
              <Card style={styles.locationCard}>
                <Text style={styles.locationText}>{location ? location.name : 'Pick a park…'}</Text>
              </Card>
            </Pressable>
            <TextField label="Distance (km)" value={distanceKm} onChangeText={setDistanceKm} keyboardType="decimal-pad" />
            <TextField
              label="Duration (minutes)"
              value={durationMinutes}
              onChangeText={setDurationMinutes}
              keyboardType="decimal-pad"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label={isSubmitting ? 'Saving…' : 'Log run'}
              onPress={handleLogRun}
              disabled={isSubmitting || !location}
            />
          </>
        )}

        {mode === 'run' && shareData ? (
          <>
            <View style={styles.spacer} />
            <ShareCard ref={shareCardRef} eyebrow={shareData.eyebrow} headline={shareData.headline} detail={shareData.detail} />
            <View style={styles.spacerSmall} />
            <Button label={isSharing ? 'Sharing…' : 'Share'} onPress={handleShare} disabled={isSharing} />
            <View style={styles.spacerSmall} />
            <Button label="Dismiss" variant="secondary" onPress={() => setShareData(null)} />
          </>
        ) : null}

        <View style={styles.spacer} />
        <Text style={styles.sectionTitle}>History</Text>
        <View style={styles.spacerSmall} />
        {mode === 'lift'
          ? workouts.map((workout) => (
              <Pressable key={workout.id} onPress={() => navigation.navigate('WorkoutSession', { workoutId: workout.id })}>
                <Card style={styles.historyCard}>
                  <Text style={styles.historyLabel}>{workout.title}</Text>
                  <Text style={styles.historyDetail}>{summarizeWorkout(workout.exercises)}</Text>
                  <Text style={styles.historyTimestamp}>{formatTimestamp(workout.startedAt)}</Text>
                </Card>
              </Pressable>
            ))
          : runHistory.map((run) => (
              <Card key={run.id} style={styles.historyCard}>
                <Text style={styles.historyLabel}>{run.distanceKm} km</Text>
                <Text style={styles.historyDetail}>{formatPace(run.paceSecondsPerKm)}</Text>
                <Text style={styles.historyTimestamp}>{formatTimestamp(run.createdAt)}</Text>
              </Card>
            ))}
        {(mode === 'lift' ? workouts.length === 0 : runHistory.length === 0) ? (
          <Text style={styles.emptyBody}>Nothing logged yet.</Text>
        ) : null}
      </ScrollView>

      {/* Keyed on visibility so each open is a fresh mount -- resets the
          modal's internal search/add state without an effect. */}
      <CheckInLocationModal
        key={pickerVisible ? 'open' : 'closed'}
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(_type, id, name) => {
          setLocation({ id, name });
          setPickerVisible(false);
        }}
        hasLifting={false}
        liftingSportId={null}
        hasRunning={hasRunning}
        runningSportId={runningSportId}
        initialType="park"
      />
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
  label: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  locationCard: {
    marginBottom: theme.spacing.md,
  },
  locationText: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
  },
  historyCard: {
    marginBottom: theme.spacing.sm,
  },
  historyLabel: {
    fontSize: theme.typography.size.base,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  historyDetail: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  historyTimestamp: {
    fontSize: theme.typography.size.xs,
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
    marginBottom: theme.spacing.sm,
  },
});
