/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

const store: Record<string, any> = {};

jest.mock('@/lib/db', () => ({
  dbManager: {
    getUserWatchData: jest.fn(async (u: string) => store[u] ?? null),
    saveUserWatchData: jest.fn(async (u: string, d: any) => {
      store[u] = JSON.parse(JSON.stringify(d));
    }),
  },
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(async () => ({
    UserConfig: {
      Users: [{ username: 'alice' }, { username: 'bob', banned: true }],
    },
  })),
}));

process.env.NEXT_PUBLIC_STORAGE_TYPE = 'kvrocks';
process.env.USERNAME = 'owner';

const { GET } = require('./route');

const { ensureWatchApiKey } = require('@/lib/watchApiKey');

const req = (qs: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/v1/watched${qs}`, { headers });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  store.alice = {
    items: {
      'movie:1': {
        key: 'movie:1',
        tmdb_id: 1,
        media_type: 'movie',
        title: '电影A',
        english_title: 'Movie A',
        year: '2021',
        status: 'watched',
        rating: 9,
        watched_at: 2000,
        updated_at: 2000,
      },
      'tv:2': {
        key: 'tv:2',
        tmdb_id: 2,
        media_type: 'tv',
        title: '剧B',
        status: 'watching',
        watched_episodes: { 'ep:1': 1, 'ep:2': 1 },
        known_episode_count: 10,
        updated_at: 3000,
      },
      'douban:3': {
        key: 'douban:3',
        douban_id: 3,
        media_type: 'tv',
        title: '剧C',
        status: 'dropped',
        updated_at: 1000,
      },
    },
  };
});

describe('watch API key', () => {
  it('is stable across calls and rotates on demand', async () => {
    const a = await ensureWatchApiKey('alice');
    expect(a).toMatch(/^lunatv_[A-Za-z0-9_-]+_[0-9a-f]{48}$/);
    expect(await ensureWatchApiKey('alice')).toBe(a);
    const b = await ensureWatchApiKey('alice', true);
    expect(b).not.toBe(a);
    // items preserved in the same blob
    expect(Object.keys(store.alice.items)).toHaveLength(3);
  });
});

describe('GET /api/v1/watched', () => {
  it('rejects missing, forged, rotated and banned keys', async () => {
    expect((await GET(req(''))).status).toBe(401);
    const key = await ensureWatchApiKey('alice');
    const forged = key.replace(/.$/, key.endsWith('0') ? '1' : '0');
    expect((await GET(req(`?key=${forged}`))).status).toBe(401);
    await ensureWatchApiKey('alice', true);
    expect((await GET(req(`?key=${key}`))).status).toBe(401);
    store.bob = { items: {} };
    const bobKey = await ensureWatchApiKey('bob');
    expect((await GET(req(`?key=${bobKey}`))).status).toBe(401);
  });

  it('returns JSON via bearer header, sorted by recent', async () => {
    const key = await ensureWatchApiKey('alice');
    const res = await GET(req('', { authorization: `Bearer ${key}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const json = await res.json();
    expect(json.user).toBe('alice');
    expect(json.summary).toEqual({
      total: 3,
      completed: 1,
      watching: 1,
      dropped: 1,
      rated: 1,
    });
    expect(json.items.map((i: any) => i.title)).toEqual([
      '剧B',
      '电影A',
      '剧C',
    ]);
    expect(json.items[1]).toMatchObject({
      original_title: 'Movie A',
      year: 2021,
      type: 'movie',
      status: 'completed',
      rating: 9,
      episodes_watched: null,
      ids: { tmdb: 1, imdb: null, douban: null, simkl: null },
    });
    expect(json.items[0]).toMatchObject({
      episodes_watched: 2,
      episodes_total: 10,
    });
    expect(JSON.stringify(json)).not.toContain('api_key');
  });

  it('filters and renders text', async () => {
    const key = await ensureWatchApiKey('alice');
    const f = await (
      await GET(req(`?key=${key}&status=completed,dropped&type=tv`))
    ).json();
    expect(f.items.map((i: any) => i.title)).toEqual(['剧C']);
    const r = await (await GET(req(`?key=${key}&min_rating=8`))).json();
    expect(r.items).toHaveLength(1);

    const text = await (await GET(req(`?key=${key}&format=text`))).text();
    expect(text).toContain('## Completed (1)');
    expect(text).toContain('- 电影A / Movie A (2021) | Movie | rating 9');
    expect(text).toContain('- 剧B | TV | rating - | episodes 2/10');
  });
});
