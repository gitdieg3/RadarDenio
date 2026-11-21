import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectThreeLevelDuplicate,
  evaluateCandidateKindAndEligibility,
  evaluateTargetAudienceCompatibility,
  evaluateTemporalStatus,
  filterDiscoveryCandidates,
  getJakartaDateTimeContext,
  resolveClassificationDeterministic,
  resolveDetectedTypeDeterministic,
} from './discoveryQuality';
import type { DiscoveryCandidate } from '../types/radar';

const FIXED_WIB_NOW = getJakartaDateTimeContext(new Date('2026-06-15T05:00:00Z')); // 2026-06-15 12:00:00 WIB

// 1-7: Temporal & Date Context
test('1. getJakartaDateTimeContext computes dynamic Asia/Jakarta date and year', () => {
  const ctx = getJakartaDateTimeContext(new Date('2026-06-15T20:00:00Z')); // 2026-06-16 03:00 WIB
  assert.equal(ctx.dateStr, '2026-06-16');
  assert.equal(ctx.year, 2026);
  assert.match(ctx.isoWib, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
});

test('2. evaluateTemporalStatus marks past registration deadline as closed', () => {
  const res = evaluateTemporalStatus({
    modelStatus: 'open',
    registrationDeadline: '2026-04-30',
    jakartaNow: FIXED_WIB_NOW,
  });
  assert.equal(res.temporalStatus, 'closed');
  assert.ok(res.temporalConfidence >= 85);
});

test('3. evaluateTemporalStatus marks active future deadline as open', () => {
  const res = evaluateTemporalStatus({
    modelStatus: 'unknown',
    registrationDeadline: '2026-08-30',
    jakartaNow: FIXED_WIB_NOW,
  });
  assert.equal(res.temporalStatus, 'open');
});

test('4. evaluateTemporalStatus marks future registration open date as upcoming', () => {
  const res = evaluateTemporalStatus({
    registrationOpenDate: '2026-07-01',
    registrationDeadline: '2026-08-15',
    jakartaNow: FIXED_WIB_NOW,
  });
  assert.equal(res.temporalStatus, 'upcoming');
});

test('5. evaluateTemporalStatus detects completed competition from winners announced / grand success text', () => {
  const res = evaluateTemporalStatus({
    modelStatus: 'open',
    textCorpus: 'AI Hackathon Indonesia 2026 was a grand success. Winners announced on stage!',
    jakartaNow: FIXED_WIB_NOW,
  });
  assert.equal(res.temporalStatus, 'completed');
});

test('6. evaluateTemporalStatus marks prior-year PDF or guideline as archived', () => {
  const res = evaluateTemporalStatus({
    url: 'https://puspresnas.kemdikbud.go.id/pedoman-lidm-2025.pdf',
    eventYear: 2025,
    jakartaNow: FIXED_WIB_NOW,
  });
  assert.equal(res.temporalStatus, 'archived');
});

test('7. evaluateTemporalStatus returns unknown when no dates or cues exist even if year 2026 appears in title', () => {
  const res = evaluateTemporalStatus({
    textCorpus: 'Kompetisi AI & Data Science 2026 Info Umum',
    eventYear: 2026,
    jakartaNow: FIXED_WIB_NOW,
  });
  assert.equal(res.temporalStatus, 'unknown');
});

// 8-12: Classification & Audience
test('8. infolomba.id is deterministically classified as Aggregator', () => {
  const cls = resolveClassificationDeterministic({
    url: 'https://infolomba.id/info-lomba-ui-ux-2026',
    modelClassification: 'Organizer',
  });
  assert.equal(cls, 'Aggregator');
});

test('9. dev.events is deterministically classified as Aggregator', () => {
  const cls = resolveClassificationDeterministic({
    url: 'https://dev.events/AS',
    modelClassification: 'Competition',
  });
  assert.equal(cls, 'Aggregator');
});

test('10. direct organizer page retains Organizer classification', () => {
  const cls = resolveClassificationDeterministic({
    url: 'https://uiuxindo.id/design-challenge-2026',
    modelClassification: 'Organizer',
  });
  assert.equal(cls, 'Organizer');
});

test('11. university portal (.ac.id) is classified as University', () => {
  const cls = resolveClassificationDeterministic({
    url: 'https://kemahasiswaan.its.ac.id/events',
    modelClassification: 'Organizer',
  });
  assert.equal(cls, 'University');
});

test('12. school/kids competition (usia 7-12) is flagged audienceCompatible=false for mahasiswa keyword', () => {
  const audience = evaluateTargetAudienceCompatibility({
    keywordPhrase: 'lomba programming mahasiswa 2026',
    modelAudience: 'university_student',
    textCorpus: 'Kids Coding Competition usia 7-12 tahun tingkat SD.',
  });
  assert.equal(audience.targetAudience, 'elementary_school');
  assert.equal(audience.audienceCompatible, false);
});

// 13-18: Detected Type & Format
test('13. .pdf URL resolves to static_document', () => {
  assert.equal(
    resolveDetectedTypeDeterministic({
      url: 'https://kemdikbud.go.id/pedoman-lidm-2025.pdf',
      modelDetectedType: 'website',
    }),
    'static_document'
  );
});

test('14. Instagram post URL resolves to social_reference', () => {
  assert.equal(
    resolveDetectedTypeDeterministic({
      url: 'https://www.instagram.com/p/C9xyz123/',
      modelDetectedType: 'website',
    }),
    'social_reference'
  );
});

test('15. LinkedIn post URL resolves to social_reference', () => {
  assert.equal(
    resolveDetectedTypeDeterministic({
      url: 'https://www.linkedin.com/posts/hackathon-id_activity-12345',
      modelDetectedType: 'website',
    }),
    'social_reference'
  );
});

test('16. YouTube watch URL resolves to social_reference', () => {
  assert.equal(
    resolveDetectedTypeDeterministic({
      url: 'https://www.youtube.com/watch?v=abc123',
      modelDetectedType: 'website',
    }),
    'social_reference'
  );
});

test('17. RSS XML feed URL resolves to rss_feed', () => {
  assert.equal(
    resolveDetectedTypeDeterministic({
      url: 'https://example.org/competitions/feed.xml',
      modelDetectedType: 'website',
    }),
    'rss_feed'
  );
});

test('18. University/gov portal resolves to public_portal', () => {
  assert.equal(
    resolveDetectedTypeDeterministic({
      url: 'https://puspresnas.kemdikbud.go.id/kompetisi',
      classification: 'Organizer',
      modelDetectedType: 'website',
    }),
    'public_portal'
  );
});

// 19-22: Source Eligibility & Promotion Guard
test('19. single closed competition is marked event candidate & ineligible for Source Registry', () => {
  const elig = evaluateCandidateKindAndEligibility({
    url: 'https://hackathon-x.example.id/register',
    classification: 'Competition',
    detectedType: 'website',
    temporalStatus: 'closed',
    crawlabilityStatus: 'accessible',
  });
  assert.equal(elig.candidateKind, 'event');
  assert.equal(elig.isMonitorable, false);
  assert.equal(elig.monitoringEligibility, 'ineligible');
  assert.ok(elig.monitoringBlockReason?.includes('closed'));
});

test('20. accessible aggregator directory root is marked monitorable source candidate', () => {
  const elig = evaluateCandidateKindAndEligibility({
    url: 'https://dev.events/AS',
    classification: 'Aggregator',
    detectedType: 'website',
    temporalStatus: 'unknown',
    crawlabilityStatus: 'accessible',
  });
  assert.equal(elig.candidateKind, 'source');
  assert.equal(elig.isRecurringSource, true);
  assert.equal(elig.isMonitorable, true);
  assert.equal(elig.monitoringEligibility, 'eligible');
});

test('21. social single post and static PDF are blocked from Source Registry promotion', () => {
  const social = evaluateCandidateKindAndEligibility({
    url: 'https://www.instagram.com/p/C9xyz/',
    classification: 'Community',
    detectedType: 'social_reference',
    temporalStatus: 'open',
    crawlabilityStatus: 'social_single_post',
  });
  assert.equal(social.isMonitorable, false);
  assert.equal(social.monitoringEligibility, 'ineligible');

  const pdf = evaluateCandidateKindAndEligibility({
    url: 'https://example.ac.id/pedoman.pdf',
    classification: 'University',
    detectedType: 'static_document',
    temporalStatus: 'archived',
    crawlabilityStatus: 'static_pdf',
  });
  assert.equal(pdf.isMonitorable, false);
  assert.equal(pdf.monitoringEligibility, 'ineligible');
});

test('22. login_wall, cloudflare_challenge, forbidden_403, and empty_html_shell block monitorability', () => {
  for (const status of [
    'login_wall',
    'cloudflare_challenge',
    'forbidden_403',
    'empty_html_shell',
  ] as const) {
    const elig = evaluateCandidateKindAndEligibility({
      url: 'https://example.org/events',
      classification: 'Organizer',
      detectedType: 'website',
      temporalStatus: 'open',
      crawlabilityStatus: status,
    });
    assert.equal(elig.isMonitorable, false);
    assert.equal(elig.monitoringEligibility, 'ineligible');
    assert.ok(elig.monitoringBlockReason && elig.monitoringBlockReason.length > 5);
  }
});

// 23-25: 3-Level Deduplication
test('23. Level A exact normalized URL duplicate skips insert', () => {
  const dedup = detectThreeLevelDuplicate({
    url: 'https://www.example.org/events/?utm_source=tavily',
    suggestedName: 'Example Hackathon',
    organizer: 'Example',
    candidateKind: 'event',
    classification: 'Competition',
    knownExactUrls: new Set(['https://example.org/events']),
    existingSources: [],
    existingCandidates: [],
  });
  assert.equal(dedup.level, 'exact_url');
  assert.equal(dedup.skipInsert, true);
});

test('24. Level C semantic dedup flags LIDM variants across multiple URLs for review without merging distinct events', () => {
  const lidm1: DiscoveryCandidate = {
    id: 'cand-lidm-1',
    suggestedName: 'Lomba Inovasi Digital Mahasiswa (LIDM) 2025 Kemendikbud',
    url: 'https://puspresnas.kemdikbud.go.id/lidm-2025.pdf',
    organizer: 'Puspresnas Kemdikbud',
    detectedType: 'static_document',
    discoveryMethod: 'search_engine',
    matchedKeyword: 'lomba inovasi digital mahasiswa',
    category: 'Digital Innovation',
    confidenceNote: 'LIDM',
    status: 'candidate',
    dataOrigin: 'tavily_discovery',
    discoveredAt: '2026-06-15T00:00:00Z',
    candidateKind: 'event',
    classification: 'Competition',
    eventYear: 2025,
  };

  const dup = detectThreeLevelDuplicate({
    url: 'https://www.instagram.com/p/lidm-2026-kickoff/',
    suggestedName: 'Sosialisasi Lomba Inovasi Digital Mahasiswa (LIDM) 2026',
    organizer: 'Puspresnas',
    candidateKind: 'event',
    classification: 'Competition',
    eventYear: 2026,
    knownExactUrls: new Set(),
    existingSources: [],
    existingCandidates: [lidm1],
  });
  assert.equal(dup.level, 'semantic_event');
  assert.notEqual(dup.duplicateStatus, 'unique');
  assert.equal(dup.skipInsert, false);
});

test('25. Two clearly distinct events on the same aggregator domain are NOT falsely merged', () => {
  const distinctA = {
    id: 'cand-agg-1',
    url: 'https://infolombait.com/lomba-ui-ux-2026.html',
    suggestedName: 'UI/UX National Design Sprint 2026',
    organizer: 'Himpunan Desain',
    candidateKind: 'event' as const,
    classification: 'Aggregator' as const,
    sourceDomain: 'infolombait.com',
    eventYear: 2026,
  };

  const dedup = detectThreeLevelDuplicate({
    url: 'https://infolombait.com/lomba-cyber-security-ctf-2026.html',
    suggestedName: 'National Cyber Security Capture The Flag 2026',
    organizer: 'Komunitas Cyber',
    candidateKind: 'event',
    classification: 'Aggregator',
    eventYear: 2026,
    knownExactUrls: new Set(),
    existingSources: [],
    existingCandidates: [distinctA],
  });
  assert.equal(dedup.level, 'none');
  assert.equal(dedup.duplicateStatus, 'unique');
});

test('filterDiscoveryCandidates filters cleanly by kind, temporalStatus, monitorability, and duplicatesOnly', () => {
  const sample: DiscoveryCandidate[] = [
    {
      id: '1',
      suggestedName: 'Dev Events Asia',
      url: 'https://dev.events/AS',
      organizer: 'Dev Events',
      detectedType: 'website',
      discoveryMethod: 'search_engine',
      matchedKeyword: 'hackathon',
      category: 'AI',
      confidenceNote: 'Aggregator directory',
      status: 'candidate',
      dataOrigin: 'tavily_discovery',
      discoveredAt: '2026-06-15T00:00:00Z',
      candidateKind: 'source',
      temporalStatus: 'open',
      isMonitorable: true,
      monitoringEligibility: 'eligible',
      duplicateStatus: 'unique',
    },
    {
      id: '2',
      suggestedName: 'Old LIDM PDF',
      url: 'https://example.ac.id/lidm.pdf',
      organizer: 'Kemdikbud',
      detectedType: 'static_document',
      discoveryMethod: 'search_engine',
      matchedKeyword: 'lidm',
      category: 'Digital',
      confidenceNote: 'PDF',
      status: 'candidate',
      dataOrigin: 'tavily_discovery',
      discoveredAt: '2026-06-15T00:00:00Z',
      candidateKind: 'event',
      temporalStatus: 'archived',
      isMonitorable: false,
      monitoringEligibility: 'ineligible',
      duplicateStatus: 'possible_duplicate',
    },
    {
      id: '3',
      suggestedName: 'Legacy Phase 2B Directory',
      url: 'https://legacy-org.id/',
      organizer: 'Legacy Org',
      detectedType: 'website',
      discoveryMethod: 'search_engine',
      matchedKeyword: 'lomba',
      category: 'General',
      confidenceNote: 'Pre-2B.1 candidate',
      status: 'candidate',
      dataOrigin: 'tavily_discovery',
      discoveredAt: '2026-06-01T00:00:00Z',
      candidateKind: 'unknown',
      temporalStatus: 'unknown',
      duplicateStatus: 'unknown',
    },
  ];

  assert.equal(filterDiscoveryCandidates(sample, { kind: 'source' }).length, 1);
  assert.equal(filterDiscoveryCandidates(sample, { kind: 'event' }).length, 1);
  assert.equal(filterDiscoveryCandidates(sample, { temporalStatus: 'archived' }).length, 1);
  assert.equal(filterDiscoveryCandidates(sample, { temporalStatus: 'unknown' }).length, 1);
  assert.equal(filterDiscoveryCandidates(sample, { eligibility: 'monitorable' }).length, 1);
  assert.equal(filterDiscoveryCandidates(sample, { duplicatesOnly: true }).length, 1);
});

// 26-32: Bug #1 Regression Suite — Campus Achievement News vs Genuine Campus Competition Portals
test('26. Past-year campus winner news articles (UNPAR 2022 & SV UGM 2024 QA cases) are blocked as non-monitorable event articles with null recommendedMonitoringUrl', () => {
  const unpar = evaluateCandidateKindAndEligibility({
    url: 'https://unpar.ac.id/gagas-bisnis-umkm-mahasiswa-unpar-juara-3-national-business-plan-competition',
    classification: 'University',
    detectedType: 'public_portal',
    temporalStatus: 'completed',
    crawlabilityStatus: 'accessible',
    title: 'Gagas Bisnis UMKM, Mahasiswa UNPAR Juara 3 National Business Plan Competition',
    textCorpus:
      'Tim mahasiswa Universitas Katolik Parahyangan berhasil meraih Juara 3 National Business Plan Competition 2022.',
  });
  assert.equal(unpar.candidateKind, 'event');
  assert.equal(unpar.isRecurringSource, false);
  assert.equal(unpar.isMonitorable, false);
  assert.equal(unpar.monitoringEligibility, 'ineligible');
  assert.equal(unpar.recommendedMonitoringUrl, null);

  const ugm = evaluateCandidateKindAndEligibility({
    url: 'https://deb.sv.ugm.ac.id/tim-ecocouture-mahasiswa-deb-sv-ugm-berhasil-meraih-juara-1-international-business-plan-competition/',
    classification: 'University',
    detectedType: 'public_portal',
    temporalStatus: 'completed',
    crawlabilityStatus: 'accessible',
    title: 'Tim EcoCouture Mahasiswa DEB SV UGM Berhasil Meraih Juara 1 International Business Plan Competition',
    textCorpus:
      'Mahasiswa Sekolah Vokasi UGM kembali menorehkan prestasi dengan meraih juara 1 pada tahun 2024.',
  });
  assert.equal(ugm.candidateKind, 'event');
  assert.equal(ugm.isRecurringSource, false);
  assert.equal(ugm.isMonitorable, false);
  assert.equal(ugm.monitoringEligibility, 'ineligible');
  assert.equal(ugm.recommendedMonitoringUrl, null);
});

test('27. Campus achievement news article with NO year mentioned (temporalStatus: unknown) is still blocked from Source Registry', () => {
  const noYearArticle = evaluateCandidateKindAndEligibility({
    url: 'https://kemahasiswaan.kampus.ac.id/berita/mahasiswa-informatika-raih-juara-2-hackathon-nasional',
    classification: 'University',
    detectedType: 'public_portal',
    temporalStatus: 'unknown',
    crawlabilityStatus: 'accessible',
    title: 'Mahasiswa Informatika Raih Juara 2 Hackathon Nasional',
    textCorpus: 'Tim mahasiswa berhasil meraih juara 2 pada ajang hackathon tingkat nasional.',
  });
  assert.equal(noYearArticle.candidateKind, 'event');
  assert.equal(noYearArticle.isRecurringSource, false);
  assert.equal(noYearArticle.isMonitorable, false);
  assert.equal(noYearArticle.monitoringEligibility, 'ineligible');
  assert.equal(noYearArticle.recommendedMonitoringUrl, null);
});

test('28. Genuine active campus competition portals (incl. Pusat Prestasi Nasional & sidebar winner mentions) are NOT false-positived', () => {
  const itb = evaluateCandidateKindAndEligibility({
    url: 'https://kompetisi.itb.ac.id/',
    classification: 'University',
    detectedType: 'public_portal',
    temporalStatus: 'open',
    crawlabilityStatus: 'accessible',
    title: 'Portal Kompetisi Mahasiswa ITB',
    textCorpus: 'Direktori resmi lomba dan kompetisi mahasiswa tingkat nasional dan internasional.',
  });
  assert.equal(itb.candidateKind, 'source');
  assert.equal(itb.isRecurringSource, true);
  assert.equal(itb.isMonitorable, true);
  assert.equal(itb.monitoringEligibility, 'eligible');

  const ui = evaluateCandidateKindAndEligibility({
    url: 'https://kemahasiswaan.ui.ac.id/lomba',
    classification: 'University',
    detectedType: 'public_portal',
    temporalStatus: 'open',
    crawlabilityStatus: 'accessible',
    title: 'Informasi Lomba & Prestasi Mahasiswa UI',
    textCorpus:
      'Daftar lomba mahasiswa terbaru. Berita samping: Tim UI Juara 1 Gemastik tahun lalu.',
  });
  assert.equal(ui.candidateKind, 'source');
  assert.equal(ui.isMonitorable, true);
  assert.equal(ui.monitoringEligibility, 'eligible');

  const puspresnas = evaluateCandidateKindAndEligibility({
    url: 'https://puspresnas.kemdikbud.go.id/kompetisi',
    classification: 'Organizer',
    detectedType: 'public_portal',
    temporalStatus: 'open',
    crawlabilityStatus: 'accessible',
    title: 'Pusat Prestasi Nasional — Daftar Kompetisi Mahasiswa',
    textCorpus: 'Portal resmi kompetisi mahasiswa nasional Kemdikbudristek.',
  });
  assert.equal(puspresnas.candidateKind, 'source');
  assert.equal(puspresnas.isMonitorable, true);
  assert.equal(puspresnas.monitoringEligibility, 'eligible');
});

test('29. Aggregator directory root is monitorable, while single aggregator listing is blocked with root recommendedMonitoringUrl', () => {
  const dir = evaluateCandidateKindAndEligibility({
    url: 'https://infolomba.id/',
    classification: 'Aggregator',
    detectedType: 'website',
    temporalStatus: 'open',
    crawlabilityStatus: 'accessible',
    title: 'InfoLomba — Direktori Lomba & Kompetisi Terbaru',
  });
  assert.equal(dir.candidateKind, 'source');
  assert.equal(dir.isMonitorable, true);
  assert.equal(dir.monitoringEligibility, 'eligible');
  assert.equal(dir.recommendedMonitoringUrl, null);

  const singlePost = evaluateCandidateKindAndEligibility({
    url: 'https://infolomba.id/2026/05/lomba-ui-ux-nasional.html',
    classification: 'Aggregator',
    detectedType: 'website',
    temporalStatus: 'open',
    crawlabilityStatus: 'accessible',
    title: 'Lomba UI/UX Design Nasional 2026',
  });
  assert.equal(singlePost.candidateKind, 'event');
  assert.equal(singlePost.isMonitorable, false);
  assert.equal(singlePost.monitoringEligibility, 'ineligible');
  assert.equal(singlePost.recommendedMonitoringUrl, 'https://infolomba.id');
});

test('30. Temporal statuses completed, closed, and archived block monitoring across ALL candidate kinds (not only event)', () => {
  for (const status of ['completed', 'closed', 'archived'] as const) {
    const res = evaluateCandidateKindAndEligibility({
      url: 'https://example-organizer.org/annual-challenge',
      classification: 'Organizer',
      detectedType: 'website',
      temporalStatus: status,
      crawlabilityStatus: 'accessible',
      title: 'Annual Challenge Organizer Hub',
    });
    assert.equal(res.isMonitorable, false);
    assert.equal(res.monitoringEligibility, 'ineligible');
    assert.equal(res.isRecurringSource, false);
    assert.ok(res.monitoringBlockReason?.includes(status));
  }
});

test('31. Upcoming event under a valid competition portal populates parent recommendedMonitoringUrl cleanly', () => {
  const puspresnasEvent = evaluateCandidateKindAndEligibility({
    url: 'https://puspresnas.kemdikbud.go.id/kompetisi/lidm-2026',
    classification: 'Competition',
    detectedType: 'public_portal',
    temporalStatus: 'upcoming',
    crawlabilityStatus: 'accessible',
    title: 'Lomba Inovasi Digital Mahasiswa (LIDM) 2026',
  });
  assert.equal(puspresnasEvent.candidateKind, 'event');
  assert.equal(puspresnasEvent.isMonitorable, false);
  assert.equal(puspresnasEvent.monitoringEligibility, 'ineligible');
  assert.equal(
    puspresnasEvent.recommendedMonitoringUrl,
    'https://puspresnas.kemdikbud.go.id/kompetisi'
  );

  const itbEvent = evaluateCandidateKindAndEligibility({
    url: 'https://kompetisi.itb.ac.id/2026/ai-hackathon',
    classification: 'Competition',
    detectedType: 'public_portal',
    temporalStatus: 'upcoming',
    crawlabilityStatus: 'accessible',
    title: 'ITB AI Hackathon 2026',
  });
  assert.equal(itbEvent.candidateKind, 'event');
  assert.equal(itbEvent.isMonitorable, false);
  assert.equal(itbEvent.recommendedMonitoringUrl, 'https://kompetisi.itb.ac.id');
});

