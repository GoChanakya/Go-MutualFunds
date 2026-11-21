// Company details shown in the footer and on every legal page. Edit here; nothing else needs to change.
// Empty strings are hidden on the site (e.g. a social link you don't have yet).

export const COMPANY = {
  brand: "GoMutualFunds",
  legalName: "Gochanakya Fintech Private Limited",
  ecosystem: "GoChanakya Fintech",
  email: "info@gochanakya.com",
  phone: "+91 9136461246", // WhatsApp and call
  // Companies (Incorporation) Rules 2014, Rule 26: a company website must show its CIN and registered office address.
  cin: "", // e.g. "U67190MH2024PTC000000"
  address: "", // registered office address, one line
  // Grievance Officer (IT Rules 2011/2021, Consumer Protection (E-Commerce) Rules 2020, DPDP Act 2023)
  grievanceOfficer: { name: "", designation: "Grievance Officer", email: "info@gochanakya.com", phone: "+91 9136461246" },
  jurisdiction: "", // city whose courts have jurisdiction, e.g. "Mumbai"
  social: {
    instagram: "",
    linkedin: "",
    x: "",
    youtube: "",
    facebook: "",
  },
} as const;

export const RISK_LINE = "Mutual fund investments are subject to market risks. Please read all scheme related documents carefully.";
export const SOURCE_LINE = "Source: AMFI India, RBI, and official factsheets. For information only, not investment advice.";

export const whatsappUrl = () => `https://wa.me/${COMPANY.phone.replace(/\D/g, "")}`;
export const telUrl = () => `tel:${COMPANY.phone.replace(/[^\d+]/g, "")}`;

// Legal pages, in footer order. The text of each lives in content/legal/<slug>.md.
export const LEGAL_PAGES = [
  { slug: "terms", title: "Terms of Use" },
  { slug: "privacy", title: "Privacy Policy" },
  { slug: "refund-policy", title: "Refund & Cancellation" },
  { slug: "disclaimer", title: "Disclaimer" },
  { slug: "grievance", title: "Grievance Redressal" },
  { slug: "contact", title: "Contact Us" },
] as const;
export type LegalSlug = (typeof LEGAL_PAGES)[number]["slug"];
