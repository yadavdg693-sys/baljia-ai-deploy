import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {},
  companies: {
    id: 'id',
    name: 'name',
    slug: 'slug',
    github_repo: 'github_repo',
    neon_database_id: 'neon_database_id',
    render_service_id: 'render_service_id',
    custom_domain: 'custom_domain',
  },
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

import {
  browserActionCandidateIssues,
  isRepoEmptyEnoughToHydrate,
  isRepoHydratedForNextSkeleton,
  resolveFounderAppInstanceTargets,
} from './engineering.tools';

describe('founder app instance planning', () => {
  it('reuses the onboarding canonical repo and database instead of deriving a suffixed repo', () => {
    const targets = resolveFounderAppInstanceTargets({
      name: 'CareerOps',
      slug: 'careerops',
      github_repo: 'BALAJIapps/careerops',
      neon_database_id: 'gentle-poetry-95693709',
      render_service_id: null,
      custom_domain: null,
    }, 'BALAJIapps');

    expect(targets.repoFullName).toBe('BALAJIapps/careerops');
    expect(targets.repoName).toBe('careerops');
    expect(targets.canonicalRepoFullName).toBe('BALAJIapps/careerops');
    expect(targets.repoStatus).toBe('reused');
    expect(targets.dbStatus).toBe('reused');
    expect(targets.renderStatus).toBe('missing');
    expect(targets.canonicalUrl).toBe('https://careerops.baljia.app');
  });

  it('uses the canonical slug repo when onboarding has not saved a repo yet', () => {
    const targets = resolveFounderAppInstanceTargets({
      name: 'CareerOps',
      slug: 'careerops',
      github_repo: null,
      neon_database_id: null,
      render_service_id: null,
      custom_domain: null,
    }, 'BALAJIapps');

    expect(targets.repoFullName).toBe('BALAJIapps/careerops');
    expect(targets.repoName).toBe('careerops');
    expect(targets.repoStatus).toBe('missing');
    expect(targets.dbStatus).toBe('missing');
  });

  it('recognizes empty onboarding repos as safe to hydrate', () => {
    expect(isRepoEmptyEnoughToHydrate(['README.md'])).toBe(true);
    expect(isRepoEmptyEnoughToHydrate(['README.md', '.gitignore'])).toBe(true);
    expect(isRepoEmptyEnoughToHydrate(['README.md', 'package.json'])).toBe(false);
  });

  it('recognizes an existing Next skeleton repo', () => {
    expect(isRepoHydratedForNextSkeleton(['app', 'components', 'db', 'lib', 'package.json', 'next.config.ts'])).toBe(true);
    expect(isRepoHydratedForNextSkeleton(['README.md'])).toBe(false);
  });
});

describe('browser required action semantics', () => {
  it('accepts navigation links with href as live required actions', () => {
    expect(browserActionCandidateIssues({
      text: 'Get started',
      href: '/sign-up',
      disabled: false,
    })).toEqual([]);
  });

  it('does not require href on submit buttons', () => {
    expect(browserActionCandidateIssues({
      text: 'Create account',
      href: null,
      disabled: false,
      tagName: 'button',
      type: 'submit',
    })).toEqual([]);
  });

  it('still flags disabled and placeholder actions', () => {
    expect(browserActionCandidateIssues({
      text: 'Upload resume - coming soon',
      href: null,
      disabled: true,
      tagName: 'button',
    })).toContain('Upload resume - coming soon: disabled');

    expect(browserActionCandidateIssues({
      text: 'Get started',
      href: '#',
      disabled: false,
      tagName: 'a',
    })).toContain('Get started: dead href');
  });
});
