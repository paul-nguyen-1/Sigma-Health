import React, { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import { formatPace, formatTimestamp } from '../../lib/format';
import type { ProfileStackParamList } from '../../navigation/ProfileStack';
import type { AppTabParamList } from '../../navigation/AppTabs';

type Props = NativeStackScreenProps<ProfileStackParamList, 'OtherProfile'>;
type ProfileInfo = { displayName: string; bio: string | null; avatarUrl: string | null };
type PrRow = { id: string; exerciseName: string; bestWeight: number; bestReps: number; best1RM: number };
type RunRow = { id: string; distanceKm: number; paceSecondsPerKm: number; createdAt: string };

// personal_records/runs here are gated by the same RLS the client always
// relies on (migration 0024: self OR followed) -- this screen doesn't
// need to pre-check "am I following them," it just queries and gets
// back whatever the current user is actually allowed to see.
export function OtherProfileScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const tabNavigation = useNavigation<BottomTabNavigationProp<AppTabParamList>>();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [personalRecords, setPersonalRecords] = useState<PrRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isTogglingFollow, setIsTogglingFollow] = useState(false);
  const [isMessaging, setIsMessaging] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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
        setCurrentUserId(user.id);

        const [profileRes, followingRes, followerCountRes, followingCountRes, prRes, runRes] = await Promise.all([
          supabase.from('profiles_public').select('display_name, bio, avatar_url').eq('id', userId).single(),
          supabase
            .from('follows')
            .select('follower_id', { count: 'exact', head: true })
            .eq('follower_id', user.id)
            .eq('followed_id', userId),
          supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', userId),
          supabase.from('follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', userId),
          supabase
            .from('personal_records')
            .select('id, exercise_name, best_weight, best_reps, best_1rm')
            .eq('user_id', userId)
            .order('best_1rm', { ascending: false }),
          supabase
            .from('runs')
            .select('id, distance_km, pace_seconds_per_km, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10),
        ]);
        if (cancelled) return;

        if (profileRes.error) {
          setLoadError(profileRes.error.message);
          setIsLoading(false);
          return;
        }

        setProfile({
          displayName: profileRes.data.display_name,
          bio: profileRes.data.bio,
          avatarUrl: profileRes.data.avatar_url,
        });
        setIsFollowing((followingRes.count ?? 0) > 0);
        setFollowerCount(followerCountRes.count ?? 0);
        setFollowingCount(followingCountRes.count ?? 0);
        setPersonalRecords(
          (prRes.data ?? []).map((row) => ({
            id: row.id,
            exerciseName: row.exercise_name,
            bestWeight: row.best_weight,
            bestReps: row.best_reps,
            best1RM: row.best_1rm,
          })),
        );
        setRuns(
          (runRes.data ?? []).map((row) => ({
            id: row.id,
            distanceKm: row.distance_km,
            paceSecondsPerKm: row.pace_seconds_per_km,
            createdAt: row.created_at,
          })),
        );
        setIsLoading(false);
      }
      load();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, retryCount]),
  );

  async function handleToggleFollow() {
    if (!currentUserId) return;
    setIsTogglingFollow(true);
    setActionError(null);
    if (isFollowing) {
      const { error } = await supabase.from('follows').delete().eq('follower_id', currentUserId).eq('followed_id', userId);
      if (error) {
        setActionError(error.message);
      } else {
        setIsFollowing(false);
        setFollowerCount((c) => Math.max(0, c - 1));
      }
    } else {
      const { error } = await supabase.from('follows').insert({ follower_id: currentUserId, followed_id: userId });
      if (error) {
        setActionError(error.message);
      } else {
        setIsFollowing(true);
        setFollowerCount((c) => c + 1);
      }
    }
    setIsTogglingFollow(false);
  }

  async function handleMessage() {
    setIsMessaging(true);
    setActionError(null);
    const { data: conversationId, error } = await supabase.rpc('start_direct_conversation', { other_user_id: userId });
    setIsMessaging(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    tabNavigation.navigate('Community', { screen: 'Chat', params: { conversationId: conversationId as string } });
  }

  function handleBlock() {
    if (!currentUserId) return;
    Alert.alert('Block this user?', `They won't be able to message or follow you, and you won't see each other's activity.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          setIsBlocking(true);
          setActionError(null);
          const { error } = await supabase.from('blocks').insert({ blocker_id: currentUserId, blocked_id: userId });
          setIsBlocking(false);
          if (error) {
            setActionError(error.message);
            return;
          }
          navigation.goBack();
        },
      },
    ]);
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setRetryCount((c) => c + 1)} />;
  }
  if (isLoading || !profile) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  const isSelf = currentUserId === userId;

  return (
    <ScreenContainer>
      <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
      <View style={styles.spacer} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {profile.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} />
        )}
        <View style={styles.spacerSmall} />
        <Text style={styles.title}>{profile.displayName}</Text>
        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        <View style={styles.spacerSmall} />

        <View style={styles.countsRow}>
          <Pressable
            onPress={() => navigation.push('FollowList', { userId, mode: 'followers', title: `${profile.displayName}'s followers` })}
          >
            <Text style={styles.countLabel}>{followerCount} followers</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.push('FollowList', { userId, mode: 'following', title: `${profile.displayName} is following` })}
          >
            <Text style={styles.countLabel}>{followingCount} following</Text>
          </Pressable>
        </View>
        <View style={styles.spacer} />

        {!isSelf ? (
          <>
            <View style={styles.actionsRow}>
              <View style={styles.actionButton}>
                <Button
                  label={isTogglingFollow ? '…' : isFollowing ? 'Unfollow' : 'Follow'}
                  variant={isFollowing ? 'secondary' : 'primary'}
                  onPress={handleToggleFollow}
                  disabled={isTogglingFollow}
                />
              </View>
              <View style={styles.actionButton}>
                <Button label={isMessaging ? '…' : 'Message'} variant="secondary" onPress={handleMessage} disabled={isMessaging} />
              </View>
            </View>
            <View style={styles.spacerSmall} />
            <Button label={isBlocking ? '…' : 'Block'} variant="secondary" onPress={handleBlock} disabled={isBlocking} />
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
            <View style={styles.spacer} />
          </>
        ) : null}

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

        {runs.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Recent runs</Text>
            <View style={styles.spacerSmall} />
            {runs.map((run) => (
              <Card key={run.id} style={styles.historyCard}>
                <Text style={styles.historyLabel}>{run.distanceKm} km</Text>
                <Text style={styles.historyDetail}>{formatPace(run.paceSecondsPerKm)}</Text>
                <Text style={styles.historyTimestamp}>{formatTimestamp(run.createdAt)}</Text>
              </Card>
            ))}
          </>
        ) : null}

        {personalRecords.length === 0 && runs.length === 0 ? (
          <Text style={styles.emptyBody}>
            {isSelf || isFollowing ? 'Nothing logged yet.' : 'Follow to see their activity.'}
          </Text>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacer: {
    height: theme.spacing.lg,
  },
  spacerSmall: {
    height: theme.spacing.sm,
  },
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
  countsRow: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
  },
  countLabel: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textMuted,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginTop: theme.spacing.sm,
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
