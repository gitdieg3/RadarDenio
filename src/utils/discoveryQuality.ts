import type {
  CandidateKind,
  CrawlabilityStatus,
  DiscoveryCandidate,
  DiscoveryClassificationCategory,
  DuplicateStatus,
  MonitoringEligibility,
  SourceType,
  TargetAudience,
  TemporalStatus,
} from '../types/radar';
import { normalizeDiscoveryUrl } from './radarLogic';

export interface JakartaDateContext {
  dateStr: string; // YYYY-MM-DD in Asia/Jakarta
  timeStr: string; // HH:mm:ss
  isoWib: string; // YYYY-MM-DDTHH:mm:ss+07:00
  year: number;
  nowMs: number;
}

export function getJakartaDateTimeContext(now: Date = new Date()): JakartaDateContext {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const yearStr = getPart('year');
  const monthStr = getPart('month');
  const dayStr = getPart('day');
  let hourStr = getPart('hour');
  if (hourStr === '24') hourStr = '00';
  const minuteStr = getPart('minute');
  const secondStr = getPart('second');

  const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
  const timeStr = `${hourStr}:${minuteStr}:${secondStr}`;
  return {
    dateStr,
    timeStr,
    isoWib: `${dateStr}T${timeStr}+07:00`,
    year: Number(yearStr),
    nowMs: now.getTime(),
  };
}

export function extractSourceDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.hostname.toLowerCase().replace(/^(www\.|m\.)/i, '');
  } catch {
    return '';
  }
}

export function extractRootOriginUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./i, '');
    return `${parsed.protocol}//${host}`;
  } catch {
    return null;
  }
}

const KNOWN_AGGREGATOR_DOMAINS = new Set([
  'infolomba.id',
  'infolombait.com',
  'kabarlomba.com',
  'dev.events',
  'allhackathons.com',
  'anakbisnis.com',
  'lomba.or.id',
  'informasilomba.com',
  'eventmahasiswa.com',
  'jadwalevent.web.id',
  'unstop.com',
  'devpost.com',
  'mlh.io',
]);

const KNOWN_ORGANIZER_DOMAINS = new Set([
  'kaggle.com',
  'puspresnas.kemdikbud.go.id',
  'kemdikbud.go.id',
  'kemdiktisaintek.go.id',
  'belmawa.kemdikbud.go.id',
]);

export function isAggregatorDomain(domain: string): boolean {
  const clean = domain.toLowerCase().replace(/^(www\.|m\.)/, '');
  if (KNOWN_AGGREGATOR_DOMAINS.has(clean)) return true;
  for (const agg of KNOWN_AGGREGATOR_DOMAINS) {
    if (clean.endsWith(`.${agg}`)) return true;
  }
  return false;
}

export function isUniversityDomain(domain: string): boolean {
  const clean = domain.toLowerCase();
  return (
    clean.endsWith('.ac.id') ||
    clean.endsWith('.edu') ||
    clean.endsWith('.edu.au') ||
    clean.endsWith('.edu.sg') ||
    clean.endsWith('.edu.my') ||
    clean.endsWith('.ac.uk')
  );
}

const SOCIAL_SINGLE_POST_PATTERNS = [
  /instagram\.com\/(p|reel|tv)\//i,
  /linkedin\.com\/posts\//i,
  /linkedin\.com\/feed\/update\//i,
  /youtube\.com\/watch/i,
  /youtu\.be\//i,
  /tiktok\.com\/@[^/]+\/video\//i,
  /(twitter\.com|x\.com)\/[^/]+\/status\//i,
];

const SOCIAL_DOMAINS = new Set([
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'fb.com',
  'x.com',
  'twitter.com',
]);

export function isSocialSinglePostUrl(rawUrl: string): boolean {
  return SOCIAL_SINGLE_POST_PATTERNS.some((re) => re.test(rawUrl));
}

export function isSocialDomain(domain: string): boolean {
  const clean = domain.toLowerCase().replace(/^(www\.|m\.)/, '');
  if (SOCIAL_DOMAINS.has(clean)) return true;
  for (const s of SOCIAL_DOMAINS) {
    if (clean.endsWith(`.${s}`)) return true;
  }
  return false;
}

export function isPdfUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return /\.pdf$/i.test(parsed.pathname);
  } catch {
    return /\.pdf($|\?)/i.test(rawUrl);
  }
}

export function isRssUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    const p = parsed.pathname.toLowerCase();
    const s = parsed.search.toLowerCase();
    return (
      /\/(feed|rss|atom)(\/|$|\.)/i.test(p) ||
      /\.(rss|xml|atom)$/i.test(p) ||
      s.includes('feed=rss') ||
      s.includes('format=rss') ||
      parsed.hostname.toLowerCase().startsWith('feeds.')
    );
  } catch {
    return false;
  }
}

export function resolveDetectedTypeDeterministic(params: {
  url: string;
  modelDetectedType?: SourceType | string | null;
  classification?: DiscoveryClassificationCategory;
  contentTypeHeader?: string | null;
}): SourceType {
  const domain = extractSourceDomain(params.url);
  const ct = (params.contentTypeHeader ?? '').toLowerCase();

  // Highest precedence: deterministic URL & Content-Type checks
  if (isSocialDomain(domain) || isSocialSinglePostUrl(params.url)) {
    return 'social_reference';
  }
  if (isPdfUrl(params.url) || ct.includes('application/pdf')) {
    return 'static_document';
  }
  if (
    isRssUrl(params.url) ||
    ct.includes('application/rss+xml') ||
    ct.includes('application/atom+xml') ||
    ct.includes('text/xml')
  ) {
    return 'rss_feed';
  }
  if (
    isUniversityDomain(domain) ||
    domain.endsWith('.go.id') ||
    domain.endsWith('.gov') ||
    params.classification === 'University'
  ) {
    return 'public_portal';
  }

  const allowed: SourceType[] = [
    'website',
    'rss_feed',
    'public_portal',
    'social_reference',
    'newsletter_archive',
    'static_document',
  ];
  if (params.modelDetectedType && allowed.includes(params.modelDetectedType as SourceType)) {
    return params.modelDetectedType as SourceType;
  }
  return 'website';
}

