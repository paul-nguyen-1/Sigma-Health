import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider, useAuth } from './auth-context';
import { AuthNavigator } from './AuthNavigator';
import { AppTabs } from './AppTabs';

function Navigator() {
  const { isSignedIn } = useAuth();
  return <NavigationContainer>{isSignedIn ? <AppTabs /> : <AuthNavigator />}</NavigationContainer>;
}

export function RootNavigator() {
  return (
    <AuthProvider>
      <Navigator />
    </AuthProvider>
  );
}
