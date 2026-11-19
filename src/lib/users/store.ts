import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { PLANS, type Plan, type PlanId } from "@/lib/config/plans";
import { istDay, uidForPhone } from "./session";

// User data lives in Firestore (Firebase project go-mutualfunds, asia-south1). Only this backend reads/writes it;
// Firestore security rules deny all client access. For local dev without Firestore, an in-memory store is used.
//
//   users/{uid}                    phone, plan, plan_expires_at, consent_at, created_at, last_seen_at, created_ip
//   usage/{uid}_{YYYY-MM-DD}       chat, screener (counters, IST day)
//   users/{uid}/events/{auto}      kind (chat|screener), question / filters, intent, funds_shown, ts
//   guards/ip_{ip}_{day}           new_users, requests   (abuse limits while phones are unverified)

export type UserDoc = {
  uid: string;
  phone: string;
  plan: PlanId;
  plan_expires_at: string | null;
  created_at: string;
  consent_at: string;
};

export type Kind = "chat" | "screener";

export type ConsumeResult = { allowed: boolean; used: number; limit: number };

export interface UserStore {
  upsertByPhone(phone: string, ip: string): Promise<{ user: UserDoc; created: boolean }>;
  get(uid: string): Promise<UserDoc | null>;
  usage(uid: string): Promise<Record<Kind, number>>;
  consume(uid: string, kind: Kind, limit: number): Promise<ConsumeResult>;
  ipGuard(ip: string, field: "new_users" | "requests", limit: number, peek?: boolean): Promise<boolean>;
  logEvent(uid: string, event: Record<string, unknown>): Promise<void>;
  setPlan(uid: string, plan: PlanId, expiresAt: string | null): Promise<void>;
}

export function effectivePlan(u: UserDoc | null): Plan {
  // tolerate hand edits in the Firebase console: "Pro", " pro ", or "pro" plus a stray newline
  const plan = String(u?.plan ?? "").trim().toLowerCase();
  const expires = u?.plan_expires_at ? Date.parse(String(u.plan_expires_at).trim()) : NaN;
  if (plan === "pro" && (!u?.plan_expires_at || expires > Date.now())) return PLANS.pro;
  return PLANS.free;
}

const now = () => new Date().toISOString();
const ipKey = (ip: string) => ip.replace(/[^\w.:-]/g, "_").slice(0, 60);

// ---------------- Firestore ----------------

class FirestoreUserStore implements UserStore {
  private db: Firestore;
  constructor() {
    this.db = new Firestore({
      projectId: process.env.FIRESTORE_PROJECT,
      databaseId: process.env.FIRESTORE_DATABASE ?? "(default)",
      ignoreUndefinedProperties: true,
    });
  }

  async upsertByPhone(phone: string, ip: string) {
    const uid = uidForPhone(phone);
    const ref = this.db.collection("users").doc(uid);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        tx.update(ref, { last_seen_at: now() });
        return { user: snap.data() as UserDoc, created: false };
      }
      const user: UserDoc = { uid, phone, plan: "free", plan_expires_at: null, created_at: now(), consent_at: now() };
      tx.set(ref, { ...user, last_seen_at: now(), created_ip: ip });
      return { user, created: true };
    });
  }

  async get(uid: string) {
    const snap = await this.db.collection("users").doc(uid).get();
    return snap.exists ? (snap.data() as UserDoc) : null;
  }

  async usage(uid: string) {
    const snap = await this.db.collection("usage").doc(`${uid}_${istDay()}`).get();
    const d = snap.data() ?? {};
    return { chat: Number(d.chat ?? 0), screener: Number(d.screener ?? 0) };
  }

  async consume(uid: string, kind: Kind, limit: number) {
    const ref = this.db.collection("usage").doc(`${uid}_${istDay()}`);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = Number(snap.data()?.[kind] ?? 0);
      if (used >= limit) return { allowed: false, used, limit };
      tx.set(ref, { uid, day: istDay(), [kind]: FieldValue.increment(1), updated_at: now() }, { merge: true });
      return { allowed: true, used: used + 1, limit };
    });
  }

  async ipGuard(ip: string, field: "new_users" | "requests", limit: number, peek = false) {
    const ref = this.db.collection("guards").doc(`ip_${ipKey(ip)}_${istDay()}`);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = Number(snap.data()?.[field] ?? 0);
      if (used >= limit) return false;
      if (!peek) tx.set(ref, { [field]: FieldValue.increment(1), day: istDay() }, { merge: true });
      return true;
    });
  }

  async logEvent(uid: string, event: Record<string, unknown>) {
    await this.db.collection("users").doc(uid).collection("events").add({ ...event, ts: now() });
  }

  async setPlan(uid: string, plan: PlanId, expiresAt: string | null) {
    await this.db.collection("users").doc(uid).set({ plan, plan_expires_at: expiresAt, plan_updated_at: now() }, { merge: true });
  }
}

