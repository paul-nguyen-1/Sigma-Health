import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import type { Sport } from '../../types/models';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'SportSelect'>;

export function SportSelectScreen({ navigation }: Props) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [sportsRes, userSportsRes] = await Promise.all([
        supabase.from('sports').select('id, slug, name').order('slug'),
        supabase.from('user_sports').select('sport_id').eq('user_id', user.id),
      ]);

      setSports(
        (sportsRes.data ?? []).map((row) => ({ id: row.id, slug: row.slug, name: row.name })),
      );
      const existing = new Set((userSportsRes.data ?? []).map((row) => row.sport_id as string));
      setSelected(existing);
      setInitialSelected(existing);
      setIsLoading(false);
    }
    load();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleContinue() {
    setError(null);
    setIsSubmitting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsSubmitting(false);
      return;
    }

    const toAdd = [...selected].filter((id) => !initialSelected.has(id));
    const toRemove = [...initialSelected].filter((id) => !selected.has(id));

    if (toAdd.length > 0) {
      const { error: insertError } = await supabase
        .from('user_sports')
        .insert(toAdd.map((sportId) => ({ user_id: user.id, sport_id: sportId })));
      if (insertError) {
        setError(insertError.message);
        setIsSubmitting(false);
        return;
      }
    }

    if (toRemove.length > 0) {
      const { error: deleteError } = await supabase
        .from('user_sports')
        .delete()
        .eq('user_id', user.id)
        .in('sport_id', toRemove);
      if (deleteError) {
        setError(deleteError.message);
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(false);
    navigation.navigate('ProfileSetup');
  }

  if (isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>What do you train?</Text>
      <View style={styles.spacer} />
      <Text style={styles.body}>Pick at least one -- you can change this later.</Text>
      <View style={styles.spacer} />
      {sports.map((sport) => {
        const isSelected = selected.has(sport.id);
        return (
          <Pressable
            key={sport.id}
            onPress={() => toggle(sport.id)}
            style={[styles.option, isSelected && styles.optionSelected]}
          >
            <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
              {sport.name}
            </Text>
          </Pressable>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <Button
        label={isSubmitting ? 'Saving…' : 'Continue'}
        onPress={handleContinue}
        disabled={isSubmitting || selected.size === 0}
      />
      <View style={styles.spacerSmall} />
      <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
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
  option: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingVertical: theme.spacing.sm + 4,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  optionSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface,
  },
  optionLabel: {
    fontSize: theme.typography.size.base,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  optionLabelSelected: {
    color: theme.colors.primary,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginTop: theme.spacing.sm,
  },
});
