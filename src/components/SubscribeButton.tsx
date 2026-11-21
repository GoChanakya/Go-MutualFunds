"use client";

import { useState } from "react";
import Link from "next/link";
import type { MeResponse } from "@/lib/users/me-types";

type CheckoutResult = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type Checkout = new (options: Record<string, unknown>) => { open: () => void };

async function loadCheckout(): Promise<Checkout> {
  const existing = (window as Window & { Razorpay?: Checkout }).Razorpay;
  if (existing) return existing;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay Checkout."));
    document.head.appendChild(script);
  });
  const loaded = (window as Window & { Razorpay?: Checkout }).Razorpay;
  if (!loaded) throw new Error("Could not load Razorpay Checkout.");
  return loaded;
}

export function SubscribeButton({ me, onSignIn, onUpgraded }: { me: MeResponse | undefined; onSignIn: () => void; onUpgraded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    if (!me?.signed_in) return onSignIn();
    setBusy(true);
    setMessage(null);
    try {
      const Checkout = await loadCheckout();
      const res = await fetch("/api/billing/subscribe", { method: "POST" });
      const data = (await res.json()) as { subscription_id?: string; key?: string; contact?: string; error?: string };
      if (!res.ok || !data.subscription_id || !data.key) throw new Error(data.error ?? "Could not start checkout.");
      const checkout = new Checkout({
        key: data.key,
        subscription_id: data.subscription_id,
        name: "GoMutualFunds",
        description: "Pro · ₹400 per month",
        prefill: { contact: data.contact },
        handler: async (result: CheckoutResult) => {
          try {
            const verified = await fetch("/api/billing/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
            const body = (await verified.json()) as { me?: MeResponse; error?: string };
            if (!verified.ok) throw new Error(body.error ?? "Payment is being verified.");
            onUpgraded();
            setMessage(body.me?.plan === "pro" ? "Pro is active on your account." : "Payment received. Pro will activate after confirmation.");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Payment is being verified. Please refresh shortly.");
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.open();
    } catch (e) {
      setBusy(false);
      setMessage(e instanceof Error ? e.message : "Could not start checkout.");
    }
  }

  if (me?.plan === "pro") return <p className="pro-done">Your Pro plan is active.</p>;
  return (
    <>
      <button className="primary" disabled={busy} onClick={start}>{busy ? "Opening checkout…" : me?.signed_in ? "Subscribe to Pro" : "Sign in with WhatsApp"}</button>
      <p className="sub">₹400 billed monthly until cancelled. <Link href="/refund-policy">Cancellation and refunds</Link>.</p>
      {message && <p className="sub" role="status">{message}</p>}
    </>
  );
}
