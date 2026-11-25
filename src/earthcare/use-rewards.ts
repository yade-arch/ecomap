// Rewards catalogue from the database (table public.rewards).
import { useCallback, useEffect, useState } from 'react';

import { fetchRewards } from './api';
import { ecErrorText } from './strings';
import type { Reward } from './types';

export function useRewards() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNow = useCallback(async () => {
    try {
      setRewards(await fetchRewards());
      setError(null);
    } catch (e) {
      setError(ecErrorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    await fetchNow();
  }, [fetchNow]);

  useEffect(() => {
    let active = true;
    fetchRewards()
      .then((rows) => {
        if (!active) return;
        setRewards(rows);
        setError(null);
      })
      .catch((e: unknown) => active && setError(ecErrorText(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { rewards, loading, error, reload };
}
