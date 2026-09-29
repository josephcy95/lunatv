/**
 * Simkl API client — follows https://api.simkl.org/
 * Required on every request: client_id, app-name, app-version query params + User-Agent.
 * Never search before mark/scrobble/rate — pass ids.tmdb (+ imdb) AND title + year.
 */
import { getConfig } from '@/lib/config';
import type { UserSimklTokens, WatchMediaType } from '@/lib/watchStatus';
import { readFileSync } from 'fs';
import { join } from 'path';

const SIMKL_API = 'https://api.simkl.com';
const SIMKL_AUTH = 'https://simkl.com/oauth/authorize';

const APP_NAME = 'lunatv';

function readAppVersion(): string {
  try {
    const v = readFileSync(join(process.cwd(), 'VERSION.txt'), 'utf8').trim();
    if (v) return v;
  } catch {
    /* ignore */
  }
  return '6.6.4';
}

export function getSimklAppMeta() {
  const version = readAppVersion();
  return {
    appName: APP_NAME,
    appVersion: version,
    userAgent: `${APP_NAME}/${version}`,
  };
}

export async function getSimklAppCredentials(): Promise<{
  clientId: string;
  /** Empty when only PIN auth is configured (secret needed only for redirect OAuth). */
  clientSecret: string;
} | null> {
  const config = await getConfig();
  const clientId = (config.SiteConfig as any).SimklClientId?.trim?.() || '';
  const clientSecret =
    (config.SiteConfig as any).SimklClientSecret?.trim?.() || '';
  // PIN flow needs Client ID only; redirect exchange still needs secret.
  if (!clientId) return null;
  return { clientId, clientSecret };
}

/** True when hostname is localhost or RFC1918 private LAN. */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h.endsWith('.local')
  ) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * Redirect OAuth is only reliable for public https origins (not LAN IPs).
 * Also requires client_secret for the code exchange.
 */
