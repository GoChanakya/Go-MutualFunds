"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MeResponse } from "@/lib/users/me-types";
import { LogoMark } from "./ui";

// No usage counts here: limits are enforced on the server and the UI only reacts when one is reached.
// Without handlers (legal pages) the account area is hidden.
export function Header({ me, onSignIn, onSignOut }: { me: MeResponse | undefined; onSignIn?: () => void; onSignOut?: () => void }) {
  const path = usePathname();
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <LogoMark />
        <span>
          Go<b>MutualFunds</b>
        </span>
      </Link>
      <nav className="tabs" aria-label="Sections">
        <Link href="/" className={path === "/" ? "active" : ""}>
          Ask
        </Link>
        <Link href="/screener" className={path?.startsWith("/screener") ? "active" : ""}>
          Screener
        </Link>
      </nav>
      {me && onSignIn && onSignOut && (
        <div className="account">
          {me.signed_in ? (
            <>
              {me.plan === "pro" && <span className="plan pro">Pro</span>}
              <span className="usage hide-sm">{me.phone}</span>
              <button className="ghost" onClick={onSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <button className="textbtn strong" onClick={onSignIn}>
              Sign in
            </button>
          )}
        </div>
      )}
    </header>
  );
}

// Screener: free users see the top results only.
export function Upgrade({ text }: { text: string }) {
  return (
    <div className="upgrade">
      <div>
        <b>{text}</b>
        <p>Pro (₹400/month) unlocks every fund, every data point, sector allocation and 200 questions a day.</p>
      </div>
      <span className="soon">Launching soon</span>
    </div>
  );
}
