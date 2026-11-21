import { LegalPage, legalMetadata } from "@/components/LegalPage";

export const dynamic = "force-static";
export const metadata = legalMetadata("refund-policy");

export default function Page() {
  return <LegalPage slug="refund-policy" />;
}
