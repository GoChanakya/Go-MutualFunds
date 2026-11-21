import { NextResponse } from "next/server";
import { currentViewer } from "@/lib/users/auth";
import { meBody } from "@/lib/users/me";
import { ANON_ME } from "@/lib/users/me-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const v = await currentViewer();
  return NextResponse.json(v ? meBody(v.user) : ANON_ME);
}
