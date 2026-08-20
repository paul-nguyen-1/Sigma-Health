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

export interface PersonalRecord {
  id: string;
  userId: string;
  gymId: string | null;
  liftName: string;
  weight: number;
  reps: number;
  calculated1rm: number;
  createdAt: string;
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
