import { NextResponse } from "next/server";
import { isKnownSubscription, signatureValid, syncSubscription } from "@/lib/billing/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTS = new Set([
  "subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.updated", "subscription.pending", "subscription.halted",
  "subscription.cancelled", "subscription.completed", "subscription.paused", "subscription.resumed",
]);

async function rawBody(req: Request, limit = 262144): Promise<Buffer | null> {
  if (Number(req.headers.get("content-length") ?? 0) > limit || !req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  const raw = await rawBody(req);
  if (!raw) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  if (!signatureValid(raw, req.headers.get("x-razorpay-signature"), secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  const eventId = req.headers.get("x-razorpay-event-id");
  if (!eventId || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
  let event: { event?: string; payload?: { subscription?: { entity?: { id?: string } } } };
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!event.event || !EVENTS.has(event.event)) return NextResponse.json({ ok: true });
  const id = event.payload?.subscription?.entity?.id;
  if (!id) return NextResponse.json({ error: "Missing subscription" }, { status: 400 });
  try {
    if (!(await isKnownSubscription(id))) {
      console.log(JSON.stringify({ type: "subscription_webhook_ignored", subscription_id: id, event: event.event }));
      return NextResponse.json({ ok: true });
    }
    await syncSubscription(id, eventId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(JSON.stringify({ type: "subscription_webhook_failed", event: event.event, subscription_id: id, error: String(e) }));
    return NextResponse.json({ error: "Processing failed" }, { status: 503 });
  }
}
