import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { theme } from '../theme';

type Props = ViewProps & { children: React.ReactNode };

export function Card({ children, style, ...rest }: Props) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
});
