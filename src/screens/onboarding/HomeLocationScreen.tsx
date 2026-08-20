import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { ErrorState } from '../../components/ErrorState';
import { SegmentedControl } from '../../components/SegmentedControl';
import { LocationSearchList } from '../../components/LocationSearchList';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import { useUserSports } from '../../lib/useUserSports';
import { useMeStatus } from '../../navigation/me-status-context';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'HomeLocation'>;
type LocationType = 'gym' | 'park';

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
  const [mode, setMode] = useState<'search' | 'add'>('search');
  const [newName, setNewName] = useState('');
  const [newCoords, setNewCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(id: string, _name: string) {
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
    await handleSelect(inserted.id, newName.trim());
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
        <SegmentedControl
          options={[
            { value: 'gym', label: 'Gym' },
            { value: 'park', label: 'Park' },
          ]}
          value={locationType}
          onChange={setLocationTypeOverride}
        />
      ) : null}
      <View style={styles.spacer} />

      {mode === 'search' ? (
        <>
          <LocationSearchList locationType={locationType} onSelect={handleSelect} disabled={isSubmitting} />
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
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginVertical: theme.spacing.sm,
  },
});