export function resolveClassificationDeterministic(params: {
  url: string;
  title?: string;
  snippet?: string;
  modelClassification: DiscoveryClassificationCategory;
}): DiscoveryClassificationCategory {
  if (params.modelClassification === 'Irrelevant') {
    return 'Irrelevant';
  }

  const domain = extractSourceDomain(params.url);
  if (isAggregatorDomain(domain)) {
    return 'Aggregator';
  }

  if (KNOWN_ORGANIZER_DOMAINS.has(domain)) {
    return 'Organizer';
  }

  if (isUniversityDomain(domain)) {
    // If Gemini classified a university portal/news/page as Organizer or Community, normalize to University.
    // Keep Competition only if Gemini explicitly identified a dedicated single-competition event page.
    if (
      params.modelClassification === 'Organizer' ||
      params.modelClassification === 'Community' ||
      params.modelClassification === 'University'
    ) {
      return 'University';
    }
    try {
      const pathname = new URL(params.url).pathname.toLowerCase();
      if (pathname === '/' || pathname === '' || pathname.includes('/page/') || pathname.includes('/events')) {
        return 'University';
      }
    } catch {
      return 'University';
    }
  }

  return params.modelClassification;
}

function parseWibTimestamp(dateOrIso: string | null | undefined, endOfDay = false): number | null {
  if (!dateOrIso) return null;
  const trimmed = dateOrIso.trim();
  if (!trimmed) return null;

  // Date-only YYYY-MM-DD -> interpret in Asia/Jakarta (+07:00)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = endOfDay ? 'T23:59:59+07:00' : 'T00:00:00+07:00';
    const ms = Date.parse(`${trimmed}${suffix}`);
    return Number.isFinite(ms) ? ms : null;
  }

  // ISO without timezone -> assume Asia/Jakarta (+07:00)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const withSec = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    const ms = Date.parse(`${withSec}+07:00`);
    return Number.isFinite(ms) ? ms : null;
  }

  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

export interface TemporalEvaluationInput {
  modelStatus?: TemporalStatus | string | null;
  registrationOpenDate?: string | null;
  registrationDeadline?: string | null;
  competitionStartDate?: string | null;
  competitionEndDate?: string | null;
  eventYear?: number | null;
  temporalEvidence?: string | null;
  temporalConfidence?: number | null;
  textCorpus?: string;
  url?: string;
  isRecurringSourceHub?: boolean;
  jakartaNow?: JakartaDateContext;
}

export interface TemporalEvaluationResult {
  temporalStatus: TemporalStatus;
  registrationOpenDate: string | null;
  registrationDeadline: string | null;
  competitionStartDate: string | null;
  competitionEndDate: string | null;
  eventYear: number | null;
  temporalEvidence: string | null;
  temporalConfidence: number;
}

const COMPLETED_CUE_RE =
  /\b(winners?\s+announced|grand\s+success|celebrating\s+our\s+winners|pemenang\s+(telah\s+)?diumumkan|berhasil\s+diselenggarakan|telah\s+berakhir|acara\s+selesai|selesai\s+dilaksanakan|results?\s+(have\s+been\s+)?published|see\s+you\s+at\s+\w+\s+20\d{2})\b/i;

const CLOSED_CUE_RE =
  /\b(registration\s+(is\s+)?closed|applications?\s+(are\s+)?closed|submissions?\s+closed|challenge\s+closed|pendaftaran\s+(telah\s+)?ditutup|registrasi\s+ditutup|00\s*days\s*00\s*hours)\b/i;

const UPCOMING_CUE_RE =
  /\b(registration\s+opens?\s+(soon|on)|coming\s+soon|segera\s+dibuka|akan\s+dibuka|pendaftaran\s+dibuka\s+mulai)\b/i;

const ARCHIVED_CUE_RE =
  /\b(archive|arsip|past\s+edition|edisi\s+sebelumnya|previous\s+edition)\b/i;

