---
name: debug-deployed-app
description: Use when verify_user_journey returns FAIL or any post-deploy check shows the app is broken. Codifies a tight diagnose → fix → redeploy → re-verify loop so the engineering agent does not hand off to remediation when the failure is fixable in the same run.
---

# debug-deployed-app

## When to invoke this skill

The deploy succeeded (`render_get_deploy_status` returned `live`) but **something downstream failed**:

- `verify_user_journey` returned `JOURNEY FAIL` on any step
- `check_url_health` showed a 5xx on a route you expected to work
- `verify_db_state` showed the row didn't land
- `render_get_logs` showed `level=error` / `level=fatal` lines

If the deploy itself failed (status != live), this is not the right skill — fix the deploy first.

## Why this exists

The default failure path today is: agent declares the task done → verifier rejects → remediation creates a NEW task → that task starts from scratch with no context. That wastes credits and fragments the agent's mental model. Most journey failures are surface-fixable in one or two commits — fix them HERE, in the same run, before declaring done.

## The 8-step debug ritual

Run these in order. Stop when the journey passes. Don't skip steps.

### 1. Read the runtime logs

```
render_get_logs(service_id: <your service id>, log_type: 'service', num_lines: 100)
```

Look for, in this priority order:
- `level=fatal` / `level=error` — the actual server error
- Stack traces — the file + line that crashed
- `ECONNREFUSED` / `ETIMEDOUT` — integration failures (DB, Stripe, Postmark)
- Postgres SQLSTATE codes (`23505` unique violation, `42P01` undefined table, `28P01` auth failure, etc.)
- "Cannot find module" — a require/import for a package that wasn't installed
- "permission denied" — DB user lacks privilege

If logs are clean (no errors), the bug is **client-visible only** (wrong response shape, missing field, incorrect redirect). Skip to step 2.

### 2. Hit the failing endpoint with `http_fetch_full`

```
http_fetch_full(url: 'https://<slug>.baljia.app/api/posts', method: 'POST', body: '{"title":"x"}', headers: {'Content-Type': 'application/json'})
```

Returns FULL response: status, headers, body. This is the difference between "200 returned" and "200 returned with `{ok:false, error:'invalid_input'}` body" — the second is a real failure that `check_url_health` would call PASS.

For redirect routes: response includes the `location` header so you can verify it points where you expect.

For session-required routes: include the cookie from a prior journey step in `headers.Cookie`.

### 3. Check known issues for this failure shape

```
read_known_issues(context: 'HTTP <status> on <path>')
```

Examples:
- `read_known_issues(context: 'HTTP 500 on /auth/register')` — has anyone hit this before?
- `read_known_issues(context: 'session cookie not set after login')` — likely the trust-proxy bug
- `read_known_issues(context: 'Render envvars empty in app boot logs')` — likely the envvars-shape bug

If `[FIXED]` returns with relevant `fix_notes` — apply that fix. Don't reinvent.

### 4. Read the suspected source file

```
github_read_file(path: 'server.js')   # or routes/posts.js, etc.
```

Identify the EXACT lines responsible for the failure. Don't speculate — read the code.

For middleware-related bugs (sessions, auth, CSRF): read both the middleware setup (top of server.js) AND the failing handler.

For DB-related bugs: read the handler AND the relevant schema in `db/schema.sql`.

### 5. Diff actual vs expected

Write down (in your own reasoning, not as a tool call) the one specific change that would make the journey pass.

Examples:
- "The handler reads `req.body.email` but the journey sent `email` as a form field with `Content-Type: application/x-www-form-urlencoded`. Need `app.use(express.urlencoded(...))` BEFORE this route."
- "The redirect target is `/dashboard` but the route is registered as `/dash`. Change one of them."
- "The INSERT uses `users(email, passwordHash)` but the table has `password_hash`. Rename the column reference."

If you can't articulate the specific one-line change, you don't understand the bug yet. Go back to step 1, re-read logs, OR add a `console.log` (then remove it before final commit).

### 6. Apply the fix in one focused commit

```
github_create_commit(
  files: [{ path: 'server.js', content: '<full file contents with fix applied>' }],
  message: 'fix: <one-line description of the change>'
)
```

Make ONE focused change per commit. Don't bundle "fix the redirect" with "tweak the styling" — when this fix doesn't work (it won't always), small commits are easier to revert.

If the fix touches multiple files (e.g., schema migration + handler), include all in one atomic commit — but keep the change scope narrow.

### 7. Redeploy

```
render_deploy(service_id: <your service id>)
render_get_deploy_status(service_id: <your service id>, max_wait_seconds: 600)
```

Wait until status=live. If the deploy itself fails, read deploy logs (`render_get_logs(log_type: 'deploy')`) and go back to step 1.

### 8. Re-run the failing journey

```
verify_user_journey(journey_name: <same as before>, base_url: <same>, steps: <same>)
```

If `JOURNEY PASS` — done. Move to declaring the task complete.

If `JOURNEY FAIL` on the SAME step with the SAME error → step 1, your fix didn't address the root cause.

If `JOURNEY FAIL` on a DIFFERENT step → you broke something else. Apply this skill again on the new failure.

## Stop conditions

- Journey passes → done.
- Cost budget < 20% remaining → write what you've learned to a report, hand off to remediation. Don't keep iterating with no budget.
- Same step fails 3 times after 3 different fixes → the failure mode is outside what you can fix in this run (likely an infrastructure or 3rd-party issue). Hand off to remediation with detailed notes on what you tried.

## What this skill is NOT for

- Debugging the original deploy not going live → use `render_get_logs(log_type: 'deploy')` and the standard deploy troubleshooting flow.
- Building a new feature → this skill is reactive (fixing what broke), not proactive (designing what to add).
- Hunting for non-failing latent bugs → only use when verify_user_journey or check_url_health surfaced a concrete failure.