// ---------------- local dev store (no Firestore) ----------------
// Saved to a JSON file in the OS temp folder so sign-ins survive dev hot reloads and restarts.

const DEV_FILE = path.join(os.tmpdir(), "gomf-dev-users.json");

class MemoryUserStore implements UserStore {
  private users = new Map<string, UserDoc>();
  private counters = new Map<string, number>();
  private events: Record<string, unknown>[] = [];

  constructor() {
    try {
      const d = JSON.parse(fs.readFileSync(DEV_FILE, "utf8")) as { users: [string, UserDoc][]; counters: [string, number][] };
      this.users = new Map(d.users);
      this.counters = new Map(d.counters);
    } catch {
      // first run: no file yet
    }
  }
  private save() {
    try {
      fs.writeFileSync(DEV_FILE, JSON.stringify({ users: [...this.users], counters: [...this.counters] }));
    } catch (e) {
      console.warn(JSON.stringify({ type: "dev_store_save_failed", error: String(e) }));
    }
  }

  async upsertByPhone(phone: string) {
    const uid = uidForPhone(phone);
    const existing = this.users.get(uid);
    if (existing) return { user: existing, created: false };
    const user: UserDoc = { uid, phone, plan: (process.env.DEV_DEFAULT_PLAN as PlanId) ?? "free", plan_expires_at: null, created_at: now(), consent_at: now() };
    this.users.set(uid, user);
    this.save();
    return { user, created: true };
  }
  async get(uid: string) {
    return this.users.get(uid) ?? null;
  }
  async usage(uid: string) {
    const k = `${uid}_${istDay()}`;
    return { chat: this.counters.get(`${k}_chat`) ?? 0, screener: this.counters.get(`${k}_screener`) ?? 0 };
  }
  async consume(uid: string, kind: Kind, limit: number) {
    const k = `${uid}_${istDay()}_${kind}`;
    const used = this.counters.get(k) ?? 0;
    if (used >= limit) return { allowed: false, used, limit };
    this.counters.set(k, used + 1);
    this.save();
    return { allowed: true, used: used + 1, limit };
  }
  async ipGuard(ip: string, field: string, limit: number, peek = false) {
    const k = `ip_${ip}_${istDay()}_${field}`;
    const used = this.counters.get(k) ?? 0;
    if (used >= limit) return false;
    if (!peek) {
      this.counters.set(k, used + 1);
      this.save();
    }
    return true;
  }
  async logEvent(uid: string, event: Record<string, unknown>) {
    this.events.push({ uid, ...event, ts: now() });
    if (this.events.length > 1000) this.events.shift();
  }
  async setPlan(uid: string, plan: PlanId, expiresAt: string | null) {
    const u = this.users.get(uid);
    if (u) this.users.set(uid, { ...u, plan, plan_expires_at: expiresAt });
    this.save();
  }
}

// One store per server process. Kept on globalThis because Next.js dev mode can load this module more than once
// (hot reload, per-route bundles); a module-level variable would give each copy its own empty store.
const g = globalThis as typeof globalThis & { __gomfUserStore?: UserStore };
export function users(): UserStore {
  if (!g.__gomfUserStore) {
    const useFirestore = (process.env.USER_STORE ?? (process.env.FIRESTORE_PROJECT ? "firestore" : "memory")) === "firestore";
    g.__gomfUserStore = useFirestore ? new FirestoreUserStore() : new MemoryUserStore();
    console.log(JSON.stringify({ type: "user_store", backend: useFirestore ? "firestore" : `dev-file ${DEV_FILE}`, project: process.env.FIRESTORE_PROJECT ?? null }));
  }
  return g.__gomfUserStore;
}
