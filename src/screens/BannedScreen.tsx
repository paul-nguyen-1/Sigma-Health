import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { theme } from '../theme';
import { useAuth } from '../navigation/auth-context';

export function BannedScreen() {
  const { signOut } = useAuth();

  return (
    <ScreenContainer style={styles.container}>
      <Text style={styles.title}>Account restricted</Text>
      <View style={styles.spacer} />
      <Text style={styles.body}>
        Your account has been restricted from matching and messaging. If you think this is a mistake,
        contact support.
      </Text>
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
});
