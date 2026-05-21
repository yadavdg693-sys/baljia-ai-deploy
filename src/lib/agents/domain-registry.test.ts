import { describe, expect, it } from 'vitest';

import {
  DOMAIN_PACKS,
  formatDomainMatches,
  formatDomainPack,
  getDomainPack,
  hasClearDomainSignals,
  listDomainPacks,
  matchDomainApp,
  normalizeDomainId,
} from './domain-registry';

const EXPECTED_DOMAIN_IDS = [
  'ecommerce_store',
  'business_website_crm',
  'local_service_booking',
  'inventory_operations',
  'construction_operations',
  'finance_crypto',
  'social_community',
  'education_content',
  'health_fitness_food',
  'media_creator',
  'real_estate_property',
  'advanced_ai_mixed',
];

describe('domain-registry: pack catalog', () => {
  it('contains all 12 domains', () => {
    const ids = DOMAIN_PACKS.map((pack) => pack.id).sort();
    expect(ids).toEqual([...EXPECTED_DOMAIN_IDS].sort());
  });

  it('every domain has the required pack shape', () => {
    for (const pack of DOMAIN_PACKS) {
      expect(pack.title.length).toBeGreaterThan(0);
      expect(pack.summary.length).toBeGreaterThan(0);
      expect(pack.signals.length).toBeGreaterThanOrEqual(5);
      expect(pack.typicalActors.length).toBeGreaterThanOrEqual(2);
      expect(pack.typicalEntities.length).toBeGreaterThanOrEqual(3);
      expect(pack.expectedPages.length).toBeGreaterThanOrEqual(3);
      expect(pack.expectedApiRoutes.length).toBeGreaterThanOrEqual(3);
      expect(pack.expectedDbTables.length).toBeGreaterThanOrEqual(3);
      expect(pack.frontendPatterns.length).toBeGreaterThanOrEqual(2);
      expect(pack.backendPatterns.length).toBeGreaterThanOrEqual(2);
      expect(pack.requiredCapabilities.length).toBeGreaterThanOrEqual(2);
      expect(pack.verificationJourneys.length).toBeGreaterThanOrEqual(2);
      expect(pack.commonFailures.length).toBeGreaterThanOrEqual(2);
      expect(pack.antiGenericWarnings.length).toBeGreaterThanOrEqual(2);
      expect(pack.requiredCapabilities).toContain('deployment_render');
    }
  });

  it('listDomainPacks returns the full list', () => {
    expect(listDomainPacks().map((pack) => pack.id).sort()).toEqual([...EXPECTED_DOMAIN_IDS].sort());
  });

  it('getDomainPack resolves by id', () => {
    expect(getDomainPack('ecommerce_store')?.title).toBe('Ecommerce Store');
    expect(getDomainPack('local_service_booking')?.title).toBe('Local Service Booking');
    expect(getDomainPack('not_a_real_domain')).toBeNull();
  });

  it('normalizeDomainId accepts kebab / mixed case', () => {
    expect(normalizeDomainId('ecommerce_store')).toBe('ecommerce_store');
    expect(normalizeDomainId('Ecommerce_Store')).toBe('ecommerce_store');
    expect(normalizeDomainId('real-estate-property')).toBe('real_estate_property');
    expect(normalizeDomainId('not_real')).toBeNull();
  });
});

