import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { supabase } from '../lib/supabase';
import { useMeStatus } from './me-status-context';
import { PhoneVerifyScreen } from '../screens/onboarding/PhoneVerifyScreen';
import { SportSelectScreen } from '../screens/onboarding/SportSelectScreen';
import { ProfileSetupScreen } from '../screens/onboarding/ProfileSetupScreen';
import { HomeLocationScreen } from '../screens/onboarding/HomeLocationScreen';

export type OnboardingStackParamList = {
  PhoneVerify: undefined;
  SportSelect: undefined;
  ProfileSetup: undefined;
  HomeLocation: undefined;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

// Onboarding has no persisted "current step" -- each mount figures out
// where to resume by checking what's actually been done, so it's safe
// regardless of which step a user last got through.
export function OnboardingNavigator() {
  const { status } = useMeStatus();
  const [initialRouteName, setInitialRouteName] = useState<keyof OnboardingStackParamList | null>(null);

  useEffect(() => {
    async function determineStart() {
      if (!status?.phoneVerified) {
        setInitialRouteName('PhoneVerify');
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [profileRes, userSportsRes] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
        supabase.from('user_sports').select('sport_id').eq('user_id', user.id),
      ]);

      if (!userSportsRes.data || userSportsRes.data.length === 0) {
        setInitialRouteName('SportSelect');
        return;
      }
      if (!profileRes.data?.display_name) {
        setInitialRouteName('ProfileSetup');
        return;
      }
      setInitialRouteName('HomeLocation');
    }
    determineStart();
  }, [status?.phoneVerified]);

  if (!initialRouteName) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRouteName}>
      <Stack.Screen name="PhoneVerify" component={PhoneVerifyScreen} />
      <Stack.Screen name="SportSelect" component={SportSelectScreen} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
      <Stack.Screen name="HomeLocation" component={HomeLocationScreen} />
    </Stack.Navigator>
  );
}
