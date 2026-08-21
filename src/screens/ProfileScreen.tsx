import React, { useCallback, useState } from 'react';
import { Image, Pressable, Share, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { SegmentedControl } from '../components/SegmentedControl';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { formatPace, formatTimestamp } from '../lib/format';
import { mergeActivity } from '../lib/activity';
import { summarizeWorkout } from '../types/models';
import { useAuth } from '../navigation/auth-context';
import type { PersonalRecord, Run, Workout } from '../types/models';
import type { ProfileStackParamList } from '../navigation/ProfileStack';

type Filter = 'all' | 'lift' | 'run';
type Props = NativeStackScreenProps<ProfileStackParamList, 'MyProfile'>;

export function ProfileScreen({ navigation }: Props) {
  const { signOut } = useAuth();
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [homeLocationName, setHomeLocationName] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setLoadError(null);

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) {
          if (!cancelled) setIsLoading(false);
          return;
        }

        setUserId(user.id);

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('display_name, bio, avatar_url, home_gym_id, home_park_id, referral_code')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw new Error(profileError.message);

        if (profile) {
          setDisplayName(profile.display_name);
          setBio(profile.bio);
          setAvatarUrl(profile.avatar_url);
          setReferralCode(profile.referral_code);

          if (profile.home_gym_id) {
            const { data: gym, error: gymError } = await supabase
              .from('gyms')
              .select('name')
              .eq('id', profile.home_gym_id)
              .maybeSingle();
            if (gymError) throw new Error(gymError.message);
            setHomeLocationName(gym?.name ?? null);
          } else if (profile.home_park_id) {
            const { data: park, error: parkError } = await supabase
              .from('parks')
              .select('name')
              .eq('id', profile.home_park_id)
              .maybeSingle();
            if (parkError) throw new Error(parkError.message);
            setHomeLocationName(park?.name ?? null);
          }
        }

        const [workoutsRes, runRes, prRes, followerCountRes, followingCountRes] = await Promise.all([
          supabase
            .from('workouts')
            .select('id, user_id, gym_id, title, exercises, started_at, updated_at')
            .eq('user_id', user.id)
            .order('started_at', { ascending: false })
            .limit(10),
          supabase
            .from('runs')
            .select('id, user_id, park_id, distance_km, duration_seconds, pace_seconds_per_km, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(10),
          supabase
            .from('personal_records')
            .select('id, user_id, exercise_name, best_weight, best_reps, best_1rm, workout_id, achieved_at')
            .eq('user_id', user.id)
            .order('best_1rm', { ascending: false }),
          supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', user.id),
          supabase.from('follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', user.id),
        ]);
        if (workoutsRes.error) throw new Error(workoutsRes.error.message);
        if (runRes.error) throw new Error(runRes.error.message);
        if (prRes.error) throw new Error(prRes.error.message);
        if (cancelled) return;

        setFollowerCount(followerCountRes.count ?? 0);
        setFollowingCount(followingCountRes.count ?? 0);

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
          (runRes.data ?? []).map((row) => ({
            id: row.id,
            userId: row.user_id,
            parkId: row.park_id,
            distanceKm: row.distance_km,
            durationSeconds: row.duration_seconds,
            paceSecondsPerKm: row.pace_seconds_per_km,
            createdAt: row.created_at,
          })),
        );
        setPersonalRecords(
          (prRes.data ?? []).map((row) => ({
            id: row.id,
            userId: row.user_id,
            exerciseName: row.exercise_name,
            bestWeight: row.best_weight,
            bestReps: row.best_reps,
            best1RM: row.best_1rm,
            workoutId: row.workout_id,
            achievedAt: row.achieved_at,
          })),
        );

        setIsLoading(false);
      }
      load().catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load your profile');
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

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} />
        )}
        <View style={styles.spacerSmall} />
        <Text style={styles.title}>{displayName}</Text>
        {bio ? <Text style={styles.bio}>{bio}</Text> : null}
        {homeLocationName ? <Text style={styles.homeLocation}>{homeLocationName}</Text> : null}
        <View style={styles.spacerSmall} />

        <View style={styles.countsRow}>
          <Pressable
            onPress={() => userId && navigation.navigate('FollowList', { userId, mode: 'followers', title: 'Followers' })}
          >
            <Text style={styles.countLabel}>{followerCount} followers</Text>
          </Pressable>
          <Pressable
            onPress={() => userId && navigation.navigate('FollowList', { userId, mode: 'following', title: 'Following' })}
          >
            <Text style={styles.countLabel}>{followingCount} following</Text>
          </Pressable>
        </View>
        <View style={styles.spacerSmall} />

        {referralCode ? (
          <Pressable
            onPress={() =>
              Share.share({ message: `Join me on Sigma Health! Use my invite code ${referralCode} when you sign up.` })
            }
          >
            <Card style={styles.referralCard}>
              <Text style={styles.referralLabel}>Your referral code</Text>
              <Text style={styles.referralCode}>{referralCode}</Text>
              <Text style={styles.referralHint}>Tap to share</Text>
            </Card>
          </Pressable>
        ) : null}
        <View style={styles.spacer} />

        {personalRecords.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Personal records</Text>
            <View style={styles.spacerSmall} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.prRow}>
              {personalRecords.map((pr) => (
                <Card key={pr.id} style={styles.prCard}>
                  <Text style={styles.prExercise}>{pr.exerciseName}</Text>
                  <Text style={styles.prStat}>
                    {pr.bestWeight}×{pr.bestReps}
                  </Text>
                  <Text style={styles.prDetail}>{Math.round(pr.best1RM)} 1RM</Text>
                </Card>
              ))}
            </ScrollView>
            <View style={styles.spacer} />
          </>
        ) : null}

        <SegmentedControl
          options={[
            { value: 'all', label: 'All' },
            { value: 'lift', label: 'Lift' },
            { value: 'run', label: 'Run' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <View style={styles.spacer} />

        {filter === 'all' &&
          (mergeActivity(workouts, runHistory).length === 0 ? (
            <Text style={styles.emptyBody}>Nothing logged yet.</Text>
          ) : (
            mergeActivity(workouts, runHistory).map((item) => (
              <Card key={item.id} style={styles.historyCard}>
                <Text style={styles.historyLabel}>{item.label}</Text>
                <Text style={styles.historyDetail}>{item.detail}</Text>
                <Text style={styles.historyTimestamp}>{item.timestamp}</Text>
              </Card>
            ))
          ))}

        {filter === 'lift' &&
          (workouts.length === 0 ? (
            <Text style={styles.emptyBody}>No workouts logged yet.</Text>
          ) : (
            workouts.map((workout) => (
              <Card key={workout.id} style={styles.historyCard}>
                <Text style={styles.historyLabel}>{workout.title}</Text>
                <Text style={styles.historyDetail}>{summarizeWorkout(workout.exercises)}</Text>
                <Text style={styles.historyTimestamp}>{formatTimestamp(workout.startedAt)}</Text>
              </Card>
            ))
          ))}

        {filter === 'run' &&
          (runHistory.length === 0 ? (
            <Text style={styles.emptyBody}>No runs logged yet.</Text>
          ) : (
            runHistory.map((run) => (
              <Card key={run.id} style={styles.historyCard}>
                <Text style={styles.historyLabel}>{run.distanceKm} km</Text>
                <Text style={styles.historyDetail}>{formatPace(run.paceSecondsPerKm)}</Text>
                <Text style={styles.historyTimestamp}>{formatTimestamp(run.createdAt)}</Text>
              </Card>
            ))
          ))}

        <View style={styles.spacer} />
        <Button label="Sign Out" variant="secondary" onPress={signOut} />
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
  bio: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  homeLocation: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  countsRow: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
  },
  countLabel: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textMuted,
  },
  referralCard: {
    alignItems: 'center',
  },
  referralLabel: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.textMuted,
  },
  referralCode: {
    fontSize: theme.typography.size.xl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
    letterSpacing: 2,
    marginTop: theme.spacing.xs,
  },
  referralHint: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.primary,
    marginTop: theme.spacing.xs,
  },
  sectionTitle: {
    fontSize: theme.typography.size.lg,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  prRow: {
    flexGrow: 0,
  },
  prCard: {
    marginRight: theme.spacing.sm,
    minWidth: 120,
  },
  prExercise: {
    fontSize: theme.typography.size.sm,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
    textTransform: 'capitalize',
  },
  prStat: {
    fontSize: theme.typography.size.lg,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.primary,
    marginTop: theme.spacing.xs,
  },
  prDetail: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  spacer: {
    height: theme.spacing.lg,
  },
  spacerSmall: {
    height: theme.spacing.sm,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarPlaceholder: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
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
});
