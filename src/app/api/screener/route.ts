import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { REQUESTS_PER_IP_PER_DAY } from "@/lib/config/plans";
import { getStore } from "@/lib/data/store";
import { ScreenerFilters, runScreener } from "@/lib/engine/screener";
import { clientIp, identify, withAnonCookie } from "@/lib/users/auth";
import { users } from "@/lib/users/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = ScreenerFilters.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "bad filters" }, { status: 400 });

  // Visitors can use the screener too (top 3, like the free plan).
  const id = await identify();
  const { plan } = id;
  const store = users();
  const reply = (body: unknown, status = 200) => withAnonCookie(NextResponse.json(body, { status }), id);
  if (!(await store.ipGuard(clientIp(req), "requests", REQUESTS_PER_IP_PER_DAY))) return reply({ error: "Too many requests from this network today." }, 429);
  const quota = await store.consume(id.key, "screener", plan.screenerPerDay);
  if (!quota.allowed) return reply({ error: "limit_reached", message: "You've reached today's search limit. It resets at midnight." }, 429);

  try {
    const data = await getStore();
    const result = await runScreener(parsed.data, plan);
    const { page, ...filters } = parsed.data;
    if (page === 0 && id.kind === "user") store.logEvent(id.key, { kind: "screener", filters, total: result.total }).catch(() => {});
    console.log(JSON.stringify({ type: "screener_event", who: id.kind, key: id.key, plan: plan.id, filters: parsed.data, total: result.total }));
    return reply({ ...result, plan: plan.id, as_of: data.asOf.nav });
  } catch (e) {
    console.error(JSON.stringify({ type: "screener_error", error: String(e).slice(0, 500) }));
    return reply({ error: "Something went wrong. Please try again." }, 500);
  }
}
