import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { SegmentedControl } from '../components/SegmentedControl';
import { ShareCard } from '../components/ShareCard';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { mergeActivity, mergeFollowedActivity } from '../lib/activity';
import type { FeedItem } from '../lib/activity';
import { calculateStreak, STREAK_MILESTONES } from '../lib/streak';
import { useUserSports } from '../lib/useUserSports';
import { isLiftTarget, summarizeWorkout } from '../types/models';
import type { PersonalRecord, PlanSessionTarget, Run, Workout } from '../types/models';
import type { AppTabParamList } from '../navigation/AppTabs';

const RECENT_LIMIT = 3;
const FEED_LIMIT = 5;
const STREAK_LOOKBACK_DAYS = 60;
const MILESTONE_STORAGE_KEY = 'streakMilestoneShown';

type Filter = 'all' | 'lift' | 'run';
type TodaysSession = {
  userPlanSessionId: string;
  title: string;
  target: PlanSessionTarget;
  completedAt: string | null;
};
type PlanCardState = 'no-plan' | 'rest-day' | 'session' | null;
type DailySessionCard = { dailySessionId: string; title: string; target: PlanSessionTarget };
type MilestoneShareData = { streak: number };

// Check-in itself only happens from the Log tab (starting a workout or
// logging a run) so it can be GPS-verified against the exact location
// you're about to log against -- Home has no check-in UI or status at all.
//
// "Today's session" (Phase 2): if a user has more than one active plan,
// the most-recently-started one wins -- picking among them is a display
// decision, not something the schema constrains (see
// .claude.roadmap.phase2.md Status).
export function HomeScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<AppTabParamList>>();
  const { liftingSportId, runningSportId } = useUserSports();
  const [planCardState, setPlanCardState] = useState<PlanCardState>(null);
  const [todaysSession, setTodaysSession] = useState<TodaysSession | null>(null);
  const [dailySessions, setDailySessions] = useState<DailySessionCard[]>([]);
  const [streak, setStreak] = useState(0);
  const [milestoneShareData, setMilestoneShareData] = useState<MilestoneShareData | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [followedFeed, setFollowedFeed] = useState<FeedItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const shareCardRef = useRef<View>(null);

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

          const today = new Date().toISOString().slice(0, 10);
          const streakCutoff = new Date(Date.now() - STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
          const dailySessionSportIds = [liftingSportId, runningSportId].filter((id): id is string => !!id);

          const [workoutsRes, runsRes, planRes, checkInsRes, completedSessionsRes, dailySessionsRes, followedPrsRes, followedRunsRes] =
            await Promise.all([
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
              supabase
                .from('user_plans')
                .select('id')
                .eq('status', 'active')
                .order('started_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
              supabase.from('check_ins').select('checked_in_at').eq('user_id', user.id).gte('checked_in_at', streakCutoff),
              supabase.from('user_plan_sessions').select('completed_at').not('completed_at', 'is', null).gte('completed_at', streakCutoff),
              dailySessionSportIds.length > 0
                ? supabase.from('daily_sessions').select('id, title, target').eq('date', today).in('sport_id', dailySessionSportIds)
                : Promise.resolve({ data: [], error: null }),
              // RLS (migration 0024) already restricts these to followed
              // users -- self excluded via .neq, no separate "who do I
              // follow" round-trip needed. Reverse-chronological, LIMIT-
              // bounded, no ranking -- see .claude.roadmap.phase3.md §4.
              supabase
                .from('personal_records')
                .select('id, user_id, exercise_name, best_weight, best_reps, best_1rm, workout_id, achieved_at')
                .neq('user_id', user.id)
                .order('achieved_at', { ascending: false })
                .limit(FEED_LIMIT),
              supabase
                .from('runs')
                .select('id, user_id, park_id, distance_km, duration_seconds, pace_seconds_per_km, created_at')
                .neq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(FEED_LIMIT),
            ]);
          if (cancelled) return;

          const firstError =
            workoutsRes.error ??
            runsRes.error ??
            planRes.error ??
            checkInsRes.error ??
            completedSessionsRes.error ??
            dailySessionsRes.error ??
            followedPrsRes.error ??
            followedRunsRes.error;
          if (firstError) {
            setLoadError(firstError.message);
            setIsLoading(false);
            return;
          }

          const followedPersonalRecords: PersonalRecord[] = (followedPrsRes.data ?? []).map((row) => ({
            id: row.id,
            userId: row.user_id,
            exerciseName: row.exercise_name,
            bestWeight: row.best_weight,
            bestReps: row.best_reps,
            best1RM: row.best_1rm,
            workoutId: row.workout_id,
            achievedAt: row.achieved_at,
          }));
          const followedRuns: Run[] = (followedRunsRes.data ?? []).map((row) => ({
            id: row.id,
            userId: row.user_id,
            parkId: row.park_id,
            distanceKm: row.distance_km,
            durationSeconds: row.duration_seconds,
            paceSecondsPerKm: row.pace_seconds_per_km,
            createdAt: row.created_at,
          }));
          const feedUserIds = [...new Set([...followedPersonalRecords.map((pr) => pr.userId), ...followedRuns.map((r) => r.userId)])];
          if (feedUserIds.length > 0) {
            const { data: feedProfiles } = await supabase.from('profiles_public').select('id, display_name').in('id', feedUserIds);
            if (cancelled) return;
            const namesByUserId: Record<string, string> = {};
            for (const p of feedProfiles ?? []) namesByUserId[p.id] = p.display_name;
            setFollowedFeed(mergeFollowedActivity(followedPersonalRecords, followedRuns, namesByUserId));
          } else {
            setFollowedFeed([]);
          }

          const streakDates = [
            ...(checkInsRes.data ?? []).map((row) => row.checked_in_at),
            ...(completedSessionsRes.data ?? []).map((row) => row.completed_at as string),
          ];
          const currentStreak = calculateStreak(streakDates);
          setStreak(currentStreak);

          if (STREAK_MILESTONES.includes(currentStreak)) {
            const shownRaw = await AsyncStorage.getItem(MILESTONE_STORAGE_KEY);
            const alreadyShown = shownRaw ? Number(shownRaw) : 0;
            if (currentStreak > alreadyShown) {
              setMilestoneShareData({ streak: currentStreak });
              await AsyncStorage.setItem(MILESTONE_STORAGE_KEY, String(currentStreak));
            }
          }

          setDailySessions(
            (dailySessionsRes.data ?? []).map((row) => ({
              dailySessionId: row.id,
              title: row.title,
              target: row.target as PlanSessionTarget,
            })),
          );

          if (!planRes.data) {
            setPlanCardState('no-plan');
            setTodaysSession(null);
          } else {
            const { data: session, error: sessionError } = await supabase
              .from('user_plan_sessions')
              .select('id, completed_at, plan_sessions(title, target)')
              .eq('user_plan_id', planRes.data.id)
              .eq('scheduled_date', today)
              .maybeSingle();
            if (cancelled) return;
            if (sessionError) {
              setLoadError(sessionError.message);
              setIsLoading(false);
              return;
            }
            if (!session || !session.plan_sessions) {
              setPlanCardState('rest-day');
              setTodaysSession(null);
            } else {
              const planSession = session.plan_sessions as unknown as { title: string; target: PlanSessionTarget };
              setPlanCardState('session');
              setTodaysSession({
                userPlanSessionId: session.id,
                title: planSession.title,
                target: planSession.target,
                completedAt: session.completed_at,
              });
            }
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
    }, [retryCount, liftingSportId, runningSportId]),
  );

  function navigateToSession(target: PlanSessionTarget, hand: { userPlanSessionId: string; title: string } | { dailySessionId: string; title: string }) {
    if (isLiftTarget(target)) {
      const planSession = 'userPlanSessionId' in hand ? { ...hand, target } : undefined;
      const dailySession = 'dailySessionId' in hand ? { ...hand, target } : undefined;
      navigation.navigate('Log', { screen: 'WorkoutSession', params: { workoutId: null, planSession, dailySession } });
    } else {
      const runPlanSession = 'userPlanSessionId' in hand ? { ...hand, target } : undefined;
      const runDailySession = 'dailySessionId' in hand ? { ...hand, target } : undefined;
      navigation.navigate('Log', { screen: 'LogList', params: { runPlanSession, runDailySession } });
    }
  }

  function handleStartTodaysSession() {
    if (!todaysSession) return;
    navigateToSession(todaysSession.target, { userPlanSessionId: todaysSession.userPlanSessionId, title: todaysSession.title });
  }

  function handleStartDailySession(session: DailySessionCard) {
    navigateToSession(session.target, { dailySessionId: session.dailySessionId, title: session.title });
  }

  async function handleShareMilestone() {
    setIsSharing(true);
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 0.9 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      // Sharing is a nice-to-have -- a failed capture/share isn't worth
      // surfacing as a blocking error.
    }
    setIsSharing(false);
  }

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
        <View style={styles.headerRow}>
          <Text style={styles.title}>Home</Text>
          {streak > 0 ? (
            <View style={styles.streakBadge}>
              <Text style={styles.streakBadgeText}>
                {streak} day{streak === 1 ? '' : 's'} streak
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.spacer} />

        {milestoneShareData ? (
          <>
            <Card>
              <Text style={styles.planCardTitle}>{milestoneShareData.streak}-day streak!</Text>
              <View style={styles.spacerSmall} />
              <ShareCard
                ref={shareCardRef}
                eyebrow="Streak milestone"
                headline={`${milestoneShareData.streak} days`}
                detail="Consecutive days checked in or trained"
              />
              <View style={styles.spacerSmall} />
              <Button label={isSharing ? 'Sharing…' : 'Share'} onPress={handleShareMilestone} disabled={isSharing} />
              <View style={styles.spacerSmall} />
              <Button label="Dismiss" variant="secondary" onPress={() => setMilestoneShareData(null)} />
            </Card>
            <View style={styles.spacer} />
          </>
        ) : null}

        {planCardState === 'no-plan' ? (
          <Card>
            <Text style={styles.planCardBody}>No active plan — head to the Log tab to browse and start one.</Text>
          </Card>
        ) : null}
        {planCardState === 'rest-day' ? (
          <Card>
            <Text style={styles.planCardBody}>Rest day — nothing scheduled today.</Text>
          </Card>
        ) : null}
        {planCardState === 'session' && todaysSession ? (
          <Card>
            <Text style={styles.planCardTitle}>{todaysSession.title}</Text>
            <Text style={styles.planCardBody}>
              {isLiftTarget(todaysSession.target)
                ? summarizeWorkout(todaysSession.target.exercises)
                : `${todaysSession.target.distanceKm} km`}
            </Text>
            <View style={styles.spacerSmall} />
            {todaysSession.completedAt ? (
              <Text style={styles.planCardDone}>Done for today ✓</Text>
            ) : (
              <Button label="Start" onPress={handleStartTodaysSession} />
            )}
          </Card>
        ) : null}

        {dailySessions.map((session) => (
          <React.Fragment key={session.dailySessionId}>
            <View style={styles.spacerSmall} />
            <Card>
              <Text style={styles.dailySessionEyebrow}>Session of the day</Text>
              <Text style={styles.planCardTitle}>{session.title}</Text>
              <Text style={styles.planCardBody}>
                {isLiftTarget(session.target) ? summarizeWorkout(session.target.exercises) : `${session.target.distanceKm} km`}
              </Text>
              <View style={styles.spacerSmall} />
              <Button label="Start" variant="secondary" onPress={() => handleStartDailySession(session)} />
            </Card>
          </React.Fragment>
        ))}
        <View style={styles.spacer} />

        {followedFeed.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Following</Text>
            <View style={styles.spacerSmall} />
            {followedFeed.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => navigation.navigate('Profile', { screen: 'OtherProfile', params: { userId: item.userId } })}
              >
                <Card style={styles.activityCard}>
                  <Text style={styles.feedUserName}>{item.userName}</Text>
                  <Text style={styles.activityLabel}>{item.label}</Text>
                  <Text style={styles.activityDetail}>{item.detail}</Text>
                  <Text style={styles.activityTimestamp}>{item.timestamp}</Text>
                </Card>
              </Pressable>
            ))}
            <View style={styles.spacer} />
          </>
        ) : null}

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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: theme.typography.size.xxl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
  },
  streakBadge: {
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs,
  },
  streakBadgeText: {
    color: theme.colors.primaryText,
    fontSize: theme.typography.size.sm,
    fontWeight: theme.typography.weight.semibold,
  },
  sectionTitle: {
    fontSize: theme.typography.size.lg,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  dailySessionEyebrow: {
    fontSize: theme.typography.size.xs,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.primary,
    textTransform: 'uppercase',
  },
  spacer: {
    height: theme.spacing.lg,
  },
  spacerSmall: {
    height: theme.spacing.sm,
  },
  planCardTitle: {
    fontSize: theme.typography.size.lg,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  planCardBody: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  planCardDone: {
    fontSize: theme.typography.size.base,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.primary,
  },
  activityCard: {
    marginBottom: theme.spacing.sm,
  },
  feedUserName: {
    fontSize: theme.typography.size.xs,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.primary,
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
