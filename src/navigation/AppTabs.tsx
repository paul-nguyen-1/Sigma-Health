import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { LogStack } from './LogStack';
import type { LogStackParamList } from './LogStack';
import { CommunityStack } from './CommunityStack';
import type { CommunityStackParamList } from './CommunityStack';
import { ProfileScreen } from '../screens/ProfileScreen';
import { theme } from '../theme';
import { registerForPushNotifications } from '../lib/pushNotifications';

export type AppTabParamList = {
  Home: undefined;
  Log: NavigatorScreenParams<LogStackParamList> | undefined;
  Community: NavigatorScreenParams<CommunityStackParamList> | undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<AppTabParamList>();

const TAB_ICONS: Record<keyof AppTabParamList, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Log: { active: 'barbell', inactive: 'barbell-outline' },
  Community: { active: 'people', inactive: 'people-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

export function AppTabs() {
  // Once per app session, once the user has actually reached the main
  // app (past onboarding/ban checks) -- registering earlier would mean
  // asking for a permission before there's any context for why.
  useEffect(() => {
    registerForPushNotifications();
  }, []);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Log" component={LogStack} />
      <Tab.Screen name="Community" component={CommunityStack} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
