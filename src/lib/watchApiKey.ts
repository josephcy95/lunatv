/**
 * Per-user read-only API key for the watched-list API.
 * Format: lunatv_<base64url(username)>_<random hex>. The username part lets
 * the API find the owner without a reverse index; the random part is checked
 * against the key stored in the user's watch data.
 */
import { randomBytes, timingSafeEqual } from 'crypto';

import { getConfig } from '@/lib/config';
import { dbManager } from '@/lib/db';
import type { UserWatchData } from '@/lib/watchStatus';

const PREFIX = 'lunatv_';

export function watchApiSupported(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !== 'localstorage'
  );
}

export function generateWatchApiKey(username: string): string {
  const user = Buffer.from(username, 'utf8').toString('base64url');
  return `${PREFIX}${user}_${randomBytes(24).toString('hex')}`;
}

function usernameFromKey(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null;
  const rest = key.slice(PREFIX.length);
  const sep = rest.lastIndexOf('_');
  if (sep <= 0) return null;
  try {
    const name = Buffer.from(rest.slice(0, sep), 'base64url').toString('utf8');
    return name || null;
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function loadWatchData(username: string): Promise<UserWatchData> {
  const raw = await dbManager.getUserWatchData(username);
  return raw && typeof raw === 'object' && raw.items ? raw : { items: {} };
}

/** Existing key, or a newly generated one (saved). `rotate` forces a new key. */
export async function ensureWatchApiKey(
  username: string,
  rotate = false,
): Promise<string> {
  const data = await loadWatchData(username);
  if (data.api_key && !rotate) return data.api_key;
  data.api_key = generateWatchApiKey(username);
  await dbManager.saveUserWatchData(username, data);
  return data.api_key;
}

/** Resolve a key to its owner + watch data, or null when invalid/banned. */
export async function resolveWatchApiKey(
  key: string,
): Promise<{ username: string; data: UserWatchData } | null> {
  const username = usernameFromKey(key.trim());
  if (!username) return null;
  if (username !== process.env.USERNAME) {
    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (!user || user.banned) return null;
  }
  const data = await loadWatchData(username);
  if (!data.api_key || !safeEqual(data.api_key, key.trim())) return null;
  return { username, data };
}
