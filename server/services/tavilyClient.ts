export interface TavilySearchHit {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate: string | null;
}

export interface TavilySearchResponse {
  query: string;
  responseTimeSeconds: number | null;
  results: TavilySearchHit[];
}

export class TavilyApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'TavilyApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function getTavilyApiKey(): string {
  const key = process.env.SEARCH_ENGINE_API_KEY?.trim() ?? '';
  if (!key || key === 'MY_SEARCH_ENGINE_API_KEY') {
    throw new TavilyApiError(
      'SEARCH_ENGINE_API_KEY is not configured in server secrets.',
      503,
      'TAVILY_KEY_MISSING'
    );
  }
  return key;
}

export function isTavilyConfigured(): boolean {
  const key = process.env.SEARCH_ENGINE_API_KEY?.trim() ?? '';
  return Boolean(key && key !== 'MY_SEARCH_ENGINE_API_KEY');
}

export async function searchTavily(params: {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
  timeRange?: 'day' | 'week' | 'month' | 'year' | 'all';
  excludeDomains?: string[];
  fetchImpl?: typeof fetch;
}): Promise<TavilySearchResponse> {
  const apiKey = getTavilyApiKey();
  const cleanQuery = params.query.trim().slice(0, 350);
  if (cleanQuery.length < 2) {
    throw new TavilyApiError(
      'Search query must contain at least 2 characters.',
      400,
      'TAVILY_INVALID_QUERY'
    );
  }

  const maxResults = Math.min(8, Math.max(1, Math.floor(params.maxResults ?? 5)));
  const timeoutMs = Math.min(25_000, Math.max(3_000, params.timeoutMs ?? 15_000));
  const fetchImpl = params.fetchImpl ?? fetch;

  const payload: Record<string, unknown> = {
    api_key: apiKey,
    query: cleanQuery,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  };

  if (
    params.timeRange &&
    params.timeRange !== 'all' &&
    ['day', 'week', 'month', 'year'].includes(params.timeRange)
  ) {
    payload.time_range = params.timeRange;
  }

  if (Array.isArray(params.excludeDomains) && params.excludeDomains.length > 0) {
    const cleanExcluded = params.excludeDomains
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter((d) => d.length >= 3)
      .slice(0, 50);
    if (cleanExcluded.length > 0) {
      payload.exclude_domains = cleanExcluded;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let parsed: Record<string, unknown> = {};
    if (rawText) {
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    }

    if (!response.ok) {
      const apiErrMsg =
        typeof parsed.detail === 'string'
          ? parsed.detail
          : typeof parsed.error === 'string'
          ? parsed.error
          : `Tavily API returned HTTP ${response.status}.`;

      if (response.status === 401 || response.status === 403) {
        throw new TavilyApiError(
          `Tavily authentication failed (${response.status}): ${apiErrMsg}`,
          503,
          'TAVILY_AUTH_ERROR'
        );
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        throw new TavilyApiError(
          `Tavily rate limit exceeded (429)${retryAfter ? ` — retry after ${retryAfter}s` : ''}. ${apiErrMsg}`,
          429,
          'TAVILY_RATE_LIMIT'
        );
      }
      if (response.status >= 400 && response.status < 500) {
        throw new TavilyApiError(
          `Tavily request rejected (${response.status}): ${apiErrMsg}`,
          400,
          'TAVILY_BAD_REQUEST'
        );
      }
      throw new TavilyApiError(
        `Tavily upstream error (${response.status}): ${apiErrMsg}`,
        502,
        'TAVILY_UPSTREAM_ERROR'
      );
    }

    const rawResults = Array.isArray(parsed.results) ? parsed.results : null;
    if (!rawResults) {
      throw new TavilyApiError(
        'Tavily API response missing results array.',
        502,
        'TAVILY_MALFORMED_RESPONSE'
      );
    }

    const results: TavilySearchHit[] = [];
    for (const item of rawResults) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const url = typeof rec.url === 'string' ? rec.url.trim() : '';
      if (!url) continue;
      results.push({
        title: typeof rec.title === 'string' ? rec.title.trim() : url,
        url,
        content: typeof rec.content === 'string' ? rec.content.trim().slice(0, 1200) : '',
        score: typeof rec.score === 'number' && Number.isFinite(rec.score) ? rec.score : 0,
        publishedDate:
          typeof rec.published_date === 'string' && rec.published_date.trim()
            ? rec.published_date.trim()
            : null,
      });
    }

    return {
      query: typeof parsed.query === 'string' ? parsed.query : cleanQuery,
      responseTimeSeconds:
        typeof parsed.response_time === 'number' ? parsed.response_time : null,
      results,
    };
  } catch (err) {
    if (err instanceof TavilyApiError) {
      throw err;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TavilyApiError(
        `Tavily search request timed out after ${timeoutMs}ms.`,
        504,
        'TAVILY_TIMEOUT'
      );
    }
    throw new TavilyApiError(
      err instanceof Error ? `Tavily network error: ${err.message}` : 'Tavily network failure.',
      502,
      'TAVILY_NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }
}
