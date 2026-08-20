export interface Sport {
  id: string;
  slug: string;
  name: string;
}

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  homeGymId: string | null;
  homeParkId: string | null;
  phoneNumber: string | null;
  phoneVerifiedAt: string | null;
}

export interface Gym {
  id: string;
  sportId: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
}

export interface Park {
  id: string;
  sportId: string;
  name: string;
  lat: number;
  lng: number;
}

export interface CheckIn {
  id: string;
  userId: string;
  locationType: 'gym' | 'park';
  locationId: string;
  checkedInAt: string;
  expiresAt: string;
}

export interface WorkoutSet {
  weight: number;
  reps: number;
}

export interface WorkoutExercise {
  name: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  userId: string;
  gymId: string | null;
  title: string;
  exercises: WorkoutExercise[];
  startedAt: string;
  updatedAt: string;
}

export function summarizeWorkout(exercises: WorkoutExercise[]): string {
  const exerciseCount = exercises.length;
  const setCount = exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  return `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'} · ${setCount} set${setCount === 1 ? '' : 's'}`;
}

// Derived/authoritative, not user-editable -- maintained entirely by the
// sync_personal_records trigger off workouts.exercises (migration 0015).
export interface PersonalRecord {
  id: string;
  userId: string;
  exerciseName: string;
  bestWeight: number;
  bestReps: number;
  best1RM: number;
  workoutId: string | null;
  achievedAt: string;
}

export interface Run {
  id: string;
  userId: string;
  parkId: string | null;
  distanceKm: number;
  durationSeconds: number;
  paceSecondsPerKm: number;
  createdAt: string;
}
