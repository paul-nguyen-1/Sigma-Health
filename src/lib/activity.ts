import { formatPace } from './format';
import type { PersonalRecord, Run } from '../types/models';

export type ActivityItem = {
  id: string;
  kind: 'lift' | 'run';
  createdAt: string;
  label: string;
  detail: string;
};

export function prToActivityItem(pr: PersonalRecord): ActivityItem {
  return {
    id: pr.id,
    kind: 'lift',
    createdAt: pr.createdAt,
    label: pr.liftName,
    detail: `${pr.weight} x ${pr.reps} · 1RM ${Math.round(pr.calculated1rm)}`,
  };
}

export function runToActivityItem(run: Run): ActivityItem {
  return {
    id: run.id,
    kind: 'run',
    createdAt: run.createdAt,
    label: `${run.distanceKm} km`,
    detail: formatPace(run.paceSecondsPerKm),
  };
}

// Merges lift + run history into one feed sorted newest-first -- the "All"
// filter option wherever both are shown together (Home, Profile).
export function mergeActivity(prs: PersonalRecord[], runs: Run[]): ActivityItem[] {
  return [...prs.map(prToActivityItem), ...runs.map(runToActivityItem)].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}
