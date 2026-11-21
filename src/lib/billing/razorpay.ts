import "server-only";
import crypto from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { PRO_PRICE_INR } from "@/lib/config/plans";

type Subscription = {
  id: string;
  plan_id: string;
  status: string;
  paid_count: number;
  current_end: number | null;
};

const now = () => new Date().toISOString();
const subId = /^sub_[A-Za-z0-9]+$/;

export function billingConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const planId = process.env.RAZORPAY_PLAN_ID;
  if (!process.env.FIRESTORE_PROJECT || !keyId || !keySecret || !planId) throw new Error("Razorpay billing is not configured");
  return { keyId, keySecret, planId };
}

function db() {
  return new Firestore({ projectId: process.env.FIRESTORE_PROJECT, databaseId: process.env.FIRESTORE_DATABASE ?? "(default)" });
}

export function signatureValid(message: string, signature: string | null, secret: string) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(message).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { keyId, keySecret } = billingConfig();
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    ...init,
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.error(JSON.stringify({ type: "razorpay_api_error", path, status: res.status }));
    throw new Error("Razorpay request failed");
  }
  return (await res.json()) as T;
}

export async function checkPlan() {
  const { planId } = billingConfig();
  const plan = await api<{ period: string; interval: number; item: { amount: number; currency: string } }>(`plans/${planId}`);
  if (plan.period !== "monthly" || plan.interval !== 1 || plan.item?.amount !== PRO_PRICE_INR * 100 || plan.item?.currency !== "INR") {
    throw new Error("Razorpay plan does not match ₹400/month");
  }
}

export async function createSubscription(uid: string) {
  const config = billingConfig();
  const store = db();
  const billing = store.collection("billing").doc(uid);
  const nonce = crypto.randomUUID();
  const claim = await store.runTransaction(async (tx) => {
    const snap = await tx.get(billing);
    const data = snap.data();
    if (data?.subscription_id && ["created", "authenticated"].includes(data.status)) return { existing: data.subscription_id as string };
    if (data?.subscription_id && ["active", "pending"].includes(data.status)) return { active: true };
    if (data?.creating_at && Date.now() - Date.parse(data.creating_at) < 120000) return { creating: true };
    tx.set(billing, { creating_at: now(), create_nonce: nonce }, { merge: true });
    return { claimed: true };
  });
  if ("existing" in claim) return { id: claim.existing, key: config.keyId };
  if ("active" in claim) throw new Error("A subscription already exists for this account");
  if ("creating" in claim) throw new Error("Subscription creation is in progress. Please retry shortly.");

  try {
    await checkPlan();
    const sub = await api<Subscription>("subscriptions", {
      method: "POST",
      body: JSON.stringify({ plan_id: config.planId, total_count: 60, quantity: 1, customer_notify: false, notes: { gomf_uid: uid } }),
    });
    if (!subId.test(sub.id) || sub.plan_id !== config.planId) throw new Error("Unexpected Razorpay subscription response");
    await store.runTransaction(async (tx) => {
      const snap = await tx.get(billing);
      if (snap.data()?.create_nonce !== nonce) throw new Error("Subscription creation claim changed");
      tx.set(store.collection("razorpay_subscriptions").doc(sub.id), { uid, plan_id: config.planId, created_at: now() });
      tx.set(billing, { subscription_id: sub.id, status: sub.status, created_at: now(), creating_at: null, create_nonce: null }, { merge: true });
    });
    return { id: sub.id, key: config.keyId };
  } catch (error) {
    await store.runTransaction(async (tx) => {
      const snap = await tx.get(billing);
      if (snap.data()?.create_nonce === nonce) tx.set(billing, { creating_at: null, create_nonce: null }, { merge: true });
    });
    throw error;
  }
}

// Read Razorpay's current state rather than trusting a possibly late webhook snapshot.
export async function syncSubscription(id: string, eventId?: string) {
  if (!subId.test(id)) throw new Error("Invalid subscription id");
  const config = billingConfig();
  const store = db();
  const owner = await store.collection("razorpay_subscriptions").doc(id).get();
  const uid = owner.data()?.uid as string | undefined;
  if (!uid) throw new Error("Unknown subscription");
  const sub = await api<Subscription>(`subscriptions/${id}`);
  if (sub.id !== id || sub.plan_id !== config.planId) throw new Error("Unexpected subscription plan");
  const billing = store.collection("billing").doc(uid);
  const user = store.collection("users").doc(uid);
  const event = eventId ? store.collection("razorpay_events").doc(eventId) : null;
  await store.runTransaction(async (tx) => {
    const [billSnap, userSnap, eventSnap] = await Promise.all([tx.get(billing), tx.get(user), event ? tx.get(event) : Promise.resolve(null)]);
    if (eventSnap?.exists) return;
    if (billSnap.data()?.subscription_id !== id || !userSnap.exists) throw new Error("Subscription owner mismatch");
    const previous = userSnap.data()?.plan_expires_at;
    const priorEnd = typeof previous === "string" ? Date.parse(previous) : 0;
    const currentEnd = (sub.current_end ?? 0) * 1000;
    const paidThrough = sub.paid_count > 0 ? Math.max(Number.isFinite(priorEnd) ? priorEnd : 0, currentEnd) : 0;
    // Authenticated mandates alone never grant Pro. A paid cycle must have a future end.
    const paid = paidThrough > Date.now();
    tx.set(billing, { status: sub.status, paid_count: sub.paid_count, current_end: sub.current_end, synced_at: now() }, { merge: true });
    if (paid) tx.set(user, { plan: "pro", plan_expires_at: new Date(paidThrough).toISOString(), plan_updated_at: now() }, { merge: true });
    else if (userSnap.data()?.plan === "pro" && userSnap.data()?.razorpay_subscription_id === id) tx.set(user, { plan: "free", plan_expires_at: null, plan_updated_at: now() }, { merge: true });
    if (paid) tx.set(user, { razorpay_subscription_id: id }, { merge: true });
    if (event) tx.create(event, { subscription_id: id, event_id: eventId, processed_at: now() });
  });
  return { uid };
}

export async function checkoutSubscriptionFor(uid: string) {
  const snap = await db().collection("billing").doc(uid).get();
  return snap.data()?.subscription_id as string | undefined;
}
