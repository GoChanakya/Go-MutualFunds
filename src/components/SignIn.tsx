"use client";

import { useState } from "react";

// Phone step (no OTP yet). The number identifies the account for limits, plan and history.
export function SignIn({ onSignIn }: { onSignIn: (phone: string, consent: boolean) => Promise<string | null> }) {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="empty">
      <h1>Sign in to continue</h1>
      <form
        className="signin"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(await onSignIn(phone, consent));
          setBusy(false);
        }}
      >
        <div className="composer">
          <span className="sub">+91</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" inputMode="numeric" maxLength={14} autoFocus />
        </div>
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree that GoChanakya stores my mobile number and usage to run my account. Answers are for
          information only, not investment advice.
        </label>
        {err && <p className="error">{err}</p>}
        <button className="primary" type="submit" disabled={busy || !consent || phone.replace(/\D/g, "").length < 10}>
          Continue
        </button>
        <p className="sub">Free: 10 questions a day and top-3 screener results.</p>
      </form>
    </div>
  );
}
