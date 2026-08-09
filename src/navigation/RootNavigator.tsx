import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider, useAuth } from './auth-context';
import { AuthNavigator } from './AuthNavigator';
import { AppTabs } from './AppTabs';
import { ScreenContainer } from '../components/ScreenContainer';

function Navigator() {
  const { isSignedIn, isLoading } = useAuth();
  if (isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }
  return <NavigationContainer>{isSignedIn ? <AppTabs /> : <AuthNavigator />}</NavigationContainer>;
}

export function RootNavigator() {
  return (
    <AuthProvider>
      <Navigator />
    </AuthProvider>
  );
}
