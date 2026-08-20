import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { ErrorState } from '../../components/ErrorState';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import { useUserSports } from '../../lib/useUserSports';
import { useMeStatus } from '../../navigation/me-status-context';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'HomeLocation'>;
type LocationType = 'gym' | 'park';
type SearchResult = { id: string; name: string };

// No proximity sort in v1 -- with only 1-2 seeded locations per pilot gym/
// club, sorting by distance has no practical value yet. Name search is
// enough until the directory is large enough for that to matter.
export function HomeLocationScreen({ navigation }: Props) {
  const { refresh } = useMeStatus();
  const {
    isLoading: sportsLoading,
    error: sportsError,
    hasLifting,
    liftingSportId,
    hasRunning,
    runningSportId,
    retry: retrySports,
  } = useUserSports();
  const [locationTypeOverride, setLocationTypeOverride] = useState<LocationType | null>(null);
  const locationType: LocationType | null = sportsLoading
    ? null
    : (locationTypeOverride ?? (hasLifting ? 'gym' : 'park'));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [mode, setMode] = useState<'search' | 'add'>('search');
  const [newName, setNewName] = useState('');
  const [newCoords, setNewCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationType) return;
    async function search() {
      const table = locationType === 'gym' ? 'gyms' : 'parks';
      let q = supabase.from(table).select('id, name').order('name');
      if (query.trim()) {
        q = q.ilike('name', `%${query.trim()}%`);
      }
      const { data } = await q;
      setResults(data ?? []);
    }
    search();
  }, [locationType, query]);

  async function handleSelect(id: string) {
    setError(null);
    setIsSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsSubmitting(false);
      return;
    }
    const update =
      locationType === 'gym' ? { home_gym_id: id, home_park_id: null } : { home_gym_id: null, home_park_id: id };
    const { error: updateError } = await supabase.from('profiles').update(update).eq('id', user.id);
    setIsSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await refresh();
  }

  async function handleUseCurrentLocation() {
    setError(null);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setError('Location permission is needed to add a new spot.');
      return;
    }
    const position = await Location.getCurrentPositionAsync({});
    setNewCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
  }

  async function handleSubmitNew() {
    setError(null);
    if (!newCoords) {
      setError('Use your current location first.');
      return;
    }
    const sportId = locationType === 'gym' ? liftingSportId : runningSportId;
    if (!sportId) return;

    setIsSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsSubmitting(false);
      return;
    }
    const table = locationType === 'gym' ? 'gyms' : 'parks';
    const { data: inserted, error: insertError } = await supabase
      .from(table)
      .insert({ sport_id: sportId, name: newName.trim(), lat: newCoords.lat, lng: newCoords.lng, submitted_by: user.id })
      .select('id')
      .single();
    if (insertError || !inserted) {
      setError(insertError?.message ?? 'Could not add that location.');
      setIsSubmitting(false);
      return;
    }
    await handleSelect(inserted.id);
  }

  if (sportsError) {
    return <ErrorState message={sportsError} onRetry={retrySports} />;
  }

  if (sportsLoading || !locationType) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>Pick your home spot</Text>
      <View style={styles.spacer} />
      {hasLifting && hasRunning ? (
        <View style={styles.toggleRow}>
          <Pressable
            onPress={() => setLocationTypeOverride('gym')}
            style={[styles.toggleOption, locationType === 'gym' && styles.toggleOptionSelected]}
          >
            <Text style={[styles.toggleLabel, locationType === 'gym' && styles.toggleLabelSelected]}>Gym</Text>
          </Pressable>
          <Pressable
            onPress={() => setLocationTypeOverride('park')}
            style={[styles.toggleOption, locationType === 'park' && styles.toggleOptionSelected]}
          >
            <Text style={[styles.toggleLabel, locationType === 'park' && styles.toggleLabelSelected]}>Park</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.spacer} />

      {mode === 'search' ? (
        <>
          <TextField
            label={locationType === 'gym' ? 'Search gyms' : 'Search parks'}
            value={query}
            onChangeText={setQuery}
            placeholder="Start typing…"
          />
          <ScrollView style={styles.results}>
            {results.map((result) => (
              <Pressable key={result.id} onPress={() => handleSelect(result.id)} disabled={isSubmitting}>
                <Card style={styles.resultCard}>
                  <Text style={styles.resultLabel}>{result.name}</Text>
                </Card>
              </Pressable>
            ))}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Can't find it? Add it" variant="secondary" onPress={() => setMode('add')} />
          <View style={styles.spacerSmall} />
          <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
        </>
      ) : (
        <>
          <TextField label="Name" value={newName} onChangeText={setNewName} />
          <Button
            label={newCoords ? 'Location captured ✓' : 'Use my current location'}
            variant="secondary"
            onPress={handleUseCurrentLocation}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.spacer} />
          <Button
            label={isSubmitting ? 'Adding…' : 'Add and continue'}
            onPress={handleSubmitNew}
            disabled={isSubmitting || newName.trim().length === 0 || !newCoords}
          />
          <View style={styles.spacerSmall} />
          <Button label="Back to search" variant="secondary" onPress={() => setMode('search')} />
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: theme.typography.size.xxl,
    fontWeight: theme.typography.weight.bold,
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
  results: {
    maxHeight: 280,
  },
  resultCard: {
    marginBottom: theme.spacing.sm,
  },
  resultLabel: {
    fontSize: theme.typography.size.base,
    color: theme.colors.text,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginVertical: theme.spacing.sm,
  },
});
