import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ErrorState } from '../components/ErrorState';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { formatPace } from '../lib/format';
import { useUserSports } from '../lib/useUserSports';
import type { PersonalRecord, Run } from '../types/models';

type Mode = 'lift' | 'run';

export function LogScreen() {
  const {
    isLoading: sportsLoading,
    error: sportsError,
    hasLifting,
    hasRunning,
    retry: retrySports,
  } = useUserSports();
  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const mode: Mode | null = sportsLoading ? null : (modeOverride ?? (hasLifting ? 'lift' : 'run'));

  const [liftName, setLiftName] = useState('');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');

  const [distanceKm, setDistanceKm] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');

  const [prHistory, setPrHistory] = useState<PersonalRecord[]>([]);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRetryCount, setHistoryRetryCount] = useState(0);

  async function fetchPrHistory(userId: string): Promise<PersonalRecord[]> {
    const { data, error: fetchError } = await supabase
      .from('personal_records')
      .select('id, user_id, gym_id, lift_name, weight, reps, calculated_1rm, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (fetchError) throw new Error(fetchError.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      gymId: row.gym_id,
      liftName: row.lift_name,
      weight: row.weight,
      reps: row.reps,
      calculated1rm: row.calculated_1rm,
      createdAt: row.created_at,
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

  useEffect(() => {
    if (!mode) return;
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        setHistoryError(null);
        if (!user) return;
        const fetch = mode === 'lift' ? fetchPrHistory(user.id).then(setPrHistory) : fetchRunHistory(user.id).then(setRunHistory);
        return fetch;
      })
      .catch((err) => {
        setHistoryError(err instanceof Error ? err.message : 'Failed to load your history');
      });
  }, [mode, historyRetryCount]);

  async function handleLogLift() {
    setError(null);
    const weightNum = parseFloat(weight);
    const repsNum = parseInt(reps, 10);
    if (!liftName.trim() || !Number.isFinite(weightNum) || weightNum <= 0 || !Number.isInteger(repsNum) || repsNum <= 0) {
      setError('Enter a lift name, weight, and reps.');
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
    const { error: insertError } = await supabase
      .from('personal_records')
      .insert({ user_id: user.id, lift_name: liftName.trim(), weight: weightNum, reps: repsNum });
    setIsSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setLiftName('');
    setWeight('');
    setReps('');
    fetchPrHistory(user.id)
      .then(setPrHistory)
      .catch(() => {});
  }

  async function handleLogRun() {
    setError(null);
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
    const { error: insertError } = await supabase
      .from('runs')
      .insert({ user_id: user.id, distance_km: distanceNum, duration_seconds: Math.round(durationNum * 60) });
    setIsSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setDistanceKm('');
    setDurationMinutes('');
    fetchRunHistory(user.id)
      .then(setRunHistory)
      .catch(() => {});
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
        {hasLifting && hasRunning ? (
          <>
            <View style={styles.toggleRow}>
              <Pressable
                onPress={() => setModeOverride('lift')}
                style={[styles.toggleOption, mode === 'lift' && styles.toggleOptionSelected]}
              >
                <Text style={[styles.toggleLabel, mode === 'lift' && styles.toggleLabelSelected]}>Lift</Text>
              </Pressable>
              <Pressable
                onPress={() => setModeOverride('run')}
                style={[styles.toggleOption, mode === 'run' && styles.toggleOptionSelected]}
              >
                <Text style={[styles.toggleLabel, mode === 'run' && styles.toggleLabelSelected]}>Run</Text>
              </Pressable>
            </View>
            <View style={styles.spacer} />
          </>
        ) : null}

        {mode === 'lift' ? (
          <>
            <TextField label="Lift" value={liftName} onChangeText={setLiftName} placeholder="Bench press" />
            <TextField label="Weight" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
            <TextField label="Reps" value={reps} onChangeText={setReps} keyboardType="number-pad" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={isSubmitting ? 'Saving…' : 'Log lift'} onPress={handleLogLift} disabled={isSubmitting} />
          </>
        ) : (
          <>
            <TextField label="Distance (km)" value={distanceKm} onChangeText={setDistanceKm} keyboardType="decimal-pad" />
            <TextField
              label="Duration (minutes)"
              value={durationMinutes}
              onChangeText={setDurationMinutes}
              keyboardType="decimal-pad"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={isSubmitting ? 'Saving…' : 'Log run'} onPress={handleLogRun} disabled={isSubmitting} />
          </>
        )}

        <View style={styles.spacer} />
        <Text style={styles.sectionTitle}>History</Text>
        <View style={styles.spacerSmall} />
        {mode === 'lift'
          ? prHistory.map((pr) => (
              <Card key={pr.id} style={styles.historyCard}>
                <Text style={styles.historyLabel}>{pr.liftName}</Text>
                <Text style={styles.historyDetail}>
                  {pr.weight} x {pr.reps} · 1RM {Math.round(pr.calculated1rm)}
                </Text>
              </Card>
            ))
          : runHistory.map((run) => (
              <Card key={run.id} style={styles.historyCard}>
                <Text style={styles.historyLabel}>{run.distanceKm} km</Text>
                <Text style={styles.historyDetail}>{formatPace(run.paceSecondsPerKm)}</Text>
              </Card>
            ))}
        {(mode === 'lift' ? prHistory.length === 0 : runHistory.length === 0) ? (
          <Text style={styles.emptyBody}>Nothing logged yet.</Text>
        ) : null}
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
  toggleRow: {
    flexDirection: 'row',
  },
  toggleOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    marginRight: theme.spacing.sm,
  },
  toggleOptionSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface,
  },
  toggleLabel: {
    fontSize: theme.typography.size.base,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  toggleLabelSelected: {
    color: theme.colors.primary,
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
