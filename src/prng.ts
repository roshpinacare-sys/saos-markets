/**
 * prng.ts — מחולל-אקראי-דטרמיניסטי (sha256-זרע) · חוקי-הברזל של הגרעין
 * ═════════════════════════════════════════════════════════════════════════
 * אפס-float · אפס-Math.random · אפס-Date.now — אותו-זרע + אותו-מונה = אותו-פלט
 * על-כל-מכונה, לנצח. זו-התשתית שמאפשרת ריפליי-מלא של-כל-מחזור-שוק.
 *
 * בנייה: stream = sha256(seedHex || ":" || streamId || ":" || counter) → 4×u32
 * כל-שיחה לוקחת את ה-u32 הבא מהמקור; כשנגמר — מונה++ (קפיצה-מפורשת, לא-מוסתרת).
 */
import { createHash } from "node:crypto";

export interface PrngStream {
  /** מזהה-הזרם (קנוני: מכשיר/משרד/סוכן) */
  readonly id: string;
  /** u32 הבא מהזרם */
  next(): number;
  /** מספר-שלם אחיד ב-[0, n) — n ≥ 1 */
  int(n: number): number;
  /** מספר-שלם חתום ב-[-n, n] */
  signed(n: number): number;
  /** דגל-בוליאני דטרמיניסטי עם-הסתברות p∈[0..1000]/1000 */
  chance(perMille: number): boolean;
  /** מונה-פנימי (לשחזור-מבחנים) */
  readonly counter: () => number;
}

const U32S_PER_BLOCK = 4;

export function makeStream(seedHex: string, streamId: string): PrngStream {
  if (!/^[0-9a-f]{16,64}$/.test(seedHex)) {
    throw new Error(`gate: seedHex נדרה hex 16..64 (${seedHex.slice(0, 4)}…`);
  }
  if (!/^[a-z0-9.\-:]{1,80}$/.test(streamId)) {
    throw new Error(`gate: streamId נדרה [a-z0-9.:-] (${streamId.slice(0, 8)}…`);
  }
  let block: number[] = [];
  let counter = 0;
  let cursor = U32S_PER_BLOCK;

  const refill = (): void => {
    const h = createHash("sha256")
      .update(`${seedHex}:${streamId}:${counter}`)
      .digest();
    block = [
      h.readUInt32BE(0),
      h.readUInt32BE(4),
      h.readUInt32BE(8),
      h.readUInt32BE(12),
    ];
    counter += 1;
    cursor = 0;
  };

  const next = (): number => {
    if (cursor >= U32S_PER_BLOCK) refill();
    return block[cursor++]!; // אינווריאנט: refill ממלא 4×u32 לפני-קריאה
  };

  return {
    id: streamId,
    next,
    int(n: number): number {
      if (!Number.isInteger(n) || n < 1 || n > 0xffffffff) {
        throw new Error(`gate: int(n) דורש שלם 1..2^32-1, קיבל ${n}`);
      }
      // אחידות-מדודה: דחייה-מדגמית על-תחום-השאריות
      const limit = 0x100000000 - (0x100000000 % n);
      for (let guard = 0; guard < 64; guard++) {
        const v = next();
        if (v < limit) return v % n;
      }
      return next() % n; // לא-אמור-להגיע (guard)
    },
    signed(n: number): number {
      if (!Number.isInteger(n) || n < 1 || n > 0x7fffffff) {
        throw new Error(`gate: signed(n) דורש שלם 1..2^31-1, קיבל ${n}`);
      }
      return this.int(2 * n + 1) - n;
    },
    chance(perMille: number): boolean {
      if (!Number.isInteger(perMille) || perMille < 0 || perMille > 1000) {
        throw new Error(`gate: chance דורש ‰ 0..1000, קיבל ${perMille}`);
      }
      return this.int(1000) < perMille;
    },
    counter: () => counter - (cursor < U32S_PER_BLOCK ? 1 : 0),
  };
}

/** זרע-גנזיס קנוני של-הבורסה (פומבי-וקבוע — לא-סוד; הדטרמיניזם הוא-התכונה).
 *  = sha256("saos-markets-genesis-2026-10-14") — נגזר-ממחרוזת-קנונית-מתועדת */
export const GENESIS_SEED =
  "c6e021a64b40db1c023c3e094de1d9cc132ebec65ff4c8cf51a7766dee69c20a";

/** sha256 קנוני מדויק של-מחרוזת → hex (שימושי ל-stateRoot) */
export function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
