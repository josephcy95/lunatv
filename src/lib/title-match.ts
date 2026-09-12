/**
 * Conservative bilingual title identity for search clustering + play-page
 * alternate-source matching.
 *
 * False-split is OK; false-merge that hides a distinct show is not.
 * Distinct provider+id rows are never dropped by these helpers — callers
 * must keep every source/id when merging groups.
 */

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
const LATIN_WORD_RE = /[a-z0-9]+/g;
const YEAR_IN_TITLE_RE = /\b(?:19|20)\d{2}\b/g;

const LATIN_STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
]);

export interface TitleParts {
  /** Normalized full title (spaces collapsed, lowercased, NFKC). */
  normalized: string;
  /** Concatenated CJK / kana / hangul runs (no spaces). */
  cjk: string;
  /** Significant latin words joined by space (stopwords kept only if alone). */
  latin: string;
  /** All latin tokens including stopwords. */
  latinAll: string;
}

export function stripYearTokens(input: string): string {
  return input.replace(YEAR_IN_TITLE_RE, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeTitleKey(input: string | null | undefined): string {
  if (!input) return '';
  return stripYearTokens(
    input
      .normalize('NFKC')
      .toLowerCase()
      .replace(/["""''`´]/g, '')
      .replace(/[：:·・／/\\|_|—–\-]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function extractTitleParts(
  input: string | null | undefined,
): TitleParts {
  const normalized = normalizeTitleKey(input);
  if (!normalized) {
    return { normalized: '', cjk: '', latin: '', latinAll: '' };
  }

  const cjk = (normalized.match(new RegExp(CJK_RE.source, 'g')) || []).join('');
  const latinTokens = normalized.match(LATIN_WORD_RE) || [];
  const latinAll = latinTokens.join(' ');
  const significant = latinTokens.filter((t) => !LATIN_STOP.has(t));
  const latin = (significant.length ? significant : latinTokens).join(' ');

  return { normalized, cjk, latin, latinAll };
}

export function yearsCompatible(a?: string | null, b?: string | null): boolean {
  const na = String(a || '').match(/\d{4}/)?.[0] || '';
  const nb = String(b || '').match(/\d{4}/)?.[0] || '';
  if (!na || !nb) return true;
  return na === nb;
}

/**
 * Conservative same-show check across CN / EN / bilingual provider titles.
 * Does NOT treat "Sinners" as the same as "In the Land of Saints and Sinners"
 * or "PSYCHO-PASS ... Sinners of the System".
 */
export function titlesLikelySameShow(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const pa = extractTitleParts(a);
  const pb = extractTitleParts(b);
  if (!pa.normalized || !pb.normalized) return false;
  if (pa.normalized === pb.normalized) return true;

  // Both have CJK: require exact CJK equality; latin may be missing on one side.
  if (pa.cjk && pb.cjk) {
    if (pa.cjk !== pb.cjk) return false;
    if (!pa.latin || !pb.latin) return true;
    return pa.latin === pb.latin;
  }

  // Shared exact latin title string (full significant-token form).
  // "sinners" === "sinners" for "Sinners" vs "罪人 Sinners".
  if (pa.latin && pb.latin && pa.latin === pb.latin) {
    return true;
  }

  // One side CJK-only, other bilingual with that CJK — handled above when both
  // have cjk. CJK-only vs latin-only: do not guess without a shared token set.
  if (pa.cjk && !pb.cjk && pb.latin && pa.normalized === pb.normalized) {
    return true;
  }

  return false;
}

/** Prefer bilingual / longer display title when clustering. */
export function preferDisplayTitle(titles: string[]): string {
  const cleaned = titles.map((t) => t.trim()).filter(Boolean);
  if (!cleaned.length) return '';
  const scored = cleaned.map((title) => {
    const p = extractTitleParts(title);
    let score = title.length;
    if (p.cjk && p.latin) score += 1000;
    else if (p.cjk) score += 100;
    return { title, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].title;
}

/**
 * Split a bilingual title into extra search variants (CN-only / EN-only).
 * Keeps the original first.
 */
export function bilingualSearchVariants(title: string): string[] {
  const trimmed = title.trim();
  if (!trimmed) return [];
  const variants: string[] = [trimmed];
  const parts = extractTitleParts(trimmed);
  if (parts.cjk) {
    // Reconstruct original CJK span casing-insensitively from raw title
    const cjkRaw = (trimmed.match(new RegExp(CJK_RE.source, 'g')) || []).join(
      '',
    );
    if (cjkRaw && !variants.includes(cjkRaw)) variants.push(cjkRaw);
  }
  if (parts.latin) {
    // Use original latin words from the title for nicer queries
    const latinRaw = (trimmed.match(/[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*/g) || [])
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0];
    if (latinRaw && !variants.includes(latinRaw)) variants.push(latinRaw);
  }
  return variants;
}

export interface ClusterableItem {
  title: string;
  year?: string;
  source: string;
  id: string;
}

/**
 * Cluster items that likely refer to the same show.
 * Every distinct source+id is preserved inside its cluster (never dropped).
 * Order of first-seen cluster keys is stable.
 */
export function clusterBySameShow<T extends ClusterableItem>(
  items: T[],
  typeKey: (item: T) => string,
): Array<[string, T[]]> {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let cur = i;
    while (parent[cur] !== cur) {
      const next = parent[cur];
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (typeKey(items[i]) !== typeKey(items[j])) continue;
      if (!yearsCompatible(items[i].year, items[j].year)) continue;
      if (titlesLikelySameShow(items[i].title, items[j].title)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, T[]>();
  const order: number[] = [];
  items.forEach((item, i) => {
    const root = find(i);
    if (!groups.has(root)) {
      groups.set(root, []);
      order.push(root);
    }
    groups.get(root)!.push(item);
  });

  return order.map((root) => {
    const group = groups.get(root)!;
    // Deduplicate by source+id while preserving order (should already be unique)
    const seen = new Set<string>();
    const unique: T[] = [];
    for (const item of group) {
      const key = `${item.source}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    const display = preferDisplayTitle(unique.map((g) => g.title));
    const year =
      unique.find((g) => g.year && g.year !== 'unknown')?.year ||
      unique[0]?.year ||
      'unknown';
    const mapKey = `${normalizeTitleKey(display)}-${year}-${typeKey(unique[0])}`;
    return [mapKey, unique] as [string, T[]];
  });
}
