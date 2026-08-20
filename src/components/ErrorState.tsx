import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { Button } from './Button';
import { theme } from '../theme';

type Props = {
  title?: string;
  message: string;
  onRetry: () => void;
};

export function ErrorState({ title = "Couldn't load this", message, onRetry }: Props) {
  return (
    <ScreenContainer style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.spacer} />
      <Text style={styles.body}>{message}</Text>
      <View style={styles.spacer} />
      <Button label="Retry" onPress={onRetry} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  title: {
    fontSize: theme.typography.size.xl,
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
