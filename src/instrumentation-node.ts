// Node.js only: load fund data before the first request, so the first user after a cold start doesn't wait.
import { getStore } from "@/lib/data/store";

getStore().catch((e) => console.error(JSON.stringify({ type: "data_preload_failed", error: String(e) })));
