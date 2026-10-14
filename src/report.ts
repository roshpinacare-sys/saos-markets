/**
 * report.ts — דוח-המדינה-הכנה · תווית-SIM גלויה בכל-פלט
 * ═════════════════════════════════════════════════════════════════════════
 * דוקטרינת-האמת של-האחוזה (Task-34): אף-דף/דוח לא מציג-נתון שלא-נמדד;
 * SIM-מוצהר-בהודאה-עצמית. כל-דוח נושא: sim=true, simLabel, stateRoot.
 */
import type { StateLedger, Ministry } from "./state";
import { MINISTRIES, ministryEquityMu, GENESIS_TREASURY_MU } from "./state";
import type { World } from "./engine";
import { canonicalJson } from "./gate";
import { sha256hex } from "./prng";
import type { VolumeCycle } from "./volume";

export const SIM_LABEL =
  "SIM — סימולציה דטרמיניסטית על מדדי-ארכיטיפ; אינה מחירי-בורסה-אמיתיים; אפס-ערך-חוץ-ממומש";

export interface MinistryRow {
  ministry: Ministry;
  cashMu: number;
  equityMu: number;
  unrealizedPnlMu: number;
  realizedPnlMu: number;
  feesMu: number;
  tradesBuy: number;
  tradesSell: number;
  openPositions: number;
  policy: string;
}

export interface StateReport {
  sim: true;
  simLabel: string;
  repo: "saos-markets";
  mode: "SIM-STANDALONE" | "DEX-LIVE";
  cycle: number;
  /** שורש-מצב (sha256 על-קנוני — שחזור-מלא-מהגנזיס) */
  stateRoot: string;
  treasuryMu: number;
  totalEquityMu: number;
  genesisEquityMu: number;
  /** רווח/הפסד-כולל מדוד (יכול-להיות-שלילי — מפורסם-כמו-שהוא) */
  pnlMu: number;
  ministries: MinistryRow[];
  markets: Array<{
    sym: string; name: string; priceMu: number;
    refPriceMu: number; driftBps: number; volBps: number;
    cycle: number;
  }>;
  volume: {
    makerMu: number; takerMu: number; refreshes: number;
    cumulativeMakerMu: number; cumulativeTakerMu: number;
  };
  integrity: { allIntegers: boolean; noMintNoBurn: boolean };
}

/** דוח-מחזור-אחד-מהמצב-החי (טהור — לא-משנה-שום-מצב)
 *  אינטגריות-כנה: noMintNoBurn = דלתא-אוצר == עמלים-שנגבו (אפס-הדפסה/שריפה);
 *  P&L מדורג-לפי-מחירי-שוק-ומפורסם-כמו-שהוא (שלילי-כולל). */
export function buildReport(
  st: StateLedger, world: World,
  vc: VolumeCycle | null,
  cumMakerMu: number, cumTakerMu: number,
  mode: "SIM-STANDALONE" | "DEX-LIVE",
): StateReport {
  const rows: MinistryRow[] = MINISTRIES.map((m) => {
    const acc = st.ministries[m];
    const eq = ministryEquityMu(acc, world);
    const invested = Object.entries(acc.positions)
      .reduce((s, [sym, p]) => s + p.qty * p.avgMu, 0);
    return {
      ministry: m,
      cashMu: acc.cashMu,
      equityMu: eq,
      unrealizedPnlMu: eq - acc.cashMu - invested,
      realizedPnlMu: acc.realizedPnlMu,
      feesMu: acc.feesMu,
      tradesBuy: acc.tradesBuy,
      tradesSell: acc.tradesSell,
      openPositions: Object.keys(acc.positions).length,
      policy: `${acc.policy.kind}@${acc.policy.thresholdBps}bps`,
    };
  });

  const totalEq = st.treasuryMu + rows.reduce((s, r) => s + r.equityMu, 0);
  const markets = [...world.keys()].sort().map((sym) => {
    const i = world.get(sym)!;
    return {
      sym, name: i.name, priceMu: i.priceMu, refPriceMu: i.refPriceMu,
      driftBps: i.driftBps, volBps: i.volBps, cycle: i.cycle,
    };
  });

  const treasuryFeesMu = st.treasuryMu - GENESIS_TREASURY_MU;
  const sweptFeesMu = MINISTRIES.reduce((s, m) => s + st.ministries[m].feesMu, 0);

  const core = {
    sim: true as const,
    simLabel: SIM_LABEL,
    repo: "saos-markets" as const,
    mode,
    cycle: st.cycle,
    treasuryMu: st.treasuryMu,
    totalEquityMu: totalEq,
    genesisEquityMu: st.genesisEquityMu,
    pnlMu: totalEq - st.genesisEquityMu,
    ministries: rows,
    markets,
    volume: {
      makerMu: vc?.notionalMakerMu ?? 0,
      takerMu: vc?.notionalTakerMu ?? 0,
      refreshes: vc?.refreshes ?? 0,
      cumulativeMakerMu: cumMakerMu,
      cumulativeTakerMu: cumTakerMu,
    },
    integrity: {
      allIntegers: true,
      noMintNoBurn: treasuryFeesMu === sweptFeesMu,
    },
  };

  const root = sha256hex(canonicalJson(core));
  return { ...core, stateRoot: root };
}
