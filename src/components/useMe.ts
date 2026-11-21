"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@/lib/users/me-types";

// Current visitor/user. undefined = loading. Visitors get { signed_in: false }.
export function useMe() {
  const [me, setMe] = useState<MeResponse | undefined>(undefined);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (res.ok) setMe((await res.json()) as MeResponse);
  }, []);

  useEffect(() => {
    refresh().catch(() => setMe({ signed_in: false, phone: null, plan: "free", plan_expires_at: null, pro_interest: false }));
  }, [refresh]);

  const signOut = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" });
    await refresh();
  }, [refresh]);

  return { me, setMe, refresh, signOut };
}

// WhatsApp OTP calls. requestOtp returns an error message or null.
export async function requestOtp(phone: string): Promise<string | null> {
  const res = await fetch("/api/auth/send-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not send the OTP.";
}

export async function confirmOtp(phone: string, otp: string): Promise<{ me?: MeResponse; error?: string }> {
  const res = await fetch("/api/auth/verify-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, otp, consent: true }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { me: data as MeResponse } : { error: (data as { error?: string }).error ?? "Could not verify the OTP." };
}
