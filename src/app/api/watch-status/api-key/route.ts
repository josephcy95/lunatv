import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { ensureWatchApiKey, watchApiSupported } from '@/lib/watchApiKey';

export const runtime = 'nodejs';

async function handle(request: NextRequest, rotate: boolean) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!watchApiSupported()) {
    return NextResponse.json(
      { error: 'localstorage 模式下观看记录只存在浏览器里，无法提供 API' },
      { status: 400 },
    );
  }
  const apiKey = await ensureWatchApiKey(auth.username, rotate);
  return NextResponse.json({ apiKey, endpoint: '/api/v1/watched' });
}

/** GET: current key (created on first request). */
export async function GET(request: NextRequest) {
  return handle(request, false);
}

/** POST: regenerate — the old key stops working. */
export async function POST(request: NextRequest) {
  return handle(request, true);
}
