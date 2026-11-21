import Link from "next/link";
import { COMPANY, LEGAL_PAGES, RISK_LINE, SOURCE_LINE, telUrl, whatsappUrl } from "@/lib/config/company";
import { LogoMark } from "./ui";

const SOCIAL_LABELS: Record<keyof typeof COMPANY.social, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  facebook: "Facebook",
};

// Full-width site footer: home page, screener and legal pages.
export function SiteFooter() {
  const socials = (Object.keys(COMPANY.social) as (keyof typeof COMPANY.social)[]).filter((k) => COMPANY.social[k]);
  const year = new Date().getFullYear();
  return (
    <footer className="site-foot">
      <div className="foot-inner">
        <div className="foot-top">
          <div className="foot-about">
            <Link href="/" className="foot-brand">
              <LogoMark size={30} />
              <span>
                Go<b>MutualFunds</b>
              </span>
            </Link>
            <p>Mutual funds, read by the numbers. Scores, comparisons and portfolios for every Indian mutual fund.</p>
            <p className="foot-eco">
              A part of the <b>{COMPANY.ecosystem}</b> ecosystem.
            </p>
            {socials.length > 0 && (
              <div className="foot-social">
                {socials.map((k) => (
                  <a key={k} href={COMPANY.social[k]} target="_blank" rel="noopener noreferrer">
                    {SOCIAL_LABELS[k]}
                  </a>
                ))}
              </div>
            )}
          </div>

          <nav className="foot-col" aria-label="Product">
            <h4>Product</h4>
            <Link href="/">Ask a question</Link>
            <Link href="/screener">Fund screener</Link>
            <span className="foot-muted">Pro · launching soon</span>
          </nav>

          <nav className="foot-col" aria-label="Legal">
            <h4>Legal</h4>
            {LEGAL_PAGES.filter((p) => p.slug !== "contact").map((p) => (
              <Link key={p.slug} href={`/${p.slug}`}>
                {p.title}
              </Link>
            ))}
          </nav>

          <div className="foot-col">
            <h4>Contact</h4>
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
            <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer">
              WhatsApp {COMPANY.phone}
            </a>
            <a href={telUrl()}>Call {COMPANY.phone}</a>
            <Link href="/contact">All contact details</Link>
          </div>
        </div>

        <p className="foot-risk">{RISK_LINE}</p>

        <div className="foot-bottom">
          <span>
            © {year} {COMPANY.legalName}
            {COMPANY.cin ? ` · CIN ${COMPANY.cin}` : ""}
            {COMPANY.address ? ` · ${COMPANY.address}` : ""}
          </span>
          <span>{SOURCE_LINE}</span>
        </div>
      </div>
    </footer>
  );
}

// Compact line under the chat composer, where vertical space matters.
export function ChatFooter() {
  return (
    <div className="disclaimer">
      <span>{SOURCE_LINE}</span> <span>{RISK_LINE}</span>
      <span className="chat-links">
        {" "}
        {COMPANY.brand} is a part of the {COMPANY.ecosystem} ecosystem ·{" "}
        <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/contact">Contact</Link>
      </span>
    </div>
  );
}
