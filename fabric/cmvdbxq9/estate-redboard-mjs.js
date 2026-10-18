import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KEYSTORE_PATH = join(process.env.HOME || process.env.USERPROFILE || '.', '.saos', 'estate-redboard.keys');
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 דקות

let failedAttempts = 0;
let lockoutUntil = 0;

/**
 * טוען מפתח מאובטח ממאגר מקומי (לא קשוח בקוד)
 * @returns {Promise<string>} מפתח API פעיל
 */
export async function loadApiKey() {
  if (Date.now() < lockoutUntil) {
    throw new Error(`Account locked. Try again after ${new Date(lockoutUntil).toISOString()}`);
  }

  const envKey = process.env.HIVE_API_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim().length >= 32) {
    return envKey.trim();
  }

  if (existsSync(KEYSTORE_PATH)) {
    try {
      const data = readFileSync(KEYSTORE_PATH, 'utf8');
      const { key, version } = JSON.parse(data);
      if (version === 1 && typeof key === 'string' && key.length >= 32) {
        return key;
      }
    } catch (err) {
      console.warn('Failed to parse keystore, falling back to env');
    }
  }

  throw new Error(
    'Hive API key not found. Set HIVE_API_KEY env or run `saos setup-key`'
  );
}

/**
 * שומר מפתח במאגר מאובטח (הרשאות קובץ מוגבלות)
 * @param {string} key - מפתח API לאחסון
 */
export function storeApiKey(key) {
  if (typeof key !== 'string' || key.length < 32) {
    throw new Error('Invalid key: must be string >= 32 chars');
  }

  const dir = join(process.env.HOME || process.env.USERPROFILE || '.', '.saos');
  if (!existsSync(dir)) {
    try { writeFileSync(dir, '', { mode: 0o700 }); } catch (_) {}
  }

  try {
    writeFileSync(
      KEYSTORE_PATH,
      JSON.stringify({ version: 1, key }, null, 0),
      { encoding: 'utf8', mode: 0o600 }
    );
  } catch (err) {
    throw new Error(`Failed to write keystore: ${err.message}`);
  }
}

/**
 * מאמת חיבור ל-Hive API באמצעות חתימה HMAC-SHA256
 * @param {string} endpoint - נקודת קצה API
 * @param {string} method - HTTP method
 * @param {object} [body] - גוף הבקשה (אופציונלי)
 * @returns {Promise<{ headers: HeadersInit }>} כותרות אימות
 */
export async function signHiveRequest(endpoint, method, body = {}) {
  const apiKey = await loadApiKey();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify(body);
  const message = `${timestamp}${method.toUpperCase()}${endpoint}${payload}`;

  const signature = createHmac('sha256', apiKey)
    .update(message, 'utf8')
    .digest('hex');

  return {
    headers: {
      'X-Signature': signature,
      'X-Timestamp': timestamp,
      'Content-Type': 'application/json'
    }
  };
}

/**
 * מאמת חתימה נכנסת מ-Hive (ל-webhooks או תשובות חוזרות)
 * @param {string} message - ההודעה שנחתמה
 * @param {string} signatureHex - חתימה לקבלה
 * @returns {boolean} האם החתימה תקינה
 */
export function verifyHiveSignature(message, signatureHex) {
  if (!signatureHex || typeof signatureHex !== 'string') return false;

  try {
    const apiKey = loadApiKeySync(); // גרסה סינכרונית לאימות נכנס
    const expected = createHmac('sha256', apiKey)
      .update(message, 'utf8')
      .digest('hex');
    return timingSafeEqual(Buffer.from(signatureHex, 'hex'), Buffer.from(expected, 'hex'));
  } catch (err) {
    recordFailedAttempt();
    return false;
  }
}

/**
 * גרסה סינכרונית של טעינת מפתח (לשימוש פנימי באימות)
 * @returns {string} מפתח API
 */
export function loadApiKeySync() {
  if (Date.now() < lockoutUntil) {
    throw new Error(`Account locked. Try again after ${new Date(lockoutUntil).toISOString()}`);
  }

  const envKey = process.env.HIVE_API_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim().length >= 32) {
    return envKey.trim();
  }

  if (existsSync(KEYSTORE_PATH)) {
    try {
      const data = readFileSync(KEYSTORE_PATH, 'utf8');
      const { key, version } = JSON.parse(data);
      if (version === 1 && typeof key === 'string' && key.length >= 32) {
        return key;
      }
    } catch (_) {
      // נמשיך לכישלון
    }
  }

  throw new Error('Hive API key not found in env or keystore');
}

/**
 * רושם ניסיון כושל ומגביר מונה נעילה
 */
export function recordFailedAttempt() {
  failedAttempts++;
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.error(
      `Security lockout triggered after ${failedAttempts} failed attempts. ` +
      `Locked until ${new Date(lockoutUntil).toISOString()}`
    );
  }
  console.warn(`Failed Hive auth attempt ${failedAttempts}/${MAX_FAILED_ATTEMPTS}`);
}

/**
 * מאפס מונה ניסיונות כושלים (למשל אחרי הצלחה)
 */
export function resetFailedAttempts() {
  failedAttempts = 0;
}

/**
 * מנקה מצב נעילה (לשימוש אדמיניסטרטיבי בלבד)
 */
export function clearLockout() {
  lockoutUntil = 0;
  failedAttempts = 0;
  console.info('Lockout cleared by admin');
}

// ייצוא למטרות בדיקה (לא לשימוש בייצור)
export const __test__ = {
  KEYSTORE_PATH,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  setFailedAttempts: (v) => { failedAttempts = v; },
  setLockoutUntil: (v) => { lockoutUntil = v; }
};