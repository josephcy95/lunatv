import type { WatchShowStatus, WatchStatus } from '@/lib/watchStatus';

export type FilterTab = 'all' | 'watching' | 'completed' | 'dropped';
export type TypeFilter = 'all' | 'movie' | 'tv';
export type SortKey = 'recent' | 'rating' | 'title' | 'year';
export type ViewMode = 'grid' | 'list';

export function isDone(status: WatchShowStatus) {
  return status === 'completed' || status === 'watched';
}

export function statusMeta(status: WatchShowStatus) {
  if (status === 'watching') {
    return {
      text: '在看',
      dot: 'bg-sky-400',
      chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    };
  }
  if (status === 'dropped') {
    return {
      text: '弃番',
      dot: 'bg-rose-400',
      chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    };
  }
  return {
    text: '已看完',
    dot: 'bg-emerald-400',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  };
}

export function episodeProgress(item: WatchStatus) {
  if (item.media_type !== 'tv') return null;
  const watched = Object.keys(item.watched_episodes || {}).length;
  const total = item.known_episode_count;
  const ratio =
    total && total > 0
      ? Math.min(1, watched / total)
      : isDone(item.status)
        ? 1
        : 0;
  return { watched, total, ratio };
}

export function playHref(item: WatchStatus) {
  const title = encodeURIComponent(item.title);
  if (item.source && item.id) {
    return `/play?source=${encodeURIComponent(item.source)}&id=${encodeURIComponent(item.id)}&title=${title}`;
  }
  if (item.douban_id) {
    return `/play?title=${title}&douban_id=${item.douban_id}&prefer=true`;
  }
  return `/play?title=${title}&prefer=true`;
}

export function simklHref(item: WatchStatus) {
  if (!item.tmdb_id) return null;
  const p = new URLSearchParams({
    tmdb: String(item.tmdb_id),
    type: item.media_type,
  });
  if (item.simkl_id) p.set('simkl', String(item.simkl_id));
  if (item.simkl_slug) p.set('slug', item.simkl_slug);
  const t = item.english_title || item.title;
  if (t) p.set('title', t);
  if (item.year) p.set('year', item.year);
  return `/api/simkl/view?${p.toString()}`;
}

export function relativeDate(ms?: number) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sortItems(list: WatchStatus[], sort: SortKey) {
  const arr = [...list];
  if (sort === 'rating') {
    arr.sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.updated_at || 0) - (a.updated_at || 0),
    );
  } else if (sort === 'title') {
    arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  } else if (sort === 'year') {
    arr.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  } else {
    arr.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }
  return arr;
}
