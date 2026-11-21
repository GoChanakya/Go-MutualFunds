"use client";

import { useEffect, useRef, useState } from "react";
import { Blocks } from "@/components/Blocks";
import { Header, Upgrade } from "@/components/Header";
import { SignIn } from "@/components/SignIn";
import { Arrow, LogoMark } from "@/components/ui";
import { useMe } from "@/components/useMe";
import type { Block, ChatContext, ChatResponse } from "@/lib/types";

type Msg = { role: "user"; text: string } | { role: "bot"; blocks: Block[] } | { role: "error"; text: string } | { role: "limit"; text: string };

const STARTERS: { title: string; sub: string; q: string }[] = [
  { title: "Best small cap funds", sub: "Ranked by our 5-pillar score", q: "Best small cap funds" },
  { title: "Compare two funds", sub: "Scores, returns and sector overlap", q: "Compare Parag Parikh Flexi Cap vs HDFC Flexi Cap" },
  { title: "Where does a fund invest?", sub: "Sector allocation of HDFC Flexi Cap", q: "Where does HDFC Flexi Cap invest?" },
  { title: "Funds heavy on IT", sub: "Most technology exposure", q: "Funds with most IT exposure" },
  { title: "Last month's return", sub: "Parag Parikh Flexi Cap vs its category", q: "Last month return of Parag Parikh Flexi Cap" },
];

function Composer({ value, onChange, onSend, busy, left }: { value: string; onChange: (v: string) => void; onSend: () => void; busy: boolean; left: number | null }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);
  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask about any mutual fund…"
          maxLength={500}
          autoFocus
        />
        <button className="send" type="submit" disabled={busy || !value.trim() || left === 0} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
      {left !== null && left <= 3 && <div className="left-note">{left === 0 ? "No questions left today." : `${left} question${left === 1 ? "" : "s"} left today.`}</div>}
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
  const lastQuestion = useRef<HTMLDivElement>(null);

  // While waiting: follow the bottom so the "reading" indicator is visible.
  // When an answer arrives: bring the question + start of the answer to the top, so you read it from the beginning.
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (last && last.role !== "user" && !busy) lastQuestion.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  const lastUserIndex = msgs.map((m) => m.role).lastIndexOf("user");

  // Arriving from the screener ("Ask about this fund", "Compare"): /?q=<question>
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
      Answers use GoChanakya data{asOf ? ` as of ${asOf}` : ""}. For information only, not investment advice.
    </div>
  );
  const left = me ? Math.max(0, me.limits.chat - me.used.chat) : null;
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
        <div className="hero">
          <div className="hero-inner">
            <span className="eyebrow">GoChanakya · Fund intelligence</span>
            <h1>
              Mutual funds,
              <br />
              read by the numbers.
            </h1>
            <p className="lead">Ask about any Indian mutual fund. Every answer is built from our data: resilience, consistency, momentum, returns and track record.</p>
            <Composer value={input} onChange={setInput} onSend={() => send(input)} busy={busy} left={left} />
            <ol className="prompts">
              {STARTERS.map((s, k) => (
                <li key={s.q}>
                  <button onClick={() => send(s.q)}>
                    <span className="idx">{String(k + 1).padStart(2, "0")}</span>
                    <span className="p-text">
                      <b>{s.title}</b>
                      <span>{s.sub}</span>
                    </span>
                    <Arrow />
                  </button>
                </li>
              ))}
            </ol>
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
              <div key={i} className="user" ref={i === lastUserIndex ? lastQuestion : undefined}>
                {m.text}
              </div>
            ) : (
              <div key={i} className="bot-row">
                <LogoMark size={28} />
                <div className={`bot${m.role === "error" ? " error" : ""}`}>
                  {m.role === "bot" ? (
                    // follow-up suggestions only under the latest answer
                    <Blocks blocks={m.blocks} onAsk={send} showFollowups={i === lastBot && !busy} />
                  ) : m.role === "limit" ? (
                    <Upgrade text={`${m.text} Come back tomorrow, or upgrade to Pro.`} />
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className="bot-row">
              <LogoMark size={28} />
              <div className="thinking">
                <span className="scan" aria-hidden />
                Reading the data
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <Composer value={input} onChange={setInput} onSend={() => send(input)} busy={busy} left={left} />
      {disclaimer}
    </div>
  );
}
