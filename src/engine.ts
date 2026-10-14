/**
 * engine.ts — מנוע-השווקים-העולמי-המדומה · מדדי-המגזרים של-המדינה
 * ═════════════════════════════════════════════════════════════════════════
 * מדדי-ארכיטיפ של-שווקים-מובילים (טכנולוגיה · בינה-מלאכותית · בנייה · אנרגיה ·
 * הגנה · ביוטק · נדל"ן · משלוחים · פיננסים · רובוטיקה) — **סימולציה כנה**:
 * אלה-אינם-מחירי-בורסה-אמיתיים-ולא-ניזונים-מהם. אפס-fetch-חוץ. כל-מחיר µUSDS
 * (שלם). התנועה: הליכה-רב-פעמית-גיאומטרית-שלמה —
 *     price' = price × (10_000 + drift + noise) / 10_000
 * כאשר noise ∈ [-vol, +vol] bps נשאב-מזרם-PRNG פר-מכשיר-ומונח-מחזור.
 * שחזור: אותו-גנזיס + אותו-מחזור = אותו-מחיר. נקודה.
 */
import { makeStream, sha256hex, type PrngStream } from "./prng";

export type Sector =
  | "TECH" | "AI" | "CONS" | "NRG" | "DEF"
  | "BIO" | "RE" | "SHIP" | "FIN" | "ROB";

export interface Instrument {
  /** סימול-קנוני (מקובע) */
  readonly sym: string;
  /** שם-עברי-מקצועי */
  readonly name: string;
  readonly sector: Sector;
  /** זרע-זרם-פר-מכשיר (פומבי, קבוע — חלק-מהגדרת-המכשיר) */
  readonly seedHex: string;
  /** מחיר-נוכחי בµUSDS (שלם ≥ 1) */
  priceMu: number;
  /** דריפה-מחזורית ב-bps (שלם, יכול-להיות-שלילי) */
  readonly driftBps: number;
  /** תנודתיות-מחזורית ב-bps (שלם ≥ 1) */
  readonly volBps: number;
  /** מחיר-גנזיס µUSDS — עוגן-דוחות */
  readonly refPriceMu: number;
  /** מונה-מחזורים-שחוללו (לשחזור) */
  cycle: number;
  /** נתוני-מחזור-אחרון: open/high/low/close µUSDS */
  last: { openMu: number; highMu: number; lowMu: number; closeMu: number };
}

/** הגנזיס: 10 מגזרים = המטבע-המדוד של-המדינה-הכלכלית (הודעת-הבעלים) */
export const INSTRUMENTS: ReadonlyArray<{
  sym: string; name: string; sector: Sector;
  priceMu: number; driftBps: number; volBps: number;
}> = Object.freeze([
  { sym: "XTECH", name: "מדד-טכנולוגיה",           sector: "TECH", priceMu: 4_200_000, driftBps:  +4, volBps: 220 },
  { sym: "XAI",   name: "בינה-מלאכותית",           sector: "AI",   priceMu: 6_800_000, driftBps:  +9, volBps: 340 },
  { sym: "XCONS", name: "בנייה-ותשתיות",           sector: "CONS", priceMu: 1_650_000, driftBps:  +1, volBps:  90 },
  { sym: "XNRG",  name: "אנרגיה",                  sector: "NRG",  priceMu: 2_100_000, driftBps:  +2, volBps: 140 },
  { sym: "XDEF",  name: "הגנה-וביטחון",            sector: "DEF",  priceMu: 3_050_000, driftBps:  +3, volBps: 160 },
  { sym: "XBIO",  name: "ביוטק",                   sector: "BIO",  priceMu: 5_400_000, driftBps:  0,  volBps: 380 },
  { sym: "XRE",   name: "נדל״ן",                  sector: "RE",   priceMu: 2_850_000, driftBps:  +1, volBps:  60 },
  { sym: "XSHIP", name: "משלוחים-ולוגיסטיקה",      sector: "SHIP", priceMu: 1_250_000, driftBps:  +2, volBps: 180 },
  { sym: "XFIN",  name: "פיננסים",                 sector: "FIN",  priceMu: 3_400_000, driftBps:  +2, volBps: 120 },
  { sym: "XROB",  name: "רובוטיקה-ואוטומציה",      sector: "ROB",  priceMu: 4_900_000, driftBps:  +7, volBps: 260 },
]);

