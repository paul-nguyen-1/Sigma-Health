import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { LocationSearchList } from '../../components/LocationSearchList';
import { Button } from '../../components/Button';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import { formatPace } from '../../lib/format';
import type { CommunityStackParamList } from '../../navigation/CommunityStack';

type Props = NativeStackScreenProps<CommunityStackParamList, 'ProposeMatch'>;

// Pace-bucket boundaries were deliberately left unspecified in
// .claude.roadmap.phase3.md §0 Case 5 (no real running-pace data exists
// yet to derive real ones from) -- picking concrete ones here to ship
// v1, not a claim these are correct; revisit once real usage exists.
const PACE_BUCKETS: { max: number; key: string; label: string }[] = [
  { max: 240, key: 'sub_4_00', label: 'Sub 4:00/km' },
  { max: 270, key: '4_00_4_30', label: '4:00–4:30/km' },
  { max: 300, key: '4_30_5_00', label: '4:30–5:00/km' },
  { max: 330, key: '5_00_5_30', label: '5:00–5:30/km' },
  { max: 360, key: '5_30_6_00', label: '5:30–6:00/km' },
  { max: Infinity, key: '6_00_plus', label: '6:00+/km' },
];

function paceBucketFor(paceSecondsPerKm: number) {
  return PACE_BUCKETS.find((b) => paceSecondsPerKm < b.max) ?? PACE_BUCKETS[PACE_BUCKETS.length - 1];
}

// Pace bucket is derived from the user's own most recent run, not
// manually chosen -- avoids a confusing manual-bucket-picker UI (per
// §4's screen table).
export function ProposeMatchScreen({ navigation }: Props) {
  const [recentPace, setRecentPace] = useState<number | null>(null);
  const [isLoadingPace, setIsLoadingPace] = useState(true);
  const [isProposing, setIsProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function load() {
        setIsLoadingPace(true);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase
          .from('runs')
          .select('pace_seconds_per_km')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        setRecentPace(data?.pace_seconds_per_km ?? null);
        setIsLoadingPace(false);
      }
      load();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  async function handleSelectPark(parkId: string) {
    if (!recentPace) return;
    setIsProposing(true);
    setError(null);
    const bucket = paceBucketFor(recentPace);
    const { error: rpcError } = await supabase.rpc('propose_match', { p_park_id: parkId, p_pace_bucket: bucket.key });
    setIsProposing(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    navigation.goBack();
  }

  return (
    <ScreenContainer>
      <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
      <View style={styles.spacer} />
      <Text style={styles.title}>Find a running match</Text>
      <View style={styles.spacerSmall} />

      {isLoadingPace ? null : recentPace ? (
        <Text style={styles.body}>
          Matching by your recent pace: {formatPace(recentPace)} ({paceBucketFor(recentPace).label})
        </Text>
      ) : (
        <Text style={styles.body}>Log a run first so we know what pace to match you on.</Text>
      )}
      <View style={styles.spacer} />

      {recentPace ? (
        <LocationSearchList locationType="park" onSelect={handleSelectPark} disabled={isProposing} />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: theme.typography.size.xxl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
  },
  body: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
  },
  spacer: {
    height: theme.spacing.lg,
  },
  spacerSmall: {
    height: theme.spacing.sm,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginTop: theme.spacing.sm,
  },
});