export function evaluateTemporalStatus(input: TemporalEvaluationInput): TemporalEvaluationResult {
  const ctx = input.jakartaNow ?? getJakartaDateTimeContext();
  const corpus = `${input.textCorpus ?? ''} ${input.temporalEvidence ?? ''}`.trim();
  const deadlineRaw = input.registrationDeadline?.trim() || null;
  const openRaw = input.registrationOpenDate?.trim() || null;
  const startRaw = input.competitionStartDate?.trim() || null;
  const endRaw = input.competitionEndDate?.trim() || null;

  let eventYear =
    typeof input.eventYear === 'number' && Number.isFinite(input.eventYear)
      ? input.eventYear
      : null;

  if (!eventYear && deadlineRaw && /^(20\d{2})/.test(deadlineRaw)) {
    eventYear = Number(deadlineRaw.slice(0, 4));
  }
  if (!eventYear && input.url) {
    const urlYearMatch = input.url.match(/(?:tahun[-_]?|edition[-_]?|\/)(20[12]\d)(?:\b|\/|\.pdf|-)/i);
    if (urlYearMatch) {
      eventYear = Number(urlYearMatch[1]);
    }
  }

  let evidence = input.temporalEvidence?.trim() || null;
  let confidence =
    typeof input.temporalConfidence === 'number' && Number.isFinite(input.temporalConfidence)
      ? Math.min(100, Math.max(0, Math.round(input.temporalConfidence)))
      : 50;

  // 1. Explicit text cues indicating event already concluded or winners announced
  if (COMPLETED_CUE_RE.test(corpus)) {
    const m = corpus.match(COMPLETED_CUE_RE);
    return {
      temporalStatus: 'completed',
      registrationOpenDate: openRaw,
      registrationDeadline: deadlineRaw,
      competitionStartDate: startRaw,
      competitionEndDate: endRaw,
      eventYear,
      temporalEvidence: evidence ?? `Detected completion phrase: "${m?.[0] ?? 'completed'}"`,
      temporalConfidence: Math.max(confidence, 88),
    };
  }

  // 2. Explicit text cues indicating registration closed
  if (CLOSED_CUE_RE.test(corpus) && !input.isRecurringSourceHub) {
    const m = corpus.match(CLOSED_CUE_RE);
    return {
      temporalStatus: 'closed',
      registrationOpenDate: openRaw,
      registrationDeadline: deadlineRaw,
      competitionStartDate: startRaw,
      competitionEndDate: endRaw,
      eventYear,
      temporalEvidence: evidence ?? `Detected closed cue: "${m?.[0] ?? 'closed'}"`,
      temporalConfidence: Math.max(confidence, 85),
    };
  }

  // 3. Deterministic deadline comparison against Asia/Jakarta current time
  const deadlineMs = parseWibTimestamp(deadlineRaw, true);
  if (deadlineMs !== null) {
    if (ctx.nowMs > deadlineMs) {
      return {
        temporalStatus: 'closed',
        registrationOpenDate: openRaw,
        registrationDeadline: deadlineRaw,
        competitionStartDate: startRaw,
        competitionEndDate: endRaw,
        eventYear,
        temporalEvidence:
          evidence ?? `Registration deadline ${deadlineRaw} is before current WIB date ${ctx.dateStr}.`,
        temporalConfidence: Math.max(confidence, 92),
      };
    }

    const openMs = parseWibTimestamp(openRaw, false);
    if (openMs !== null && ctx.nowMs < openMs) {
      return {
        temporalStatus: 'upcoming',
        registrationOpenDate: openRaw,
        registrationDeadline: deadlineRaw,
        competitionStartDate: startRaw,
        competitionEndDate: endRaw,
        eventYear,
        temporalEvidence:
          evidence ?? `Registration opens ${openRaw} (after current WIB date ${ctx.dateStr}).`,
        temporalConfidence: Math.max(confidence, 90),
      };
    }

    return {
      temporalStatus: 'open',
      registrationOpenDate: openRaw,
      registrationDeadline: deadlineRaw,
      competitionStartDate: startRaw,
      competitionEndDate: endRaw,
      eventYear,
      temporalEvidence:
        evidence ?? `Registration deadline ${deadlineRaw} is active relative to ${ctx.dateStr} WIB.`,
      temporalConfidence: Math.max(confidence, 88),
    };
  }

  // 4. Open date in future without explicit deadline
  const openMs = parseWibTimestamp(openRaw, false);
  if (openMs !== null && ctx.nowMs < openMs) {
    return {
      temporalStatus: 'upcoming',
      registrationOpenDate: openRaw,
      registrationDeadline: deadlineRaw,
      competitionStartDate: startRaw,
      competitionEndDate: endRaw,
      eventYear,
      temporalEvidence: evidence ?? `Registration opens ${openRaw} (future relative to ${ctx.dateStr} WIB).`,
      temporalConfidence: Math.max(confidence, 85),
    };
  }

  if (UPCOMING_CUE_RE.test(corpus)) {
    const m = corpus.match(UPCOMING_CUE_RE);
    return {
      temporalStatus: 'upcoming',
      registrationOpenDate: openRaw,
      registrationDeadline: deadlineRaw,
      competitionStartDate: startRaw,
      competitionEndDate: endRaw,
      eventYear,
      temporalEvidence: evidence ?? `Detected upcoming cue: "${m?.[0] ?? 'upcoming'}"`,
      temporalConfidence: Math.max(confidence, 75),
    };
  }

  // 5. Competition end date already passed
  const endMs = parseWibTimestamp(endRaw, true);
  if (endMs !== null && ctx.nowMs > endMs && !input.isRecurringSourceHub) {
    return {
      temporalStatus: 'completed',
      registrationOpenDate: openRaw,
      registrationDeadline: deadlineRaw,
      competitionStartDate: startRaw,
      competitionEndDate: endRaw,
      eventYear,
      temporalEvidence:
        evidence ?? `Competition end date ${endRaw} has passed relative to ${ctx.dateStr} WIB.`,
      temporalConfidence: Math.max(confidence, 88),
    };
  }

  // 6. Prior-year single event / static guideline (do NOT mark recurring parent hubs archived)
  if (!input.isRecurringSourceHub && eventYear && eventYear < ctx.year) {
    const isExplicitArchive =
      ARCHIVED_CUE_RE.test(corpus) ||
      isPdfUrl(input.url ?? '') ||
      eventYear <= ctx.year - 1;
    if (isExplicitArchive) {
      return {
        temporalStatus: input.modelStatus === 'completed' ? 'completed' : 'archived',
        registrationOpenDate: openRaw,
        registrationDeadline: deadlineRaw,
        competitionStartDate: startRaw,
        competitionEndDate: endRaw,
        eventYear,
        temporalEvidence:
          evidence ?? `Event edition year ${eventYear} precedes current year ${ctx.year}.`,
        temporalConfidence: Math.max(confidence, 85),
      };
    }
  }

  // 7. Respect valid model status only if consistent; otherwise unknown when no dates exist
  const allowedStatuses: TemporalStatus[] = [
    'open',
    'upcoming',
    'closed',
    'completed',
    'archived',
    'unknown',
  ];
  const modelStatus = allowedStatuses.includes(input.modelStatus as TemporalStatus)
    ? (input.modelStatus as TemporalStatus)
    : 'unknown';

  const hasAnyDateOrCue = Boolean(
    deadlineRaw || openRaw || startRaw || endRaw || evidence || ARCHIVED_CUE_RE.test(corpus)
  );
  if (!hasAnyDateOrCue && !input.isRecurringSourceHub) {
    return {
      temporalStatus: 'unknown',
      registrationOpenDate: null,
      registrationDeadline: null,
      competitionStartDate: null,
      competitionEndDate: null,
      eventYear,
      temporalEvidence: null,
      temporalConfidence: Math.min(confidence, 40),
    };
  }

  return {
    temporalStatus: modelStatus,
    registrationOpenDate: openRaw,
    registrationDeadline: deadlineRaw,
    competitionStartDate: startRaw,
    competitionEndDate: endRaw,
    eventYear,
    temporalEvidence: evidence,
    temporalConfidence: confidence,
  };
}

