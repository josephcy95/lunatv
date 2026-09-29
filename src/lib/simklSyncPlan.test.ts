import {
  parseSimklAllItems,
  planSimklSync,
  type SimklRemoteItem,
} from './simklSyncPlan';
import type { WatchStatus } from './watchStatus';

const NOW = 1_700_000_000_000;

function remote(p: Partial<SimklRemoteItem>): SimklRemoteItem {
  return {
    mediaType: 'tv',
    tmdbId: 1,
    title: 'Show',
    status: 'watching',
    watchedEpisodes: 0,
    ...p,
  };
}

function tv(p: Partial<WatchStatus> & { eps?: number }): WatchStatus {
  const { eps = 0, ...rest } = p;
  const watched_episodes: Record<string, number> = {};
  for (let i = 1; i <= eps; i++) watched_episodes[`ep:${i}`] = NOW - 1000;
  return {
    key: `tv:${rest.tmdb_id ?? 1}`,
    tmdb_id: 1,
    media_type: 'tv',
    title: '剧',
    status: 'watching',
    updated_at: NOW - 1000,
    ...(eps ? { watched_episodes } : {}),
    ...rest,
  };
}

describe('parseSimklAllItems', () => {
  it('normalizes movies, shows and anime; skips rows without tmdb', () => {
    const rows = parseSimklAllItems({
      movies: [
        {
          status: 'completed',
          user_rating: 8,
          last_watched_at: '2024-01-01T00:00:00Z',
          movie: {
            title: 'M',
            year: 2020,
            poster: '74/abc',
            ids: { tmdb: '11', imdb: 'tt1', simkl: 5 },
          },
        },
      ],
      shows: [
        {
          status: 'watching',
          watched_episodes_count: 3,
          total_episodes_count: 10,
          show: { title: 'S', ids: { tmdb: 22 } },
        },
        { status: 'watching', show: { title: 'NoTmdb', ids: { simkl: 9 } } },
      ],
      anime: [
        {
          status: 'completed',
          watched_episodes_count: 12,
          show: { title: 'A', ids: { tmdb: 33 } },
        },
      ],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      mediaType: 'movie',
      tmdbId: 11,
      imdbId: 'tt1',
      rating: 8,
      year: '2020',
      simklId: 5,
    });
    expect(rows[0].poster).toContain('simkl.in/posters/74/abc_m.webp');
    expect(rows[1]).toMatchObject({
      mediaType: 'tv',
      tmdbId: 22,
      watchedEpisodes: 3,
      totalEpisodes: 10,
    });
    expect(rows[2]).toMatchObject({
      mediaType: 'tv',
      tmdbId: 33,
      status: 'completed',
    });
  });
});

