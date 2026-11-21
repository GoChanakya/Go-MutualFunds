import { NextResponse } from "next/server";
import { currentViewer } from "@/lib/users/auth";
import { createSubscription } from "@/lib/billing/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in with WhatsApp first." }, { status: 401 });
  if (viewer.plan.id === "pro") return NextResponse.json({ error: "Your Pro plan is already active." }, { status: 409 });
  try {
    const { id, key } = await createSubscription(viewer.user.uid);
    return NextResponse.json({ subscription_id: id, key, contact: viewer.user.phone.replace(/^\+/, "") });
  } catch (e) {
    console.error(JSON.stringify({ type: "subscription_create_failed", error: String(e) }));
    return NextResponse.json({ error: "Could not start checkout. Please try again shortly." }, { status: 503 });
  }
}
