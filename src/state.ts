/**
 * state.ts — מרשם-המדינה-הכלכלית · הניסוי "האם AI מנהל מדינה חדשנית"
 * ═════════════════════════════════════════════════════════════════════════
 * האוצר (מרכז-הכובד — החלטת-הבעלים) מחולק למשרדים; כל-משרד מנהל-מדיניות
 * מסחר-דטרמיניסטית על-מדדי-המגזרים. פנקס-P&L מדוד-וכן: אפס-טענת-רווח
 * שלא-נמדד, תווית-SIM גלויה-בכל-דוח (דוקטרינת-האמת של-האחוזה).
 *
 * שימור-אמת: cashMu(משרד) + Σ(qty×priceMu) = הון-משרד; Σ הון-משרדים
 * + מזומן-אוצר = הון-כולל (מוצהר-בגנזיס). מבחן-שימור אוכף-בכל-מחזור.
 */
import type { World } from "./engine";
import { instrumentBySym } from "./engine";
import { makeStream } from "./prng";

export type Ministry =
  | "technology" | "construction" | "intelligence"
  | "product" | "autonomy" | "policy";

export const MINISTRIES: readonly Ministry[] = [
  "technology", "construction", "intelligence",
  "product", "autonomy", "policy",
] as const;

/** סגנונות-מדיניות דטרמיניסטיים (שלמים בלבד) */
export type PolicyKind = "momentum" | "meanrev" | "hold";

export interface Policy {
  kind: PolicyKind;
  /** מדדים-מותרים-למשרד (שער-אבטחה: אפס-מסחר-מחוץ-לרשימה) */
  readonly allow: readonly string[];
  /** גודל-פוזיציה-מרבי למסחר-מחזור (µUSDS) */
  readonly clipMu: number;
  /** סף-מומנטום ב-bps שמעליו-פועלים */
  readonly thresholdBps: number;
}

export interface Position {
  qty: number; // מניות-שלמות (מנדף-שלם)
  avgMu: number; // מחיר-ממוצע-משוקלל (שלם)
}

export interface MinistryAccount {
  readonly name: Ministry;
  cashMu: number;
  positions: Record<string, Position>;
  policy: Policy;
  /** מונים-מדודים */
  tradesBuy: number;
  tradesSell: number;
  realizedPnlMu: number;
  feesMu: number;
}

export interface StateLedger {
  treasuryMu: number; // מזומן-אוצר-שלא-הוקצה
  ministries: Record<Ministry, MinistryAccount>;
  cycle: number;
  /** הון-כולל-מוצהר בגנזיס (אמת-שימור) */
  readonly genesisEquityMu: number;
  /** עלות-עסקה: 6bps (משתלם-לאוצר — סגור-בתוך-המערכת) */
  readonly feeBps: number;
}

/** תקציב-גנזיס: אוצר 1,000 USDS; כל-משרד 200 USDS — סקאלה שמאפשרת-מסחר
 *  אמיתי: מכשיר-ממוצע ~1.25-6.8M µUSDS/יחידה → קליפ-משרד ~12-30M µUSDS
 *  קונה-2-24-יחידות-לפעולה. אפס-סחר-אפסי-מתחת-ליחידה-אחת (מבחן-אוכף). */
export const GENESIS_TREASURY_MU = 1_000_000_000;
export const MINISTRY_BUDGET_MU = 200_000_000;
export const GENESIS_FEE_BPS = 6;

/** מדדים-מותרים פר-משרד — הרשאת-סוכן-מינימלית (אבטחה: הכל-ברירת-מחדל-אסור) */
const POLICY_ALLOW: Record<Ministry, readonly string[]> = {
  technology:   ["XTECH", "XAI", "XROB"],
  construction: ["XCONS", "XRE", "XNRG"],
  intelligence: ["XAI", "XDEF", "XBIO"],
  product:      ["XTECH", "XSHIP", "XFIN"],
  autonomy:     ["XROB", "XNRG", "XTECH"],
  policy:       ["XFIN", "XDEF", "XRE"],
};
const POLICY_KIND: Record<Ministry, PolicyKind> = {
  technology: "momentum", construction: "meanrev", intelligence: "momentum",
  product: "meanrev", autonomy: "momentum", policy: "hold",
};
const POLICY_CLIP_MU: Record<Ministry, number> = {
  technology: 30_000_000, construction: 25_000_000, intelligence: 30_000_000,
  product: 20_000_000, autonomy: 26_000_000, policy: 12_000_000,
};
const POLICY_THRESHOLD_BPS: Record<Ministry, number> = {
  technology: 40, construction: 30, intelligence: 60,
  product: 35, autonomy: 45, policy: 10_000, // hold — מעשי-לא-נפתחים
};

export function makeState(): StateLedger {
  const ministries = {} as Record<Ministry, MinistryAccount>;
  for (const m of MINISTRIES) {
    ministries[m] = {
      name: m,
      cashMu: MINISTRY_BUDGET_MU,
      positions: {},
      policy: {
        kind: POLICY_KIND[m],
        allow: POLICY_ALLOW[m],
        clipMu: POLICY_CLIP_MU[m],
        thresholdBps: POLICY_THRESHOLD_BPS[m],
      },
      tradesBuy: 0, tradesSell: 0, realizedPnlMu: 0, feesMu: 0,
    };
  }
  return {
    treasuryMu: GENESIS_TREASURY_MU,
    ministries,
    cycle: 0, // גנזיס=0; מתעדכן-בכל-מחזור-משרד
    genesisEquityMu: GENESIS_TREASURY_MU + MINISTRIES.length * MINISTRY_BUDGET_MU,
    feeBps: GENESIS_FEE_BPS,
  };
}

