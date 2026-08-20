import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider, useAuth } from './auth-context';
import { MeStatusProvider, useMeStatus } from './me-status-context';
import { AuthNavigator } from './AuthNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';
import { AppTabs } from './AppTabs';
import { BannedScreen } from '../screens/BannedScreen';
import { ScreenContainer } from '../components/ScreenContainer';
import { ErrorState } from '../components/ErrorState';

function SignedInRouter() {
  const { status, isLoading, error, refresh } = useMeStatus();
  if (error) {
    return <ErrorState title="Couldn't load your account" message={error} onRetry={refresh} />;
  }
  if (isLoading || !status) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }
  if (status.banned) {
    return <BannedScreen />;
  }
  if (!status.phoneVerified || !status.profileComplete) {
    return <OnboardingNavigator />;
  }
  return <AppTabs />;
}

function Navigator() {
  const { isSignedIn, isLoading } = useAuth();
  if (isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }
  return (
    <NavigationContainer>
      {isSignedIn ? (
        <MeStatusProvider>
          <SignedInRouter />
        </MeStatusProvider>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}

export function RootNavigator() {
  return (
    <AuthProvider>
      <Navigator />
    </AuthProvider>
  );
}
