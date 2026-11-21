import { NextResponse } from "next/server";
import { currentViewer } from "@/lib/users/auth";
import { users } from "@/lib/users/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Notify me when Pro launches" (until Razorpay is live). Signed-in users only, so we have a verified number.
export async function POST() {
  const v = await currentViewer();
  if (!v) return NextResponse.json({ error: "signin_required" }, { status: 401 });
  await users().setProInterest(v.user.uid);
  console.log(JSON.stringify({ type: "pro_interest", uid: v.user.uid }));
  return NextResponse.json({ ok: true });
}
