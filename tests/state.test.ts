import { describe, test, expect } from "bun:test";
import { makeRuntime, runCycle, runtimeStats } from "../src/index";

describe("state — מרשם-המדינה: אינטגריות-וכנות", () => {
  test("אין-הדפסה-ואין-שריפה: דלתא-אוצר == עמלים-שנגבו; זהות-הון; P&L חי-מדוד", () => {
    const rt = makeRuntime();
    // גנזיס: הון-פתיחה == גנזיס מוצהר
    expect(runtimeStats(rt).totalEquityMu).toBe(rt.state.genesisEquityMu);
    for (let i = 0; i < 200; i++) runCycle(rt);
    const s = runtimeStats(rt);
    // אין-כסף-מהאוויר: כל-דלתא-אוצר היא-עמלים-בלבד
    expect(s.treasuryDeltaEqualsFees).toBe(true);
    // זהות: הון-כולל == אוצר + Σ הון-משרדים (מחושב-מחדש-באופן-עצמאי)
    const identity = rt.state.treasuryMu +
      Object.values(rt.state.ministries).reduce((acc, m) => {
        let eq = m.cashMu;
        for (const [sym, p] of Object.entries(m.positions)) {
          eq += p.qty * rt.world.get(sym)!.priceMu;
        }
        return acc + eq;
      }, 0);
    expect(s.totalEquityMu).toBe(identity);
    // P&L חי: יכול-להיות-חיובי-או-שלילי — אבל-תמיד-שלם-ומדווח
    expect(Number.isInteger(s.pnlMu)).toBe(true);
    // אף-משרד לא במינוס-מזומן
    for (const m of Object.values(rt.state.ministries)) {
      expect(m.cashMu).toBeGreaterThanOrEqual(0);
    }
  });

  test("אף-משרד לא נכנס למזומן-שלילי; פוזיציות-שלמות", () => {
    const rt = makeRuntime();
    for (let i = 0; i < 120; i++) runCycle(rt);
    for (const m of Object.values(rt.state.ministries)) {
      expect(m.cashMu).toBeGreaterThanOrEqual(0);
      for (const [sym, p] of Object.entries(m.positions)) {
        expect(Number.isInteger(p.qty)).toBe(true);
        expect(p.qty).toBeGreaterThan(0);
        expect(Number.isInteger(p.avgMu)).toBe(true);
        expect(p.avgMu).toBeGreaterThan(0);
        expect(sym).toMatch(/^[A-Z]{2,8}$/);
      }
    }
  });

  test("הניסוי-מדוד: עמלים-זרמו-לאוצר; P&L ממומש-רשום-כמו-שהוא (יכול-להיות-שלילי)", () => {
    const rt = makeRuntime();
    let feeSum = 0;
    let tradeCount = 0;
    for (let i = 0; i < 60; i++) {
      const r = runCycle(rt);
      feeSum += r.trades.reduce((s, d) => s + d.feeMu, 0);
      tradeCount += r.trades.length;
    }
    // הפעימה-חיה: חייבת-להיות-סחירה-אמיתית (אפס-סחר = כישלון-מדיניות)
    expect(tradeCount).toBeGreaterThan(20);
    // כל-העמלים-שיצאו-מהמשרדים הגיעו-לאוצר (שימור-פנימי)
    const treasuryFromGenesis = rt.state.treasuryMu - 1_000_000_000;
    const feesOut = Object.values(rt.state.ministries).reduce((s, m) => s + m.feesMu, 0);
    expect(treasuryFromGenesis).toBe(feesOut);
    expect(feeSum).toBe(feesOut);
    expect(feesOut).toBeGreaterThan(0);
    // כנות: הדוח מצהיר sim=true
    const rep = runCycle(rt).report;
    expect(rep.sim).toBe(true);
    expect(rep.simLabel.length).toBeGreaterThan(10);
  });

  test("מדיניות hold (משרד-מדיניות) לא-סוחר", () => {
    const rt = makeRuntime();
    for (let i = 0; i < 30; i++) runCycle(rt);
    const p = rt.state.ministries.policy;
    expect(p.tradesBuy).toBe(0);
    expect(p.tradesSell).toBe(0);
    expect(p.cashMu).toBe(200_000_000); // תקציב-גנזיס-שלם
  });

  test("שחזור-מלא: שתי-ריצות-עצמאיות = אותו-chainRoot", () => {
    const a = makeRuntime();
    const b = makeRuntime();
    for (let i = 0; i < 40; i++) { runCycle(a); runCycle(b); }
    expect(runtimeStats(a).chainRoot).toBe(runtimeStats(b).chainRoot);
  });
});
