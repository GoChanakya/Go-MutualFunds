"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MeResponse } from "@/lib/users/me-types";

export function Header({ me, onSignOut, usageKind = "chat" }: { me: MeResponse | null | undefined; onSignOut: () => void; usageKind?: "chat" | "screener" }) {
  const path = usePathname();
  const left = me ? Math.max(0, me.limits[usageKind] - me.used[usageKind]) : null;
  return (
    <header className="topbar">
      <div className="brand">GoMutualFunds</div>
      <nav className="tabs">
        <Link href="/" className={path === "/" ? "active" : ""}>
          Chat
        </Link>
        <Link href="/screener" className={path?.startsWith("/screener") ? "active" : ""}>
          Screener
        </Link>
      </nav>
      {me && (
        <div className="account">
          <span className={`plan ${me.plan}`}>{me.plan === "pro" ? "Pro" : "Free"}</span>
          <span className="sub hide-sm">
            {left} {usageKind === "chat" ? "questions" : "searches"} left today
          </span>
          <button className="link sub" onClick={onSignOut} title={`Signed in as ${me.phone}`}>
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
      <b>{text}</b>
      <span className="sub"> Pro gives every fund, every data point, sector allocation and 200 questions a day. Paid plans are coming soon.</span>
    </div>
  );
}
