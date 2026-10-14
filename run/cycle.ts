/**
 * run/cycle.ts — ראנר-הפעימות של-הצי (נקודת-כניסה-לקרון)
 * ═════════════════════════════════════════════════════════════════════════
 * שימוש:  bun run/cycle.ts --cycles 24 --out run/state
 * פלט:    run/state/report.json (דוח-כן אחרון) · run/state/ledger.json
 *         run/state/roots.txt (שרשרת-שורשים — שחזור-מלא)
 * שחזור:  אותו-גנזיס + אותו-מספר-מחזורים = אותו-stateRoot (מבחן-אוכף).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeRuntime, runCycle, runtimeStats } from "../src/index";

function argOf(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  const raw = process.argv[i + 1];
  return i >= 0 && raw ? raw : def;
}

const cycles = Math.max(1, Math.min(1_000, parseInt(argOf("--cycles", "24"), 10) || 24));
const outDir = argOf("--out", "run/state");
mkdirSync(outDir, { recursive: true });

// המשכיות-שחזור: הריצה-הזו משחזרת-מהגנזיס; השורשים חייבים-להיות-הרחבת-קידומת
// של-השרשרת-הקודמת (כל-שורש-משותף זהה ביט-בביט; חריגה = סטייה = כישלון-כן)
const rootsPath = join(outDir, "roots.txt");
const priorRoots = existsSync(rootsPath) ? readFileSync(rootsPath, "utf8").trim().split("\n").filter(Boolean) : [];

const rt = makeRuntime();
const t0 = Bun.nanoseconds();
for (let i = 0; i < cycles; i++) {
  runCycle(rt);
}
const ms = (Bun.nanoseconds() - t0) / 1e6;

const stats = runtimeStats(rt);
const last = rt.rootChain[rt.rootChain.length - 1];

// אימות-המשכיות: כל-שורש-משותף-בין-הריצה-הקודמת-לזו חייב-להיות-זהה
const shared = Math.min(priorRoots.length, rt.rootChain.length);
const diverged = priorRoots.length > 0 &&
  rt.rootChain.slice(0, shared).some((r, i) => r !== priorRoots[i]);
const continuity = priorRoots.length === 0
  ? "genesis"
  : diverged ? "DIVERGED" : "continued";
const newRoots = rt.rootChain.slice(priorRoots.length);

const allRoots = [...priorRoots, ...newRoots];
writeFileSync(rootsPath, allRoots.join("\n") + "\n");

const ledgerOut = {
  sim: true,
  cycles: stats.cycles,
  totalEquityMu: stats.totalEquityMu,
  genesisEquityMu: stats.genesisEquityMu,
  pnlMu: stats.pnlMu,
  treasuryMu: stats.treasuryMu,
  treasuryDeltaEqualsFees: stats.treasuryDeltaEqualsFees,
  chainRoot: stats.chainRoot,
  lastStateRoot: last,
  continuity,
  runMillis: Math.round(ms),
  fenceBlocked: rt.fence.blocked,
};
writeFileSync(join(outDir, "ledger.json"), JSON.stringify(ledgerOut, null, 2) + "\n");

console.log(JSON.stringify(ledgerOut, null, 2));
if (continuity === "DIVERGED") {
  console.error("FATAL: שרשרת-שורשים-סטתה — עוצרים-ולא-מדווחים-הצלחה");
  process.exit(1);
}
