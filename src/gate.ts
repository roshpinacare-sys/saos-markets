/**
 * gate.ts — שער-האבטחה של-הבורסה-המדומה
 * ═════════════════════════════════════════════════════════════════════════
 * אסופת-האזהרה של-הבעלים: "אבטחה זהירות מקוד נגוע מקורות לא מוכרים עוקצים
 * בקריפטו פריצות דרך ב-EVM". הגדרת-הגדר כאן:
 *
 *  G1 אפס-fetch-חוץ · אפס-eval · אפס-dynamic-import — המנוע ניזון-מזרעים
 *     פנימיים-בלבד (דטרמיניזם = גם-אבטחת-אספקה: אפס-תלות-ריצה).
 *  G2 שלמים-בלבד-בכל-הנתיבים; כל-קלט-חוץ עובר-אימות-סכמה-כושל-סגירה.
 *  G3 שחקנים-מזוהים: ^[a-z0-9-]{1,32}$ — אין-מזהה-מעורפל-בפנקס.
 *  G4 גבולות-גודל: כל-כמות/מחיר/תקציב מתחת-ל-MAX_SAFE_INTEGER-מרווח-ביטחון.
 *  G5 אפס-סודות: לספר הזה אין-מפתחות כלל (SIM קנוני); עיגון-שרשרת-עתידי
 *     יעבוד-רק-דרך-כספת-האחוזה (vault-home) — לא-בספר הזה.
 *
 * fenceRecord: כל-חסימה נרשמת (מדידה-כנה של-עמדת-האבטחה).
 */

export type GateVerdict =
  | { ok: true }
  | { ok: false; rule: string; detail: string };

export interface FenceRecord {
  blocked: number;
  lastBlock: GateVerdict | null;
}

export function makeFence(): FenceRecord {
  return { blocked: 0, lastBlock: null };
}

const MAX_MU = 2_000_000_000_000; // 2T µUSDS — תקרת-גודל (מרווח-ביטחון)
const ACTOR_RE = /^[a-z0-9-]{1,32}$/;
const SYM_RE = /^[A-Z]{2,8}$/;

function record(fence: FenceRecord, rule: string, detail: string): GateVerdict {
  const v: GateVerdict = { ok: false, rule, detail };
  fence.blocked += 1;
  fence.lastBlock = v;
  return v;
}

/** אימות-כוונת-מסחר חוץ (חוזה-קלט-כושל-סגירה) */
export function gateTradeIntent(
  fence: FenceRecord,
  input: {
    base?: unknown; qty?: unknown; priceMu?: unknown;
    actor?: unknown; side?: unknown;
  },
): GateVerdict {
  if (typeof input.base !== "string" || !SYM_RE.test(input.base)) {
    return record(fence, "G3-sym", `base נדרה [A-Z]{2,8}: ${String(input.base).slice(0, 12)}`);
  }
  if (typeof input.qty !== "number" || !Number.isInteger(input.qty) || input.qty < 1 || input.qty > MAX_MU) {
    return record(fence, "G2/G4-qty", `qty שלם 1..MAX: ${String(input.qty).slice(0, 12)}`);
  }
  if (typeof input.priceMu !== "number" || !Number.isInteger(input.priceMu) || input.priceMu < 1 || input.priceMu > MAX_MU) {
    return record(fence, "G2/G4-price", `priceMu שלם 1..MAX: ${String(input.priceMu).slice(0, 12)}`);
  }
  if (typeof input.actor !== "string" || !ACTOR_RE.test(input.actor)) {
    return record(fence, "G3-actor", `actor נדרה ^[a-z0-9-]{1,32}$: ${String(input.actor).slice(0, 12)}`);
  }
  if (input.side !== "buy" && input.side !== "sell") {
    return record(fence, "G2-side", `side נדרה buy|sell: ${String(input.side).slice(0, 12)}`);
  }
  return { ok: true };
}

/** אסור-מוחלט: פונקציות-מסוכנות בריצה (מבחן-מריץ-ואוכף) */
export const FORBIDDEN_GLOBALS: readonly string[] = [
  "eval", "Function", "fetch", "XMLHttpRequest", "WebSocket", "importScripts",
];

/** בדיקת-חיץ: אף-מספר-בפלט-קנוני לא-שבר/NaN/Infinity (רץ-על-עץ-אובייקט) */
export function assertAllIntegers(obj: unknown, path = "$"): string[] {
  const bad: string[] = [];
  if (typeof obj === "number") {
    if (!Number.isInteger(obj)) bad.push(`${path}=${obj}`);
    return bad;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) bad.push(...assertAllIntegers(obj[i], `${path}[${i}]`));
    return bad;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) bad.push(...assertAllIntegers(v, `${path}.${k}`));
  }
  return bad;
}

/** קנוניזציה-דטרמיניסטית ל-JSON (מפתחות-ממוינים — ל-stateRoot) */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(canonicalize(obj));
}

function canonicalize(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(canonicalize);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = canonicalize((obj as Record<string, unknown>)[k]);
    return out;
  }
  return obj;
}
