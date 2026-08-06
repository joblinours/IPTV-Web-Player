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
