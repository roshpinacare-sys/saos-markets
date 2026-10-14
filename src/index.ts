/**
 * index.ts — ה-API הפומבי של-saos-markets · מחזור-מלא-בשיחה-אחת
 * ═════════════════════════════════════════════════════════════════════════
 * runCycle() = הפעימה-הקנונית: התקדמות-שווקים → מדיניות-משרדים → ווליום
 * → איסוף-עמלים-לאוצר → דוח-כן. אפס-תלות-ריצה; אפס-float; אפס-Date.now.
 */
import { advanceWorld, makeWorld, type World } from "./engine";
import {
  makeState, runMinistryCycle, sweepFeesToTreasury, totalEquityMu,
  GENESIS_TREASURY_MU,
  type StateLedger, type TradeDecision,
} from "./state";
import { auditVolume, runVolumeCycle, type VolumeCycle } from "./volume";
import { buildReport, type StateReport } from "./report";
import { assertAllIntegers, canonicalJson, makeFence, type FenceRecord } from "./gate";
import { sha256hex } from "./prng";
import { pairsFromWorldPrices, packBridge, contractCheck, type BridgePacket } from "./bridge";

export { makeWorld, advanceWorld } from "./engine";
export { makeState, MINISTRIES, GENESIS_TREASURY_MU } from "./state";
export { runVolumeCycle, auditVolume } from "./volume";
export { buildReport, SIM_LABEL } from "./report";
export { makeFence, gateTradeIntent, assertAllIntegers, canonicalJson } from "./gate";
export { packBridge, contractCheck, pairsFromWorldPrices } from "./bridge";
export { makeStream, GENESIS_SEED, sha256hex } from "./prng";

export interface CycleResult {
  cycle: number;
  report: StateReport;
  trades: TradeDecision[];
  volume: VolumeCycle;
  bridge: BridgePacket;
  fence: FenceRecord;
  /** stateRoot של-הדוח (ראש-השרשרת-המדומה) */
  stateRoot: string;
}

export interface MarketRuntime {
  world: World;
  state: StateLedger;
  fence: FenceRecord;
  cycle: number;
  cumMakerMu: number;
  cumTakerMu: number;
  /** historyRoot: sha256-שרשרת-שורשי-דוחות (זיכרון-חוץ-קל) */
  rootChain: string[];
}

export function makeRuntime(): MarketRuntime {
  return {
    world: makeWorld(),
    state: makeState(),
    fence: makeFence(),
    cycle: 0, // גנזיס=0; פעימה-ראשונה = מחזור 1 (מתואם-למספור-מכשירים)
    cumMakerMu: 0,
    cumTakerMu: 0,
    rootChain: [],
  };
}

/** פעימה-קנונית אחת — הלב של-הצי-על-הדקס-שלנו */
export function runCycle(rt: MarketRuntime): CycleResult {
  const next = rt.cycle + 1;
  advanceWorld(rt.world, 1);

  // 1) מדיניות-משרדים (קנוני: סדר-המשרדים המוצהר)
  const trades: TradeDecision[] = [];
  let feesMu = 0;
  for (const m of ["technology", "construction", "intelligence", "product", "autonomy", "policy"] as const) {
    for (const d of runMinistryCycle(rt.state, rt.world, m, next)) {
      trades.push(d);
      feesMu += d.feeMu;
    }
  }
  // 2) עמלים → האוצר (מרכז-הכובד; סגור-בתוך-המערכת)
  sweepFeesToTreasury(rt.state, feesMu);

  // 3) ווליום: makers+takers — שטח-הפעילות-הראשי של-הצי
  const vc = runVolumeCycle(rt.world, next);
  const audit = auditVolume(vc);
  if (!audit.ok) throw new Error("integrity: חשבון-ווליום לא-מתחייב (bug — עוצרים)");
  rt.cumMakerMu += vc.notionalMakerMu;
  rt.cumTakerMu += vc.notionalTakerMu;

  // 4) דוח-כן + גשר
  const report = buildReport(rt.state, rt.world, vc, rt.cumMakerMu, rt.cumTakerMu, "DEX-LIVE");
  const ints = assertAllIntegers(report);
  if (ints.length > 0) throw new Error(`integrity: שברים-בפלט ${ints[0]}`);

  const syms = [...rt.world.keys()].sort();
  const pairs = pairsFromWorldPrices(syms, (s) => rt.world.get(s)!.priceMu);
  const bridge = packBridge(vc, pairs);
  const errs = contractCheck(bridge, new Set(syms));
  if (errs.length > 0) throw new Error(`bridge: חוזה-נכשל ${errs[0]}`);

  rt.cycle = next;
  rt.rootChain.push(report.stateRoot);

  return {
    cycle: next,
    report,
    trades,
    volume: vc,
    bridge,
    fence: rt.fence,
    stateRoot: report.stateRoot,
  };
}

/** מדדי-עומק לדוח-ריצה (כנה): אין-הדפסה/שריפה — דלתא-אוצר == עמלים-שנגבו;
 *  הון-כולל נמדד-לפי-מחירי-שוק (P&L חי); אפס-טענת-שימור-שווא. */
export function runtimeStats(rt: MarketRuntime): {
  cycles: number;
  totalEquityMu: number;
  genesisEquityMu: number;
  pnlMu: number;
  treasuryMu: number;
  treasuryDeltaEqualsFees: boolean;
  chainRoot: string;
} {
  const eq = totalEquityMu(rt.state, rt.world);
  const fees = Object.values(rt.state.ministries).reduce((s, m) => s + m.feesMu, 0);
  return {
    cycles: rt.cycle, // מספר-הפעימות-שבוצעו (גנזיס=0)
    totalEquityMu: eq,
    genesisEquityMu: rt.state.genesisEquityMu,
    pnlMu: eq - rt.state.genesisEquityMu,
    treasuryMu: rt.state.treasuryMu,
    treasuryDeltaEqualsFees:
      (rt.state.treasuryMu - GENESIS_TREASURY_MU) === fees,
    chainRoot: sha256hex(canonicalJson(rt.rootChain)),
  };
}
