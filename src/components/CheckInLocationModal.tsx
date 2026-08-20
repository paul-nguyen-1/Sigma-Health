import React, { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { ScreenContainer } from './ScreenContainer';
import { Button } from './Button';
import { TextField } from './TextField';
import { SegmentedControl } from './SegmentedControl';
import { LocationSearchList } from './LocationSearchList';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { distanceMeters, formatDistance } from '../lib/geo';

type LocationType = 'gym' | 'park';

// How close (in meters) a device's GPS fix must be to a gym/park's
// recorded coordinates to accept a check-in there. Deliberately loose --
// this isn't meant to catch someone standing in the parking lot vs. the
// weight room (indoor GPS can drift several hundred meters, especially in
// a steel-framed gym), it's meant to catch someone "checking in" from a
// different city entirely. Tighten later if abuse shows up in a form GPS
// alone can't stop; until then a hard block should only fire on the
// obvious case.
const CHECK_IN_RADIUS_METERS = 5000;

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (type: LocationType, id: string, name: string) => void;
  hasLifting: boolean;
  liftingSportId: string | null;
  hasRunning: boolean;
  runningSportId: string | null;
  initialType: LocationType;
};

// Lets check-in target any gym/park, not just your home location -- the
// data model always supported this (check_ins.location_id was never tied
// to home_gym_id/home_park_id), it just had no UI. Shares the same
// search-or-add pattern as onboarding's HomeLocationScreen, but selecting
// here only sets where THIS check-in goes, not your home location.
export function CheckInLocationModal({
  visible,
  onClose,
  onSelect,
  hasLifting,
  liftingSportId,
  hasRunning,
  runningSportId,
  initialType,
}: Props) {
  const [locationTypeOverride, setLocationTypeOverride] = useState<LocationType | null>(null);
  const locationType = locationTypeOverride ?? initialType;
  const [mode, setMode] = useState<'search' | 'add'>('search');
  const [newName, setNewName] = useState('');
  const [newCoords, setNewCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picking an existing gym/park only counts as a check-in if the device
  // is actually there -- otherwise this would just be a favorites list.
  async function handleSelectExisting(id: string, name: string, lat: number, lng: number) {
    setError(null);
    setIsVerifying(true);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setIsVerifying(false);
      setError('Location permission is needed to check in.');
      return;
    }
    const position = await Location.getCurrentPositionAsync({});
    const distance = distanceMeters({ lat: position.coords.latitude, lng: position.coords.longitude }, { lat, lng });
    setIsVerifying(false);
    // __DEV__ only -- a simulator's GPS fix rarely matches real pilot
    // locations, and this would otherwise block every check-in while
    // building. Still runs the real check (and logs it) so the distance
    // math itself gets exercised during development.
    if (distance > CHECK_IN_RADIUS_METERS && !__DEV__) {
      setError(`You need to be at ${name} to check in — you're about ${formatDistance(distance)} away.`);
      return;
    }
    if (distance > CHECK_IN_RADIUS_METERS) {
      console.log(`[dev] check-in distance check bypassed: ${formatDistance(distance)} from ${name}`);
    }
    onSelect(locationType, id, name);
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
    const name = newName.trim();
    const { data: inserted, error: insertError } = await supabase
      .from(table)
      .insert({ sport_id: sportId, name, lat: newCoords.lat, lng: newCoords.lng, submitted_by: user.id })
      .select('id')
      .single();
    setIsSubmitting(false);
    if (insertError || !inserted) {
      setError(insertError?.message ?? 'Could not add that location.');
      return;
    }
    onSelect(locationType, inserted.id, name);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScreenContainer>
        <Text style={styles.title}>Check in at…</Text>
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
            <LocationSearchList
              locationType={locationType}
              onSelect={handleSelectExisting}
              disabled={isSubmitting || isVerifying}
            />
            {isVerifying ? <Text style={styles.hint}>Checking your location…</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Can't find it? Add it" variant="secondary" onPress={() => setMode('add')} />
            <View style={styles.spacerSmall} />
            <Button label="Cancel" variant="secondary" onPress={onClose} />
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
              label={isSubmitting ? 'Adding…' : 'Add and check in'}
              onPress={handleSubmitNew}
              disabled={isSubmitting || newName.trim().length === 0 || !newCoords}
            />
            <View style={styles.spacerSmall} />
            <Button label="Back to search" variant="secondary" onPress={() => setMode('search')} />
          </>
        )}
      </ScreenContainer>
    </Modal>
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
  hint: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.size.sm,
    marginVertical: theme.spacing.sm,
  },
});
