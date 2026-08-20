// Consecutive-day streak, computed client-side from existing data (no
// stored/cached count -- see .claude.roadmap.phase2.md §1). Counts
// backward from today; if today has no activity yet, that doesn't
// retroactively break yesterday's streak, it just means today hasn't
// extended it yet. A gap of a full day (nothing yesterday either) ends it.
export function calculateStreak(activityIsoDates: string[]): number {
  const days = new Set(activityIsoDates.map((iso) => new Date(iso).toDateString()));

  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(cursor.toDateString())) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export const STREAK_MILESTONES = [7, 30, 100];
