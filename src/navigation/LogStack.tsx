import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LogScreen } from '../screens/LogScreen';
import { WorkoutSessionScreen } from '../screens/WorkoutSessionScreen';
import { PlanBrowseScreen } from '../screens/PlanBrowseScreen';
import type { PlanSessionLiftTarget, PlanSessionRunTarget } from '../types/models';

// planSession, when present, is how "today's session" on Home hands off
// into these screens: which user_plan_sessions row to link back to
// (completedAt/workoutId/runId) once the workout/run is actually saved,
// plus the target to pre-fill the form with.
export type LogStackParamList = {
  LogList: { runPlanSession?: { userPlanSessionId: string; title: string; target: PlanSessionRunTarget } } | undefined;
  WorkoutSession: {
    workoutId: string | null;
    planSession?: { userPlanSessionId: string; title: string; target: PlanSessionLiftTarget };
  };
  PlanBrowse: undefined;
};

const Stack = createNativeStackNavigator<LogStackParamList>();

export function LogStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="LogList" component={LogScreen} />
      <Stack.Screen name="WorkoutSession" component={WorkoutSessionScreen} />
      <Stack.Screen name="PlanBrowse" component={PlanBrowseScreen} />
    </Stack.Navigator>
  );
}
