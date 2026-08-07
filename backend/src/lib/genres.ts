/**
 * Canonical TMDB genre list + a best-effort normalizer used to fold Xtream's
 * arbitrary, provider-defined category names ("FR| ACTION 4K", "US - Comedy
 * HD", ...) onto the same genre a Jellyfin item resolves to directly via its
 * TMDB id. Movie + TV genre names overlap almost entirely in TMDB's own
 * taxonomy — kept as a single merged list here since this app only ever
 * needs "one category per item", not a movie/tv-specific genre space.
 *
 * This matching is intentionally best-effort: a category that doesn't match
 * any canonical genre simply stays its own distinct category (safe
 * fallback, see sources/index.ts's merged-mode category handling) — never
 * silently dropped.
 */

export interface CanonicalGenre {
  slug: string;
  name: string;
}

// French display names (the app's TMDB calls already request `language:
// 'fr-FR'`), covering both TMDB's movie and TV genre lists.
export const CANONICAL_GENRES: CanonicalGenre[] = [
  { slug: 'action', name: 'Action' },
  { slug: 'aventure', name: 'Aventure' },
  { slug: 'animation', name: 'Animation' },
  { slug: 'comedie', name: 'Comédie' },
  { slug: 'crime', name: 'Crime' },
  { slug: 'documentaire', name: 'Documentaire' },
  { slug: 'drame', name: 'Drame' },
  { slug: 'familial', name: 'Familial' },
  { slug: 'fantastique', name: 'Fantastique' },
  { slug: 'histoire', name: 'Histoire' },
  { slug: 'horreur', name: 'Horreur' },
  { slug: 'musique', name: 'Musique' },
  { slug: 'mystere', name: 'Mystère' },
  { slug: 'romance', name: 'Romance' },
  { slug: 'science-fiction', name: 'Science-Fiction' },
  { slug: 'telefilm', name: 'Téléfilm' },
  { slug: 'thriller', name: 'Thriller' },
  { slug: 'guerre', name: 'Guerre' },
  { slug: 'western', name: 'Western' },
  { slug: 'kids', name: 'Enfants' },
  { slug: 'reality', name: 'Télé-réalité' },
  { slug: 'soap', name: 'Feuilleton' },
  { slug: 'talk', name: 'Talk-show' },
  { slug: 'news', name: 'Actualités' },
];

const CANONICAL_BY_SLUG = new Map(CANONICAL_GENRES.map((g) => [g.slug, g]));

// Normalized (accent-stripped, lowercased) synonym → canonical slug. Covers
// the English names TMDB itself sometimes returns plus the noisy variants
// commonly found in Xtream provider category names.
const SYNONYMS: Record<string, string> = {
  action: 'action',
  adventure: 'aventure',
  aventures: 'aventure',
  animation: 'animation',
  anime: 'animation',
  'dessins animes': 'animation',
  comedy: 'comedie',
  comedies: 'comedie',
  humour: 'comedie',
  crime: 'crime',
  policier: 'crime',
  documentary: 'documentaire',
  documentaires: 'documentaire',
  drama: 'drame',
  drames: 'drame',
  family: 'familial',
  famille: 'familial',
  fantasy: 'fantastique',
  history: 'histoire',
  historique: 'histoire',
  horror: 'horreur',
  epouvante: 'horreur',
  music: 'musique',
  musical: 'musique',
  mystery: 'mystere',
  romance: 'romance',
  romantique: 'romance',
  amour: 'romance',
  'science fiction': 'science-fiction',
  scifi: 'science-fiction',
  'sci-fi': 'science-fiction',
  anticipation: 'science-fiction',
  'tv movie': 'telefilm',
  thriller: 'thriller',
  suspense: 'thriller',
  war: 'guerre',
  'war  politics': 'guerre',
  western: 'western',
  kids: 'kids',
  jeunesse: 'kids',
  enfants: 'kids',
  reality: 'reality',
  'reality tv': 'reality',
  'tele realite': 'reality',
  soap: 'soap',
  feuilleton: 'soap',
  talk: 'talk',
  'talk show': 'talk',
  news: 'news',
  actualites: 'news',
  'action  adventure': 'action',
  'sci-fi  fantasy': 'science-fiction',
};

// Noise tokens frequently found in Xtream category names — quality tags,
// language markers, decorative separators — stripped before matching so
// "FR| ACTION 4K" and "Action" both normalize to the same string.
const NOISE_TOKENS = /\b(4k|8k|fhd|uhd|hd|sd|vf|vo|vostfr|multi|version francaise)\b/gi;
const SEPARATORS = /[|/\\_\-–—:.,]+/g;

// Strips combining diacritical marks (U+0300-U+036F) left behind by a
// canonical (NFD) Unicode decomposition — turns "é" into "e" for matching
// purposes without needing a locale-aware library.
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeGenreName(raw: string): string {
  return stripDiacritics(raw.toLowerCase())
    .replace(NOISE_TOKENS, ' ')
    .replace(SEPARATORS, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort match of an arbitrary genre/category name onto a canonical
 * TMDB genre slug. Returns null when nothing matches — callers must treat
 * that as "keep this as its own distinct category", never as an error.
 */
export function canonicalGenreSlug(raw: string): string | null {
  const normalized = normalizeGenreName(raw);
  if (!normalized) return null;

  if (CANONICAL_BY_SLUG.has(normalized)) return normalized;
  if (SYNONYMS[normalized]) return SYNONYMS[normalized];

  // Last resort: a canonical genre name appears as a whole word inside the
  // (noise-stripped) input — catches things like "action francais 2024".
  for (const genre of CANONICAL_GENRES) {
    if (new RegExp(`\\b${genre.slug.replace('-', '.?')}\\b`).test(normalized)) {
      return genre.slug;
    }
  }
  return null;
}

export function genreNameForSlug(slug: string): string | null {
  return CANONICAL_BY_SLUG.get(slug)?.name ?? null;
}
