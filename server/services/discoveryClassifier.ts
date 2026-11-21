import { ThinkingLevel, Type } from '@google/genai';
import type {
  DiscoveryClassificationCategory,
  SourceType,
  TargetAudience,
  TemporalStatus,
} from '../../src/types/radar.ts';
import { getJakartaDateTimeContext } from '../../src/utils/discoveryQuality.ts';
import { getServerGeminiClient, PHASE_2_DISCOVERY_MODEL } from './geminiClient.ts';
import type { TavilySearchHit } from './tavilyClient.ts';

export interface ClassificationInputItem {
  index: number;
  keywordPhrase: string;
  targetCategory: string;
  hit: TavilySearchHit;
  pageTitle?: string | null;
  pageSnippet?: string | null;
}

export interface ClassifiedSearchResult {
  index: number;
  classification: DiscoveryClassificationCategory;
  confidenceScore: number;
  reason: string;
  suggestedName: string;
  organizer: string;
  detectedType: SourceType;
  temporalStatus: TemporalStatus;
  registrationOpenDate: string | null;
  registrationDeadline: string | null;
  competitionStartDate: string | null;
  competitionEndDate: string | null;
  eventYear: number | null;
  temporalEvidence: string | null;
  temporalConfidence: number;
  targetAudience: TargetAudience;
}

export interface ClassificationRunOutput {
  results: ClassifiedSearchResult[];
  retryCount: number;
  modelUsed: string;
}

export interface ClassifySearchOptions {
  jakartaNow?: Date;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxTotalDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  verifyModelFn?: () => Promise<string>;
  generateContentFn?: (args: {
    model: string;
    contents: string;
    systemInstruction: string;
  }) => Promise<string>;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorMessage: string;
  }) => Promise<void> | void;
}

export class GeminiClassifierError extends Error {
  public readonly statusCode: number;
  public readonly retryable: boolean;

