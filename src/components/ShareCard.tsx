import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

type Props = {
  eyebrow: string;
  headline: string;
  detail: string;
};

// Rendered visibly (not off-screen) so the user sees exactly what they're
// about to share before sharing it -- captured via react-native-view-shot
// from wherever this is mounted. collapsable={false} is required on
// Android or the native view gets optimized away and capture fails.
export const ShareCard = forwardRef<View, Props>(function ShareCard({ eyebrow, headline, detail }, ref) {
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Text style={styles.appName}>Sigma Health</Text>
      <View style={styles.spacer} />
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: 320,
    aspectRatio: 9 / 16,
    backgroundColor: theme.colors.primary,
    borderRadius: 16,
    padding: theme.spacing.lg,
    justifyContent: 'center',
    alignSelf: 'center',
  },
  appName: {
    position: 'absolute',
    top: theme.spacing.lg,
    left: theme.spacing.lg,
    fontSize: theme.typography.size.sm,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.primaryText,
    opacity: 0.8,
  },
  spacer: {
    height: theme.spacing.xl,
  },
  eyebrow: {
    fontSize: theme.typography.size.base,
    fontWeight: theme.typography.weight.semibold,
    color: theme.colors.primaryText,
    opacity: 0.85,
  },
  headline: {
    fontSize: theme.typography.size.xxl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.primaryText,
    marginTop: theme.spacing.sm,
  },
  detail: {
    fontSize: theme.typography.size.lg,
    color: theme.colors.primaryText,
    opacity: 0.9,
    marginTop: theme.spacing.xs,
  },
});
