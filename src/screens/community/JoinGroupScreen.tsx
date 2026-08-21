import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import type { CommunityStackParamList } from '../../navigation/CommunityStack';

type Props = NativeStackScreenProps<CommunityStackParamList, 'JoinGroup'>;

// join_group_by_code (migration 0021) is the only way anyone other than
// a group's creator gets a conversation_members row -- a non-creator has
// no ownership claim a plain client INSERT's RLS check could verify.
export function JoinGroupScreen({ navigation }: Props) {
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    if (!code.trim()) return;
    setIsJoining(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('join_group_by_code', { code: code.trim().toUpperCase() });
    setIsJoining(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    navigation.replace('Chat', { conversationId: data as string });
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>Join group</Text>
      <View style={styles.spacer} />
      <TextField
        label="Invite code"
        value={code}
        onChangeText={setCode}
        placeholder="e.g. A1B2C3D4"
        autoCapitalize="characters"
        autoFocus
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <Button label={isJoining ? 'Joining…' : 'Join'} onPress={handleJoin} disabled={isJoining || !code.trim()} />
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