  constructor(message: string, statusCode = 502, retryable = false) {
    super(message);
    this.name = 'GeminiClassifierError';
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

let verifiedModelAt: number | null = null;
const MODEL_VERIFY_TTL_MS = 5 * 60_000;

const ALLOWED_CLASSIFICATIONS = new Set<DiscoveryClassificationCategory>([
  'Competition',
  'Organizer',
  'University',
  'Aggregator',
  'Community',
  'Irrelevant',
]);

const ALLOWED_SOURCE_TYPES = new Set<SourceType>([
  'website',
  'rss_feed',
  'public_portal',
  'social_reference',
  'newsletter_archive',
  'static_document',
]);

const ALLOWED_TEMPORAL_STATUSES = new Set<TemporalStatus>([
  'open',
  'upcoming',
  'closed',
  'completed',
  'archived',
  'unknown',
]);

const ALLOWED_AUDIENCES = new Set<TargetAudience>([
  'elementary_school',
  'junior_high_school',
  'senior_high_school',
  'university_student',
  'general_public',
  'professional',
  'mixed',
  'unknown',
]);

export function isTransientGeminiError(err: unknown): boolean {
  if (err instanceof GeminiClassifierError) {
    return err.retryable;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const upper = msg.toUpperCase();

  // Permanent auth/validation errors must never be retried
  if (
    /\b(400|401|403|404)\b/.test(msg) ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('INVALID_ARGUMENT') ||
    upper.includes('NOT_FOUND') ||
    err instanceof SyntaxError
  ) {
    return false;
  }

  return (
    /\b(429|500|502|503|504)\b/.test(msg) ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('DEADLINE_EXCEEDED') ||
    upper.includes('ECONNRESET') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('FETCH FAILED') ||
    upper.includes('TIMEOUT')
  );
}

function mapGeminiError(err: unknown, context: string): GeminiClassifierError {
  if (err instanceof GeminiClassifierError) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const upper = msg.toUpperCase();
  const statusMatch = msg.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
  const statusNum = statusMatch ? Number(statusMatch[1]) : 502;

  if (statusNum === 429 || upper.includes('RESOURCE_EXHAUSTED')) {
    return new GeminiClassifierError(
      `Gemini rate limit / quota exceeded during ${context}: ${msg}`,
      429,
      true
    );
  }
  if (
    statusNum === 500 ||
    statusNum === 502 ||
    statusNum === 503 ||
    statusNum === 504 ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('DEADLINE_EXCEEDED')
  ) {
    return new GeminiClassifierError(
      `Gemini upstream transient error (${statusNum}) during ${context}: ${msg}`,
      statusNum === 504 ? 504 : 503,
      true
    );
  }
  if (
    statusNum === 401 ||
    statusNum === 403 ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID')
  ) {
    return new GeminiClassifierError(
      `Gemini API key rejected during ${context}. Check GEMINI_API_KEY in Settings > Secrets.`,
      503,
      false
    );
  }
  if (statusNum === 400 || upper.includes('INVALID_ARGUMENT')) {
    return new GeminiClassifierError(`Gemini rejected request (${context}): ${msg}`, 400, false);
  }
  if (statusNum === 404 || upper.includes('NOT_FOUND')) {
    return new GeminiClassifierError(
      `Gemini model "${PHASE_2_DISCOVERY_MODEL}" not found or unavailable: ${msg}`,
      404,
      false
    );
  }
  const transient = isTransientGeminiError(err);
  return new GeminiClassifierError(`Gemini ${context} failed: ${msg}`, 502, transient);
}

export async function verifyDiscoveryGeminiModel(): Promise<string> {
  const ai = getServerGeminiClient();
  if (!ai) {
    throw new GeminiClassifierError(
      'GEMINI_API_KEY is not configured in server secrets.',
      503,
      false
    );
  }

  if (verifiedModelAt && Date.now() - verifiedModelAt < MODEL_VERIFY_TTL_MS) {
    return PHASE_2_DISCOVERY_MODEL;
  }

  try {
    const modelInfo = await ai.models.get({ model: PHASE_2_DISCOVERY_MODEL });
    if (!modelInfo?.name) {
      throw new GeminiClassifierError(
        `Unable to verify Gemini model "${PHASE_2_DISCOVERY_MODEL}".`,
        502,
        true
      );
    }
    verifiedModelAt = Date.now();
    return PHASE_2_DISCOVERY_MODEL;
  } catch (err) {
    verifiedModelAt = null;
    throw mapGeminiError(err, 'model verification');
  }
}

function sanitizeHostOrganizer(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'Unknown Host';
  }
}

function sanitizeNullableString(value: unknown, maxLen = 120): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'unknown') {
    return null;
  }
  return trimmed.slice(0, maxLen);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function classifySearchResultsWithGemini(
  items: ClassificationInputItem[],
  options: ClassifySearchOptions = {}
): Promise<ClassificationRunOutput> {
  if (items.length === 0) {
    return { results: [], retryCount: 0, modelUsed: PHASE_2_DISCOVERY_MODEL };
  }

  const verifyFn = options.verifyModelFn ?? verifyDiscoveryGeminiModel;
  const modelUsed = await verifyFn();

  const wibCtx = getJakartaDateTimeContext(options.jakartaNow);
  const systemInstruction = [
    'You are the DENIO RADAR Phase 2B.1 competition discovery & quality classifier.',
    `CURRENT REFERENCE DATE/TIME (Asia/Jakarta WIB): ${wibCtx.dateStr} ${wibCtx.timeStr} WIB (Year ${wibCtx.year}).`,
    'Always evaluate deadlines and competition timelines against this WIB reference date.',
    '',
    '1. classification (EXACTLY ONE):',
    '- Competition: A specific competition, hackathon, prize challenge, or olympiad page.',
    '- Organizer: Official foundation, ministry, or company portal that directly runs recurring competitions (e.g., puspresnas.kemdikbud.go.id, kaggle.com).',
    '- University: A university department, student affairs portal, or campus event listing (.ac.id, .edu).',
    '- Aggregator: A multi-event directory, aggregator, or listing portal collecting external competitions (e.g., infolomba.id, infolombait.com, kabarlomba.com, dev.events, devpost.com, unstop.com).',
    '- Community: A developer/design/student community hub or newsletter sharing competition announcements.',
    '- Irrelevant: Generic tutorials, SEO blogs, definitions, unrelated news, or commercial ads.',
    '',
    '2. detectedType (EXACTLY ONE):',
    '- website | rss_feed | public_portal | social_reference | newsletter_archive | static_document',
    '  * Use static_document for .pdf guidebook/pedoman files.',
    '  * Use social_reference for Instagram/LinkedIn/YouTube/TikTok/X posts or profiles.',
    '  * Use rss_feed ONLY for RSS/Atom XML feed endpoints.',
    '  * Use public_portal for university/government competition directories.',
    '',
    '3. Temporal fields (ground strictly in title, url, snippet, and pageSnippet — NEVER invent dates):',
    '- temporalStatus: open | upcoming | closed | completed | archived | unknown',
    '  * open: registration deadline is >= current WIB date or explicitly open.',
    '  * upcoming: registration opens in the future (> current WIB date) or says coming soon.',
    '  * closed: registration deadline < current WIB date or text says "registration closed / pendaftaran ditutup".',
    '  * completed: event already finished / winners announced / "grand success" / past year finished edition.',
    '  * archived: past-year guidebook, PDF, or archive page (e.g., 2021-2025 when current year is higher).',
    '  * unknown: no date or temporal status clue is present (do NOT guess open just because 2026 appears).',
    '- registrationOpenDate, registrationDeadline, competitionStartDate, competitionEndDate: YYYY-MM-DD if explicitly known, else null.',
    '- eventYear: integer year (e.g. 2026) if stated, else null.',
    '- temporalEvidence: concise exact quote/clue supporting temporalStatus, or null.',
    '- temporalConfidence: integer 0-100.',
    '',
    '4. targetAudience (EXACTLY ONE):',
    '- elementary_school | junior_high_school | senior_high_school | university_student | general_public | professional | mixed | unknown',
    '  * Do NOT mark school/kids competitions (e.g. age 7-12, SD/SMP/SMA) as university_student.',
  ].join('\n');

  const payloadForPrompt = items.map((entry) => ({
    index: entry.index,
    keywordPhrase: entry.keywordPhrase,
    targetCategory: entry.targetCategory,
    title: entry.hit.title,
    url: entry.hit.url,
    publishedDate: entry.hit.publishedDate,
    snippet: entry.hit.content.slice(0, 700),
    pageTitle: entry.pageTitle ?? null,
    pageSnippet: entry.pageSnippet ? entry.pageSnippet.slice(0, 1200) : null,
  }));

  const callGeminiOnce = async (): Promise<string> => {
    if (options.generateContentFn) {
      return options.generateContentFn({
        model: modelUsed,
        contents: JSON.stringify(payloadForPrompt),
        systemInstruction,
      });
    }

    const ai = getServerGeminiClient();
    if (!ai) {
      throw new GeminiClassifierError(
        'GEMINI_API_KEY is not configured in server secrets.',
        503,
        false
      );
    }

    const response = await ai.models.generateContent({
      model: modelUsed,
      contents: JSON.stringify(payloadForPrompt),
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              classification: { type: Type.STRING },
              confidenceScore: { type: Type.INTEGER },
              reason: { type: Type.STRING },
              suggestedName: { type: Type.STRING },
              organizer: { type: Type.STRING },
              detectedType: { type: Type.STRING },
              temporalStatus: { type: Type.STRING },
              registrationOpenDate: { type: Type.STRING, nullable: true },
              registrationDeadline: { type: Type.STRING, nullable: true },
              competitionStartDate: { type: Type.STRING, nullable: true },
              competitionEndDate: { type: Type.STRING, nullable: true },
              eventYear: { type: Type.INTEGER, nullable: true },
              temporalEvidence: { type: Type.STRING, nullable: true },
              temporalConfidence: { type: Type.INTEGER },
              targetAudience: { type: Type.STRING },
            },
            required: [
              'index',
              'classification',
              'confidenceScore',
              'reason',
              'suggestedName',
              'organizer',
              'detectedType',
              'temporalStatus',
              'temporalConfidence',
              'targetAudience',
            ],
          },
        },
      },
    });
    return (response.text ?? '[]').trim();
  };

  const maxAttempts = Math.min(4, Math.max(1, options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
  const maxTotalDelayMs = Math.max(baseDelayMs, options.maxTotalDelayMs ?? 12_000);
  const sleepFn = options.sleepFn ?? defaultSleep;

  let elapsedDelayMs = 0;
  let retryCount = 0;
  let rawJson = '';
  let lastErr: GeminiClassifierError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rawJson = await callGeminiOnce();
      const parsedCheck = JSON.parse(rawJson) as unknown;
      if (!Array.isArray(parsedCheck)) {
        throw new GeminiClassifierError(
          'Gemini returned a non-array classification payload.',
          502,
          false
        );
      }
      lastErr = null;
      break;
    } catch (err) {
      const mapped = mapGeminiError(err, 'search result classification');
      lastErr = mapped;

      if (!mapped.retryable || attempt >= maxAttempts) {
        throw mapped;
      }

      const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.round(expDelay * (0.1 + Math.random() * 0.25));
      const plannedDelay = Math.min(expDelay + jitter, Math.max(0, maxTotalDelayMs - elapsedDelayMs));

      if (plannedDelay <= 0 && baseDelayMs > 0) {
        throw mapped;
      }

      retryCount += 1;
      if (options.onRetry) {
        await options.onRetry({
          attempt,
          maxAttempts,
          delayMs: plannedDelay,
          errorMessage: mapped.message,
        });
      }

      if (plannedDelay > 0) {
        await sleepFn(plannedDelay);
        elapsedDelayMs += plannedDelay;
      }
    }
  }

  if (lastErr) {
    throw lastErr;
  }

  const parsed = JSON.parse(rawJson) as unknown[];
  const byIndex = new Map<number, ClassifiedSearchResult>();

  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const idx = typeof obj.index === 'number' ? obj.index : Number(obj.index);
    const sourceEntry = items.find((i) => i.index === idx);
    if (!sourceEntry) continue;

    const rawClass = String(obj.classification ?? '').trim() as DiscoveryClassificationCategory;
    const classification: DiscoveryClassificationCategory = ALLOWED_CLASSIFICATIONS.has(rawClass)
      ? rawClass
      : 'Irrelevant';

    const rawScore = Number(obj.confidenceScore ?? 50);
    const confidenceScore = Number.isFinite(rawScore)
      ? Math.min(100, Math.max(0, Math.round(rawScore)))
      : 50;

    const rawType = String(obj.detectedType ?? 'website').trim() as SourceType;
    const detectedType: SourceType = ALLOWED_SOURCE_TYPES.has(rawType) ? rawType : 'website';

    const rawTemporal = String(obj.temporalStatus ?? 'unknown').trim() as TemporalStatus;
    const temporalStatus: TemporalStatus = ALLOWED_TEMPORAL_STATUSES.has(rawTemporal)
      ? rawTemporal
      : 'unknown';

    const rawAudience = String(obj.targetAudience ?? 'unknown').trim() as TargetAudience;
    const targetAudience: TargetAudience = ALLOWED_AUDIENCES.has(rawAudience)
      ? rawAudience
      : 'unknown';

    const rawTempConf = Number(obj.temporalConfidence ?? 40);
    const temporalConfidence = Number.isFinite(rawTempConf)
      ? Math.min(100, Math.max(0, Math.round(rawTempConf)))
      : 40;

    const rawYear = obj.eventYear === null || obj.eventYear === undefined ? null : Number(obj.eventYear);
    const eventYear =
      rawYear !== null && Number.isFinite(rawYear) && rawYear >= 2000 && rawYear <= 2099
        ? Math.round(rawYear)
        : null;

    const suggestedName =
      typeof obj.suggestedName === 'string' && obj.suggestedName.trim().length >= 2
        ? obj.suggestedName.trim().slice(0, 140)
        : sourceEntry.hit.title.slice(0, 140);

    const organizer =
      typeof obj.organizer === 'string' && obj.organizer.trim().length >= 2
        ? obj.organizer.trim().slice(0, 120)
        : sanitizeHostOrganizer(sourceEntry.hit.url);

    const reason =
      typeof obj.reason === 'string' && obj.reason.trim().length > 0
        ? obj.reason.trim().slice(0, 320)
        : 'Classified from Tavily and crawled page metadata.';

    byIndex.set(idx, {
      index: idx,
      classification,
      confidenceScore,
      reason,
      suggestedName,
      organizer,
      detectedType,
      temporalStatus,
      registrationOpenDate: sanitizeNullableString(obj.registrationOpenDate, 32),
      registrationDeadline: sanitizeNullableString(obj.registrationDeadline, 32),
      competitionStartDate: sanitizeNullableString(obj.competitionStartDate, 32),
      competitionEndDate: sanitizeNullableString(obj.competitionEndDate, 32),
      eventYear,
      temporalEvidence: sanitizeNullableString(obj.temporalEvidence, 240),
      temporalConfidence,
      targetAudience,
    });
  }

  const results = items.map((entry) => {
    const existing = byIndex.get(entry.index);
    if (existing) return existing;
    return {
      index: entry.index,
      classification: 'Irrelevant' as const,
      confidenceScore: 0,
      reason: 'Omitted by classifier response; marked irrelevant to prevent unverified promotion.',
      suggestedName: entry.hit.title.slice(0, 140),
      organizer: sanitizeHostOrganizer(entry.hit.url),
      detectedType: 'website' as const,
      temporalStatus: 'unknown' as const,
      registrationOpenDate: null,
      registrationDeadline: null,
      competitionStartDate: null,
      competitionEndDate: null,
      eventYear: null,
      temporalEvidence: null,
      temporalConfidence: 0,
      targetAudience: 'unknown' as const,
    };
  });

  return {
    results,
    retryCount,
    modelUsed,
  };
}
