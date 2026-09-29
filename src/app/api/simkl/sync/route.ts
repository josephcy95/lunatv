/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { dbManager } from '@/lib/db';
import { getSimklAppCredentials } from '@/lib/simkl';
import { runSimklTwoWaySync } from '@/lib/simklSync';

export const runtime = 'nodejs';
// Large libraries push in 1 req/sec batches
export const maxDuration = 300;

/** POST: manual two-way sync between local watch data and Simkl. */
export async function POST(request: NextRequest) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const creds = await getSimklAppCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: '管理员尚未配置 Simkl Client ID' },
      { status: 400 },
    );
  }
  const tokens = await dbManager.getUserSimklTokens(auth.username);
  if (!tokens?.access_token) {
    return NextResponse.json({ error: 'Simkl 未连接' }, { status: 400 });
  }
  try {
    const result = await runSimklTwoWaySync(
      auth.username,
      creds.clientId,
      tokens,
    );
    return NextResponse.json(result);
  } catch (e: any) {
    console.warn('Simkl two-way sync failed', e?.message || e);
    return NextResponse.json(
      { error: e?.message || 'Simkl 同步失败' },
      { status: 502 },
    );
  }
}
