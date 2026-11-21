import { LegalPage, legalMetadata } from "@/components/LegalPage";

export const dynamic = "force-static";
export const metadata = legalMetadata("contact");

export default function Page() {
  return <LegalPage slug="contact" />;
}
