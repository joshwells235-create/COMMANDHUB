'use client';

import { useState, useEffect } from 'react';
import type { Organization } from '@/types/database';

export function useOrganizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/organizations')
      .then((res) => res.json())
      .then(setOrganizations)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { organizations, loading };
}
