import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import type { AuthStackParamList } from '../navigation/AuthNavigator';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

export function SignUpScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignUp() {
    setError(null);
    setIsSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    setIsSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    // Project has autoconfirm off, so a new signup never returns a session directly.
    if (!data.session) {
      setConfirmationSent(true);
    }
  }

  if (confirmationSent) {
    return (
      <ScreenContainer style={styles.container}>
        <Text style={styles.title}>Check your email</Text>
        <View style={styles.spacer} />
        <Text style={styles.body}>We sent a confirmation link to {email}. Confirm it, then sign in.</Text>
        <View style={styles.spacer} />
        <Button label="Back to Sign In" variant="secondary" onPress={() => navigation.navigate('SignIn')} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container}>
      <Text style={styles.title}>Create Account</Text>
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
        textContentType="newPassword"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <Button
        label={isSubmitting ? 'Creating Account…' : 'Create Account'}
        onPress={handleSignUp}
        disabled={isSubmitting || !email || !password}
      />
      <View style={styles.spacerSmall} />
      <Button label="Back to Sign In" variant="secondary" onPress={() => navigation.navigate('SignIn')} />
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
    marginBottom: theme.spacing.sm,
  },
});
