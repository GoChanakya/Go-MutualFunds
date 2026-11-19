"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@/lib/users/me-types";

// Current user (phone sign-in, plan, today's usage). null = not signed in, undefined = still loading.
export function useMe() {
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/me", { cache: "no-store" });
    setMe(res.ok ? ((await res.json()) as MeResponse) : null);
  }, []);

  useEffect(() => {
    refresh().catch(() => setMe(null));
  }, [refresh]);

  const signIn = useCallback(async (phone: string, consent: boolean): Promise<string | null> => {
    const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, consent }) });
    const data = await res.json();
    if (!res.ok) return data.error ?? "Could not sign in";
    setMe(data as MeResponse);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" });
    setMe(null);
  }, []);

  return { me, setMe, refresh, signIn, signOut };
}
