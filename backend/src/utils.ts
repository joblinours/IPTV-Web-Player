import type { ContentItem } from './types.js';

export function sanitizeLogText(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 180);
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): number {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: number };
    return Number(value.offset ?? 0);
  } catch {
    return 0;
  }
}

export function computePagination(total: number, offset: number, limit: number) {
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;
  return {
    total,
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
    nextCursor: hasMore ? encodeCursor(nextOffset) : null,
  };
}

/**
 * Source-agnostic filter + paginate, shared by every content provider
 * (Xtream, Jellyfin, ...) so `routes/catalog.ts` doesn't need to know how
 * each provider represents categories/titles internally.
 */
export function filterAndPaginate(
  items: ContentItem[],
  opts: { categoryId: string; search: string; favoriteIds: Set<string> | null; offset: number; limit: number }
): { items: ContentItem[]; pagination: ReturnType<typeof computePagination> } {
  const search = opts.search.trim().toLowerCase();

  const filtered = items.filter((item) => {
    const categoryMatch =
      opts.categoryId === 'favorites'
        ? opts.favoriteIds?.has(item.itemId) ?? false
        : opts.categoryId === 'all' || item.categoryId === opts.categoryId;
    if (!categoryMatch) return false;

    if (!search) return true;
    return item.title.toLowerCase().includes(search);
  });

  const paged = filtered.slice(opts.offset, opts.offset + opts.limit);
  const pagination = computePagination(filtered.length, opts.offset, opts.limit);

  return { items: paged, pagination };
}
