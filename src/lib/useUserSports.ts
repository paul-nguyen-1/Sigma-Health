import { useEffect, useState } from 'react';
import { supabase } from './supabase';

type UserSportsState = {
  isLoading: boolean;
  error: string | null;
  hasLifting: boolean;
  liftingSportId: string | null;
  hasRunning: boolean;
  runningSportId: string | null;
  retry: () => void;
};

const initialState = {
  isLoading: true,
  error: null,
  hasLifting: false,
  liftingSportId: null,
  hasRunning: false,
  runningSportId: null,
};

// Shared across HomeLocationScreen, LogScreen, and ProfileScreen -- each
// needs the same "which sport(s) is this user active in" lookup.
export function useUserSports(): UserSportsState {
  const [state, setState] = useState<Omit<UserSportsState, 'retry'>>(initialState);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(async ({ data: { user } }) => {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
        if (!user) return;

        const { data, error } = await supabase
          .from('user_sports')
          .select('sport_id, sports(slug)')
          .eq('user_id', user.id);

        if (error) {
          setState((prev) => ({ ...prev, isLoading: false, error: error.message }));
          return;
        }

        let lifting: string | null = null;
        let running: string | null = null;
        for (const row of data ?? []) {
          const slug = (row.sports as unknown as { slug: string } | null)?.slug;
          if (slug === 'lifting') lifting = row.sport_id as string;
          if (slug === 'running') running = row.sport_id as string;
        }

        setState({
          isLoading: false,
          error: null,
          hasLifting: !!lifting,
          liftingSportId: lifting,
          hasRunning: !!running,
          runningSportId: running,
        });
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load your sports',
        }));
      });
  }, [retryCount]);

  return { ...state, retry: () => setRetryCount((c) => c + 1) };
}
