import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import type { AuthStackParamList } from '../navigation/AuthNavigator';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export function SignInScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignIn() {
    setError(null);
    setIsSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (signInError) {
      setError(signInError.message);
    }
  }

  return (
    <ScreenContainer style={styles.container}>
      <Text style={styles.title}>Sign In</Text>
      <View style={styles.spacer} />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <Button
        label={isSubmitting ? 'Signing In…' : 'Sign In'}
        onPress={handleSignIn}
        disabled={isSubmitting || !email || !password}
      />
      <View style={styles.spacerSmall} />
      <Button label="Create an account" variant="secondary" onPress={() => navigation.navigate('SignUp')} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
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
    marginBottom: theme.spacing.sm,
  },
});