describe('planSimklSync — pull', () => {
  it('adds remote-only items and skips plantowatch', () => {
    const plan = planSimklSync(
      {},
      [
        remote({
          mediaType: 'movie',
          tmdbId: 10,
          status: 'completed',
          rating: 7,
        }),
        remote({
          tmdbId: 20,
          status: 'completed',
          watchedEpisodes: 8,
          totalEpisodes: 10,
        }),
        remote({ tmdbId: 30, status: 'plantowatch' }),
      ],
      NOW,
    );
    expect(plan.pulled.added).toBe(2);
    expect(plan.items['movie:10']).toMatchObject({
      status: 'watched',
      rating: 7,
    });
    const show = plan.items['tv:20'];
    expect(show.status).toBe('completed');
    expect(Object.keys(show.watched_episodes!)).toHaveLength(10);
    expect(plan.items['tv:30']).toBeUndefined();
    // Nothing to push back for freshly pulled items (ratings match remote)
    expect(plan.push).toEqual({
      historyMovies: [],
      historyShows: [],
      ratings: [],
      lists: [],
    });
  });

  it('unions episodes, keeps local rating, fills missing rating', () => {
    const plan = planSimklSync(
      {
        'tv:1': tv({ eps: 2, rating: 9 }),
        'tv:2': tv({ key: 'tv:2', tmdb_id: 2, eps: 1 }),
      },
      [
        remote({ tmdbId: 1, watchedEpisodes: 5, rating: 6 }),
        remote({ tmdbId: 2, watchedEpisodes: 1, rating: 8 }),
      ],
      NOW,
    );
    expect(Object.keys(plan.items['tv:1'].watched_episodes!)).toHaveLength(5);
    expect(plan.items['tv:1'].rating).toBe(9);
    expect(plan.items['tv:2'].rating).toBe(8);
    expect(plan.pulled.updated).toBe(2);
    // local rating wins → pushed
    expect(plan.push.ratings).toEqual([
      expect.objectContaining({ tmdbId: 1, rating: 9 }),
    ]);
  });

  it('local dropped is not overridden by remote progress', () => {
    const plan = planSimklSync(
      { 'tv:1': tv({ eps: 2, status: 'dropped' }) },
      [remote({ tmdbId: 1, status: 'completed', watchedEpisodes: 10 })],
      NOW,
    );
    expect(plan.items['tv:1'].status).toBe('dropped');
    expect(plan.push.lists).toEqual([
      expect.objectContaining({ to: 'dropped' }),
    ]);
  });

  it('remote completion advances local watching → completed', () => {
    const plan = planSimklSync(
      { 'tv:1': tv({ eps: 2 }) },
      [
        remote({
          tmdbId: 1,
          status: 'completed',
          watchedEpisodes: 4,
          totalEpisodes: 4,
        }),
      ],
      NOW,
    );
    expect(plan.items['tv:1'].status).toBe('completed');
    expect(plan.push.lists).toEqual([]);
  });

  it('matches local items keyed by douban when they carry a tmdb id', () => {
    const local = tv({ key: 'douban:99', douban_id: 99, eps: 1 });
    const plan = planSimklSync(
      { 'douban:99': local },
      [remote({ tmdbId: 1, watchedEpisodes: 3 })],
      NOW,
    );
    expect(plan.items['tv:1']).toBeUndefined();
    expect(Object.keys(plan.items['douban:99'].watched_episodes!)).toHaveLength(
      3,
    );
  });

  it('leaves unchanged items referentially equal', () => {
    const local = { 'tv:1': tv({ eps: 3, english_title: 'Show' }) };
    const plan = planSimklSync(
      local,
      [remote({ tmdbId: 1, watchedEpisodes: 3 })],
      NOW,
    );
    expect(plan.items['tv:1']).toBe(local['tv:1']);
    expect(plan.pulled.updated).toBe(0);
  });
});

describe('planSimklSync — push', () => {
  it('pushes local-only movies and shows, skips items without tmdb', () => {
    const plan = planSimklSync(
      {
        'movie:5': {
          key: 'movie:5',
          tmdb_id: 5,
          media_type: 'movie',
          title: '电影',
          english_title: 'Film',
          status: 'watched',
          watched_at: NOW - 5,
          updated_at: NOW - 5,
        },
        'tv:1': tv({ eps: 3 }),
        'src:x+y': {
          key: 'src:x+y',
          media_type: 'tv',
          title: '短剧',
          status: 'watching',
          updated_at: NOW,
        },
      },
      [],
      NOW,
    );
    expect(plan.push.historyMovies).toEqual([
      expect.objectContaining({ tmdbId: 5, title: 'Film', watchedAt: NOW - 5 }),
    ]);
    expect(plan.push.historyShows[0].episodes.map((e) => e.number)).toEqual([
      1, 2, 3,
    ]);
    expect(plan.skippedNoTmdb).toBe(1);
  });

  it('pushes only episodes beyond the remote count', () => {
    const plan = planSimklSync(
      { 'tv:1': tv({ eps: 6 }) },
      [remote({ tmdbId: 1, watchedEpisodes: 4 })],
      NOW,
    );
    expect(plan.push.historyShows[0].episodes.map((e) => e.number)).toEqual([
      5, 6,
    ]);
  });

  it('does not re-push a movie Simkl already has as completed', () => {
    const plan = planSimklSync(
      {
        'movie:5': {
          key: 'movie:5',
          tmdb_id: 5,
          media_type: 'movie',
          title: 'M',
          status: 'watched',
          updated_at: NOW,
        },
      },
      [remote({ mediaType: 'movie', tmdbId: 5, status: 'completed' })],
      NOW,
    );
    expect(plan.push.historyMovies).toEqual([]);
  });

  it('pushes a watched movie that is only in plantowatch on Simkl', () => {
    const plan = planSimklSync(
      {
        'movie:5': {
          key: 'movie:5',
          tmdb_id: 5,
          media_type: 'movie',
          title: 'M',
          status: 'watched',
          updated_at: NOW,
        },
      },
      [remote({ mediaType: 'movie', tmdbId: 5, status: 'plantowatch' })],
      NOW,
    );
    expect(plan.push.historyMovies).toHaveLength(1);
  });
});
