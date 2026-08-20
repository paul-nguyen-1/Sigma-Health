import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

type MeStatus = {
  profileComplete: boolean;
  phoneVerified: boolean;
  banned: boolean;
};

type MeResponse = {
  user_id: string;
  profile_complete: boolean;
  phone_verified: boolean;
  banned: boolean;
};

type MeStatusContextValue = {
  status: MeStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const MeStatusContext = createContext<MeStatusContextValue | undefined>(undefined);

export function useMeStatus() {
  const ctx = useContext(MeStatusContext);
  if (!ctx) {
    throw new Error('useMeStatus must be used within MeStatusProvider');
  }
  return ctx;
}

export function MeStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<MeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const data: MeResponse = await api.get('/me');
      setStatus({
        profileComplete: data.profile_complete,
        phoneVerified: data.phone_verified,
        banned: data.banned,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account status');
    }
  }

  useEffect(() => {
    api
      .get('/me')
      .then((data: MeResponse) => {
        setStatus({
          profileComplete: data.profile_complete,
          phoneVerified: data.phone_verified,
          banned: data.banned,
        });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load account status');
      })
      .finally(() => setIsLoading(false));
  }, []);

  const value = useMemo<MeStatusContextValue>(
    () => ({ status, isLoading, error, refresh }),
    [status, isLoading, error],
  );

  return <MeStatusContext.Provider value={value}>{children}</MeStatusContext.Provider>;
}
