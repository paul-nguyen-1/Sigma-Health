import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ProfileScreen } from '../screens/ProfileScreen';
import { OtherProfileScreen } from '../screens/profile/OtherProfileScreen';
import { FollowListScreen } from '../screens/profile/FollowListScreen';

export type ProfileStackParamList = {
  MyProfile: undefined;
  OtherProfile: { userId: string };
  FollowList: { userId: string; mode: 'followers' | 'following'; title: string };
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MyProfile" component={ProfileScreen} />
      <Stack.Screen name="OtherProfile" component={OtherProfileScreen} />
      <Stack.Screen name="FollowList" component={FollowListScreen} />
    </Stack.Navigator>
  );
}
