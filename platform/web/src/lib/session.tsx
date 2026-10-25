import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post } from './api';

export type User = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  emailVerified: boolean;
  roles: ('driver' | 'partner' | 'admin')[];
  partner: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' } | null;
  preferences: Record<string, unknown>;
};
export type PublicConfig = { demoMode: boolean; payments: { provider: string; live: boolean }; maps: { provider: string; browserKey: string } };
type Ctx = { user: User | null; config: PublicConfig | null; loading: boolean; refresh: () => Promise<User | null>; logout: () => Promise<void> };
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const r = await get<{ user: User | null; config: PublicConfig }>('/api/auth/me');
      setUser(r.user);
      setConfig(r.config);
      return r.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => {});
    setUser(null);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return <SessionCtx.Provider value={{ user, config, loading, refresh, logout }}>{children}</SessionCtx.Provider>;
}
export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('no session');
  return c;
}
