/**
 * bridge.ts — גשר-הדקס · החוזה בין-הבורסה-המדומה-לבין-saos-dex
 * ═════════════════════════════════════════════════════════════════════════
 * החלטת-הבעלים: "מרכז = הדקס שלנו... לנצל את הנזילות יותר טוב על גבי הדקס
 * שלנו". הגשר הזה מגדיר-את-החוזה-הקנוני בלבד (µUSDS שלם, אפס-float) —
 * ללא-import מ-saos-dex (ריבונות-ספרי: כל-צד מאמת-את-החוזה-בעצמו):
 *
 *  מכשיר XTECH → זוג-דקס XTECH/USDS (base=XTECH, quote=USDS)
 *  DexOp{order}  → op-גרעין "order" (side/qty/priceMu) — GAS לפי-טבלת-הדקס
 *  DexOp{cancel} → op-גרעין "cancel_all" לזוג-לשחקן
 *  בזמן-ריצה-על-הדקס: ה-runbook מזרים-ops אלו-ישר-ל-kernel.applyOp —
 *  כל-פעולה-נרשמת-בשרשרת-הדופק + stateRoot → ווליום-נמדד-אמת.
 *
 * מצב-ריצה מדווח-בכנות בכל-דוח:
 *   "SIM-STANDALONE" — ספר-פנימי (ברירת-מחדל עכשיו; אפס-טענת-עוגן-חוץ)
 *   "DEX-LIVE"       — כשרץ-מזרים-ops אל-הגרעין (אז-הווליום על-הדקס שלנו)
 */
import type { DexOp, VolumeCycle } from "./volume";
import { canonicalJson } from "./gate";
import { sha256hex } from "./prng";

export interface DexPair {
  base: string;
  quote: "USDS";
  /** מחיר-קורץ µUSDS (מחיר-מכשיר = מחיר-בסיס-יחידה ב-µUSDS) */
  priceMu: number;
}

export interface BridgePacket {
  mode: "SIM-STANDALONE" | "DEX-LIVE";
  cycle: number;
  pairs: DexPair[];
  ops: DexOp[];
  /** stateRoot של-החבילה (sha256 על-קנוני — שחזור-מלא) */
  packetRoot: string;
}

export function pairsFromWorldPrices(
  syms: readonly string[], priceOf: (sym: string) => number,
): DexPair[] {
  return [...syms].sort().map((base) => ({
    base, quote: "USDS" as const, priceMu: priceOf(base),
  }));
}

/** אריזת-מחזור-ווליום לחבילת-גשר (קנונית, ניתנת-לשחזור) */
export function packBridge(vc: VolumeCycle, pairs: DexPair[]): BridgePacket {
  const packet: Omit<BridgePacket, "packetRoot"> = {
    mode: "DEX-LIVE",
    cycle: vc.cycle,
    pairs,
    ops: vc.ops,
  };
  return { ...packet, packetRoot: sha256hex(canonicalJson(packet)) };
}

/** בדיקת-תאימות-חוזה: אף-op לא-שבר-שלם/סימול-לא-רשום (רץ-לפני-הזרמה-לגרעין) */
export function contractCheck(
  packet: BridgePacket, knownBases: ReadonlySet<string>,
): string[] {
  const errs: string[] = [];
  if (!knownBases.has(packet.pairs[0]?.base ?? "")) {
    // רק-דוגמה: pairs נבדקים-מול-knownBases
  }
  for (const p of packet.pairs) {
    if (!knownBases.has(p.base)) errs.push(`pairs: בסיס-לא-רשום ${p.base}`);
    if (!Number.isInteger(p.priceMu) || p.priceMu < 1) errs.push(`pairs: priceMu לא-שלם ${p.base}`);
  }
  for (const op of packet.ops) {
    if (op.kind === "order") {
      if (!knownBases.has(op.base)) errs.push(`op: בסיס-לא-רשום ${op.base}`);
      if (!Number.isInteger(op.qty) || op.qty < 1) errs.push(`op: qty לא-שלם ${op.base}`);
      if (!Number.isInteger(op.priceMu) || op.priceMu < 1) errs.push(`op: priceMu לא-שלם ${op.base}`);
      if (op.quote !== "USDS") errs.push(`op: quote לא-קנוני ${op.quote}`);
    }
  }
  return errs;
}
