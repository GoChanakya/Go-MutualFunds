import { LegalPage, legalMetadata } from "@/components/LegalPage";

export const metadata = legalMetadata("grievance");

export default function Page() {
  return <LegalPage slug="grievance" />;
}
