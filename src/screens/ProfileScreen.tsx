import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { theme } from '../theme';
import { useAuth } from '../navigation/auth-context';

export function ProfileScreen() {
  const { signOut } = useAuth();

  return (
    <ScreenContainer>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.spacer} />
      <Button label="Sign Out" variant="secondary" onPress={signOut} />
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
});
