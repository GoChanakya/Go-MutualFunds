"use client";

import { useEffect, useRef, useState } from "react";
import type { MeResponse } from "@/lib/users/me-types";
import { confirmOtp, requestOtp } from "./useMe";

// WhatsApp OTP sign-in dialog: mobile number -> 6-digit code.
export function AuthModal({ reason, onClose, onSignedIn }: { reason?: string; onClose: () => void; onSignedIn: (me: MeResponse) => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => {
    if (step === "otp") otpRef.current?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const digits = phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");

  async function send() {
    setBusy(true);
    setErr(null);
    const e = await requestOtp(digits);
    setBusy(false);
    if (e) return setErr(e);
    setStep("otp");
    setWait(30);
  }

  async function verify() {
    setBusy(true);
    setErr(null);
    const r = await confirmOtp(digits, otp);
    setBusy(false);
    if (r.error || !r.me) return setErr(r.error ?? "Could not verify the OTP.");
    onSignedIn(r.me);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-x ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <span className="eyebrow">GoMutualFunds</span>
        <h2 id="auth-title">{step === "phone" ? "Continue with WhatsApp" : "Enter the code"}</h2>
        {reason && step === "phone" && <p className="modal-reason">{reason}</p>}

        {step === "phone" ? (
          <form
            className="signin"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="composer">
              <span className="sub">+91</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" inputMode="numeric" autoComplete="tel-national" maxLength={14} autoFocus />
            </div>
            <label className="consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I agree that GoChanakya stores my mobile number and usage to run my account. Answers are for information only, not investment advice.</span>
            </label>
            {err && <p className="error">{err}</p>}
            <button className="primary" type="submit" disabled={busy || !consent || !/^[6-9]\d{9}$/.test(digits)}>
              {busy ? "Sending…" : "Send OTP on WhatsApp"}
            </button>
          </form>
        ) : (
          <form
            className="signin"
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <p className="sub">
              Sent on WhatsApp to +91 {digits.slice(0, 5)} {digits.slice(5)}.{" "}
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setErr(null);
                }}
              >
                Change number
              </button>
            </p>
            <div className="composer">
              <input
                ref={otpRef}
                className="otp-input"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </div>
            {err && <p className="error">{err}</p>}
            <button className="primary" type="submit" disabled={busy || otp.length !== 6}>
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
            <button type="button" className="ghost resend" disabled={wait > 0 || busy} onClick={send}>
              {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// Shown when the free questions are used up. Payments come in phase 2; until then, collect interest from verified users.
export function ProCard({ me, onSignIn, onInterested }: { me: MeResponse | undefined; onSignIn: () => void; onInterested: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(Boolean(me?.pro_interest));
  return (
    <div className="pro-card">
      <div className="pro-top">
        <div>
          <span className="eyebrow">GoMutualFunds Pro</span>
          <div className="pro-price">
            ₹400<small>/month</small>
          </div>
        </div>
        <span className="soon">Launching soon</span>
      </div>
      <p>You&apos;ve used your 10 free questions. Pro includes:</p>
      <ul className="pro-list">
        <li>200 questions a day</li>
        <li>Every fund in the screener, with all data points</li>
        <li>Full analysis, sector allocation and portfolio overlap</li>
      </ul>
      {!me?.signed_in ? (
        <button className="primary" onClick={onSignIn}>
          Sign in with WhatsApp
        </button>
      ) : done ? (
        <p className="pro-done">You&apos;re on the list. We&apos;ll message you on WhatsApp when Pro opens.</p>
      ) : (
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await fetch("/api/pro-interest", { method: "POST" });
            setBusy(false);
            if (r.ok) {
              setDone(true);
              onInterested();
            }
          }}
        >
          {busy ? "Saving…" : "Notify me when Pro launches"}
        </button>
      )}
    </div>
  );
}
