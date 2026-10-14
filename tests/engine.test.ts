import { describe, test, expect } from "bun:test";
import { makeWorld, advanceWorld, instrumentBySym, INSTRUMENTS } from "../src/engine";
import { assertAllIntegers } from "../src/gate";

describe("engine — מנוע-השווקים הדטרמיניסטי", () => {
  test("גנזיס: 10 מגזרים, מחירים-שלמים-חיוביים", () => {
    const w = makeWorld();
    expect(w.size).toBe(10);
    expect(INSTRUMENTS.length).toBe(10);
    for (const [sym, i] of w) {
      expect(sym).toMatch(/^[A-Z]{2,8}$/);
      expect(Number.isInteger(i.priceMu)).toBe(true);
      expect(i.priceMu).toBeGreaterThanOrEqual(1);
    }
    expect(assertAllIntegers([...w.values()])).toEqual([]);
  });

  test("שחזור: שני-עולמות-עצמאיים = אותם-מחירים-אחרי-N-מחזורים", () => {
    const a = makeWorld();
    const b = makeWorld();
    advanceWorld(a, 50);
    advanceWorld(b, 50);
    for (const sym of a.keys()) {
      expect(a.get(sym)!.priceMu).toBe(b.get(sym)!.priceMu);
      expect(a.get(sym)!.last.closeMu).toBe(b.get(sym)!.last.closeMu);
    }
  });

  test("מחיר לעולם ≥ 1 ושלם אחרי-500-מחזורים-סוערים", () => {
    const w = makeWorld();
    advanceWorld(w, 500);
    for (const i of w.values()) {
      expect(Number.isInteger(i.priceMu)).toBe(true);
      expect(i.priceMu).toBeGreaterThanOrEqual(1);
      expect(i.cycle).toBe(500); // גנזיס=0 → 500 צעדים = מחזור 500
    }
  });

  test("instrumentBySym: מכשיר-לא-רשום/סימול-גרוע נדחה", () => {
    const w = makeWorld();
    expect(() => instrumentBySym(w, "NOPE")).toThrow(/לא-רשום/);
    expect(() => instrumentBySym(w, "x#1")).toThrow(/sym/);
    expect(instrumentBySym(w, "XTECH").sym).toBe("XTECH");
  });

  test("advanceWorld: מספר-שלילי/לא-שלם נדחה", () => {
    const w = makeWorld();
    expect(() => advanceWorld(w, -1)).toThrow(/cycles/);
    expect(() => advanceWorld(w, 1.5)).toThrow(/cycles/);
  });
});
