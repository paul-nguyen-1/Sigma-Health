import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ErrorState } from '../components/ErrorState';
import { ShareCard } from '../components/ShareCard';
import { SegmentedControl } from '../components/SegmentedControl';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { formatPace } from '../lib/format';
import { useUserSports } from '../lib/useUserSports';
import type { PersonalRecord, Run } from '../types/models';

type Mode = 'lift' | 'run';
type ShareData = { eyebrow: string; headline: string; detail: string };

export function LogScreen() {
  const {
    isLoading: sportsLoading,
    error: sportsError,
    hasLifting,
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
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const shareCardRef = useRef<View>(null);

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
    const { data: inserted, error: insertError } = await supabase
      .from('personal_records')
      .insert({ user_id: user.id, lift_name: liftName.trim(), weight: weightNum, reps: repsNum })
      .select('id, user_id, gym_id, lift_name, weight, reps, calculated_1rm, created_at')
      .single();
    setIsSubmitting(false);
    if (insertError || !inserted) {
      setError(insertError?.message ?? 'Could not log that lift.');
      return;
    }
    setLiftName('');
    setWeight('');
    setReps('');
    setShareData({
      eyebrow: 'New PR',
      headline: inserted.lift_name,
      detail: `${inserted.weight} x ${inserted.reps} · 1RM ${Math.round(inserted.calculated_1rm)}`,
    });
    setPrHistory((prev) => [
      {
        id: inserted.id,
        userId: inserted.user_id,
        gymId: inserted.gym_id,
        liftName: inserted.lift_name,
        weight: inserted.weight,
        reps: inserted.reps,
        calculated1rm: inserted.calculated_1rm,
        createdAt: inserted.created_at,
      },
      ...prev,
    ]);
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
    const { data: inserted, error: insertError } = await supabase
      .from('runs')
      .insert({ user_id: user.id, distance_km: distanceNum, duration_seconds: Math.round(durationNum * 60) })
      .select('id, user_id, park_id, distance_km, duration_seconds, pace_seconds_per_km, created_at')
      .single();
    setIsSubmitting(false);
    if (insertError || !inserted) {
      setError(insertError?.message ?? 'Could not log that run.');
      return;
    }
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

        {shareData ? (
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
