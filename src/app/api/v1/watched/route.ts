/**
 * Public read-only watched-list API for AI agents / scripts.
 * Auth: `Authorization: Bearer <key>` or `?key=<key>` (see docs/features/watched-api.md).
 * Excluded from cookie auth in src/proxy.ts.
 */
import { NextRequest, NextResponse } from 'next/server';

import { resolveWatchApiKey, watchApiSupported } from '@/lib/watchApiKey';
import type { WatchStatus } from '@/lib/watchStatus';

export const runtime = 'nodejs';

type ApiStatus = 'watching' | 'completed' | 'dropped';

type ApiItem = {
  title: string;
  original_title: string | null;
  year: number | null;
  type: 'movie' | 'tv';
  status: ApiStatus;
  rating: number | null;
  episodes_watched: number | null;
  episodes_total: number | null;
  last_watched_at: string | null;
  ids: {
    tmdb: number | null;
    imdb: string | null;
    douban: number | null;
    simkl: number | null;
  };
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

function error(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: CORS });
}

function toApiItem(item: WatchStatus): ApiItem {
  const status: ApiStatus =
    item.status === 'watched' ? 'completed' : item.status;
  const eps = item.watched_episodes
    ? Object.keys(item.watched_episodes).length
    : 0;
  const year = Number(String(item.year || '').slice(0, 4));
  const last = item.watched_at || item.updated_at;
  // `title` is the display title (often Chinese); english_title is the TMDB/Simkl one
  const english =
    item.english_title && item.english_title !== item.title
      ? item.english_title
      : null;
  return {
    title: item.title,
    original_title: english,
    year: Number.isFinite(year) && year > 0 ? year : null,
    type: item.media_type,
    status,
    rating: item.rating ?? null,
    episodes_watched: item.media_type === 'tv' ? eps : null,
    episodes_total:
      item.media_type === 'tv' ? (item.known_episode_count ?? null) : null,
    last_watched_at: last ? new Date(last).toISOString() : null,
    ids: {
      tmdb: item.tmdb_id ?? null,
      imdb: item.imdb_id ?? null,
      douban: item.douban_id ?? null,
      simkl: item.simkl_id ?? null,
    },
  };
}

const STATUS_LABEL: Record<ApiStatus, string> = {
  completed: 'Completed',
  watching: 'Watching',
  dropped: 'Dropped',
};

function toText(username: string, items: ApiItem[]): string {
  const lines = [
    `# Watch history of ${username} (${items.length} titles)`,
    'Rating scale 1-10; "-" = not rated.',
  ];
  for (const status of ['completed', 'watching', 'dropped'] as ApiStatus[]) {
    const group = items.filter((i) => i.status === status);
    if (group.length === 0) continue;
    lines.push('', `## ${STATUS_LABEL[status]} (${group.length})`);
    for (const i of group) {
      const name = i.original_title
        ? `${i.title} / ${i.original_title}`
        : i.title;
      const parts = [
        i.type === 'movie' ? 'Movie' : 'TV',
        `rating ${i.rating ?? '-'}`,
      ];
      if (i.type === 'tv' && i.episodes_watched != null) {
        parts.push(
          `episodes ${i.episodes_watched}${i.episodes_total ? `/${i.episodes_total}` : ''}`,
        );
      }
      lines.push(
        `- ${name}${i.year ? ` (${i.year})` : ''} | ${parts.join(' | ')}`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  if (!watchApiSupported()) {
    return error(400, 'Watched API is unavailable in localstorage mode');
  }
  const params = request.nextUrl.searchParams;
  const header = request.headers.get('authorization') || '';
  const key = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : params.get('key') || '';
  if (!key) return error(401, 'Missing API key');

  const owner = await resolveWatchApiKey(key);
  if (!owner) return error(401, 'Invalid API key');

  const statusFilter = params.get('status');
  const typeFilter = params.get('type');
  const minRating = Number(params.get('min_rating')) || 0;
  const sort = params.get('sort') || 'recent';

  let items = Object.values(owner.data.items).map(toApiItem);
  if (statusFilter) {
    const wanted = new Set(statusFilter.split(','));
    items = items.filter((i) => wanted.has(i.status));
  }
  if (typeFilter === 'movie' || typeFilter === 'tv') {
    items = items.filter((i) => i.type === typeFilter);
  }
  if (minRating > 0) {
    items = items.filter((i) => (i.rating ?? 0) >= minRating);
  }
  items.sort((a, b) => {
    if (sort === 'rating') return (b.rating ?? 0) - (a.rating ?? 0);
    if (sort === 'title') return a.title.localeCompare(b.title);
    return (b.last_watched_at || '').localeCompare(a.last_watched_at || '');
  });

  if (params.get('format') === 'text') {
    return new NextResponse(toText(owner.username, items), {
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const summary = {
    total: items.length,
    completed: items.filter((i) => i.status === 'completed').length,
    watching: items.filter((i) => i.status === 'watching').length,
    dropped: items.filter((i) => i.status === 'dropped').length,
    rated: items.filter((i) => i.rating != null).length,
  };
  return NextResponse.json(
    {
      user: owner.username,
      generated_at: new Date().toISOString(),
      rating_scale: '1-10',
      summary,
      items,
    },
    { headers: CORS },
  );
}
