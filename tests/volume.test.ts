import { describe, test, expect } from "bun:test";
import { makeWorld, advanceWorld } from "../src/engine";
import { runVolumeCycle, auditVolume, makerSpreadBps } from "../src/volume";
import { packBridge, contractCheck, pairsFromWorldPrices } from "../src/bridge";

describe("volume — מנוע-הווליום: חשבון-ושערים", () => {
  test("auditVolume: Σ-וליום מתחייב מול-ה-ops (200 מחזורים)", () => {
    const w = makeWorld();
    for (let c = 0; c < 200; c++) {
      advanceWorld(w, 1);
      const vc = runVolumeCycle(w, c);
      const a = auditVolume(vc);
      expect(a.ok).toBe(true);
    }
  });

  test("מייקרים-מצטטים-דו-צדדיים: bid<ask, כמויות-שלמות", () => {
    const w = makeWorld();
    advanceWorld(w, 3);
    const vc = runVolumeCycle(w, 3);
    const orders = vc.ops.filter((o) => o.kind === "order");
    expect(orders.length).toBeGreaterThan(10);
    for (const o of orders) {
      if (o.kind !== "order") continue;
      expect(Number.isInteger(o.qty)).toBe(true);
      expect(Number.isInteger(o.priceMu)).toBe(true);
      expect(o.priceMu).toBeGreaterThanOrEqual(1);
    }
    // מרווח-מייקר: bid ≤ mid ≤ ask (רק-מייקרים — טייקים חוצים-מכוון)
    const mids = new Map([...w.values()].map((i) => [i.sym, i.priceMu]));
    for (const o of orders) {
      if (o.kind !== "order" || o.role !== "maker") continue;
      const mid = mids.get(o.base)!;
      if (o.side === "buy") expect(o.priceMu).toBeLessThanOrEqual(mid);
      else expect(o.priceMu).toBeGreaterThanOrEqual(mid);
    }
    // טייקים: חוצים-את-המרווח-בכוונה (עד-30bps — מרחק-מוחלט)
    for (const o of orders) {
      if (o.kind !== "order" || o.role !== "taker") continue;
      const mid = mids.get(o.base)!;
      const crossBps = Math.floor((Math.abs(o.priceMu - mid) * 10_000) / mid);
      expect(crossBps).toBeLessThanOrEqual(30);
    }
  });

  test("makerSpreadBps: מרווח-עולה-עם-תנודתיות", () => {
    expect(makerSpreadBps(0)).toBe(25);
    expect(makerSpreadBps(400)).toBe(125);
    expect(makerSpreadBps(380)).toBe(120);
  });

  test("טייקים-לא-מציפים: כמות-מוגבלת עם-סף-מומנטום או-רעש-נמוך", () => {
    const w = makeWorld();
    advanceWorld(w, 9);
    const vc = runVolumeCycle(w, 9);
    const takers = vc.ops.filter((o) => o.kind === "order" && o.role === "taker");
    for (const t of takers) {
      if (t.kind !== "order") continue;
      expect(t.qty).toBeLessThanOrEqual(80_000);
    }
  });
});

describe("bridge — חוזה-הדקס: קנוניות-ושערים", () => {
  test("packetRoot דטרמיניסטי: אותו-מחזור = אותו-שורש", () => {
    const mk = () => {
      const w = makeWorld();
      advanceWorld(w, 7);
      const vc = runVolumeCycle(w, 7);
      const syms = [...w.keys()].sort();
      const pairs = pairsFromWorldPrices(syms, (s) => w.get(s)!.priceMu);
      return packBridge(vc, pairs);
    };
    expect(mk().packetRoot).toBe(mk().packetRoot);
  });

  test("contractCheck: עובר-על-עולם-תקין; נופל-על-בסיס-זר", () => {
    const w = makeWorld();
    advanceWorld(w, 1);
    const vc = runVolumeCycle(w, 1);
    const syms = [...w.keys()].sort();
    const pairs = pairsFromWorldPrices(syms, (s) => w.get(s)!.priceMu);
    const packet = packBridge(vc, pairs);
    expect(contractCheck(packet, new Set(syms))).toEqual([]);

    const bad = { ...packet, pairs: [{ base: "FAKE", quote: "USDS" as const, priceMu: 1 }] };
    const errs = contractCheck(bad, new Set(syms));
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/FAKE/);
  });

  test("אפס-עמלות-חוץ: quote תמיד USDS (הנזילות-שלנו)", () => {
    const w = makeWorld();
    advanceWorld(w, 2);
    const vc = runVolumeCycle(w, 2);
    for (const o of vc.ops) {
      if (o.kind === "order") expect(o.quote).toBe("USDS");
      if (o.kind === "cancel") expect(o.quote).toBe("USDS");
    }
  });
});
