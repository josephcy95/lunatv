/* eslint-disable @next/next/no-img-element */
'use client';

import {
  Clapperboard,
  Eye,
  KeyRound,
  LayoutGrid,
  List,
  MoreHorizontal,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { processImageUrl } from '@/lib/utils';
import type { WatchStatus } from '@/lib/watchStatus';
import { postWatchStatus } from '@/lib/watchStatus.client';
import { useWatchStatusList } from '@/hooks/useWatchStatus';

import PageLayout from '@/components/PageLayout';

import ItemActionsMenu, { type ItemAction } from './ItemActionsMenu';
import WatchApiDialog from './WatchApiDialog';
import {
  episodeProgress,
  type FilterTab,
  isDone,
  playHref,
  relativeDate,
  sortItems,
  type SortKey,
  statusMeta,
  type TypeFilter,
  type ViewMode,
} from './watchedShared';

const PREFS_KEY = 'lunatv_watched_prefs';

type SimklState = { connected: boolean; lastFullSyncAt: number | null };

function readPrefs(): { view?: ViewMode; sort?: SortKey } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

function isLocalStorageMode() {
  if (typeof window === 'undefined') return false;
  const t =
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE ||
    process.env.NEXT_PUBLIC_STORAGE_TYPE ||
    'localstorage';
  return t === 'localstorage';
}

function matchesFilter(item: WatchStatus, filter: FilterTab) {
  if (filter === 'all') return true;
  if (filter === 'completed') return isDone(item.status);
  return item.status === filter;
}

function Poster({ item, className }: { item: WatchStatus; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!item.cover || failed) {
    return (
      <div
        className={`${className} flex items-center justify-center bg-gray-100 dark:bg-gray-800/80`}
      >
        <Clapperboard className='size-1/3 max-h-8 max-w-8 text-gray-300 dark:text-gray-600' />
      </div>
    );
  }
  return (
    <img
      src={processImageUrl(item.cover)}
      alt=''
      loading='lazy'
      referrerPolicy='no-referrer'
      onError={() => setFailed(true)}
      className={`${className} object-cover`}
    />
  );
}

function RatingBadge({ rating }: { rating?: number }) {
  if (!rating) return null;
  return (
    <span className='meta-badge meta-badge-gold'>
      <Star className='size-2.5 fill-current' />
      {rating}
    </span>
  );
}

interface CardProps {
  item: WatchStatus;
  onMenu: (item: WatchStatus, anchor: HTMLElement) => void;
  menuOpen: boolean;
}

function GridCard({ item, onMenu, menuOpen }: CardProps) {
  const status = statusMeta(item.status);
  const ep = episodeProgress(item);
  return (
    <article className='group relative min-w-0'>
      <div className='relative aspect-[2/3] overflow-hidden rounded-lg ring-1 ring-gray-900/5 transition group-hover:ring-green-500/50 dark:ring-white/5'>
        <a
          href={playHref(item)}
          aria-label={`播放 ${item.title}`}
          className='block h-full w-full'
        >
          <Poster
            item={item}
            className='h-full w-full transition duration-300 group-hover:scale-[1.03]'
          />
        </a>
        <div className='pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5'>
          <span
            className={`size-2 rounded-full ring-2 ring-black/30 ${status.dot}`}
            title={status.text}
            aria-label={status.text}
          />
          <RatingBadge rating={item.rating} />
        </div>
        <button
          type='button'
          aria-label={`${item.title} 更多操作`}
          aria-haspopup='menu'
          aria-expanded={menuOpen}
          onClick={(e) => onMenu(item, e.currentTarget)}
          className={`absolute bottom-1.5 right-1.5 rounded-md bg-black/60 p-1 text-white backdrop-blur transition hover:bg-black/80 focus-visible:opacity-100 ${
            menuOpen
              ? 'opacity-100'
              : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
          }`}
        >
          <MoreHorizontal className='size-4' />
        </button>
        {ep && ep.ratio > 0 && ep.ratio < 1 && (
          <div className='absolute inset-x-0 bottom-0 h-[3px] bg-black/40'>
            <div
              className='h-full bg-green-400'
              style={{ width: `${ep.ratio * 100}%` }}
            />
          </div>
        )}
      </div>
      <a href={playHref(item)} className='mt-1.5 block'>
        <h3
          className='truncate text-xs font-semibold text-gray-900 dark:text-gray-100'
          title={item.title}
        >
          {item.title}
        </h3>
        <p className='truncate font-mono text-[10px] text-gray-500 dark:text-gray-400'>
          {[
            item.year,
            item.media_type === 'tv' ? 'TV' : 'Movie',
            ep ? `${ep.watched}${ep.total ? `/${ep.total}` : ''}集` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </a>
    </article>
  );
}

function ListRow({ item, onMenu, menuOpen }: CardProps) {
  const status = statusMeta(item.status);
  const ep = episodeProgress(item);
  return (
    <div className='group flex items-center gap-3 px-3 py-2 transition hover:bg-gray-50/80 dark:hover:bg-gray-800/40'>
      <a
        href={playHref(item)}
        className='shrink-0'
        aria-label={`播放 ${item.title}`}
      >
        <Poster item={item} className='h-14 w-10 rounded' />
      </a>
      <a href={playHref(item)} className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
          {item.title}
        </p>
        <p className='truncate font-mono text-[11px] text-gray-500 dark:text-gray-400'>
          {[item.year, item.media_type === 'tv' ? 'TV' : 'Movie']
            .filter(Boolean)
            .join(' · ')}
          <span className='sm:hidden'> · {status.text}</span>
        </p>
      </a>
      <span
        className={`hidden w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium sm:inline-block ${status.chip}`}
      >
        {status.text}
      </span>
      <div className='hidden w-28 shrink-0 md:block'>
        {ep ? (
          <>
            <p className='font-mono text-[11px] text-gray-600 dark:text-gray-300'>
              {ep.watched}
              {ep.total ? ` / ${ep.total}` : ''} 集
            </p>
            <div className='mt-1 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700'>
              <div
                className='h-full bg-green-500'
                style={{ width: `${ep.ratio * 100}%` }}
              />
            </div>
          </>
        ) : (
          <span className='font-mono text-[11px] text-gray-400'>—</span>
        )}
      </div>
      <div className='w-10 shrink-0 text-right font-mono text-xs'>
        {item.rating ? (
          <span className='inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400'>
            <Star className='size-3 fill-current' />
            {item.rating}
          </span>
        ) : (
          <span className='text-gray-400'>—</span>
        )}
      </div>
      <span className='hidden w-20 shrink-0 text-right text-[11px] text-gray-500 lg:block dark:text-gray-400'>
        {relativeDate(item.watched_at || item.updated_at)}
      </span>
      <button
        type='button'
        aria-label={`${item.title} 更多操作`}
        aria-haspopup='menu'
        aria-expanded={menuOpen}
        onClick={(e) => onMenu(item, e.currentTarget)}
        className='shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100'
      >
        <MoreHorizontal className='size-4' />
      </button>
    </div>
  );
}

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '剧集' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: '最近观看' },
  { value: 'rating', label: '评分最高' },
  { value: 'year', label: '年份' },
  { value: 'title', label: '标题' },
];

function WatchedPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const traktFlash = searchParams.get('trakt');
  const simklFlash = searchParams.get('simkl');
  const { list, loading, reload } = useWatchStatusList(true);

  const [filter, setFilter] = useState<FilterTab>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewMode>('grid');
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(
    null,
  );
  const [apiOpen, setApiOpen] = useState(false);
  const [simkl, setSimkl] = useState<SimklState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [localMode, setLocalMode] = useState(false);

  useEffect(() => {
    const p = readPrefs();
    if (p.view) setView(p.view);
    if (p.sort) setSort(p.sort);
    setLocalMode(isLocalStorageMode());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view, sort }));
    } catch {
      /* ignore */
    }
  }, [view, sort]);

  useEffect(() => {
    if (isLocalStorageMode()) return;
    fetch('/api/simkl/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j) =>
          j &&
          setSimkl({
            connected: Boolean(j.connected),
            lastFullSyncAt: j.lastFullSyncAt || null,
          }),
      )
      .catch(() => undefined);
  }, []);

  const typed = useMemo(
    () =>
      list.filter((i) => typeFilter === 'all' || i.media_type === typeFilter),
    [list, typeFilter],
  );

  const stats = useMemo(() => {
    const s = {
      all: typed.length,
      watching: 0,
      completed: 0,
      dropped: 0,
      rated: 0,
      sum: 0,
    };
    for (const i of typed) {
      if (i.status === 'watching') s.watching += 1;
      else if (i.status === 'dropped') s.dropped += 1;
      else s.completed += 1;
      if (i.rating) {
        s.rated += 1;
        s.sum += i.rating;
      }
    }
    return s;
  }, [typed]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = typed.filter((item) => {
      if (!matchesFilter(item, filter)) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        (item.english_title || '').toLowerCase().includes(needle) ||
        (item.year || '').includes(needle)
      );
    });
    return sortItems(rows, sort);
  }, [typed, filter, q, sort]);

  const menuItem = menu ? list.find((i) => i.key === menu.key) : undefined;
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback(
    (item: WatchStatus, anchor: HTMLElement) =>
      setMenu((m) => (m?.key === item.key ? null : { key: item.key, anchor })),
    [],
  );

  const handleAction = useCallback(
    async (item: WatchStatus, action: ItemAction) => {
      const identity = {
        tmdbId: item.tmdb_id,
        mediaType: item.media_type,
        doubanId: item.douban_id,
        source: item.source,
        id: item.id,
        title: item.title,
        year: item.year,
        cover: item.cover,
      };
      try {
        if (action.type === 'rate') {
          await postWatchStatus({
            action: 'rate',
            ...identity,
            rating: action.rating,
          });
        } else if (action.type === 'status') {
          await postWatchStatus({
            action: 'setStatus',
            ...identity,
            status: action.status,
          });
        } else {
          await postWatchStatus({ action: 'unmark', ...identity });
          toast.success(`已移除「${item.title}」`);
        }
      } catch (e: any) {
        toast.error(e?.message || '操作失败');
        await reload();
      }
    },
    [reload],
  );

  const runSync = async () => {
    setSyncing(true);
    const id = toast.loading('正在与 Simkl 双向同步…');
    try {
      const res = await fetch('/api/simkl/sync', {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const pushedTitles = json.pushed.movies + json.pushed.shows;
      const parts = [
        `拉取新增 ${json.pulled.added}`,
        `更新 ${json.pulled.updated}`,
        `推送 ${pushedTitles} 部${json.pushed.episodes ? `（${json.pushed.episodes} 集）` : ''}`,
      ];
      if (json.pushed.ratings) parts.push(`评分 ${json.pushed.ratings}`);
      if (json.pushed.statuses) parts.push(`状态 ${json.pushed.statuses}`);
      const extra = [
        json.skippedNoTmdb ? `${json.skippedNoTmdb} 条无 TMDB ID 已跳过` : '',
        json.errors?.length ? `${json.errors.length} 个请求失败` : '',
      ]
        .filter(Boolean)
        .join('，');
      (json.errors?.length ? toast.warning : toast.success)('同步完成', {
        id,
        description: parts.join(' · ') + (extra ? `\n${extra}` : ''),
      });
      setSimkl((s) => (s ? { ...s, lastFullSyncAt: json.syncedAt } : s));
      await reload();
    } catch (e: any) {
      toast.error('同步失败', { id, description: e?.message });
    } finally {
      setSyncing(false);
    }
  };

  const statTiles: {
    value: FilterTab;
    label: string;
    count: number;
    dot?: string;
  }[] = [
    { value: 'all', label: '全部', count: stats.all },
    {
      value: 'completed',
      label: '已看完',
      count: stats.completed,
      dot: 'bg-emerald-400',
    },
    {
      value: 'watching',
      label: '在看',
      count: stats.watching,
      dot: 'bg-sky-400',
    },
    {
      value: 'dropped',
      label: '弃番',
      count: stats.dropped,
      dot: 'bg-rose-400',
    },
  ];

  const flash =
    (simklFlash === 'connected' && {
      ok: true,
      text: 'Simkl 已连接，并已拉取观看历史（本地记录优先）。',
    }) ||
    (simklFlash && {
      ok: false,
      text: `Simkl 连接失败（${simklFlash}），可在设置中重试。`,
    }) ||
    (traktFlash === 'connected' && {
      ok: true,
      text: 'Trakt 已连接，并已尝试拉取观看历史（本地记录优先）。',
    }) ||
    (traktFlash && {
      ok: false,
      text: `Trakt 连接失败（${traktFlash}），可在设置中重试。`,
    }) ||
    null;

  const selectCls =
    'h-9 rounded-lg border border-gray-200 bg-white/80 px-2.5 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-green-500/40 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-200';

  return (
    <PageLayout activePath='/watched'>
      <div className='mx-auto w-full max-w-[1600px] px-3 pb-24 pt-5 sm:px-6 sm:pt-8'>
        {/* Header */}
        <header className='mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <div className='mb-1.5 flex items-center gap-2'>
              <span
                aria-hidden='true'
                className='inline-block size-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(230,185,74,0.8)] dark:bg-green-400'
              />
              <span className='eyebrow'>WATCH LOG</span>
            </div>
            <h1 className='text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50 sm:text-3xl'>
              我的观看
            </h1>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              播放到约 80% 自动标记
              {stats.rated > 0 &&
                ` · 已评分 ${stats.rated} 部，平均 ${(stats.sum / stats.rated).toFixed(1)}`}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {simkl?.connected && (
              <button
                type='button'
                onClick={runSync}
                disabled={syncing}
                className='btn-ghost h-9 px-3 text-sm'
                title={
                  simkl.lastFullSyncAt
                    ? `上次同步：${relativeDate(simkl.lastFullSyncAt)}`
                    : '尚未双向同步过'
                }
              >
                <RefreshCw
                  className={`size-4 ${syncing ? 'animate-spin' : ''}`}
                />
                {syncing ? '同步中…' : '同步 Simkl'}
                {!syncing && simkl.lastFullSyncAt && (
                  <span className='hidden font-mono text-[10px] font-normal text-gray-400 sm:inline'>
                    {relativeDate(simkl.lastFullSyncAt)}
                  </span>
                )}
              </button>
            )}
            {!localMode && (
              <button
                type='button'
                onClick={() => setApiOpen(true)}
                className='btn-ghost h-9 px-3 text-sm'
              >
                <KeyRound className='size-4' />
                API
              </button>
            )}
          </div>
        </header>

        {flash && (
          <p
            className={`mb-4 rounded-lg px-3 py-2 text-xs ${flash.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}
          >
            {flash.text}
          </p>
        )}

        {/* Stat tiles double as status filter */}
        <div
          role='tablist'
          aria-label='按状态筛选'
          className='mb-4 grid grid-cols-4 gap-2 sm:max-w-xl'
        >
          {statTiles.map((t) => {
            const active = filter === t.value;
            return (
              <button
                key={t.value}
                type='button'
                role='tab'
                aria-selected={active}
                onClick={() => setFilter(t.value)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  active
                    ? 'border-green-500/60 bg-green-50/80 dark:border-green-400/50 dark:bg-green-400/10'
                    : 'border-gray-200/80 bg-white/60 hover:border-gray-300 dark:border-gray-700/70 dark:bg-gray-900/40 dark:hover:border-gray-600'
                }`}
              >
                <p className='font-mono text-lg font-bold leading-tight text-gray-900 dark:text-gray-50 sm:text-xl'>
                  {t.count}
                </p>
                <p className='mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400'>
                  {t.dot && (
                    <span className={`size-1.5 rounded-full ${t.dot}`} />
                  )}
                  {t.label}
                </p>
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className='mb-4 flex flex-wrap items-center gap-2'>
          <div className='relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-xs'>
            <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400' />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder='搜索标题 / 年份'
              aria-label='搜索观看记录'
              className='h-9 w-full rounded-lg border border-gray-200 bg-white/80 pl-8 pr-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-green-500/40 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-100'
            />
          </div>
          <select
            aria-label='类型'
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className={selectCls}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label='排序'
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className={selectCls}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className='ml-auto flex items-center gap-2'>
            <span className='hidden font-mono text-xs text-gray-500 sm:inline dark:text-gray-400'>
              {filtered.length} 部
            </span>
            <div
              role='group'
              aria-label='视图'
              className='flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700'
            >
              {(
                [
                  ['grid', LayoutGrid, '网格'],
                  ['list', List, '列表'],
                ] as const
              ).map(([v, Icon, label]) => (
                <button
                  key={v}
                  type='button'
                  aria-pressed={view === v}
                  aria-label={`${label}视图`}
                  onClick={() => setView(v)}
                  className={`rounded-md p-1.5 transition ${view === v ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-100'}`}
                >
                  <Icon className='size-4' />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        {loading && list.length === 0 ? (
          <div className='grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9 2xl:grid-cols-10'>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i}>
                <div className='aspect-[2/3] animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800/60' />
                <div className='mt-1.5 h-3 w-3/4 animate-pulse rounded bg-gray-100 dark:bg-gray-800/60' />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className='flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 px-6 py-16 text-center dark:border-gray-700'>
            <Eye className='mb-3 size-12 text-gray-300 dark:text-gray-600' />
            <p className='text-base font-medium text-gray-700 dark:text-gray-200'>
              {list.length > 0 ? '没有匹配的记录' : '暂无观看记录'}
            </p>
            <p className='mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400'>
              {list.length > 0
                ? '换个筛选条件或搜索词试试。'
                : simkl?.connected
                  ? '可以点击右上角「同步 Simkl」把 Simkl 上的记录拉过来。'
                  : '播放至约 80% 会自动标记；也可在播放页手动标记 / 评分。'}
            </p>
            {list.length === 0 && (
              <button
                type='button'
                onClick={() => router.push('/search')}
                className='btn-gold mt-4 px-4 py-2 text-sm'
              >
                <Search className='size-4' />
                去搜索内容
              </button>
            )}
          </div>
        ) : view === 'grid' ? (
          <div className='grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9 2xl:grid-cols-10'>
            {filtered.map((item) => (
              <GridCard
                key={item.key}
                item={item}
                onMenu={openMenu}
                menuOpen={menu?.key === item.key}
              />
            ))}
          </div>
        ) : (
          <div className='hairline-card divide-y divide-gray-200/70 overflow-hidden rounded-xl dark:divide-gray-800/80'>
            <div className='hidden items-center gap-3 bg-gray-50/80 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 sm:flex dark:bg-gray-900/60 dark:text-gray-400'>
              <span className='w-10 shrink-0' />
              <span className='flex-1'>标题</span>
              <span className='w-16 shrink-0 text-center'>状态</span>
              <span className='hidden w-28 shrink-0 md:block'>进度</span>
              <span className='w-10 shrink-0 text-right'>评分</span>
              <span className='hidden w-20 shrink-0 text-right lg:block'>
                最近
              </span>
              <span className='w-7 shrink-0' />
            </div>
            {filtered.map((item) => (
              <ListRow
                key={item.key}
                item={item}
                onMenu={openMenu}
                menuOpen={menu?.key === item.key}
              />
            ))}
          </div>
        )}
      </div>

      {menu && menuItem && (
        <ItemActionsMenu
          item={menuItem}
          anchor={menu.anchor}
          onClose={closeMenu}
          onAction={handleAction}
        />
      )}
      <WatchApiDialog open={apiOpen} onClose={() => setApiOpen(false)} />
    </PageLayout>
  );
}

export default function WatchedPage() {
  return (
    <Suspense
      fallback={
        <PageLayout activePath='/watched'>
          <div className='mx-auto max-w-6xl px-4 py-10 text-sm text-gray-500'>
            加载中…
          </div>
        </PageLayout>
      }
    >
      <WatchedPageInner />
    </Suspense>
  );
}
