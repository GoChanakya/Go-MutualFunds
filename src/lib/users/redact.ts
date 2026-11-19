// Mask personal data users may type into questions before it is logged or stored (DPDP Act).
export function redact(text: string): string {
  return text
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "[PAN]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")
    .replace(/(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, "[PHONE]")
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[AADHAAR]");
}
