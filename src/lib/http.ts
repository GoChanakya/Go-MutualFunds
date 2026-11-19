import "server-only";

// Read a JSON body with a hard size cap, so a huge payload can't exhaust memory before validation.
export async function readJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
