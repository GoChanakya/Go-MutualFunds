// Locates monthly portfolio files: gs://amc-csv-data/<Month><YY>/Merged_data.csv (e.g. "October26", "Apr25").
// Folder names aren't uniform ("Apr25" and "April25" both exist), so months are parsed from the first three letters
// and, when a month appears twice, the most recently updated file wins. Used by the builder job and by local dev.
import { Storage } from "@google-cloud/storage";

export const HOLDINGS_BUCKET = process.env.HOLDINGS_BUCKET ?? "amc-csv-data";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type HoldingsFile = { month: string; folder: string; path: string; updated: string };

export async function latestHoldingsFiles(n = 2, storage = new Storage()): Promise<HoldingsFile[]> {
  const [files] = await storage.bucket(HOLDINGS_BUCKET).getFiles({ matchGlob: "*/Merged_data.csv" });
  const byMonth = new Map<string, HoldingsFile>();
  for (const f of files) {
    const folder = f.name.split("/")[0];
    const m = folder.match(/^([A-Za-z]+?)(\d{2})$/);
    const mi = m ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
    if (!m || mi < 0) continue;
    const month = `20${m[2]}-${String(mi + 1).padStart(2, "0")}`;
    const updated = String(f.metadata.updated ?? "");
    const prev = byMonth.get(month);
    if (!prev || updated > prev.updated) byMonth.set(month, { month, folder, path: f.name, updated });
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, n);
}
