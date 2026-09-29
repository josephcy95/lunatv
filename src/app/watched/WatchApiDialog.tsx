'use client';

import { Check, Copy, KeyRound, RefreshCw, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Self-contained prompt an AI agent can use without reading any other docs. */
export function buildAgentPrompt(origin: string, key: string) {
  return `You have read access to my movie & TV watch history through an HTTP API.

Endpoint: GET ${origin}/api/v1/watched
Auth: header "Authorization: Bearer ${key}" (or append ?key=${key} if you cannot set headers)

Useful query parameters (all optional):
- format=text    compact plain-text list (best for reading); default is JSON
- status=completed,watching,dropped   filter by status (comma separated)
- type=movie|tv  filter by media type
- min_rating=8   only titles I rated at least this (scale 1-10)
- sort=recent|rating|title   default recent

JSON response: { user, generated_at, rating_scale: "1-10", summary: {total, completed, watching, dropped, rated}, items: [...] }
Each item: title (display title, often Chinese), original_title (English/TMDB title or null), year, type ("movie"|"tv"), status ("completed"|"watching"|"dropped"), rating (1-10 or null), episodes_watched, episodes_total, last_watched_at (ISO 8601), ids { tmdb, imdb, douban, simkl }.

How to interpret it:
- "completed" = finished; "watching" = in progress; "dropped" = I gave up on it (a negative signal).
- rating is my personal score; null means I did not rate it, not that I disliked it.
- Use ids.tmdb / ids.imdb to look titles up precisely.
- The API is read-only.

Task: fetch my history first (start with ?format=text), then recommend titles I have not watched yet that match my taste. For each recommendation, say which of my watched titles it relates to and why.`;
}

export default function WatchApiDialog({ open, onClose }: Props) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async (rotate = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/watch-status/api-key', {
        method: rotate ? 'POST' : 'GET',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setApiKey(json.apiKey);
      if (rotate) toast.success('已生成新 key，旧 key 已失效');
    } catch (e: any) {
      setError(e?.message || '获取失败');
    } finally {
      setLoading(false);
      setConfirmRotate(false);
    }
  }, []);

  useEffect(() => {
    if (open && !apiKey) load();
  }, [open, apiKey, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      toast.error('复制失败，请手动选择文本复制');
    }
  };

  if (!open) return null;

  const endpoint = `${origin}/api/v1/watched`;
  const rows = apiKey
    ? [
        { id: 'key', label: 'API Key', value: apiKey },
        { id: 'json', label: 'JSON 接口', value: `${endpoint}?key=${apiKey}` },
        {
          id: 'text',
          label: '纯文本（适合直接给 AI 读）',
          value: `${endpoint}?format=text&key=${apiKey}`,
        },
        {
          id: 'curl',
          label: 'curl',
          value: `curl -H "Authorization: Bearer ${apiKey}" "${endpoint}?format=text"`,
        },
      ]
    : [];

  const CopyIcon = ({ id }: { id: string }) =>
    copied === id ? (
      <Check className='size-3.5 text-green-500' />
    ) : (
      <Copy className='size-3.5' />
    );

  return createPortal(
    <div className='fixed inset-0 z-[1000] flex items-end justify-center sm:items-center sm:p-4'>
      <div
        className='absolute inset-0 bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        aria-hidden='true'
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='watch-api-title'
        className='glass-panel relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl sm:p-6'
      >
        <div className='mb-4 flex items-start justify-between gap-3'>
          <div>
            <p className='eyebrow'>WATCH HISTORY API</p>
            <h2
              id='watch-api-title'
              className='mt-1 flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-50'
            >
              <KeyRound className='size-5 text-green-600 dark:text-green-400' />
              给 AI 读取我的观看记录
            </h2>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              只读接口，返回全部观看记录、状态与评分。key
              固定不变，可随时回来复制。
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            aria-label='关闭'
            className='rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
          >
            <X className='size-5' />
          </button>
        </div>

        {error ? (
          <div className='rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'>
            {error}
          </div>
        ) : !apiKey ? (
          <div className='space-y-2'>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className='h-12 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800/60'
              />
            ))}
          </div>
        ) : (
          <>
            <button
              type='button'
              onClick={() => copy('prompt', buildAgentPrompt(origin, apiKey))}
              className='btn-gold mb-4 w-full px-4 py-2.5 text-sm'
            >
              {copied === 'prompt' ? (
                <Check className='size-4' />
              ) : (
                <Sparkles className='size-4' />
              )}
              {copied === 'prompt'
                ? '已复制，粘贴给 AI 即可'
                : '一键复制给 AI 的完整说明'}
            </button>

            <div className='space-y-2.5'>
              {rows.map((r) => (
                <div key={r.id}>
                  <p className='mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400'>
                    {r.label}
                  </p>
                  <div className='flex items-stretch gap-1.5'>
                    <code
                      className='min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-white/70 px-2.5 py-2 font-mono text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-950/50 dark:text-gray-200'
                      title={r.value}
                    >
                      {r.value}
                    </code>
                    <button
                      type='button'
                      onClick={() => copy(r.id, r.value)}
                      aria-label={`复制${r.label}`}
                      className='btn-ghost shrink-0 px-2.5 text-xs'
                    >
                      <CopyIcon id={r.id} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className='mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200/70 pt-4 text-xs dark:border-gray-700/60'>
              <span className='text-gray-500 dark:text-gray-400'>
                文档：docs/features/watched-api.md
              </span>
              <button
                type='button'
                disabled={loading}
                onClick={() =>
                  confirmRotate ? load(true) : setConfirmRotate(true)
                }
                className='inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-gray-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300'
              >
                <RefreshCw
                  className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
                />
                {confirmRotate ? '确认重新生成？旧 key 将失效' : '重新生成 key'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