export function inferKeywordTargetAudience(keywordPhrase: string): TargetAudience {
  const lower = keywordPhrase.toLowerCase();
  if (/\b(mahasiswa|university|college|campus|undergraduate|sarjana|diploma)\b/.test(lower)) {
    return 'university_student';
  }
  if (/\b(sma|smk|ma|high\s*school|pelajar\s*sma)\b/.test(lower)) {
    return 'senior_high_school';
  }
  if (/\b(smp|junior\s*high)\b/.test(lower)) {
    return 'junior_high_school';
  }
  if (/\b(sd|elementary|kids|children|anak)\b/.test(lower)) {
    return 'elementary_school';
  }
  if (/\b(professional|developer|engineer|startup)\b/.test(lower)) {
    return 'professional';
  }
  return 'unknown';
}

export function evaluateTargetAudienceCompatibility(params: {
  keywordPhrase: string;
  modelAudience?: TargetAudience | string | null;
  textCorpus?: string;
}): {
  targetAudience: TargetAudience;
  audienceCompatible: boolean;
  audienceNote: string | null;
} {
  const allowed: TargetAudience[] = [
    'elementary_school',
    'junior_high_school',
    'senior_high_school',
    'university_student',
    'general_public',
    'professional',
    'mixed',
    'unknown',
  ];

  let audience: TargetAudience = allowed.includes(params.modelAudience as TargetAudience)
    ? (params.modelAudience as TargetAudience)
    : 'unknown';

  const corpus = (params.textCorpus ?? '').toLowerCase();

  // Deterministic override when page text strongly specifies school/age brackets
  const hasSchoolAgeRange =
    /\b(usia|age[sd]?)\s*:?\s*(7|8|9|10|11|12)\s*[-–to]+\s*(12|13|14|15|16|17)\s*(tahun|years?)?/i.test(
      corpus
    ) || /\bhigh\s+school\s+(competition|students?|challenge)\b/i.test(corpus);
  const mentionsUniversity = /\b(mahasiswa|university\s+students?|undergraduate|perguruan\s+tinggi|diploma|s1|d3|d4)\b/i.test(
    corpus
  );

  if (hasSchoolAgeRange && !mentionsUniversity) {
    audience = /\b(high\s+school|sma|smk|13\s*[-–]\s*17)\b/i.test(corpus)
      ? 'senior_high_school'
      : 'elementary_school';
  } else if (audience === 'unknown' && mentionsUniversity) {
    const mentionsSchoolToo = /\b(sma|smk|high\s+school|umum|general\s+public)\b/i.test(corpus);
    audience = mentionsSchoolToo ? 'mixed' : 'university_student';
  }

  const expected = inferKeywordTargetAudience(params.keywordPhrase);

  if (expected === 'university_student') {
    if (
      audience === 'elementary_school' ||
      audience === 'junior_high_school' ||
      audience === 'senior_high_school'
    ) {
      return {
        targetAudience: audience,
        audienceCompatible: false,
        audienceNote: `Audience mismatch: targets ${audience.replace(/_/g, ' ')}, incompatible with university student keyword.`,
      };
    }
    if (audience === 'university_student' || audience === 'mixed' || audience === 'general_public') {
      return {
        targetAudience: audience,
        audienceCompatible: true,
        audienceNote:
          audience === 'mixed'
            ? 'Open to university students alongside other eligible groups.'
            : 'Compatible with university students.',
      };
    }
  }

  return {
    targetAudience: audience,
    audienceCompatible: true,
    audienceNote:
      audience === 'unknown'
        ? 'Target audience not explicitly specified in available content.'
        : `Targets ${audience.replace(/_/g, ' ')}.`,
  };
}

export interface EligibilityEvaluationResult {
  candidateKind: CandidateKind;
  isRecurringSource: boolean;
  isMonitorable: boolean;
  monitoringEligibility: MonitoringEligibility;
  monitoringBlockReason: string | null;
  recommendedMonitoringUrl: string | null;
}

const ACHIEVEMENT_OR_RESULT_RE =
  /\b(juara\s*(?:1|2|3|i|ii|iii|harapan|favorit|umum)|pemenang\s*(?:1|2|3|pertama|kedua|ketiga)|runner[- ]?up|best\s+(?:paper|team|speaker|prototype|design|presentation|delegate)|medali\s*(?:emas|perak|perunggu)|(?:gold|silver|bronze)\s+medal|(?:meraih|raih|memenangkan|menangkan|menyabet|sabet|memboyong|boyong|menjuarai|juarai|mengukir|menorehkan)\s+(?:juara|prestasi|penghargaan|medali|piala|gelar|posisi)|berhasil\s+meraih|kembali\s+menorehkan|mengharumkan\s+nama|lolos\s+(?:ke\s+)?(?:babak|final)|selamat\s+kepada\s+(?:tim|mahasiswa)|laporan\s+hasil\s+(?:kompetisi|lomba)|daftar\s+pemenang|rekap\s+prestasi)\b/i;

