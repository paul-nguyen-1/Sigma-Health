export interface Exercise {
  id: string;
  name: string;
  muscleGroups: string[];
  instructionalUrl: string | null;
}

export interface Workout {
  id: string;
  userId: string;
  startedAt: string;
  notes: string | null;
}

export interface WorkoutSet {
  id: string;
  workoutId: string;
  exerciseId: string;
  reps: number;
  weight: number;
  createdAt: string;
}
