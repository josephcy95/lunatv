/**
 * Pure two-way merge between local watch data and Simkl all-items.
 * No I/O — see simklSync.ts for the network runner.
 *
 * Rules (local is the source of truth):
 * - Only on Simkl → pulled into local.
 * - Only local (with TMDB id) → pushed to Simkl.
 * - Both → episodes are unioned; local rating wins (Simkl fills a missing one);
 *   local status wins, except remote progress may advance watching → completed.
 * - Deletions are never inferred; unmark in the app pushes removals live.
 * - Simkl "plantowatch" has no local equivalent and is ignored.
 * - Episodes use the local flat index as season 1 (same as live sync).
 */
import type { WatchMediaType, WatchStatus } from '@/lib/watchStatus';

export type SimklRemoteItem = {
  mediaType: WatchMediaType;
  tmdbId: number;
  imdbId?: string;
  simklId?: number;
  slug?: string;
  title: string;
  year?: string;
  /** watching | plantowatch | hold | completed | dropped */
  status: string;
  watchedEpisodes: number;
  totalEpisodes?: number;
  rating?: number;
  lastWatchedAt?: number;
  /** Poster URL (wsrv.nl proxy, as recommended by Simkl image docs) */
  poster?: string;
};

export type SimklPushTarget = {
  mediaType: WatchMediaType;
  tmdbId: number;
  imdbId?: string;
  title?: string;
  year?: string;
};

export type SimklSyncPush = {
  historyMovies: (SimklPushTarget & { watchedAt: number })[];
  historyShows: (SimklPushTarget & {
    episodes: { number: number; watchedAt: number }[];
  })[];
  ratings: (SimklPushTarget & { rating: number })[];
  lists: (SimklPushTarget & { to: 'completed' | 'dropped' | 'watching' })[];
};

export type SimklSyncPlan = {
  items: Record<string, WatchStatus>;
  pulled: { added: number; updated: number };
  push: SimklSyncPush;
  /** Local items without a TMDB id (douban-only, short dramas…). */
  skippedNoTmdb: number;
};

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Parse GET /sync/all-items → normalized rows (anime is treated as tv). */
export function parseSimklAllItems(data: any): SimklRemoteItem[] {
  const out: SimklRemoteItem[] = [];
  const groups: [string, WatchMediaType][] = [
    ['movies', 'movie'],
    ['shows', 'tv'],
    ['anime', 'tv'],
  ];
  for (const [field, mediaType] of groups) {
    for (const row of data?.[field] || []) {
      const media = row?.movie || row?.show || row?.anime || row;
      const tmdbId = numOrUndef(media?.ids?.tmdb);
      if (!tmdbId) continue;
      const lastWatched = row.last_watched_at
        ? Date.parse(row.last_watched_at)
        : NaN;
      out.push({
        mediaType,
        tmdbId,
        imdbId: media?.ids?.imdb || undefined,
        simklId: numOrUndef(media?.ids?.simkl ?? media?.ids?.simkl_id),
        slug: media?.ids?.slug || undefined,
        title: media?.title || `${mediaType} ${tmdbId}`,
        year: media?.year ? String(media.year) : undefined,
        status: String(row.status || '').toLowerCase(),
        watchedEpisodes: Number(row.watched_episodes_count) || 0,
        totalEpisodes: numOrUndef(row.total_episodes_count),
        rating: numOrUndef(row.user_rating),
        lastWatchedAt: Number.isFinite(lastWatched) ? lastWatched : undefined,
        poster: media?.poster
          ? `https://wsrv.nl/?url=https://simkl.in/posters/${media.poster}_m.webp&q=90`
          : undefined,
      });
    }
  }
  return out;
}

