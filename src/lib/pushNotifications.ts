import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Best-effort, called once per app session (see AppTabs) after a user
// reaches the main app. Never blocks or surfaces an error to the user --
// a failed registration just means no daily nudge for them, not a
// broken app. Silently no-ops on a simulator/emulator (no push
// capability there) since getExpoPushTokenAsync rejects in that case.
export async function registerForPushNotifications(): Promise<void> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let status = existingStatus;
    if (status !== 'granted') {
      const { status: requestedStatus } = await Notifications.requestPermissionsAsync();
      status = requestedStatus;
    }
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('profiles').update({ expo_push_token: token }).eq('id', user.id);
  } catch {
    // Simulators, denied permissions mid-flow, transient network issues --
    // none of these should be user-visible failures for a nice-to-have.
  }
}
