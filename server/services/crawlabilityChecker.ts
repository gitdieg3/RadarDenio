import type { CrawlabilityStatus } from '../../src/types/radar.ts';
import { isPdfUrl, isSocialSinglePostUrl } from '../../src/utils/discoveryQuality.ts';

export interface CrawlabilityProbeResult {
  url: string;
  finalUrl: string;
  status: CrawlabilityStatus;
  httpStatus: number | null;
  contentType: string | null;
  pageTitle: string | null;
  extractedText: string;
  details: string;
}

export interface CrawlabilityCheckerOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyChars?: number;
}

const DEFAULT_USER_AGENT =
  'DENIO-RADAR-Discovery/2.1 (+https://denio.radar; discovery-readiness-check)';

function stripHtmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 180)
    : null;

  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const text = withoutScripts
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, text };
}

function isCloudflareChallengeBody(lowerBody: string): boolean {
  return (
    lowerBody.includes('just a moment...') ||
    lowerBody.includes('cf-browser-verification') ||
    lowerBody.includes('_cf_chl_opt') ||
    lowerBody.includes('attention required! | cloudflare') ||
    lowerBody.includes('enable javascript and cookies to continue')
  );
}

function isCaptchaBody(lowerBody: string): boolean {
  return (
    lowerBody.includes('g-recaptcha') ||
    lowerBody.includes('hcaptcha.com') ||
    lowerBody.includes('cf-turnstile') ||
    lowerBody.includes('verify you are human') ||
    lowerBody.includes('memeriksa browser anda') ||
    lowerBody.includes('please complete the security check')
  );
}

function isLoginWallBody(lowerBody: string, finalUrlLower: string): boolean {
  if (
    /\/(accounts\/login|login|signin|authwall|session\/new)(\/|\?|$)/i.test(finalUrlLower)
  ) {
    return true;
  }
  return (
    lowerBody.includes('sign in to view') ||
    lowerBody.includes('log in to continue') ||
    lowerBody.includes('join now to view') ||
    lowerBody.includes('you must log in to continue')
  );
}

function looksLikeEmptySpaShell(lowerHtml: string, cleanTextLen: number): boolean {
  if (cleanTextLen >= 140) return false;
  return (
    lowerHtml.includes('id="root"') ||
    lowerHtml.includes("id='root'") ||
    lowerHtml.includes('id="app"') ||
    lowerHtml.includes('id="__next"') ||
    lowerHtml.includes('you need to enable javascript') ||
    lowerHtml.includes('please enable javascript') ||
    cleanTextLen < 60
  );
}