function watchedIndices(item: WatchStatus): number[] {
  return Object.keys(item.watched_episodes || {})
    .map((k) => Number(k.replace(/^ep:/, '')))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

function episodesUpTo(count: number, at: number): Record<string, number> {
  const eps: Record<string, number> = {};
  for (let i = 1; i <= count; i++) eps[`ep:${i}`] = at;
  return eps;
}

function newItemFromRemote(r: SimklRemoteItem, now: number): WatchStatus {
  const at = r.lastWatchedAt || now;
  const key = `${r.mediaType}:${r.tmdbId}`;
  const base: WatchStatus = {
    key,
    tmdb_id: r.tmdbId,
    media_type: r.mediaType,
    title: r.title,
    year: r.year,
    english_title: r.title,
    imdb_id: r.imdbId,
    simkl_id: r.simklId,
    simkl_slug: r.slug,
    cover: r.poster,
    status: 'watched',
    watched_at: at,
    updated_at: at,
  };
  if (r.rating) {
    base.rating = r.rating;
    base.rating_updated_at = now;
  }
  if (r.mediaType === 'movie') {
    base.status =
      r.status === 'dropped'
        ? 'dropped'
        : r.status === 'watching' || r.status === 'hold'
          ? 'watching'
          : 'watched';
    return base;
  }
  const count =
    r.status === 'completed'
      ? Math.max(r.watchedEpisodes, r.totalEpisodes || 0, 1)
      : r.watchedEpisodes;
  base.status =
    r.status === 'completed'
      ? 'completed'
      : r.status === 'dropped'
        ? 'dropped'
        : 'watching';
  if (count > 0) base.watched_episodes = episodesUpTo(count, at);
  base.known_episode_count = r.totalEpisodes || (count > 0 ? count : undefined);
  return base;
}

/** Merge remote into an existing local item. Returns null when unchanged. */
function mergeIntoLocal(
  local: WatchStatus,
  r: SimklRemoteItem,
): WatchStatus | null {
  const next: WatchStatus = { ...local };
  let changed = false;
  const fill = <K extends keyof WatchStatus>(k: K, v: WatchStatus[K]) => {
    if (v != null && v !== '' && next[k] == null) {
      next[k] = v;
      changed = true;
    }
  };
  fill('simkl_id', r.simklId);
  fill('simkl_slug', r.slug);
  fill('imdb_id', r.imdbId);
  if (r.title && r.title !== local.title) fill('english_title', r.title);
  fill('year', r.year);
  fill('cover', r.poster);
  if (next.rating == null && r.rating) {
    next.rating = r.rating;
    next.rating_updated_at = Date.now();
    changed = true;
  }

  if (local.media_type === 'tv') {
    fill('known_episode_count', r.totalEpisodes);
    const at = r.lastWatchedAt || Date.now();
    const eps = { ...(local.watched_episodes || {}) };
    let added = 0;
    for (let i = 1; i <= r.watchedEpisodes; i++) {
      if (!eps[`ep:${i}`]) {
        eps[`ep:${i}`] = at;
        added += 1;
      }
    }
    if (added > 0) {
      next.watched_episodes = eps;
      changed = true;
    }
    const n = Object.keys(eps).length;
    const known = next.known_episode_count;
    const reachedEnd =
      r.status === 'completed' ||
      (typeof known === 'number' && known > 0 && n >= known);
    if (local.status === 'watching' && reachedEnd) {
      next.status = 'completed';
      changed = true;
    }
  } else if (local.status === 'watching' && r.status === 'completed') {
    next.status = 'watched';
    changed = true;
  }

  if (!changed) return null;
  next.updated_at = Math.max(local.updated_at || 0, r.lastWatchedAt || 0);
  return next;
}

function pushTarget(item: WatchStatus): SimklPushTarget {
  return {
    mediaType: item.media_type,
    tmdbId: item.tmdb_id!,
    imdbId: item.imdb_id,
    title: item.english_title || item.title,
    year: item.year,
  };
}

export function planSimklSync(
  localItems: Record<string, WatchStatus>,
  remote: SimklRemoteItem[],
  now = Date.now(),
): SimklSyncPlan {
  const items: Record<string, WatchStatus> = { ...localItems };
  const pulled = { added: 0, updated: 0 };
  const push: SimklSyncPush = {
    historyMovies: [],
    historyShows: [],
    ratings: [],
    lists: [],
  };

  // Local items may be keyed differently (e.g. douban:…) yet carry a tmdb id.
  const byTmdb = new Map<string, string>();
  for (const [key, item] of Object.entries(items)) {
    if (item.tmdb_id) byTmdb.set(`${item.media_type}:${item.tmdb_id}`, key);
  }
  const remoteByTmdb = new Map<string, SimklRemoteItem>();

  // 1) Pull
  for (const r of remote) {
    const id = `${r.mediaType}:${r.tmdbId}`;
    remoteByTmdb.set(id, r);
    if (r.status === 'plantowatch') continue;
    const localKey = byTmdb.get(id);
    if (!localKey) {
      items[id] = newItemFromRemote(r, now);
      byTmdb.set(id, id);
      pulled.added += 1;
      continue;
    }
    const merged = mergeIntoLocal(items[localKey], r);
    if (merged) {
      items[localKey] = merged;
      pulled.updated += 1;
    }
  }

  // 2) Push (diff merged local against remote)
  let skippedNoTmdb = 0;
  for (const item of Object.values(items)) {
    if (!item.tmdb_id) {
      skippedNoTmdb += 1;
      continue;
    }
    const found = remoteByTmdb.get(`${item.media_type}:${item.tmdb_id}`);
    const r = found && found.status !== 'plantowatch' ? found : undefined;
    const target = pushTarget(item);

    if (item.media_type === 'movie') {
      const localDone =
        item.status === 'watched' || item.status === 'completed';
      if (localDone && r?.status !== 'completed') {
        push.historyMovies.push({
          ...target,
          watchedAt: item.watched_at || item.updated_at || now,
        });
      } else if (item.status === 'dropped' && r?.status !== 'dropped') {
        push.lists.push({ ...target, to: 'dropped' });
      }
    } else {
      // Simkl counts a completed show as fully watched — nothing to add.
      const remoteCount =
        r?.status === 'completed' ? Infinity : r?.watchedEpisodes || 0;
      const missing = watchedIndices(item).filter((n) => n > remoteCount);
      if (missing.length > 0) {
        push.historyShows.push({
          ...target,
          episodes: missing.map((n) => ({
            number: n,
            watchedAt: item.watched_episodes?.[`ep:${n}`] || now,
          })),
        });
      }
      const remoteStatus = r?.status === 'hold' ? 'watching' : r?.status;
      if (item.status === 'dropped' && remoteStatus !== 'dropped') {
        push.lists.push({ ...target, to: 'dropped' });
      } else if (item.status === 'completed' && remoteStatus !== 'completed') {
        push.lists.push({ ...target, to: 'completed' });
      } else if (
        item.status === 'watching' &&
        (remoteStatus === 'dropped' || (!r && missing.length === 0))
      ) {
        push.lists.push({ ...target, to: 'watching' });
      }
    }

    if (item.rating && item.rating !== found?.rating) {
      push.ratings.push({ ...target, rating: item.rating });
    }
  }

  return { items, pulled, push, skippedNoTmdb };
}
