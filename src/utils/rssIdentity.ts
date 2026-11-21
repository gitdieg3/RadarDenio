import type { RssItemIdentityType } from '../types/radar';

const RSS_TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_reader',
  'fbclid',
  'gclid',
  'yclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
  '_ga',
  '_gl',
  'spm',
  'si',
]);

// Standard SHA-256 constants (FIPS 180-4) for zero-dependency Node & Browser determinism
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  view.setUint32(paddedLength - 8, highBits, false);
  view.setUint32(paddedLength - 4, lowBits, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return Array.from(h)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

const NON_URL_PLACEHOLDERS = new Set(['n/a', 'na', 'none', 'null', 'undefined', 'tbd', '-', '--']);

function isLikelyUrlInput(trimmed: string, hasBase: boolean): boolean {
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (NON_URL_PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    // Explicit non-HTTP scheme such as javascript:, mailto:, urn:, data:
    return false;
  }
  if (!hasBase) return false;
  // Relative URL must resemble a path, query, or file reference (avoid turning bare words like "none" into URLs)
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('?') ||
    trimmed.includes('/') ||
    /\.[a-z0-9]{1,8}(?:$|[?#])/i.test(trimmed)
  );
}

function normalizeHttpUrlInternal(
  rawUrl: string | null | undefined,
  options: { baseUrl?: string | null; stripWww: boolean }
): string | null {
  const trimmed = (rawUrl ?? '').trim();
  const baseTrimmed = (options.baseUrl ?? '').trim();
  if (!isLikelyUrlInput(trimmed, Boolean(baseTrimmed))) {
    return null;
  }

  try {
    const parsed = baseTrimmed ? new URL(trimmed, baseTrimmed) : new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return null;
    }

    parsed.protocol = protocol;
    parsed.hostname = parsed.hostname.toLowerCase();
    if (options.stripWww && parsed.hostname.startsWith('www.')) {
      parsed.hostname = parsed.hostname.slice(4);
    }

    if ((protocol === 'http:' && parsed.port === '80') || (protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }

    parsed.hash = '';

    const keys = Array.from(parsed.searchParams.keys());
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || RSS_TRACKING_QUERY_PARAMS.has(lower)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Normalizes `feed_url` and `parent_site_url` while keeping subdomain (`www.`) intact
 * so strict DNS/TLS hosts continue resolving reliably during HTTP feed fetches.
 */
export function normalizeRssFeedUrl(
  rawUrl: string | null | undefined,
  baseSiteUrl?: string | null
): string | null {
  return normalizeHttpUrlInternal(rawUrl, { baseUrl: baseSiteUrl, stripWww: false });
}

/**
 * Normalizes an RSS/Atom item link against its feed/parent URL and strips `www.`
 * so canonical item URLs match Tavily's `normalizeDiscoveryUrl()` for cross-pipeline dedup.
 * Content-identifying query parameters (e.g. `?id=42`, `?p=123`) are preserved and sorted.
 */
export function normalizeRssItemUrl(
  rawUrl: string | null | undefined,
  baseFeedUrl?: string | null
): string | null {
  return normalizeHttpUrlInternal(rawUrl, { baseUrl: baseFeedUrl, stripWww: true });
}

function normalizeTextForHash(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

export interface RssItemIdentityInput {
  feedUrl?: string | null;
  parentSiteUrl?: string | null;
  link?: string | null;
  guid?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  summary?: string | null;
  content?: string | null;
  categories?: string[] | null;
}

export interface RssItemIdentityResolution {
  identityType: RssItemIdentityType;
  itemKey: string;
  normalizedUrl: string | null;
  itemGuid: string | null;
  fallbackFingerprint: string | null;
  contentHash: string;
}

export function computeRssItemContentHash(input: RssItemIdentityInput): string {
  const baseUrl = input.feedUrl ?? input.parentSiteUrl ?? null;
  const normalizedUrl = normalizeRssItemUrl(input.link, baseUrl) ?? '';
  const guid = normalizeTextForHash(input.guid);
  const title = normalizeTextForHash(input.title);
  const publishedAt = normalizeTextForHash(input.publishedAt);
  const summary = normalizeTextForHash(input.summary);
  const content = normalizeTextForHash(input.content);
  const categories = Array.from(
    new Set((input.categories ?? []).map((c) => normalizeTextForHash(c).toLowerCase()).filter(Boolean))
  ).sort();

  const payload = JSON.stringify({
    title,
    normalizedUrl,
    guid,
    publishedAt,
    summary,
    content,
    categories,
  });

  return sha256Hex(payload);
}

/**
 * Resolves the canonical 3-tier RSS/Atom item fingerprint identity:
 *   Tier 1 ('url'):           Valid HTTP(S) link normalized against feed/parent URL -> `url:<normalized_url>`
 *   Tier 2 ('guid'):          No usable link, non-empty GUID/Atom ID              -> `guid:<item_guid>`
 *   Tier 3 ('fallback_hash'): Neither link nor GUID available                      -> `fallback:<sha256>`
 */
export function resolveRssItemIdentity(input: RssItemIdentityInput): RssItemIdentityResolution {
  const baseUrl = input.feedUrl ?? input.parentSiteUrl ?? null;
  const normalizedUrl = normalizeRssItemUrl(input.link, baseUrl);
  const trimmedGuid = normalizeTextForHash(input.guid);
  const itemGuid = trimmedGuid.length > 0 ? trimmedGuid : null;
  const contentHash = computeRssItemContentHash(input);

  if (normalizedUrl) {
    return {
      identityType: 'url',
      itemKey: `url:${normalizedUrl}`,
      normalizedUrl,
      itemGuid,
      fallbackFingerprint: null,
      contentHash,
    };
  }

  if (itemGuid) {
    return {
      identityType: 'guid',
      itemKey: `guid:${itemGuid}`,
      normalizedUrl: null,
      itemGuid,
      fallbackFingerprint: null,
      contentHash,
    };
  }

  const titleAnchor = normalizeTextForHash(input.title).toLowerCase();
  const dateAnchor = normalizeTextForHash(input.publishedAt).toLowerCase();
  const bodyAnchor = normalizeTextForHash(input.summary || input.content).toLowerCase();

  // Anchor fallback identity on stable header metadata (title + publishedAt) when available
  // so edits to description/body still keep the same item_key while triggering a contentHash delta.
  const fallbackBasis = titleAnchor
    ? `title:${titleAnchor}|date:${dateAnchor}`
    : `body:${bodyAnchor}|date:${dateAnchor}`;

  const fallbackFingerprint = sha256Hex(fallbackBasis);

  return {
    identityType: 'fallback_hash',
    itemKey: `fallback:${fallbackFingerprint}`,
    normalizedUrl: null,
    itemGuid: null,
    fallbackFingerprint,
    contentHash,
  };
}

export interface FingerprintDeltaEvaluation {
  action: 'new' | 'unchanged' | 'changed';
  shouldCreateCandidate: boolean;
  nextChangeCount: number;
}

/**
 * Evaluates incoming item identity against an existing `rss_item_fingerprints` record.
 * Edited items (`changed`) update the existing fingerprint and increment `changeCount`
 * WITHOUT creating a duplicate `discovery_candidates` row when `candidateId` is already linked.
 */
export function evaluateFingerprintDelta(
  existing: {
    itemKey: string;
    contentHash: string;
    candidateId: string | null;
    changeCount: number;
  } | null,
  incoming: RssItemIdentityResolution
): FingerprintDeltaEvaluation {
  if (!existing) {
    return {
      action: 'new',
      shouldCreateCandidate: true,
      nextChangeCount: 0,
    };
  }

  if (existing.contentHash === incoming.contentHash) {
    return {
      action: 'unchanged',
      shouldCreateCandidate: false,
      nextChangeCount: existing.changeCount,
    };
  }

  return {
    action: 'changed',
    shouldCreateCandidate: existing.candidateId === null,
    nextChangeCount: existing.changeCount + 1,
  };
}