export async function probeUrlCrawlability(
  url: string,
  options: CrawlabilityCheckerOptions = {}
): Promise<CrawlabilityProbeResult> {
  const cleanUrl = url.trim();

  try {
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        url: cleanUrl,
        finalUrl: cleanUrl,
        status: 'unknown',
        httpStatus: null,
        contentType: null,
        pageTitle: null,
        extractedText: '',
        details: `Unsupported protocol: ${parsed.protocol}`,
      };
    }
  } catch {
    return {
      url: cleanUrl,
      finalUrl: cleanUrl,
      status: 'unknown',
      httpStatus: null,
      contentType: null,
      pageTitle: null,
      extractedText: '',
      details: 'Invalid URL format.',
    };
  }

  // Deterministic pre-checks for social single posts and static PDFs
  if (isSocialSinglePostUrl(cleanUrl)) {
    return {
      url: cleanUrl,
      finalUrl: cleanUrl,
      status: 'social_single_post',
      httpStatus: null,
      contentType: null,
      pageTitle: null,
      extractedText: '',
      details: 'Social single-post URL detected; unsuitable for standard HTML polling.',
    };
  }

  if (isPdfUrl(cleanUrl)) {
    return {
      url: cleanUrl,
      finalUrl: cleanUrl,
      status: 'static_pdf',
      httpStatus: null,
      contentType: 'application/pdf',
      pageTitle: null,
      extractedText: '',
      details: 'Static PDF document URL detected; cannot be monitored as a live feed.',
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.min(12_000, Math.max(1_500, options.timeoutMs ?? 6_000));
  const maxBodyChars = options.maxBodyChars ?? 1_600;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(cleanUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    const finalUrl = response.url || cleanUrl;
    const httpStatus = response.status;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? null;
    const cfMitigated = response.headers.get('cf-mitigated')?.toLowerCase() ?? '';

    if (cfMitigated.includes('challenge')) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'cloudflare_challenge',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: `Cloudflare challenge header detected (HTTP ${httpStatus}).`,
      };
    }

    if (contentType && contentType.includes('application/pdf')) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'static_pdf',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: 'Response Content-Type is application/pdf.',
      };
    }

    let rawBody = '';
    try {
      rawBody = await response.text();
    } catch {
      rawBody = '';
    }
    const bodyHead = rawBody.slice(0, 60_000);
    const lowerBody = bodyHead.toLowerCase();
    const finalUrlLower = finalUrl.toLowerCase();

    if (httpStatus === 404 || httpStatus === 410) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'not_found_404',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: `Page returned HTTP ${httpStatus} (not found).`,
      };
    }

    if (httpStatus === 429) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'rate_limited_429',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: 'Target server returned HTTP 429 Too Many Requests.',
      };
    }

    if (httpStatus === 403) {
      if (isCloudflareChallengeBody(lowerBody)) {
        return {
          url: cleanUrl,
          finalUrl,
          status: 'cloudflare_challenge',
          httpStatus,
          contentType,
          pageTitle: null,
          extractedText: '',
          details: 'HTTP 403 Cloudflare challenge interstitial detected.',
        };
      }
      if (isCaptchaBody(lowerBody)) {
        return {
          url: cleanUrl,
          finalUrl,
          status: 'captcha_blocked',
          httpStatus,
          contentType,
          pageTitle: null,
          extractedText: '',
          details: 'HTTP 403 CAPTCHA verification detected.',
        };
      }
      return {
        url: cleanUrl,
        finalUrl,
        status: 'forbidden_403',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: 'Target returned HTTP 403 Forbidden.',
      };
    }

    if (httpStatus === 401) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'login_wall',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: 'Target returned HTTP 401 Unauthorized (login required).',
      };
    }

    if (httpStatus >= 400) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'http_error',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: `Target returned HTTP ${httpStatus}.`,
      };
    }

    if (isCloudflareChallengeBody(lowerBody)) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'cloudflare_challenge',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: 'Cloudflare browser challenge detected in response body.',
      };
    }

    if (isCaptchaBody(lowerBody)) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'captcha_blocked',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: 'CAPTCHA challenge detected in response body.',
      };
    }

    if (isLoginWallBody(lowerBody, finalUrlLower)) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'login_wall',
        httpStatus,
        contentType,
        pageTitle: null,
        extractedText: '',
        details: 'Login or authentication wall detected.',
      };
    }

    const { title, text } = stripHtmlToText(bodyHead);
    const isHtml = !contentType || contentType.includes('text/html') || contentType.includes('xhtml');

    if (isHtml && looksLikeEmptySpaShell(lowerBody, text.length)) {
      return {
        url: cleanUrl,
        finalUrl,
        status: 'empty_html_shell',
        httpStatus,
        contentType,
        pageTitle: title,
        extractedText: text.slice(0, maxBodyChars),
        details: `HTML body yielded only ${text.length} text chars (likely JS-rendered SPA shell).`,
      };
    }

    const redirectedHostOrPath =
      response.redirected &&
      finalUrl.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '') !==
        cleanUrl.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');

    return {
      url: cleanUrl,
      finalUrl,
      status: redirectedHostOrPath ? 'redirect' : 'accessible',
      httpStatus,
      contentType,
      pageTitle: title,
      extractedText: text.slice(0, maxBodyChars),
      details: redirectedHostOrPath
        ? `Accessible via redirect to ${finalUrl} (HTTP ${httpStatus}).`
        : `Accessible (HTTP ${httpStatus}, ${text.length} text chars extracted).`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        url: cleanUrl,
        finalUrl: cleanUrl,
        status: 'timeout',
        httpStatus: null,
        contentType: null,
        pageTitle: null,
        extractedText: '',
        details: `Crawlability check timed out after ${timeoutMs}ms.`,
      };
    }
    return {
      url: cleanUrl,
      finalUrl: cleanUrl,
      status: 'http_error',
      httpStatus: null,
      contentType: null,
      pageTitle: null,
      extractedText: '',
      details: err instanceof Error ? `Network error: ${err.message}` : 'Network check failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeBatchCrawlability(
  urls: string[],
  options: CrawlabilityCheckerOptions & { concurrency?: number } = {}
): Promise<Map<string, CrawlabilityProbeResult>> {
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  const results = new Map<string, CrawlabilityProbeResult>();
  const concurrency = Math.max(1, Math.min(6, options.concurrency ?? 4));

  let cursor = 0;
  async function worker() {
    while (cursor < uniqueUrls.length) {
      const idx = cursor;
      cursor += 1;
      const target = uniqueUrls[idx];
      const probe = await probeUrlCrawlability(target, options);
      results.set(target, probe);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, () => worker())
  );

  return results;
}
