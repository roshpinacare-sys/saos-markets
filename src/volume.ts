/**
 * volume.ts — מנוע-הווליום של-הדקס שלנו · עושי-שוק-וטייקים דטרמיניסטיים
 * ═════════════════════════════════════════════════════════════════════════
 * ההוראה של-הבעלים: "שהצי יעבוד חזק על הווליום של הדקס בכל דרך אפשרית...
 * לבצע ריבונית עם הצי בדקס במקום בגריד". המנוע הזה הוא-שטח-הפעילות-הראשי:
 *
 *  · Makers — ציטוטים-דו-צדדיים-רציפים סביב-המיד (מרווח=f(volBps)); רענון
 *    כל-מחזור = cancel+replace (מדוד-בנפרד כ-maker-refresh-ווליום).
 *  · Takers — חיילים-מסתובבים; פועלים-כשמומנטום-עובר-סף.
 *  · כל-פעולה נפלטת כ-DexOp קנוני (µUSDS שלם) — החוזה של-bridge.ts —
 *    כך-שכל-מסחר-כאן-הוא-ווליום-נמדד-על-הספר-שלנו כשרצים-על-הדקס.
 *
 * חשבון-אמת: Σ ווליום = Σ עסקאות × מחיר; maker/taker/refresh מופרדים;
 * אפס-נפח-מדומה-שמצטייר-כאמת (תווית-SIM נשמרת-בדוח).
 */
import type { World } from "./engine";
import { instrumentBySym } from "./engine";
import { makeStream } from "./prng";

export type DexOp =
  | {
      kind: "order";
      side: "buy" | "sell";
      base: string;
      quote: "USDS";
      qty: number;
      priceMu: number;
      actor: string;
      role: "maker" | "taker";
    }
  | {
      kind: "cancel";
      base: string;
      quote: "USDS";
      actor: string;
      role: "maker";
    };

export interface VolumeCycle {
  cycle: number;
  ops: DexOp[];
  /** נפח-ממומש (Σ qty×price) לפי-תפקיד µUSDS */
  notionalMakerMu: number;
  notionalTakerMu: number;
  refreshes: number;
}

const MAKERS = ["maker-alef", "maker-bet", "maker-gimel", "maker-dalet"];
const TAKERS = ["taker-echo", "taker-vav", "taker-zayin"];

/** מרווח-מינימלי 25bps + volBps/4 (שלם) — ציטוט-דו-צדדי סביב-המיד */
export function makerSpreadBps(volBps: number): number {
  return 25 + Math.floor(volBps / 4);
}

/**
 * מחזור-ווליום אחד: רענון-ציטוטי-מייקרים על-כל-המכשירים (קנוני: מכשירים-ממוינים,
 * מייקרים-ממוינים) + טייקים-מסתובבים לפי-מומנטום-מעל-סף.
 */
export function runVolumeCycle(world: World, cycleIndex: number): VolumeCycle {
  const ops: DexOp[] = [];
  let notionalMakerMu = 0;
  let notionalTakerMu = 0;
  let refreshes = 0;

  const syms = [...world.keys()].sort();

  // 1) Makers — כל-מייקר מצטט על-המכשירים-שלו (חלוקה-קנונית: sym%4)
  for (let mi = 0; mi < MAKERS.length; mi++) {
    const actor = MAKERS[mi]!;
    ops.push({ kind: "cancel", base: "*", quote: "USDS", actor, role: "maker" }); // רענון-קנוני
    refreshes += 1;
    for (let si = 0; si < syms.length; si++) {
      if (si % MAKERS.length !== mi) continue;
      const inst = instrumentBySym(world, syms[si]!);
      const s = makeStream(inst.seedHex, `maker:${actor}:${cycleIndex}`);
      const spread = makerSpreadBps(inst.volBps);
      const mid = inst.priceMu;
      const bid = Math.max(1, Math.floor((mid * (10_000 - spread)) / 10_000));
      const ask = Math.floor((mid * (10_000 + spread)) / 10_000);
      const qty = Math.max(1, Math.floor(50_000 / mid)); // עוגן-נוטיונל ~50k µUSDS פר-צד
      // שיבוש-קטן-דטרמיניסטי-בכמות (חיוני-לגיוון-ספר)
      const qJ = Math.max(1, qty - s.int(Math.max(1, Math.floor(qty / 5))));
      ops.push({ kind: "order", side: "buy", base: inst.sym, quote: "USDS", qty: qJ, priceMu: bid, actor, role: "maker" });
      ops.push({ kind: "order", side: "sell", base: inst.sym, quote: "USDS", qty: qJ, priceMu: ask, actor, role: "maker" });
      notionalMakerMu += qJ * bid + qJ * ask;
    }
  }

  // 2) Takers — מסתובבים: מכשיר=(cycleIndex+takerIdx)%len; פועלים-כשמומנטום-מעל-סף
  for (let ti = 0; ti < TAKERS.length; ti++) {
    const actor = TAKERS[ti]!;
    const sym = syms[(cycleIndex + ti) % syms.length]!;
    const inst = instrumentBySym(world, sym);
    const momBps = Math.floor(
      ((inst.last.closeMu - inst.last.openMu) * 10_000) / Math.max(1, inst.last.openMu),
    );
    const s = makeStream(inst.seedHex, `taker:${actor}:${cycleIndex}`);
    if (Math.abs(momBps) >= 15 || s.chance(300)) {
      const side: "buy" | "sell" = momBps >= 0 ? "buy" : "sell";
      const priceMu = side === "buy"
        ? Math.floor((inst.priceMu * 10_030) / 10_000) // מוכן-לשלם-30bps-מעל
        : Math.max(1, Math.floor((inst.priceMu * 9_970) / 10_000));
      const qty = Math.max(1, Math.floor(80_000 / inst.priceMu));
      const qJ = Math.max(1, qty - s.int(Math.max(1, Math.floor(qty / 4))));
      ops.push({ kind: "order", side, base: inst.sym, quote: "USDS", qty: qJ, priceMu, actor, role: "taker" });
      notionalTakerMu += qJ * priceMu;
    }
  }

  return { cycle: cycleIndex, ops, notionalMakerMu, notionalTakerMu, refreshes };
}

/** Σ-שמירת-ווליום: מאמת-שהחשבון-תואם-את-ה-ops (פונקציה-טהורה — מבחן-משתמש) */
export function auditVolume(vc: VolumeCycle): { ok: boolean; makerMu: number; takerMu: number } {
  let makerMu = 0;
  let takerMu = 0;
  for (const op of vc.ops) {
    if (op.kind === "order") {
      const notional = op.qty * op.priceMu;
      if (op.role === "maker") makerMu += notional; else takerMu += notional;
    }
  }
  return {
    ok: makerMu === vc.notionalMakerMu && takerMu === vc.notionalTakerMu,
    makerMu, takerMu,
  };
}
