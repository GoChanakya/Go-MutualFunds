"use client";

import { useEffect, useRef, useState } from "react";
import { Blocks } from "@/components/Blocks";
import type { Block, ChatContext, ChatResponse } from "@/lib/types";

type Msg = { role: "user"; text: string } | { role: "bot"; blocks: Block[] } | { role: "error"; text: string };

const STARTERS = ["Best small cap funds", "Best passive funds", "Compare Parag Parikh Flexi Cap vs HDFC Flexi Cap", "Where are fund managers moving money?"];

function sessionId(): string {
  try {
    let id = localStorage.getItem("mf_session");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("mf_session", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

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
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ctx, setCtx] = useState<ChatContext>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

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
        body: JSON.stringify({ message, session_id: sessionId(), context: ctx }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Request failed");
      setCtx(data.context);
      setAsOf(data.meta.as_of);
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

  if (!msgs.length)
    return (
      <div className="app">
        <div className="topbar">GoMutualFunds</div>
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
      <div className="topbar">GoMutualFunds</div>
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
