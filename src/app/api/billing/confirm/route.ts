import { NextResponse } from "next/server";
import { z } from "zod";
import { billingConfig, checkoutSubscriptionFor, signatureValid, syncSubscription } from "@/lib/billing/razorpay";
import { currentViewer } from "@/lib/users/auth";
import { meBody } from "@/lib/users/me";
import { users } from "@/lib/users/store";
import { readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i),
});

export async function POST(req: Request) {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in again to check your payment." }, { status: 401 });
  const body = Body.safeParse(await readJson(req, 4096));
  if (!body.success) return NextResponse.json({ error: "Invalid checkout response." }, { status: 400 });
  try {
    const savedId = await checkoutSubscriptionFor(viewer.user.uid);
    const { razorpay_subscription_id: returnedId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body.data;
    const secret = billingConfig().keySecret;
    if (!savedId || returnedId !== savedId || !signatureValid(`${paymentId}|${savedId}`, signature, secret)) {
      return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
    }
    await syncSubscription(savedId);
    const user = await users().get(viewer.user.uid);
    return NextResponse.json({ me: user ? meBody(user) : null });
  } catch (e) {
    console.error(JSON.stringify({ type: "subscription_confirm_failed", error: String(e) }));
    return NextResponse.json({ error: "Payment is being verified. Please check again in a moment." }, { status: 503 });
  }
}
