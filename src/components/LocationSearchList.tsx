import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Card } from './Card';
import { TextField } from './TextField';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';

type SearchResult = { id: string; name: string; lat: number; lng: number };

type Props = {
  locationType: 'gym' | 'park';
  onSelect: (id: string, name: string, lat: number, lng: number) => void;
  disabled?: boolean;
};

// Shared by HomeLocationScreen (onboarding) and CheckInLocationModal (used
// from the Log tab) -- same "search this sport's location directory by
// name" query either way, only what happens on select differs. lat/lng
// are carried through so CheckInLocationModal can verify proximity before
// treating a pick as an actual check-in; HomeLocationScreen just ignores
// them.
export function LocationSearchList({ locationType, onSelect, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    async function search() {
      const table = locationType === 'gym' ? 'gyms' : 'parks';
      let q = supabase.from(table).select('id, name, lat, lng').order('name');
      if (query.trim()) {
        q = q.ilike('name', `%${query.trim()}%`);
      }
      const { data } = await q;
      setResults(data ?? []);
    }
    search();
  }, [locationType, query]);

  return (
    <>
      <TextField
        label={locationType === 'gym' ? 'Search gyms' : 'Search parks'}
        value={query}
        onChangeText={setQuery}
        placeholder="Start typing…"
      />
      <ScrollView style={styles.results}>
        {results.map((result) => (
          <Pressable
            key={result.id}
            onPress={() => onSelect(result.id, result.name, result.lat, result.lng)}
            disabled={disabled}
          >
            <Card style={styles.resultCard}>
              <Text style={styles.resultLabel}>{result.name}</Text>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
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
});
