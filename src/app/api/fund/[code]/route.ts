import { NextResponse } from "next/server";
import { fundDetail } from "@/lib/engine/screener";
import { currentViewer } from "@/lib/users/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full analysis, sector/asset/rating allocation and fund details. Paid plan only.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "signin_required" }, { status: 401 });
  if (!viewer.plan.fullData) return NextResponse.json({ error: "upgrade_required" }, { status: 403 });
  const { code } = await params;
  const detail = await fundDetail(code);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}
