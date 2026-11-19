import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { Storage } from "@google-cloud/storage";
import { RAW_FILES, SERVING_TABLES, buildServingTables, readMeta, sqlPath, type RawFile } from "./build";

// Two ways to get data:
//  - production: SERVING_BUCKET is set -> read prebuilt tables written by the daily builder job (manifest.json -> files).
//    The app never touches the raw bucket.
//  - development: build the tables from raw backend_main_kartik files (DATA_DIR folder, or DATA_BUCKET/DATA_PREFIX).
const SERVING_BUCKET = process.env.SERVING_BUCKET;
const SOURCE_BUCKET = process.env.DATA_BUCKET ?? "mf-data-public";
const SOURCE_PREFIX = process.env.DATA_PREFIX ?? "backend_main_kartik";
const LOCAL_DIR = process.env.DATA_DIR;
const CACHE_DIR = process.env.DATA_CACHE_DIR ?? path.join(os.tmpdir(), "mf-data-cache");
const REFRESH_HOURS = Number(process.env.DATA_REFRESH_HOURS ?? 6);

export type Store = {
  conn: DuckDBConnection;
  loadedAt: number;
  buildId: string;
  asOf: { nav: string | null; sectorPeriod: string | null; sectorBase: string | null };
  funds: { code: string; name: string; grp: string }[];
};

export type Manifest = {
  build_id: string;
  built_at: string;
  tables: Record<string, string>; // table -> object path in the serving bucket
  meta: { nav: string | null; sectorPeriod: string | null; sectorBase: string | null; funds: number };
};

let current: Promise<Store> | null = null;
let refreshing = false;

export async function getStore(): Promise<Store> {
  if (!current) {
    current = load().catch((e) => {
      current = null;
      throw e;
    });
    return current;
  }
  const s = await current;
  if (!refreshing && Date.now() - s.loadedAt > REFRESH_HOURS * 3600_000) {
    refreshing = true;
    load(s.buildId)
      .then((fresh) => {
        if (fresh !== s) {
          current = Promise.resolve(fresh);
          s.conn.closeSync?.();
        }
      })
      .catch((e) => console.error(JSON.stringify({ type: "data_refresh_failed", error: String(e) })))
      .finally(() => (refreshing = false));
  }
  return s;
}

export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { conn } = await getStore();
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as unknown as T[];
}

async function finish(conn: DuckDBConnection, buildId: string, t0: number, mode: string): Promise<Store> {
  const meta = await readMeta(conn);
  const funds = (await conn.runAndReadAll(`SELECT scheme_code AS code, name, grp FROM universe`)).getRowObjectsJson() as unknown as Store["funds"];
  console.log(JSON.stringify({ type: "data_loaded", mode, build_id: buildId, funds: funds.length, ms: Date.now() - t0, nav_as_of: meta.nav }));
  return { conn, loadedAt: Date.now(), buildId, asOf: { nav: meta.nav, sectorPeriod: meta.sectorPeriod, sectorBase: meta.sectorBase }, funds };
}

// `sameAs`: on refresh, if the serving build hasn't changed, keep the current store.
async function load(sameAs?: string): Promise<Store> {
  const t0 = Date.now();
  if (SERVING_BUCKET) return loadServing(t0, sameAs);
  return loadRaw(t0);
}

async function loadServing(t0: number, sameAs?: string): Promise<Store> {
  const bucket = new Storage().bucket(SERVING_BUCKET!);
  const [buf] = await bucket.file("serving/manifest.json").download();
  const manifest = JSON.parse(buf.toString("utf8")) as Manifest;
  if (sameAs && manifest.build_id === sameAs && current) return current;

  const dir = path.join(CACHE_DIR, "serving", manifest.build_id.replace(/[^\w-]/g, ""));
  fs.mkdirSync(dir, { recursive: true });
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await Promise.all(
    SERVING_TABLES.map(async (t) => {
      const dest = path.join(dir, `${t}.parquet`);
      if (!fs.existsSync(dest)) {
        await bucket.file(manifest.tables[t]).download({ destination: `${dest}.part` });
        fs.renameSync(`${dest}.part`, dest);
      }
    }),
  );
  for (const t of SERVING_TABLES) await conn.run(`CREATE TABLE ${t} AS SELECT * FROM read_parquet(${sqlPath(path.join(dir, `${t}.parquet`))})`);
  return finish(conn, manifest.build_id, t0, "serving");
}

async function fetchRaw(): Promise<Record<RawFile, string>> {
  const out = {} as Record<RawFile, string>;
  if (LOCAL_DIR) {
    for (const f of RAW_FILES) out[f] = path.join(LOCAL_DIR, `${f}.parquet`);
    return out;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const bucket = new Storage().bucket(SOURCE_BUCKET);
  await Promise.all(
    RAW_FILES.map(async (f) => {
      const dest = path.join(CACHE_DIR, `${f}.parquet`);
      const fresh = fs.existsSync(dest) && Date.now() - fs.statSync(dest).mtimeMs < REFRESH_HOURS * 3600_000;
      if (!fresh) {
        await bucket.file(`${SOURCE_PREFIX}/${f}/latest/${f}.parquet`).download({ destination: `${dest}.part` });
        fs.renameSync(`${dest}.part`, dest);
      }
      out[f] = dest;
    }),
  );
  return out;
}

async function loadRaw(t0: number): Promise<Store> {
  const files = await fetchRaw();
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await buildServingTables(conn, files);
  return finish(conn, `raw-${new Date().toISOString()}`, t0, "raw");
}
