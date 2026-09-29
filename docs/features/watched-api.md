# Watched API

A read-only HTTP API that gives your LunaTV watch history (titles, status, ratings) to other tools, such as an AI agent that recommends what to watch next.

The quickest way to use it: open **我的观看 → API** and click **一键复制给 AI 的完整说明**. That copies a ready-to-paste prompt with your URL and key filled in. The rest of this page is the full reference.

> Requires a server-side storage backend (`kvrocks` / `redis` / `upstash` / `sqlite`). In `localstorage` mode the history only exists in the browser, so the API is unavailable.

## Authentication

Every user has a single fixed API key. Get it from **我的观看 → API**. The key stays the same until you regenerate it; regenerating invalidates the old key immediately.

Pass the key in either form:

```http
Authorization: Bearer lunatv_xxxxxxxx_xxxxxxxxxxxxxxxx
```

```
GET /api/v1/watched?key=lunatv_xxxxxxxx_xxxxxxxxxxxxxxxx
```

The query-string form is for agents that can only fetch a URL. It is read-only and scoped to your own history, but anyone holding the URL can read that history. Regenerate the key if it leaks.

## Endpoint

```
GET {origin}/api/v1/watched
```

### Query parameters

All optional.

| Parameter    | Values                                          | Default  | Description                                                                 |
| ------------ | ----------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `format`     | `json`, `text`                                  | `json`   | `text` returns a compact Markdown-style list, handy to give an LLM directly |
| `status`     | `completed`, `watching`, `dropped` (comma list) | all      | Filter by status, e.g. `status=completed,watching`                          |
| `type`       | `movie`, `tv`                                   | all      | Filter by media type                                                        |
| `min_rating` | `1`–`10`                                        | –        | Only titles rated at least this                                             |
| `sort`       | `recent`, `rating`, `title`                     | `recent` | Sort order; `recent` = last watched first                                   |

### JSON response

```json
{
  "user": "alice",
  "generated_at": "2026-09-30T12:00:00.000Z",
  "rating_scale": "1-10",
  "summary": {
    "total": 3,
    "completed": 1,
    "watching": 1,
    "dropped": 1,
    "rated": 1
  },
  "items": [
    {
      "title": "示例剧集",
      "original_title": "Example Show",
      "year": 2023,
      "type": "tv",
      "status": "completed",
      "rating": 9,
      "episodes_watched": 12,
      "episodes_total": 12,
      "last_watched_at": "2026-09-01T14:03:00.000Z",
      "ids": {
        "tmdb": 123456,
        "imdb": "tt1234567",
        "douban": 1234567,
        "simkl": null
      }
    }
  ]
}
```

| Field              | Type                                         | Notes                                                               |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------- |
| `title`            | string                                       | Display title, often Chinese                                        |
| `original_title`   | string \| null                               | English / TMDB title when it differs from `title`                   |
| `year`             | number \| null                               | Release year                                                        |
| `type`             | `"movie"` \| `"tv"`                          |                                                                     |
| `status`           | `"completed"` \| `"watching"` \| `"dropped"` | `dropped` = gave up on it, a negative signal                        |
| `rating`           | number \| null                               | Personal rating 1–10. `null` = not rated (not the same as disliked) |
| `episodes_watched` | number \| null                               | TV only. Episodes are counted as one flat sequence across seasons   |
| `episodes_total`   | number \| null                               | TV only, when known                                                 |
| `last_watched_at`  | ISO 8601 string \| null                      |                                                                     |
| `ids`              | object                                       | `tmdb`, `imdb`, `douban`, `simkl`; any can be `null`                |

### Text response (`format=text`)

```
# Watch history of alice (3 titles)
Rating scale 1-10; "-" = not rated.

## Completed (1)
- 示例剧集 / Example Show (2023) | TV | rating 9 | episodes 12/12

## Watching (1)
- 某部剧 (2024) | TV | rating - | episodes 3/24

## Dropped (1)
- 某部电影 (2022) | Movie | rating -
```

### Errors

| Status | Body                                                          | Cause                                 |
| ------ | ------------------------------------------------------------- | ------------------------------------- |
| 401    | `{"error":"Missing API key"}`                                 | No header and no `key` parameter      |
| 401    | `{"error":"Invalid API key"}`                                 | Wrong, regenerated or banned-user key |
| 400    | `{"error":"Watched API is unavailable in localstorage mode"}` | Server uses `localstorage` storage    |

CORS is open (`Access-Control-Allow-Origin: *`) so browser-based tools can call it. Responses are `Cache-Control: no-store`.

## Examples

```bash
# Plain text, header auth
curl -H "Authorization: Bearer $LUNATV_KEY" "https://tv.example.com/api/v1/watched?format=text"

# Only my 8+ rated movies as JSON
curl "https://tv.example.com/api/v1/watched?type=movie&min_rating=8&sort=rating&key=$LUNATV_KEY"
```

## Prompt template for an AI agent

Replace `{origin}` and `{key}`. The in-app copy button fills these in for you.

```text
You have read access to my movie & TV watch history through an HTTP API.

Endpoint: GET {origin}/api/v1/watched
Auth: header "Authorization: Bearer {key}" (or append ?key={key} if you cannot set headers)

Useful query parameters (all optional):
- format=text    compact plain-text list (best for reading); default is JSON
- status=completed,watching,dropped   filter by status (comma separated)
- type=movie|tv  filter by media type
- min_rating=8   only titles I rated at least this (scale 1-10)
- sort=recent|rating|title   default recent

Each item: title (display title, often Chinese), original_title (English/TMDB title or null), year, type, status ("completed"|"watching"|"dropped"), rating (1-10 or null), episodes_watched, episodes_total, last_watched_at, ids { tmdb, imdb, douban, simkl }.

How to interpret it:
- "completed" = finished; "watching" = in progress; "dropped" = I gave up on it (a negative signal).
- rating is my personal score; null means I did not rate it, not that I disliked it.
- Use ids.tmdb / ids.imdb to look titles up precisely.

Task: fetch my history first (start with ?format=text), then recommend titles I have not watched yet that match my taste. For each recommendation, say which of my watched titles it relates to and why.
```

## Related: Simkl two-way sync

**我的观看 → 同步 Simkl** (visible once Simkl is connected in settings) merges both sides:

- Only in LunaTV → pushed to Simkl (history, ratings, dropped / completed status).
- Only on Simkl → pulled into LunaTV (with poster). `plantowatch` items are ignored.
- On both → episodes are unioned; LunaTV's rating and status win. Simkl fills in a rating LunaTV lacks, and Simkl finishing a show can move LunaTV from 在看 to 已看完.
- Deletions are not synced by the button. Removing a title in LunaTV already removes it from Simkl at that moment.
- Titles without a TMDB id (Douban-only entries, most short dramas) are skipped.
- TV episodes use LunaTV's flat episode numbers as season 1, the same as live sync. Multi-season shows may show odd episode numbers on Simkl.
