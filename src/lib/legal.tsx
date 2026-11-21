// Reads content/legal/<slug>.md and renders a small Markdown subset as React (no raw HTML is ever injected):
//   # / ## / ### headings, paragraphs, "- " bullet lists, **bold**, [text](url). Lines starting with <!-- are skipped.
// {{tokens}} are filled from src/lib/config/company.ts, so company details are typed in one place only.
import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { ReactNode } from "react";
import { COMPANY, type LegalSlug } from "@/lib/config/company";

const missing = (label: string) => `[${label} — to be added]`;

function tokens(): Record<string, string> {
  const g = COMPANY.grievanceOfficer;
  return {
    brand: COMPANY.brand,
    company: COMPANY.legalName,
    ecosystem: COMPANY.ecosystem,
    email: COMPANY.email,
    phone: COMPANY.phone,
    cin: COMPANY.cin || missing("CIN"),
    address: COMPANY.address || missing("Registered office address"),
    jurisdiction: COMPANY.jurisdiction || missing("City"),
    grievance_name: g.name || missing("Name"),
    grievance_designation: g.designation,
    grievance_email: g.email,
    grievance_phone: g.phone,
  };
}

export function readLegal(slug: LegalSlug): string {
  const raw = fs.readFileSync(path.join(process.cwd(), "content", "legal", `${slug}.md`), "utf8");
  const t = tokens();
  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => t[k] ?? m);
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b key={`${key}-${n++}`}>{m[1]}</b>);
    else {
      const href = m[3];
      const safe = /^(https?:|mailto:|tel:|\/)/.test(href) ? href : "#";
      out.push(
        safe.startsWith("/") ? (
          <Link key={`${key}-${n++}`} href={safe}>
            {m[2]}
          </Link>
        ) : (
          <a key={`${key}-${n++}`} href={safe} rel="noopener noreferrer" target={safe.startsWith("http") ? "_blank" : undefined}>
            {m[2]}
          </a>
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(md: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) nodes.push(<p key={`p${nodes.length}`}>{inline(para.join(" "), `p${nodes.length}`)}</p>);
    if (list.length)
      nodes.push(
        <ul key={`u${nodes.length}`}>
          {list.map((li, k) => (
            <li key={k}>{inline(li, `u${nodes.length}-${k}`)}</li>
          ))}
        </ul>,
      );
    para = [];
    list = [];
  };
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith("<!--")) continue; // single-line notes for editors, never shown
    const h =/^(#{1,3})\s+(.*)$/.exec(l);
    if (!l) flush();
    else if (h) {
      flush();
      const level = h[1].length;
      const k = `h${nodes.length}`;
      nodes.push(level === 1 ? <h1 key={k}>{h[2]}</h1> : level === 2 ? <h2 key={k}>{h[2]}</h2> : <h3 key={k}>{h[2]}</h3>);
    } else if (/^[-*]\s+/.test(l)) {
      if (para.length) flush();
      list.push(l.replace(/^[-*]\s+/, ""));
    } else {
      if (list.length) flush();
      para.push(l);
    }
  }
  flush();
  return nodes;
}