/** עולם-חי: המכשירים-במצב-ריצה */
export type World = Map<string, Instrument>;

/** גנזיס-עולם-דטרמיניסטי */
export function makeWorld(seedHex: string = GENESIS_SEED_DEFAULT): World {
  const w: World = new Map();
  for (const d of INSTRUMENTS) {
    const seed = deriveSeed(seedHex, d.sym);
    const inst: Instrument = {
      sym: d.sym, name: d.name, sector: d.sector,
      seedHex: seed,
      priceMu: d.priceMu,
      driftBps: d.driftBps, volBps: d.volBps,
      refPriceMu: d.priceMu,
      cycle: 0,
      last: { openMu: d.priceMu, highMu: d.priceMu, lowMu: d.priceMu, closeMu: d.priceMu },
    };
    w.set(d.sym, inst);
  }
  return w;
}

const GENESIS_SEED_DEFAULT = "c6e021a64b40db1c023c3e094de1d9cc132ebec65ff4c8cf51a7766dee69c20a";

/** גזירת-זרע-פר-מכשיר מהזרע-הראשי (sha256 — דטרמיניסטי) */
export function deriveSeed(rootSeedHex: string, sym: string): string {
  return sha256hex(`${rootSeedHex}:${sym}`);
}

/** מזהה-מכשיר מתוך-סימול (שער-קלט מאומת) */
export function instrumentBySym(world: World, sym: string): Instrument {
  if (!/^[A-Z]{2,8}$/.test(sym)) throw new Error(`gate: sym נדרה [A-Z]{2,8}`);
  const inst = world.get(sym);
  if (!inst) throw new Error(`gate: מכשיר-לא-רשום ${sym}`);
  return inst;
}

/**
 * צעד-מחזור-אחד-על-מכשיר — שלם-טהור.
 * convention: fill-מחזור = מחיר-סגירה (מתועד-וכן; גרסת-הדקס מבצעת-על-הספר-האמיתי).
 */
export function stepInstrument(inst: Instrument, cycleIndex: number): void {
  const s: PrngStream = makeStream(inst.seedHex, `cycle:${cycleIndex}`);
  const noise = s.signed(inst.volBps);
  const stepBps = inst.driftBps + noise;
  const num = 10_000 + stepBps;
  if (num <= 0) {
    // מגן-עודף: דריפה+רעש-קיצוני-לא-יורד-מתחת-ל--9999bps (volBps קטן-מ-10k)
    inst.priceMu = 1;
  } else {
    // ריצופ-שלם-קנוני: (price × num) / 10_000 עם-עיגול-לרצפה + מינימום 1
    const next = Math.floor((inst.priceMu * num) / 10_000);
    inst.priceMu = Math.max(1, next);
  }
  inst.cycle = cycleIndex;
  inst.last = {
    openMu: inst.last.closeMu,
    highMu: Math.max(inst.last.closeMu, inst.priceMu),
    lowMu: Math.min(inst.last.closeMu, inst.priceMu),
    closeMu: inst.priceMu,
  };
}

/** התקדמות-עולם-שלמה N מחזורים (שומר-שלמות-סדר) */
export function advanceWorld(world: World, cycles: number): void {
  if (!Number.isInteger(cycles) || cycles < 0 || cycles > 1_000_000) {
    throw new Error(`gate: cycles דורש שלם 0..1M, קיבל ${cycles}`);
  }
  const syms = [...world.keys()].sort(); // סדר-קנוני
  const start = Math.max(...syms.map((s) => world.get(s)!.cycle), -1);
  for (let c = start + 1; c <= start + cycles; c++) {
    for (const sym of syms) stepInstrument(world.get(sym)!, c);
  }
}