const CAMPUS_WINNER_HEADLINE_RE =
  /\b(?:mahasiswa|tim|delegasi)\s+[a-z0-9._\-\s]{1,40}\s+(?:raih|meraih|juara|menang|sabet|boyong|menjuarai|menangkan)\b/i;

const NEWS_ARTICLE_PATH_RE =
  /^\/(?:(?:id|en)\/)?(?:berita|news|artikel|article|blog|post|posts|siaran-pers|press-release|read|detail|story|stories|cerita|kabar|liputan)\/[^/]+/i;

const DATED_ARTICLE_PATH_RE = /^\/(?:(?:id|en)\/)?20\d{2}\/\d{2}(?:\/\d{2})?\/[^/]+/i;

const PORTAL_INDEX_PATH_RE =
  /^\/(?:(?:id|en)\/)?(?:lomba|kompetisi|competitions?|events?|hackathons?|daftar-lomba|info-lomba|kemahasiswaan|prestasi|direktori|directory|agenda|kalender|calendar|feeds?|rss)?\/?$/i;

const COMPETITION_DIRECTORY_PARENT_PATH_RE =
  /^\/((?:(?:id|en)\/)?(?:lomba|kompetisi|competitions?|events?|hackathons?|daftar-lomba|info-lomba))\/[^/]+/i;

const DEDICATED_COMPETITION_SUBDOMAIN_RE =
  /^(?:www\.)?(?:kompetisi|lomba|hackathon|hackathons|puspresnas)\./i;

export interface ArticleDetectionResult {
  isIndividualArticle: boolean;
  isAchievementArticle: boolean;
  reason: string | null;
}

export function detectIndividualNewsOrResultArticle(params: {
  url: string;
  title?: string;
  textCorpus?: string;
  classification?: DiscoveryClassificationCategory;
}): ArticleDetectionResult {
  const domain = extractSourceDomain(params.url);
  const titleText = (params.title ?? '').trim();
  const corpusText = (params.textCorpus ?? '').trim();

  let pathname = '/';
  try {
    pathname = new URL(params.url).pathname;
  } catch {
    pathname = '';
  }

  const cleanPath = pathname.replace(/\/+$/, '') || '/';
  const slugWords = cleanPath
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() ?? '';

  // 1. Aggregator single-event listing detection
  if (params.classification === 'Aggregator' || isAggregatorDomain(domain)) {
    const lowerPath = pathname.toLowerCase();
    const isAggListing =
      lowerPath.endsWith('.html') ||
      /\/info-[a-z0-9-]+-\d+$/i.test(lowerPath) ||
      /\/20\d{2}\/\d{2}\//.test(lowerPath) ||
      /\/(?:events?|lomba|kompetisi|hackathons?|challenges?)\/[^/]+/i.test(lowerPath);
    if (isAggListing) {
      return {
        isIndividualArticle: true,
        isAchievementArticle: false,
        reason: 'Single event listing hosted on an aggregator directory.',
      };
    }
  }

  // 2. Direct achievement/winner signals in title or URL slug (safe against portal titles like "Pusat Prestasi Nasional")
  const titleOrSlug = `${titleText} ${slugWords}`.trim();
  if (
    ACHIEVEMENT_OR_RESULT_RE.test(titleOrSlug) ||
    CAMPUS_WINNER_HEADLINE_RE.test(titleOrSlug)
  ) {
    return {
      isIndividualArticle: true,
      isAchievementArticle: true,
      reason: 'Individual competition achievement or winner news article.',
    };
  }

  // 3. Explicit news/blog/dated article path (e.g. /berita/..., /news/..., /2024/05/...)
  const hasNewsPath =
    NEWS_ARTICLE_PATH_RE.test(pathname) || DATED_ARTICLE_PATH_RE.test(pathname);
  if (hasNewsPath) {
    const hasAchievementInBody =
      ACHIEVEMENT_OR_RESULT_RE.test(corpusText) ||
      CAMPUS_WINNER_HEADLINE_RE.test(corpusText);
    return {
      isIndividualArticle: true,
      isAchievementArticle: hasAchievementInBody,
      reason: hasAchievementInBody
        ? 'Individual competition achievement or winner news article.'
        : 'Individual news or blog post URL is not a recurring competition directory.',
    };
  }

  // 4. Deep non-portal descriptive slug (e.g. WordPress /gagas-bisnis-umkm-... or .html article) backed by corpus achievement signals
  const slugWordCount = slugWords ? slugWords.split(/\s+/).filter(Boolean).length : 0;
  const isPortalIndexPath = PORTAL_INDEX_PATH_RE.test(cleanPath);
  const looksLikeDescriptivePostSlug =
    !isPortalIndexPath &&
    (cleanPath.endsWith('.html') || slugWordCount >= 5) &&
    !/^(?:lomba|kompetisi|competitions?|events?|hackathons?|portal|direktori)\b/i.test(slugWords);

  if (
    looksLikeDescriptivePostSlug &&
    (ACHIEVEMENT_OR_RESULT_RE.test(corpusText) || CAMPUS_WINNER_HEADLINE_RE.test(corpusText))
  ) {
    return {
      isIndividualArticle: true,
      isAchievementArticle: true,
      reason: 'Individual competition achievement or winner news article.',
    };
  }

  return {
    isIndividualArticle: false,
    isAchievementArticle: false,
    reason: null,
  };
}

