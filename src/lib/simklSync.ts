/* eslint-disable no-console */
/**
 * Two-way Simkl sync runner (network + DB). Merge rules live in simklSyncPlan.ts.
 */
import { dbManager } from '@/lib/db';
import { mediaIdentity, simklHeaders, simklPost, simklUrl } from '@/lib/simkl';
import {
  parseSimklAllItems,
  planSimklSync,
  type SimklPushTarget,
  type SimklSyncPush,
} from '@/lib/simklSyncPlan';
import type {
  UserSimklTokens,
  UserWatchData,
  WatchStatus,
} from '@/lib/watchStatus';

const BATCH = 100;

export type SimklSyncResult = {
  pulled: { added: number; updated: number };
  pushed: {
    movies: number;
    shows: number;
    episodes: number;
    ratings: number;
    statuses: number;
  };
  skippedNoTmdb: number;
  errors: string[];
  syncedAt: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function identity(t: SimklPushTarget) {
  return mediaIdentity({
    tmdbId: t.tmdbId,
    imdbId: t.imdbId,
    title: t.title,
    year: t.year,
  });
}

const iso = (ms: number) => new Date(ms).toISOString();

async function fetchAllItems(tokens: UserSimklTokens, clientId: string) {
  const res = await fetch(simklUrl('/sync/all-items', clientId), {
    headers: simklHeaders(tokens.access_token),
  });
  if (!res.ok) {
    throw new Error(`Simkl all-items failed: ${res.status}`);
  }
  // Empty library returns an empty body / null
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function fetchActivitiesAll(
  tokens: UserSimklTokens,
  clientId: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(simklUrl('/sync/activities', clientId), {
      headers: simklHeaders(tokens.access_token),
    });
    if (!res.ok) return undefined;
    const act = await res.json();
    return act?.all;
  } catch {
    return undefined;
  }
}

async function executePush(
  tokens: UserSimklTokens,
  clientId: string,
  push: SimklSyncPush,
  errors: string[],
) {
  const post = async (path: string, body: unknown, label: string) => {
    const r = await simklPost(path, clientId, tokens.access_token, body);
    if (!r.ok) errors.push(`${label}: ${r.status} ${r.error || ''}`.trim());
    // Simkl asks clients to keep POSTs ~1/sec
    await sleep(1100);
  };

  for (const part of chunk(push.historyMovies, BATCH)) {
    await post(
      '/sync/history',
      {
        movies: part.map((m) => ({
          ...identity(m),
          watched_at: iso(m.watchedAt),
        })),
      },
      'history/movies',
    );
  }
  for (const part of chunk(push.historyShows, BATCH)) {
    await post(
      '/sync/history',
      {
        shows: part.map((s) => ({
          ...identity(s),
          seasons: [
            {
              number: 1,
              episodes: s.episodes.map((e) => ({
                number: e.number,
                watched_at: iso(e.watchedAt),
              })),
            },
          ],
        })),
      },
      'history/shows',
    );
  }
  for (const part of chunk(push.ratings, BATCH)) {
    const rated_at = iso(Date.now());
    await post(
      '/sync/ratings',
      {
        movies: part
          .filter((x) => x.mediaType === 'movie')
          .map((x) => ({ ...identity(x), rating: x.rating, rated_at })),
        shows: part
          .filter((x) => x.mediaType === 'tv')
          .map((x) => ({ ...identity(x), rating: x.rating, rated_at })),
      },
      'ratings',
    );
  }
  for (const part of chunk(push.lists, BATCH)) {
    await post(
      '/sync/add-to-list',
      {
        movies: part
          .filter((x) => x.mediaType === 'movie')
          .map((x) => ({ ...identity(x), to: x.to })),
        shows: part
          .filter((x) => x.mediaType === 'tv')
          .map((x) => ({ ...identity(x), to: x.to })),
      },
      'add-to-list',
    );
  }
}

/**
 * Pull Simkl all-items, merge into local, optionally push local-only data.
 * Saves only the items the merge touched, on top of a fresh read, so marks
 * made while the sync runs are not lost.
 */
export async function runSimklTwoWaySync(
  username: string,
  clientId: string,
  tokens: UserSimklTokens,
  opts: { push?: boolean } = {},
): Promise<SimklSyncResult> {
  const doPush = opts.push !== false;
  const errors: string[] = [];

  const [remoteRaw, raw] = await Promise.all([
    fetchAllItems(tokens, clientId),
    dbManager.getUserWatchData(username),
  ]);
  const local: UserWatchData =
    raw && typeof raw === 'object' && raw.items ? raw : { items: {} };

  const plan = planSimklSync(local.items, parseSimklAllItems(remoteRaw));

  const touched: Record<string, WatchStatus> = {};
  for (const [key, item] of Object.entries(plan.items)) {
    if (local.items[key] !== item) touched[key] = item;
  }
  if (Object.keys(touched).length > 0) {
    const fresh = await dbManager.getUserWatchData(username);
    const data: UserWatchData =
      fresh && typeof fresh === 'object' && fresh.items ? fresh : { items: {} };
    Object.assign(data.items, touched);
    await dbManager.saveUserWatchData(username, data);
  }

  if (doPush) {
    await executePush(tokens, clientId, plan.push, errors);
  }

  const syncedAt = Date.now();
  const lastSync = await fetchActivitiesAll(tokens, clientId);
  await dbManager.saveUserSimklTokens(username, {
    ...tokens,
    ...(lastSync ? { last_sync: lastSync } : {}),
    ...(doPush ? { last_full_sync_at: syncedAt } : {}),
  });

  const result: SimklSyncResult = {
    pulled: plan.pulled,
    pushed: doPush
      ? {
          movies: plan.push.historyMovies.length,
          shows: plan.push.historyShows.length,
          episodes: plan.push.historyShows.reduce(
            (n, s) => n + s.episodes.length,
            0,
          ),
          ratings: plan.push.ratings.length,
          statuses: plan.push.lists.length,
        }
      : { movies: 0, shows: 0, episodes: 0, ratings: 0, statuses: 0 },
    skippedNoTmdb: plan.skippedNoTmdb,
    errors,
    syncedAt,
  };
  console.log(`Simkl sync for ${username}:`, JSON.stringify(result));
  return result;
}
