"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SiteFooter } from "@/components/Footer";
import { Header } from "@/components/Header";
import { AuthModal } from "@/components/SignIn";
import { SubscribeButton } from "@/components/SubscribeButton";
import { Arrow } from "@/components/ui";
import { useMe } from "@/components/useMe";
import { PLANS, PRO_PRICE_INR, TRIAL_QUESTIONS } from "@/lib/config/plans";

// Landing page. The chat lives at /ask, the screener at /screener.
// Every claim here is true of the product today; the hero card is labelled as an example.

const EXAMPLES = [
  "Best small cap funds",
  "Compare Parag Parikh Flexi Cap vs HDFC Flexi Cap",
  "Which funds hold Reliance Industries?",
  "How did HDFC Flexi Cap do in the Covid crash?",
  "Funds with most IT exposure",
  "Last month return of Nippon India Small Cap",
];

const STATS = [
  ["2,000+", "mutual funds covered"],
  ["90+", "categories, compared like for like"],
  ["36", "months of history for every fund"],
  ["4", "market crashes tracked"],
  ["Daily", "data refresh"],
];

const STEPS = [
  ["Ask or filter", "Type a question in plain English, or narrow 2,000+ funds down in the screener."],
  ["We read the data", "Our engine pulls the fund's numbers and lines them up against every similar fund."],
  ["See the evidence", "Scores, charts and plain-English notes, with the real numbers behind every claim."],
];

const PILLARS: [string, string, number][] = [
  ["Resilience", "How hard it fell in past market crashes, and how quickly it recovered.", 82],
  ["Consistency", "How many months it beat similar funds. Steady beats lucky.", 74],
  ["Momentum", "Where it ranks among similar funds on recent returns, and which way it's moving.", 61],
  ["Returns", "1-year returns and what a ₹5,000 monthly SIP would have grown to.", 69],
  ["Track record", "How long the fund has been running and how much money it manages.", 90],
];

const FAQ = [
  {
    q: "Is this investment advice?",
    a: "No. GoMutualFunds shows data and our scores so you can understand funds better. It doesn't know your goals or risk appetite, so it doesn't tell you what to buy. Please consult a SEBI-registered investment adviser before investing.",
  },
  {
    q: "Where does the data come from?",
    a: "From AMFI India, RBI and official scheme factsheets and monthly portfolio disclosures. It's refreshed every day.",
  },
  {
    q: "How is the score calculated?",
    a: "Each fund is compared only with similar funds (its own category) on five things: resilience, consistency, momentum, returns and track record. Each part is scored 0–100, and the overall score combines them. 50 means the middle of its group.",
  },
  {
    q: "Do I need an account?",
    a: `No. You can ask ${TRIAL_QUESTIONS} questions free without signing in. After that, sign in with a one-time code on WhatsApp. There's no password to remember.`,
  },
  {
    q: "What does Pro include, and can I cancel?",
    a: `Pro is ₹${PRO_PRICE_INR} a month: up to ${PLANS.pro.chatPerDay} questions a day, every fund and data point in the screener, the full analysis for each fund, and complete holdings and overlap. Cancel any time. Refunds within 15 days, as per our refund policy.`,
  },
];

// ---- small illustrations (pure CSS/SVG, no images) ----

