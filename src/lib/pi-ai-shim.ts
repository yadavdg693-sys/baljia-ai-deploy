// Pi-AI import shim — swallows pi-ai's floating top-level dynamic-import
// rejections so they don't surface as `unhandledRejection`.
//
// CONTEXT
// `@mariozechner/pi-ai`'s `env-api-keys.js` and
// `providers/openai-codex-responses.js` do at module-eval time:
//
//   const dynamicImport = (s) => import(s);
//   dynamicImport("node:" + "fs").then(m => { _existsSync = m.existsSync; });
//   dynamicImport("node:" + "os").then(m => { _homedir = m.homedir; });
//   dynamicImport("node:" + "path").then(m => { _join = m.join; });
//
// These are floating promises with NO `.catch()`. When pi-ai loads in:
//   - Cloudflare Workers (workerd): `node:fs` is partially shimmed by
//     `nodejs_compat` but the string-concat dynamic-import path is fragile.
//   - Next.js bundling contexts (RSC, edge tries, Sentry instrumentation):
//     dynamic-import-by-string can be rewritten or fail depending on target.
//   - Any sandbox without those builtins.
//
// Failure → unhandledRejection ("Cannot find module 'node:fs'") → in CF
// Workers this can crash the request; in Node it pollutes the process and
// shows up in onboarding pipeline runs because pi-ai is imported lazily by
// `llm-provider.ts` whenever the platform makes a Codex/OpenAI call.
//
// FIX
// Install a one-time, narrow `unhandledRejection` filter that swallows ONLY
// the pi-ai bootstrap rejections, then re-export `import('@mariozechner/pi-ai')`.
// Every site that touches pi-ai should go through `loadPiAi` / `loadPiAiOAuth`
// in this module instead of importing pi-ai directly.

const guardState = globalThis as typeof globalThis & {
  __baljiaPiAiUnhandledRejectionGuardInstalled?: boolean;
};

let installed = guardState.__baljiaPiAiUnhandledRejectionGuardInstalled === true;

function shouldSwallow(reason: unknown): boolean {
  if (!reason) return false;
  const msg =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : '';
  if (!msg) return false;
  // Match the exact shape thrown by Node/workerd module resolvers.
  return (
    msg.includes("Cannot find module 'node:fs'") ||
    msg.includes("Cannot find module 'node:fs/promises'") ||
    msg.includes("Cannot find module 'node:os'") ||
    msg.includes("Cannot find module 'node:path'")
  );
}

function installGuard(): void {
  if (installed || guardState.__baljiaPiAiUnhandledRejectionGuardInstalled) return;
  installed = true;
  guardState.__baljiaPiAiUnhandledRejectionGuardInstalled = true;

  // Node — `process.on('unhandledRejection')`.
  if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('unhandledRejection', (reason) => {
      if (shouldSwallow(reason)) {
        // Intentionally swallow: pi-ai bootstrap probe for Vertex ADC creds
        // races on missing Node builtins; the module gracefully no-ops if the
        // dynamic import never resolves, so the rejection is benign.
        return;
      }
      // Re-throw on the next tick so other handlers (Sentry, default Node
      // behavior) still see real bugs.
      setTimeout(() => {
        throw reason;
      }, 0);
    });
  }

  // Browsers / workerd — `addEventListener('unhandledrejection')`.
  const g = globalThis as { addEventListener?: (type: string, fn: (e: Event & { reason?: unknown; preventDefault?: () => void }) => void) => void };
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (event) => {
      if (shouldSwallow(event.reason)) {
        event.preventDefault?.();
      }
    });
  }
}

// Eagerly install at module-load, before any pi-ai code runs. The first
// `import` of this shim from `llm-provider.ts` / `codex-oauth.ts` mounts the
// guard; subsequent calls are no-ops.
installGuard();

export async function loadPiAi(): Promise<typeof import('@mariozechner/pi-ai')> {
  return import('@mariozechner/pi-ai');
}

export async function loadPiAiOAuth(): Promise<typeof import('@mariozechner/pi-ai/oauth')> {
  return import('@mariozechner/pi-ai/oauth');
}
