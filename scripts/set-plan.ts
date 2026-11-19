// Admin: give a user the paid plan (until payments are integrated), or move them back to free.
// Usage (against Firestore):
//   FIRESTORE_PROJECT=go-mutualfunds npx tsx --conditions=react-server scripts/set-plan.ts 9876543210 pro 30
//   FIRESTORE_PROJECT=go-mutualfunds npx tsx --conditions=react-server scripts/set-plan.ts 9876543210 free
import { normalizePhone, uidForPhone } from "@/lib/users/session";
import { users } from "@/lib/users/store";

async function main() {
  const [rawPhone, plan, days] = process.argv.slice(2);
  const phone = normalizePhone(rawPhone ?? "");
  if (!phone || (plan !== "pro" && plan !== "free")) throw new Error("usage: set-plan.ts <mobile> <pro|free> [days]");
  const uid = uidForPhone(phone);
  if (!(await users().get(uid))) throw new Error(`No user with ${phone}. They must sign in once first.`);
  const expires = plan === "pro" ? new Date(Date.now() + Number(days ?? 30) * 86_400_000).toISOString() : null;
  await users().setPlan(uid, plan, expires);
  console.log(JSON.stringify({ ok: true, uid, plan, plan_expires_at: expires }));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(String(e));
    process.exit(1);
  },
);
