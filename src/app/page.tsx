"use client";

import { useEffect, useRef, useState } from "react";
import { Blocks } from "@/components/Blocks";
import { Header, Upgrade } from "@/components/Header";
import { SignIn } from "@/components/SignIn";
import { useMe } from "@/components/useMe";
import type { Block, ChatContext, ChatResponse } from "@/lib/types";

type Msg = { role: "user"; text: string } | { role: "bot"; blocks: Block[] } | { role: "error"; text: string } | { role: "limit"; text: string };

const STARTERS = ["Best small cap funds", "Best passive funds", "Compare Parag Parikh Flexi Cap vs HDFC Flexi Cap", "Where are fund managers moving money?"];


function Composer({ value, onChange, onSend, busy }: { value: string; onChange: (v: string) => void; onSend: () => void; busy: boolean }) {
  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ask about any mutual fund" maxLength={500} autoFocus />
        <button className="send" type="submit" disabled={busy || !value.trim()} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  const { me, setMe, signIn, signOut } = useMe();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ctx, setCtx] = useState<ChatContext>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  // Arriving from the screener's "Ask about this fund": /?q=<question>
  const asked = useRef(false);
  useEffect(() => {
    if (!me || asked.current) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      asked.current = true;
      window.history.replaceState(null, "", "/");
      send(q.slice(0, 500));
    }
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, context: ctx }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string; message?: string };
      if (res.status === 401) return setMe(null);
      if (data.error === "limit_reached") {
        setMsgs((m) => [...m, { role: "limit", text: data.message ?? "Daily limit reached." }]);
        if (me) setMe({ ...me, used: { ...me.used, chat: me.limits.chat } });
        return;
      }
      if (!res.ok || data.error) throw new Error(data.error ?? "Request failed");
      setCtx(data.context);
      setAsOf(data.meta.as_of);
      if (me) setMe({ ...me, plan: data.meta.plan, used: { ...me.used, chat: data.meta.usage.used }, limits: { ...me.limits, chat: data.meta.usage.limit } });
      setMsgs((m) => [...m, { role: "bot", blocks: data.blocks }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "error", text: e instanceof Error ? e.message : "Something went wrong" }]);
    } finally {
      setBusy(false);
    }
  }

  const disclaimer = (
    <div className="disclaimer">
      Answers use GoChanakya data{asOf ? ` as of ${asOf}` : ""}. Not investment advice.
    </div>
  );

  const header = <Header me={me} onSignOut={signOut} />;
  if (me === undefined) return <div className="app">{header}</div>;
  if (me === null)
    return (
      <div className="app">
        {header}
        <SignIn onSignIn={signIn} />
        {disclaimer}
      </div>
    );

  if (!msgs.length)
    return (
      <div className="app">
        {header}
        <div className="empty">
          <h1>What can I help you find?</h1>
          <Composer value={input} onChange={setInput} onSend={() => send(input)} busy={busy} />
          <div className="starters">
            {STARTERS.map((s) => (
              <button key={s} className="pill" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        {disclaimer}
      </div>
    );

  const lastBot = msgs.map((m) => m.role).lastIndexOf("bot");

  return (
    <div className="app">
      {header}
      <div className="scroll">
        <div className="thread">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="user">
                {m.text}
              </div>
            ) : m.role === "bot" ? (
              <div key={i} className="bot">
                {/* follow-up suggestions only under the latest answer */}
                <Blocks blocks={m.blocks} onAsk={send} showFollowups={i === lastBot && !busy} />
              </div>
            ) : m.role === "limit" ? (
              <div key={i} className="bot">
                <Upgrade text={`${m.text} Come back tomorrow, or upgrade to Pro.`} />
              </div>
            ) : (
              <div key={i} className="bot error">
                {m.text}
              </div>
            ),
          )}
          {busy && (
            <div className="dots" aria-label="Thinking">
              <i />
              <i />
              <i />
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <Composer value={input} onChange={setInput} onSend={() => send(input)} busy={busy} />
      {disclaimer}
    </div>
  );
}
