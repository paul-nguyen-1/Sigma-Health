import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../navigation/auth-context';
import { useMeStatus } from '../../navigation/me-status-context';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'PhoneVerify'>;

// US-only for now (matches the pilot's single-market launch) -- no country
// picker, digits are assumed to be a 10-digit US number and get a +1 prefix.
function toE164(digits: string) {
  return `+1${digits}`;
}

export function PhoneVerifyScreen({ navigation }: Props) {
  const { refresh } = useMeStatus();
  const { signOut } = useAuth();
  const [stage, setStage] = useState<'enter-phone' | 'enter-code'>('enter-phone');
  const [digits, setDigits] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSendCode() {
    setError(null);
    setIsSubmitting(true);
    const { error: sendError } = await supabase.auth.updateUser({ phone: toE164(digits) });
    setIsSubmitting(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setStage('enter-code');
  }

  async function handleVerifyCode() {
    setError(null);
    setIsSubmitting(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: toE164(digits),
      token: code,
      type: 'phone_change',
    });
    if (verifyError) {
      setIsSubmitting(false);
      setError(verifyError.message);
      return;
    }
    await refresh();
    setIsSubmitting(false);
    navigation.navigate('SportSelect');
  }

  return (
    <ScreenContainer style={styles.container}>
      <Text style={styles.title}>Verify your phone</Text>
      <View style={styles.spacer} />
      <Text style={styles.body}>
        We use this to keep matching and messaging safe -- it&apos;s required before you can connect
        with anyone.
      </Text>
      <View style={styles.spacer} />
      {stage === 'enter-phone' ? (
        <>
          <TextField
            label="Phone number"
            value={digits}
            onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 10))}
            keyboardType="phone-pad"
            placeholder="5551234567"
            textContentType="telephoneNumber"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={isSubmitting ? 'Sending…' : 'Send code'}
            onPress={handleSendCode}
            disabled={isSubmitting || digits.length !== 10}
          />
        </>
      ) : (
        <>
          <TextField
            label="Verification code"
            value={code}
            onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            placeholder="123456"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={isSubmitting ? 'Verifying…' : 'Verify'}
            onPress={handleVerifyCode}
            disabled={isSubmitting || code.length !== 6}
          />
          <View style={styles.spacerSmall} />
          <Button
            label="Use a different number"
            variant="secondary"
            onPress={() => {
              setStage('enter-phone');
              setCode('');
              setError(null);
            }}
          />
        </>
      )}
      <View style={styles.spacer} />
      <Button label="Sign Out" variant="secondary" onPress={signOut} />
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
