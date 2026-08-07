import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { theme } from '../theme';
import { useAuth } from '../navigation/auth-context';
import type { AuthStackParamList } from '../navigation/AuthNavigator';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export function SignInScreen({ navigation }: Props) {
  const { signIn } = useAuth();

  return (
    <ScreenContainer style={styles.container}>
      <Text style={styles.title}>Sign In</Text>
      <View style={styles.spacer} />
      <Button label="Sign In" onPress={signIn} />
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
});