export function resolveValidParentMonitoringUrl(params: {
  url: string;
  classification: DiscoveryClassificationCategory;
  isIndividualArticle: boolean;
}): string | null {
  const domain = extractSourceDomain(params.url);
  const rootOrigin = extractRootOriginUrl(params.url);
  if (!rootOrigin) return null;

  let parsed: URL;
  try {
    parsed = new URL(params.url.trim());
  } catch {
    return null;
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';

  // 1. Aggregator single listing -> aggregator root is a valid competition directory
  if ((params.classification === 'Aggregator' || isAggregatorDomain(domain)) && params.isIndividualArticle) {
    return rootOrigin;
  }

  // 2. Explicit competition directory parent segment (e.g. /kompetisi/lidm-2026 -> /kompetisi, /lomba/gemastik -> /lomba)
  const dirMatch = parsed.pathname.match(COMPETITION_DIRECTORY_PARENT_PATH_RE);
  if (dirMatch?.[1]) {
    return `${rootOrigin}/${dirMatch[1]}`;
  }

  // 3. Dedicated competition subdomain root when URL points to a sub-page (e.g. kompetisi.itb.ac.id/2026/hack -> https://kompetisi.itb.ac.id)
  if (DEDICATED_COMPETITION_SUBDOMAIN_RE.test(parsed.hostname) && cleanPath !== '/') {
    return rootOrigin;
  }

  // Never fall back blindly to general university/department homepages (e.g. unpar.ac.id, deb.sv.ugm.ac.id)
  return null;
}

export function evaluateCandidateKindAndEligibility(params: {
  url: string;
  classification: DiscoveryClassificationCategory;
  detectedType: SourceType;
  temporalStatus: TemporalStatus;
  crawlabilityStatus: CrawlabilityStatus;
  title?: string;
  textCorpus?: string;
}): EligibilityEvaluationResult {
  const domain = extractSourceDomain(params.url);

  const isSourceClassification =
    params.classification === 'Organizer' ||
    params.classification === 'University' ||
    params.classification === 'Aggregator' ||
    params.classification === 'Community' ||
    params.detectedType === 'rss_feed';

  const articleCheck = detectIndividualNewsOrResultArticle({
    url: params.url,
    title: params.title,
    textCorpus: params.textCorpus,
    classification: params.classification,
  });

  const isExpiredTemporal =
    params.temporalStatus === 'closed' ||
    params.temporalStatus === 'completed' ||
    params.temporalStatus === 'archived';

  const candidateKind: CandidateKind =
    isSourceClassification && !articleCheck.isIndividualArticle ? 'source' : 'event';

  const isRecurringSource =
    candidateKind === 'source' &&
    !isExpiredTemporal &&
    (isSourceClassification || isAggregatorDomain(domain)) &&
    params.detectedType !== 'social_reference' &&
    params.detectedType !== 'static_document';

  const recommendedMonitoringUrl =
    candidateKind === 'event'
      ? resolveValidParentMonitoringUrl({
          url: params.url,
          classification: params.classification,
          isIndividualArticle: articleCheck.isIndividualArticle,
        })
      : null;

  // Hard disqualifiers for Source Registry polling
  if (params.classification === 'Irrelevant') {
    return {
      candidateKind: 'event',
      isRecurringSource: false,
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      monitoringBlockReason: 'Classified as Irrelevant content.',
      recommendedMonitoringUrl: null,
    };
  }

  if (params.detectedType === 'social_reference' || params.crawlabilityStatus === 'social_single_post') {
    return {
      candidateKind,
      isRecurringSource: false,
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      monitoringBlockReason:
        'Social media references and single posts cannot be monitored via standard HTML polling.',
      recommendedMonitoringUrl: null,
    };
  }

  if (params.detectedType === 'static_document' || params.crawlabilityStatus === 'static_pdf') {
    return {
      candidateKind: 'event',
      isRecurringSource: false,
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      monitoringBlockReason: 'Static PDF documents cannot be polled for future competition updates.',
      recommendedMonitoringUrl: null,
    };
  }

  if (articleCheck.isIndividualArticle) {
    return {
      candidateKind: 'event',
      isRecurringSource: false,
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      monitoringBlockReason: isExpiredTemporal
        ? `${articleCheck.reason ?? 'Individual article'} Status is ${params.temporalStatus} and unsuitable for recurring source monitoring.`
        : recommendedMonitoringUrl
        ? `Individual listing/article; register parent competition directory (${recommendedMonitoringUrl}) instead.`
        : articleCheck.reason ??
          'Individual news or result article cannot be promoted as a recurring competition source.',
      recommendedMonitoringUrl,
    };
  }

  if (
    params.crawlabilityStatus === 'login_wall' ||
    params.crawlabilityStatus === 'captcha_blocked' ||
    params.crawlabilityStatus === 'empty_html_shell' ||
    params.crawlabilityStatus === 'not_found_404'
  ) {
    return {
      candidateKind,
      isRecurringSource,
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      monitoringBlockReason: `Blocked during crawlability probe (${params.crawlabilityStatus.replace(/_/g, ' ')}).`,
      recommendedMonitoringUrl,
    };
  }

  if (
    params.crawlabilityStatus === 'forbidden_403' ||
    params.crawlabilityStatus === 'cloudflare_challenge' ||
    params.crawlabilityStatus === 'rate_limited_429' ||
    params.crawlabilityStatus === 'http_error' ||
    params.crawlabilityStatus === 'timeout'
  ) {
    return {
      candidateKind,
      isRecurringSource,
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      monitoringBlockReason: `Site returned ${params.crawlabilityStatus.replace(/_/g, ' ')} — unsuitable for plain HTTP polling.`,
      recommendedMonitoringUrl,
    };
  }

  // Expired temporal status blocks monitoring across ALL candidate kinds (not only candidateKind === 'event')
  if (isExpiredTemporal) {
    return {
      candidateKind,
      isRecurringSource: false,
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      monitoringBlockReason:
        candidateKind === 'event'
          ? `Single-event page is already ${params.temporalStatus} and not a recurring source.`
          : `Candidate is marked ${params.temporalStatus} and cannot be monitored as an active recurring source.`,
      recommendedMonitoringUrl,
    };
  }

  // Event-specific single pages are NOT recurring monitoring sources
  if (candidateKind === 'event') {
    return {
      candidateKind: 'event',
      isRecurringSource: false,
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      monitoringBlockReason: recommendedMonitoringUrl
        ? `Single-event listing; register parent competition directory (${recommendedMonitoringUrl}) instead of one-off event URL.`
        : 'Single-event page is not a recurring feed or competition directory.',
      recommendedMonitoringUrl,
    };
  }

  // Source candidate (Aggregator / Organizer / University / Community / RSS)
  if (params.crawlabilityStatus === 'accessible' || params.crawlabilityStatus === 'redirect') {
    return {
      candidateKind: 'source',
      isRecurringSource: true,
      isMonitorable: true,
      monitoringEligibility: 'eligible',
      monitoringBlockReason: null,
      recommendedMonitoringUrl,
    };
  }

  return {
    candidateKind: 'source',
    isRecurringSource: true,
    isMonitorable: false,
    monitoringEligibility: 'unknown',
    monitoringBlockReason: 'Crawlability could not be verified.',
    recommendedMonitoringUrl,
  };
}

// --- 3-Level Semantic & Domain Deduplication ---

const TITLE_STOPWORDS = new Set([
  'lomba',
  'kompetisi',
  'competition',
  'contest',
  'challenge',
  'hackathon',
  'olympiad',
  'olimpiade',
  'mahasiswa',
  'nasional',
  'national',
  'international',
  'internasional',
  'indonesia',
  'tahun',
  'info',
  'cari',
  'panduan',
  'pedoman',
  'sosialisasi',
  'official',
  'portal',
  'registration',
  'pendaftaran',
  'deadline',
  'untuk',
  'the',
  'and',
  'for',
  'of',
  'in',
  'at',
  'ke',
  'kick',
]);

export function normalizeEventTokens(title: string): {
  tokens: string[];
  acronym: string | null;
  year: number | null;
} {
  const yearMatch = title.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  // Extract explicit acronym in parentheses or well-known uppercase token like LIDM, GEMASTIK, FINDIT
  const parenMatch = title.match(/\(([A-Za-z0-9-]{3,16})\)/);
  let acronym: string | null = parenMatch ? parenMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '') : null;
  if (!acronym) {
    const upperToken = title.match(/\b(LIDM|GEMASTIK|PKM|KBMI|PILMAPRES|PEKSIMINAS|MAGE|FINDIT|SECOMP|IECC|RAISE)\b/i);
    if (upperToken) acronym = upperToken[1].toLowerCase();
  }

  const cleaned = title
    .toLowerCase()
    .replace(/20\d{2}/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !TITLE_STOPWORDS.has(w) && !/^\d+$/.test(w));

  // Derive acronym from full Indonesian competition phrases like "Lomba Inovasi Digital Mahasiswa" -> "lidm"
  const rawWords = title
    .toLowerCase()
    .replace(/20\d{2}/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!acronym && rawWords.length >= 3) {
    const firstLetters = rawWords.slice(0, 4).map((w) => w[0]).join('');
    if (firstLetters === 'lidm') acronym = 'lidm';
  }

  return {
    tokens: Array.from(new Set(cleaned)),
    acronym,
    year,
  };
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersect = 0;
  for (const item of setA) {
    if (setB.has(item)) intersect += 1;
  }
  const union = setA.size + setB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export interface DeduplicationCandidateRecord {
  id: string;
  url: string;
  suggestedName: string;
  organizer: string;
  candidateKind?: CandidateKind;
  classification?: DiscoveryClassificationCategory;
  sourceDomain?: string | null;
  eventYear?: number | null;
  registrationDeadline?: string | null;
}

export interface ThreeLevelDedupResult {
  level: 'none' | 'exact_url' | 'source_domain' | 'semantic_event';
  duplicateStatus: DuplicateStatus;
  skipInsert: boolean;
  matchedRecordId: string | null;
  reason: string | null;
}

export function detectThreeLevelDuplicate(params: {
  url: string;
  suggestedName: string;
  organizer: string;
  candidateKind: CandidateKind;
  classification: DiscoveryClassificationCategory;
  eventYear?: number | null;
  registrationDeadline?: string | null;
  knownExactUrls: Set<string>;
  existingSources: { id: string; url: string; name: string }[];
  existingCandidates: DeduplicationCandidateRecord[];
}): ThreeLevelDedupResult {
  const normalizedUrl = normalizeDiscoveryUrl(params.url);
  if (normalizedUrl && params.knownExactUrls.has(normalizedUrl)) {
    return {
      level: 'exact_url',
      duplicateStatus: 'confirmed_duplicate',
      skipInsert: true,
      matchedRecordId: null,
      reason: 'Exact normalized URL already exists in Discovery Candidates or Source Registry.',
    };
  }

  const domain = extractSourceDomain(params.url);

  // Level B: Source/domain deduplication ONLY for Source Candidates (not distinct events hosted on an aggregator)
  if (params.candidateKind === 'source' && domain) {
    const existingSource = params.existingSources.find(
      (s) => extractSourceDomain(s.url) === domain
    );
    if (existingSource) {
      return {
        level: 'source_domain',
        duplicateStatus: 'confirmed_duplicate',
        skipInsert: false,
        matchedRecordId: existingSource.id,
        reason: `Domain "${domain}" is already registered in Source Registry under "${existingSource.name}".`,
      };
    }

    const existingAggregatorCandidate = params.existingCandidates.find(
      (c) =>
        (c.candidateKind === 'source' || c.classification === 'Aggregator') &&
        (c.sourceDomain || extractSourceDomain(c.url)) === domain
    );
    if (existingAggregatorCandidate) {
      return {
        level: 'source_domain',
        duplicateStatus: 'possible_duplicate',
        skipInsert: false,
        matchedRecordId: existingAggregatorCandidate.id,
        reason: `Same source domain "${domain}" already staged under "${existingAggregatorCandidate.suggestedName}".`,
      };
    }
  }

  // Level C: Conservative Semantic Event Deduplication
  // Never merge two clearly different events just because they live on the same aggregator domain.
  const incoming = normalizeEventTokens(params.suggestedName);
  const incomingYear = params.eventYear ?? incoming.year;
  const incomingOrg = params.organizer.trim().toLowerCase();

  for (const existing of params.existingCandidates) {
    // Only deduplicate event-vs-event (or shared competition references)
    if (existing.candidateKind === 'source' && params.candidateKind === 'source') {
      continue;
    }

    const existingTokens = normalizeEventTokens(existing.suggestedName);
    const existingYear = existing.eventYear ?? existingTokens.year;

    // Different explicit years (e.g. 2025 vs 2026) -> preserve or flag conservatively only if acronym+org clearly refer to same recurring competition?
    // Wait: LIDM 2025 PDF & LIDM 2021 UNESA & LIDM 2026 YT/IG all refer to LIDM across years/URLs!
    // If same acronym OR high token similarity:
    const tokenSim = jaccardSimilarity(incoming.tokens, existingTokens.tokens);
    const sameAcronym = Boolean(
      incoming.acronym && existingTokens.acronym && incoming.acronym === existingTokens.acronym
    );
    const sameYear =
      incomingYear !== null && existingYear !== null ? incomingYear === existingYear : true;
    const existingOrg = existing.organizer.trim().toLowerCase();
    const sameOrg =
      incomingOrg.length >= 3 &&
      existingOrg.length >= 3 &&
      !isAggregatorDomain(incomingOrg) &&
      !isAggregatorDomain(existingOrg) &&
      (incomingOrg.includes(existingOrg) || existingOrg.includes(incomingOrg));
    const sameDeadline = Boolean(
      params.registrationDeadline &&
        existing.registrationDeadline &&
        params.registrationDeadline === existing.registrationDeadline
    );

    // Distinct events on same aggregator with low token similarity must NEVER merge
    if (tokenSim < 0.35 && !sameAcronym) {
      continue;
    }

    // Confirmed or strong possible semantic match
    if (sameAcronym && (tokenSim >= 0.4 || sameOrg || sameDeadline)) {
      const yearNote =
        incomingYear && existingYear && incomingYear !== existingYear
          ? ` (editions ${existingYear} vs ${incomingYear})`
          : incomingYear
          ? ` (${incomingYear})`
          : '';
      return {
        level: 'semantic_event',
        duplicateStatus: sameYear && (sameOrg || sameDeadline || tokenSim >= 0.75)
          ? 'confirmed_duplicate'
          : 'possible_duplicate',
        skipInsert: false, // keep for admin review instead of silently deleting!
        matchedRecordId: existing.id,
        reason: `Possible same event as "${existing.suggestedName}"${yearNote} via shared identifier "${incoming.acronym?.toUpperCase()}".`,
      };
    }

    if (tokenSim >= 0.72 && (sameYear || sameOrg || sameDeadline)) {
      return {
        level: 'semantic_event',
        duplicateStatus: sameYear && (sameOrg || sameDeadline)
          ? 'confirmed_duplicate'
          : 'possible_duplicate',
        skipInsert: false,
        matchedRecordId: existing.id,
        reason: `High title similarity (${Math.round(tokenSim * 100)}%) with existing candidate "${existing.suggestedName}".`,
      };
    }

    if (tokenSim >= 0.5 && (sameOrg || sameDeadline) && sameYear) {
      return {
        level: 'semantic_event',
        duplicateStatus: 'possible_duplicate',
        skipInsert: false,
        matchedRecordId: existing.id,
        reason: `Similar competition title & matching organizer/deadline with "${existing.suggestedName}".`,
      };
    }
  }

  return {
    level: 'none',
    duplicateStatus: 'unique',
    skipInsert: false,
    matchedRecordId: null,
    reason: null,
  };
}

export interface CandidateFilterCriteria {
  query?: string;
  kind?: CandidateKind | 'all';
  temporalStatus?: TemporalStatus | 'all';
  eligibility?: 'all' | 'monitorable' | 'not_monitorable';
  duplicatesOnly?: boolean;
}

export function filterDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  criteria: CandidateFilterCriteria
): DiscoveryCandidate[] {
  const q = (criteria.query ?? '').trim().toLowerCase();
  return candidates.filter((cand) => {
    const kind = cand.candidateKind ?? 'unknown';
    const temporal = cand.temporalStatus ?? 'unknown';
    const eligible =
      cand.isMonitorable === true || cand.monitoringEligibility === 'eligible';
    const dup = cand.duplicateStatus ?? 'unknown';

    if (criteria.kind && criteria.kind !== 'all' && kind !== criteria.kind) {
      return false;
    }
    if (
      criteria.temporalStatus &&
      criteria.temporalStatus !== 'all' &&
      temporal !== criteria.temporalStatus
    ) {
      return false;
    }
    if (criteria.eligibility === 'monitorable' && !eligible) {
      return false;
    }
    if (criteria.eligibility === 'not_monitorable' && eligible) {
      return false;
    }
    if (
      criteria.duplicatesOnly &&
      dup !== 'possible_duplicate' &&
      dup !== 'confirmed_duplicate'
    ) {
      return false;
    }
    if (!q) return true;

    return (
      cand.suggestedName.toLowerCase().includes(q) ||
      cand.url.toLowerCase().includes(q) ||
      cand.organizer.toLowerCase().includes(q) ||
      (cand.sourceDomain ?? '').toLowerCase().includes(q) ||
      cand.matchedKeyword.toLowerCase().includes(q) ||
      cand.confidenceNote.toLowerCase().includes(q)
    );
  });
}
