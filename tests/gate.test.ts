import { describe, test, expect } from "bun:test";
import {
  makeFence, gateTradeIntent, assertAllIntegers, canonicalJson,
} from "../src/gate";

describe("gate — שער-האבטחה: כושל-סגירה", () => {
  const good = { base: "XTECH", qty: 10, priceMu: 4_200_000, actor: "maker-alef", side: "buy" as const };

  test("כוונה-תקינה עוברת", () => {
    const f = makeFence();
    expect(gateTradeIntent(f, good)).toEqual({ ok: true });
    expect(f.blocked).toBe(0);
  });

  test("ערכי-float נדחים (אפס-float בכל-הנתיבים)", () => {
    const f = makeFence();
    expect(gateTradeIntent(f, { ...good, qty: 10.5 })).toMatchObject({ ok: false, rule: "G2/G4-qty" });
    expect(gateTradeIntent(f, { ...good, priceMu: 4200.1 })).toMatchObject({ ok: false });
    expect(f.blocked).toBe(2);
  });

  test("שחקן-עוין/מזהה-מעורפל נדחה", () => {
    const f = makeFence();
    expect(gateTradeIntent(f, { ...good, actor: "DROP TABLE; --" })).toMatchObject({ ok: false, rule: "G3-actor" });
    expect(gateTradeIntent(f, { ...good, base: "x" })).toMatchObject({ ok: false, rule: "G3-sym" });
    expect(gateTradeIntent(f, { ...good, side: "allin" })).toMatchObject({ ok: false, rule: "G2-side" });
  });

  test("גבולות-גודל: אפס/שלילי/ענק נדחה", () => {
    const f = makeFence();
    expect(gateTradeIntent(f, { ...good, qty: 0 })).toMatchObject({ ok: false });
    expect(gateTradeIntent(f, { ...good, priceMu: -5 })).toMatchObject({ ok: false });
    expect(gateTradeIntent(f, { ...good, qty: 9e15 })).toMatchObject({ ok: false, rule: "G2/G4-qty" });
  });

  test("assertAllIntegers תופס-שברים-בעץ", () => {
    expect(assertAllIntegers({ a: 1, b: [2, { c: 3.5 }] })).toEqual(["$.b[1].c=3.5"]);
    expect(assertAllIntegers({ a: 1, b: -7, c: [] })).toEqual([]);
    expect(assertAllIntegers(NaN ? 1.2 : 1.2)).toEqual(["$=1.2"]);
  });

  test("canonicalJson: מפתחות-ממוינים — אותו-אובייקט = אותו-מחרוזת", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } }))
      .toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson([{ z: 1, y: 2 }])).toBe('[{"y":2,"z":1}]');
  });
});