function ArtAsk() {
  return (
    <div className="art art-ask" aria-hidden>
      <span className="bub me">Best flexi cap funds?</span>
      <span className="bub bot">
        <i style={{ width: "78%" }} />
        <i style={{ width: "92%" }} />
        <i style={{ width: "54%" }} />
      </span>
    </div>
  );
}
function ArtScreen() {
  return (
    <div className="art art-screen" aria-hidden>
      {[38, 52, 46, 70, 88, 64].map((h, k) => (
        <i key={k} className={k === 4 ? "hot" : ""} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
function ArtCompare() {
  return (
    <div className="art art-compare" aria-hidden>
      <i className="a" />
      <i className="b" />
      <b>29%</b>
    </div>
  );
}
function ArtHoldings() {
  return (
    <div className="art art-hold" aria-hidden>
      {[92, 70, 58, 41].map((w, k) => (
        <span key={k}>
          <i style={{ width: `${w}%` }} />
        </span>
      ))}
    </div>
  );
}

const FEATURES = [
  { t: "Ask in plain English", d: "Any question about a fund, a category or a stock. Answers come from fund data, with the numbers shown.", href: "/ask", cta: "Ask a question", art: <ArtAsk /> },
  { t: "Screen 2,000+ funds", d: "Filter by category, size and age. Sort by our score, consistency, momentum or recovery speed.", href: "/screener", cta: "Open the screener", art: <ArtScreen /> },
  {
    t: "Compare and check overlap",
    d: "Two funds side by side, and how many of the same stocks and sectors they hold, so you don't buy the same thing twice.",
    href: "/ask?q=Compare%20Parag%20Parikh%20Flexi%20Cap%20vs%20HDFC%20Flexi%20Cap",
    cta: "Try a comparison",
    art: <ArtCompare />,
  },
  {
    t: "See what a fund owns",
    d: "Top holdings and sector mix from the latest monthly portfolio, and which funds hold a stock you care about.",
    href: "/ask?q=Which%20funds%20hold%20HDFC%20Bank%3F",
    cta: "Find funds by stock",
    art: <ArtHoldings />,
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function HeroStage() {
  const dots = [1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1];
  return (
    <div className="lp-stage" aria-label="Example of a fund view (illustrative numbers)">
      <div className="lp-preview">
        <div className="lp-prev-top">
          <div>
            <span className="lp-prev-tag">Example</span>
            <b>Sample Flexi Cap Fund</b>
            <span className="sub">Flexi Cap · ₹24,310 Cr · 11.2 yrs</span>
          </div>
          <div className="lp-prev-score">
            72<small>/100</small>
          </div>
        </div>
        <div className="lp-prev-sec">
          <div className="lp-prev-h">
            <span>Consistency</span>
            <em className="good">Very consistent</em>
          </div>
          <div className="lp-prev-big">
            9<small>/12</small> <span>months it beat similar funds</span>
          </div>
          <div className="fd-pills" style={{ gridTemplateColumns: "repeat(12, 1fr)" }}>
            {dots.map((d, k) => (
              <i key={k} className={d ? "on" : ""} />
            ))}
          </div>
        </div>
        <div className="lp-prev-sec lp-prev-row">
          <div>
            <span className="lp-prev-l">Rank among similar funds</span>
            <div className="lp-prev-big">
              #4<small> of 40</small>
            </div>
            <span className="pos">Up from #9 3 months ago</span>
          </div>
          <div>
            <span className="lp-prev-l">₹5,000/month SIP, 3 years</span>
            <div className="lp-prev-big">₹2,21,400</div>
            <span className="pos">+₹41,400 on ₹1,80,000</span>
          </div>
        </div>
      </div>
      <div className="lp-float f1">
        <span className="lp-prev-l">Stock overlap</span>
        <b>29%</b>
        <span className="sub">8 shared stocks</span>
        <div className="lp-mini-bars">
          <i style={{ width: "72%" }} />
          <i className="b" style={{ width: "48%" }} />
        </div>
      </div>
      <div className="lp-float f2">
        <span className="lp-prev-l">Covid-19 crash</span>
        <b className="neg">Fell 31.4%</b>
        <span className="pos">Recovered in 6 months</span>
      </div>
    </div>
  );
}

export default function Landing() {
  const router = useRouter();
  const { me, setMe, refresh, signOut } = useMe();
  const [authOpen, setAuthOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const ask = (text: string) => router.push(`/ask?q=${encodeURIComponent(text.trim().slice(0, 500))}`);

  // Fade sections in as they scroll into view. Content is visible without JS; the effect only starts after mount.
  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const items = [...el.querySelectorAll<HTMLElement>(".reveal")];
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((i) => {
      if (i.getBoundingClientRect().top < window.innerHeight) i.classList.add("in");
      else io.observe(i);
    });
    el.classList.add("reveal-on");
    return () => io.disconnect();
  }, []);

  return (
    <div className="lp" ref={root}>
      <Header me={me} onSignIn={() => setAuthOpen(true)} onSignOut={signOut} />

      <section className="lp-hero">
        <div className="lp-hero-bg" aria-hidden />
        <div className="lp-wrap lp-hero-grid">
          <div>
            <span className="lp-pill">
              <i /> Live fund data · updated daily
            </span>
            <h1>
              Mutual funds, <span className="lp-hl">read by the numbers.</span>
            </h1>
            <p className="lp-lead">
              Ask anything about Indian mutual funds. Every answer is built from real fund data and compared with similar funds, so you see how a
              fund really performs before you invest.
            </p>
            <form
              className="composer lp-ask"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) ask(q);
              }}
            >
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about any mutual fund…" maxLength={500} aria-label="Your question" />
              <button className="send" type="submit" disabled={!q.trim()} aria-label="Ask">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </form>
            <div className="lp-chips">
              {EXAMPLES.slice(0, 4).map((e) => (
                <button key={e} onClick={() => ask(e)}>
                  {e}
                </button>
              ))}
            </div>
            <div className="lp-trust">
              <span>
                <Icon d="M20 6 9 17l-5-5" /> {TRIAL_QUESTIONS} free questions, no sign-up
              </span>
              <span>
                <Icon d="M20 6 9 17l-5-5" /> No ads, no spam
              </span>
              <span>
                <Icon d="M20 6 9 17l-5-5" /> Data stays in India
              </span>
            </div>
          </div>
          <HeroStage />
        </div>
      </section>

      <section className="lp-stats">
        <div className="lp-wrap lp-stats-grid">
          {STATS.map(([n, l]) => (
            <div key={l} className="reveal">
              <b>{n}</b>
              <span>{l}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="reveal">
            <span className="eyebrow">How it works</span>
            <h2>From question to evidence in seconds</h2>
          </div>
          <ol className="lp-steps">
            {STEPS.map(([t, d], k) => (
              <li key={t} className="reveal" style={{ transitionDelay: `${k * 80}ms` }}>
                <span className="lp-step-n">{k + 1}</span>
                <b>{t}</b>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-sec lp-alt">
        <div className="lp-wrap">
          <div className="reveal">
            <span className="eyebrow">What you can do</span>
            <h2>Everything you need to judge a fund, in one place</h2>
          </div>
          <div className="lp-features">
            {FEATURES.map((f, k) => (
              <Link key={f.t} href={f.href} className="lp-feature reveal" style={{ transitionDelay: `${k * 70}ms` }}>
                {f.art}
                <b>{f.t}</b>
                <p>{f.d}</p>
                <span className="lp-cta">
                  {f.cta} <Arrow />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap lp-split">
          <div className="reveal lp-sticky">
            <span className="eyebrow">How we score a fund</span>
            <h2>Five things that matter, each compared with similar funds</h2>
            <p className="lp-lead">
              A small cap fund is only compared with small cap funds, a liquid fund with liquid funds. Each part gets a score from 0 to 100, and the
              overall score brings them together. No star ratings, no black box: every score comes with the numbers behind it.
            </p>
            <Link href="/screener" className="lp-btn ghost-btn">
              See scores in the screener <Arrow />
            </Link>
          </div>
          <ol className="lp-pillars">
            {PILLARS.map(([t, d, v], k) => (
              <li key={t} className="reveal">
                <span className="lp-idx">{String(k + 1).padStart(2, "0")}</span>
                <div>
                  <div className="lp-pillar-head">
                    <b>{t}</b>
                    <span className="lp-pillar-v">{v}</span>
                  </div>
                  <p>{d}</p>
                  <span className="lp-pillar-bar" aria-hidden>
                    <i style={{ width: `${v}%` }} />
                  </span>
                </div>
              </li>
            ))}
            <li className="lp-pillars-note">Example scores, for illustration.</li>
          </ol>
        </div>
      </section>

      <section className="lp-sec lp-alt">
        <div className="lp-wrap">
          <div className="reveal">
            <span className="eyebrow">Try asking</span>
            <h2>Questions people ask every day</h2>
          </div>
          <div className="lp-examples">
            {EXAMPLES.map((e, k) => (
              <button key={e} onClick={() => ask(e)} className="reveal" style={{ transitionDelay: `${k * 50}ms` }}>
                <span>{e}</span>
                <Arrow />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec" id="pricing">
        <div className="lp-wrap">
          <div className="reveal lp-center">
            <span className="eyebrow">Plans</span>
            <h2>Start free. Go Pro when you need everything.</h2>
          </div>
          <div className="lp-plans">
            <div className="lp-plan reveal">
              <span className="lp-plan-name">Free</span>
              <div className="lp-price">₹0</div>
              <p className="sub">For trying it out</p>
              <ul>
                <li>{TRIAL_QUESTIONS} questions, no sign-up needed</li>
                <li>Scores and key numbers for every fund</li>
                <li>Top 3 results in the screener</li>
                <li>Fund comparisons and overlap</li>
              </ul>
              <Link href="/ask" className="lp-btn ghost-btn">
                Start asking
              </Link>
            </div>
            <div className="lp-plan pro reveal">
              <span className="lp-plan-tag">Most complete</span>
              <span className="lp-plan-name">Pro</span>
              <div className="lp-price">
                ₹{PRO_PRICE_INR}
                <small>/month</small>
              </div>
              <p className="sub">For investors who want every number</p>
              <ul>
                <li>Up to {PLANS.pro.chatPerDay} questions a day</li>
                <li>Every fund and every data point in the screener</li>
                <li>Full analysis: consistency, rank, SIP, crash recovery</li>
                <li>Complete holdings, sectors and overlap</li>
              </ul>
              <div className="lp-plan-cta">
                <SubscribeButton me={me} onSignIn={() => setAuthOpen(true)} onUpgraded={refresh} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-sec lp-alt">
        <div className="lp-wrap lp-faq-wrap">
          <div className="reveal">
            <span className="eyebrow">FAQ</span>
            <h2>Good to know</h2>
            <p className="lp-lead">
              Still unsure? Write to us from the <Link href="/contact">contact page</Link>.
            </p>
          </div>
          <div className="lp-faq">
            {FAQ.map((f) => (
              <details key={f.q} className="reveal">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-cta-band">
        <div className="lp-wrap reveal">
          <h2>Pick a fund. Ask anything.</h2>
          <p>Free to start. No sign-up for your first {TRIAL_QUESTIONS} questions.</p>
          <div className="lp-cta-row">
            <Link href="/ask" className="lp-btn">
              Ask a question <Arrow />
            </Link>
            <Link href="/screener" className="lp-btn ghost-btn">
              Open the screener
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />

      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onSignedIn={(m) => {
            setMe(m);
            setAuthOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
