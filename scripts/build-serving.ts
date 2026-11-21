// Daily builder job (Cloud Run Job + Cloud Scheduler).
// Reads raw files from the origin (gs://mf-data-public/backend_main_kartik/<name>/latest/), builds the serving tables,
// checks them, and publishes to gs://<SERVING_BUCKET>/serving/<build_id>/ + serving/manifest.json (written LAST,
// so the app switches to a new build only when it is complete). If a check fails, nothing is published.
//
// Usage:
//   SERVING_BUCKET=gomf-serving npx tsx scripts/build-serving.ts        # build + publish
//   npx tsx scripts/build-serving.ts --out ./tmp-serving               # build to a local folder only (testing)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { Storage } from "@google-cloud/storage";
import { RAW_FILES, SERVING_TABLES, buildServingTables, rawObjectPath, readMeta, sqlPath, type HoldingsInput, type RawFile } from "../src/lib/data/build";
import { HOLDINGS_BUCKET, latestHoldingsFiles } from "../src/lib/data/sources";

const SOURCE_BUCKET = process.env.DATA_BUCKET ?? "mf-data-public";
const SOURCE_PREFIX = process.env.DATA_PREFIX ?? "backend_main_kartik";
const SERVING_BUCKET = process.env.SERVING_BUCKET;
const MAX_NAV_AGE_DAYS = Number(process.env.MAX_NAV_AGE_DAYS ?? 7);
const outIdx = process.argv.indexOf("--out");
const LOCAL_OUT = outIdx > 0 ? process.argv[outIdx + 1] : undefined;

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ type: "builder", ...o }));

async function main() {
  if (!SERVING_BUCKET && !LOCAL_OUT) throw new Error("Set SERVING_BUCKET (publish) or pass --out <dir> (local)");
  const t0 = Date.now();
  const storage = new Storage();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mf-build-"));

  // 1. fetch raw
  const files = {} as Record<RawFile, string>;
  await Promise.all(
    RAW_FILES.map(async (f) => {
      const dest = path.join(work, `${f}.parquet`);
      await storage.bucket(SOURCE_BUCKET).file(rawObjectPath(f, SOURCE_PREFIX)).download({ destination: dest });
      files[f] = dest;
    }),
  );
  // stock-level holdings: the newest monthly portfolio file
  const months = await latestHoldingsFiles(1, storage);
  if (!months.length) throw new Error(`No holdings files found in gs://${HOLDINGS_BUCKET}`);
  const local = await Promise.all(
    months.map(async (m) => {
      const dest = path.join(work, `holdings_${m.month}.csv`);
      await storage.bucket(HOLDINGS_BUCKET).file(m.path).download({ destination: dest });
      return { path: dest, period: m.folder };
    }),
  );
  const holdingsIn: HoldingsInput = { now: local[0] };
  log({ step: "fetched", ms: Date.now() - t0, holdings: months.map((m) => m.path) });

  // 2. build
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await buildServingTables(conn, files, holdingsIn);
  const meta = await readMeta(conn);

  // 3. sanity checks: never publish broken or stale data
  const [c] = (await conn.runAndReadAll(`
    SELECT count(*)::INT AS funds, count(score_balanced)::INT AS scored, count(DISTINCT grp)::INT AS groups,
           (SELECT count(*)::INT FROM alloc) AS alloc_rows, (SELECT count(*)::INT FROM sector_clean) AS sector_rows,
           (SELECT count(*)::INT FROM monthly) AS monthly_rows,
           (SELECT count(*)::INT FROM holdings) AS holdings_rows,
           (SELECT count(*)::INT FROM holdings_funds) AS holdings_funds,
           (SELECT count(*)::INT FROM holdings_funds WHERE aum_ratio BETWEEN 0.85 AND 1.15) AS holdings_funds_match_aum,
           (SELECT CAST(max(as_on) AS VARCHAR) FROM holdings_funds) AS holdings_as_on
    FROM universe`)).getRowObjectsJson() as Record<string, number>[];
  const navAgeDays = meta.nav ? (Date.now() - Date.parse(meta.nav)) / 86_400_000 : Infinity;
  const problems: string[] = [];
  if (c.funds < 1500) problems.push(`only ${c.funds} funds (expected 1500+)`);
  if (c.scored < 500) problems.push(`only ${c.scored} scored funds (expected 500+)`);
  if (c.groups < 50) problems.push(`only ${c.groups} peer groups (expected 50+)`);
  if (c.alloc_rows < 5000) problems.push(`only ${c.alloc_rows} allocation rows`);
  if (c.monthly_rows < 20000) problems.push(`only ${c.monthly_rows} monthly return rows`);
  if (c.holdings_rows < 50000) problems.push(`only ${c.holdings_rows} holding rows`);
  if (c.holdings_funds < 1000) problems.push(`holdings for only ${c.holdings_funds} funds`);
  const holdingsAge = (Date.now() - Date.parse(String(c.holdings_as_on))) / 86_400_000;
  if (!(holdingsAge <= 75)) problems.push(`latest holdings are ${Math.round(holdingsAge)} days old`);
  if (navAgeDays > MAX_NAV_AGE_DAYS) problems.push(`NAV data is ${navAgeDays.toFixed(1)} days old (max ${MAX_NAV_AGE_DAYS})`);
  log({ step: "checked", ...c, nav_as_of: meta.nav, problems });
  if (problems.length) throw new Error(`Not publishing: ${problems.join("; ")}`);

  // 4. write parquet
  const buildId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z"); // e.g. 20261119T203100Z
  const outDir = LOCAL_OUT ? path.resolve(LOCAL_OUT, buildId) : path.join(work, "out");
  fs.mkdirSync(outDir, { recursive: true });
  for (const t of SERVING_TABLES) await conn.run(`COPY ${t} TO ${sqlPath(path.join(outDir, `${t}.parquet`))} (FORMAT parquet, COMPRESSION zstd)`);

  const manifest = {
    build_id: buildId,
    built_at: new Date().toISOString(),
    source: `gs://${SOURCE_BUCKET}/${SOURCE_PREFIX}`,
    tables: Object.fromEntries(SERVING_TABLES.map((t) => [t, `serving/${buildId}/${t}.parquet`])),
    meta,
    counts: c,
  };

  // 5. publish: data files first, manifest last
  if (LOCAL_OUT) {
    fs.writeFileSync(path.join(path.resolve(LOCAL_OUT), "manifest.json"), JSON.stringify(manifest, null, 2));
    log({ step: "written_local", dir: outDir, ms: Date.now() - t0 });
  } else {
    const bucket = storage.bucket(SERVING_BUCKET!);
    for (const t of SERVING_TABLES) await bucket.upload(path.join(outDir, `${t}.parquet`), { destination: manifest.tables[t] });
    await bucket.file("serving/manifest.json").save(JSON.stringify(manifest, null, 2), { contentType: "application/json", metadata: { cacheControl: "no-store" } });
    log({ step: "published", bucket: SERVING_BUCKET, build_id: buildId, ms: Date.now() - t0 });
  }
  conn.closeSync?.();
  fs.rmSync(work, { recursive: true, force: true });
}

main().then(
  () => setTimeout(() => process.exit(0), 50),
  (e) => {
    console.error(JSON.stringify({ type: "builder", step: "failed", error: String(e) }));
    setTimeout(() => process.exit(1), 50);
  },
);