describe('domain-registry: matchDomainApp', () => {
  it('matches ecommerce signals', () => {
    const matches = matchDomainApp({
      title: 'Build a coffee bean storefront with cart and checkout',
      description: 'Customers browse products, add to cart, pay with Stripe',
    });
    expect(matches[0]?.id).toBe('ecommerce_store');
  });

  it('matches booking signals', () => {
    const matches = matchDomainApp({
      title: 'Salon appointment booking app',
      description: 'Customers see available time slots and book a haircut',
    });
    expect(matches[0]?.id).toBe('local_service_booking');
  });

  it('matches business website + CRM signals', () => {
    const matches = matchDomainApp({
      title: 'Consultancy website with lead capture',
      description: 'Public marketing pages with a contact form that feeds an internal CRM pipeline',
    });
    expect(matches[0]?.id).toBe('business_website_crm');
  });

  it('matches inventory ops signals', () => {
    const matches = matchDomainApp({
      title: 'Warehouse inventory system',
      description: 'Track items, stock movements, low-stock alerts, and CSV imports',
    });
    expect(matches[0]?.id).toBe('inventory_operations');
  });

  it('matches construction ops signals', () => {
    const matches = matchDomainApp({
      title: 'Construction project tracker',
      description: 'Manage projects, bids, schedules, safety logs, and equipment',
    });
    expect(matches[0]?.id).toBe('construction_operations');
  });

  it('matches finance dashboard signals', () => {
    const matches = matchDomainApp({
      title: 'Crypto portfolio dashboard',
      description: 'Track holdings, price alerts, transaction history',
    });
    expect(matches[0]?.id).toBe('finance_crypto');
  });

  it('matches social community signals', () => {
    const matches = matchDomainApp({
      title: 'Community forum',
      description: 'Profiles, posts, comments, moderation queue, feed',
    });
    expect(matches[0]?.id).toBe('social_community');
  });

  it('matches education / LMS signals', () => {
    const matches = matchDomainApp({
      title: 'Online course platform',
      description: 'Instructors create courses with lessons, students enroll and track progress',
    });
    expect(matches[0]?.id).toBe('education_content');
  });

  it('matches health / fitness signals', () => {
    const matches = matchDomainApp({
      title: 'Fitness meal-plan tracker',
      description: 'Daily workout and meal plans with progress logs',
    });
    expect(matches[0]?.id).toBe('health_fitness_food');
  });

  it('matches media / creator signals', () => {
    const matches = matchDomainApp({
      title: 'Creator portfolio with gated media',
      description: 'Photographer uploads gallery and offers gated premium content to subscribers',
    });
    expect(matches[0]?.id).toBe('media_creator');
  });

  it('matches real estate signals', () => {
    const matches = matchDomainApp({
      title: 'Property listings for rental homes',
      description: 'Buyers filter listings, agents create listings, admins approve',
    });
    expect(matches[0]?.id).toBe('real_estate_property');
  });

  it('matches advanced AI workflow signals', () => {
    const matches = matchDomainApp({
      title: 'Document analysis RAG pipeline',
      description: 'Users upload PDFs, embeddings indexed, results stored, retry from background job',
    });
    expect(matches[0]?.id).toBe('advanced_ai_mixed');
  });

  it('does not drift existing-app extension into ecommerce or health domains from generic wording', () => {
    const matches = matchDomainApp({
      title: 'Existing app extension',
      description: 'An existing deployed NoteKeeper app needs billing, RAG document search, and an admin dashboard added without replacing the existing product.',
      existingCodebaseMap: 'Routes: /, /api/health, /api/canary-existing-health. Existing product has customer notes CRUD.',
    }, 6);

    const ids = matches.map((match) => match.id);
    expect(ids).toContain('advanced_ai_mixed');
    expect(ids).not.toContain('ecommerce_store');
    expect(ids).not.toContain('health_fitness_food');
  });

  it('keeps a dominant booking domain from absorbing canary/tool boilerplate', () => {
    const matches = matchDomainApp({
      title: 'CANARY booking-scheduling-app: Booking scheduling app',
      description: [
        'A booking app with availability slots, appointment reservation scheduling, booking creation, duplicate-book prevention, and separate customer/admin views.',
        'Mandatory planning: call the Engineering agent tools, write a final report, and verify POST routes.',
        'Run browser UI checks, DB checks, codebase map, and Render canary evidence.',
        'The prompt mentions RAG/vector/queue only as platform verification boilerplate, not product requirements.',
      ].join('\n'),
    });

    expect(matches.map((match) => match.id)).toEqual(['local_service_booking']);
  });

  it('returns empty for noise input', () => {
    const matches = matchDomainApp({
      title: '',
      description: '',
    });
    expect(matches).toEqual([]);
  });

  it('different prompts produce different domains (category-neutrality smoke)', () => {
    const ecommerce = matchDomainApp({ title: 'Sell handcrafted soap online', description: 'Cart, checkout, orders' })[0]?.id;
    const booking = matchDomainApp({ title: 'Yoga class booking', description: 'Slot picker, appointment confirmation' })[0]?.id;
    const social = matchDomainApp({ title: 'Photography critique community', description: 'Posts, comments, reactions, follow feed' })[0]?.id;
    expect(new Set([ecommerce, booking, social]).size).toBe(3);
  });

  it('hasClearDomainSignals true for clear task', () => {
    expect(hasClearDomainSignals({
      title: 'Online clothing store with cart and checkout',
      description: 'Customers buy products and pay via Stripe',
    })).toBe(true);
  });

  it('hasClearDomainSignals false for generic CRUD', () => {
    expect(hasClearDomainSignals({
      title: 'Add /healthz endpoint',
      description: 'Return ok 200',
    })).toBe(false);
  });
});

describe('domain-registry: formatters', () => {
  it('formatDomainMatches handles empty', () => {
    expect(formatDomainMatches([])).toMatch(/No domain matches/);
  });

  it('formatDomainPack returns multi-section text', () => {
    const pack = getDomainPack('ecommerce_store')!;
    const formatted = formatDomainPack(pack);
    expect(formatted).toContain('Domain: ecommerce_store');
    expect(formatted).toContain('Frontend patterns');
    expect(formatted).toContain('Backend patterns');
    expect(formatted).toContain('Anti-generic warnings');
    expect(formatted).toContain('Verification journeys');
  });
});
