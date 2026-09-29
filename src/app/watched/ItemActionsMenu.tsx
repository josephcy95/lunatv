'use client';

import { Check, ExternalLink, Play, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { WatchShowStatus, WatchStatus } from '@/lib/watchStatus';

import UserRatingControl from '@/components/play/UserRatingControl';

import { isDone, playHref, simklHref } from './watchedShared';

export type ItemAction =
  | { type: 'rate'; rating: number | null }
  | { type: 'status'; status: WatchShowStatus }
  | { type: 'remove' };

interface Props {
  item: WatchStatus;
  anchor: HTMLElement;
  onClose: () => void;
  onAction: (item: WatchStatus, action: ItemAction) => Promise<void>;
}

const WIDTH = 232;

/** Anchored popover: rating, status, links, remove. Portaled to avoid clipping. */
export default function ItemActionsMenu({
  item,
  anchor,
  onClose,
  onAction,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight || 280;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, r.right - WIDTH), vw - WIDTH - 8);
    const below = r.bottom + 6;
    const top = below + h > vh - 8 ? Math.max(8, r.top - h - 6) : below;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const close = () => onClose();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, { passive: true, capture: true });
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    // Focus the container, not the first star (focus previews a rating)
    ref.current?.focus();
  }, []);

  const run = async (action: ItemAction, close = true) => {
    setBusy(true);
    try {
      await onAction(item, action);
      if (close) onClose();
    } finally {
      setBusy(false);
    }
  };

  const statuses: { value: WatchShowStatus; label: string }[] = [
    ...(item.media_type === 'tv'
      ? [{ value: 'watching' as const, label: '在看' }]
      : []),
    {
      value: item.media_type === 'tv' ? 'completed' : 'watched',
      label: '已看完',
    },
    { value: 'dropped', label: '弃番' },
  ];
  const current = (s: WatchShowStatus) =>
    s === item.status || (isDone(s) && isDone(item.status));
  const simkl = simklHref(item);

  return createPortal(
    <div
      ref={ref}
      role='menu'
      tabIndex={-1}
      aria-label={`${item.title} 操作`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
      className='fixed z-[1000] rounded-xl border border-gray-200 bg-white p-1.5 text-sm text-gray-800 shadow-xl outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
    >
      <div className='px-2.5 pb-2 pt-1.5'>
        <p className='truncate text-xs font-semibold'>{item.title}</p>
        <div className='mt-1.5'>
          <UserRatingControl
            compact
            rating={item.rating}
            disabled={busy}
            onChange={(rating) => run({ type: 'rate', rating }, false)}
          />
        </div>
      </div>
      <div className='my-1 h-px bg-gray-200/70 dark:bg-gray-700/60' />
      {statuses.map((s) => (
        <button
          key={s.value}
          type='button'
          role='menuitemradio'
          aria-checked={current(s.value)}
          disabled={busy || current(s.value)}
          onClick={() => run({ type: 'status', status: s.value })}
          className='flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-gray-800/70'
        >
          <span>标为{s.label}</span>
          {current(s.value) && (
            <Check className='size-4 text-green-600 dark:text-green-400' />
          )}
        </button>
      ))}
      <div className='my-1 h-px bg-gray-200/70 dark:bg-gray-700/60' />
      <a
        role='menuitem'
        href={playHref(item)}
        className='flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800/70'
      >
        <Play className='size-4 text-gray-500' /> 播放
      </a>
      {simkl && (
        <a
          role='menuitem'
          href={simkl}
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800/70'
        >
          <ExternalLink className='size-4 text-gray-500' /> 在 Simkl 查看
        </a>
      )}
      <button
        type='button'
        role='menuitem'
        disabled={busy}
        onClick={() =>
          confirmRemove ? run({ type: 'remove' }) : setConfirmRemove(true)
        }
        className='flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10'
      >
        <Trash2 className='size-4' />
        {confirmRemove ? '再点一次确认移除' : '移除记录'}
      </button>
    </div>,
    document.body,
  );
}
