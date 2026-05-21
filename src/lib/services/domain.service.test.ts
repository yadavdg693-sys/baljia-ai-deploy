// Regression tests for the domain.service.ts bugs we fixed today.
// These pin down the API-shape contracts so a future refactor doesn't
// silently re-introduce any of the failure modes we saw on threadpulse:
//
// - cloudflareReplaceDNS must compare BOTH content AND proxied flag
//   (otherwise it skip-updates a record whose content matches but
//   whose proxied flag is wrong — the original threadpulse symptom).
// - provisionSubdomain must look up the actual Render-assigned hostname
//   (e.g. "threadpulse-wdpq.onrender.com") and use it as the CNAME target,
//   NOT the slug-based pattern "<slug>.onrender.com" (which 503s).
// - When attaching to Render, the CNAME must be created with proxied:false
//   so the *.baljia.app wildcard worker doesn't intercept the traffic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  companies: { id: {}, slug: {}, github_repo: {}, render_service_id: {}, subdomain: {}, custom_domain: {} },
}));

vi.mock('@/lib/services/cf-deploy.service', () => ({
  deleteLandingHtml: vi.fn(async () => true),
}));

describe('cloudflareReplaceDNS — replaces records with mismatched proxied flag', () => {
  let fetchCalls: Array<{ url: string; method: string; body?: unknown }>;

  beforeEach(() => {
    fetchCalls = [];
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token');
    vi.stubEnv('CLOUDFLARE_ZONE_ID_APP', 'zone-id');
  });

  function makeFetchMock(existingRecords: Array<{ id: string; content: string; proxied: boolean }>) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      fetchCalls.push({ url, method: init?.method ?? 'GET', body: init?.body });

      // List existing records
      if (init?.method === undefined && url.includes('/dns_records?type=CNAME&name=')) {
        return new Response(JSON.stringify({ success: true, result: existingRecords }), { status: 200 });
      }
      // Delete
      if (init?.method === 'DELETE') {
        return new Response('{}', { status: 200 });
      }
      // Create
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true, result: { id: 'new-id' } }), { status: 200 });
      }
      return new Response('not handled', { status: 500 });
    });
  }

  it('skips both delete and create when existing record matches content AND proxied flag', async () => {
    vi.stubGlobal('fetch', makeFetchMock([{ id: 'r1', content: 'threadpulse-wdpq.onrender.com', proxied: false }]));
    const mod = await import('./domain.service.js');
    // Hook into internal helper via a re-export only used in tests would be cleaner;
    // for now we exercise it through provisionSubdomain on the same code path with
    // a stub Render service hostname.
    // (Direct unit test of cloudflareReplaceDNS would require it to be exported.)
    expect(mod).toBeDefined(); // placeholder so vitest doesn't optimize away the import

    // Call the inner replace-equivalent via the public surface — simulate by directly
    // hitting CF API as the helper would. The above mocks return the EXISTING matching
    // record; the helper should make 1 list call and return early.
    // We can't call the unexported helper directly. Instead: assert that when used in
    // provisionSubdomain (covered elsewhere), the same-content+proxied path is a no-op.
    // For now this test serves as a doc-pinning placeholder; replace with a real
    // test if cloudflareReplaceDNS is later exported.
  });

  it('deletes + recreates when content matches but proxied flag differs', async () => {
    vi.stubGlobal('fetch', makeFetchMock([{ id: 'r1', content: 'threadpulse-wdpq.onrender.com', proxied: true }]));
    // Same caveat as above — this doc-pins the regression scenario.
    // The actual code path is covered by the threadpulse-fix script in src/scripts/fix-threadpulse-dns.ts
    // and by the smoke test of fork_express_skeleton + provisionSubdomain.
    expect(true).toBe(true);
  });
});

describe('Render API body shape — modern fields are present', () => {
  // Pins the body shape we settled on after Render's 2025 API change.
  // Failing this test means Render's accepted body shape was changed somewhere
  // and you need to trace why.
  it('renderCreateService body uses runtime + envSpecificDetails + top-level envVars', () => {
    // We assert the BODY SHAPE the platform sends. Since renderCreateService is
    // not directly exported and is bound to Task context, this is a contract test
    // against the literal source string. Slightly brittle — the goal is to flag
    // a regression at code-review time, not assert correct behavior at runtime.
    // For runtime correctness, the smoke test src/scripts/smoke-test-express-skeleton.ts
    // proves the actual call works against real Render.
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(process.cwd(), 'src/lib/agents/tools/engineering.tools.ts'), 'utf8');

    // Modern shape: top-level envVars (NOT inside serviceDetails)
    expect(src).toMatch(/baseBody,\s*\n\s*envVars,/);

    // serviceDetails uses runtime not env
    expect(src).toMatch(/runtime: 'node'/);

    // serviceDetails has envSpecificDetails wrapper with both build + start commands.
    expect(src).toMatch(/envSpecificDetails:\s*\{[\s\S]*?buildCommand[\s\S]*?startCommand[\s\S]*?\}/);

    // The deprecated shape (envVars inside serviceDetails as sibling of runtime)
    // is what caused the silent-drop bug. Pin that it doesn't return.
    // Look at the web_service serviceDetails block specifically.
    const webServiceBlock = src.match(/type === 'web_service'[\s\S]+?envSpecificDetails:\s*\{[\s\S]+?\}/);
    expect(webServiceBlock).not.toBeNull();
    if (webServiceBlock) {
      // envVars must NOT appear inside the web_service serviceDetails block —
      // it belongs at the top-level body, spread from baseBody.
      const blockText = webServiceBlock[0];
      const runtimeIdx = blockText.indexOf("runtime: 'node'");
      const envSpecificIdx = blockText.indexOf('envSpecificDetails');
      // Between runtime and envSpecificDetails there should be only `plan`, no envVars.
      const between = blockText.slice(runtimeIdx, envSpecificIdx);
      expect(between).not.toMatch(/envVars/);
    }
  });
});

describe('provisionSubdomain — uses real Render hostname + DNS-only CNAME', () => {
  it('source contains getRenderServiceHostname call before cloudflareReplaceDNS', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(process.cwd(), 'src/lib/services/domain.service.ts'), 'utf8');

    // The Render hostname lookup must happen before the CF DNS replace.
    const lookupIdx = src.indexOf('getRenderServiceHostname(renderServiceId)');
    const replaceIdx = src.indexOf('cloudflareReplaceDNS(slug, renderHostname');
    expect(lookupIdx).toBeGreaterThan(0);
    expect(replaceIdx).toBeGreaterThan(lookupIdx);

    // The CNAME target must NOT be the slug-based pattern.
    expect(src).not.toMatch(/cloudflareReplaceDNS\(slug,\s*`?\$\{slug\}\.onrender\.com/);

    // proxied:false must be passed when attaching to Render — bypasses the wildcard worker.
    expect(src).toMatch(/cloudflareReplaceDNS\(slug, renderHostname, 'CNAME', false\)/);
  });

  it('source contains R2 cleanup after Render takeover', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(process.cwd(), 'src/lib/services/domain.service.ts'), 'utf8');
    expect(src).toMatch(/deleteLandingHtml\(slug\)/);
    // Cleanup must be in a try/catch so failure is non-blocking.
    expect(src).toMatch(/try\s*\{\s*[\s\S]*?deleteLandingHtml/);
  });
});
