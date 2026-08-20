import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LogScreen } from '../screens/LogScreen';
import { WorkoutSessionScreen } from '../screens/WorkoutSessionScreen';

export type LogStackParamList = {
  LogList: undefined;
  WorkoutSession: { workoutId: string | null };
};

const Stack = createNativeStackNavigator<LogStackParamList>();

export function LogStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="LogList" component={LogScreen} />
      <Stack.Screen name="WorkoutSession" component={WorkoutSessionScreen} />
    </Stack.Navigator>
  );
}
