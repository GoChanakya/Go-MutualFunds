"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MeResponse } from "@/lib/users/me-types";
import { LogoMark } from "./ui";

export function Header({ me, onSignOut, usageKind = "chat" }: { me: MeResponse | null | undefined; onSignOut: () => void; usageKind?: "chat" | "screener" }) {
  const path = usePathname();
  const left = me ? Math.max(0, me.limits[usageKind] - me.used[usageKind]) : null;
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
      {me && (
        <div className="account">
          <span className={`plan ${me.plan}`}>{me.plan === "pro" ? "Pro" : "Free"}</span>
          <span className="usage hide-sm" title={`${me.used[usageKind]} used of ${me.limits[usageKind]} today`}>
            {left} {usageKind === "chat" ? "questions" : "searches"} left
          </span>
          <button className="ghost" onClick={onSignOut} title={`Signed in as ${me.phone}`}>
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}

export function Upgrade({ text }: { text: string }) {
  return (
    <div className="upgrade">
      <div>
        <b>{text}</b>
        <p>Pro unlocks every fund, every data point, sector allocation and 200 questions a day.</p>
      </div>
      <span className="soon">Pro plans coming soon</span>
    </div>
  );
}
