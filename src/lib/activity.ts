import { formatPace, formatTimestamp } from './format';
import { summarizeWorkout } from '../types/models';
import type { Run, Workout } from '../types/models';

export type ActivityItem = {
  id: string;
  kind: 'lift' | 'run';
  createdAt: string;
  label: string;
  detail: string;
  timestamp: string;
};

export function workoutToActivityItem(workout: Workout): ActivityItem {
  return {
    id: workout.id,
    kind: 'lift',
    createdAt: workout.startedAt,
    label: workout.title,
    detail: summarizeWorkout(workout.exercises),
    timestamp: formatTimestamp(workout.startedAt),
  };
}

export function runToActivityItem(run: Run): ActivityItem {
  return {
    id: run.id,
    kind: 'run',
    createdAt: run.createdAt,
    label: `${run.distanceKm} km`,
    detail: formatPace(run.paceSecondsPerKm),
    timestamp: formatTimestamp(run.createdAt),
  };
}

// Merges workouts + run history into one feed sorted newest-first -- the
// "All" filter option wherever both are shown together (Home, Profile).
export function mergeActivity(workouts: Workout[], runs: Run[]): ActivityItem[] {
  return [...workouts.map(workoutToActivityItem), ...runs.map(runToActivityItem)].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}
