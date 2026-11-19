import { NextResponse } from "next/server";
import { currentViewer } from "@/lib/users/auth";
import { meBody } from "@/lib/users/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const v = await currentViewer();
  if (!v) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return NextResponse.json(await meBody(v.user));
}
