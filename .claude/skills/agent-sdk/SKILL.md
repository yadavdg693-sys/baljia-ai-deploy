# Skill: AI features inside founder apps (Claude Agent SDK + Codex)

**READ THIS BEFORE adding any LLM call, AI-powered feature, agent loop, or
prompt-template logic to a founder app.**

## Why this skill exists

Polsia made `agent-sdk` mandatory because LLM integration has a long list
of stack-specific gotchas the LLM's training data papers over. On Workers
specifically: SDK transport selection, OAuth vs API key auth, streaming
limits, timeout behavior, and tool-use response parsing all break in
non-obvious ways if you copy a generic example off the web.

## Status: scaffold (full content TBD)

The full contents of this skill — code patterns, anti-patterns, working
examples, auth strategies — are not yet written here. For now, when the
engineering agent reads this skill it will see this scaffold and know
to surface that the AI integration is being attempted without a fully
documented playbook. Treat that as a signal: pause, ask for guidance,
or default to the safest path (Anthropic SDK + ANTHROPIC_API_KEY via
additional_secrets, with a 25-second timeout to fit the Workers CPU
limit).

## What this skill WILL cover (when filled in)

- **Provider selection** — when to use Claude vs OpenAI Codex vs Gemini
  vs OpenRouter from a founder app, and which one the operator's OAuth
  already covers
- **Auth patterns**:
  - Anthropic API key (`sk-ant-...`) vs Claude Code OAuth (`sk-ant-oat...`)
    and the identity-prefix requirement on the latter (see
    `src/lib/anthropic-oauth.ts` for the platform-side reference impl)
  - OpenAI direct vs Codex JWT routing (see `src/lib/agents/ceo/ceo.agent.ts`
    for the Codex JWT detection + routing pattern)
  - Passing keys via `additional_secrets` on `cf_deploy_app` — never
    hardcoding in `script_content`
- **Workers-specific transports**:
  - Anthropic SDK: `dangerouslyAllowBrowser: true` is REQUIRED for
    OAuth tokens (the SDK refuses bearer auth in server contexts otherwise)
  - OpenAI SDK works on Workers with default transport — no custom http client needed
  - Gemini: `additionalProperties` in tool schemas is rejected (recursive
    sanitization required — see `sanitizeForGemini` in agent-factory.ts)
- **Streaming vs single-shot**: when each is appropriate, and how to
  respect the 30s CPU limit on Workers (long streams are fine if data is
  flowing; CPU only counts blocking work)
- **Tool use loops**: how to structure agent loops that fit Workers'
  per-request budget; when to break work into separate requests
- **Cost guardrails**: how to budget tokens per founder request, surface
  cost back to the founder app's UI, hard-stop at a per-request ceiling
- **Memory + context**: stateless Workers vs the founder's need for
  conversation history (use Neon DB; don't try to keep state in Worker globals)

## When to read which skill alongside this one

- Always also read `cloudflare-workers` (runtime constraints)
- If persisting messages/transcripts → also read `neon-postgres`
- If the AI generates large outputs (images, files) → also read `r2-storage`
- If the AI sends notifications → also read `email-postmark`

## Verification

When this skill is fully populated, verification will mean:
1. Token budget per request is enforced (test with a forced loop, confirm hard-stop)
2. Auth fallback chain works (test with one provider deliberately broken)
3. Streaming responses don't blow the 30s CPU budget (test with a deliberately long completion)
4. Tool-use parsing handles partial/malformed responses (test with a deliberately broken tool name)

Until then: if the agent is about to add AI features, surface the gap in
its task report so a human reviews the choice of provider, auth method,
and timeout posture.
