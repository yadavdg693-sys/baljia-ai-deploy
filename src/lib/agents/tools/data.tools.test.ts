// Unit tests for the 3 new Data agent convenience helpers:
//   - get_service_status (combines Render service info + URL health into one verdict)
//   - list_company_services (filters Render account list to this company)
//   - get_preview_url (one-shot live URL extraction)
//
// Mocks @/lib/db (companies row), drizzle-orm, @/lib/logger, and the engineering
// handler that the Data tools delegate to.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock chains ─────────────────────────────────────────────────────────
const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
};
selectChain.from.mockReturnValue(selectChain);
selectChain.where.mockReturnValue(selectChain);
selectChain.limit.mockResolvedValue([]);

vi.mock('@/lib/db', () => ({
  db: { select: vi.fn(() => selectChain) },
  companies: {
    id: 'id',
    name: 'name',
    render_service_id: 'render_service_id',
    subdomain: 'subdomain',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Engineering handler mock — the Data tools delegate Render queries to it.
const mockHandleEngineeringTool = vi.fn();
vi.mock('./engineering.tools', () => ({
  handleEngineeringTool: (...args: unknown[]) => mockHandleEngineeringTool(...args),
}));

function makeTask() {
  return { id: 'task-1', company_id: 'company-1' } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([]);
});

describe('get_service_status', () => {
  it('reports DOWN when no Render service is provisioned', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: null, subdomain: null }]);
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('get_service_status', {}, makeTask());
    expect(result).toContain('DOWN');
    expect(result).toContain('no Render service provisioned yet');
  });

  it('reports OK when Render service is healthy and URL returns 200', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: 'srv-123', subdomain: 'acme' }]);
    mockHandleEngineeringTool
      .mockResolvedValueOnce('Service: srv-123\nURL: https://acme.onrender.com\nStatus: live')
      .mockResolvedValueOnce('Health check: 200 OK\nResponse time: 120ms');
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('get_service_status', {}, makeTask());
    expect(result).toContain('Service Status: OK');
    expect(result).toContain('https://acme.onrender.com');
    expect(mockHandleEngineeringTool).toHaveBeenNthCalledWith(1, 'render_get_service', { service_id: 'srv-123' }, expect.anything());
    expect(mockHandleEngineeringTool).toHaveBeenNthCalledWith(2, 'check_url_health', { url: 'https://acme.onrender.com' }, expect.anything());
  });

  it('reports DOWN when URL health check returns 5xx', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: 'srv-123', subdomain: 'acme' }]);
    mockHandleEngineeringTool
      .mockResolvedValueOnce('URL: https://acme.onrender.com')
      .mockResolvedValueOnce('Health check: 503 Service Unavailable');
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('get_service_status', {}, makeTask());
    expect(result).toContain('Service Status: DOWN');
  });

  it('honors an explicit service_id input over the company default', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: 'srv-default', subdomain: 'acme' }]);
    mockHandleEngineeringTool
      .mockResolvedValueOnce('URL: https://other.onrender.com')
      .mockResolvedValueOnce('200 OK');
    const { handleDataTool } = await import('./data.tools');
    await handleDataTool('get_service_status', { service_id: 'srv-override' }, makeTask());
    expect(mockHandleEngineeringTool).toHaveBeenNthCalledWith(1, 'render_get_service', { service_id: 'srv-override' }, expect.anything());
  });
});

describe('list_company_services', () => {
  it('reports empty when no service is provisioned', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: null }]);
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('list_company_services', {}, makeTask());
    expect(result).toContain('no Render services provisioned yet');
  });

  it('returns only the lines matching this company\'s service ID', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: 'srv-acme' }]);
    mockHandleEngineeringTool.mockResolvedValueOnce(
      [
        '- srv-other-1 | other-app | web | https://other-1.onrender.com',
        '- srv-acme   | acme      | web | https://acme.onrender.com',
        '- srv-other-2 | another  | static | https://other-2.onrender.com',
      ].join('\n'),
    );
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('list_company_services', {}, makeTask());
    expect(result).toContain('Acme — Render services');
    expect(result).toContain('srv-acme');
    expect(result).not.toContain('srv-other-1');
    expect(result).not.toContain('srv-other-2');
  });

  it('falls back gracefully when company service is missing from Render account list', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: 'srv-missing' }]);
    mockHandleEngineeringTool.mockResolvedValueOnce('- srv-other | other | web | https://other.onrender.com');
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('list_company_services', {}, makeTask());
    expect(result).toContain('not found in account list');
  });
});

describe('get_preview_url', () => {
  it('returns "no live URL" when no Render service is provisioned', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: null, subdomain: null }]);
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('get_preview_url', {}, makeTask());
    expect(result).toContain('no live URL');
    expect(result).toContain('Render service not provisioned yet');
  });

  it('extracts the URL from the engineering service response', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: 'srv-123', subdomain: 'acme' }]);
    mockHandleEngineeringTool.mockResolvedValueOnce('Service info\nURL: https://acme.onrender.com\nOther stuff');
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('get_preview_url', {}, makeTask());
    expect(result).toContain('Acme — live URL: https://acme.onrender.com');
  });

  it('handles the case where service info has no URL yet (still deploying)', async () => {
    selectChain.limit.mockResolvedValueOnce([{ name: 'Acme', render_service_id: 'srv-123', subdomain: 'acme' }]);
    mockHandleEngineeringTool.mockResolvedValueOnce('Service exists but still deploying');
    const { handleDataTool } = await import('./data.tools');
    const result = await handleDataTool('get_preview_url', {}, makeTask());
    expect(result).toContain('still be deploying');
  });
});
