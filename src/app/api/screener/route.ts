import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { REQUESTS_PER_IP_PER_DAY } from "@/lib/config/plans";
import { getStore } from "@/lib/data/store";
import { ScreenerFilters, runScreener } from "@/lib/engine/screener";
import { clientIp, currentViewer } from "@/lib/users/auth";
import { users } from "@/lib/users/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = ScreenerFilters.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad filters" }, { status: 400 });

  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "signin_required" }, { status: 401 });
  const { user, plan } = viewer;
  const store = users();
  if (!(await store.ipGuard(clientIp(req), "requests", REQUESTS_PER_IP_PER_DAY)))
    return NextResponse.json({ error: "Too many requests from this network today." }, { status: 429 });
  const quota = await store.consume(user.uid, "screener", plan.screenerPerDay);
  if (!quota.allowed) return NextResponse.json({ error: "limit_reached", message: `You've used all ${quota.limit} searches for today.` }, { status: 429 });

  try {
    const data = await getStore();
    const result = await runScreener(parsed.data, plan);
    const { page, ...filters } = parsed.data;
    if (page === 0) store.logEvent(user.uid, { kind: "screener", filters, total: result.total }).catch(() => {});
    console.log(JSON.stringify({ type: "screener_event", uid: user.uid, plan: plan.id, filters: parsed.data, total: result.total }));
    return NextResponse.json({ ...result, plan: plan.id, as_of: data.asOf.nav });
  } catch (e) {
    console.error(JSON.stringify({ type: "screener_error", error: String(e).slice(0, 500) }));
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
