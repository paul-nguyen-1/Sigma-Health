import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ErrorState } from '../components/ErrorState';
import { ShareCard } from '../components/ShareCard';
import { CheckInLocationModal } from '../components/CheckInLocationModal';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { useUserSports } from '../lib/useUserSports';
import type { LogStackParamList } from '../navigation/LogStack';
import { summarizeWorkout } from '../types/models';
import type { PersonalRecord, WorkoutExercise } from '../types/models';

type Props = NativeStackScreenProps<LogStackParamList, 'WorkoutSession'>;
type LocationRef = { id: string; name: string };
type ShareData = { eyebrow: string; headline: string; detail: string };

const CHECK_IN_DURATION_MS = 3 * 60 * 60 * 1000;

// A workout is one row (title + exercises JSONB), not one row per lift --
// starting a new session ties it to a gym via CheckInLocationModal, which
// also performs a real check-in there. Structural edits (add/remove
// exercise or set) save immediately; text/number edits save on blur so
// typing doesn't fire a request per keystroke.
export function WorkoutSessionScreen({ route, navigation }: Props) {
  const { hasLifting, liftingSportId } = useUserSports();
  const [workoutId, setWorkoutId] = useState<string | null>(route.params.workoutId);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState<LocationRef | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(!!route.params.workoutId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [personalRecords, setPersonalRecords] = useState<Map<string, PersonalRecord>>(new Map());
  const shareCardRef = useRef<View>(null);

  async function refreshPersonalRecords() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('personal_records')
      .select('id, user_id, exercise_name, best_weight, best_reps, best_1rm, workout_id, achieved_at')
      .eq('user_id', user.id);
    setPersonalRecords(
      new Map(
        (data ?? []).map((row) => [
          row.exercise_name,
          {
            id: row.id,
            userId: row.user_id,
            exerciseName: row.exercise_name,
            bestWeight: row.best_weight,
            bestReps: row.best_reps,
            best1RM: row.best_1rm,
            workoutId: row.workout_id,
            achievedAt: row.achieved_at,
          },
        ]),
      ),
    );
  }

  useEffect(() => {
    if (!workoutId) return;
    let cancelled = false;

    async function load() {
      refreshPersonalRecords();
      const { data, error: fetchError } = await supabase
        .from('workouts')
        .select('title, gym_id, exercises')
        .eq('id', workoutId)
        .maybeSingle();
      if (cancelled) return;
      if (fetchError || !data) {
        setLoadError(fetchError?.message ?? 'Workout not found');
        setIsLoading(false);
        return;
      }
      setTitle(data.title);
      setExercises((data.exercises as WorkoutExercise[]) ?? []);
      if (data.gym_id) {
        const { data: gym } = await supabase.from('gyms').select('name').eq('id', data.gym_id).maybeSingle();
        if (!cancelled) setLocation({ id: data.gym_id, name: gym?.name ?? 'Unknown gym' });
      }
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workoutId]);

  async function saveExercises(next: WorkoutExercise[]) {
    if (!workoutId) return;
    await supabase.from('workouts').update({ exercises: next, updated_at: new Date().toISOString() }).eq('id', workoutId);
    // The sync_personal_records trigger runs server-side on this same
    // update, so PRs are already current by the time this resolves.
    refreshPersonalRecords();
  }

  async function saveTitle() {
    if (!workoutId) return;
    await supabase.from('workouts').update({ title: title.trim() || 'Workout', updated_at: new Date().toISOString() }).eq('id', workoutId);
  }

  function handleAddExercise() {
    const next = [...exercises, { name: '', sets: [] }];
    setExercises(next);
    saveExercises(next);
  }

  function handleRemoveExercise(index: number) {
    const next = exercises.filter((_, i) => i !== index);
    setExercises(next);
    saveExercises(next);
  }

  function handleExerciseNameChange(index: number, name: string) {
    setExercises((prev) => prev.map((ex, i) => (i === index ? { ...ex, name } : ex)));
  }

  function handleAddSet(exerciseIndex: number) {
    const next = exercises.map((ex, i) => (i === exerciseIndex ? { ...ex, sets: [...ex.sets, { weight: 0, reps: 0 }] } : ex));
    setExercises(next);
    saveExercises(next);
  }

  function handleRemoveSet(exerciseIndex: number, setIndex: number) {
    const next = exercises.map((ex, i) =>
      i === exerciseIndex ? { ...ex, sets: ex.sets.filter((_, si) => si !== setIndex) } : ex,
    );
    setExercises(next);
    saveExercises(next);
  }

  function handleSetFieldChange(exerciseIndex: number, setIndex: number, field: 'weight' | 'reps', value: string) {
    const num = Number(value.replace(/[^0-9.]/g, '')) || 0;
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exerciseIndex ? { ...ex, sets: ex.sets.map((s, si) => (si === setIndex ? { ...s, [field]: num } : s)) } : ex,
      ),
    );
  }

  function handleBlurSaveExercises() {
    saveExercises(exercises);
  }

  async function handleStart() {
    if (!location) {
      setError('Pick a gym first.');
      return;
    }
    setError(null);
    setIsStarting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsStarting(false);
      return;
    }
    const finalTitle = title.trim() || 'Workout';
    const { data: inserted, error: insertError } = await supabase
      .from('workouts')
      .insert({ user_id: user.id, gym_id: location.id, title: finalTitle, exercises: [] })
      .select('id')
      .single();
    if (insertError || !inserted) {
      setError(insertError?.message ?? 'Could not start workout.');
      setIsStarting(false);
      return;
    }

    const expiresAt = new Date(Date.now() + CHECK_IN_DURATION_MS).toISOString();
    await supabase
      .from('check_ins')
      .insert({ user_id: user.id, location_type: 'gym', location_id: location.id, expires_at: expiresAt });

    setTitle(finalTitle);
    setIsStarting(false);
    setWorkoutId(inserted.id);
  }

  function handleDone() {
    if (exercises.length > 0) {
      setShareData({ eyebrow: 'Workout logged', headline: title || 'Workout', detail: summarizeWorkout(exercises) });
      return;
    }
    navigation.goBack();
  }

  async function handleShare() {
    setIsSharing(true);
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 0.9 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      // Sharing is a nice-to-have on top of an already-saved workout -- a
      // failed capture/share isn't worth surfacing as a blocking error.
    }
    setIsSharing(false);
  }

  function handleDelete() {
    if (!workoutId) return;
    Alert.alert('Delete this workout?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('workouts').delete().eq('id', workoutId);
          navigation.goBack();
        },
      },
    ]);
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => navigation.goBack()} />;
  }

  if (isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  // Not started yet: title + location setup only.
  if (!workoutId) {
    return (
      <ScreenContainer>
        <Text style={styles.title}>New workout</Text>
        <View style={styles.spacer} />
        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Chest Day" />
        <Text style={styles.label}>Location</Text>
        <Pressable onPress={() => setPickerVisible(true)}>
          <Card style={styles.locationCard}>
            <Text style={styles.locationText}>{location ? location.name : 'Pick a gym…'}</Text>
          </Card>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.spacer} />
        <Button label={isStarting ? 'Starting…' : 'Start workout'} onPress={handleStart} disabled={isStarting || !location} />
        <View style={styles.spacerSmall} />
        <Button label="Cancel" variant="secondary" onPress={() => navigation.goBack()} />

        <CheckInLocationModal
          key={pickerVisible ? 'open' : 'closed'}
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          onSelect={(_type, id, name) => {
            setLocation({ id, name });
            setPickerVisible(false);
          }}
          hasLifting={hasLifting}
          liftingSportId={liftingSportId}
          hasRunning={false}
          runningSportId={null}
          initialType="gym"
        />
      </ScreenContainer>
    );
  }

  if (shareData) {
    return (
      <ScreenContainer>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Nice work</Text>
          <View style={styles.spacer} />
          <ShareCard ref={shareCardRef} eyebrow={shareData.eyebrow} headline={shareData.headline} detail={shareData.detail} />
          <View style={styles.spacerSmall} />
          <Button label={isSharing ? 'Sharing…' : 'Share'} onPress={handleShare} disabled={isSharing} />
          <View style={styles.spacerSmall} />
          <Button label="Back to Log" variant="secondary" onPress={() => navigation.goBack()} />
        </ScrollView>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <TextField label="Title" value={title} onChangeText={setTitle} onBlur={saveTitle} />
        {location ? <Text style={styles.locationText}>At {location.name}</Text> : null}
        <View style={styles.spacer} />

        {exercises.map((exercise, exerciseIndex) => {
          const pr = personalRecords.get(exercise.name.trim().toLowerCase());
          return (
            <Card key={exerciseIndex} style={styles.exerciseCard}>
              <View style={styles.exerciseHeaderRow}>
                <View style={styles.exerciseNameField}>
                  <TextField
                    label="Exercise"
                    value={exercise.name}
                    onChangeText={(text) => handleExerciseNameChange(exerciseIndex, text)}
                    onBlur={handleBlurSaveExercises}
                    placeholder="Bench Press"
                  />
                  {pr ? (
                    <Text style={styles.prLabel}>
                      PR: {pr.bestWeight}×{pr.bestReps} ({Math.round(pr.best1RM)} 1RM)
                    </Text>
                  ) : null}
                </View>
                <Pressable onPress={() => handleRemoveExercise(exerciseIndex)} style={styles.removeButton}>
                  <Text style={styles.removeButtonLabel}>Remove</Text>
                </Pressable>
              </View>

              {exercise.sets.map((set, setIndex) => (
                <View key={setIndex} style={styles.setRow}>
                  <View style={styles.setField}>
                    <TextField
                      label="Weight"
                      value={set.weight ? String(set.weight) : ''}
                      onChangeText={(text) => handleSetFieldChange(exerciseIndex, setIndex, 'weight', text)}
                      onBlur={handleBlurSaveExercises}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.setField}>
                    <TextField
                      label="Reps"
                      value={set.reps ? String(set.reps) : ''}
                      onChangeText={(text) => handleSetFieldChange(exerciseIndex, setIndex, 'reps', text)}
                      onBlur={handleBlurSaveExercises}
                      keyboardType="number-pad"
                    />
                  </View>
                  <Pressable onPress={() => handleRemoveSet(exerciseIndex, setIndex)} style={styles.removeSetButton}>
                    <Text style={styles.removeButtonLabel}>✕</Text>
                  </Pressable>
                </View>
              ))}
              <Button label="+ Add set" variant="secondary" onPress={() => handleAddSet(exerciseIndex)} />
            </Card>
          );
        })}

        <Button label="+ Add exercise" variant="secondary" onPress={handleAddExercise} />
        <View style={styles.spacer} />
        <Button label="Done" onPress={handleDone} />
        <View style={styles.spacerSmall} />
        <Button label="Back to Log" variant="secondary" onPress={() => navigation.goBack()} />
        <View style={styles.spacerSmall} />
        <Button label="Delete workout" variant="secondary" onPress={handleDelete} />
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
  label: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  spacer: {
    height: theme.spacing.lg,
  },
  spacerSmall: {
    height: theme.spacing.sm,
  },
  locationCard: {
    marginBottom: theme.spacing.md,
  },
  locationText: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
  exerciseCard: {
    marginBottom: theme.spacing.md,
  },
  exerciseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  exerciseNameField: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  removeButton: {
    paddingTop: theme.spacing.md,
  },
  prLabel: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.primary,
    fontWeight: theme.typography.weight.semibold,
    marginTop: theme.spacing.xs,
  },
  removeButtonLabel: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.danger,
    fontWeight: theme.typography.weight.semibold,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  setField: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  removeSetButton: {
    paddingTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.xs,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginBottom: theme.spacing.sm,
  },
});
