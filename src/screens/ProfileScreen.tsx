import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { formatPace } from '../lib/format';
import { useUserSports } from '../lib/useUserSports';
import { useAuth } from '../navigation/auth-context';
import type { PersonalRecord, Run } from '../types/models';

export function ProfileScreen() {
  const { signOut } = useAuth();
  const {
    isLoading: sportsLoading,
    error: sportsError,
    hasLifting,
    hasRunning,
    retry: retrySports,
  } = useUserSports();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [homeLocationName, setHomeLocationName] = useState<string | null>(null);
  const [prHistory, setPrHistory] = useState<PersonalRecord[]>([]);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (sportsLoading) return;

    async function load() {
      setIsLoading(true);
      setLoadError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('display_name, bio, avatar_url, home_gym_id, home_park_id')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw new Error(profileError.message);

      if (profile) {
        setDisplayName(profile.display_name);
        setBio(profile.bio);
        setAvatarUrl(profile.avatar_url);

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

      if (hasLifting) {
        const { data, error: prError } = await supabase
          .from('personal_records')
          .select('id, user_id, gym_id, lift_name, weight, reps, calculated_1rm, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10);
        if (prError) throw new Error(prError.message);
        setPrHistory(
          (data ?? []).map((row) => ({
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
      }

      if (hasRunning) {
        const { data, error: runError } = await supabase
          .from('runs')
          .select('id, user_id, park_id, distance_km, duration_seconds, pace_seconds_per_km, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10);
        if (runError) throw new Error(runError.message);
        setRunHistory(
          (data ?? []).map((row) => ({
            id: row.id,
            userId: row.user_id,
            parkId: row.park_id,
            distanceKm: row.distance_km,
            durationSeconds: row.duration_seconds,
            paceSecondsPerKm: row.pace_seconds_per_km,
            createdAt: row.created_at,
          })),
        );
      }

      setIsLoading(false);
    }
    load().catch((err) => {
      setLoadError(err instanceof Error ? err.message : 'Failed to load your profile');
      setIsLoading(false);
    });
  }, [sportsLoading, hasLifting, hasRunning, retryCount]);

  if (sportsError) {
    return <ErrorState message={sportsError} onRetry={retrySports} />;
  }

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
        <View style={styles.spacer} />

        {hasLifting ? (
          <>
            <Text style={styles.sectionTitle}>PR history</Text>
            <View style={styles.spacerSmall} />
            {prHistory.length === 0 ? (
              <Text style={styles.emptyBody}>No PRs logged yet.</Text>
            ) : (
              prHistory.map((pr) => (
                <Card key={pr.id} style={styles.historyCard}>
                  <Text style={styles.historyLabel}>{pr.liftName}</Text>
                  <Text style={styles.historyDetail}>
                    {pr.weight} x {pr.reps} · 1RM {Math.round(pr.calculated1rm)}
                  </Text>
                </Card>
              ))
            )}
            <View style={styles.spacer} />
          </>
        ) : null}

        {hasRunning ? (
          <>
            <Text style={styles.sectionTitle}>Run history</Text>
            <View style={styles.spacerSmall} />
            {runHistory.length === 0 ? (
              <Text style={styles.emptyBody}>No runs logged yet.</Text>
            ) : (
              runHistory.map((run) => (
                <Card key={run.id} style={styles.historyCard}>
                  <Text style={styles.historyLabel}>{run.distanceKm} km</Text>
                  <Text style={styles.historyDetail}>{formatPace(run.paceSecondsPerKm)}</Text>
                </Card>
              ))
            )}
            <View style={styles.spacer} />
          </>
        ) : null}

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
  sectionTitle: {
    fontSize: theme.typography.size.lg,
    fontWeight: theme.typography.weight.semibold,
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
  emptyBody: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
  },
});
