import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LogScreen } from '../screens/LogScreen';
import { WorkoutSessionScreen } from '../screens/WorkoutSessionScreen';
import { PlanBrowseScreen } from '../screens/PlanBrowseScreen';
import type { PlanSessionLiftTarget, PlanSessionRunTarget } from '../types/models';

// planSession/dailySession, when present, are how "today's session" and
// the opt-in "session of the day" on Home hand off into these screens.
// planSession links back to a user_plan_sessions row on Done
// (completedAt/workoutId/runId); dailySession just tags the resulting
// workout/run with daily_session_id at save time -- no separate
// completion row to update, since "did I do it" is inferred from that
// FK existing (see .claude.roadmap.phase2.md §8).
export type LogStackParamList = {
  LogList:
    | {
        runPlanSession?: { userPlanSessionId: string; title: string; target: PlanSessionRunTarget };
        runDailySession?: { dailySessionId: string; title: string; target: PlanSessionRunTarget };
      }
    | undefined;
  WorkoutSession: {
    workoutId: string | null;
    planSession?: { userPlanSessionId: string; title: string; target: PlanSessionLiftTarget };
    dailySession?: { dailySessionId: string; title: string; target: PlanSessionLiftTarget };
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
