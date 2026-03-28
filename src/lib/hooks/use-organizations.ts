'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Organization } from '@/types/database';

export function useOrganizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch('/api/organizations')
      .then((res) => res.json())
      .then(setOrganizations)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { organizations, loading, refresh };
}
