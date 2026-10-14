import { describe, test, expect } from "bun:test";
import { makeStream, GENESIS_SEED, sha256hex } from "../src/prng";

describe("prng — דטרמיניזם מוחלט", () => {
  test("אותו-זרע+זרם = אותו-פלט (×2 עצמאיים)", () => {
    const a = makeStream(GENESIS_SEED, "cycle:0");
    const b = makeStream(GENESIS_SEED, "cycle:0");
    const xs = Array.from({ length: 100 }, () => a.next());
    const ys = Array.from({ length: 100 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  test("זרמים-שונים = פלטים-שונים", () => {
    const a = makeStream(GENESIS_SEED, "cycle:0");
    const b = makeStream(GENESIS_SEED, "cycle:1");
    const xs = Array.from({ length: 32 }, () => a.next());
    const ys = Array.from({ length: 32 }, () => b.next());
    expect(xs).not.toEqual(ys);
  });

  test("int() תמיד בתחום [0,n) ושלם", () => {
    const s = makeStream(GENESIS_SEED, "bounds");
    for (let i = 0; i < 500; i++) {
      const v = s.int(1 + (i % 977));
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1 + (i % 977));
    }
  });

  test("signed() בתחום [-n,n]", () => {
    const s = makeStream(GENESIS_SEED, "signed");
    for (let i = 0; i < 500; i++) {
      const v = s.signed(137);
      expect(v).toBeGreaterThanOrEqual(-137);
      expect(v).toBeLessThanOrEqual(137);
    }
  });

  test("שערי-קלט: seedHex/streamId גרועים נדחים", () => {
    expect(() => makeStream("NOTHEX", "x")).toThrow(/seedHex/);
    expect(() => makeStream(GENESIS_SEED, "BAD ID!")).toThrow(/streamId/);
  });

  test("sha256hex קנוני", () => {
    expect(sha256hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
