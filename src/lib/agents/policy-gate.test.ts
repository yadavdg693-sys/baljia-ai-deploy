import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({}));

import { checkToolPolicy, withPolicyGate } from './policy-gate';
import type { Task } from '@/types';

const TASK = { id: 't1', company_id: 'c1', tag: 'engineering' } as Task;

describe('policy-gate — allow paths', () => {
  it('allows tool calls outside the rule set', () => {
    expect(checkToolPolicy('check_url_health', { url: 'https://x.com' }, TASK)).toEqual({ allowed: true });
  });

  it('allows render_delete_service when confirm:true', () => {
    expect(checkToolPolicy('render_delete_service', { service_id: 'srv-1', confirm: true }, TASK).allowed).toBe(true);
  });

  it('allows run_migration with a benign CREATE TABLE', () => {
    expect(checkToolPolicy('run_migration', { sql: 'CREATE TABLE users (id uuid PRIMARY KEY)' }, TASK).allowed).toBe(true);
  });

  it('allows benign multi-statement run_migration SQL', () => {
    const sql = 'CREATE TABLE lessons (id uuid PRIMARY KEY); CREATE INDEX lessons_id_idx ON lessons(id);';
    expect(checkToolPolicy('run_migration', { sql }, TASK).allowed).toBe(true);
  });

  it('allows query_company_db with a SELECT', () => {
    expect(checkToolPolicy('query_company_db', { sql: "SELECT id FROM users WHERE email = 'x@y.z'" }, TASK).allowed).toBe(true);
  });

  it('allows DELETE in run_migration when WHERE clause is present', () => {
    expect(checkToolPolicy('run_migration', { sql: "DELETE FROM stale_rows WHERE created_at < '2020-01-01'" }, TASK).allowed).toBe(true);
  });
});

describe('policy-gate — block paths', () => {
  it('blocks render_delete_service without confirm', () => {
    const r = checkToolPolicy('render_delete_service', { service_id: 'srv-1' }, TASK);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/confirm/i);
  });

  it('blocks DROP TABLE in run_migration', () => {
    const r = checkToolPolicy('run_migration', { sql: 'DROP TABLE users' }, TASK);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/DROP/i);
  });

  it('blocks destructive SQL embedded in a multi-statement migration', () => {
    const r = checkToolPolicy('run_migration', { sql: 'CREATE TABLE users (id uuid); DROP TABLE users;' }, TASK);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/DROP/i);
  });

  it('blocks DROP DATABASE in run_migration', () => {
    expect(checkToolPolicy('run_migration', { sql: 'drop database x' }, TASK).allowed).toBe(false);
  });

  it('blocks TRUNCATE in run_migration', () => {
    expect(checkToolPolicy('run_migration', { sql: 'TRUNCATE users' }, TASK).allowed).toBe(false);
  });

  it('blocks unconditional DELETE in run_migration', () => {
    const r = checkToolPolicy('run_migration', { sql: 'DELETE FROM users' }, TASK);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/WHERE clause/i);
  });

  it('blocks query_company_db with INSERT', () => {
    const r = checkToolPolicy('query_company_db', { sql: "INSERT INTO users (email) VALUES ('x')" }, TASK);
    expect(r.allowed).toBe(false);
  });

  it('blocks query_company_db with multiple statements', () => {
    expect(checkToolPolicy('query_company_db', { sql: 'SELECT 1; SELECT 2' }, TASK).allowed).toBe(false);
  });

  it('blocks github_delete_file without confirm', () => {
    expect(checkToolPolicy('github_delete_file', { path: 'src/foo.ts' }, TASK).allowed).toBe(false);
  });

  it('blocks github_delete_file on framework files even with confirm', () => {
    const r = checkToolPolicy('github_delete_file', { path: 'server.js', confirm: true }, TASK);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/framework/i);
  });

  it('allows github_delete_file on a non-framework path with confirm', () => {
    expect(checkToolPolicy('github_delete_file', { path: 'src/foo.ts', confirm: true }, TASK).allowed).toBe(true);
  });

  it('blocks force-push via github_create_commit force:true', () => {
    expect(checkToolPolicy('github_create_commit', { repo: 'x/y', message: 'm', files: [], force: true }, TASK).allowed).toBe(false);
  });
});

describe('policy-gate — withPolicyGate wrapper', () => {
  it('returns BLOCKED message when policy denies', async () => {
    const dispatch = vi.fn(async () => 'should not run');
    const result = await withPolicyGate('render_delete_service', { service_id: 'x' }, TASK, dispatch);
    expect(result).toMatch(/^BLOCKED/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('runs dispatch and returns its result when policy allows', async () => {
    const dispatch = vi.fn(async () => 'ok');
    const result = await withPolicyGate('check_url_health', { url: 'https://x.com' }, TASK, dispatch);
    expect(result).toBe('ok');
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
