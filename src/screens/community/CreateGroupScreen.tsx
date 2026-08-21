import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import type { CommunityStackParamList } from '../../navigation/CommunityStack';

type Props = NativeStackScreenProps<CommunityStackParamList, 'CreateGroup'>;

// create_group (migration 0021) does both the conversations insert and
// the creator's own conversation_members insert atomically -- a plain
// client insert can't do that safely (an orphaned conversation row with
// no membership row would be permanently invisible to its own creator).
export function CreateGroupScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setIsCreating(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('create_group', { name: name.trim() });
    setIsCreating(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    navigation.replace('Chat', { conversationId: data as string });
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>Create group</Text>
      <View style={styles.spacer} />
      <TextField label="Group name" value={name} onChangeText={setName} placeholder="e.g. Gold's Gym Crew" autoFocus />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <Button label={isCreating ? 'Creating…' : 'Create'} onPress={handleCreate} disabled={isCreating || !name.trim()} />
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
