import { formatPace, formatTimestamp } from './format';
import { summarizeWorkout } from '../types/models';
import type { PersonalRecord, Run, Workout } from '../types/models';

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

// Home's followed-users feed (.claude.roadmap.phase3.md §4) is composed
// from personal_records + runs, not workouts -- these are already
// "worth showing someone else" events by construction (a genuinely new
// best, a discrete summarizable run), unlike a raw multi-exercise
// session log. A sibling of ActivityItem/mergeActivity above, not a
// reuse of it, since the content types and the need for a userName are
// genuinely different.
export type FeedItem = {
  id: string;
  userId: string;
  userName: string;
  kind: 'pr' | 'run';
  createdAt: string;
  label: string;
  detail: string;
  timestamp: string;
};

export function personalRecordToFeedItem(pr: PersonalRecord, userName: string): FeedItem {
  return {
    id: pr.id,
    userId: pr.userId,
    userName,
    kind: 'pr',
    createdAt: pr.achievedAt,
    label: `New PR: ${pr.exerciseName}`,
    detail: `${pr.bestWeight}×${pr.bestReps} · ${Math.round(pr.best1RM)} 1RM`,
    timestamp: formatTimestamp(pr.achievedAt),
  };
}

export function runToFeedItem(run: Run, userName: string): FeedItem {
  return {
    id: run.id,
    userId: run.userId,
    userName,
    kind: 'run',
    createdAt: run.createdAt,
    label: `${run.distanceKm} km run`,
    detail: formatPace(run.paceSecondsPerKm),
    timestamp: formatTimestamp(run.createdAt),
  };
}

export function mergeFollowedActivity(
  personalRecords: PersonalRecord[],
  runs: Run[],
  namesByUserId: Record<string, string>,
): FeedItem[] {
  return [
    ...personalRecords.map((pr) => personalRecordToFeedItem(pr, namesByUserId[pr.userId] ?? '…')),
    ...runs.map((run) => runToFeedItem(run, namesByUserId[run.userId] ?? '…')),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
