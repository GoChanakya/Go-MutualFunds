import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { SiteFooter } from "@/components/Footer";
import { LEGAL_PAGES, type LegalSlug } from "@/lib/config/company";
import { readLegal, renderMarkdown } from "@/lib/legal";

export function legalMetadata(slug: LegalSlug): Metadata {
  const page = LEGAL_PAGES.find((p) => p.slug === slug)!;
  return { title: `${page.title} · GoMutualFunds` };
}

// The Markdown is read on each request (content/legal/<slug>.md, shipped in the image).
export function LegalPage({ slug }: { slug: LegalSlug }) {
  return (
    <div className="legal-page">
      <Header me={undefined} />
      <main className="legal">{renderMarkdown(readLegal(slug))}</main>
      <SiteFooter />
    </div>
  );
}
