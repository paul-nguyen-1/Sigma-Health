export function formatPace(paceSecondsPerKm: number): string {
  const totalSeconds = Math.round(paceSecondsPerKm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')} /km`;
}

// e.g. "Aug 19, 11:32 PM" -- shared date+time display for anything logged
// (workouts, runs), so History/Home/Profile all read the same format.
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timePart = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}