export interface TradeDecision {
  ministry: Ministry;
  sym: string;
  side: "buy" | "sell";
  qty: number;
  priceMu: number;
  feeMu: number;
}

/** שלמות-שימוש-מזומן: דורש cashMu ≥ cost+fee בקנייה; qty ≤ מלאי במכירה */
function executeTrade(
  st: StateLedger, acc: MinistryAccount,
  sym: string, side: "buy" | "sell", qty: number, priceMu: number,
): TradeDecision | null {
  if (!Number.isInteger(qty) || qty <= 0) return null;
  if (!Number.isInteger(priceMu) || priceMu < 1) return null;
  const feeMu = Math.floor((qty * priceMu * st.feeBps) / 10_000);
  if (side === "buy") {
    const cost = qty * priceMu;
    if (cost > Number.MAX_SAFE_INTEGER - feeMu) return null;
    const total = cost + feeMu;
    if (acc.cashMu < total) return null;
    acc.cashMu -= total;
    acc.feesMu += feeMu;
    acc.tradesBuy += 1;
    const p = acc.positions[sym];
    if (p) {
      const newQty = p.qty + qty;
      p.avgMu = Math.floor((p.avgMu * p.qty + priceMu * qty) / newQty);
      p.qty = newQty;
    } else {
      acc.positions[sym] = { qty, avgMu: priceMu };
    }
    return { ministry: acc.name, sym, side, qty, priceMu, feeMu };
  } else {
    const p = acc.positions[sym];
    if (!p || p.qty < qty) return null;
    const proceeds = qty * priceMu;
    if (proceeds > Number.MAX_SAFE_INTEGER - 1) return null;
    acc.cashMu += proceeds - feeMu;
    acc.feesMu += feeMu;
    acc.tradesSell += 1;
    acc.realizedPnlMu += (priceMu - p.avgMu) * qty - feeMu;
    p.qty -= qty;
    if (p.qty === 0) delete acc.positions[sym];
    return { ministry: acc.name, sym, side, qty, priceMu, feeMu };
  }
}

/**
 * מדיניות-מחזור: החלטה-דטרמיניסטית מהמומנטום של-המחזור-הקודם.
 * momentum: קונה-סגירה>פתיחה-חיובי מעל-סף; מוכר-פוזיציה-במומנטום-שלילי.
 * meanrev: ההפך. hold: אין-מסחר (משרד-מדיניות — מודד-ומדווח בלבד).
 */
export function runMinistryCycle(
  st: StateLedger, world: World, m: Ministry, cycleIndex: number,
): TradeDecision[] {
  const acc = st.ministries[m];
  const out: TradeDecision[] = [];
  if (acc.policy.kind === "hold") { st.cycle = cycleIndex; return out; }
  for (const sym of acc.policy.allow) {
    const inst = instrumentBySym(world, sym);
    const s = makeStream(inst.seedHex, `policy:${m}:${cycleIndex}`);
    const momBps = Math.floor(
      ((inst.last.closeMu - inst.last.openMu) * 10_000) / Math.max(1, inst.last.openMu),
    );
    const bull = momBps >= acc.policy.thresholdBps;
    const bear = momBps <= -acc.policy.thresholdBps;
    const pos = acc.positions[sym];
    let want: "buy" | "sell" | null = null;
    if (acc.policy.kind === "momentum") {
      if (bull && !pos) want = "buy";
      else if (bear && pos) want = "sell";
    } else { // meanrev
      if (bear && !pos) want = "buy";
      else if (bull && pos) want = "sell";
    }
    if (!want) continue;
    if (want === "buy") {
      // גודל: clipMu מול-מזומן-זמין, מנוכה-עתודה-גז (10%) — שלם
      const budget = Math.min(acc.policy.clipMu, Math.floor((acc.cashMu * 90) / 100));
      const qty = Math.max(0, Math.floor(budget / inst.priceMu));
      if (qty < 1) continue;
      // פיזור-זעיר-דטרמיניסטי: קיצוץ-עד-5% מהכמות
      const jitter = s.int(Math.max(1, Math.floor(qty / 20)));
      const qtyJ = Math.max(1, qty - jitter);
      const d = executeTrade(st, acc, sym, "buy", qtyJ, inst.priceMu);
      if (d) out.push(d);
    } else {
      const d = executeTrade(st, acc, sym, "sell", pos!.qty, inst.priceMu);
      if (d) out.push(d);
    }
  }
  st.cycle = cycleIndex;
  return out;
}

/** הון-משרד מדוד (מזומן + מלאי לפי-מחיר-שוק-עכשיו) */
export function ministryEquityMu(acc: MinistryAccount, world: World): number {
  let eq = acc.cashMu;
  for (const [sym, p] of Object.entries(acc.positions)) {
    eq += p.qty * instrumentBySym(world, sym).priceMu;
  }
  return eq;
}

/** הון-כולל מדוד (אוצר + כל-המשרדים) — חייב == genesisEquityMu (שימור-שלם) */
export function totalEquityMu(st: StateLedger, world: World): number {
  let eq = st.treasuryMu;
  for (const m of MINISTRIES) eq += ministryEquityMu(st.ministries[m], world);
  return eq;
}

/** דמי-מסחר-המחזור משתלמים-לאוצר (סגור-בתוך-המערכת — נרשם-ב-runCycle) */
export function sweepFeesToTreasury(st: StateLedger, feesThisCycleMu: number): void {
  if (!Number.isInteger(feesThisCycleMu) || feesThisCycleMu < 0) {
    throw new Error("gate: fees דורש שלם ≥ 0");
  }
  st.treasuryMu += feesThisCycleMu;
}