export function canUseSimklRedirectOAuth(
  origin: string,
  clientSecret: string,
): boolean {
  if (!clientSecret?.trim()) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    if (isPrivateOrLocalHost(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export type SimklPinStart = {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export async function requestSimklPin(
  clientId: string,
): Promise<SimklPinStart> {
  const { userAgent, appName, appVersion } = getSimklAppMeta();
  const u = new URL(`${SIMKL_API}/oauth/pin`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('app-name', appName);
  u.searchParams.set('app-version', appVersion);
  const res = await fetch(u.toString(), {
    method: 'GET',
    headers: { 'User-Agent': userAgent },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Simkl PIN request failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data?.user_code) {
    throw new Error('Simkl PIN response missing user_code');
  }
  return {
    user_code: String(data.user_code),
    verification_uri:
      data.verification_uri || data.verification_url || 'https://simkl.com/pin',
    expires_in: Number(data.expires_in) || 900,
    interval: Math.max(1, Number(data.interval) || 5),
  };
}

export type SimklPinPollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | {
      status: 'authorized';
      tokens: UserSimklTokens;
    };

/**
 * Poll GET /oauth/pin/{USER_CODE}.
 * Pending → KO; authorized → OK + access_token;
 * device_code present means original code is gone (expired / unknown).
 */
export async function pollSimklPin(
  clientId: string,
  userCode: string,
): Promise<SimklPinPollResult> {
  const { userAgent, appName, appVersion } = getSimklAppMeta();
  const path = `/oauth/pin/${encodeURIComponent(userCode)}`;
  const u = new URL(`${SIMKL_API}${path}`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('app-name', appName);
  u.searchParams.set('app-version', appVersion);
  const res = await fetch(u.toString(), {
    method: 'GET',
    headers: { 'User-Agent': userAgent },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Simkl PIN poll failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (data?.access_token) {
    return {
      status: 'authorized',
      tokens: {
        access_token: data.access_token,
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in || 157680000,
        token_type: data.token_type || 'bearer',
        scope: data.scope,
      },
    };
  }
  // Fresh init shape (device_code / new user_code) = original code gone
  if (data?.device_code != null) {
    return { status: 'expired' };
  }
  if (data?.result === 'KO') {
    return { status: 'pending' };
  }
  return { status: 'pending' };
}

export function buildSimklAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const { appName, appVersion } = getSimklAppMeta();
  const u = new URL(SIMKL_AUTH);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('app-name', appName);
  u.searchParams.set('app-version', appVersion);
  return u.toString();
}

export async function exchangeSimklCode(opts: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<UserSimklTokens> {
  const { userAgent } = getSimklAppMeta();
  const res = await fetch(`${SIMKL_API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Simkl token exchange failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return {
    access_token: data.access_token,
    created_at: Math.floor(Date.now() / 1000),
    expires_in: data.expires_in || 157680000,
    token_type: data.token_type || 'bearer',
    scope: data.scope,
  };
}

export function simklUrl(
  path: string,
  clientId: string,
  extra?: Record<string, string>,
) {
  const { appName, appVersion } = getSimklAppMeta();
  const u = new URL(`${SIMKL_API}${path}`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('app-name', appName);
  u.searchParams.set('app-version', appVersion);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== '') u.searchParams.set(k, v);
    }
  }
  return u.toString();
}

export function simklHeaders(accessToken?: string): HeadersInit {
  const { userAgent } = getSimklAppMeta();
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
  };
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  return h;
}

export type SimklMediaIds = {
  tmdbId: number;
  imdbId?: string;
  title?: string;
  year?: string | number;
  season?: number;
  episode?: number;
};

function buildIds(opts: SimklMediaIds) {
  const ids: Record<string, string | number> = { tmdb: String(opts.tmdbId) };
  if (opts.imdbId) ids.imdb = opts.imdbId;
  return ids;
}

export function mediaIdentity(opts: SimklMediaIds) {
  const yearNum =
    opts.year != null && String(opts.year).trim()
      ? Number(String(opts.year).slice(0, 4))
      : undefined;
  const base: Record<string, unknown> = {
    ids: buildIds(opts),
  };
  if (opts.title) base.title = opts.title;
  if (yearNum && Number.isFinite(yearNum)) base.year = yearNum;
  return base;
}

export async function fetchSimklUsername(
  clientId: string,
  accessToken: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(simklUrl('/users/settings', clientId), {
      method: 'POST',
      headers: simklHeaders(accessToken),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.user?.name || data?.account?.name || data?.user?.username;
  } catch {
    return undefined;
  }
}

/** Build View-on-Simkl redirect URL (no token needed). */
export function buildSimklViewUrl(opts: {
  clientId: string;
  mediaType: WatchMediaType;
  tmdbId: number;
  title?: string;
  year?: string;
  simklId?: number;
  slug?: string;
}): string {
  if (opts.simklId) {
    const kind = opts.mediaType === 'movie' ? 'movies' : 'tv';
    const slug = opts.slug ? `/${opts.slug}` : '';
    return `https://simkl.com/${kind}/${opts.simklId}${slug}`;
  }
  const { appName, appVersion } = getSimklAppMeta();
  const u = new URL(`${SIMKL_API}/redirect`);
  u.searchParams.set('to', 'simkl');
  u.searchParams.set('type', opts.mediaType === 'movie' ? 'movie' : 'tv');
  u.searchParams.set('tmdb', String(opts.tmdbId));
  if (opts.title) u.searchParams.set('title', opts.title);
  if (opts.year) u.searchParams.set('year', String(opts.year).slice(0, 4));
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('app-name', appName);
  u.searchParams.set('app-version', appVersion);
  return u.toString();
}

export async function simklPost(
  path: string,
  clientId: string,
  accessToken: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  try {
    const res = await fetch(simklUrl(path, clientId), {
      method: 'POST',
      headers: simklHeaders(accessToken),
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    let data: any = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      /* ignore */
    }
    // 409 already_watched on scrobble stop — treat as success
    if (res.status === 409) {
      return { ok: true, status: res.status, data };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 300), data };
    }
    return { ok: true, status: res.status, data };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message || 'network' };
  }
}

export async function simklAddHistory(
  tokens: UserSimklTokens,
  clientId: string,
  opts: SimklMediaIds & { mediaType: WatchMediaType },
): Promise<{ ok: boolean; status: number; error?: string; simklId?: number }> {
  const watched_at = new Date().toISOString();
  const identity = mediaIdentity(opts);
  const payload =
    opts.mediaType === 'movie'
      ? { movies: [{ ...identity, watched_at }] }
      : {
          shows: [
            {
              ...identity,
              seasons: [
                {
                  number: opts.season ?? 1,
                  episodes: [{ number: opts.episode || 1, watched_at }],
                },
              ],
            },
          ],
        };
  const result = await simklPost(
    '/sync/history',
    clientId,
    tokens.access_token,
    payload,
  );
  const simklId =
    result.data?.added?.movies?.[0]?.ids?.simkl ||
    result.data?.added?.shows?.[0]?.ids?.simkl ||
    result.data?.added?.statuses?.[0]?.response?.ids?.simkl;
  return { ...result, simklId: simklId ? Number(simklId) : undefined };
}

export async function simklRemoveHistory(
  tokens: UserSimklTokens,
  clientId: string,
  opts: SimklMediaIds & { mediaType: WatchMediaType },
): Promise<{ ok: boolean; status: number; error?: string }> {
  const identity = mediaIdentity(opts);
  const payload =
    opts.mediaType === 'movie'
      ? { movies: [identity] }
      : {
          shows: [
            {
              ...identity,
              seasons: [
                {
                  number: opts.season ?? 1,
                  episodes: [{ number: opts.episode || 1 }],
                },
              ],
            },
          ],
        };
  return simklPost(
    '/sync/history/remove',
    clientId,
    tokens.access_token,
    payload,
  );
}

export async function simklAddRating(
  tokens: UserSimklTokens,
  clientId: string,
  opts: SimklMediaIds & { mediaType: WatchMediaType; rating: number },
): Promise<{ ok: boolean; status: number; error?: string }> {
  const rating = Math.max(1, Math.min(10, Math.round(opts.rating)));
  const identity = mediaIdentity(opts);
  const payload =
    opts.mediaType === 'movie'
      ? { movies: [{ ...identity, rating }] }
      : { shows: [{ ...identity, rating }] };
  return simklPost('/sync/ratings', clientId, tokens.access_token, payload);
}

export async function simklRemoveRating(
  tokens: UserSimklTokens,
  clientId: string,
  opts: SimklMediaIds & { mediaType: WatchMediaType },
): Promise<{ ok: boolean; status: number; error?: string }> {
  const identity = mediaIdentity(opts);
  const payload =
    opts.mediaType === 'movie' ? { movies: [identity] } : { shows: [identity] };
  return simklPost(
    '/sync/ratings/remove',
    clientId,
    tokens.access_token,
    payload,
  );
}

function buildScrobbleBody(
  opts: SimklMediaIds & { mediaType: WatchMediaType; progress: number },
) {
  const progress = Math.max(0, Math.min(100, Number(opts.progress) || 0));
  const identity = mediaIdentity(opts);
  if (opts.mediaType === 'movie') {
    return { movie: identity, progress };
  }
  return {
    show: identity,
    episode: {
      season: opts.season ?? 1,
      number: opts.episode || 1,
    },
    progress,
  };
}

export async function simklScrobble(
  action: 'start' | 'pause' | 'stop',
  tokens: UserSimklTokens,
  clientId: string,
  opts: SimklMediaIds & { mediaType: WatchMediaType; progress: number },
): Promise<{ ok: boolean; status: number; error?: string }> {
  return simklPost(
    `/scrobble/${action}`,
    clientId,
    tokens.access_token,
    buildScrobbleBody(opts),
  );
}
