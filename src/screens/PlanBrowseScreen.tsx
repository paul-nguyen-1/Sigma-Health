import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { SegmentedControl } from '../components/SegmentedControl';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { useUserSports } from '../lib/useUserSports';
import type { LogStackParamList } from '../navigation/LogStack';

type Mode = 'lift' | 'run';
type Props = NativeStackScreenProps<LogStackParamList, 'PlanBrowse'>;
type TemplateRow = { id: string; name: string; description: string | null; sessionCount: number };

// Starting a plan is just one INSERT into user_plans -- the
// generate_user_plan_sessions trigger (migration 0016) does the rest
// server-side, so a client can't skip/fabricate scheduled sessions.
export function PlanBrowseScreen({ navigation }: Props) {
  const { isLoading: sportsLoading, error: sportsError, hasLifting, hasRunning, retry: retrySports } = useUserSports();
  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const mode: Mode | null = sportsLoading ? null : (modeOverride ?? (hasLifting ? 'lift' : 'run'));

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!mode) return;
      let cancelled = false;

      async function load() {
        setLoadError(null);
        const { data, error: fetchError } = await supabase
          .from('plan_templates')
          .select('id, name, description, sports!inner(slug), plan_sessions(id)')
          .eq('sports.slug', mode === 'lift' ? 'lifting' : 'running');
        if (cancelled) return;
        if (fetchError) {
          setLoadError(fetchError.message);
          setIsLoading(false);
          return;
        }
        setTemplates(
          (data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            sessionCount: (row.plan_sessions as unknown[])?.length ?? 0,
          })),
        );
        setIsLoading(false);
      }
      load();
      return () => {
        cancelled = true;
      };
      // retryCount isn't read in the body -- it's a dependency purely to
      // force this callback to re-run when the ErrorState Retry button
      // bumps it, which is exactly what the dependency array is for.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, retryCount]),
  );

  async function handleStart(templateId: string) {
    setError(null);
    setStartingId(templateId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setStartingId(null);
      return;
    }
    const { error: insertError } = await supabase
      .from('user_plans')
      .insert({ user_id: user.id, plan_template_id: templateId });
    setStartingId(null);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    navigation.navigate('LogList');
  }

  if (sportsError) {
    return <ErrorState message={sportsError} onRetry={retrySports} />;
  }
  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setRetryCount((c) => c + 1)} />;
  }
  if (sportsLoading || !mode || isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Plans</Text>
        <View style={styles.spacer} />
        {hasLifting && hasRunning ? (
          <>
            <SegmentedControl
              options={[
                { value: 'lift', label: 'Lift' },
                { value: 'run', label: 'Run' },
              ]}
              value={mode}
              onChange={setModeOverride}
            />
            <View style={styles.spacer} />
          </>
        ) : null}

        {templates.length === 0 ? (
          <Text style={styles.emptyBody}>No plans available yet.</Text>
        ) : (
          templates.map((template) => (
            <Card key={template.id} style={styles.templateCard}>
              <Text style={styles.templateName}>{template.name}</Text>
              {template.description ? <Text style={styles.templateDescription}>{template.description}</Text> : null}
              <Text style={styles.templateMeta}>{template.sessionCount} sessions</Text>
              <View style={styles.spacerSmall} />
              <Button
                label={startingId === template.id ? 'Starting…' : 'Start'}
                onPress={() => handleStart(template.id)}
                disabled={startingId !== null}
              />
            </Card>
          ))
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.spacer} />
        <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
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
  spacer: {
    height: theme.spacing.lg,
  },
  spacerSmall: {
    height: theme.spacing.sm,
  },
  templateCard: {
    marginBottom: theme.spacing.md,
  },
  templateName: {
    fontSize: theme.typography.size.lg,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.text,
  },
  templateDescription: {
    fontSize: theme.typography.size.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  templateMeta: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  emptyBody: {
    fontSize: theme.typography.size.base,
    color: theme.colors.textMuted,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginTop: theme.spacing.sm,
  },
});
