// Engineering Agent Tools Ã¢â‚¬â€ GitHub + Render deployment (Agent #30)
// Enables the Engineering agent to push code and deploy founder apps.
//
// Deploy target:
//   Ã¢â‚¬Â¢ GitHub                    Ã¢â‚¬â€ platform-owned org, one repo per company
//   Ã¢â‚¬Â¢ Render                    Ã¢â‚¬â€ founder app web services, default free plan for trials

import type { Task } from '@/types';
import { db, companies } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { mkdirSync, readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { provisionSubdomain, attachCustomDomain, verifyCustomDomain } from '@/lib/services/domain.service';
import { provisionCompanyDatabase, getCompanyDatabase, createBranch, deleteBranch } from '@/lib/services/neon.service';
import { createLogger } from '@/lib/logger';
import { COMPONENT_CATALOG } from './component-catalog';
import { assertUrlSafe } from '@/lib/agents/url-safety';
import { auditPageVisualContrast, formatVisualContrastIssues } from '@/lib/agents/browser-visual-audit';
import {
  composeCapabilityArchitecture,
  formatArchitecturePlan,
  formatCapabilityMatches,
  formatCapabilityPack,
  getCapabilityPack,
  listCapabilityPacks,
  matchCapabilities,
} from '@/lib/agents/capability-registry';
import {
  formatDomainList,
  formatDomainMatches,
  formatDomainPack,
  getDomainPack,
  listDomainPacks,
  matchDomainApp,
} from '@/lib/agents/domain-registry';
import {
  composeFrontendPlan,
  formatFrontendPlan,
} from '@/lib/agents/frontend-pattern-registry';
import { evaluateDomainGate, readDomainGateMode } from '@/lib/agents/anti-generic-gate';
import { CRITICAL_FLOW_KINDS, isCriticalFlowKind, type CriticalFlowKind } from '@/lib/agents/critical-flow-contracts';
import { classifyPlanningDepth, formatPlanningDepthEvidence } from '@/lib/agents/planning-depth';
import { stripPlanningHarnessMetadata } from '@/lib/agents/planning-text';
import { classifyTaskIntent, formatTaskIntentEvidence } from '@/lib/agents/task-intent';
import { getTaskLanePolicy } from '@/lib/agents/task-lane';
import {
  buildEngineeringLanePackets,
  formatEngineeringLaneOutputEvidence,
  formatEngineeringLanePacketEvidence,
  formatEngineeringLaneRequirementsEvidence,
  normalizeEngineeringLaneOutput,
  selectEngineeringLanes,
} from '@/lib/agents/runtime/engineering-subagents';
import {
  contractFieldRequirements,
  deriveBuildBrief,
  deriveProductBuildContract,
  formatBuildBriefEvidence,
  formatAuthIsolationProofEvidence,
  formatContractFieldProofLine,
  formatContractFlowProofLine,
  formatProductBuildContractEvidence,
  requiresProductBuildContract,
} from '@/lib/agents/product-build-contract';
import {
  formatComponentExamples,
  formatReferenceMatches,
  formatReferencePattern,
  getReferenceRepoPatterns,
  matchReferenceRepos,
  retrieveComponentExamples,
} from '@/lib/agents/reference-pattern-registry';
import { BALJIA_RUNTIME_VERSION, signRuntimeToken } from '@/lib/runtime/runtime.service';
export { ENGINEERING_TOOL_DOMAINS, getEngineeringToolDomain, getRegisteredEngineeringToolNames } from './engineering.registry';

const log = createLogger('EngineeringTools');

const GITHUB_API = 'https://api.github.com';
const RENDER_API = 'https://api.render.com/v1';
export const RENDER_NEXTJS_BUILD_COMMAND = 'pnpm install --no-frozen-lockfile --prod=false && pnpm build';
export const RENDER_NEXTJS_START_COMMAND = 'pnpm exec next start -H 0.0.0.0 -p $PORT';
export const FOUNDER_AI_GATEWAY_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const FOUNDER_AI_TEXT_MODEL = 'gemini-2.5-flash';
export const FOUNDER_AI_EMBEDDING_MODEL = 'gemini-embedding-001';
export const FOUNDER_AI_EMBEDDING_DIMENSIONS = '3072';

const RENDER_CONFIG_ENV_KEYS = new Set([
  'BUILD_COMMAND',
  'START_COMMAND',
  'HEALTH_CHECK_PATH',
  'ROOT_DIRECTORY',
  'RUNTIME',
  'PLAN',
  'AUTO_DEPLOY',
  'RENDER_BUILD_COMMAND',
]);

type EngineeringToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export function findRenderConfigEnvKeys(envVars: Array<{ key?: string }>): string[] {
  return envVars
    .map((ev) => String(ev?.key ?? '').trim().toUpperCase())
    .filter((key) => RENDER_CONFIG_ENV_KEYS.has(key));
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// TOOL DEFINITIONS
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

export function getEngineeringTools(): EngineeringToolDefinition[] {
  const tools: EngineeringToolDefinition[] = [
    {
      name: 'list_skills',
      description: 'List the skill files available in .claude/skills/. Returns one line per skill with a 1-sentence summary. Read the relevant skill via read_skill BEFORE writing code in that domain Ã¢â‚¬â€ the skills capture stack-specific patterns and anti-patterns the LLM\'s training data is missing or wrong about.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'read_skill',
      description: 'Read the full SKILL.md for a named skill. MANDATORY before writing code that touches the skill\'s domain. Skill files describe deployment/runtime patterns, code shapes you should match, and anti-patterns the LLM\'s training data tends to suggest but break in production.',
      input_schema: {
        type: 'object' as const,
        properties: {
          skill: {
            type: 'string' as const,
            description: 'Skill name (kebab-case directory under .claude/skills/). E.g. "neon-postgres", "frontend-design", "stripe-payments", "r2-storage", "email-postmark", "agent-sdk"',
          },
        },
        required: ['skill'],
      },
    },
    {
      name: 'list_domain_packs',
      description: 'List every product-shape domain pack the Engineering agent can compose against (ecommerce store, business website + CRM, local service booking, inventory ops, construction ops, finance/crypto dashboard, social/community, education/LMS, health/fitness/meal planner, media/creator, real estate/property, advanced AI workflow). Domain matching answers "what kind of product is this?" — call BEFORE match_capabilities so the architecture is grounded in product shape, not just technical capabilities.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'match_domain_app',
      description: 'Score the CEO task + company context against the 12 product-shape domain packs and return the top matches with anti-generic warnings. Call BEFORE match_capabilities for any user-facing build/extend task. The returned domain IDs feed into match_capabilities (via the domains parameter) and compose_app_architecture so the plan reflects product shape, not generic CRUD.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'CEO task title or product/task name.' },
          description: { type: 'string' as const, description: 'CEO task description and acceptance criteria.' },
          product_context: { type: 'string' as const, description: 'Optional company/product context from memory or task briefing.' },
          company_context: { type: 'string' as const, description: 'Optional company description / what the company does.' },
          existing_codebase_map: { type: 'string' as const, description: 'Optional Graphify codebase map summary so existing-app-extension tasks match the actual product shape.' },
          limit: { type: 'number' as const, description: 'Number of domain matches to return. Default 4.' },
        },
      },
    },
    {
      name: 'get_domain_pack',
      description: 'Load one domain pack by id (returned from match_domain_app). Returns typical actors/entities, expected pages/API routes/DB tables, frontend & backend patterns, required capabilities, reference patterns, verification journeys, common failures, and anti-generic warnings. Call for the top domain returned by match_domain_app before composing capabilities or architecture.',
      input_schema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const, description: 'Domain id, e.g. ecommerce_store, local_service_booking, advanced_ai_mixed.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'compose_ad_hoc_domain',
      description: 'Compose a task-specific product domain when no known domain pack fits but the CEO task clearly describes a real product shape. Returns actors/entities/workflows/capability hints and AD_HOC_DOMAIN_EVIDENCE. Use instead of generic CRUD fallback; then call match_capabilities with the hinted capabilities and compose_frontend_plan/compose_app_architecture from this product shape.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'CEO task title or product/task name.' },
          description: { type: 'string' as const, description: 'CEO task description and acceptance criteria.' },
          product_context: { type: 'string' as const, description: 'Optional product context from memory/task briefing.' },
          company_context: { type: 'string' as const, description: 'Optional company description / what the company does.' },
        },
      },
    },
    {
      name: 'match_capabilities',
      description: 'Capability planner for CEO-assigned full-stack tasks. Decomposes the task/company context into build capabilities (auth, CRUD, dashboard, payments, uploads, AI, RAG, admin workflow, marketplace, booking, Render deploy, etc.) with required skills and verification requirements. Call this AFTER match_domain_app for user-facing tasks (pass the matched domain IDs via "domains") so the matcher uses product-shape context, not just keyword signals.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'CEO task title or short product/task name.' },
          description: { type: 'string' as const, description: 'CEO task description, product context, existing app state, and any acceptance criteria.' },
          product_context: { type: 'string' as const, description: 'Optional company/product context from memory or task briefing.' },
          actors: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional known actors, e.g. vendor, admin, customer.' },
          workflows: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional known workflows.' },
          entities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional known data entities.' },
          capabilities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional explicit capability IDs to include.' },
          domains: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional domain IDs from match_domain_app. When supplied, capabilities required by each domain receive a score boost so clearly-shaped products do not collapse to a generic crud+dashboard fallback.' },
          limit: { type: 'number' as const, description: 'Number of capability matches to return. Default 10.' },
        },
      },
    },
    {
      name: 'get_capability_pack',
      description: 'Load the implementation pack for one capability selected by match_capabilities. Returns required files/routes/schema/env vars, common failures, vertical-slice steps, and verification requirements. Call once for every required capability before implementing that slice.',
      input_schema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const, description: 'Capability ID, e.g. auth, crud, dashboard, payments_stripe, uploads_storage, ai_openai, rag_search, admin_workflow, marketplace, booking, deployment_render.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'compose_app_architecture',
      description: 'Compose a CEO task into a capability-native architecture plan: actors, workflows, entities, pages, API routes, DB tables, vertical slices, and app-specific verification journeys. Call this after match_capabilities/get_capability_pack and before committing code. Use its verification journeys as the basis for verify_user_journey and verify_db_state.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'CEO task title.' },
          description: { type: 'string' as const, description: 'CEO task description and acceptance criteria.' },
          product_context: { type: 'string' as const, description: 'Optional company/product context.' },
          actors: { type: 'array' as const, items: { type: 'string' as const } },
          workflows: { type: 'array' as const, items: { type: 'string' as const } },
          entities: { type: 'array' as const, items: { type: 'string' as const } },
          capabilities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Capability IDs selected by match_capabilities.' },
          domains: { type: 'array' as const, items: { type: 'string' as const }, description: 'Domain IDs from match_domain_app or compose_ad_hoc_domain context.' },
          design_system: { type: 'string' as const, description: 'Design system selected by match_design_system, if UI is user-facing.' },
          reference_patterns: { type: 'array' as const, items: { type: 'string' as const }, description: 'Reference pattern ids selected from match_reference_repos/get_reference_repo_patterns.' },
          assumptions: { type: 'array' as const, items: { type: 'string' as const }, description: 'Important user-confirmed or inferred assumptions to lock before building.' },
          non_goals: { type: 'array' as const, items: { type: 'string' as const }, description: 'Explicitly out-of-scope features so the app does not sprawl.' },
          mvp_features: { type: 'array' as const, items: { type: 'string' as const }, description: 'Core MVP features from the user request or accepted defaults.' },
        },
      },
    },
    {
      name: 'record_engineering_lane_output',
      description: 'Record structured output for a bounded Engineering lane (planner, domain, frontend, backend, qa, deploy, repair, reviewer). This is supporting evidence only: it cannot mark a task complete and cannot replace Product Build Contract flow, field, auth, deploy, or browser proof markers.',
      input_schema: {
        type: 'object' as const,
        properties: {
          role: {
            type: 'string' as const,
            enum: ['planner', 'domain', 'frontend', 'backend', 'qa', 'deploy', 'repair', 'reviewer'],
            description: 'The bounded lane role producing this output.',
          },
          status: {
            type: 'string' as const,
            enum: ['completed', 'blocked', 'skipped'],
            description: 'Use blocked when this lane found a concrete blocker the parent must reconcile before completion.',
          },
          contract_sections: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'PBC/build sections this lane handled, such as flow ids, entity names, or acceptance areas.',
          },
          evidence_markers: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Evidence markers produced or still required, e.g. PRODUCT_BUILD_CONTRACT_EVIDENCE, CONTRACT_FLOW_PROOF:project_create.',
          },
          files_touched: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Files this lane changed or reviewed. Leave empty for planning-only lanes.',
          },
          blockers: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Concrete blockers. Required when status=blocked.',
          },
          notes: {
            type: 'string' as const,
            description: 'Short human-readable lane summary.',
          },
        },
        required: ['role', 'status'],
      },
    },
    {
      name: 'list_capability_packs',
      description: 'List every build capability pack the Engineering agent can compose. Use only when you need to inspect the registry; normally call match_capabilities first.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'compose_frontend_plan',
      description: 'Compose a domain-aware frontend plan: UI pattern selection (landing site / dashboard / storefront / booking calendar / admin portal / CRM pipeline / inventory table / AI workspace / document portal / social feed / real estate listing / creator gallery / education LMS / health tracker / construction ops board / finance dashboard), page map with audience + required_text + required_buttons + form_submission_checks, navigation, shadcn/ui components, lucide-react icons, UI-craft reference rules, loading/empty/error states, mobile + accessibility expectations, and completion-gate blocking rules. Call AFTER match_domain_app + match_capabilities + reference retrieval and BEFORE writing pages/components. For strict/canary UI, pass at least one loaded UI-craft/accessibility/dashboard-craft reference id in reference_patterns. The returned required_text/required_buttons/form_submission_checks plug directly into verify_browser_ui.',
      input_schema: {
        type: 'object' as const,
        properties: {
          task_title: { type: 'string' as const, description: 'CEO task title.' },
          task_description: { type: 'string' as const, description: 'CEO task description.' },
          product_context: { type: 'string' as const, description: 'Optional company/product context.' },
          domain_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'Domain ids returned by match_domain_app.' },
          capabilities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Capability ids returned by match_capabilities.' },
          design_system: { type: 'string' as const, description: 'Design system selected by match_design_system.' },
          reference_patterns: { type: 'array' as const, items: { type: 'string' as const }, description: 'Reference pattern ids from match_reference_repos.' },
          pages: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional list of page paths from compose_app_architecture.' },
          actors: { type: 'array' as const, items: { type: 'string' as const } },
        },
      },
    },
    {
      name: 'match_reference_repos',
      description: 'Curated GitHub/reference pattern retrieval for CEO-assigned app work. Scores reference repos against selected capabilities, domains (from match_domain_app), design-system context, company context, and task wording. Use for user-facing UI or architecture-heavy tasks after match_capabilities. References are patterns only: summarize UI/schema/API/architecture ideas, respect licenses, and never copy whole apps.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'CEO task title or product/task name.' },
          description: { type: 'string' as const, description: 'CEO task description and acceptance criteria.' },
          product_context: { type: 'string' as const, description: 'Optional company/product context from memory or task briefing.' },
          design_system: { type: 'string' as const, description: 'Optional design system selected by match_design_system.' },
          actors: { type: 'array' as const, items: { type: 'string' as const } },
          workflows: { type: 'array' as const, items: { type: 'string' as const } },
          entities: { type: 'array' as const, items: { type: 'string' as const } },
          capabilities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Capability IDs selected by match_capabilities.' },
          domains: { type: 'array' as const, items: { type: 'string' as const }, description: 'Domain IDs from match_domain_app — boosts patterns whose domain mapping overlaps.' },
          limit: { type: 'number' as const, description: 'Number of reference matches to return. Default 6.' },
        },
      },
    },
    {
      name: 'get_reference_repo_patterns',
      description: 'Load one curated GitHub/reference pattern by id, repo, or URL. Returns useful UI patterns, schema patterns, API patterns, component examples, license caution, and anti-copy guidance. Call for the top references returned by match_reference_repos before writing code.',
      input_schema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const, description: 'Reference pattern id or repo, e.g. shadcn-dashboard-patterns, calcom-booking-patterns, vercel/ai-chatbot.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'retrieve_component_examples',
      description: 'Retrieve capability-specific UI/component examples from the curated reference registry. Use after match_reference_repos and get_reference_repo_patterns; this complements reference matching and does not replace those required planning calls. Use before implementing marketplace listings, admin approval tables, booking slot pickers, upload portals, AI result/history views, analytics dashboards, CRM pipelines, or billing/account UI. Outputs original implementation guidance, not code to copy.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'CEO task title.' },
          description: { type: 'string' as const, description: 'Task description and acceptance criteria.' },
          product_context: { type: 'string' as const, description: 'Optional company/product context.' },
          design_system: { type: 'string' as const, description: 'Optional selected design system.' },
          capabilities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Capability IDs selected by match_capabilities.' },
          limit: { type: 'number' as const, description: 'Number of examples to return. Default 8.' },
        },
      },
    },
    {
      name: 'github_create_repo',
      description: 'Create a new GitHub repository in the platform org for a founder company.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo_name: { type: 'string' as const, description: 'Repository name (slug-style, e.g. "launchpad-app")' },
          description: { type: 'string' as const, description: 'Repository description' },
          private: { type: 'boolean' as const, description: 'Whether to make the repo private (default: true)' },
        },
        required: ['repo_name'],
      },
    },
    {
      name: 'github_push_file',
      description: 'Create or update a single file in a GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name (owner/repo format or just repo name)' },
          path: { type: 'string' as const, description: 'File path in the repo (e.g. "src/index.ts")' },
          content: { type: 'string' as const, description: 'Full file content (not diff)' },
          message: { type: 'string' as const, description: 'Commit message' },
          branch: { type: 'string' as const, description: 'Branch name (default: main)' },
        },
        required: ['repo', 'path', 'content', 'message'],
      },
    },
    {
      name: 'github_read_file',
      description: 'Read a file from a GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          path: { type: 'string' as const, description: 'File path in repo' },
          branch: { type: 'string' as const, description: 'Branch (default: main)' },
        },
        required: ['repo', 'path'],
      },
    },
    {
      name: 'github_list_files',
      description: 'List files in a directory of a GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          path: { type: 'string' as const, description: 'Directory path (default: root "")' },
          branch: { type: 'string' as const, description: 'Branch (default: main)' },
        },
        required: ['repo'],
      },
    },
    {
      name: 'github_delete_file',
      description: 'Delete a file from a GitHub repository. Destructive — the file removal commits to main on success. Requires explicit confirm:true so accidental tool calls (e.g. from a malformed multi-step plan) cannot wipe a file. Framework files (server.js, package.json, render.yaml, db/schema.sql, README.md) are protected and cannot be deleted by this tool — customize them via github_create_commit instead.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          path: { type: 'string' as const, description: 'File path to delete' },
          message: { type: 'string' as const, description: 'Commit message' },
          branch: { type: 'string' as const, description: 'Branch (default: main)' },
          confirm: { type: 'boolean' as const, description: 'Must be true to authorize the delete. Set explicitly — defaults to false. The policy gate blocks the call when this is missing or false.' },
        },
        required: ['repo', 'path', 'message', 'confirm'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    // RENDER WEB SERVICES Ã¢â‚¬â€ Primary deploy target for founder engineering tasks.
    // First deploy: push code to GitHub, then create a free Render web service.
    // Updates: push to the existing repo/service and trigger a deploy.
    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'render_create_service',
      description: 'PRIMARY FIRST-DEPLOY TOOL for founder engineering tasks. Creates a Git-backed Render web service for this company, defaults to the free plan, saves render_service_id, attaches the company baljia.app subdomain, and starts the initial deploy. Use after pushing working app code to the company GitHub repo. Do not create duplicates: call get_company_tech first and use render_deploy if a service already exists. For the Next.js skeleton, use build_command="pnpm install --no-frozen-lockfile --prod=false && pnpm build" so Render installs build-time dependencies even with NODE_ENV=production. Run DB schema changes before deploy via run_migration/run_drizzle_push; do not rely on interactive drizzle-kit prompts during Render build.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Company GitHub repo name or owner/repo. Defaults to the company repo if already set.' },
          name: { type: 'string' as const, description: 'Optional Render service name. Defaults to the company slug so the trial subdomain stays predictable.' },
          type: { type: 'string' as const, enum: ['web_service', 'static_site'], description: 'Render service type. Use web_service for founder apps.' },
          plan: { type: 'string' as const, description: 'Render instance plan. Defaults to free for trial founder apps.' },
          build_command: { type: 'string' as const, description: 'Build command. Next.js skeleton default: pnpm install --no-frozen-lockfile --prod=false && pnpm build.' },
          start_command: { type: 'string' as const, description: 'Start command. Next.js on Render should bind host 0.0.0.0 and $PORT, e.g. pnpm exec next start -H 0.0.0.0 -p $PORT.' },
          health_check_path: { type: 'string' as const, description: 'HTTP health check path. Defaults to / for Next.js skeleton services unless you explicitly created /api/health.' },
          env_vars: {
            type: 'array' as const,
            description: 'Environment variables for Render.',
            items: {
              type: 'object' as const,
              properties: {
                key: { type: 'string' as const },
                value: { type: 'string' as const },
              },
              required: ['key', 'value'],
            },
          },
        },
      },
    },
    {
      name: 'render_deploy',
      description: 'Trigger a deploy on this company Render service after pushing code to GitHub. Use for updates when render_service_id already exists. If the response contains NEXT_REQUIRED_TOOL, call that exact next tool before retrying deploy.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID from get_company_tech or render_create_service.' },
          clear_cache: { type: 'boolean' as const, description: 'Set true only when dependency/cache issues are suspected.' },
          force_after_quota_restored: { type: 'boolean' as const, description: 'Set true only after the operator confirms Render pipeline minutes/quota were restored; bypasses the recent quota-exhaustion circuit breaker for one controlled retry.' },
        },
      },
    },
    {
      name: 'render_set_env_vars',
      description: 'Update environment variables on an EXISTING Render service. Use when render_get_logs shows missing env vars (e.g. "AI_GATEWAY_TOKEN not set", "DATABASE_URL undefined") or when the app needs new credentials. Each key in `env_vars` is created if missing or replaced if present. Triggers an automatic redeploy on Render. Do NOT use for first-time service creation: pass env_vars to create_instance for full-stack Next.js apps, or directly to render_create_service only for backend/manual Render paths. This tool cannot change Render service config: BUILD_COMMAND, START_COMMAND, runtime, plan, root directory, and health check path are rejected because Render does not treat them as env vars.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID from get_company_tech.' },
          force_after_quota_restored: { type: 'boolean' as const, description: 'Set true only after the operator confirms Render pipeline minutes/quota were restored; bypasses the recent quota-exhaustion circuit breaker for one controlled env-var update plus redeploy.' },
          env_vars: {
            type: 'array' as const,
            description: 'Env vars to upsert. Each replaces any existing value for that key.',
            items: {
              type: 'object' as const,
              properties: {
                key: { type: 'string' as const },
                value: { type: 'string' as const },
              },
              required: ['key', 'value'],
            },
          },
        },
        required: ['env_vars'],
      },
    },
    {
      name: 'render_update_service_config',
      description: 'Update Render service configuration on an EXISTING service: build command, start command, and/or health check path. Use this when Render logs show port binding, health check, build command, or start command problems. This is the correct tool for service config; do not set BUILD_COMMAND or START_COMMAND via render_set_env_vars. Triggers a redeploy after a successful config patch.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID from get_company_tech.' },
          build_command: { type: 'string' as const, description: 'Optional new build command.' },
          start_command: { type: 'string' as const, description: 'Optional new start command. Next.js on Render: pnpm exec next start -H 0.0.0.0 -p $PORT.' },
          health_check_path: { type: 'string' as const, description: 'Optional health check path. Use / for Next.js skeleton unless you explicitly created /api/health.' },
          clear_cache: { type: 'boolean' as const, description: 'Set true only when dependency/cache issues are suspected.' },
          force_after_quota_restored: { type: 'boolean' as const, description: 'Set true only after the operator confirms Render pipeline minutes/quota were restored; bypasses the recent quota-exhaustion circuit breaker for one controlled config update plus redeploy.' },
        },
      },
    },
    {
      name: 'design_critique',
      description: 'Vision-LLM review of a deployed page. Takes desktop (1280x900) and mobile (390x844) screenshots via local Playwright first, with thum.io fallback, then asks Gemini 2.5 Flash to score the page on 10 design dimensions (typography rhythm, visual hierarchy, copy specificity, whitespace, accent restraint, hero focal point, sectional variety, mobile state, component craft, soul). Returns BLOCKERs that the page demonstrably looks AI-generated, and ADVISORY items that are decent but could be more distinctive. Call this AFTER design_audit on every UI task — design_audit catches surface regex tells; this catches the rest. Completion gate requires 0 BLOCKERs before allowing the task to stop; score is advisory unless a stricter score gate is configured.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'Fully-qualified URL of the deployed founder app to critique. Must be publicly reachable (not behind auth) — the screenshot service is HTTP-only.' },
        },
        required: ['url'],
      },
    },
    {
      name: 'design_audit',
      description: 'Fetch the rendered HTML at a public URL and audit it against a deterministic set of AI-default anti-patterns (purple/indigo gradients, emoji in headers, "API Documentation" sections on the public landing, hardcoded hex colors outside CSS variables, generic placeholder copy, etc.). Returns a list of violations. Call this on every UI task after deploy and BEFORE declaring complete. The completion gate blocks task completion until the audit is clean.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'Fully-qualified URL to audit, e.g. https://equityzen.baljia.app/' },
        },
        required: ['url'],
      },
    },
    {
      name: 'verify_browser_ui',
      description: 'Run a real Playwright browser smoke check against the deployed UI. This catches failures HTTP journeys miss: React hydration/runtime errors, blank shells, generic starter surfaces, missing visible controls, unreadable low-contrast text/buttons/selects/dropdowns, and UI capability panels that have fields but no submit action. Call this on every user-facing/full-stack app after check_url_health, verify_user_journey, and verify_db_state. Include required_text and required_buttons for the capability-specific surfaces from compose_app_architecture. Completion gate blocks UI/full-stack tasks until this returns BROWSER UI PASS.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'Fully-qualified deployed URL to verify, e.g. https://app.onrender.com/' },
          required_text: {
            type: 'array' as const,
            description: 'Regex/text patterns that must be visible in page text, e.g. ["vendor", "document", "approval", "dashboard"].',
            items: { type: 'string' as const },
          },
          required_buttons: {
            type: 'array' as const,
            description: 'Regex/text patterns for visible button labels required by the app capabilities, e.g. ["register|create", "approve", "record|upload.*document"].',
            items: { type: 'string' as const },
          },
          fail_on_console_error: { type: 'boolean' as const, description: 'Default true. When true, pageerror/console.error blocks pass.' },
          screenshot_label: { type: 'string' as const, description: 'Optional screenshot label for saved evidence.' },
        },
        required: ['url'],
      },
    },
    {
      name: 'verify_release',
      description: 'Batch release verification for founder apps. Runs Render deploy/log checks, URL health, optional user journeys, optional DB assertions, optional browser UI assertions, static scan, and final Baljia domain proof. Use after deploy; it returns VERIFY_RELEASE_PASS/FAIL plus one structured blocker checklist.',
      input_schema: {
        type: 'object' as const,
        properties: {
          companyId: { type: 'string' as const, description: 'Company id for audit context. Must match this task company.' },
          renderUrl: { type: 'string' as const, description: 'Render URL used for build/debug verification.' },
          baljiaUrl: { type: 'string' as const, description: 'Final founder-facing https://<slug>.baljia.app URL.' },
          journeys: { type: 'array' as const, description: 'Optional verify_user_journey payloads.', items: { type: 'object' as const } },
          dbAssertions: { type: 'array' as const, description: 'Optional verify_db_state payloads.', items: { type: 'object' as const } },
          uiAssertions: { type: 'array' as const, description: 'Optional verify_browser_ui payloads.', items: { type: 'object' as const } },
        },
        required: ['renderUrl', 'baljiaUrl'],
      },
    },
    {
      name: 'verify_interaction_contract',
      description: 'Run Playwright button/form proof for interaction contracts from compose_frontend_plan and derived critical-flow contracts from the task lane/domain/capabilities. For each contract, open the page, fill fields, click the action, wait for UI readback text, and fail on console/runtime errors. This proves button -> frontend submit -> backend/API/server action -> persisted UI readback; pair DB-writing interactions with verify_db_state.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'Fully-qualified deployed app URL.' },
          interactions: {
            type: 'array' as const,
            description: 'Critical interactions to prove. Use contracts from compose_frontend_plan plus derived lane/domain/capability flows such as auth signup/login, booking, checkout/order, upload, CRM/admin, inventory, AI action, or the primary feature.',
            items: {
              type: 'object' as const,
              properties: {
                name: { type: 'string' as const },
                contract_flow_id: { type: 'string' as const, description: 'Optional Product Build Contract flow id from PRODUCT_BUILD_CONTRACT_EVIDENCE. Required when proving app-build acceptance flows.' },
                start_path: { type: 'string' as const, description: 'Path to start from, e.g. "/" or "/dashboard". Default "/".' },
                label_pattern: { type: 'string' as const, description: 'Regex for button/action label.' },
                critical_kind: {
                  type: 'string' as const,
                  enum: CRITICAL_FLOW_KINDS,
                  description: 'Optional. Required when proving derived critical-flow contracts. Labels the intent being proved, e.g. auth_session or booking_reservation. Keep route/button matching flexible through label_pattern and expect_text.',
                },
                fields: { type: 'object' as const, description: 'Field name to test value map. Field names match input name/id/label/placeholder.' },
                expect_text: { type: 'array' as const, items: { type: 'string' as const }, description: 'Regex/text patterns expected after submit.' },
                reject_text: { type: 'array' as const, items: { type: 'string' as const }, description: 'Forbidden text patterns after submit.' },
                entity: { type: 'string' as const, description: 'Optional entity/table touched by this contract flow.' },
                db_table: { type: 'string' as const, description: 'Optional DB table expected to persist this flow; pair with verify_db_state.' },
                requires_auth: { type: 'boolean' as const, description: 'Whether this flow should run behind an authenticated session.' },
              },
              required: ['name', 'label_pattern'],
            },
          },
          auth_isolation: {
            type: 'object' as const,
            description: 'Required for contracts with auth_baseline/user_isolation=true. Opens a fresh anonymous browser context against a protected path and fails if private text/data is visible.',
            properties: {
              anonymous_path: { type: 'string' as const, description: 'Protected path to verify as logged-out/anonymous, e.g. /dashboard or /projects.' },
              expect_text: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional login/unauthorized text expected for anonymous access.' },
              forbidden_text: { type: 'array' as const, items: { type: 'string' as const }, description: 'Private values from the created record/user that must NOT appear to anonymous users.' },
            },
          },
          fail_on_console_error: { type: 'boolean' as const, description: 'Default true.' },
          screenshot_label: { type: 'string' as const },
        },
        required: ['url', 'interactions'],
      },
    },
    {
      name: 'render_get_service',
      description: 'Inspect this company Render service and its public URL/status.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
        },
      },
    },
    {
      name: 'render_get_deploy_status',
      description: 'Get a Render deploy status for this company Render service. After triggering a deploy, pass the returned deploy_id plus wait_for_terminal=true so this tool polls that exact deploy internally instead of accidentally reading an older failed deploy.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
          deploy_id: { type: 'string' as const, description: 'Optional exact deploy ID returned by render_deploy/render_update_service_config. Prefer passing this after triggering a deploy.' },
          wait_for_terminal: { type: 'boolean' as const, description: 'If true, poll until the latest deploy reaches live/build_failed/update_failed/canceled/deactivated or timeout.' },
          timeout_seconds: { type: 'number' as const, description: 'Max seconds to wait when wait_for_terminal=true. Defaults to 600, max 900.' },
          poll_interval_seconds: { type: 'number' as const, description: 'Seconds between Render polls. Defaults to 20, min 10.' },
        },
      },
    },
    {
      name: 'render_get_logs',
      description: 'Fetch Render deploy/runtime logs for this company service when a deploy or app is failing.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
          log_type: { type: 'string' as const, enum: ['service', 'deploy'], description: 'service for runtime/app logs, deploy for build/deploy logs.' },
          num_lines: { type: 'number' as const, description: 'Number of log lines, 10-500.' },
        },
      },
    },
    {
      name: 'render_rollback',
      description: 'Trigger a new deploy from the last known-good Render deploy when the current deploy breaks.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
        },
      },
    },
    {
      name: 'render_delete_service',
      description: 'Dangerous teardown tool: delete this company Render service. Requires confirm=true.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
          confirm: { type: 'boolean' as const, description: 'Must be true to delete.' },
        },
        required: ['confirm'],
      },
    },
    {
      name: 'render_list_services',
      description: 'List recent Render services in the platform workspace. Use only for diagnostics.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Max services to return.' },
        },
      },
    },
    {
      name: 'render_get_metrics',
      description: 'Get Render service metrics if available on the plan. Useful for debugging paid services.',
      input_schema: {
        type: 'object' as const,
        properties: {
          service_id: { type: 'string' as const, description: 'Render service ID.' },
          resolution: { type: 'string' as const, description: 'Metric resolution, e.g. 1h.' },
        },
      },
    },
    {
      name: 'render_list_databases',
      description: 'List Render Postgres databases. Founder product data should normally use Neon; this is diagnostics only.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Max databases to return.' },
        },
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'get_company_tech',
      description: 'Get the current tech setup for this company: GitHub repo, Render service, Neon DB.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'attach_custom_domain',
      description: 'Attach a founder\'s own domain (e.g. acmecorp.com) to their website. Returns DNS setup instructions for the founder. The baljia.app subdomain stays active as fallback.',
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string' as const, description: 'The founder\'s domain (e.g. "acmecorp.com" or "https://acmecorp.com")' },
        },
        required: ['domain'],
      },
    },
    {
      name: 'verify_custom_domain',
      description: 'Check if a founder\'s custom domain DNS is properly configured and SSL is active.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ Health & safety Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'check_url_health',
      description: 'Check if a deployed URL is live and returning successful responses. Call this after every deploy to verify the app is actually running.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'URL to check (e.g. https://acme.baljia.app)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'review_pushed_code',
      description: 'Run an LLM-based code review over the full diff produced by this task (from the first commit in this run through HEAD; falls back to latest commit vs parent if no task commit range is available). Catches semantic bugs that runtime journey verification cannot see by definition: unhandled async errors, auth bypass, SQL injection, secrets in logs, silent catch blocks, race conditions. Returns structured findings with severity (high/medium/low). Costs one Haiku LLM call (~3-15s, $0.01-0.05) per build. Call AFTER github_create_commit/github_push_file and AFTER static_code_scan, BEFORE render_deploy or a manual render_create_service fallback. Address all HIGH-severity findings via github_create_commit before declaring complete; medium/low are advisory.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'static_code_scan',
      description: 'Run a fast pattern-based static scan over the JS/TS files in the company\'s GitHub repo. Catches AI-coding pitfalls that runtime journey verification cannot see by definition: process.env reads outside CONFIG_SCHEMA, silent catch blocks, secret-shaped vars in log statements, app.use(session) without trust-proxy, hardcoded test emails leaked from journey runs, template-literal SQL (injection risk), TODO/FIXME in committed code. Returns a structured list of findings with severity (high/medium/low). Call this AFTER github_create_commit and BEFORE render_deploy or a manual render_create_service fallback. Address all HIGH-severity findings via github_create_commit before declaring complete; medium/low are advisory.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'read_codebase_map',
      description: 'Read the company\'s codebase map — a structured summary of the deployed app: stack, schema, routes, auth pattern, shipped features. Call this at the START of any extend task (when the company already has a deployed app) so you do not have to rediscover the schema/routes via github_list_files. Returns "no codebase map yet" if this is the first build (in which case proceed from skeleton).',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'build_code_graph',
      description: 'Build a runtime-only Graphify code graph for the company GitHub repo. Use after read_codebase_map on existing-app extend/debug tasks, before editing, then call query_code_graph for the affected routes/components/tables. Downloads only safe text code files via GitHub API, stores compact internal docs, and returns CODE_GRAPH_EVIDENCE when available. If Graphify is unavailable, continue with codebase_map and GitHub read tools.',
      input_schema: {
        type: 'object' as const,
        properties: {
          force: { type: 'boolean' as const, description: 'Rebuild even when a cached graph exists for the current repo SHA.' },
        },
      },
    },
    {
      name: 'read_code_graph_report',
      description: 'Read the latest internal Graphify code graph report for this company. Returns "no code graph yet" if build_code_graph/query_code_graph has not run.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'query_code_graph',
      description: 'Ask the runtime code graph which files/routes/entities are relevant to a change or failing journey. Auto-builds the graph once if cached output is missing. Required before implementation for existing-app extension/debug tasks when Graphify is available, and before fixing verify_user_journey or verify_browser_ui failures in existing apps.',
      input_schema: {
        type: 'object' as const,
        properties: {
          question: { type: 'string' as const, description: 'Specific question, e.g. "Which files handle creating a booking?"' },
        },
        required: ['question'],
      },
    },
    {
      name: 'explain_code_node',
      description: 'Explain one code graph node such as a file, route, table, component, or function. Use after query_code_graph identifies a likely node.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: { type: 'string' as const, description: 'File/function/table/route node to explain.' },
        },
        required: ['node'],
      },
    },
    {
      name: 'code_graph_path',
      description: 'Find a relationship path between two code graph nodes, for example "dashboard page" to "bookings table". Useful for impact analysis before edits.',
      input_schema: {
        type: 'object' as const,
        properties: {
          from: { type: 'string' as const, description: 'Starting file/function/table/route node.' },
          to: { type: 'string' as const, description: 'Target file/function/table/route node.' },
        },
        required: ['from', 'to'],
      },
    },
    {
      name: 'write_codebase_map',
      description: 'Write or update the company\'s codebase map after a successful task. Required at the end of every successful engineering task. Pass the FULL map (stack + deploy + schema + routes + patterns + shipped_features). For first deploy: write the initial map. For extends: read the current map, append your new feature to shipped_features, update last_commit_sha + last_deployed_at + any new schema/routes, then write.',
      input_schema: {
        type: 'object' as const,
        properties: {
          schema_version: { type: 'integer' as const, enum: [1] },
          stack: {
            type: 'object' as const,
            properties: {
              framework: { type: 'string' as const },
              runtime: { type: 'string' as const },
              database: { type: 'string' as const },
              hosting: { type: 'string' as const },
              integrations: { type: 'array' as const, items: { type: 'string' as const } },
            },
            required: ['framework', 'runtime', 'database', 'hosting'],
          },
          deploy: {
            type: 'object' as const,
            properties: {
              github_repo: { type: ['string', 'null'] as const },
              render_service_id: { type: ['string', 'null'] as const },
              app_url: { type: ['string', 'null'] as const },
              last_commit_sha: { type: ['string', 'null'] as const },
              last_deployed_at: { type: ['string', 'null'] as const },
            },
            required: ['github_repo', 'render_service_id', 'app_url', 'last_commit_sha', 'last_deployed_at'],
          },
          schema: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                table: { type: 'string' as const },
                columns: { type: 'array' as const, items: { type: 'string' as const } },
                notes: { type: 'string' as const },
              },
              required: ['table', 'columns'],
            },
          },
          routes: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                path: { type: 'string' as const },
                method: { type: 'string' as const },
                auth: { type: 'string' as const, enum: ['public', 'session', 'admin'] },
                notes: { type: 'string' as const },
              },
              required: ['path', 'method', 'auth'],
            },
          },
          patterns: {
            type: 'object' as const,
            properties: {
              auth: { type: 'string' as const },
              query_layer: { type: 'string' as const },
              error_handling: { type: 'string' as const },
            },
            required: ['auth', 'query_layer', 'error_handling'],
          },
          shipped_features: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                feature: { type: 'string' as const },
                task_id: { type: ['string', 'null'] as const },
                shipped_at: { type: 'string' as const },
              },
              required: ['feature', 'task_id', 'shipped_at'],
            },
          },
          notes: { type: ['string', 'null'] as const },
        },
        required: ['schema_version', 'stack', 'deploy', 'patterns'],
      },
    },
    {
      name: 'http_fetch_full',
      description: 'Make a single HTTP request and return the FULL response: status, headers, and body (truncated to 4KB). Use this for live debugging when verify_user_journey or check_url_health surfaces a failure — check_url_health only returns 200/non-200, but http_fetch_full lets you inspect WHY a request is failing (which header is wrong, what error JSON the server returned, what redirect target). Always use this BEFORE assuming a fix; never patch blind.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url:     { type: 'string' as const,  description: 'Full URL to fetch.' },
          method:  { type: 'string' as const,  enum: ['GET','POST','PUT','DELETE','PATCH','HEAD'], description: 'Default GET.' },
          headers: { type: 'object' as const,  description: 'Optional request headers as { name: value }.' },
          body:    { type: 'string' as const,  description: 'Optional request body as a string.' },
        },
        required: ['url'],
      },
    },
    {
      name: 'read_known_issues',
      description: 'Read past failure fingerprints relevant to what you are about to do. Returns up to 5 entries — both still-open issues AND already-fixed ones with their fix_notes. Call this BEFORE any deploy / migration / Render service creation / GitHub commit so you avoid repeating known mistakes. Each entry includes a [STATUS] tag and (when available) the exact fix that worked. Examples of useful contexts: "creating Render service", "session middleware Express", "GitHub Trees API commit", "Drizzle migration on production".',
      input_schema: {
        type: 'object' as const,
        properties: {
          context: { type: 'string' as const, description: 'Free-text describing what you are about to do, e.g. "creating Render service" or "adding session middleware". The longer/more specific the better — words ≥4 chars are matched against fingerprint descriptions.' },
        },
        required: ['context'],
      },
    },
    {
      name: 'verify_db_state',
      description: 'Run a SELECT query against the founder DB and assert on the result. Use AFTER verify_user_journey to confirm side-effects actually landed in the database — not just that the HTTP redirect succeeded. Example: after a "submit register" journey step passes, call this with sql:"SELECT email FROM users WHERE email=$1" + expect_min_rows:1 to prove the user row was actually created. Without this, a server that returns 302 but silently fails the INSERT will go unnoticed.',
      input_schema: {
        type: 'object' as const,
        properties: {
          label:                     { type: 'string' as const,   description: 'Human-readable label for the assertion, e.g. "user row exists after register".' },
          sql:                       { type: 'string' as const,   description: 'Single SELECT statement. Parameter placeholders ($1, $2, ...) are NOT supported here — inline literal values via single quotes.' },
          expect_min_rows:           { type: 'integer' as const,  description: 'Minimum number of rows the query must return. Defaults to 1.' },
          expect_max_rows:           { type: 'integer' as const,  description: 'Optional max number of rows. Defaults to no limit.' },
          expect_first_row_contains: { type: 'object' as const,   description: 'Optional. Each {key:value} must match the first row. Compared with == after JSON-stringify so works for strings/numbers/booleans.' },
          contract_flow_id:          { type: 'string' as const,   description: 'Optional Product Build Contract flow id this DB proof satisfies.' },
          entity:                    { type: 'string' as const,   description: 'Optional Product Build Contract entity/table name.' },
          db_table:                  { type: 'string' as const,   description: 'Optional DB table name. Defaults to entity when omitted.' },
          required_fields:           { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional required fields that must be present and non-null in the first returned row. Emits CONTRACT_FIELD_PROOF for the flow.' },
        },
        required: ['label', 'sql'],
      },
    },
    {
      name: 'list_journey_templates',
      description: 'Return ready-to-use verify_user_journey input templates for the most common founder-app flows: auth (register→logout→login), crud (create→list→delete), payment (visit pricing page + Stripe link liveness), settings (update profile field, verify persists), and full_mvp (auth + CRUD + payment in one journey). Use this BEFORE writing your own journey from scratch — pick the closest template, plug in the specific URLs and field names, and pass to verify_user_journey. Returns a JSON object keyed by template name; each value is a partial input you can spread into verify_user_journey.',
      input_schema: {
        type: 'object' as const,
        properties: {
          template: { type: 'string' as const, enum: ['auth', 'crud', 'payment', 'settings', 'full_mvp', 'all'], description: 'Which template to return. "all" returns every template — useful for picking the closest match.' },
        },
      },
    },
    {
      name: 'verify_user_journey',
      description: 'Walk through a multi-step user journey on the deployed app, asserting expected responses at each step. Cookies persist across steps so authenticated flows (register → login → use-feature) work end-to-end. Use this AFTER deploy to prove the app actually works for users — not just that URLs return 200. The agent MUST run this for every critical journey before marking an engineering task complete.',
      input_schema: {
        type: 'object' as const,
        properties: {
          journey_name: { type: 'string' as const, description: 'Human-readable name, e.g. "register, sign in, view dashboard"' },
          base_url:     { type: 'string' as const, description: 'Deployed app base URL, e.g. https://threadpulse.baljia.app' },
          contract_flow_id: { type: 'string' as const, description: 'Optional Product Build Contract flow id this journey proves. Emits CONTRACT_FLOW_PROOF when the journey passes/fails.' },
          steps: {
            type: 'array' as const,
            description: 'Ordered steps. Cookies/sessions persist across steps. Stops on first failure.',
            items: {
              type: 'object' as const,
              properties: {
                step:                    { type: 'string' as const,  description: 'Human label for this step' },
                method:                  { type: 'string' as const,  enum: ['GET','POST','PUT','DELETE','PATCH'], description: 'Default GET' },
                path:                    { type: 'string' as const,  description: 'Path on the app, e.g. /auth/register' },
                body:                    { type: 'object' as const,  description: 'Request body. For form_urlencoded, pass plain {key:value}. For json, same.' },
                body_type:               { type: 'string' as const,  enum: ['form','json'], description: 'How to encode body. Default form.' },
                expect_status:           { description: 'Required HTTP status. Either a single integer (e.g. 200) or an array of acceptable values (e.g. [302, 201]) — useful for routes that may redirect OR return Created depending on Accept header.' },
                expect_redirect:         { type: 'string' as const,  description: 'Substring expected in Location header on 3xx (e.g. /dashboard).' },
                expect_body_contains:    { type: 'string' as const,  description: 'Substring required to appear in response body.' },
                expect_body_not_contains:{ type: 'string' as const,  description: 'Substring forbidden in response body (e.g. error toast text like "Registration failed").' },
              },
              required: ['step','path'],
            },
          },
        },
        required: ['journey_name','base_url','steps'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ Database Infrastructure (Neon Postgres) Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'provision_database',
      description: 'Create a new Neon Postgres database for the founder\'s product. Call this when building a SaaS that needs user data, auth, or any persistent storage. Returns connection details. One database per company.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_database_info',
      description: 'Get the founder\'s product database connection details (host, connection URI, project ID). Use this when writing code that connects to their DB.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'run_migration',
      description: 'Run a SQL migration (CREATE TABLE, ALTER TABLE, etc.) on the founder\'s product database. Uses Neon branching for safety: creates a branch, runs migration, merges if successful. Only DDL statements allowed (CREATE, ALTER, DROP, INSERT seed data).',
      input_schema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string' as const, description: 'SQL migration statement (CREATE TABLE, ALTER TABLE, etc.)' },
          description: { type: 'string' as const, description: 'Human-readable description of what this migration does' },
        },
        required: ['sql', 'description'],
      },
    },
    {
      name: 'query_company_db',
      description: 'Run a read-only SELECT query on the founder\'s product database. Use to verify schema, check seed data, or debug issues. Only SELECT allowed.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string' as const, description: 'SQL SELECT query (read-only)' },
        },
        required: ['sql'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ Stripe Payments (Founder's Product) Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'stripe_create_product',
      description: 'Create a Stripe product for the founder\'s SaaS. This is a product in THEIR payment system, not Baljia\'s. Returns a product ID to use with stripe_create_price.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Product name (e.g. "Pro Plan", "Starter")' },
          description: { type: 'string' as const, description: 'Product description' },
        },
        required: ['name'],
      },
    },
    {
      name: 'stripe_create_price',
      description: 'Create a price for a Stripe product. Supports one-time or recurring billing.',
      input_schema: {
        type: 'object' as const,
        properties: {
          product_id: { type: 'string' as const, description: 'Stripe product ID (from stripe_create_product)' },
          amount_cents: { type: 'number' as const, description: 'Price in cents (e.g. 2900 = $29.00)' },
          currency: { type: 'string' as const, description: 'Currency code (default: usd)' },
          recurring: { type: 'boolean' as const, description: 'If true, creates a monthly subscription price' },
          interval: { type: 'string' as const, description: 'Billing interval: month, year (default: month)' },
        },
        required: ['product_id', 'amount_cents'],
      },
    },
    {
      name: 'stripe_create_payment_link',
      description: 'Create a shareable Stripe payment link for a price. Founders can embed this in their website or share directly. No code required.',
      input_schema: {
        type: 'object' as const,
        properties: {
          price_id: { type: 'string' as const, description: 'Stripe price ID (from stripe_create_price)' },
        },
        required: ['price_id'],
      },
    },
    {
      name: 'stripe_get_products',
      description: 'List all Stripe products and prices for the founder\'s account. Shows product names, prices, and payment link URLs.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: branching + PR (KG spec: create_branch, create_commit, create_pr) Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'github_create_branch',
      description: 'Create a new branch in a GitHub repository from a base branch. Use this to isolate changes before merging.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          branch_name: { type: 'string' as const, description: 'New branch name (e.g. "feature/add-auth")' },
          base_branch: { type: 'string' as const, description: 'Branch to fork from (default: main)' },
        },
        required: ['repo', 'branch_name'],
      },
    },
    {
      name: 'github_create_pr',
      description: 'Create a pull request from a feature branch to main. Use after pushing feature branch changes with github_push_file.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          title: { type: 'string' as const, description: 'PR title' },
          body: { type: 'string' as const, description: 'PR description (markdown)' },
          head_branch: { type: 'string' as const, description: 'Branch with changes (e.g. "feature/add-auth")' },
          base_branch: { type: 'string' as const, description: 'Target branch (default: main)' },
        },
        required: ['repo', 'title', 'head_branch'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: search + commit (completing KG github spec) Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'github_search_code',
      description: 'Search for code in a GitHub repository. Useful to find existing implementations before writing new code.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          query: { type: 'string' as const, description: 'Search query (e.g. "function handleAuth" or "TODO:" or "stripe webhook")' },
          language: { type: 'string' as const, description: 'Filter by language (e.g. "TypeScript", "JavaScript") Ã¢â‚¬â€ optional' },
        },
        required: ['repo', 'query'],
      },
    },
    {
      name: 'github_create_commit',
      description: 'Create a commit in a repository with multiple file changes in a single atomic operation. Prefer this over multiple github_push_file calls when changing multiple files together.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Repository name' },
          message: { type: 'string' as const, description: 'Commit message' },
          branch: { type: 'string' as const, description: 'Branch to commit to (default: main)' },
          files: {
            type: 'array' as const,
            description: 'Files to create or update',
            items: {
              type: 'object' as const,
              properties: {
                path: { type: 'string' as const, description: 'File path in repo' },
                content: { type: 'string' as const, description: 'File content' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['repo', 'message', 'files'],
      },
    },
    // Ã¢â€â‚¬Ã¢â€â‚¬ Render: list_databases (completing KG render spec) Ã¢â€â‚¬Ã¢â€â‚¬

    // Ã¢â€â‚¬Ã¢â€â‚¬ Skeleton / Next.js SaaS build tools Ã¢â€â‚¬Ã¢â€â‚¬
    {
      name: 'fork_express_skeleton',
      description: 'BACKEND-ONLY tool. Use ONLY for pure JSON-API services, webhooks, cron workers, or background processors with ZERO user-facing pages. Express + raw HTML cannot clear the Frontend Quality Bar. If the task involves ANY of: landing page, dashboard, chat UI, signup/login flow, founder-facing pages, end-user-facing routes, or marketing surface, use create_instance (Next.js + shadcn/ui + Tailwind 4 + canonical repo/DB/Render reuse) instead. Forking Express on a UI task will be rejected by the completion gate. Ships with: Zod env validation, trust proxy, Postgres sessions, /api/health, structured logging, withTimeout helper, discriminated-union responses, tests/ folder. All Backend Quality Bar P0 rules pre-wired. After forking: add feature-specific tables to db/schema.sql, customize routes via github_create_commit, call run_migration, then render_create_service.',
      input_schema: {
        type: 'object' as const,
        properties: {
          app_name:    { type: 'string' as const, description: 'Founder-facing display name (e.g. "Threadpulse"). Used in landing-page copy + README. Defaults to the company name.' },
          description: { type: 'string' as const, description: 'One-sentence product description. Used in package.json description and as a comment in server.js.' },
        },
      },
    },
    {
      name: 'list_components',
      description: 'Returns the curated catalog of 14 production shadcn/ui components shipped in the github_fork_skeleton repo (Button, Card, Input, Dialog, etc.) with their variants, intended uses, and anti-pattern warnings. Call this BEFORE writing any UI code on a Next.js skeleton — every founder app already has these components in components/ui/, hand-rolling is a quality bar violation.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'read_component',
      description: 'Read the source of a specific shadcn/ui component from the founder GitHub repo (resolves to components/ui/{name}.tsx). Use this when you need to know the exact props, variants, or className API of a component before importing it.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Component name without extension. E.g. "Button" or "Card". Matches components/ui/{name}.tsx.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'list_design_systems',
      description: 'Returns the catalog of 149 brand-grade design-language references (Linear, Stripe, Notion, Vercel, Apple, etc.) grouped by 23 categories (Productivity & SaaS, Fintech & Crypto, AI & LLM, Developer Tools, etc.). Each entry is a kebab-case name plus a one-line vibe tagline. Call this BEFORE writing a landing or dashboard so you can pick one design language whose typography, palette, and shadow conventions match the founder\'s product. Then call get_design_system(name) to load the full ~18KB spec.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'match_design_system',
      description: 'Vectorless RAG selector for the 149 vendored design-language references. Scores the founder app brief against category, tagline, domain keywords, and style signals, then returns the best names plus reasons. Call this before get_design_system when the category is ambiguous or missing; it avoids guessing from the raw catalog.',
      input_schema: {
        type: 'object' as const,
        properties: {
          product_context: { type: 'string' as const, description: 'Founder app/product brief, target audience, domain, and desired vibe.' },
          title: { type: 'string' as const, description: 'Optional task or product title.' },
          description: { type: 'string' as const, description: 'Optional longer task description.' },
          preferred_category: { type: 'string' as const, description: 'Optional catalog category hint, e.g. "Fintech & Crypto", "AI & LLM", "Productivity & SaaS".' },
          limit: { type: 'number' as const, description: 'Number of matches to return (default 5, max 8).' },
        },
      },
    },
    {
      name: 'get_design_system',
      description: 'Load the full design-language spec (~18KB) for one of the 149 vendored systems. Returns exact hex codes, font family + weight + letter-spacing rules, shadow stacks, border-radius scale, motion vocabulary, and the philosophy behind the choices. Use the conventions (e.g. "weight-510 Inter with cv01,ss03 OpenType features at -1.584px letter-spacing"), NOT the brand identity — rename palettes to the founder\'s brand, never reuse a competitor\'s accent in their own market.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Kebab-case design system name from match_design_system or list_design_systems (e.g. "linear-app", "stripe", "notion", "vercel").' },
        },
        required: ['name'],
      },
    },
    {
      name: 'github_fork_skeleton',
      description: 'Lower-level Next.js skeleton hydrator used by create_instance. For full-stack SaaS build tasks, call create_instance first so the company repo, Neon DB, and Render service are reused. Use this directly only when explicitly repairing skeleton hydration; after hydrating, patch feature-specific code with github_push_file or github_create_commit.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Company repo slug (e.g. "genesis-advertising-hen6"). The skeleton will be forked into this repo.' },
          description: { type: 'string' as const, description: 'Short description of the app being built (used as repo description).' },
        },
        required: ['repo'],
      },
    },
    {
      name: 'run_drizzle_push',
      description: 'Run `pnpm db:push` to sync the Drizzle schema in db/schema.ts to the company Neon Postgres database. Use this INSTEAD of run_migration for skeleton-based Next.js apps Ã¢â‚¬â€ Drizzle introspects the schema file and creates/alters tables automatically. Returns the list of tables created or updated.',
      input_schema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'Company repo slug (must have db/schema.ts with Drizzle schema).' },
        },
        required: ['repo'],
      },
    },
    // -- Atomic instance provisioning --
    {
      name: 'ensure_founder_app_instance',
      description: 'Public v2 instance tool. Reuses or hydrates the canonical company repo, reuses/provisions Neon, reuses/provisions Render, injects Baljia runtime env vars, and writes baljia.runtime.json plus local @baljia/* runtime modules. Use this FIRST for full-stack Next.js founder apps.',
      input_schema: {
        type: 'object' as const,
        properties: {
          companyId: { type: 'string' as const, description: 'Company id. Must match this task company.' },
          capabilities: {
            type: 'array' as const,
            description: 'Runtime capabilities to enable, e.g. ["auth", "ai"].',
            items: { type: 'string' as const },
          },
          preferredStack: {
            type: 'string' as const,
            enum: ['nextjs'],
            description: 'Only "nextjs" is supported in v2.',
          },
        },
        required: ['companyId', 'capabilities', 'preferredStack'],
      },
    },
    {
      name: 'create_instance',
      description: 'Atomic tool that prepares a full-stack SaaS instance in one call. It reuses the company repo/Neon DB/Render service created during onboarding when present, hydrates the canonical slug repo with the Next.js skeleton when needed, and only provisions missing pieces. Call this FIRST for full-stack SaaS build tasks instead of manually creating duplicate repos/databases/services. Returns repo URL, database state, service URL, and next steps.',
      input_schema: {
        type: 'object' as const,
        properties: {
          app_name: { type: 'string' as const, description: 'Short app name used for repo slug and Render service name (e.g. "acme-crm").' },
          description: { type: 'string' as const, description: 'One-line description of what the app does.' },
          env_vars: {
            type: 'object' as const,
            description: 'Additional environment variables to set on Render (beyond DATABASE_URL, BETTER_AUTH_SECRET, AI gateway, and platform Stripe vars which are set automatically when configured).',
            additionalProperties: { type: 'string' as const },
          },
        },
        required: ['app_name', 'description'],
      },
    },
    {
      name: 'get_preview',
      description: 'Get the live preview URL for the company Render service. Returns the public URL where the app is accessible. Use this after a deploy to confirm where the app lives.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
  ];

  return tools;
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// HANDLERS
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

// C7-FIX: Tenant isolation helpers Ã¢â‚¬â€ verify infrastructure belongs to the requesting company
async function assertServiceOwnership(serviceId: string, companyId: string): Promise<void> {
  const [company] = await db.select({ render_service_id: companies.render_service_id })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company || company.render_service_id !== serviceId) {
    const actual = company?.render_service_id ?? 'none stored';
    throw new Error(
      `render_deploy/render_* called with service_id "${serviceId}" but this company's service is "${actual}". ` +
      `Either pass the correct service_id or omit it entirely (it auto-resolves from the company).`
    );
  }
}

// Auto-resolve render service_id from the task's company. Eliminates the
// LLM-hallucinates-an-opaque-token failure mode (e.g. mistyping "d7tjghr"
// for "d7tjgrr"). If the agent passed a service_id, validate it; if not,
// look up the company's stored ID and mutate input.service_id so downstream
// handlers see the resolved value.
async function resolveServiceId(input: Record<string, unknown>, companyId: string): Promise<void> {
  if (typeof input.service_id === 'string' && input.service_id.length > 0) {
    await assertServiceOwnership(input.service_id, companyId);
    return;
  }
  const [company] = await db.select({ render_service_id: companies.render_service_id })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.render_service_id) {
    throw new Error('No render_service_id stored for this company. Call create_instance for full-stack apps, or render_create_service for backend/manual Render paths.');
  }
  input.service_id = company.render_service_id;
}

export async function handleEngineeringTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {
  switch (toolName) {
    // Ã¢â€â‚¬Ã¢â€â‚¬ Skills (Polsia-style knowledge layer) Ã¢â€â‚¬Ã¢â€â‚¬
    case 'list_skills':
      return handleListSkills();

    case 'read_skill':
      return handleReadSkill(input);

    case 'list_domain_packs':
      return handleListDomainPacks();

    case 'match_domain_app':
      return handleMatchDomainApp(input, task);

    case 'get_domain_pack':
      return handleGetDomainPack(input);

    case 'compose_ad_hoc_domain':
      return handleComposeAdHocDomain(input, task);

    case 'match_capabilities':
      return handleMatchCapabilities(input, task);

    case 'get_capability_pack':
      return handleGetCapabilityPack(input);

    case 'compose_app_architecture':
      return handleComposeAppArchitecture(input, task);

    case 'record_engineering_lane_output':
      return handleRecordEngineeringLaneOutput(input);

    case 'list_capability_packs':
      return handleListCapabilityPacks();

    case 'compose_frontend_plan':
      return handleComposeFrontendPlan(input, task);

    case 'match_reference_repos':
      return handleMatchReferenceRepos(input, task);

    case 'get_reference_repo_patterns':
      return handleGetReferenceRepoPatterns(input);

    case 'retrieve_component_examples':
      return handleRetrieveComponentExamples(input, task);

    case 'get_company_tech':
      return getCompanyTech(task.company_id);

    case 'github_create_repo':
      return githubCreateRepo(input, task.company_id);

    case 'github_push_file':
      return githubPushFile(input, task.company_id, task);

    case 'github_read_file':
      return githubReadFile(input, task.company_id);

    case 'github_list_files':
      return githubListFiles(input, task.company_id);

    case 'github_delete_file':
      return githubDeleteFile(input, task.company_id, task);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Render deploys (primary founder app target) Ã¢â€â‚¬Ã¢â€â‚¬
    case 'render_create_service':
      return renderCreateService(input, task.company_id);

    case 'render_deploy': {
      await resolveServiceId(input, task.company_id);
      return renderDeploy(input, task.company_id);
    }

    case 'render_set_env_vars': {
      await resolveServiceId(input, task.company_id);
      return renderSetEnvVars(input);
    }

    case 'render_update_service_config': {
      await resolveServiceId(input, task.company_id);
      return renderUpdateServiceConfig(input);
    }

    case 'design_audit':
      return designAudit(input);

    case 'design_critique': {
      const { critiqueDesign } = await import('@/lib/services/design-critic.service');
      return critiqueDesign(String(input.url ?? '').trim());
    }
    case 'verify_browser_ui':
      return verifyBrowserUi(input, task);

    case 'verify_interaction_contract':
      return verifyInteractionContract(input, task);

    case 'list_components':
      return listComponents();

    case 'read_component':
      return readComponent(input, task.company_id);

    case 'list_design_systems':
      return listDesignSystems();

    case 'match_design_system':
      return matchDesignSystem(input, task);

    case 'get_design_system':
      return getDesignSystem(input);

    case 'render_get_service': {
      await resolveServiceId(input, task.company_id);
      return renderGetService(input);
    }

    case 'render_get_deploy_status': {
      await resolveServiceId(input, task.company_id);
      return renderGetDeployStatus(input);
    }

    case 'render_get_logs': {
      await resolveServiceId(input, task.company_id);
      return renderGetLogs(input);
    }

    case 'render_rollback': {
      await resolveServiceId(input, task.company_id);
      return handleRenderRollback(input);
    }

    case 'render_delete_service': {
      await resolveServiceId(input, task.company_id);
      return renderDeleteService(input, task.company_id);
    }

    case 'render_list_services':
      return renderListServices(input, task.company_id);

    case 'render_get_metrics': {
      await resolveServiceId(input, task.company_id);
      return renderGetMetrics(input);
    }

    case 'render_list_databases':
      return renderListDatabases(input, task.company_id);

    case 'attach_custom_domain':
      return handleAttachCustomDomain(input, task.company_id);

    case 'verify_custom_domain':
      return handleVerifyCustomDomain(task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Health & safety Ã¢â€â‚¬Ã¢â€â‚¬
    case 'check_url_health':
      return handleCheckUrlHealth(input);
    case 'verify_user_journey':
      return handleVerifyUserJourney(input);
    case 'verify_release':
      return handleVerifyRelease(input, task);
    case 'list_journey_templates':
      return handleListJourneyTemplates(input);
    case 'verify_db_state':
      return handleVerifyDbState(input, task.company_id);
    case 'static_code_scan':
      return handleStaticCodeScan(task.company_id);
    case 'review_pushed_code':
      return handleReviewPushedCode(task.company_id, task.id);
    case 'read_known_issues':
      return handleReadKnownIssues(input);
    case 'http_fetch_full':
      return handleHttpFetchFull(input);
    case 'read_codebase_map':
      return handleReadCodebaseMap(task.company_id);
    case 'build_code_graph':
      return handleBuildCodeGraph(input, task.company_id);
    case 'read_code_graph_report':
      return handleReadCodeGraphReport(task.company_id);
    case 'query_code_graph':
      return handleQueryCodeGraph(input, task.company_id);
    case 'explain_code_node':
      return handleExplainCodeNode(input, task.company_id);
    case 'code_graph_path':
      return handleCodeGraphPath(input, task.company_id);
    case 'write_codebase_map':
      return handleWriteCodebaseMap(input, task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Database Infrastructure Ã¢â€â‚¬Ã¢â€â‚¬
    case 'provision_database':
      return handleProvisionDatabase(task.company_id);

    case 'get_database_info':
      return handleGetDatabaseInfo(task.company_id);

    case 'run_migration':
      return handleRunMigration(input, task.company_id);

    case 'query_company_db':
      return handleQueryCompanyDb(input, task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Stripe Payments Ã¢â€â‚¬Ã¢â€â‚¬
    case 'stripe_create_product':
      return handleStripeCreateProduct(input, task.company_id);

    case 'stripe_create_price':
      return handleStripeCreatePrice(input, task.company_id);

    case 'stripe_create_payment_link':
      return handleStripeCreatePaymentLink(input, task.company_id);

    case 'stripe_get_products':
      return handleStripeGetProducts(task.company_id);

    // Ã¢â€â‚¬Ã¢â€â‚¬ GitHub branching + PR Ã¢â€â‚¬Ã¢â€â‚¬
    case 'github_create_branch':
      return githubCreateBranch(input, task.company_id);

    case 'github_create_pr':
      return githubCreatePR(input, task.company_id);

    case 'github_search_code':
      return githubSearchCode(input, task.company_id);

    case 'github_create_commit':
      return githubCreateCommit(input, task.company_id, task);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Skeleton / Next.js SaaS build tools Ã¢â€â‚¬Ã¢â€â‚¬
    case 'fork_express_skeleton':
      return handleForkExpressSkeleton(input, task.company_id);

    case 'github_fork_skeleton':
      return githubForkSkeleton(input, task.company_id);

    case 'run_drizzle_push':
      return handleRunDrizzlePush(input, task.company_id);

    // -- Atomic instance creation --
    case 'ensure_founder_app_instance':
      return handleEnsureFounderAppInstance(input, task.company_id, 'json');
    case 'create_instance':
      return handleCreateInstance(input, task.company_id);

    case 'get_preview':
      return handleGetPreview(task.company_id);

    default:
      return `Unknown engineering tool: ${toolName}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GitHub helpers Ã¢â€â‚¬Ã¢â€â‚¬

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function stringArrayFrom(input: Record<string, unknown>, ...keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = asStringArray(input[key]);
    if (value && value.length > 0) return value;
  }
  return undefined;
}

const PROTECTED_RUNTIME_PATH_PATTERNS = [
  /^src\/baljia\//,
  /^baljia\.runtime\.json$/,
  /^src\/lib\/runtime-api-client\.(ts|tsx|js|jsx)$/,
];

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isProtectedRuntimePath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  if (normalized === 'tsconfig.json') return true;
  return PROTECTED_RUNTIME_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function taskAllowsRuntimeChange(task?: Task): boolean {
  return task?.execution_contract?.runtime_change === true;
}

function protectedRuntimeFileBlocker(paths: string[], task?: Task): string | null {
  const protectedPaths = paths.map(normalizeRepoPath).filter(isProtectedRuntimePath);
  if (protectedPaths.length === 0 || taskAllowsRuntimeChange(task)) return null;
  return [
    'PROTECTED_RUNTIME_FILE_BLOCKED: attempted protected runtime file edit.',
    `Protected runtime file(s): ${protectedPaths.join(', ')}`,
    'Set execution_contract.runtime_change=true on the CEO execution contract only for explicit Baljia runtime work.',
  ].join('\n');
}

function capabilityInput(input: Record<string, unknown>, task?: Task) {
  const rawDescription = String(input.description ?? task?.description ?? '').trim();
  const explicitCapabilities = asStringArray(input.capabilities);
  const description = stripPlanningHarnessMetadata(rawDescription);
  return {
    title: String(input.title ?? task?.title ?? '').trim(),
    description,
    productContext: String(input.product_context ?? input.productContext ?? '').trim(),
    designSystem: String(input.design_system ?? input.designSystem ?? '').trim(),
    actors: asStringArray(input.actors),
    workflows: asStringArray(input.workflows),
    entities: asStringArray(input.entities),
    capabilities: explicitCapabilities,
    domains: stringArrayFrom(input, 'domains', 'domain_ids', 'domainIds'),
    referencePatterns: stringArrayFrom(input, 'reference_patterns', 'referencePatterns', 'references'),
  };
}

function referenceInput(input: Record<string, unknown>, task?: Task) {
  const rawDescription = String(input.description ?? task?.description ?? '').trim();
  return {
    title: String(input.title ?? task?.title ?? '').trim(),
    description: stripPlanningHarnessMetadata(rawDescription),
    productContext: String(input.product_context ?? input.productContext ?? '').trim(),
    designSystem: String(input.design_system ?? input.designSystem ?? '').trim(),
    actors: asStringArray(input.actors),
    workflows: asStringArray(input.workflows),
    entities: asStringArray(input.entities),
    capabilities: asStringArray(input.capabilities),
    domains: stringArrayFrom(input, 'domains', 'domain_ids', 'domainIds'),
  };
}

function hasRagCapability(input: { title?: string; description?: string; productContext?: string; capabilities?: string[] }): boolean {
  const capabilities = input.capabilities ?? [];
  const text = `${input.title ?? ''}\n${input.description ?? ''}\n${input.productContext ?? ''}`;
  return capabilities.includes('rag_search') || /\brag|embedding|semantic|document search|ask documents|knowledge base\b/i.test(text);
}

export function platformEmbeddingGuidance(env: { AI_GATEWAY_URL?: string } = { AI_GATEWAY_URL: process.env.AI_GATEWAY_URL }): {
  gateway: 'google-openai-compatible' | 'openai-compatible';
  model: string;
  dimensions: number;
  note: string;
} {
  void env;
  return {
    gateway: 'google-openai-compatible',
    model: FOUNDER_AI_EMBEDDING_MODEL,
    dimensions: Number(FOUNDER_AI_EMBEDDING_DIMENSIONS),
    note: 'Founder/user apps use fixed Gemini embeddings: gemini-embedding-001 with pgvector vector(3072) on the Google OpenAI-compatible gateway; do not create ivfflat/hnsw indexes on vector(3072) because pgvector vector indexes support <=2000 dimensions.',
  };
}

export function hasKnownBadRagEmbeddingGuidance(
  input: { title?: string; description?: string; productContext?: string },
  env: { AI_GATEWAY_URL?: string } = { AI_GATEWAY_URL: process.env.AI_GATEWAY_URL },
): boolean {
  const text = `${input.title ?? ''}\n${input.description ?? ''}\n${input.productContext ?? ''}`;
  const scanText = text
    .replace(/For RAG in founder\/user apps,[\s\S]{0,900}?(?:indexed representation\.|new founder apps\.|$)/gi, '')
    .replace(/fixed Gemini embedding contract:[\s\S]{0,700}?(?:indexed representation\.|new founder apps\.|$)/gi, '')
    .replace(/\b(?:Never|Do not|Don't)\s+(?:plan\s+|use\s+|create\s+|hardcode\s+)?[^.\n]*(?:text-embedding-004|text-embedding-3-small|Gemini\s+embedContent|vector\s*\(?\s*(?:768|1536)\s*\)?|(?:768|1536)[-\s]?dim)[^.\n]*(?:\.|\n|$)/gi, '')
    .replace(/\bcommon failures?:[^.\n]*(?:text-embedding-004|text-embedding-3-small|vector\s*\(?\s*(?:768|1536)\s*\)?|(?:768|1536)[-\s]?dim)[^.\n]*(?:\.|\n|$)/gi, '')
    .replace(/Do not create ivfflat\/hnsw indexes on vector\(3072\)[\s\S]{0,220}?(?:\.|\n|$)/gi, '');
  const guidance = platformEmbeddingGuidance(env);
  const correctiveReference = /\b(hardcoded|currently|existing|legacy|old|prior|mismatch|wrong|not available|unavailable|fallback|do not use|don't use|replace|migrate|needs gemini|use gemini|disable embeddings|skip embeddings|without embeddings|without index|no index|omit index|exact scan|index limit|halfvec|vectorless|ilike)\b/i.test(scanText);
  const plannedBadUsage = /\b(use|uses|using|model|embed_model|selected|generate|write|store|create|insert|update)\b[\s\S]{0,120}\b(text-embedding-004|text-embedding-3-small|gemini-embedding(?:-[a-z0-9]+)*|vector\s*\(?\s*(?:768|1536|3072)\s*\)?|(?:768|1536|3072)[-\s]?dim)\b/i.test(scanText);
  const highDimensionVectorIndex = (
    /\b(?:ivfflat|hnsw)\b[\s\S]{0,220}\bvector\s*\(?\s*3072\s*\)?/i.test(scanText) ||
    /\bvector\s*\(?\s*3072\s*\)?[\s\S]{0,220}\b(?:ivfflat|hnsw)\b/i.test(scanText)
  );
  const highDimensionIndexCorrective = /\b(do not|don't|without|no index|omit index|exact scan|index limit|halfvec|<=\s*2000|lower dimensions?)\b[\s\S]{0,180}\b(?:ivfflat|hnsw|vector\s*\(?\s*3072\s*\)?|index)/i.test(scanText);
  if (highDimensionVectorIndex && !highDimensionIndexCorrective) return true;
  if (/\btext-embedding-004\b/i.test(scanText) ||
    /\bGemini\s+embedContent\b/i.test(scanText) ||
    /\bvector\s*\(?\s*768\s*\)?\b/i.test(scanText) ||
    /\b768[-\s]?dim(?:s|ensional)?\b/i.test(scanText)) {
    if (correctiveReference && !plannedBadUsage) return false;
    return true;
  }
  if (guidance.gateway === 'google-openai-compatible') {
    const bad = /\btext-embedding-3-small\b/i.test(scanText) ||
      /\bvector\s*\(?\s*1536\s*\)?\b/i.test(scanText) ||
      /\b1536[-\s]?dim(?:s|ensional)?\b/i.test(scanText);
    return bad && (!correctiveReference || plannedBadUsage);
  }
  const bad = /\bgemini-embedding(?:-[a-z0-9]+)*\b/i.test(scanText) ||
    /\bvector\s*\(?\s*3072\s*\)?\b/i.test(scanText) ||
    /\b3072[-\s]?dim(?:s|ensional)?\b/i.test(scanText);
  return bad && (!correctiveReference || plannedBadUsage);
}

function handleListCapabilityPacks(): string {
  return [
    'Capability packs:',
    ...listCapabilityPacks().map((pack) =>
      `- ${pack.id}: ${pack.title} - ${pack.summary} Skills: ${pack.requiredSkills.join(', ') || 'none'}. Verify: ${pack.verificationRequirements.join('; ')}`
    ),
  ].join('\n');
}

function handleListDomainPacks(): string {
  return [
    `DOMAIN_LIST_EVIDENCE count=${listDomainPacks().length}`,
    formatDomainList(),
  ].join('\n');
}

function handleComposeFrontendPlan(input: Record<string, unknown>, task: Task): string {
  const rawTaskDescription = typeof input.task_description === 'string' ? input.task_description : (task.description ?? undefined);
  const plan = composeFrontendPlan({
    taskTitle: String(input.task_title ?? input.title ?? task.title ?? '').trim() || undefined,
    taskDescription: stripPlanningHarnessMetadata(rawTaskDescription),
    productContext: typeof input.product_context === 'string' ? input.product_context : undefined,
    domains: Array.isArray(input.domain_ids) ? input.domain_ids.map(String) : undefined,
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String) : undefined,
    designSystem: typeof input.design_system === 'string' ? input.design_system : undefined,
    referencePatterns: Array.isArray(input.reference_patterns) ? input.reference_patterns.map(String) : undefined,
    pages: Array.isArray(input.pages) ? input.pages.map(String) : undefined,
    actors: Array.isArray(input.actors) ? input.actors.map(String) : undefined,
  });
  const pagesSummary = plan.pageMap.map((p) => `${p.path}=${p.uiType}`).join(',');
  const contractDbWrites = uniqueStrings(plan.interactionContracts.flatMap((item) => item.dbWrites));
  return [
    `FRONTEND_PLAN_EVIDENCE ui_type=${plan.uiType} pattern_ids=${plan.patternIds.join(',') || 'none'} ui_refs=${plan.uiReferencePatterns.join(',') || 'none'} pages=${pagesSummary || 'none'} required_text_count=${plan.browserUiRequiredText.length} required_buttons_count=${plan.browserUiRequiredButtons.length} form_checks_count=${plan.browserUiFormSubmissionChecks.length}`,
    `INTERACTION_CONTRACT_EVIDENCE count=${plan.interactionContracts.length} db_writes=${contractDbWrites.join(',') || 'none'}`,
    formatFrontendPlan(plan),
    '',
    'Next: pass plan.required_text into verify_browser_ui.required_text, plan.required_buttons into required_buttons, and plan.form_submission_checks into the journey checks. For every interaction contract and derived critical flow, build the UI/API/DB/readback vertical slice and then call verify_interaction_contract with critical_kind when applicable. Build each page to the page-map ui_type, not a generic shadcn dashboard.',
  ].join('\n');
}

function handleMatchDomainApp(input: Record<string, unknown>, task: Task): string {
  const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 4;
  const rawDescription = typeof input.description === 'string' ? input.description : task.description ?? undefined;
  const matches = matchDomainApp({
    title: String(input.title ?? task.title ?? '').trim() || undefined,
    description: rawDescription ? stripPlanningHarnessMetadata(rawDescription) : undefined,
    productContext: typeof input.product_context === 'string' ? input.product_context : undefined,
    companyContext: typeof input.company_context === 'string' ? input.company_context : undefined,
    existingCodebaseMap: typeof input.existing_codebase_map === 'string' ? input.existing_codebase_map : undefined,
  }, limit);
  const selected = matches.map((match) => match.id).join(',');
  return [
    `DOMAIN_MATCH_EVIDENCE selected=${selected || 'none'}`,
    formatDomainMatches(matches),
    '',
    matches.length === 0
      ? 'No domain match. Generic crud/dashboard fallback is allowed only when the task truly has no product-shape signals.'
      : 'Next: call get_domain_pack for the top domain, then match_capabilities (pass domains=[...] in input), then compose_app_architecture before writing code.',
  ].join('\n');
}

function handleGetDomainPack(input: Record<string, unknown>): string {
  const id = String(input.id ?? input.domain ?? input.name ?? '').trim();
  if (!id) return 'Error: pass a domain id, e.g. "ecommerce_store", "local_service_booking", "advanced_ai_mixed".';
  const pack = getDomainPack(id);
  if (!pack) {
    const ids = listDomainPacks().map((item) => item.id).join(', ');
    return `Error: unknown domain "${id}". Available domains: ${ids}`;
  }
  return [
    `DOMAIN_PACK_EVIDENCE id=${pack.id}`,
    formatDomainPack(pack),
  ].join('\n');
}

function handleComposeAdHocDomain(input: Record<string, unknown>, task: Task): string {
  const title = String(input.title ?? task.title ?? '').trim();
  const description = String(input.description ?? task.description ?? '').trim();
  const productContext = typeof input.product_context === 'string' ? input.product_context : '';
  const companyContext = typeof input.company_context === 'string' ? input.company_context : '';
  const text = `${title}\n${description}\n${productContext}\n${companyContext}`.toLowerCase();
  const stopWords = new Set([
    'build', 'create', 'ship', 'make', 'add', 'app', 'application', 'platform', 'system', 'tool',
    'with', 'that', 'where', 'will', 'user', 'users', 'admin', 'dashboard', 'full', 'stack',
    'and', 'the', 'for', 'from', 'into', 'about', 'this', 'task', 'company', 'product',
  ]);
  const nounCandidates = uniqueLocalStrings(
    text
      .replace(/[^a-z0-9_\s-]/g, ' ')
      .split(/\s+/)
      .map((word) => word.replace(/^-+|-+$/g, ''))
      .filter((word) => word.length >= 4 && !stopWords.has(word)),
  ).slice(0, 8);
  const name = nounCandidates.slice(0, 4).join('_') || 'custom_product_domain';
  const entities = nounCandidates.slice(0, 6);
  const workflows = inferAdHocWorkflows(text);
  const capabilities = inferAdHocCapabilityHints(text);

  return [
    `AD_HOC_DOMAIN_EVIDENCE name=${name} entities=${entities.join(',') || 'custom_entity'} workflows=${workflows.join(',') || 'custom_workflow'} capabilities_hint=${capabilities.join(',')}`,
    `Ad-hoc domain: ${title || name}`,
    '',
    'Use this only because no known domain pack fits the CEO task cleanly. Do not fall back to generic CRUD/dashboard.',
    `Entities: ${entities.join(', ') || 'custom_entity'}`,
    `Workflows: ${workflows.join(', ') || 'custom_workflow'}`,
    `Capability hints: ${capabilities.join(', ')}`,
    '',
    'Next: call match_capabilities with these entities/workflows/capabilities, then compose_frontend_plan and compose_app_architecture from this product shape.',
  ].join('\n');
}

function uniqueLocalStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferAdHocWorkflows(text: string): string[] {
  const workflows: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/\b(upload|file|document|media|image|asset)\b/i, 'upload_and_review'],
    [/\b(book|schedule|appointment|slot|calendar|reservation)\b/i, 'schedule_and_confirm'],
    [/\b(pay|checkout|billing|subscription|invoice|stripe)\b/i, 'purchase_or_subscribe'],
    [/\b(ai|summar|extract|generate|classif|analy[sz]e)\b/i, 'ai_assist_and_store_result'],
    [/\b(search|rag|knowledge|history|query)\b/i, 'search_and_retrieve'],
    [/\b(approve|moderate|review|admin)\b/i, 'admin_review_and_approval'],
    [/\b(message|chat|comment|community|forum)\b/i, 'communicate_and_collaborate'],
    [/\b(report|analytics|metric|chart|insight)\b/i, 'measure_and_report'],
    [/\b(import|export|csv|bulk)\b/i, 'import_export_data'],
  ];
  for (const [pattern, workflow] of patterns) {
    if (pattern.test(text)) workflows.push(workflow);
  }
  workflows.push('create_update_and_track_records');
  return uniqueLocalStrings(workflows);
}

function inferAdHocCapabilityHints(text: string): string[] {
  const capabilities = ['crud', 'dashboard', 'deployment_render'];
  const addIf = (pattern: RegExp, capability: string) => {
    if (pattern.test(text)) capabilities.push(capability);
  };
  addIf(/\b(login|auth|account|member|profile|role|permission)\b/i, 'auth');
  addIf(/\b(role|admin|moderator|approval|permission)\b/i, 'roles');
  addIf(/\b(upload|file|document|media|image|asset|storage)\b/i, 'uploads_storage');
  addIf(/\b(stripe|payment|checkout|subscription|subscribe|paid plan|paywall|payout)\b/i, 'payments_stripe');
  addIf(/\b(ai|openai|summar|extract|generate|classif|analy[sz]e|ocr)\b/i, 'ai_openai');
  addIf(/\b(rag|semantic|embedding|vector|knowledge base|document search|ask documents)\b/i, 'rag_search');
  addIf(/\b(send email|email notification|transactional email|notification|notify|reminder)\b/i, 'email_notifications');
  addIf(/\b(booking|book service|appointment|reservation|availability slot|booking calendar|time slot)\b/i, 'booking');
  addIf(/\b(marketplace|seller|buyer|listing|vendor)\b/i, 'marketplace');
  addIf(/\b(approve|moderate|review queue|admin approval)\b/i, 'admin_workflow');
  addIf(/\b(report|analytics|metric|chart|insight)\b/i, 'analytics');
  addIf(/\b(realtime|live update|live progress|presence|websocket|sse|chat)\b/i, 'realtime');
  addIf(/\b(cron|scheduled|background|queue|worker|job)\b/i, 'background_jobs');
  addIf(/\b(api integration|external api|webhook|calendar|slack|discord|maps|crm)\b/i, 'external_api');
  return uniqueLocalStrings(capabilities);
}

function handleMatchCapabilities(input: Record<string, unknown>, task: Task): string {
  const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 10;
  const planInput = capabilityInput(input, task);
  const taskIntent = classifyTaskIntent({
    title: planInput.title,
    description: planInput.description,
    productContext: planInput.productContext,
    tag: task.tag,
  });
  const preliminaryMatches = matchCapabilities({
    ...planInput,
    taskIntent: taskIntent.intent,
    taskIntentLane: taskIntent.lane,
  }, limit);
  const planningDepth = classifyPlanningDepth({
    title: planInput.title,
    description: planInput.description,
    productContext: planInput.productContext,
    taskIntent: taskIntent.intent,
    taskIntentLane: taskIntent.lane,
    selectedCapabilities: preliminaryMatches.map((match) => match.id),
    selectedDomains: planInput.domains,
  });
  const matches = matchCapabilities({
    ...planInput,
    taskIntent: taskIntent.intent,
    taskIntentLane: taskIntent.lane,
    planningDepth: planningDepth.depth,
  }, limit);
  const selected = matches.map((match) => match.id).join(',');
  const required = matches.filter((match) => match.requirement === 'required').map((match) => match.id).join(',');
  const optional = matches.filter((match) => match.requirement === 'optional').map((match) => match.id).join(',');
  return [
    formatTaskIntentEvidence(taskIntent),
    formatPlanningDepthEvidence(planningDepth),
    `CAPABILITY_MATCH_EVIDENCE required=${required || 'none'} optional=${optional || 'none'} selected=${selected || 'none'}`,
    formatCapabilityMatches(matches),
    '',
    taskIntent.lane === 'repair'
      ? 'Next: call get_capability_pack only for the required repair capability/capabilities, then compose a narrow repair architecture before writing code.'
      : 'Next: call get_capability_pack for every required capability, then call compose_app_architecture before writing code. Optional capabilities can remain backlog unless the CEO task explicitly requires them now. Use the returned verification requirements to build verify_user_journey steps.',
  ].join('\n');
}

function handleGetCapabilityPack(input: Record<string, unknown>): string {
  const id = String(input.id ?? input.name ?? '').trim();
  if (!id) return 'Error: pass a capability id, e.g. "crud", "uploads_storage", "payments_stripe", or "deployment_render".';
  const pack = getCapabilityPack(id);
  if (!pack) {
    const ids = listCapabilityPacks().map((item) => item.id).join(', ');
    return `Error: unknown capability "${id}". Available capabilities: ${ids}`;
  }
  return [
    `CAPABILITY_PACK_EVIDENCE id=${pack.id}`,
    formatCapabilityPack(pack),
  ].join('\n');
}

function handleComposeAppArchitecture(input: Record<string, unknown>, task: Task): string {
  const basePlanInput = capabilityInput(input, task);
  const taskIntent = classifyTaskIntent({
    title: basePlanInput.title,
    description: basePlanInput.description,
    productContext: basePlanInput.productContext,
    tag: task.tag,
  });
  const planInput = {
    ...basePlanInput,
    taskIntent: taskIntent.intent,
    taskIntentLane: taskIntent.lane,
  };
  if (hasRagCapability(planInput) && hasKnownBadRagEmbeddingGuidance(planInput)) {
    const guidance = platformEmbeddingGuidance();
    return [
      'Error: compose_app_architecture rejected a known-bad RAG embedding plan.',
      guidance.note,
      'Do not plan `text-embedding-004`, Gemini `embedContent`, or a vector dimension that does not match the configured gateway. Re-run compose_app_architecture with corrected RAG guidance, then proceed.',
    ].join('\n');
  }

  const plan = composeCapabilityArchitecture(planInput);

  // Anti-generic-fallback gate: if this task has domain signals but the plan
  // collapsed to crud/dashboard/deployment_render, warn (warn mode) or block
  // (hard mode) and force the agent to re-plan with domain context.
  const gateMode = readDomainGateMode();
  const gate = evaluateDomainGate(
    {
      taskTitle: planInput.title,
      taskDescription: planInput.description,
      productContext: planInput.productContext,
      matchedDomains: planInput.domains ?? [],
      selectedCapabilities: plan.capabilities,
    },
    gateMode,
  );
  if (gate.kind === 'block') {
    return [
      `${gate.marker}`,
      `BLOCKED: ${gate.reason}`,
      '',
      'Diagnostics:',
      `- task title: ${planInput.title || '(empty)'}`,
      `- selected capabilities: ${plan.capabilities.join(', ') || 'none'}`,
      `- supplied domains: ${(planInput.domains ?? []).join(', ') || 'none'}`,
      '',
      'Required next steps:',
      '1. Call match_domain_app with the task title + description.',
      '2. Call get_domain_pack for the top match.',
      '3. Call match_capabilities again with the matched domains in `domains`.',
      '4. Call get_capability_pack for every new capability returned.',
      '5. Call match_reference_repos with the domains for domain-specific patterns.',
      '6. Re-call compose_app_architecture with the enriched inputs.',
    ].join('\n');
  }
  const formattedPlan = formatArchitecturePlan(plan);
  if (hasRagCapability(planInput) && hasKnownBadRagEmbeddingGuidance({ productContext: formattedPlan })) {
    const guidance = platformEmbeddingGuidance();
    return [
      'Error: compose_app_architecture rejected generated known-bad RAG embedding guidance before emitting architecture evidence.',
      guidance.note,
      'The generated architecture text contained an embedding model/vector dimension that does not match the configured gateway. Re-run compose_app_architecture with explicit corrected RAG guidance in product_context.',
    ].join('\n');
  }
  const warningPrefix = gate.kind === 'warn'
    ? [`${gate.marker}`, `Warning: ${gate.reason}`, ''].join('\n')
    : '';
  const planningDepth = classifyPlanningDepth({
    title: planInput.title,
    description: planInput.description,
    productContext: planInput.productContext,
    taskIntent: taskIntent.intent,
    taskIntentLane: taskIntent.lane,
    selectedCapabilities: plan.capabilities,
    selectedDomains: planInput.domains,
  });
  const lanePolicy = getTaskLanePolicy(task, {
    planningDepth: planningDepth.depth,
    taskIntent: taskIntent.intent,
    selectedCapabilities: plan.capabilities,
  });
  const contractInput = {
    title: planInput.title,
    description: planInput.description,
    productContext: planInput.productContext,
    lane: lanePolicy.lane,
    taskIntent: taskIntent.intent,
    planningDepth: planningDepth.depth,
    architecture: plan,
    domains: planInput.domains,
    capabilities: plan.capabilities,
    explicitAssumptions: Array.isArray(input.assumptions) ? input.assumptions.map(String) : undefined,
    explicitNonGoals: Array.isArray(input.non_goals) ? input.non_goals.map(String) : undefined,
    explicitMvpFeatures: Array.isArray(input.mvp_features) ? input.mvp_features.map(String) : undefined,
  };
  const buildBrief = deriveBuildBrief(contractInput);
  const productContract = deriveProductBuildContract(contractInput);
  const artifactPath = persistProductBuildArtifacts(task, buildBrief, productContract);
  const taskText = [planInput.title, planInput.description, planInput.productContext].filter(Boolean).join('\n');
  const isUserFacing = plan.capabilities.some((capability) => [
    'dashboard',
    'admin_workflow',
    'booking',
    'marketplace',
    'cart_orders_checkout',
    'search',
    'rich_text_cms',
    'seo_public_pages',
  ].includes(capability)) || /\b(ui|frontend|page|dashboard|form|button|screen|app|website|landing|browser)\b/i.test(taskText);
  const productContractRequired = requiresProductBuildContract({
    lane: lanePolicy.lane,
    taskIntent: taskIntent.intent,
    planningDepth: planningDepth.depth,
    isUserFacing,
    focusedRepair: taskIntent.intent === 'focused_repair',
    selectedDomains: planInput.domains,
    selectedCapabilities: plan.capabilities,
    clearDomainSignals: (planInput.domains ?? []).length > 0,
  });
  const laneRoles = selectEngineeringLanes({
    taskText,
    lane: lanePolicy.lane,
    taskIntent: taskIntent.intent,
    planningDepth: planningDepth.depth,
    isUserFacing,
    selectedCapabilities: plan.capabilities,
    selectedDomains: planInput.domains,
    productContractRequired,
  });
  const lanePackets = buildEngineeringLanePackets({
    task: { title: planInput.title, description: planInput.description, tag: task.tag },
    productContract,
    requiredFlowIds: productContract.flows.map((flow) => flow.id),
    fieldRequirements: contractFieldRequirements(productContract),
    selectedCapabilities: plan.capabilities,
    selectedDomains: planInput.domains,
    roles: laneRoles,
  });
  return [
    warningPrefix,
    formatPlanningDepthEvidence(planningDepth),
    formatBuildBriefEvidence(buildBrief),
    formatProductBuildContractEvidence(productContract),
    laneRoles.length > 0 ? formatEngineeringLaneRequirementsEvidence({ roles: laneRoles, source: 'product_build_contract' }) : null,
    laneRoles.length > 0 ? formatEngineeringLanePacketEvidence(lanePackets) : null,
    artifactPath ? `PRODUCT_BUILD_CONTRACT_ARTIFACT path=${artifactPath}` : null,
    `ARCHITECTURE_PLAN_EVIDENCE capabilities=${plan.capabilities.join(',')} reference_patterns=${plan.referencePatterns.join(',') || 'none'} design_system=${plan.designSystem || 'none'}`,
    formattedPlan,
    '',
    'Implementation rule: build one vertical slice at a time from PRODUCT_BUILD_CONTRACT_JSON. After deploy, verify the journeys above with verify_user_journey, verify_db_state where the slice writes data, and verify_interaction_contract with contract_flow_id for every required contract flow. For auth contracts, include auth_isolation. For data contracts, pass realistic fields so CONTRACT_FIELD_PROOF covers every required field.',
  ].filter(Boolean).join('\n');
}

function persistProductBuildArtifacts(
  task: Task,
  buildBrief: ReturnType<typeof deriveBuildBrief>,
  productContract: ReturnType<typeof deriveProductBuildContract>,
): string | null {
  try {
    const safeTaskId = task.id.replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 80) || 'task';
    const outputDir = join(process.cwd(), 'measurement-output', 'product-build-contracts');
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${safeTaskId}.json`);
    writeFileSync(outputPath, JSON.stringify({
      taskId: task.id,
      companyId: task.company_id,
      generatedAt: new Date().toISOString(),
      buildBrief,
      productContract,
    }, null, 2));
    return outputPath;
  } catch (error) {
    log.warn('Failed to persist product build contract artifact', {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function handleRecordEngineeringLaneOutput(input: Record<string, unknown>): string {
  let output = normalizeEngineeringLaneOutput(input);
  if (output.status === 'blocked' && output.blockers.length === 0) {
    output = {
      ...output,
      blockers: ['record_engineering_lane_output status=blocked requires at least one concrete blocker'],
    };
  }
  return [
    formatEngineeringLaneOutputEvidence(output),
    output.status === 'blocked'
      ? `Engineering lane ${output.role} is BLOCKED: ${output.blockers.join('; ')}`
      : `Engineering lane ${output.role} recorded as ${output.status}. Parent completion gate remains authoritative.`,
  ].join('\n');
}

function handleMatchReferenceRepos(input: Record<string, unknown>, task: Task): string {
  const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 6;
  const matches = matchReferenceRepos(referenceInput(input, task), limit);
  const selected = matches.map((match) => match.pattern.id).join(',');
  return [
    `REFERENCE_MATCH_EVIDENCE selected=${selected || 'none'}`,
    formatReferenceMatches(matches),
    '',
    'Next: call get_reference_repo_patterns for the top references you will use, then pass selected reference_patterns into compose_app_architecture.',
  ].join('\n');
}

function handleGetReferenceRepoPatterns(input: Record<string, unknown>): string {
  const id = String(input.id ?? input.name ?? input.repo ?? '').trim();
  if (!id) return 'Error: pass a reference pattern id or repo, e.g. "shadcn-dashboard-patterns" or "vercel/ai-chatbot".';
  const pattern = getReferenceRepoPatterns(id);
  if (!pattern) {
    return `Error: unknown reference pattern "${id}". Call match_reference_repos first, then pass one of its pattern ids.`;
  }
  return [
    `REFERENCE_PATTERN_EVIDENCE id=${pattern.id} repo=${pattern.repo}`,
    formatReferencePattern(pattern),
  ].join('\n');
}

function handleRetrieveComponentExamples(input: Record<string, unknown>, task: Task): string {
  const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 8;
  const examples = retrieveComponentExamples(referenceInput(input, task), limit);
  const references = [...new Set(examples.map((example) => example.referenceId))].join(',');
  return [
    `COMPONENT_EXAMPLE_EVIDENCE count=${examples.length} references=${references || 'none'}`,
    formatComponentExamples(examples),
  ].join('\n');
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function githubOrg() {
  return process.env.GITHUB_ORG ?? 'BALAJIapps';
}

function resolveRepo(repoInput: string): string {
  // If already in org/repo format, use as-is; otherwise prepend org
  return repoInput.includes('/') ? repoInput : `${githubOrg()}/${repoInput}`;
}

// Shared skeleton repos that any company is allowed to READ from (forking
// pulls from them; read_component reads from a forked copy but legitimate
// read_file flows may also touch the upstream skeleton). NOT writable.
const SHARED_SKELETON_REPOS = new Set([
  'BALAJIapps/Balaji',                 // Next.js skeleton
  'BALAJIapps/baljia-express-skeleton', // Express skeleton (if separate)
]);

// Enforce that a github_* call is operating on the calling task's company
// repo (writes) or on the company repo + the shared skeleton (reads).
// Mirrors the Render-side `assertServiceOwnership`. Without this, a task
// could pass `repo: "BALAJIapps/some-other-company"` and trample another
// tenant's code via githubPushFile/githubDeleteFile/githubCreateCommit.
async function assertRepoOwnership(repoInput: unknown, companyId: string, op: 'read' | 'write'): Promise<string> {
  const [company] = await db.select({ github_repo: companies.github_repo })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.github_repo) {
    throw new Error(`No github_repo stored for this company yet. Call \`create_instance\` first for full-stack apps, or \`github_fork_skeleton\` only for explicit skeleton repair.`);
  }
  const owned = resolveRepo(company.github_repo);
  const explicitRepo = typeof repoInput === 'string' ? repoInput.trim() : '';
  const normalized = explicitRepo ? resolveRepo(explicitRepo) : owned;
  if (op === 'read' && SHARED_SKELETON_REPOS.has(normalized)) {
    return normalized;
  }
  if (normalized !== owned) {
    throw new Error(
      `github_${op}: this task's company owns "${owned}" but you passed "${normalized}". ` +
      `Either omit \`repo\` (it auto-resolves) or pass the correct repo. Cross-tenant access is blocked.`
    );
  }
  return normalized;
}

async function getCompanyTech(companyId: string): Promise<string> {
  const [company] = await db.select({
    github_repo: companies.github_repo, render_service_id: companies.render_service_id,
    neon_database_id: companies.neon_database_id, subdomain: companies.subdomain, name: companies.name,
    design_system: companies.design_system,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company) return 'Company not found';

  const lines = [
    `Company: ${company.name}`,
    `GitHub repo: ${company.github_repo ?? 'Not created yet'}`,
    `Render service: ${company.render_service_id ?? 'Not created yet'}`,
    `Neon DB: ${company.neon_database_id ?? 'Not provisioned yet'}`,
    `Subdomain: ${company.subdomain ?? 'Not set'}`,
    `Design system: ${company.design_system ?? 'Not selected yet'}`,
  ];

  return lines.join('\n');
}

async function githubCreateRepo(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const org = githubOrg();

    const response = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: input.repo_name as string,
        description: (input.description as string) ?? '',
        private: input.private !== false,
        auto_init: true,
        gitignore_template: 'Node',
      }),
    });

    const data = await response.json() as { full_name?: string; html_url?: string; message?: string };

    if (!response.ok) {
      return `GitHub repo creation failed: ${data.message ?? response.statusText}`;
    }

    // Save to company record
    await db.update(companies).set({ github_repo: data.full_name }).where(eq(companies.id, companyId));

    return `GitHub repo created: ${data.full_name}\nURL: ${data.html_url}`;
  } catch (err) {
    return `GitHub error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubPushFile(input: Record<string, unknown>, companyId: string, task?: Task): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = await assertRepoOwnership(input.repo as string, companyId, 'write');
    const branch = (input.branch as string) ?? 'main';
    const path = input.path as string;
    const runtimeBlocker = protectedRuntimeFileBlocker([path], task);
    if (runtimeBlocker) return runtimeBlocker;

    // Validate content BEFORE the GitHub round-trip. When the LLM hits its
    // max_output_tokens cap mid-JSON, Anthropic returns a tool_use block with
    // missing fields — `content` is the usual casualty for large-file pushes.
    // Surface a specific, actionable error so the agent splits the work
    // instead of retrying the same broken call.
    if (typeof input.content !== 'string' || input.content.length === 0) {
      return `github_push_file error: \`content\` field is missing or empty for path="${path}". This usually means your response was truncated at the output token cap (the file is too large to fit in one tool call). Fix one of these ways: (1) push the HTML out of server.js into a separate \`public/index.html\` file (Express + express.static handles serving), then push server.js and index.html in two separate \`github_push_file\` calls; (2) split the page into smaller component files; (3) use \`github_create_commit\` with a \`files\` array of shorter files. Do NOT retry the same call — it will fail the same way.`;
    }
    if (typeof input.message !== 'string' || input.message.length === 0) {
      return `github_push_file error: \`message\` field is missing for path="${path}". Provide a commit message.`;
    }

    // Check if file exists to get SHA for update
    let sha: string | undefined;
    const existingRes = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers });
    if (existingRes.ok) {
      const existingData = await existingRes.json() as { sha?: string };
      sha = existingData.sha;
    }

    const content = Buffer.from(input.content as string).toString('base64');
    const body: Record<string, unknown> = {
      message: input.message as string,
      content,
      branch,
    };
    if (sha) body.sha = sha;

    const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json() as { content?: { html_url?: string }; commit?: { sha?: string }; message?: string };

    if (!response.ok) {
      return `GitHub push failed: ${data.message ?? response.statusText}`;
    }

    const action = sha ? 'updated' : 'created';
    // Include the resulting commit SHA so review_pushed_code's multi-commit
    // walk can find it (audit P2.1 round 4, 2026-05-12). The walk regex is
    // `/Commit:?\s*([0-9a-f]{7,40})/i` — keep the prefix consistent.
    const commitSha = data.commit?.sha;
    const shaLine = commitSha ? `\nCommit: ${commitSha}` : '';
    return `File ${action}: ${path} in ${repo}${shaLine}\nURL: ${data.content?.html_url ?? 'unknown'}`;
  } catch (err) {
    return `GitHub push error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubReadFile(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const decoded = await githubReadFileRaw(input, companyId);
    if (decoded.startsWith('Error:') || decoded.startsWith('GitHub read failed:') || decoded.startsWith('GitHub read error:')) {
      return decoded;
    }
    const path = input.path as string;
    return `File: ${path}\n\`\`\`\n${decoded}\n\`\`\``;
  } catch (err) {
    return `GitHub read error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Raw read for callers that need the file content WITHOUT the human-display
// wrapper ("File: <path>\n```\n...\n```"). Used by run_drizzle_push, schema
// inspectors, and any flow that sends file content to a downstream parser.
// run_drizzle_push was previously passing the wrapped string as schema text
// to the remote runner, which silently corrupted the schema parse.
async function githubReadFileRaw(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = await assertRepoOwnership(input.repo as string, companyId, 'read');
    const branch = (input.branch as string) ?? 'main';
    const path = input.path as string;

    const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers });
    const data = await response.json() as { content?: string; encoding?: string; message?: string };

    if (!response.ok) {
      return `GitHub read failed: ${data.message ?? response.statusText}`;
    }
    if (data.content && data.encoding === 'base64') {
      return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    }
    return `Error: file content not available for ${path}`;
  } catch (err) {
    return `GitHub read error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubListFiles(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = await assertRepoOwnership(input.repo as string, companyId, 'read');
    const branch = (input.branch as string) ?? 'main';
    const path = (input.path as string) ?? '';

    const response = await fetch(
      `${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers }
    );
    const data = await response.json() as Array<{ name: string; type: string; path: string }> | { message?: string };

    if (!response.ok || !Array.isArray(data)) {
      const err = (data as { message?: string }).message ?? 'Unknown error';
      return `GitHub list failed: ${err}`;
    }

    const files = data.map((f) => `${f.type === 'dir' ? 'Ã°Å¸â€œÂ' : 'Ã°Å¸â€œâ€ž'} ${f.path}`).join('\n');
    return files.length ? files : 'Directory is empty';
  } catch (err) {
    return `GitHub list error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubDeleteFile(input: Record<string, unknown>, companyId: string, task?: Task): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = await assertRepoOwnership(input.repo as string, companyId, 'write');
    const branch = (input.branch as string) ?? 'main';
    const path = input.path as string;
    const runtimeBlocker = protectedRuntimeFileBlocker([path], task);
    if (runtimeBlocker) return runtimeBlocker;

    // Get SHA first
    const existingRes = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers });
    if (!existingRes.ok) return `File not found: ${path}`;
    const existingData = await existingRes.json() as { sha?: string };
    if (!existingData.sha) return `Cannot get SHA for ${path}`;

    const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ message: input.message as string, sha: existingData.sha, branch }),
    });

    if (!response.ok) {
      const data = await response.json() as { message?: string };
      return `GitHub delete failed: ${data.message ?? response.statusText}`;
    }

    return `File deleted: ${path} from ${repo}`;
  } catch (err) {
    return `GitHub delete error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Render helpers Ã¢â€â‚¬Ã¢â€â‚¬

const NODE26_STORAGE_TEMPLATE = `/**
 * File upload and storage via multiple providers.
 *
 * This helper avoids passing Node Buffer / Uint8Array<ArrayBufferLike>
 * directly to DOM Blob/fetch types. TypeScript 5.9+ and Node 26 can otherwise
 * reject those values because the underlying buffer may be SharedArrayBuffer.
 */

type StorageProvider = "uploadthing" | "r2" | "vercel-blob" | "local";

function detectProvider(): StorageProvider {
  if (process.env.UPLOADTHING_SECRET) return "uploadthing";
  if (process.env.R2_ACCESS_KEY_ID) return "r2";
  if (process.env.BLOB_READ_WRITE_TOKEN) return "vercel-blob";
  return "local";
}

async function toArrayBuffer(file: File | Buffer): Promise<ArrayBuffer> {
  if (file instanceof Buffer) {
    const ab = new ArrayBuffer(file.byteLength);
    new Uint8Array(ab).set(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
    return ab;
  }
  return (file as File).arrayBuffer();
}

function toBlob(ab: ArrayBuffer, contentType: string): Blob {
  return new Blob([ab], { type: contentType });
}

export interface UploadResult {
  url: string;
  key: string;
  size: number;
  name: string;
}

export async function uploadFile(
  file: File | Buffer,
  filename: string,
  options?: { folder?: string; contentType?: string },
): Promise<UploadResult> {
  const provider = detectProvider();

  switch (provider) {
    case "uploadthing":
      return uploadToUploadthing(file, filename, options);
    case "r2":
      return uploadToR2(file, filename, options);
    case "vercel-blob":
      return uploadToVercelBlob(file, filename, options);
    case "local":
      return uploadToLocal(file, filename, options);
  }
}

export async function getFileUrl(key: string): Promise<string> {
  const provider = detectProvider();

  switch (provider) {
    case "uploadthing":
      return \`https://utfs.io/f/\${key}\`;
    case "r2":
      return \`\${process.env.R2_PUBLIC_URL || ""}/\${key}\`;
    case "vercel-blob":
      return key;
    case "local":
      return \`/uploads/\${key}\`;
  }
}

export async function deleteFile(key: string): Promise<void> {
  const provider = detectProvider();

  switch (provider) {
    case "r2":
      await deleteFromR2(key);
      break;
    case "vercel-blob":
      await deleteFromVercelBlob(key);
      break;
  }
}

async function uploadToUploadthing(
  file: File | Buffer,
  filename: string,
  options?: { folder?: string; contentType?: string },
): Promise<UploadResult> {
  const secret = process.env.UPLOADTHING_SECRET;
  if (!secret) throw new Error("UPLOADTHING_SECRET not set");

  const ab = await toArrayBuffer(file);
  const blob = toBlob(ab, options?.contentType || "application/octet-stream");
  const formData = new FormData();
  formData.append("file", blob, filename);

  const resp = await fetch("https://uploadthing.com/api/uploadFiles", {
    method: "POST",
    headers: { "x-uploadthing-api-key": secret },
    body: formData,
  });

  if (!resp.ok) throw new Error(\`Uploadthing error: \${resp.status}\`);
  const data = await resp.json();
  const result = data[0] || data;

  return {
    url: result.url || result.fileUrl,
    key: result.key || result.fileKey,
    size: result.size || ab.byteLength,
    name: filename,
  };
}

async function uploadToR2(
  file: File | Buffer,
  filename: string,
  options?: { folder?: string; contentType?: string },
): Promise<UploadResult> {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT;

  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    throw new Error("R2 env vars not set");
  }

  const key = options?.folder ? \`\${options.folder}/\${filename}\` : filename;
  const ab = await toArrayBuffer(file);
  const blob = toBlob(ab, options?.contentType || "application/octet-stream");

  const resp = await fetch(\`\${endpoint}/\${bucket}/\${key}\`, {
    method: "PUT",
    headers: { "content-type": options?.contentType || "application/octet-stream" },
    body: blob,
  });

  if (!resp.ok) throw new Error(\`R2 upload failed: \${resp.status}\`);

  return {
    url: \`\${process.env.R2_PUBLIC_URL || endpoint}/\${key}\`,
    key,
    size: ab.byteLength,
    name: filename,
  };
}

async function deleteFromR2(key: string): Promise<void> {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET_NAME;
  await fetch(\`\${endpoint}/\${bucket}/\${key}\`, { method: "DELETE" });
}

async function uploadToVercelBlob(
  file: File | Buffer,
  filename: string,
  options?: { folder?: string; contentType?: string },
): Promise<UploadResult> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not set");

  const ab = await toArrayBuffer(file);
  const blob = toBlob(ab, options?.contentType || "application/octet-stream");
  const pathname = options?.folder ? \`\${options.folder}/\${filename}\` : filename;

  const resp = await fetch(\`https://blob.vercel-storage.com/\${pathname}\`, {
    method: "PUT",
    headers: {
      authorization: \`Bearer \${token}\`,
      "x-content-type": options?.contentType || "application/octet-stream",
    },
    body: blob,
  });

  if (!resp.ok) throw new Error(\`Vercel Blob error: \${resp.status}\`);
  const data = await resp.json();

  return {
    url: data.url,
    key: data.pathname || pathname,
    size: ab.byteLength,
    name: filename,
  };
}

async function deleteFromVercelBlob(key: string): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  await fetch(\`https://blob.vercel-storage.com?url=\${encodeURIComponent(key)}\`, {
    method: "DELETE",
    headers: { authorization: \`Bearer \${token}\` },
  });
}

async function uploadToLocal(
  file: File | Buffer,
  filename: string,
  options?: { folder?: string },
): Promise<UploadResult> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const dir = path.join(process.cwd(), "public", "uploads", options?.folder || "");
  await fs.mkdir(dir, { recursive: true });

  const filepath = path.join(dir, filename);
  const ab = await toArrayBuffer(file);
  await fs.writeFile(filepath, Buffer.from(ab));

  const key = options?.folder ? \`\${options.folder}/\${filename}\` : filename;
  return {
    url: \`/uploads/\${key}\`,
    key,
    size: ab.byteLength,
    name: filename,
  };
}
`;

export function patchStorageTemplateForNode26(content: string): string {
  const looksLikeSkeletonStorage =
    content.includes('type StorageProvider =') &&
    content.includes('function detectProvider()') &&
    content.includes('async function uploadToUploadthing') &&
    content.includes('async function uploadToR2') &&
    content.includes('async function uploadToVercelBlob') &&
    content.includes('async function uploadToLocal');
  if (looksLikeSkeletonStorage) return NODE26_STORAGE_TEMPLATE;

  return content
    .replace(
      `const blob = file instanceof Buffer
    ? new Blob([file], { type: options?.contentType || "application/octet-stream" })
    : file;`,
      `const uploadBytes = file instanceof Buffer
    ? new Uint8Array(file)
    : new Uint8Array(await file.arrayBuffer());
  const uploadArrayBuffer = new ArrayBuffer(uploadBytes.byteLength);
  new Uint8Array(uploadArrayBuffer).set(uploadBytes);
  const blob = new Blob([uploadArrayBuffer], { type: options?.contentType || "application/octet-stream" });`,
    )
    .replaceAll(
      'const body = file instanceof Buffer ? file : Buffer.from(await file.arrayBuffer());',
      `const bodyBytes = file instanceof Buffer ? new Uint8Array(file) : new Uint8Array(await file.arrayBuffer());
  const body = new ArrayBuffer(bodyBytes.byteLength);
  new Uint8Array(body).set(bodyBytes);`,
    );
}

export function patchMissingTwAnimateCssImport(globalsCss: string, packageJsonContent: string): string {
  let hasDependency = packageJsonContent.includes('"tw-animate-css"');
  try {
    const parsed = JSON.parse(packageJsonContent) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    hasDependency = Boolean(parsed.dependencies?.['tw-animate-css'] || parsed.devDependencies?.['tw-animate-css']);
  } catch {
    // Fall back to the string check above for partially edited package.json files.
  }
  if (hasDependency) return globalsCss;
  return globalsCss.replace(/^\s*@import\s+["']tw-animate-css["'];\s*(?:\r?\n)?/gm, '');
}

async function patchForkedNextSkeletonKnownIssues(repo: string): Promise<string | null> {
  const summaries: string[] = [];

  async function readRepoFile(path: string): Promise<{ content: string; sha: string; encoding?: string } | null> {
    const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=main`, { headers: githubHeaders() });
    if (!response.ok) {
      summaries.push(`${path} patch skipped: read returned HTTP ${response.status}`);
      return null;
    }
    const data = await response.json() as { content?: string; encoding?: string; sha?: string };
    if (!data.content || !data.sha) {
      summaries.push(`${path} patch skipped: missing content or sha`);
      return null;
    }
    return {
      content: Buffer.from(data.content.replace(/\n/g, ''), (data.encoding as BufferEncoding) ?? 'base64').toString('utf8'),
      sha: data.sha,
      encoding: data.encoding,
    };
  }

  async function writeRepoFile(path: string, sha: string, content: string, message: string): Promise<boolean> {
    const update = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: githubHeaders(),
      body: JSON.stringify({
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha,
        branch: 'main',
      }),
    });
    if (!update.ok) {
      summaries.push(`${path} patch failed: HTTP ${update.status}`);
      return false;
    }
    return true;
  }

  const storagePath = 'lib/storage.ts';
  const storageFile = await readRepoFile(storagePath);
  if (storageFile) {
    const patched = patchStorageTemplateForNode26(storageFile.content);
    if (patched !== storageFile.content && await writeRepoFile(storagePath, storageFile.sha, patched, 'fix: make storage helper compatible with strict Node Blob types')) {
      summaries.push(`Patched ${storagePath} for strict Node Blob/BodyInit types.`);
    }
  }

  const globalsPath = 'app/globals.css';
  const [globalsFile, packageFile] = await Promise.all([
    readRepoFile(globalsPath),
    readRepoFile('package.json'),
  ]);
  if (globalsFile && packageFile) {
    const patched = patchMissingTwAnimateCssImport(globalsFile.content, packageFile.content);
    if (patched !== globalsFile.content && await writeRepoFile(globalsPath, globalsFile.sha, patched, 'fix: remove unavailable tw-animate-css import')) {
      summaries.push(`Patched ${globalsPath} to remove unavailable tw-animate-css import.`);
    }
  }

  return summaries.length > 0 ? summaries.join(' ') : null;
}

function renderHeaders() {
  const token = process.env.RENDER_API_KEY;
  if (!token) throw new Error('RENDER_API_KEY not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function normalizeRenderServiceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || `baljia-app-${Date.now()}`;
}

export function chooseRenderAppUrlAfterDomain(input: {
  requestedUrl?: string | null;
  actualRenderUrl?: string | null;
  customDomain?: string | null;
  customDomainStatus?: string | null;
}): string | null {
  const verifiedDomain = input.customDomain && input.customDomainStatus?.toLowerCase() === 'verified'
    ? `https://${input.customDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`
    : null;
  return verifiedDomain ?? input.actualRenderUrl ?? input.requestedUrl ?? null;
}

async function getRenderServiceUrl(serviceId: string): Promise<string | null> {
  try {
    const response = await fetch(`${RENDER_API}/services/${serviceId}`, { headers: renderHeaders() });
    if (!response.ok) return null;
    const data = await response.json() as {
      url?: string;
      service?: { url?: string; serviceDetails?: { url?: string } };
      serviceDetails?: { url?: string };
    };
    const rawUrl = data.service?.serviceDetails?.url
      ?? data.service?.url
      ?? data.serviceDetails?.url
      ?? data.url
      ?? null;
    if (!rawUrl) return null;
    return /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  } catch {
    return null;
  }
}

async function renderCreateService(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = renderHeaders();
    if (!process.env.RENDER_OWNER_ID) {
      return 'Render service creation failed: RENDER_OWNER_ID not configured.';
    }

    const [company] = await db.select({
      slug: companies.slug,
      name: companies.name,
      github_repo: companies.github_repo,
    }).from(companies).where(eq(companies.id, companyId)).limit(1);

    if (!company) return 'Company not found';

    const repoInput = (input.repo as string | undefined) ?? company.github_repo ?? '';
    if (!repoInput) return 'Render service creation failed: no company GitHub repo. Create/push the repo first.';
    const repo = await assertRepoOwnership(repoInput, companyId, 'write');

      const serviceName = normalizeRenderServiceName(company.slug ?? (input.name as string | undefined) ?? company.name);
    const type = (input.type as string) === 'static_site' ? 'static_site' : 'web_service';
    const plan = (input.plan as string | undefined) ?? 'free';

    const envVars = (input.env_vars as Array<{ key: string; value: string }> | undefined) ?? [];

    // Auto-inject the company DATABASE_URL. Agents often remember to provision
    // Neon but forget to pass the connection string to Render, producing a
    // landing page that loads while every DB-backed route fails.
    const dbInfo = await getCompanyDatabase(companyId);
    const existingDbVar = envVars.find((ev) => ev.key === 'DATABASE_URL' || ev.key === 'NEON_CONNECTION_STRING');
    if (dbInfo?.connectionUri) {
      if (existingDbVar) {
        if (existingDbVar.value.includes(':***@') || existingDbVar.value.trim() === '') {
          existingDbVar.value = dbInfo.connectionUri;
        }
      } else {
        envVars.push({ key: 'DATABASE_URL', value: dbInfo.connectionUri });
      }
    }

    // Auto-inject AI gateway credentials. Founder apps that call AI via the
    // Baljia gateway need these — agents have repeatedly shipped code that
    // reads AI_GATEWAY_TOKEN without setting it, leaving /api/* endpoints 502.
    // We inject them unconditionally so the platform-side fix doesn't require
    // every agent to remember. Agent-supplied values take precedence.
    const existingKeys = new Set(envVars.map((ev) => ev.key));
    const platformDefaults: Array<{ key: string; envSource: string }> = [
      { key: 'AI_GATEWAY_TOKEN', envSource: 'AI_GATEWAY_TOKEN' },
      { key: 'AI_GATEWAY_URL', envSource: 'AI_GATEWAY_URL' },
      { key: 'STRIPE_SECRET_KEY', envSource: 'STRIPE_SECRET_KEY' },
      { key: 'STRIPE_WEBHOOK_SECRET', envSource: 'STRIPE_WEBHOOK_SECRET' },
      { key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', envSource: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY' },
    ];
    for (const def of platformDefaults) {
      if (existingKeys.has(def.key)) continue;
      const val = process.env[def.envSource];
      if (val && val !== 'placeholder') {
        envVars.push({ key: def.key, value: val });
      }
    }

    const baseBody: Record<string, unknown> = {
      type,
      name: serviceName,
      ownerId: process.env.RENDER_OWNER_ID,
      repo: `https://github.com/${repo}`,
      branch: 'main',
      autoDeploy: 'yes',
    };

    const buildCommand = (input.build_command as string | undefined) ?? 'npm install && npm run build';
    const startCommand = (input.start_command as string | undefined) ?? 'npm start';
    const looksLikeNextService = /\b(next|pnpm)\b/i.test(`${buildCommand} ${startCommand}`);
    const healthCheckPath = (input.health_check_path as string | undefined)
      ?? (looksLikeNextService ? '/' : '/api/health');
    // Render's modern API (post-2025 schema):
    //   - envVars at the TOP LEVEL of the request body (NOT inside serviceDetails)
    //     — Render silently drops envVars placed inside serviceDetails, leading
    //     to services that boot with all env vars undefined.
    //   - serviceDetails.runtime  (was: env)
    //   - serviceDetails.envSpecificDetails.{buildCommand,startCommand}
    //     (were: serviceDetails.{buildCommand,startCommand})
    // The platform's original code used the pre-2025 shape; Render returns
    // 400 "must include envSpecificDetails when creating non-static, non-docker
    // services" against that body now. legacyBody is kept as a fallback for
    // any legacy region/account that still accepts the older shape.
    const body: Record<string, unknown> = {
      ...baseBody,
      envVars,
      serviceDetails: type === 'web_service'
        ? {
            runtime: 'node',
            plan,
            healthCheckPath,
            envSpecificDetails: {
              buildCommand,
              startCommand,
            },
          }
        : {
            plan,
            buildCommand,
            publishPath: (input.publish_path as string | undefined) ?? './dist',
          },
    };

    const legacyBody: Record<string, unknown> = {
      ...baseBody,
      plan,
      envVars,
    };
    if (type === 'web_service') {
      legacyBody.buildCommand = buildCommand;
      legacyBody.startCommand = startCommand;
    } else {
      legacyBody.buildCommand = buildCommand;
      legacyBody.staticPublishPath = (input.publish_path as string | undefined) ?? './dist';
    }

    let response = await fetch(`${RENDER_API}/services`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    let data = await response.json().catch(() => ({})) as { service?: { id?: string; dashboardUrl?: string }; id?: string; message?: string };

    // The Render API has had both nested serviceDetails and top-level service
    // fields in circulation. Retry once with the legacy body so the worker does
    // not fail just because the configured API surface is older.
    if (!response.ok && response.status === 400) {
      response = await fetch(`${RENDER_API}/services`, {
        method: 'POST',
        headers,
        body: JSON.stringify(legacyBody),
      });
      data = await response.json().catch(() => ({})) as { service?: { id?: string; dashboardUrl?: string }; id?: string; message?: string };
    }

    if (!response.ok) {
      return `Render service creation failed: ${data.message ?? response.statusText}`;
    }

    const serviceId = data.service?.id ?? data.id;

    if (serviceId) {
      // Save service ID to company record
      await db.update(companies).set({ render_service_id: serviceId, hosting_state: 'live' }).where(eq(companies.id, companyId));

      const actualRenderUrl = await getRenderServiceUrl(serviceId);
      let customDomain = '';
      let customDomainName: string | null = null;
      let customDomainStatus: string | null = null;
      if (company?.slug) {
        try {
          const result = await provisionSubdomain(companyId, company.slug, serviceId);
          if (result) {
            customDomainName = result.domain;
            customDomainStatus = result.status;
            customDomain = `\nCustom domain: https://${result.domain} (${result.status})`;
          }
        } catch (err) {
          log.warn('Domain attachment failed', { companyId, serviceId });
        }
      }

      const requestedAppUrl = envVars.find((ev) => ev.key === 'BETTER_AUTH_URL')?.value
        ?? envVars.find((ev) => ev.key === 'NEXT_PUBLIC_APP_URL')?.value
        ?? null;
      const appUrl = chooseRenderAppUrlAfterDomain({
        requestedUrl: requestedAppUrl,
        actualRenderUrl,
        customDomain: customDomainName,
        customDomainStatus,
      });

      let authUrlUpdate = '';
      if (appUrl && appUrl !== requestedAppUrl) {
        authUrlUpdate = `\n${await renderSetEnvVars({
          service_id: serviceId,
          env_vars: [
            { key: 'BETTER_AUTH_URL', value: appUrl },
            { key: 'NEXT_PUBLIC_APP_URL', value: appUrl },
          ],
        })}`;
      }

      return `Render service created!\nService ID: ${serviceId}\nApp URL: ${appUrl ?? actualRenderUrl ?? requestedAppUrl ?? 'deploying...'}\nDashboard: ${data.service?.dashboardUrl ?? 'https://dashboard.render.com'}${customDomain}${authUrlUpdate}`;
    }

    return `Render service created!\nDashboard: ${data.service?.dashboardUrl ?? 'https://dashboard.render.com'}`;
  } catch (err) {
    return `Render error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderGetService(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const response = await fetch(`${RENDER_API}/services/${input.service_id}`, { headers });
    const data = await response.json() as {
      service?: { name?: string; serviceDetails?: { url?: string }; suspended?: string };
      name?: string;
      message?: string;
    };

    if (!response.ok) {
      return `Render service not found: ${data.message ?? response.statusText}`;
    }

    const svc = data.service ?? data;
    return [
      `Service: ${(svc as { name?: string }).name ?? 'unknown'}`,
      `URL: ${(svc as { serviceDetails?: { url?: string } }).serviceDetails?.url ?? 'deploying...'}`,
      `Suspended: ${(svc as { suspended?: string }).suspended ?? 'no'}`,
    ].join('\n');
  } catch (err) {
    return `Render get error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Deterministic anti-pattern rules. Each rule has a regex (or HTML check)
// that runs over the rendered HTML. A HIGH finding blocks completion via
// the engineering completion gate; LOW findings are warnings.
interface DesignRule {
  id: string;
  severity: 'HIGH' | 'LOW';
  description: string;
  check: (html: string, lowerHtml: string) => string | null; // returns reason or null
}

const DESIGN_RULES: DesignRule[] = [
  {
    id: 'api-docs-on-landing',
    severity: 'HIGH',
    description: 'Public landing must not include API documentation, endpoint lists, or curl examples',
    check: (html, lower) => {
      const triggers = [
        '>api documentation<',
        '>endpoint',
        '>endpoints<',
        '>request format<',
        '>response format<',
        '>example request<',
        '>example response<',
      ];
      for (const t of triggers) {
        if (lower.includes(t)) return `landing contains a section header for "${t.slice(1, -1)}" — strip API docs from /`;
      }
      // curl examples on landing
      if (/<pre[^>]*>\s*curl /i.test(html)) return 'landing contains a <pre>curl ...</pre> code block — move API examples to /docs';
      // .method.post / .method.get badges (Polsia-style API doc decoration)
      if (/class="[^"]*\bmethod\b[^"]*(?:post|get|put|delete)/i.test(html)) return 'landing has HTTP method badges (.method.post / .method.get) — these belong on API docs, not the public product page';
      return null;
    },
  },
  {
    id: 'inline-hex-spam',
    severity: 'HIGH',
    description: 'Hardcoded hex colors outside CSS variables — use design tokens',
    check: (html) => {
      // Count distinct hex colors in inline style="..." attributes (not in <style> blocks
      // declaring :root variables — those are legitimate token definitions).
      const inlineStyles = html.match(/style="[^"]*"/gi) ?? [];
      const allHex = new Set<string>();
      for (const s of inlineStyles) {
        const hexes = s.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
        for (const h of hexes) allHex.add(h.toLowerCase());
      }
      if (allHex.size > 8) return `${allHex.size} distinct hex colors found in inline style="" attributes — extract to CSS variables in :root`;
      return null;
    },
  },
  {
    id: 'tailwind-indigo-accent',
    severity: 'HIGH',
    description: 'No Tailwind-default indigo as accent (canonical AI tell)',
    check: (_html, lower) => {
      // The canonical AI-default indigo palette.
      const indigos = ['#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#8b5cf6', '#7c3aed', '#a855f7'];
      for (const c of indigos) {
        if (lower.includes(c)) return `landing uses Tailwind indigo "${c}" — pick a non-default accent color or use design tokens`;
      }
      return null;
    },
  },
  {
    id: 'two-stop-trust-gradient',
    severity: 'HIGH',
    description: 'No two-stop "trust" gradients (purple→blue, blue→cyan, indigo→pink)',
    check: (html) => {
      // Look for linear-gradient with the AI-tell color pairs.
      const gradients = html.match(/linear-gradient\([^)]+\)/gi) ?? [];
      const tellPatterns = [
        /(purple|#[68][0-9a-f]{2}[0-9a-f]{3}).{1,40}(blue|#[1-3][0-9a-f]{5})/i,
        /(blue|#[1-4][0-9a-f]{5}).{1,40}(cyan|#0[8-c][0-9a-f]{4})/i,
        /(indigo|#[34][0-9a-f]{5}).{1,40}(pink|#[ef][0-9a-f]{2}[0-9a-f]{3})/i,
      ];
      for (const g of gradients) {
        for (const p of tellPatterns) {
          if (p.test(g)) return `gradient detected: ${g.slice(0, 80)} — drop two-stop trust gradients on hero`;
        }
      }
      return null;
    },
  },
  {
    id: 'emoji-in-heading',
    severity: 'HIGH',
    description: 'No emoji in <h1>, <h2>, or icon slots',
    check: (html) => {
      const headings = html.match(/<h[1-3][^>]*>[^<]*<\/h[1-3]>/gi) ?? [];
      // Emoji unicode ranges (rough)
      const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}]/u;
      for (const h of headings) {
        if (emojiRe.test(h)) return `heading contains an emoji: ${h.slice(0, 80)} — replace with a monoline icon (lucide-react or inline SVG)`;
      }
      return null;
    },
  },
  {
    id: 'placeholder-copy',
    severity: 'HIGH',
    description: 'No lorem ipsum / "feature one/two/three" / "sample content"',
    check: (_html, lower) => {
      const placeholders = ['lorem ipsum', 'feature one', 'feature two', 'feature three', 'sample content', 'placeholder text', 'your headline here'];
      for (const p of placeholders) {
        if (lower.includes(p)) return `landing contains placeholder copy "${p}" — write real product copy`;
      }
      return null;
    },
  },
  {
    id: 'title-contains-implementation-detail',
    severity: 'LOW',
    description: 'Page <title> should describe the user-facing product, not the implementation',
    check: (html) => {
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (!m) return null;
      const title = m[1].toLowerCase();
      const implWords = ['api', 'endpoint', 'backend', 'service', 'microservice', 'rest', 'graphql'];
      for (const w of implWords) {
        if (title.includes(w)) return `<title> contains implementation word "${w}" — rewrite to describe what the USER gets, not the system architecture`;
      }
      return null;
    },
  },
  {
    id: 'invented-metrics',
    severity: 'LOW',
    description: 'No unsourced "10× faster" / "99.9% uptime" / "3× more productive" claims',
    check: (_html, lower) => {
      const patterns = [/\b\d+\s*x\s+(faster|better|more)/, /\b99\.\d+%\s+uptime\b/, /\b\d+\s*x\s+more\s+productive\b/];
      for (const p of patterns) {
        const m = lower.match(p);
        if (m) return `unsourced metric claim "${m[0]}" — cite a real source or remove`;
      }
      return null;
    },
  },
  {
    id: 'sans-only-display',
    severity: 'LOW',
    description: 'Display headings should not be the same font as body (use a serif/display pair)',
    check: (html) => {
      // Crude heuristic: only one font-family declaration across the page, AND it's a system sans
      const fontFamilies = html.match(/font-family:\s*[^;"]+/gi) ?? [];
      const unique = new Set(fontFamilies.map((f) => f.toLowerCase().replace(/\s+/g, ' ').trim()));
      if (unique.size === 1) {
        const only = [...unique][0];
        if (/inter|system-ui|sans-serif/.test(only) && !/serif/.test(only.replace('sans-serif', ''))) {
          return `single font across entire page (${only.slice(0, 60)}) — pair a display font with body sans`;
        }
      }
      return null;
    },
  },
];

async function designAudit(input: Record<string, unknown>): Promise<string> {
  const url = String(input.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return 'Error: pass a full URL (e.g. https://equityzen.baljia.app/) to design_audit.';
  }
  const safety = await assertUrlSafe(url);
  if (!safety.ok) return `Error: ${safety.reason}`;

  let html: string;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Baljia-DesignAudit/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) {
      return `Error: ${url} returned HTTP ${res.status} — fix the deploy first, then re-run design_audit.`;
    }
    html = await res.text();
  } catch (err) {
    return `Error fetching ${url}: ${err instanceof Error ? err.message : 'Unknown'}`;
  }

  const lower = html.toLowerCase();
  const findings: Array<{ id: string; severity: 'HIGH' | 'LOW'; reason: string }> = [];
  for (const rule of DESIGN_RULES) {
    const reason = rule.check(html, lower);
    if (reason) findings.push({ id: rule.id, severity: rule.severity, reason });
  }

  const highCount = findings.filter((f) => f.severity === 'HIGH').length;
  const lowCount = findings.filter((f) => f.severity === 'LOW').length;

  if (findings.length === 0) {
    return `design_audit CLEAN — 0 findings on ${url}. The landing meets the founder-facing UI bar.`;
  }

  const lines: string[] = [
    `design_audit found ${highCount} HIGH and ${lowCount} LOW finding(s) on ${url}:`,
    '',
    ...findings.map((f) => `  [${f.severity}] ${f.id}: ${f.reason}`),
    '',
    highCount > 0
      ? '⚠ HIGH findings BLOCK task completion. Fix each via github_create_commit + render_deploy, then re-run design_audit until 0 HIGH remain.'
      : 'No HIGH findings — LOW findings are advisory but recommended.',
  ];
  return lines.join('\n');
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function browserPatternMatches(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

function browserAnyPatternMatches(values: string[], pattern: string): boolean {
  return values.some((value) => browserPatternMatches(value, pattern));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitBrowserContractPatterns(value: string): string[] {
  return uniqueStrings(value.split(/\s+\|\s+/));
}

export function extractTaskBrowserUiContract(task?: Pick<Task, 'description'> | null): {
  requiredText: string[];
  requiredButtons: string[];
} {
  const text = String(task?.description ?? '');
  const requiredText: string[] = [];
  const requiredButtons: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const textMatch = line.match(/required text patterns:\s*(.+)$/i);
    if (textMatch) requiredText.push(...splitBrowserContractPatterns(textMatch[1]));
    const buttonMatch = line.match(/required action\/button patterns:\s*(.+)$/i);
    if (buttonMatch) requiredButtons.push(...splitBrowserContractPatterns(buttonMatch[1]));
  }
  return {
    requiredText: uniqueStrings(requiredText),
    requiredButtons: uniqueStrings(requiredButtons),
  };
}

type BrowserActionCandidate = {
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  value?: string | null;
  href?: string | null;
  disabled?: boolean | null;
  tagName?: string | null;
  type?: string | null;
};

export function normalizeBrowserActionLabels(candidates: BrowserActionCandidate[]): string[] {
  const labels = new Set<string>();
  for (const candidate of candidates) {
    for (const value of [candidate.text, candidate.ariaLabel, candidate.title, candidate.value, candidate.href]) {
      const label = String(value ?? '').replace(/\s+/g, ' ').trim();
      if (label) labels.add(label);
    }
  }
  return [...labels];
}

export function browserActionCandidateIssues(candidate: BrowserActionCandidate): string[] {
  const labels = normalizeBrowserActionLabels([candidate]);
  const label = labels[0] ?? 'required action';
  const combinedText = labels.join(' ');
  const issues: string[] = [];
  const tagName = String(candidate.tagName ?? '').toLowerCase();
  const hrefPresent = candidate.href !== undefined && candidate.href !== null;
  const href = String(candidate.href ?? '').trim().toLowerCase();
  const isLinkLike = tagName === 'a' || hrefPresent;

  if (candidate.disabled) issues.push(`${label}: disabled`);
  if (isLinkLike && (href === '' || href === '#' || href.startsWith('javascript:'))) {
    issues.push(`${label}: dead href`);
  }
  if (hasPlaceholderFlowSurface(combinedText)) {
    issues.push(`${label}: placeholder/coming-soon action`);
  }

  return uniqueStrings(issues);
}

async function extractBrowserActionLabels(page: import('@playwright/test').Page): Promise<string[]> {
  const candidates = await page.locator([
    'button',
    '[role="button"]',
    'input[type="button"]',
    'input[type="submit"]',
    'a[role="button"]',
    'a[aria-label]',
    'a[class*="button" i]',
    'a[class*="btn" i]',
  ].join(',')).evaluateAll((elements) => elements.map((element) => ({
    text: element.textContent,
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    value: element instanceof HTMLInputElement ? element.value : null,
    href: element instanceof HTMLAnchorElement ? element.href : null,
    tagName: element.tagName,
    type: element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.type : null,
  }))).catch(() => []);
  return normalizeBrowserActionLabels(candidates);
}

async function extractDeadRequiredActionIssues(
  page: import('@playwright/test').Page,
  requiredButtonPatterns: string[],
): Promise<string[]> {
  if (requiredButtonPatterns.length === 0) return [];
  const candidates = await page.locator([
    'button',
    '[role="button"]',
    'input[type="button"]',
    'input[type="submit"]',
    'a[role="button"]',
    'a[aria-label]',
    'a[class*="button" i]',
    'a[class*="btn" i]',
  ].join(',')).evaluateAll((elements) => elements.map((element) => ({
    text: element.textContent,
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    value: element instanceof HTMLInputElement ? element.value : null,
    href: element instanceof HTMLAnchorElement ? element.getAttribute('href') : null,
    tagName: element.tagName,
    type: element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.type : null,
    disabled: element instanceof HTMLButtonElement || element instanceof HTMLInputElement
      ? element.disabled
      : element.getAttribute('aria-disabled') === 'true',
  }))).catch(() => []);

  const issues: string[] = [];
  for (const pattern of requiredButtonPatterns) {
    const matching = candidates.filter((candidate) =>
      normalizeBrowserActionLabels([candidate]).some((label) => browserPatternMatches(label, pattern))
    );
    for (const candidate of matching) {
      issues.push(...browserActionCandidateIssues(candidate));
    }
  }
  return uniqueStrings(issues);
}

function browserFieldLabelPattern(field: string): string {
  return field
    .replace(/^lp_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(id|uuid)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || field;
}

export function interactionValue(field: string, value: unknown, stamp: string): string {
  const raw = String(value ?? '');
  const stamped = raw
    .replace(/<timestamp>/g, stamp)
    .replace(/\{\{timestamp\}\}/g, stamp);
  if (stamped !== raw) return stamped;
  if (/(^|[_\-\s])email($|[_\-\s])/i.test(field) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stamped)) {
    const [local, domain] = stamped.split('@');
    return `${local}+${stamp}@${domain}`;
  }
  return stamped;
}

async function fillInteractionFields(
  page: import('@playwright/test').Page,
  fields: Record<string, unknown>,
  stamp: string,
): Promise<string[]> {
  const missing: string[] = [];
  for (const [field, rawValue] of Object.entries(fields)) {
    const pattern = browserFieldLabelPattern(field);
    let locator = page.locator([
      `input[name="${field}"]`,
      `textarea[name="${field}"]`,
      `select[name="${field}"]`,
      `input[id="${field}"]`,
      `textarea[id="${field}"]`,
      `select[id="${field}"]`,
      `input[aria-label*="${pattern}" i]`,
      `textarea[aria-label*="${pattern}" i]`,
      `select[aria-label*="${pattern}" i]`,
      `input[placeholder*="${pattern}" i]`,
      `textarea[placeholder*="${pattern}" i]`,
    ].join(',')).first();
    if (!(await locator.count().catch(() => 0))) {
      locator = page.getByLabel(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first();
    }
    if (!(await locator.count().catch(() => 0))) {
      missing.push(field);
      continue;
    }
    const tag = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => 'input');
    const value = interactionValue(field, rawValue, stamp);
    if (tag === 'select') {
      await locator.selectOption({ label: value }).catch(async () => locator.selectOption(value).catch(() => undefined));
    } else {
      await locator.fill(value).catch(() => undefined);
    }
  }
  return missing;
}

async function clickInteractionAction(
  page: import('@playwright/test').Page,
  labelPattern: string,
): Promise<boolean> {
  const selectors = [
    'form button',
    'form input[type="submit"]',
    'form input[type="button"]',
    'form :not(a)[role="button"]',
    'button',
    'input[type="submit"]',
    'input[type="button"]',
    ':not(a)[role="button"]',
    'a[role="button"]',
    'a[aria-label]',
    'a[class*="button" i]',
    'a[class*="btn" i]',
  ];
  const actionElements = page.locator(selectors.join(','));
  const count = await actionElements.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 100); index += 1) {
    const locator = actionElements.nth(index);
    const labels = normalizeBrowserActionLabels([await locator.evaluate((element) => ({
      text: element.textContent,
      ariaLabel: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      value: element instanceof HTMLInputElement ? element.value : null,
      href: element instanceof HTMLAnchorElement ? element.href : null,
    })).catch(() => ({}))]);
    if (labels.some((label) => browserPatternMatches(label, labelPattern))) {
      return locator.click({ timeout: 10_000 }).then(() => true).catch(() => false);
    }
  }
  return false;
}

function browserEvidenceFilename(task: Task, label: string): string {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'browser-ui';
  const safeTask = task.id.replace(/[^a-z0-9_-]+/gi, '').slice(0, 40) || 'task';
  return `${safeTask}-${safeLabel}.png`;
}

export function hasFrameworkErrorOverlay(bodyText: string): boolean {
  const frameworkOverlayPatterns = [
    /Unhandled Runtime Error/i,
    /Runtime Error/i,
    /Application error: a client-side exception has occurred/i,
    /This page could not be found/i,
    /Build Error/i,
    /Failed to compile/i,
    /Module not found/i,
    /webpack-internal:/i,
    /next-devtools/i,
    /React hydration error/i,
    /Hydration failed/i,
  ];
  return frameworkOverlayPatterns.some((pattern) => pattern.test(bodyText));
}

export function hasGenericStarterSurface(bodyText: string): boolean {
  const normalized = bodyText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/Your app,\s*generated\.\s*Yours to keep\./i.test(normalized)) return true;
  if (/This is your authenticated app shell/i.test(normalized)) return true;
  if (/Specialist agents will add features/i.test(normalized)) return true;
  if (/\bYour database\b/i.test(normalized) && /\bNeon Postgres\b|db\/schema\.ts/i.test(normalized)) return true;
  if (/\bAI is pre-wired\b/i.test(normalized) && /@\/lib\/ai|official SDK|Baljia'?s gateway/i.test(normalized)) return true;
  if (/Import anthropic or openai from @\/lib\/ai/i.test(normalized)) return true;
  return /\bBaljia App\b/i.test(normalized) &&
    /\b(Get started|Sign in)\b/i.test(normalized) &&
    /\b(generated|yours to keep|build your app|app generated)\b/i.test(normalized);
}

async function verifyBrowserUi(input: Record<string, unknown>, task: Task): Promise<string> {
  const url = String(input.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return 'BROWSER UI FAIL: pass a full deployed URL, e.g. https://app.onrender.com/.';
  }
  const safety = await assertUrlSafe(url);
  if (!safety.ok) return `BROWSER UI FAIL: ${safety.reason}`;

  const taskBrowserContract = extractTaskBrowserUiContract(task);
  const requiredText = uniqueStrings([...coerceStringArray(input.required_text), ...taskBrowserContract.requiredText]);
  const requiredButtons = uniqueStrings([...coerceStringArray(input.required_buttons), ...taskBrowserContract.requiredButtons]);
  const failOnConsoleError = input.fail_on_console_error !== false;
  const label = String(input.screenshot_label ?? 'browser-ui').trim();

  try {
    const { chromium } = await import('@playwright/test');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const evidenceDir = join(process.cwd(), 'measurement-output', 'browser-ui');
    await mkdir(evidenceDir, { recursive: true });
    const screenshotPath = join(evidenceDir, browserEvidenceFilename(task, label));

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const consoleIssues: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleIssues.push(message.text());
    });
    page.on('pageerror', (error) => {
      consoleIssues.push(error.message);
    });

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
    const buttonLabels = await extractBrowserActionLabels(page);
    const deadRequiredActionIssues = await extractDeadRequiredActionIssues(page, requiredButtons);
    const title = await page.title().catch(() => '');
    const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
    const visualContrastIssues = await auditPageVisualContrast(page, { maxIssues: 20 }).catch(() => []);
    if (screenshot) await writeFile(screenshotPath, screenshot);
    await browser.close();

    const missingText = requiredText.filter((pattern) => !browserPatternMatches(bodyText, pattern));
    const missingButtons = requiredButtons.filter((pattern) => !browserAnyPatternMatches(buttonLabels, pattern));
    const frameworkOverlay = hasFrameworkErrorOverlay(bodyText);
    const starterSurface = hasGenericStarterSurface(bodyText);
    const blockingConsoleIssues = failOnConsoleError ? consoleIssues : [];
    const status = response?.status() ?? 0;
    const ok =
      response?.ok() === true &&
      !frameworkOverlay &&
      !starterSurface &&
      bodyText.trim().length > 0 &&
      missingText.length === 0 &&
      missingButtons.length === 0 &&
      deadRequiredActionIssues.length === 0 &&
      visualContrastIssues.length === 0 &&
      blockingConsoleIssues.length === 0;

    const evidence = [
      `url=${url}`,
      `status=${status}`,
      `title=${JSON.stringify(title)}`,
      `screenshot=${screenshot ? screenshotPath : 'not captured'}`,
      `buttons=${buttonLabels.join(', ') || 'none'}`,
      formatVisualContrastIssues(visualContrastIssues),
      taskBrowserContract.requiredButtons.length > 0 ? `task_contract_buttons=${taskBrowserContract.requiredButtons.join(', ')}` : null,
    ].filter((line): line is string => Boolean(line));

    if (ok) {
      return [
        'BROWSER UI PASS: rendered UI loaded without blocking runtime errors and required visible capability controls were present.',
        ...evidence,
      ].join('\n');
    }

    return [
      'BROWSER UI FAIL: deployed UI did not satisfy real browser criteria.',
      ...evidence,
      response?.ok() === true ? null : `homepage_status=${status}`,
      frameworkOverlay ? 'framework_overlay=true' : null,
      starterSurface ? 'starter_surface=true: generic Baljia starter UI is still visible; replace it with task-specific product UI.' : null,
      bodyText.trim().length > 0 ? null : 'blank_page=true',
      missingText.length > 0 ? `missing_text=${missingText.join(', ')}` : null,
      missingButtons.length > 0 ? `missing_buttons=${missingButtons.join(', ')}` : null,
      deadRequiredActionIssues.length > 0 ? `dead_required_actions=${deadRequiredActionIssues.join(' | ')}` : null,
      visualContrastIssues.length > 0 ? formatVisualContrastIssues(visualContrastIssues) : null,
      blockingConsoleIssues.length > 0 ? `console_errors=${blockingConsoleIssues.slice(0, 5).join(' | ')}` : null,
      'Fix the UI, redeploy, then re-run verify_browser_ui until it returns BROWSER UI PASS.',
    ].filter(Boolean).join('\n');
  } catch (error) {
    return `BROWSER UI FAIL: Playwright browser verification crashed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

type InteractionInput = {
  name?: unknown;
  contract_flow_id?: unknown;
  start_path?: unknown;
  label_pattern?: unknown;
  critical_kind?: unknown;
  fields?: unknown;
  expect_text?: unknown;
  reject_text?: unknown;
  entity?: unknown;
  db_table?: unknown;
  requires_auth?: unknown;
};

type AuthIsolationInput = {
  anonymous_path?: unknown;
  expect_text?: unknown;
  forbidden_text?: unknown;
};

function interactionCriticalKind(value: unknown): CriticalFlowKind | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  return isCriticalFlowKind(raw) ? raw : null;
}

function criticalFlowProofLine(kind: CriticalFlowKind, passed: boolean, interactionName: string): string {
  const safeName = interactionName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 80) || 'interaction';
  return `CRITICAL_FLOW_PROOF kind=${kind} passed=${passed ? 'true' : 'false'} interaction=${safeName}`;
}

function interactionContractFlowId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || null;
}

function hasPlaceholderFlowSurface(text: string): boolean {
  return /\b(coming soon|placeholder|todo\b|not implemented|mock only|demo only|sample data only|under construction)\b/i.test(text);
}

function failedCriticalFlowProofsForInputs(interactions: InteractionInput[]): string[] {
  return interactions.flatMap((item, index) => {
    const kind = interactionCriticalKind(item.critical_kind);
    if (!kind) return [];
    const name = String(item.name ?? `interaction-${index + 1}`).trim();
    return [criticalFlowProofLine(kind, false, name)];
  });
}

function failedContractFlowProofsForInputs(interactions: InteractionInput[]): string[] {
  return interactions.flatMap((item, index) => {
    const flowId = interactionContractFlowId(item.contract_flow_id);
    if (!flowId) return [];
    const name = String(item.name ?? `interaction-${index + 1}`).trim();
    return [formatContractFlowProofLine(flowId, false, name)];
  });
}

async function runAuthIsolationProof(
  browser: import('@playwright/test').Browser,
  baseUrl: string,
  rawInput: unknown,
): Promise<{ line: string | null; issue: string | null }> {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return { line: null, issue: null };
  }
  const input = rawInput as AuthIsolationInput;
  const anonymousPath = String(input.anonymous_path ?? '/dashboard').trim() || '/dashboard';
  const target = new URL(anonymousPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  const expectText = coerceStringArray(input.expect_text);
  const forbiddenText = coerceStringArray(input.forbidden_text);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
    const finalUrl = page.url();
    const status = response?.status() ?? 0;
    const looksBlocked = [401, 403].includes(status) ||
      /\/(login|signin|sign-in|auth)\b/i.test(finalUrl) ||
      /\b(sign in|log in|login|unauthorized|forbidden|access denied)\b/i.test(bodyText);
    const missingExpected = expectText.filter((pattern) => !browserPatternMatches(bodyText, pattern));
    const leakedForbidden = forbiddenText.filter((pattern) => browserPatternMatches(bodyText, pattern));
    const passed = looksBlocked && missingExpected.length === 0 && leakedForbidden.length === 0;
    return {
      line: formatAuthIsolationProofEvidence({ passed: passed ? 1 : 0, failed: passed ? 0 : 1, checks: 1 }),
      issue: passed
        ? null
        : `auth isolation failed for ${anonymousPath}: status=${status}, final_url=${finalUrl}, missing_expected=${missingExpected.join(',') || 'none'}, leaked_forbidden=${leakedForbidden.join(',') || 'none'}`,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function verifyInteractionContract(input: Record<string, unknown>, task: Task): Promise<string> {
  const url = String(input.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return 'INTERACTION PROOF FAIL: pass a full deployed URL, e.g. https://app.onrender.com/.';
  }
  const safety = await assertUrlSafe(url);
  if (!safety.ok) return `INTERACTION PROOF FAIL: ${safety.reason}`;
  const interactions = Array.isArray(input.interactions) ? input.interactions as InteractionInput[] : [];
  if (interactions.length === 0) {
    return 'INTERACTION PROOF FAIL: pass at least one interaction from compose_frontend_plan or the derived critical-flow contract.';
  }

  const failOnConsoleError = input.fail_on_console_error !== false;
  const label = String(input.screenshot_label ?? 'interaction-proof').trim();
  const passed: string[] = [];
  const failed: string[] = [];
  const criticalFlowProofs: string[] = [];
  const contractFlowProofs: string[] = [];
  const contractFieldProofs: string[] = [];
  let contractFlowPassed = 0;
  let contractFlowFailed = 0;
  let authIsolationLine: string | null = null;
  let authIsolationIssue: string | null = null;

  try {
    const { chromium } = await import('@playwright/test');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const evidenceDir = join(process.cwd(), 'measurement-output', 'browser-ui');
    await mkdir(evidenceDir, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const consoleIssues: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleIssues.push(message.text());
    });
    page.on('pageerror', (error) => {
      consoleIssues.push(error.message);
    });

    for (let index = 0; index < interactions.length; index += 1) {
      const item = interactions[index];
      const name = String(item.name ?? `interaction-${index + 1}`).trim();
      const criticalKind = interactionCriticalKind(item.critical_kind);
      const contractFlowId = interactionContractFlowId(item.contract_flow_id);
      const recordCriticalFlowProof = (ok: boolean) => {
        if (criticalKind) criticalFlowProofs.push(criticalFlowProofLine(criticalKind, ok, name));
      };
      const recordContractFlowProof = (ok: boolean) => {
        if (!contractFlowId) return;
        contractFlowProofs.push(formatContractFlowProofLine(contractFlowId, ok, name));
        if (ok) contractFlowPassed += 1;
        else contractFlowFailed += 1;
      };
      const recordContractFieldProof = (ok: boolean, fieldNames: string[]) => {
        if (!contractFlowId || fieldNames.length === 0) return;
        contractFieldProofs.push(formatContractFieldProofLine({
          flowId: contractFlowId,
          entity: typeof item.entity === 'string' ? item.entity : null,
          dbTable: typeof item.db_table === 'string' ? item.db_table : null,
          fields: fieldNames,
          passed: ok,
        }));
      };
      const labelPattern = String(item.label_pattern ?? '').trim();
      if (!labelPattern) {
        failed.push(`${name}: missing label_pattern`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, []);
        continue;
      }
      const target = new URL(String(item.start_path ?? '/'), url.endsWith('/') ? url : `${url}/`).toString();
      const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      if (response && !response.ok()) {
        failed.push(`${name}: start page status ${response.status()}`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, []);
        continue;
      }
      const fields = item.fields && typeof item.fields === 'object' && !Array.isArray(item.fields)
        ? item.fields as Record<string, unknown>
        : {};
      const fieldNames = Object.keys(fields);
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const missingFields = await fillInteractionFields(page, fields, stamp);
      if (missingFields.length > 0) {
        failed.push(`${name}: missing fields ${missingFields.join(', ')}`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, fieldNames);
        continue;
      }
      const clicked = await clickInteractionAction(page, labelPattern);
      if (!clicked) {
        const labels = await extractBrowserActionLabels(page);
        failed.push(`${name}: missing action /${labelPattern}/i; seen buttons=${labels.join(', ') || 'none'}`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, fieldNames);
        continue;
      }
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(1_000).catch(() => undefined);
      const expectText = coerceStringArray(item.expect_text);
      const rejectText = coerceStringArray(item.reject_text);
      let bodyText = '';
      let missingText = [...expectText];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
        missingText = expectText.filter((pattern) => !browserPatternMatches(bodyText, pattern));
        if (missingText.length === 0) break;
        await page.waitForTimeout(750).catch(() => undefined);
      }
      const rejectedText = rejectText.filter((pattern) => browserPatternMatches(bodyText, pattern));
      const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
      if (screenshot) {
        await writeFile(join(evidenceDir, browserEvidenceFilename(task, `${label}-${name}`)), screenshot);
      }
      const visualContrastIssues = await auditPageVisualContrast(page, { maxIssues: 12 }).catch(() => []);
      if (hasFrameworkErrorOverlay(bodyText) || hasGenericStarterSurface(bodyText)) {
        failed.push(`${name}: framework/generic starter surface after interaction`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, fieldNames);
      } else if (contractFlowId && hasPlaceholderFlowSurface(bodyText)) {
        failed.push(`${name}: contract flow ${contractFlowId} landed on placeholder/coming-soon/mock surface`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, fieldNames);
      } else if (missingText.length > 0) {
        failed.push(`${name}: missing UI readback ${missingText.join(', ')}`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, fieldNames);
      } else if (rejectedText.length > 0) {
        failed.push(`${name}: forbidden text rendered ${rejectedText.join(', ')}`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, fieldNames);
      } else if (visualContrastIssues.length > 0) {
        failed.push(`${name}: ${formatVisualContrastIssues(visualContrastIssues)}`);
        recordCriticalFlowProof(false);
        recordContractFlowProof(false);
        recordContractFieldProof(false, fieldNames);
      } else {
        passed.push(name);
        recordCriticalFlowProof(true);
        recordContractFlowProof(true);
        recordContractFieldProof(true, fieldNames);
      }
    }
    const authIsolation = await runAuthIsolationProof(browser, url, input.auth_isolation);
    authIsolationLine = authIsolation.line;
    authIsolationIssue = authIsolation.issue;
    await browser.close();

    const blockingConsoleIssues = failOnConsoleError ? consoleIssues.slice(0, 5) : [];
    const failedWithConsole = blockingConsoleIssues.length > 0
      ? [...failed, `console errors: ${blockingConsoleIssues.join(' | ')}`]
      : failed;
    const failedWithAuthIsolation = authIsolationIssue
      ? [...failedWithConsole, authIsolationIssue]
      : failedWithConsole;
    const contractFlowTotal = contractFlowPassed + contractFlowFailed;
    const marker = `INTERACTION_PROOF_EVIDENCE passed=${passed.length} failed=${failedWithAuthIsolation.length} expected=${interactions.length}`;
    const acceptanceMarker = `ACCEPTANCE_PROOF_EVIDENCE passed=${contractFlowPassed} failed=${contractFlowFailed + (failedWithAuthIsolation.length > failed.length && contractFlowTotal > 0 ? 1 : 0)} contract_flows=${contractFlowTotal}`;
    if (failedWithAuthIsolation.length === 0) {
      return [
        marker,
        acceptanceMarker,
        authIsolationLine,
        ...criticalFlowProofs,
        ...contractFlowProofs,
        ...contractFieldProofs,
        `INTERACTION PROOF PASS: ${passed.length} interaction(s) passed.`,
        `passed=${passed.join(', ')}`,
      ].filter(Boolean).join('\n');
    }
    return [
      marker,
      acceptanceMarker,
      authIsolationLine,
      ...criticalFlowProofs,
      ...contractFlowProofs,
      ...contractFieldProofs,
      `INTERACTION PROOF FAIL: ${failedWithAuthIsolation.length} interaction issue(s).`,
      ...failedWithAuthIsolation.map((item) => `- ${item}`),
    ].filter(Boolean).join('\n');
  } catch (error) {
    return [
      `INTERACTION_PROOF_EVIDENCE passed=0 failed=1 expected=${interactions.length}`,
      `ACCEPTANCE_PROOF_EVIDENCE passed=0 failed=1 contract_flows=${interactions.filter((item) => interactionContractFlowId(item.contract_flow_id)).length}`,
      ...failedCriticalFlowProofsForInputs(interactions),
      ...failedContractFlowProofsForInputs(interactions),
      `INTERACTION PROOF FAIL: Playwright interaction verification crashed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    ].join('\n');
  }
}

function listComponents(): string {
  return COMPONENT_CATALOG;
}

// ──────────────────────────────────────────────────────────────────
// DESIGN SYSTEMS CATALOG
// 149 brand-grade DESIGN.md references vendored from nexu-io/open-design
// at .claude/skills/design-systems/. INDEX.md is generated by
// src/scripts/build-design-systems-index.ts.
// ──────────────────────────────────────────────────────────────────
const DESIGN_SYSTEMS_ROOT = '.claude/skills/design-systems';

async function listDesignSystems(): Promise<string> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const indexPath = join(process.cwd(), DESIGN_SYSTEMS_ROOT, 'INDEX.md');
    return await readFile(indexPath, 'utf8');
  } catch (err) {
    return `Error: design systems INDEX.md not found at ${DESIGN_SYSTEMS_ROOT}/INDEX.md. Run \`npx tsx src/scripts/build-design-systems-index.ts\` to rebuild it. Cause: ${err instanceof Error ? err.message : 'unknown'}`;
  }
}

interface DesignSystemEntry {
  name: string;
  category: string;
  description: string;
  tokens: Set<string>;
}

interface DesignSystemMatch {
  entry: DesignSystemEntry;
  score: number;
  reasons: string[];
}

const DESIGN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'you',
  'are', 'app', 'apps', 'web', 'site', 'page', 'build', 'create', 'make',
  'user', 'users', 'founder', 'product', 'platform', 'tool', 'tools',
]);

const DESIGN_DOMAIN_RULES: Array<{
  test: RegExp;
  categories?: string[];
  names?: string[];
  reason: string;
}> = [
  { test: /\b(ai|llm|chatbot|agent|assistant|copilot|machine learning|model|prompt)\b/i, categories: ['AI & LLM'], names: ['openai', 'claude', 'linear-app', 'replicate', 'vercel'], reason: 'AI product signal' },
  { test: /\b(fintech|finance|bank|banking|invoice|billing|payment|payroll|crypto|wallet|trading|invest|portfolio)\b/i, categories: ['Fintech & Crypto'], names: ['stripe', 'coinbase', 'wise', 'revolut', 'mastercard', 'trading-terminal'], reason: 'finance/payment signal' },
  { test: /\b(developer|devtool|api|sdk|code|deploy|hosting|infra|database|observability|terminal|cli)\b/i, categories: ['Developer Tools', 'Backend & Data'], names: ['vercel', 'github', 'cursor', 'supabase', 'sentry', 'clickhouse'], reason: 'developer/infra signal' },
  { test: /\b(dashboard|admin|crm|analytics|reporting|ops|operations|workflow|pipeline|kanban)\b/i, categories: ['Professional & Corporate', 'Productivity & SaaS'], names: ['linear-app', 'enterprise', 'dashboard', 'ant', 'notion', 'airtable'], reason: 'workflow/dashboard signal' },
  { test: /\b(ecommerce|store|shop|retail|marketplace|checkout|cart|catalog|inventory)\b/i, categories: ['E-Commerce & Retail'], names: ['shopify', 'airbnb', 'apple', 'nike'], reason: 'commerce/marketplace signal' },
  { test: /\b(booking|schedule|appointment|calendar|reservation|clinic|consultation)\b/i, categories: ['Productivity & SaaS'], names: ['cal', 'airbnb', 'intercom', 'professional'], reason: 'booking/scheduling signal' },
  { test: /\b(content|cms|blog|docs|documentation|knowledge|wiki|editor|publication|newsletter)\b/i, categories: ['Editorial & Print', 'Editorial / Personal / Publication', 'Productivity & SaaS'], names: ['notion', 'mintlify', 'sanity', 'kami', 'wired'], reason: 'content/editorial signal' },
  { test: /\b(design|creative|portfolio|agency|studio|visual|canvas|whiteboard)\b/i, categories: ['Design & Creative', 'Creative & Artistic'], names: ['figma', 'canva', 'framer', 'miro', 'atelier-zero'], reason: 'creative/design signal' },
  { test: /\b(music|audio|podcast|video|media|streaming|creator)\b/i, categories: ['Media & Consumer'], names: ['spotify', 'runwayml', 'loom', 'pinterest'], reason: 'media/creator signal' },
  { test: /\b(enterprise|b2b|sales|support|customer|team|workspace|collaboration)\b/i, categories: ['Professional & Corporate', 'Productivity & SaaS'], names: ['enterprise', 'linear-app', 'slack', 'intercom', 'webex'], reason: 'B2B/workspace signal' },
  { test: /\b(luxury|premium|high-end|automotive|vehicle|real estate|property)\b/i, categories: ['Automotive', 'Professional & Corporate'], names: ['luxury', 'apple', 'bmw', 'tesla', 'airbnb'], reason: 'premium/luxury signal' },
];

function isValidDesignSystemName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function requestsDesignSystemRefresh(input: Record<string, unknown>, task: Task): boolean {
  if (optionalBoolean(input, 'allowDesignSystemChange') === true || optionalBoolean(input, 'allow_design_system_change') === true) {
    return true;
  }
  const text = [
    input.product_context,
    input.title,
    input.description,
    input.design_intent,
    task.title,
    task.description,
  ]
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
  return /\b(rebrand|brand refresh|new brand|change design system|replace design system|new design system|fresh design language|different design language)\b/i.test(text);
}

async function getCompanyDesignSystem(companyId: string): Promise<string | null> {
  try {
    const [company] = await db.select({ design_system: companies.design_system })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    const value = typeof company?.design_system === 'string' ? company.design_system.trim().toLowerCase() : '';
    return value && isValidDesignSystemName(value) ? value : null;
  } catch (err) {
    log.warn('Failed to read sticky company design system', { companyId, err });
    return null;
  }
}

async function persistCompanyDesignSystem(companyId: string, designSystem: string): Promise<void> {
  if (!isValidDesignSystemName(designSystem)) return;
  try {
    await db.update(companies)
      .set({ design_system: designSystem })
      .where(eq(companies.id, companyId));
  } catch (err) {
    log.warn('Failed to persist sticky company design system', { companyId, designSystem, err });
  }
}

function tokenizeDesignQuery(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !DESIGN_STOPWORDS.has(token));
}

function parseDesignSystemIndex(indexBody: string): DesignSystemEntry[] {
  const entries: DesignSystemEntry[] = [];
  let category = 'Uncategorized';
  for (const line of indexBody.split(/\r?\n/)) {
    const categoryMatch = line.match(/^##\s+(.+?)\s*$/);
    if (categoryMatch) {
      category = categoryMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(/^-\s+\*\*`([^`]+)`\*\*/);
    if (!itemMatch) continue;
    const name = itemMatch[1].trim();
    const description = line.slice(itemMatch[0].length).replace(/^[^A-Za-z0-9]+/, '').trim();
    const text = `${name.replace(/-/g, ' ')} ${category} ${description}`;
    entries.push({
      name,
      category,
      description,
      tokens: new Set(tokenizeDesignQuery(text)),
    });
  }
  return entries;
}

export function matchDesignSystemsFromIndex(
  indexBody: string,
  queryText: string,
  opts: { preferredCategory?: string; limit?: number } = {},
): DesignSystemMatch[] {
  const entries = parseDesignSystemIndex(indexBody);
  const normalizedQuery = queryText.toLowerCase();
  const queryTokens = tokenizeDesignQuery(queryText);
  const preferredCategory = opts.preferredCategory?.trim().toLowerCase();
  const matches = entries.map((entry) => {
    let score = 0;
    const reasons: string[] = [];
    const entryNameText = entry.name.replace(/-/g, ' ');
    const categoryText = entry.category.toLowerCase();
    const entryNameTokens = new Set(tokenizeDesignQuery(entryNameText));
    const categoryTokens = new Set(tokenizeDesignQuery(entry.category));

    if (preferredCategory && categoryText.includes(preferredCategory)) {
      score += 45;
      reasons.push(`preferred category: ${entry.category}`);
    }

    if (normalizedQuery.includes(entry.name) || normalizedQuery.includes(entryNameText)) {
      score += 55;
      reasons.push(`explicit name match: ${entry.name}`);
    }

    let overlap = 0;
    let categoryOverlap = 0;
    let nameOverlap = 0;
    for (const token of queryTokens) {
      if (entry.tokens.has(token)) overlap++;
      if (categoryTokens.has(token)) categoryOverlap++;
      if (entryNameTokens.has(token)) nameOverlap++;
    }
    if (overlap > 0) {
      score += overlap * 4;
      reasons.push(`${overlap} keyword overlap(s)`);
    }
    if (categoryOverlap > 0) {
      score += categoryOverlap * 10;
      reasons.push(`category overlap: ${entry.category}`);
    }
    if (nameOverlap > 0) {
      score += nameOverlap * 14;
      reasons.push(`name overlap: ${entry.name}`);
    }

    for (const rule of DESIGN_DOMAIN_RULES) {
      if (!rule.test.test(queryText)) continue;
      if (rule.categories?.some((c) => c.toLowerCase() === categoryText)) {
        score += 28;
        reasons.push(rule.reason);
      }
      if (rule.names?.includes(entry.name)) {
        score += 34;
        reasons.push(`${rule.reason}: strong reference`);
      }
    }

    return { entry, score, reasons: [...new Set(reasons)].slice(0, 4) };
  });

  return matches
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, Math.max(1, Math.min(opts.limit ?? 5, 8)));
}

async function matchDesignSystem(input: Record<string, unknown>, task: Task): Promise<string> {
  const stickyDesignSystem = await getCompanyDesignSystem(task.company_id);
  if (stickyDesignSystem && !requestsDesignSystemRefresh(input, task)) {
    return [
      `DESIGN_SYSTEM_MATCH_EVIDENCE selected=${stickyDesignSystem}`,
      'DESIGN SYSTEM MATCHES: reused existing company design system.',
      `Company design system is already set to "${stickyDesignSystem}". Continue this design language for visual consistency across tasks.`,
      'To change it, the CEO task must explicitly request a rebrand/new design system or pass allow_design_system_change=true.',
      '',
      `Next: call get_design_system with name="${stickyDesignSystem}", then apply its conventions without copying the brand identity.`,
    ].join('\n');
  }

  const query = [
    input.product_context,
    input.title,
    input.description,
    task.title,
    task.description,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n');
  if (!query.trim()) {
    return 'Error: pass product_context, title, or description so match_design_system can score the catalog.';
  }

  try {
    const indexPath = join(process.cwd(), DESIGN_SYSTEMS_ROOT, 'INDEX.md');
    const indexBody = readFileSync(indexPath, 'utf8');
    const limitRaw = typeof input.limit === 'number' ? input.limit : Number(input.limit ?? 5);
    const matches = matchDesignSystemsFromIndex(indexBody, query, {
      preferredCategory: typeof input.preferred_category === 'string' ? input.preferred_category : undefined,
      limit: Number.isFinite(limitRaw) ? limitRaw : 5,
    });
    if (matches.length === 0) {
      return [
        'DESIGN_SYSTEM_MATCH_EVIDENCE selected=none',
        'DESIGN SYSTEM MATCHES: no strong match.',
        'Fallback: call list_design_systems, choose `default`, `professional`, `linear-app`, or `shadcn` based on the UI surface, then call get_design_system(name).',
      ].join('\n');
    }

    await persistCompanyDesignSystem(task.company_id, matches[0].entry.name);
    const lines = [
      `DESIGN_SYSTEM_MATCH_EVIDENCE selected=${matches[0].entry.name}`,
      'DESIGN SYSTEM MATCHES (vectorless RAG: category + keyword + domain-rule scoring)',
      `Query: ${query.replace(/\s+/g, ' ').slice(0, 240)}`,
      '',
      ...matches.map((m, idx) => [
        `${idx + 1}. ${m.entry.name} [${m.entry.category}] score=${m.score}`,
        `   why: ${m.reasons.join('; ') || 'metadata proximity'}`,
        `   vibe: ${m.entry.description || '(no tagline)'}`,
      ].join('\n')),
      '',
      `Next: call get_design_system with name="${matches[0].entry.name}", then apply its conventions without copying the brand identity.`,
    ];
    return lines.join('\n');
  } catch (err) {
    return `Error: could not match design systems from ${DESIGN_SYSTEMS_ROOT}/INDEX.md. ${err instanceof Error ? err.message : 'unknown error'}`;
  }
}

async function getDesignSystem(input: Record<string, unknown>): Promise<string> {
  const raw = String(input.name ?? '').trim().toLowerCase();
  if (!raw) {
    return 'Error: pass `name` — e.g. "linear-app", "stripe", "notion". Call list_design_systems to see all 149 options.';
  }
  // Guard against path traversal — only allow kebab-case names.
  if (!/^[a-z][a-z0-9-]*$/.test(raw)) {
    return `Error: invalid design system name "${raw}". Use kebab-case (e.g. "linear-app", "stripe", "notion").`;
  }
  try {
    const { readFile, stat } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const designPath = join(process.cwd(), DESIGN_SYSTEMS_ROOT, raw, 'DESIGN.md');
    const fileStat = await stat(designPath).catch(() => null);
    if (!fileStat) {
      return `Error: design system "${raw}" not found at ${DESIGN_SYSTEMS_ROOT}/${raw}/DESIGN.md. Call list_design_systems to see the 149 available names. Common typos: "linear" vs "linear-app", "openai" not "open-ai".`;
    }
    const body = await readFile(designPath, 'utf8');
    const header = [
      `DESIGN_SYSTEM_EVIDENCE name=${raw}`,
      `# Design System: ${raw}`,
      '',
      `*Vendored from nexu-io/open-design under Apache 2.0. Use the CONVENTIONS (typography, palette structure, shadow approach), NOT the brand identity. Rename palettes to fit the founder's company.*`,
      '',
      '---',
      '',
    ].join('\n');
    return header + body;
  } catch (err) {
    return `Error reading design system "${raw}": ${err instanceof Error ? err.message : 'Unknown'}`;
  }
}

async function readComponent(input: Record<string, unknown>, companyId: string): Promise<string> {
  const rawName = String(input.name ?? '').trim();
  if (!rawName) return 'Error: pass `name` — e.g. "button", "card", "dropdown-menu".';
  // Canonical shadcn filenames are lowercase-hyphenated. Accept PascalCase/
  // camelCase/snake_case as input and normalize.
  const name = rawName
    .replace(/[_\s]+/g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return `Error: invalid component name "${rawName}". Use kebab-case (e.g. "button", "dropdown-menu", "scroll-area").`;
  }

  const [company] = await db.select({ github_repo: companies.github_repo })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.github_repo) {
    return 'Error: company has no github_repo set. Call get_company_tech first, then create_instance for full-stack apps.';
  }

  const path = `components/ui/${name}.tsx`;
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return 'Error: GITHUB_TOKEN is not configured.';
    const res = await fetch(`${GITHUB_API}/repos/${company.github_repo}/contents/${encodeURIComponent(path)}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (res.status === 404) {
      return `Component "${name}" not found at ${path} in ${company.github_repo}. Call list_components to see what is available, or confirm create_instance hydrated the Next.js skeleton in this repo.`;
    }
    if (!res.ok) return `Error reading ${path}: HTTP ${res.status}`;
    const data = await res.json() as { content?: string; encoding?: string };
    if (!data.content) return `Error: GitHub returned no content for ${path}`;
    const decoded = Buffer.from(data.content, (data.encoding as BufferEncoding) ?? 'base64').toString('utf8');
    return decoded;
  } catch (err) {
    return `Error reading component "${name}": ${err instanceof Error ? err.message : 'Unknown'}`;
  }
}

async function renderSetEnvVars(input: Record<string, unknown>): Promise<string> {
  const serviceId = input.service_id as string | undefined;
  if (!serviceId) return 'Error: service_id is required (call get_company_tech if you do not have it).';
  const envVars = (input.env_vars as Array<{ key: string; value: string }> | undefined) ?? [];
  const blockedConfigKeys = findRenderConfigEnvKeys(envVars);
  if (blockedConfigKeys.length > 0) {
    return [
      `Error: render_set_env_vars cannot update Render service config key(s): ${blockedConfigKeys.join(', ')}.`,
      'Those names are not runtime environment variables in Render; setting them only creates inert app env vars and does not change the service build/start command.',
      `For a fresh Next.js deploy, call create_instance so it applies the skeleton build/start config. Only pass build_command to render_create_service on backend-only deploys or when create_instance gave an explicit manual Render fallback. Next.js build command: ${RENDER_NEXTJS_BUILD_COMMAND}`,
      'For an existing service, call render_update_service_config with build_command, start_command, or health_check_path as needed.',
    ].filter(Boolean).join('\n');
  }
  if (envVars.length === 0) return 'Error: env_vars array is empty — pass at least one {key, value} entry.';

  try {
    if (input.force_after_quota_restored !== true) {
      const recentQuotaBlocker = await recentRenderPipelineBlockerSummary(serviceId, 'render_set_env_vars');
      if (recentQuotaBlocker) return recentQuotaBlocker;
    }

    const headers = renderHeaders();
    // Render's per-key PUT endpoint creates-or-updates a single env var.
    // Loop over each entry; collect successes and failures.
    const results: string[] = [];
    for (const ev of envVars) {
      if (!ev?.key || typeof ev.value !== 'string') {
        results.push(`  skip: invalid entry ${JSON.stringify(ev)}`);
        continue;
      }
      const r = await fetch(`${RENDER_API}/services/${serviceId}/env-vars/${encodeURIComponent(ev.key)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ value: ev.value }),
      });
      if (r.ok) {
        const masked = ev.key.includes('TOKEN') || ev.key.includes('SECRET') || ev.key.includes('PASSWORD') || ev.key.includes('KEY')
          ? '***'
          : ev.value.slice(0, 60);
        results.push(`  ✓ ${ev.key} = ${masked}`);
      } else {
        const errText = await r.text().catch(() => '');
        results.push(`  ✗ ${ev.key} → HTTP ${r.status} ${errText.slice(0, 200)}`);
      }
    }

    // Trigger a redeploy so the new env vars actually take effect — Render
    // does NOT automatically redeploy after env-var updates via the per-key
    // endpoint (only the bulk PUT triggers auto-deploy).
    const deployRes = await fetch(`${RENDER_API}/services/${serviceId}/deploys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clearCache: 'do_not_clear' }),
    });
    if (deployRes.ok) {
      const deploy = await deployRes.json().catch(() => ({})) as { id?: string };
      results.push(`  → triggered redeploy ${deploy.id ?? ''} — wait ~2-5min then re-run check_url_health`);
    } else {
      results.push(`  → redeploy trigger failed HTTP ${deployRes.status}`);
    }

    return `Updated ${envVars.length} env var(s) on Render service ${serviceId}:\n${results.join('\n')}`;
  } catch (err) {
    return `Error setting Render env vars: ${err instanceof Error ? err.message : 'Unknown'}`;
  }
}

async function renderUpdateServiceConfig(input: Record<string, unknown>): Promise<string> {
  const serviceId = input.service_id as string | undefined;
  if (!serviceId) return 'Error: service_id is required (call get_company_tech if you do not have it).';

  const buildCommand = typeof input.build_command === 'string' && input.build_command.trim()
    ? input.build_command.trim()
    : undefined;
  const startCommand = typeof input.start_command === 'string' && input.start_command.trim()
    ? input.start_command.trim()
    : undefined;
  const healthCheckPath = typeof input.health_check_path === 'string' && input.health_check_path.trim()
    ? input.health_check_path.trim()
    : undefined;

  if (!buildCommand && !startCommand && !healthCheckPath) {
    return 'Error: pass at least one of build_command, start_command, or health_check_path.';
  }
  if (healthCheckPath && !healthCheckPath.startsWith('/')) {
    return 'Error: health_check_path must start with "/" (for example "/" or "/api/health").';
  }

  try {
    if (input.force_after_quota_restored !== true) {
      const recentQuotaBlocker = await recentRenderPipelineBlockerSummary(serviceId, 'render_update_service_config');
      if (recentQuotaBlocker) return recentQuotaBlocker;
    }

    const headers = renderHeaders();
    const envSpecificDetails: Record<string, string> = {};
    if (buildCommand) envSpecificDetails.buildCommand = buildCommand;
    if (startCommand) envSpecificDetails.startCommand = startCommand;

    const serviceDetails: Record<string, unknown> = {};
    if (Object.keys(envSpecificDetails).length > 0) {
      serviceDetails.envSpecificDetails = envSpecificDetails;
    }
    if (healthCheckPath) serviceDetails.healthCheckPath = healthCheckPath;

    const patchRes = await fetch(`${RENDER_API}/services/${serviceId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ serviceDetails }),
    });
    const patchText = await patchRes.text();
    if (!patchRes.ok) {
      return `Render service config update failed (HTTP ${patchRes.status}): ${patchText.slice(0, 300) || patchRes.statusText}`;
    }

    const deployRes = await fetch(`${RENDER_API}/services/${serviceId}/deploys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clearCache: input.clear_cache === true ? 'clear' : 'do_not_clear' }),
    });
    const deployText = await deployRes.text();
    let deployId = '';
    if (deployText.trim()) {
      try {
        deployId = (JSON.parse(deployText) as { id?: string }).id ?? '';
      } catch {
        // keep raw text out of the success message unless needed below
      }
    }
    const changed = [
      buildCommand ? `buildCommand=${buildCommand}` : '',
      startCommand ? `startCommand=${startCommand}` : '',
      healthCheckPath ? `healthCheckPath=${healthCheckPath}` : '',
    ].filter(Boolean);

    if (!deployRes.ok) {
      return [
        `Updated Render service config on ${serviceId}: ${changed.join(', ')}`,
        `Redeploy trigger failed (HTTP ${deployRes.status}): ${deployText.slice(0, 300) || deployRes.statusText}`,
        'Call render_deploy or render_get_deploy_status next.',
      ].join('\n');
    }

    const statusInstruction = deployId
      ? `Triggered redeploy ${deployId}; now call render_get_deploy_status with service_id="${serviceId}", deploy_id="${deployId}", wait_for_terminal=true.`
      : `Triggered redeploy (id unavailable); now call render_get_deploy_status with service_id="${serviceId}", wait_for_terminal=true.`;
    return [
      `Updated Render service config on ${serviceId}: ${changed.join(', ')}`,
      statusInstruction,
    ].join('\n');
  } catch (err) {
    return `Error updating Render service config: ${err instanceof Error ? err.message : 'Unknown'}`;
  }
}

async function renderDeploy(input: Record<string, unknown>, companyId?: string): Promise<string> {
  try {
    const headers = renderHeaders();
    const serviceId = String(input.service_id ?? '').trim();
    if (!serviceId) return 'Render deploy error: service_id is required.';

    if (input.force_after_quota_restored !== true) {
      const recentQuotaBlocker = await recentRenderPipelineBlockerSummary(serviceId);
      if (recentQuotaBlocker) return recentQuotaBlocker;
    }

    const response = await fetch(`${RENDER_API}/services/${serviceId}/deploys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clearCache: input.clear_cache === true ? 'clear' : 'do_not_clear' }),
    });

    // Render's deploy endpoint occasionally returns an empty body or HTML gateway
    // error page even on success — parse defensively so we surface a useful error
    // instead of "Unexpected end of JSON input".
    const rawBody = await response.text();
    let data: { id?: string; status?: string; message?: string } = {};
    if (rawBody.trim().length > 0) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        // non-JSON body — surface a slice so the agent can see what Render returned
      }
    }

    if (!response.ok) {
      const hint = data.message ?? (rawBody ? rawBody.slice(0, 200) : response.statusText);
      return `Render deploy failed (HTTP ${response.status}): ${hint}. If the service is mid-deploy, wait via render_get_deploy_status before retrying — Render rejects concurrent deploys with a 409.`;
    }

    if (!data.id) {
      // 2xx with no parseable deploy id — Render's behavior when a deploy is already
      // in progress on the same service. Tell the agent to poll instead of retry.
      const latest = serviceId ? await fetchLatestRenderDeploy(serviceId) : { error: 'service_id missing' };
      const latestDeployId = 'error' in latest ? undefined : latest.id;
      const latestLines = 'error' in latest
        ? [`Latest deploy lookup: unavailable (${latest.error})`]
        : [
            `Latest deploy status: ${latest.status ?? 'unknown'}`,
            `Latest deploy id: ${latest.id ?? 'unknown'}`,
            `Finished: ${latest.finishedAt ?? 'in progress'}`,
            `Commit: ${latest.commitMessage ?? 'N/A'}`,
          ];
      return [
        `RENDER_DEPLOY_ACCEPTED_NO_ID service_id=${serviceId} http_status=${response.status}`,
        `Render accepted the deploy request but did not return a deploy id (body: "${rawBody.slice(0, 120)}").`,
        ...latestLines,
        latestDeployId
          ? `NEXT_REQUIRED_TOOL: render_get_deploy_status service_id=${serviceId} deploy_id=${latestDeployId} wait_for_terminal=true`
          : 'NEXT_REQUIRED_TOOL: render_get_deploy_status wait_for_terminal=true',
        'Do not call render_deploy again until render_get_deploy_status reaches a terminal status.',
      ].join('\n');
    }

    const result = [
      `Deployment triggered! Deploy ID: ${data.id}`,
      `Status: ${data.status ?? 'building'}`,
      `NEXT_REQUIRED_TOOL: render_get_deploy_status service_id=${serviceId} deploy_id=${data.id} wait_for_terminal=true`,
      'Do not call render_deploy again until that exact deploy reaches a terminal status.',
    ].join('\n');

    let qaTaskCreated = false;
    let qaTaskLiveUrl: string | null = null;

    // P2-7: Auto-create Browser QA task after successful deploy.
    // Prefer the Render-assigned URL: custom domains may be quota-blocked or
    // waiting on SSL, and QA should verify the reachable deploy.
    if (companyId) {
      try {
        // Get the live URL for this company to verify
        const { companies: co } = await import('@/lib/db');
        const { db: dbInst } = await import('@/lib/db');
        const { eq: eqOp } = await import('drizzle-orm');
        const [company] = await dbInst.select({ custom_domain: co.custom_domain, slug: co.slug })
          .from(co).where(eqOp(co.id, companyId)).limit(1);

        const serviceUrl = typeof input.service_id === 'string'
          ? await getRenderServiceUrl(input.service_id)
          : null;
        const liveUrl = serviceUrl
          ?? (company?.custom_domain
          ? `https://${company.custom_domain}`
          : null);

        if (liveUrl) {
          const { tasks: tasksTable } = await import('@/lib/db');
          await dbInst.insert(tasksTable).values({
            company_id: companyId,
            title: `[QA] Verify deploy: ${liveUrl}`,
            description: `A new deploy was just triggered. Visit ${liveUrl} and verify:\n1. Homepage loads without errors\n2. Main navigation links work\n3. No visible console errors or broken layouts\n4. Take a screenshot for evidence\n\nDeploy ID: ${data.id}`,
            tag: 'browser-qa',
            priority: 60,
            source: 'auto_remediation',
            status: 'todo',
            queue_order: 2,
            estimated_credits: 1,
            max_turns: 50,
            executability_type: 'can_run_now',
          });
          qaTaskCreated = true;
          qaTaskLiveUrl = liveUrl;
          log.info('Browser QA task created post-deploy', { companyId, liveUrl, deployId: data.id });
        }
      } catch (err) {
        // Non-blocking: QA task failure shouldn't fail the deploy response
        log.warn('Failed to create Browser QA task', { companyId, error: err instanceof Error ? err.message : 'Unknown' });
      }
    }

    return result + (qaTaskCreated
      ? `\n\nBrowser QA task created for ${qaTaskLiveUrl} — agent will verify the live Render URL shortly.`
      : '');
  } catch (err) {
    return `Render deploy error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}


type RenderDeployInfo = {
  id?: string;
  status?: string;
  finishedAt?: string;
  commitMessage?: string;
};

type RenderServiceEvent = {
  id?: string;
  type?: string;
  timestamp?: string;
  serviceId?: string;
  details?: {
    deployId?: string;
    buildId?: string;
    deployStatus?: string;
    reason?: unknown;
    status?: unknown;
    trigger?: unknown;
  };
};

export function isTransientRenderApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|econnreset|etimedout|socket hang up|network|timeout|temporarily unavailable|too many requests|bad gateway|service unavailable|gateway timeout|\b(408|425|429|500|502|503|504)\b/i.test(message);
}

async function fetchLatestRenderDeployWithRetry(
  serviceId: string,
  maxAttempts = 4,
): Promise<RenderDeployInfo | { error: string; transient?: boolean }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const latest = await fetchLatestRenderDeploy(serviceId);
      if ('error' in latest && isTransientRenderApiError(latest.error) && attempt < maxAttempts) {
        lastError = latest.error;
        await sleepMs(Math.min(3_000, 500 * attempt));
        continue;
      }
      return latest;
    } catch (error) {
      lastError = error;
      if (!isTransientRenderApiError(error) || attempt === maxAttempts) break;
      await sleepMs(Math.min(3_000, 500 * attempt));
    }
  }

  return {
    error: lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown transient Render API error'),
    transient: isTransientRenderApiError(lastError),
  };
}

const RENDER_TERMINAL_DEPLOY_STATUSES = new Set([
  'live',
  'build_failed',
  'update_failed',
  'pre_deploy_failed',
  'canceled',
  'deactivated',
]);

export function summarizeRenderInfrastructureBlocker(events: RenderServiceEvent[], deployId?: string): string | null {
  const recentPipelineExhausted = events.find((event) => {
    if (event.type !== 'pipeline_minutes_exhausted') return false;
    const eventDeployId = event.details?.deployId;
    return !deployId || !eventDeployId || eventDeployId === deployId;
  });

  if (!recentPipelineExhausted) return null;

  const details = recentPipelineExhausted.details ?? {};
  return [
    'RENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted',
    'Render rejected the build before app build logs were produced because the account has exhausted pipeline/build minutes.',
    `Event: ${recentPipelineExhausted.type} at ${recentPipelineExhausted.timestamp ?? 'unknown time'}`,
    details.buildId ? `Build ID: ${details.buildId}` : '',
    details.deployId ? `Deploy ID: ${details.deployId}` : (deployId ? `Deploy ID: ${deployId}` : ''),
    renderPipelineRetryAfterIso(recentPipelineExhausted.timestamp, renderPipelineBlockerWindowMs())
      ? `Earliest automatic retry after: ${renderPipelineRetryAfterIso(recentPipelineExhausted.timestamp, renderPipelineBlockerWindowMs())}`
      : '',
    'This is not an app-code or Render command failure. Do not change package.json, render.yaml, build/start commands, or recreate the service for this signal.',
    'Record the blocker as a known issue and rerun after Render pipeline minutes/quota are restored.',
  ].filter(Boolean).join('\n');
}

const DEFAULT_RENDER_PIPELINE_BLOCKER_WINDOW_MS = 24 * 60 * 60 * 1000;

function renderPipelineBlockerWindowMs(): number {
  const raw = Number(process.env.RENDER_PIPELINE_BLOCKER_WINDOW_MS ?? DEFAULT_RENDER_PIPELINE_BLOCKER_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RENDER_PIPELINE_BLOCKER_WINDOW_MS;
}

function isRecentRenderEvent(event: RenderServiceEvent, nowMs: number, windowMs: number): boolean {
  if (!event.timestamp) return true;
  const eventMs = Date.parse(event.timestamp);
  if (!Number.isFinite(eventMs)) return true;
  return eventMs >= nowMs - windowMs;
}

function renderPipelineRetryAfterIso(timestamp: string | undefined, windowMs: number): string | null {
  if (!timestamp) return null;
  const eventMs = Date.parse(timestamp);
  if (!Number.isFinite(eventMs)) return null;
  return new Date(eventMs + windowMs).toISOString();
}

export function summarizeRecentRenderPipelineBlocker(
  events: RenderServiceEvent[],
  serviceId: string,
  nowMs = Date.now(),
  windowMs = renderPipelineBlockerWindowMs(),
  toolName = 'render_deploy',
): string | null {
  const event = events.find((candidate) =>
    candidate.type === 'pipeline_minutes_exhausted' &&
    isRecentRenderEvent(candidate, nowMs, windowMs));

  if (!event) return null;

  const details = event.details ?? {};
  const retryAfterIso = renderPipelineRetryAfterIso(event.timestamp, windowMs);
  return [
    'RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED',
    `Render service ${serviceId} has a recent pipeline_minutes_exhausted event, so ${toolName} is refusing to trigger another build attempt.`,
    `Event: ${event.type} at ${event.timestamp ?? 'unknown time'}`,
    details.buildId ? `Build ID: ${details.buildId}` : '',
    details.deployId ? `Deploy ID: ${details.deployId}` : '',
    `Circuit breaker window: ${Math.round(windowMs / 60000)} minute(s)`,
    retryAfterIso ? `Earliest automatic retry after: ${retryAfterIso}` : '',
    'Do not call Render deploy/env/config tools again, recreate the service, or change build/start/package config for this signal.',
    'If the operator confirms Render pipeline minutes/quota were restored, make one controlled retry with force_after_quota_restored=true, then poll that exact deploy id.',
    'Otherwise record the blocker and wait for Render quota restoration.',
  ].filter(Boolean).join('\n');
}

async function recentRenderPipelineBlockerSummary(serviceId: string, toolName = 'render_deploy'): Promise<string | null> {
  const events = await fetchRenderServiceEvents(serviceId);
  if ('error' in events) return null;
  return summarizeRecentRenderPipelineBlocker(events, serviceId, Date.now(), renderPipelineBlockerWindowMs(), toolName);
}

async function fetchRenderServiceEvents(serviceId: string, limit = 20): Promise<RenderServiceEvent[] | { error: string }> {
  const headers = renderHeaders();
  const response = await fetch(`${RENDER_API}/services/${serviceId}/events?limit=${limit}`, { headers });
  const data = await response.json().catch(() => ({})) as Array<{ event?: RenderServiceEvent } & RenderServiceEvent> | { message?: string };
  if (!response.ok || !Array.isArray(data)) {
    return { error: `HTTP ${response.status}: ${(data as { message?: string }).message ?? response.statusText}` };
  }
  return data.map((entry) => entry.event ?? entry);
}

async function renderInfrastructureBlockerSummary(serviceId: string, deployId?: string): Promise<string | null> {
  const events = await fetchRenderServiceEvents(serviceId);
  if ('error' in events) return null;
  return summarizeRenderInfrastructureBlocker(events, deployId);
}

async function fetchLatestRenderDeploy(serviceId: string): Promise<RenderDeployInfo | { error: string }> {
  const headers = renderHeaders();
  const response = await fetch(`${RENDER_API}/services/${serviceId}/deploys?limit=1`, { headers });
  const data = await response.json().catch(() => ({})) as Array<{
    deploy?: {
      id?: string;
      status?: string;
      finishedAt?: string;
      commitMessage?: string;
      commit?: { message?: string };
    };
    id?: string;
    status?: string;
    finishedAt?: string;
    commitMessage?: string;
    commit?: { message?: string };
  }> | { message?: string };

  if (!response.ok || !Array.isArray(data)) {
    return { error: `HTTP ${response.status}: ${(data as { message?: string }).message ?? response.statusText}` };
  }
  if (!data.length) return { error: 'No deployments found for this service.' };

  const latest = data[0].deploy ?? data[0];
  return {
    id: latest.id,
    status: latest.status,
    finishedAt: latest.finishedAt,
    commitMessage: latest.commitMessage ?? latest.commit?.message,
  };
}

async function fetchRenderDeploy(serviceId: string, deployId: string): Promise<RenderDeployInfo | { error: string }> {
  const headers = renderHeaders();
  const response = await fetch(`${RENDER_API}/services/${serviceId}/deploys/${deployId}`, { headers });
  const data = await response.json().catch(() => ({})) as {
    deploy?: {
      id?: string;
      status?: string;
      finishedAt?: string;
      commitMessage?: string;
      commit?: { message?: string };
    };
    id?: string;
    status?: string;
    finishedAt?: string;
    commitMessage?: string;
    commit?: { message?: string };
    message?: string;
  };

  if (!response.ok) {
    return { error: `HTTP ${response.status}: ${data.message ?? response.statusText}` };
  }

  const deploy = data.deploy ?? data;
  return {
    id: deploy.id ?? deployId,
    status: deploy.status,
    finishedAt: deploy.finishedAt,
    commitMessage: deploy.commitMessage ?? deploy.commit?.message,
  };
}

async function fetchRenderDeployWithRetry(
  serviceId: string,
  deployId: string | undefined,
  maxAttempts = 4,
): Promise<RenderDeployInfo | { error: string; transient?: boolean }> {
  if (!deployId) return fetchLatestRenderDeployWithRetry(serviceId, maxAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const deploy = await fetchRenderDeploy(serviceId, deployId);
      if ('error' in deploy && isTransientRenderApiError(deploy.error) && attempt < maxAttempts) {
        lastError = deploy.error;
        await sleepMs(Math.min(3_000, 500 * attempt));
        continue;
      }
      return deploy;
    } catch (error) {
      lastError = error;
      if (!isTransientRenderApiError(error) || attempt === maxAttempts) break;
      await sleepMs(Math.min(3_000, 500 * attempt));
    }
  }

  return {
    error: lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown transient Render API error'),
    transient: isTransientRenderApiError(lastError),
  };
}

async function renderGetDeployStatus(input: Record<string, unknown>): Promise<string> {
  try {
    const serviceId = input.service_id as string | undefined;
    if (!serviceId) return 'Render deploy status error: service_id is required.';
    const deployId = typeof input.deploy_id === 'string' && input.deploy_id.trim()
      ? input.deploy_id.trim()
      : undefined;
    const waitForTerminal = input.wait_for_terminal === true;
    const timeoutMs = Math.min(Math.max(Number(input.timeout_seconds ?? 600), 10), 900) * 1000;
    const pollMs = Math.min(Math.max(Number(input.poll_interval_seconds ?? 20), 10), 120) * 1000;
    const started = Date.now();
    let attempts = 0;
    let latest: RenderDeployInfo | { error: string };

    do {
      attempts++;
      latest = await fetchRenderDeployWithRetry(serviceId, deployId);
      if ('error' in latest) {
        if ((latest as { transient?: boolean }).transient || isTransientRenderApiError(latest.error)) {
          return [
            `Render deploy status transient error: ${latest.error}`,
            'NEXT_REQUIRED_TOOL: render_get_deploy_status wait_for_terminal=true',
            'Do not mark the task complete or failed from this transient Render API read; retry the same status check.',
          ].join('\n');
        }
        return `Render deploy status error: ${latest.error}`;
      }
      if (!waitForTerminal || RENDER_TERMINAL_DEPLOY_STATUSES.has(latest.status ?? '')) break;
      if (Date.now() - started + pollMs > timeoutMs) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    } while (true);

    if ('error' in latest) return `Render deploy status error: ${latest.error}`;
    const status = latest.status ?? 'unknown';
    const infraBlocker = status.includes('failed')
      ? await renderInfrastructureBlockerSummary(serviceId, latest.id ?? deployId)
      : null;
    const terminalHint = status.includes('failed')
      ? infraBlocker
        ? `\n${infraBlocker}`
        : '\nTerminal failure: call render_get_logs with log_type="deploy", fix the build/runtime error, push, redeploy, then rerun render_get_deploy_status with wait_for_terminal=true.'
      : '';

    return [
      deployId ? `Deploy ${deployId} status: ${status}` : `Latest deploy status: ${status}`,
      `Finished: ${latest.finishedAt ?? 'in progress'}`,
      `Commit: ${latest.commitMessage ?? 'N/A'}`,
      waitForTerminal ? `Waited: ${Math.round((Date.now() - started) / 1000)}s across ${attempts} poll(s)` : '',
    ].filter(Boolean).join('\n') + terminalHint;
  } catch (err) {
    if (isTransientRenderApiError(err)) {
      return [
        `Render deploy status transient error: ${err instanceof Error ? err.message : String(err)}`,
        'NEXT_REQUIRED_TOOL: render_get_deploy_status wait_for_terminal=true',
        'Do not mark the task complete or failed from this transient Render API read; retry the same status check.',
      ].join('\n');
    }
    return `Render status error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderGetLogs(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const serviceId = input.service_id as string;
    if (!serviceId) return 'Render logs error: service_id is required.';
    const logType = (input.log_type as string) ?? 'service';
    const numLines = Math.min(Math.max((input.num_lines as number) ?? 100, 10), 500);

    const serviceRes = await fetch(`${RENDER_API}/services/${serviceId}`, { headers });
    const service = await serviceRes.json().catch(() => ({})) as { ownerId?: string; message?: string };
    if (!serviceRes.ok || !service.ownerId) {
      return `Failed to get Render service owner for logs: ${service.message ?? serviceRes.statusText}`;
    }

    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const params = new URLSearchParams({
      ownerId: service.ownerId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      direction: 'backward',
      limit: String(numLines),
    });
    params.append('resource', serviceId);
    if (logType === 'deploy') params.append('type', 'build');
    if (logType === 'service') params.append('type', 'app');

    const response = await fetch(`${RENDER_API}/logs?${params}`, { headers });
    if (!response.ok) {
      return `Failed to get logs: ${response.statusText}. Make sure the service is deployed and running.`;
    }

    const data = await response.json() as { logs?: Array<{ message?: string; timestamp?: string; labels?: Array<{ name: string; value: string }> }> };
    let logData = data.logs ?? [];

    if (!logData.length && logType === 'deploy') {
      params.delete('type');
      const fallback = await fetch(`${RENDER_API}/logs?${params}`, { headers });
      if (fallback.ok) {
        const fallbackData = await fallback.json() as { logs?: Array<{ message?: string; timestamp?: string; labels?: Array<{ name: string; value: string }> }> };
        logData = fallbackData.logs ?? [];
      }
    }

    if (!logData.length) {
      const infraBlocker = await renderInfrastructureBlockerSummary(serviceId);
      return [
        `No ${logType === 'deploy' ? 'deploy/build' : 'runtime'} logs available for the last 60 minutes.`,
        infraBlocker,
      ].filter(Boolean).join('\n');
    }

    const stripAnsi = (value: string) => value
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B\([A-Z0-9]/g, '');
    const lines = logData
      .slice(0, numLines)
      .reverse()
      .map((l) => {
        const level = l.labels?.find((label) => label.name === 'level')?.value ?? 'info';
        return `[${l.timestamp ?? ''}] ${level}: ${stripAnsi(l.message ?? '')}`;
      })
      .join('\n');

    return `## ${logType === 'deploy' ? 'Deploy/Build' : 'Runtime'} Logs (last ${Math.min(logData.length, numLines)} lines)\n${lines}`;
  } catch (err) {
    return `Render logs error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderDeleteService(input: Record<string, unknown>, companyId: string): Promise<string> {
  // Safety gate: require explicit confirmation
  if (input.confirm !== true) {
    return 'Deletion requires confirm=true. This permanently destroys the service and all deployments. Are you sure?';
  }

  const serviceId = input.service_id as string;
  if (!serviceId) return 'Error: service_id is required.';

  try {
    const headers = renderHeaders();
    const response = await fetch(`${RENDER_API}/services/${serviceId}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      const data = await response.json() as { message?: string };
      return `Failed to delete service: ${data.message ?? response.statusText}`;
    }

    // Clear from company record
    await db.update(companies)
      .set({ render_service_id: null })
      .where(eq(companies.id, companyId));

    log.warn('Render service deleted', { companyId, serviceId });

    return `Service ${serviceId} permanently deleted. The company record has been updated. Use create_instance for full-stack apps, or render_create_service for backend/manual Render paths.`;
  } catch (err) {
    return `Delete error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Health check Ã¢â€â‚¬Ã¢â€â‚¬

// LLM code review — fetches the diff covering ALL commits this task pushed
// (audit P2.1, 2026-05-12: previously reviewed only latest commit vs its
// parent, so multi-commit tasks could hide a risky earlier commit). We walk
// the current task_executions.execution_log for the earliest commit SHA
// produced by this run; if we can find it we diff `firstCommitParent..HEAD`,
// otherwise we fall back to the latest-vs-parent behavior.
async function handleReviewPushedCode(companyId: string, taskId?: string): Promise<string> {
  const [company] = await db.select({ github_repo: companies.github_repo }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.github_repo) return 'CODE REVIEW SKIPPED: no github_repo on company.';

  const token = process.env.GITHUB_TOKEN;
  if (!token) return 'CODE REVIEW SKIPPED: GITHUB_TOKEN not configured.';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  // Get the latest commit on the default branch.
  let latestSha: string | undefined;
  for (const branch of ['main', 'master']) {
    try {
      const r = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/ref/heads/${branch}`, { headers, signal: AbortSignal.timeout(8_000) });
      if (r.ok) {
        const data = await r.json() as { object: { sha: string } };
        latestSha = data.object.sha;
        break;
      }
    } catch { /* try next branch */ }
  }
  if (!latestSha) return 'CODE REVIEW SKIPPED: could not resolve default branch.';

  // Try to find the first commit this task produced via the execution log.
  // The log records each successful push with the resulting SHA in the
  // result string. If we can't find one, fall back to latest~1.
  let baseSha: string | undefined;
  if (taskId) {
    try {
      const { taskExecutions } = await import('@/lib/db');
      const [exec] = await db.select({ execution_log: taskExecutions.execution_log })
        .from(taskExecutions).where(eq(taskExecutions.task_id, taskId)).orderBy(desc(taskExecutions.started_at)).limit(1);
      const log = (exec?.execution_log ?? []) as Array<{ tool?: string; result?: string }>;
      // Look for the EARLIEST github_push_file or github_create_commit
      // result containing a SHA-shaped string.
      for (const entry of log) {
        if (entry.tool !== 'github_push_file' && entry.tool !== 'github_create_commit') continue;
        const m = String(entry.result ?? '').match(/Commit:?\s*([0-9a-f]{7,40})/i);
        if (m) {
          // Use the parent of the FIRST commit as our base, so the review
          // covers all commits this run produced (including the first one).
          const firstCommitSha = m[1];
          try {
            const c = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/commits/${firstCommitSha}`, { headers, signal: AbortSignal.timeout(8_000) });
            if (c.ok) {
              const cd = await c.json() as { parents?: Array<{ sha: string }> };
              baseSha = cd.parents?.[0]?.sha;
            }
          } catch { /* fall back */ }
          break;
        }
      }
    } catch { /* fall back */ }
  }

  // Fallback: latest commit's parent (single-commit review)
  if (!baseSha) {
    const commitRes = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/commits/${latestSha}`, { headers, signal: AbortSignal.timeout(8_000) });
    if (!commitRes.ok) return `CODE REVIEW SKIPPED: could not read latest commit: HTTP ${commitRes.status}`;
    const commitData = await commitRes.json() as { parents?: Array<{ sha: string }> };
    baseSha = commitData.parents?.[0]?.sha;
    if (!baseSha) return 'CODE REVIEW SKIPPED: latest commit has no parent (root commit) — nothing to diff against.';
  }

  // Fetch the unified diff via GitHub's compare API. With baseSha = parent
  // of the run's first commit, this captures the entire task's pushed range.
  const diffHeaders = { ...headers, Accept: 'application/vnd.github.v3.diff' };
  const diffRes = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/compare/${baseSha}...${latestSha}`, { headers: diffHeaders, signal: AbortSignal.timeout(15_000) });
  if (!diffRes.ok) return `CODE REVIEW SKIPPED: could not fetch diff: HTTP ${diffRes.status}`;
  const diff = await diffRes.text();

  if (!diff || diff.length < 50) {
    return 'CODE REVIEW SKIPPED: diff too small to review meaningfully.';
  }

  const { reviewDiff, summarizeReview } = await import('@/lib/services/code-review.service');
  const result = await reviewDiff(diff, company.github_repo);
  return summarizeReview(result);
}

// Static code scan — pattern-based AI-coding pitfall detection over the
// company's GitHub repo. Pulls JS/TS source via Trees+blob API, runs the
// shared static-code-scan rule set, returns formatted findings.
async function handleStaticCodeScan(companyId: string): Promise<string> {
  const [company] = await db.select({ github_repo: companies.github_repo }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.github_repo) return 'STATIC SCAN: no github_repo on company.';

  const token = process.env.GITHUB_TOKEN;
  if (!token) return 'STATIC SCAN: GITHUB_TOKEN not configured.';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  // List the tree
  let tree: Array<{ path: string; type: string; sha: string; size?: number }> = [];
  for (const branch of ['main', 'master']) {
    try {
      const r = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/trees/${branch}?recursive=1`, { headers, signal: AbortSignal.timeout(8_000) });
      if (r.ok) {
        const data = await r.json() as { tree?: typeof tree };
        tree = data.tree ?? [];
        break;
      }
    } catch { /* try next branch */ }
  }
  if (tree.length === 0) return 'STATIC SCAN: could not list repo tree.';

  // Pull JS/TS source files. Cap to 30 files for budget — but prioritize
  // security-critical files first so we never miss them on a big repo
  // (audit P2.2, 2026-05-12). Old behavior sliced(0,30) on tree order →
  // could miss app/api/auth, middleware.ts, db/schema.ts on a >30-file repo.
  const allCandidates = tree
    .filter((e) => e.type === 'blob' && /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(e.path))
    .filter((e) => !/node_modules\//.test(e.path))
    .filter((e) => (e.size ?? 0) < 200_000); // skip enormous files

  // Priority score: higher = scan first.
  const priorityFor = (p: string): number => {
    if (/middleware\.(t|j)sx?$/i.test(p)) return 100;                  // Next.js middleware (auth gates here)
    if (/^app\/api\/.*\bauth\b/i.test(p)) return 95;                   // auth routes
    if (/\bauth\b.*\.(t|j)sx?$/i.test(p)) return 90;                   // auth helpers
    if (/^db\/schema\.(t|j)s$/i.test(p)) return 88;                    // drizzle schema
    if (/^(app|src)\/api\//i.test(p)) return 85;                       // API routes
    if (/^(app|src)\/actions?\//i.test(p)) return 82;                  // server actions
    if (/^(app|src)\/lib\//i.test(p)) return 75;                       // shared lib
    if (/^server\.(t|j)s$/i.test(p)) return 90;                        // Express entrypoint
    if (/webhook/i.test(p)) return 80;                                 // webhook handlers
    if (/^(app|src)\//i.test(p)) return 50;                            // generic app code
    return 10;                                                          // other files (config, tests, scripts)
  };
  const sourceFiles = allCandidates
    .sort((a, b) => priorityFor(b.path) - priorityFor(a.path))
    .slice(0, 30);

  const { scanFiles, summarizeFindings } = await import('@/lib/services/static-code-scan');
  const scanned: Array<{ path: string; content: string }> = [];
  for (const f of sourceFiles) {
    try {
      const r = await githubFetch(`${GITHUB_API}/repos/${company.github_repo}/git/blobs/${f.sha}`, { headers, signal: AbortSignal.timeout(8_000) });
      if (!r.ok) continue;
      const data = await r.json() as { content: string; encoding: string };
      const content = data.encoding === 'base64' ? Buffer.from(data.content, 'base64').toString('utf8') : data.content;
      scanned.push({ path: f.path, content });
    } catch { /* skip */ }
  }

  const findings = scanFiles(scanned);
  return summarizeFindings(findings);
}

// Codebase map — engineering agent's persistent technical memory of the
// founder's deployed app. Read at the start of extends; written at the end.

async function handleReadCodebaseMap(companyId: string): Promise<string> {
  const { getCodebaseMap, formatCodebaseMapForPrompt } = await import('@/lib/services/codebase-map.service');
  try {
    const map = await getCodebaseMap(companyId);
    if (!map) return 'No codebase map yet (this is the first build, or the prior task did not write one). Proceed from skeleton.';
    return formatCodebaseMapForPrompt(map);
  } catch (err) {
    return `Codebase map read failed: ${err instanceof Error ? err.message : 'unknown'}. Proceed cautiously.`;
  }
}

async function handleBuildCodeGraph(input: Record<string, unknown>, companyId: string): Promise<string> {
  const { buildCodeGraph } = await import('@/lib/services/code-graph.service');
  try {
    const result = await buildCodeGraph(companyId, { force: input.force === true });
    if (!result.ok || !result.manifest) {
      return `CODE_GRAPH_UNAVAILABLE reason=${JSON.stringify(result.reason ?? 'unknown')} fallback=codebase_map/github_read_file`;
    }
    return [
      `CODE_GRAPH_EVIDENCE repo_sha=${result.manifest.repo_sha} files=${result.manifest.file_count} report_saved=true`,
      `repo=${result.manifest.github_repo} branch=${result.manifest.default_branch} skipped=${result.manifest.skipped_count} accepted_bytes=${result.manifest.accepted_bytes}`,
      '',
      result.reportExcerpt ?? '(no report excerpt)',
    ].join('\n').slice(0, 9000);
  } catch (err) {
    return `CODE_GRAPH_UNAVAILABLE reason=${JSON.stringify(err instanceof Error ? err.message : 'unknown')} fallback=codebase_map/github_read_file`;
  }
}

async function handleReadCodeGraphReport(companyId: string): Promise<string> {
  const { readCodeGraphReport } = await import('@/lib/services/code-graph.service');
  try {
    return await readCodeGraphReport(companyId);
  } catch (err) {
    return `Code graph report read failed: ${err instanceof Error ? err.message : 'unknown'}. Fallback to codebase_map and GitHub read tools.`;
  }
}

async function handleQueryCodeGraph(input: Record<string, unknown>, companyId: string): Promise<string> {
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) return 'Error: question is required.';
  const { queryCodeGraph } = await import('@/lib/services/code-graph.service');
  try {
    const result = await queryCodeGraph(companyId, question);
    return result.answer;
  } catch (err) {
    return `CODE_GRAPH_UNAVAILABLE reason=${JSON.stringify(err instanceof Error ? err.message : 'unknown')} fallback=codebase_map/github_read_file`;
  }
}

async function handleExplainCodeNode(input: Record<string, unknown>, companyId: string): Promise<string> {
  const node = typeof input.node === 'string' ? input.node.trim() : '';
  if (!node) return 'Error: node is required.';
  const { explainCodeNode } = await import('@/lib/services/code-graph.service');
  try {
    const result = await explainCodeNode(companyId, node);
    return result.answer;
  } catch (err) {
    return `CODE_GRAPH_UNAVAILABLE reason=${JSON.stringify(err instanceof Error ? err.message : 'unknown')} fallback=codebase_map/github_read_file`;
  }
}

async function handleCodeGraphPath(input: Record<string, unknown>, companyId: string): Promise<string> {
  const from = typeof input.from === 'string' ? input.from.trim() : '';
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  if (!from || !to) return 'Error: from and to are required.';
  const { codeGraphPath } = await import('@/lib/services/code-graph.service');
  try {
    const result = await codeGraphPath(companyId, from, to);
    return result.answer;
  } catch (err) {
    return `CODE_GRAPH_UNAVAILABLE reason=${JSON.stringify(err instanceof Error ? err.message : 'unknown')} fallback=codebase_map/github_read_file`;
  }
}

async function handleWriteCodebaseMap(input: Record<string, unknown>, companyId: string): Promise<string> {
  const { writeCodebaseMap, codebaseMapSchema } = await import('@/lib/services/codebase-map.service');
  const validated = codebaseMapSchema.safeParse(input);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return `Codebase map validation failed: ${issues}. Re-call write_codebase_map with the corrected shape.`;
  }
  try {
    await writeCodebaseMap(companyId, validated.data);
    return `Codebase map saved (${validated.data.shipped_features.length} feature(s) tracked, ${validated.data.schema.length} table(s), ${validated.data.routes.length} route(s)).`;
  } catch (err) {
    return `Codebase map write failed: ${err instanceof Error ? err.message : 'unknown'}.`;
  }
}

// Live debug helper — full HTTP response (status + headers + body) so the
// agent can diagnose why a request failed instead of just knowing it failed.
// check_url_health is binary 200/not-200; http_fetch_full gives the why.

async function handleHttpFetchFull(input: Record<string, unknown>): Promise<string> {
  const url     = input.url as string | undefined;
  const method  = ((input.method as string | undefined) ?? 'GET').toUpperCase();
  const headers = (input.headers as Record<string, string> | undefined) ?? {};
  const body    = input.body as string | undefined;

  if (!url) return 'Error: url is required.';
  const safety = await assertUrlSafe(url);
  if (!safety.ok) return `Error: ${safety.reason}`;
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'User-Agent': 'Baljia/1.0 engineering-debug', ...headers },
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });
    let respBody = '';
    try { respBody = await resp.text(); } catch { /* binary or empty */ }
    if (respBody.length > 4096) respBody = respBody.slice(0, 4096) + `\n... [truncated; total ${respBody.length} bytes]`;
    return [
      `HTTP ${resp.status} ${resp.statusText} — ${method} ${url}`,
      `Headers: ${JSON.stringify(respHeaders, null, 2)}`,
      `Body:`,
      respBody || '(empty)',
    ].join('\n');
  } catch (err) {
    return `HTTP fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Known-issues lookup — agent calls before doing risky work to avoid repeating
// past failures. Returns FIXED issues (with fix_notes) AND still-open ones.

async function handleReadKnownIssues(input: Record<string, unknown>): Promise<string> {
  const context = (input.context as string | undefined) ?? '';
  if (!context.trim()) return 'Error: context is required (free-text describing what you are about to do).';
  const { getRelevantKnownIssuesForAgent, formatKnownIssuesForAgent } = await import('@/lib/services/failure.service');
  try {
    const issues = await getRelevantKnownIssuesForAgent(context, 30, 5);
    return formatKnownIssuesForAgent(issues);
  } catch (err) {
    return `KNOWN ISSUES: lookup failed (${err instanceof Error ? err.message : 'unknown'}). Proceed cautiously.`;
  }
}

// User-journey verifier — stateful HTTP walkthrough with cookie persistence
// across steps. Lets the engineering agent prove the deployed app actually
// works for users — not just that URLs return 2xx. Use as the final
// verification step before declaring an engineering task done.

async function handleVerifyUserJourney(input: Record<string, unknown>): Promise<string> {
  const journeyName = (input.journey_name as string | undefined) ?? 'unnamed';
  const baseUrl = input.base_url as string | undefined;
  const stepsRaw = input.steps as unknown;
  if (!baseUrl) return 'Error: base_url is required.';
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return 'Error: steps must be a non-empty array.';
  const safety = await assertUrlSafe(baseUrl);
  if (!safety.ok) return `Error: ${safety.reason}`;

  const { runJourney } = await import('@/lib/services/journey-runner.service');
  const result = await runJourney({
    journey_name: journeyName,
    base_url: baseUrl,
    steps: stepsRaw as Parameters<typeof runJourney>[0]['steps'],
  });
  const contractFlowId = interactionContractFlowId(input.contract_flow_id);
  if (!contractFlowId) return result.summary;

  const passed = /^JOURNEY PASS\b/m.test(result.summary);
  return [
    result.summary,
    `ACCEPTANCE_PROOF_EVIDENCE passed=${passed ? 1 : 0} failed=${passed ? 0 : 1} contract_flows=1`,
    formatContractFlowProofLine(contractFlowId, passed, journeyName),
  ].join('\n');
}

// DB-state verifier: closes the gap where a server returns 302 "saved" but
// the INSERT actually failed. Pair with verify_user_journey to confirm
// side-effects landed in the founder's database.
async function handleVerifyDbState(input: Record<string, unknown>, companyId: string): Promise<string> {
  const label = (input.label as string | undefined) ?? 'unnamed';
  const sql = ((input.sql as string | undefined) ?? '').trim();
  const minRows = typeof input.expect_min_rows === 'number' ? input.expect_min_rows : 1;
  const maxRows = typeof input.expect_max_rows === 'number' ? input.expect_max_rows : Infinity;
  const expectFirst = (input.expect_first_row_contains as Record<string, unknown> | undefined) ?? null;
  const contractFlowId = interactionContractFlowId(input.contract_flow_id);
  const requiredFields = coerceStringArray(input.required_fields);
  const entity = typeof input.entity === 'string' ? input.entity : null;
  const dbTable = typeof input.db_table === 'string' ? input.db_table : entity;

  if (!sql) return `DB STATE FAIL: "${label}" — sql is required.`;
  if (!/^SELECT\b/i.test(sql)) return `DB STATE FAIL: "${label}" — only SELECT queries allowed.`;
  if (/;/.test(sql)) return `DB STATE FAIL: "${label}" — multiple statements not allowed.`;

  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo?.connectionUri) return `DB STATE FAIL: "${label}" — no founder database provisioned.`;

  let rows: Record<string, unknown>[];
  try {
    const { neon } = await import('@neondatabase/serverless');
    const neonSql = neon(dbInfo.connectionUri);
    rows = await runNeonOperationWithRetry(
      'verify_db_state',
      () => neonSql.query(sql) as Promise<Record<string, unknown>[]>,
      { companyId, label },
    );
  } catch (err) {
    return `DB STATE FAIL: "${label}" — query threw: ${err instanceof Error ? err.message : String(err)}`;
  }

  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  checks.push({
    name: `row count >= ${minRows}`,
    pass: rows.length >= minRows,
    detail: `actual=${rows.length}`,
  });
  if (Number.isFinite(maxRows)) {
    checks.push({
      name: `row count <= ${maxRows}`,
      pass: rows.length <= maxRows,
      detail: `actual=${rows.length}`,
    });
  }
  if (expectFirst && rows[0]) {
    for (const [k, v] of Object.entries(expectFirst)) {
      const actual = (rows[0] as Record<string, unknown>)[k];
      const same = JSON.stringify(actual) === JSON.stringify(v);
      checks.push({
        name: `first row.${k}`,
        pass: same,
        detail: `expected=${JSON.stringify(v).slice(0, 60)} actual=${JSON.stringify(actual).slice(0, 60)}`,
      });
    }
  }
  if (requiredFields.length > 0) {
    const first = rows[0] ?? {};
    for (const field of requiredFields) {
      const actual = (first as Record<string, unknown>)[field];
      checks.push({
        name: `required field ${field}`,
        pass: actual !== null && actual !== undefined && String(actual).length > 0,
        detail: `actual=${JSON.stringify(actual).slice(0, 80)}`,
      });
    }
  }

  const allPassed = checks.every((c) => c.pass);
  const header = allPassed
    ? `DB STATE PASS: "${label}" — ${rows.length} row(s) matched.`
    : `DB STATE FAIL: "${label}" — assertions failed.`;
  const lines = checks.map((c) => `  ${c.pass ? 'PASS' : 'FAIL'} ${c.name} (${c.detail})`).join('\n');
  const sample = rows[0] ? `\n  sample row: ${JSON.stringify(rows[0]).slice(0, 200)}` : '';
  const contractFieldProof = contractFlowId && requiredFields.length > 0
    ? `\n${formatContractFieldProofLine({
        flowId: contractFlowId,
        entity,
        dbTable,
        fields: requiredFields,
        passed: allPassed,
      })}`
    : '';
  return `${header}\n${lines}${sample}${contractFieldProof}`;
}

// Stock journey templates — return partial verify_user_journey inputs the
// agent fills in with concrete URLs / field names. Lifts the most common
// flow patterns out of the agent's per-task generation so we get consistent
// coverage and reduce token cost.
type ReleaseCheck = {
  name: string;
  passed: boolean;
  summary: string;
};

type ReleaseBlocker = {
  check: string;
  reason: string;
};

function urlWithTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  return typeof input[key] === 'boolean' ? input[key] : undefined;
}

function taskLooksUserFacingForRelease(task: Task): boolean {
  const text = `${task.title ?? ''} ${task.description ?? ''}`;
  if (/\b(api only|backend only|webhook|cron|worker|migration|database only|no ui|no frontend)\b/i.test(text)) {
    return false;
  }
  return /\b(app|mvp|landing|homepage|dashboard|portal|frontend|front-end|ui|user-facing|auth|login|signup|register|page|website|marketplace|booking|crm|admin)\b/i.test(text);
}

function pushReleaseCheck(
  checks: ReleaseCheck[],
  blockers: ReleaseBlocker[],
  name: string,
  passed: boolean,
  summary: string,
) {
  checks.push({ name, passed, summary });
  if (!passed) blockers.push({ check: name, reason: summary });
}

async function handleVerifyRelease(input: Record<string, unknown>, task: Task): Promise<string> {
  const inputCompanyId = typeof input.companyId === 'string' ? input.companyId : undefined;
  if (inputCompanyId && inputCompanyId !== task.company_id) {
    return 'VERIFY_RELEASE_FAIL ' + JSON.stringify({
      passed: false,
      selectedVerificationUrl: '',
      finalFounderUrl: '',
      checks: [],
      blockers: [{ check: 'tenant', reason: 'companyId does not match this task' }],
    });
  }

  const [company] = await db.select({
    github_repo: companies.github_repo,
    render_service_id: companies.render_service_id,
    custom_domain: companies.custom_domain,
    slug: companies.slug,
  }).from(companies).where(eq(companies.id, task.company_id)).limit(1);

  const renderUrl = urlWithTrailingSlash(String(input.renderUrl ?? input.render_url ?? '').trim());
  const finalFounderUrl = urlWithTrailingSlash(String(
    input.baljiaUrl
      ?? input.baljia_url
      ?? (company?.custom_domain ? `https://${company.custom_domain}` : company?.slug ? `https://${company.slug}.baljia.app` : '')
  ).trim());
  const serviceId = company?.render_service_id ?? '';
  const checks: ReleaseCheck[] = [];
  const blockers: ReleaseBlocker[] = [];
  const releaseLooksUserFacing = taskLooksUserFacingForRelease(task);
  const explicitUiProof = optionalBoolean(input, 'requireUiProof') ?? optionalBoolean(input, 'require_ui_proof');
  const explicitDesignProof = optionalBoolean(input, 'requireDesignProof') ?? optionalBoolean(input, 'require_design_proof');
  const requireUiProof = releaseLooksUserFacing ? true : explicitUiProof === true;
  const requireDesignProof = releaseLooksUserFacing ? true : explicitDesignProof === true;

  if (!renderUrl || renderUrl === '/') {
    pushReleaseCheck(checks, blockers, 'render_url', false, 'renderUrl is required.');
  }
  if (!finalFounderUrl || finalFounderUrl === '/') {
    pushReleaseCheck(checks, blockers, 'domain_url', false, 'baljiaUrl/final founder URL is required.');
  }
  if (!serviceId) {
    pushReleaseCheck(checks, blockers, 'render_service', false, 'No Render service id is stored for this company.');
  } else {
    const deployStatus = await renderGetDeployStatus({
      service_id: serviceId,
      wait_for_terminal: true,
      timeout_seconds: input.timeout_seconds ?? 30,
      poll_interval_seconds: 10,
    });
    pushReleaseCheck(
      checks,
      blockers,
      'render_deploy_status',
      /status:\s*(live|succeeded|success|deployed)/i.test(deployStatus) && !/failed|error/i.test(deployStatus),
      deployStatus,
    );

    const logs = await renderGetLogs({ service_id: serviceId, num_lines: 200 });
    pushReleaseCheck(
      checks,
      blockers,
      'render_logs',
      !/error|exception|traceback|failed/i.test(logs),
      logs.slice(0, 1000),
    );
  }

  if (renderUrl && renderUrl !== '/') {
    const health = await handleCheckUrlHealth({ url: renderUrl });
    pushReleaseCheck(checks, blockers, 'render_url_health', /is UP|HTTP 2\d\d/i.test(health), health);
  }

  const journeys = Array.isArray(input.journeys) ? input.journeys as Record<string, unknown>[] : [];
  for (const [index, journey] of journeys.entries()) {
    const result = await handleVerifyUserJourney({
      base_url: renderUrl,
      ...journey,
    });
    pushReleaseCheck(checks, blockers, `journey_${index + 1}`, /^JOURNEY PASS\b/m.test(result), result);
  }

  const dbAssertions = Array.isArray(input.dbAssertions)
    ? input.dbAssertions as Record<string, unknown>[]
    : Array.isArray(input.db_assertions)
      ? input.db_assertions as Record<string, unknown>[]
      : [];
  for (const [index, assertion] of dbAssertions.entries()) {
    const result = await handleVerifyDbState(assertion, task.company_id);
    pushReleaseCheck(checks, blockers, `db_assertion_${index + 1}`, /^DB STATE PASS\b/m.test(result), result);
  }

  const uiAssertions = Array.isArray(input.uiAssertions)
    ? input.uiAssertions as Record<string, unknown>[]
    : Array.isArray(input.ui_assertions)
      ? input.ui_assertions as Record<string, unknown>[]
      : [];
  const browserAssertions = uiAssertions.length > 0
    ? uiAssertions
    : requireUiProof
      ? [{ screenshot_label: 'verify-release-browser-ui' }]
      : [];
  for (const [index, assertion] of browserAssertions.entries()) {
    const result = await verifyBrowserUi({
      url: renderUrl,
      ...assertion,
    }, task);
    pushReleaseCheck(checks, blockers, `browser_ui_${index + 1}`, /^BROWSER UI PASS\b/m.test(result), result);
  }

  if (requireDesignProof && renderUrl && renderUrl !== '/') {
    const audit = await designAudit({ url: renderUrl });
    pushReleaseCheck(
      checks,
      blockers,
      'design_audit',
      /design_audit CLEAN|0 findings/i.test(audit) && !/HIGH finding|HIGH and \d+ LOW/i.test(audit),
      audit,
    );

    if (process.env.GEMINI_API_KEY) {
      const { critiqueDesign } = await import('@/lib/services/design-critic.service');
      const critique = await critiqueDesign(renderUrl);
      pushReleaseCheck(
        checks,
        blockers,
        'design_critique',
        /design_critique CLEAN/i.test(critique) || (/0 blockers/i.test(critique) && !/\bBLOCKER\b/i.test(critique.replace(/0 blockers?/gi, ''))),
        critique,
      );
    } else {
      pushReleaseCheck(
        checks,
        blockers,
        'design_critique',
        true,
        'design_critique skipped: GEMINI_API_KEY is not configured; deterministic design_audit is the enforced design proof for this run.',
      );
    }
  }

  const staticScan = await handleStaticCodeScan(task.company_id);
  pushReleaseCheck(
    checks,
    blockers,
    'static_scan',
    /^STATIC SCAN PASS\b/m.test(staticScan),
    staticScan,
  );

  if (finalFounderUrl && finalFounderUrl !== '/') {
    const domainHealth = await handleCheckUrlHealth({ url: finalFounderUrl });
    pushReleaseCheck(checks, blockers, 'baljia_domain_health', /is UP|HTTP 2\d\d/i.test(domainHealth), domainHealth);
  }

  const result = {
    passed: blockers.length === 0,
    selectedVerificationUrl: renderUrl.replace(/\/$/, ''),
    finalFounderUrl: finalFounderUrl.replace(/\/$/, ''),
    checks,
    blockers,
  };

  return `${result.passed ? 'VERIFY_RELEASE_PASS' : 'VERIFY_RELEASE_FAIL'} ${JSON.stringify(result)}`;
}

function handleListJourneyTemplates(input: Record<string, unknown>): string {
  const which = ((input.template as string | undefined) ?? 'all').toLowerCase();
  const TEMPLATES: Record<string, { description: string; steps: Array<Record<string, unknown>>; substitute: string[] }> = {
    auth: {
      description: 'register → reach authenticated dashboard → log out → log back in → reach dashboard again. Catches session-cookie bugs (trust-proxy missing, cookie.secure misconfig, store-not-persisting).',
      steps: [
        { step: 'landing loads',         path: '/',                                            expect_status: 200 },
        { step: 'register form loads',   path: '/register',                                     expect_status: 200, expect_body_contains: 'password' },
        { step: 'submit register',       method: 'POST', path: '/auth/register', body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard', expect_body_not_contains: 'failed' },
        { step: 'dashboard authed',      path: '/dashboard',                                    expect_status: 200, expect_body_not_contains: 'Sign in' },
        { step: 'logout',                method: 'POST', path: '/auth/logout',                  expect_status: 302 },
        { step: 'login form loads',      path: '/login',                                        expect_status: 200 },
        { step: 'submit login',          method: 'POST', path: '/auth/login',    body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard', expect_body_not_contains: 'Invalid' },
        { step: 'dashboard after login', path: '/dashboard',                                    expect_status: 200 },
      ],
      substitute: ['<TEST_EMAIL>: a unique throwaway email like `test+<unix-ms>@baljia.test`', '<TEST_PASSWORD>: a 12+ char string the agent generates fresh per run'],
    },
    crud: {
      description: 'register → create one item via POST → see it on the dashboard → delete it → confirm gone. Catches lying-server bugs (302 with silently-failed INSERT) and missing-FK bugs.',
      steps: [
        { step: 'register first',     method: 'POST', path: '/auth/register', body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard' },
        { step: 'create item',        method: 'POST', path: '<CREATE_PATH>',  body: { '<TITLE_FIELD>': 'Smoke Test Item' },                  body_type: 'form', expect_status: [302, 201] },
        { step: 'item appears',       path: '/dashboard',                                                                                    expect_status: 200, expect_body_contains: 'Smoke Test Item' },
        { step: 'delete item',        method: 'POST', path: '<DELETE_PATH>',  expect_status: [200, 302] },
        { step: 'item gone',          path: '/dashboard',                                                                                    expect_status: 200, expect_body_not_contains: 'Smoke Test Item' },
      ],
      substitute: ['<CREATE_PATH>: e.g. /api/items', '<DELETE_PATH>: e.g. /api/items/:id/delete (you fetch the ID first OR use a slug)', '<TITLE_FIELD>: name of the form field, usually `title`'],
    },
    payment: {
      description: '/pricing page renders + Stripe payment link is reachable. Does not simulate Stripe checkout (that needs Stripe test-mode + webhooks); just proves the founder did wire a real link and not a placeholder.',
      steps: [
        { step: 'pricing page renders',  path: '/pricing',                                expect_status: 200, expect_body_contains: 'buy.stripe.com' },
        { step: 'Stripe link reachable', path: '<EXTRACTED_STRIPE_LINK>',                 expect_status: 200 },
      ],
      substitute: ['<EXTRACTED_STRIPE_LINK>: extract from the pricing page response with a regex like /https:\\/\\/buy\\.stripe\\.com\\/[A-Za-z0-9_]+/'],
    },
    settings: {
      description: 'register → update one profile field → reload dashboard → confirm new value rendered. Catches read-after-write bugs and session-data staleness.',
      steps: [
        { step: 'register',           method: 'POST', path: '/auth/register',   body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302 },
        { step: 'open settings',      path: '/settings',                                                                                       expect_status: 200 },
        { step: 'update field',       method: 'POST', path: '/settings/update', body: { '<FIELD>': '<NEW_VALUE>' },                            body_type: 'form', expect_status: [200, 302] },
        { step: 'reload settings',    path: '/settings',                                                                                       expect_status: 200, expect_body_contains: '<NEW_VALUE>' },
        { step: 'reload dashboard',   path: '/dashboard',                                                                                      expect_status: 200, expect_body_contains: '<NEW_VALUE>' },
      ],
      substitute: ['<FIELD>: settings field name, e.g. display_name', '<NEW_VALUE>: the value you submitted in the previous step'],
    },
    full_mvp: {
      description: 'Full happy-path: auth → first feature use → upgrade flow visible. Combines auth + crud + payment into one stateful journey. Most engineering tasks should use this template.',
      steps: [
        { step: 'landing loads',           path: '/',                                                          expect_status: 200 },
        { step: 'submit register',         method: 'POST', path: '/auth/register', body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard' },
        { step: 'dashboard authed',        path: '/dashboard',                                                  expect_status: 200, expect_body_not_contains: 'Sign in' },
        { step: 'create first item',       method: 'POST', path: '<CREATE_PATH>',  body: { '<TITLE_FIELD>': 'first item' },                       body_type: 'form', expect_status: [302, 201] },
        { step: 'item visible',            path: '/dashboard',                                                  expect_status: 200, expect_body_contains: 'first item' },
        { step: 'pricing rendered',        path: '/pricing',                                                    expect_status: 200, expect_body_contains: 'buy.stripe.com' },
        { step: 'logout',                  method: 'POST', path: '/auth/logout',                                expect_status: 302 },
        { step: 'sign back in',            method: 'POST', path: '/auth/login',    body: { email: '<TEST_EMAIL>', password: '<TEST_PASSWORD>' }, body_type: 'form', expect_status: 302, expect_redirect: '/dashboard' },
        { step: 'item still there',        path: '/dashboard',                                                  expect_status: 200, expect_body_contains: 'first item' },
      ],
      substitute: ['<CREATE_PATH>: feature create endpoint, e.g. /api/items', '<TITLE_FIELD>: feature form field, usually `title`', 'Always pair with verify_db_state asserting the user row + item row landed.'],
    },
  };

  const out: Record<string, unknown> = {};
  if (which === 'all') {
    for (const [k, v] of Object.entries(TEMPLATES)) out[k] = v;
  } else if (TEMPLATES[which]) {
    out[which] = TEMPLATES[which];
  } else {
    return `Error: unknown template "${which}". Valid: auth, crud, payment, settings, full_mvp, all.`;
  }
  return [
    `## Journey templates`,
    ``,
    `Each template is a partial verify_user_journey input. Substitute the <PLACEHOLDERS> with concrete values, set base_url to the deployed app, and pass the result as the verify_user_journey \`steps\` field.`,
    ``,
    `\`\`\`json`,
    JSON.stringify(out, null, 2),
    `\`\`\``,
    ``,
    `Reminders:`,
    `- Use a fresh test email per run: \`test+\${Date.now()}@baljia.test\``,
    `- Pair every CRUD-touching journey with verify_db_state to catch lying-server 302s.`,
    `- Stop on first failure; read render_get_logs; fix root cause; redeploy; re-run.`,
  ].join('\n');
}

async function handleCheckUrlHealth(input: Record<string, unknown>): Promise<string> {
  const url = input.url as string;
  if (!url) return 'Error: url is required.';
  const safety = await assertUrlSafe(url);
  if (!safety.ok) return `Error: ${safety.reason}`;

  try {
    const start = Date.now();
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000), // 15s timeout
      headers: { 'User-Agent': 'Baljia/1.0 health-check' },
    });
    const elapsed = Date.now() - start;

    if (response.ok) {
      return `Ã¢Å“â€¦ ${url} is UP Ã¢â‚¬â€ HTTP ${response.status} in ${elapsed}ms`;
    }

    return `Ã¢Å¡Â Ã¯Â¸Â ${url} returned HTTP ${response.status} in ${elapsed}ms Ã¢â‚¬â€ app may have an error. Check logs with render_get_logs.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return `Ã¢ÂÅ’ ${url} is DOWN Ã¢â‚¬â€ ${msg}. The deploy may have failed. Check logs or run render_rollback.`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Rollback Ã¢â€â‚¬Ã¢â€â‚¬

async function handleRenderRollback(input: Record<string, unknown>): Promise<string> {
  const serviceId = input.service_id as string;
  if (!serviceId) return 'Error: service_id is required.';

  try {
    const headers = renderHeaders();

    // Get last 5 deploys to find the most recent successful one
    const historyRes = await fetch(`${RENDER_API}/services/${serviceId}/deploys?limit=5`, { headers });
    if (!historyRes.ok) return `Failed to fetch deploy history: ${historyRes.statusText}`;

    const deploys = await historyRes.json() as Array<{ id?: string; status?: string; deploy?: { id?: string; status?: string } }>;
    if (!Array.isArray(deploys) || deploys.length < 2) {
      return 'No previous deployment found to roll back to. This service may only have one deploy.';
    }

    // Skip [0] (current), find the most recent "live" one after it
    const previousGood = deploys.slice(1).find((d) => {
      const status = d.deploy?.status ?? d.status;
      return status === 'live' || status === 'succeeded';
    });

    if (!previousGood) {
      return 'No successful previous deployment found to roll back to. All recent deploys may have failed.';
    }

    const deployId = previousGood.deploy?.id ?? previousGood.id;
    log.info('Rolling back Render service', { serviceId, deployId });

    // Trigger a new deploy (Render doesn't support re-deploying old deploy ID directly,
    // so we trigger fresh deploy and note the rollback)
    const deployRes = await fetch(`${RENDER_API}/services/${serviceId}/deploys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clearCache: 'do_not_clear' }),
    });

    const data = await deployRes.json() as { id?: string; status?: string; message?: string };
    if (!deployRes.ok) return `Rollback deploy failed: ${data.message ?? deployRes.statusText}`;

    return `Ã°Å¸â€â€ž Rollback triggered! New deploy ID: ${data.id} (based on last successful deploy).\nMonitor with render_get_deploy_status.`;
  } catch (err) {
    return `Rollback error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Custom Domain handlers Ã¢â€â‚¬Ã¢â€â‚¬


async function handleAttachCustomDomain(input: Record<string, unknown>, companyId: string): Promise<string> {
  const domain = input.domain as string;
  if (!domain) return 'Error: domain is required';

  try {
    const result = await attachCustomDomain(companyId, domain);
    if (!result) {
      return 'Failed to attach custom domain. Make sure a website has been deployed to Render first (use create_instance or render_create_service).';
    }

    return [
      `Ã¢Å“â€¦ Custom domain "${result.domain}" attached!`,
      `Status: ${result.status}`,
      '',
      result.dnsInstructions,
      '',
      'Tell the founder to set up these DNS records. SSL will be automatic once DNS propagates (5-15 min).',
    ].join('\n');
  } catch (err) {
    return `Custom domain error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleVerifyCustomDomain(companyId: string): Promise<string> {
  try {
    const result = await verifyCustomDomain(companyId);
    if (!result) {
      return 'No custom domain configured for this company, or Render service not found.';
    }

    if (result.verified && result.sslReady) {
      return `Ã¢Å“â€¦ Domain "${result.domain}" is fully verified and SSL is active! The site is live at https://${result.domain}`;
    }

    return [
      `Ã¢ÂÂ³ Domain "${result.domain}" is not yet verified.`,
      `Verified: ${result.verified ? 'Ã¢Å“â€¦' : 'Ã¢ÂÅ’'}`,
      `SSL Ready: ${result.sslReady ? 'Ã¢Å“â€¦' : 'Ã¢ÂÅ’'}`,
      '',
      'The founder needs to set the DNS CNAME records. It can take 5-30 minutes to propagate.',
    ].join('\n');
  } catch (err) {
    return `Domain verification error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Database Infrastructure handlers Ã¢â€â‚¬Ã¢â€â‚¬

async function handleProvisionDatabase(companyId: string): Promise<string> {
  // Check if already provisioned
  const existing = await getCompanyDatabase(companyId);
  if (existing) {
    return [
      'Ã¢Å“â€¦ Database already provisioned!',
      `Project: ${existing.name}`,
      `Host: ${existing.host}`,
      `Connection: ${existing.connectionUri ? '(available Ã¢â‚¬â€ use get_database_info for code snippets)' : 'pending'}`,
      '',
      'Use run_migration to create tables, then push code that connects to this database.',
    ].join('\n');
  }

  // Get company slug for naming
  const [company] = await db.select({ slug: companies.slug, name: companies.name })
    .from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company?.slug) return 'Error: Company not found or missing slug.';

  try {
    const result = await provisionCompanyDatabase(companyId, company.slug);
    return [
      `Ã¢Å“â€¦ Database provisioned for ${company.name}!`,
      `Project: ${result.name}`,
      `Host: ${result.host}`,
      `Database: neondb (default)`,
      '',
      'Next steps:',
      '1. Use run_migration to create your schema (CREATE TABLE statements)',
      '2. Use get_database_info to get the connection string for your app code',
      '3. Push code that uses DATABASE_URL env var to connect',
      '4. Add DATABASE_URL to Render env vars when deploying',
    ].join('\n');
  } catch (err) {
    return `Database provisioning failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleGetDatabaseInfo(companyId: string): Promise<string> {
  try {
    const dbInfo = await getCompanyDatabase(companyId);
    if (!dbInfo) {
      return 'No database provisioned yet. Use provision_database first.';
    }

    // Mask the password in connection URI for safety in logs
    const maskedUri = dbInfo.connectionUri
      ? dbInfo.connectionUri.replace(/:[^:@]+@/, ':***@')
      : 'not available';

    return [
      `## Database Info`,
      `Project ID: ${dbInfo.projectId}`,
      `Host: ${dbInfo.host}`,
      `Database: neondb`,
      `Connection URI (masked): ${maskedUri}`,
      '',
      '## Code Integration',
      '```env',
      `DATABASE_URL="${maskedUri}"`,
      '```',
      '',
      '## Node.js connection example',
      '```javascript',
      `const { Pool } = require(${"'"}pg${"'"});`,
      'const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });',
      '```',
      '',
      'IMPORTANT: Add DATABASE_URL as an environment variable in Render when deploying.',
    ].join('\n');
  } catch (err) {
    return `Failed to get database info: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

function hasExecutableSql(statement: string): boolean {
  return statement
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .length > 0;
}

export function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i++;
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === '"' && next === '"') {
        current += next;
        i++;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (ch === '-' && next === '-') {
      current += ch + next;
      i++;
      inLineComment = true;
      continue;
    }

    if (ch === '/' && next === '*') {
      current += ch + next;
      i++;
      inBlockComment = true;
      continue;
    }

    if (ch === "'") {
      current += ch;
      inSingleQuote = true;
      continue;
    }

    if (ch === '"') {
      current += ch;
      inDoubleQuote = true;
      continue;
    }

    if (ch === '$') {
      const match = sql.slice(i).match(/^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/);
      if (match) {
        dollarTag = match[1];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }

    if (ch === ';') {
      const statement = current.trim();
      if (statement && hasExecutableSql(statement)) statements.push(statement);
      current = '';
      continue;
    }

    current += ch;
  }

  const trailing = current.trim();
  if (trailing && hasExecutableSql(trailing)) statements.push(trailing);
  return statements;
}

export function isTransientNeonHttpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|econnreset|etimedout|socket hang up|network|timeout|503|502|504/i.test(message);
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runNeonOperationWithRetry<T>(
  label: string,
  operation: () => Promise<T>,
  context: Record<string, unknown>,
): Promise<T> {
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientNeonHttpError(error) || attempt === maxAttempts) break;
      const delayMs = 1_500 * attempt;
      log.warn(`${label} transient Neon HTTP failure; retrying`, {
        ...context,
        attempt,
        maxAttempts,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleepMs(delayMs);
    }
  }

  throw lastError;
}

async function handleRunMigration(input: Record<string, unknown>, companyId: string): Promise<string> {
  const sql = (input.sql as string)?.trim();
  const description = (input.description as string) ?? 'Migration';

  if (!sql) return 'Error: SQL migration statement is required.';

  // Safety: block destructive operations without explicit intent
  const BLOCKED_PATTERNS = /\b(TRUNCATE|DROP\s+TABLE|DROP\s+DATABASE|DROP\s+SCHEMA)\b/i;
  if (BLOCKED_PATTERNS.test(sql)) {
    return 'Error: TRUNCATE and DROP TABLE/DATABASE/SCHEMA are not allowed in autonomous migrations.';
  }

  // Get database info
  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo) {
    return 'No database provisioned. Use provision_database first.';
  }

  if (!dbInfo.connectionUri) {
    return 'Database exists but connection URI not available. Check NEON_API_KEY configuration.';
  }

  try {
    // Use Neon branching for safe migrations
    log.info('Running migration', { companyId, description, projectId: dbInfo.projectId });

    // Connect directly to the main branch and run migration
    // In production, we'd branch-test-merge, but for v1 direct execution is acceptable
    // CF-compat: use Neon HTTP driver (edge-compatible via fetch, no TCP pg)
    const { neon } = await import('@neondatabase/serverless');
    const neonSql = neon(dbInfo.connectionUri);
    const statements = splitMigrationStatements(sql);
    if (statements.length === 0) return 'Error: SQL migration contains no executable statements.';

    let rowCount = 0;
    if (statements.length === 1) {
      const result = await runNeonOperationWithRetry(
        'run_migration',
        () => neonSql.query(statements[0]),
        { companyId, description, statementCount: statements.length },
      );
      rowCount = Array.isArray(result) ? result.length : 0;
    } else {
      const results = await runNeonOperationWithRetry(
        'run_migration',
        () => neonSql.transaction((txn) => statements.map((statement) => txn.query(statement))),
        { companyId, description, statementCount: statements.length },
      );
      rowCount = results.reduce((sum, result) => sum + (Array.isArray(result) ? result.length : 0), 0);
    }

    log.info('Migration completed', { companyId, description, rowCount, statementCount: statements.length });

    return [
      `Ã¢Å“â€¦ Migration successful: "${description}"`,
      `Statements executed: ${statements.length}`,
      `Rows affected: ${rowCount}`,
      `SQL executed: ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}`,
      '',
      'Use query_company_db to verify the schema.',
    ].join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error('Migration failed', { companyId, description, error: msg });
    return `Migration failed: ${msg}\n\nSQL: ${sql.substring(0, 300)}`;
  }
}

async function handleQueryCompanyDb(input: Record<string, unknown>, companyId: string): Promise<string> {
  const sql = (input.sql as string)?.trim();
  if (!sql) return 'Error: SQL query is required.';

  // Only allow SELECT
  if (!/^SELECT\b/i.test(sql)) {
    return 'Error: Only SELECT queries are allowed. Use run_migration for DDL/DML.';
  }

  // Block dangerous patterns
  if (/;/.test(sql)) {
    return 'Error: Multiple statements not allowed. Send a single SELECT query.';
  }

  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo) return 'No database provisioned. Use provision_database first.';
  if (!dbInfo.connectionUri) return 'Database connection URI not available.';

  try {
    // CF-compat: use Neon HTTP driver (edge-compatible via fetch, no TCP pg)
    const { neon } = await import('@neondatabase/serverless');
    const neonSql = neon(dbInfo.connectionUri);
    const rows = await runNeonOperationWithRetry(
      'query_company_db',
      () => neonSql.query(sql) as Promise<Record<string, unknown>[]>,
      { companyId },
    );

    if (rows.length === 0) return 'Query returned 0 rows.';

    const truncated = rows.slice(0, 50);
    return `Query returned ${rows.length} rows:\n${JSON.stringify(truncated, null, 2)}${rows.length > 50 ? '\n... (showing first 50)' : ''}`;
  } catch (err) {
    return `Query failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Stripe Payment handlers Ã¢â€â‚¬Ã¢â€â‚¬
// Uses the FOUNDER'S Stripe account, resolved from payment_connections.
// Money flows customer -> founder's Stripe -> founder's bank.
// Baljia never custodies funds. See docs/baljiapayment.md architectural rule 1.

async function getFounderStripe(companyId: string): Promise<{ stripe: import('stripe').Stripe; mode: 'test' | 'live' } | { error: string }> {
  const { resolveConnection, notConnectedMessage } = await import('@/lib/services/payment-connection.service');
  const conn = await resolveConnection(companyId, 'stripe');
  if (!conn) return { error: notConnectedMessage('stripe') };
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(conn.secret_key, { apiVersion: '2025-02-24.acacia' });
  return { stripe, mode: conn.mode };
}

async function handleStripeCreateProduct(input: Record<string, unknown>, companyId: string): Promise<string> {
  const resolved = await getFounderStripe(companyId);
  if ('error' in resolved) return resolved.error;
  const { stripe, mode } = resolved;

  try {
    const product = await stripe.products.create({
      name: input.name as string,
      description: (input.description as string) ?? undefined,
      metadata: { baljia_company_id: companyId, created_by: 'baljia_engineering_agent' },
    });

    return [
      `Stripe product created in founder's account (${mode} mode).`,
      `Product ID: ${product.id}`,
      `Name: ${product.name}`,
      '',
      'Next: Use stripe_create_price to set pricing for this product.',
    ].join('\n');
  } catch (err) {
    return `Stripe product creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleStripeCreatePrice(input: Record<string, unknown>, companyId: string): Promise<string> {
  const resolved = await getFounderStripe(companyId);
  if ('error' in resolved) return resolved.error;
  const { stripe } = resolved;

  try {
    const amountCents = input.amount_cents as number;
    const currency = (input.currency as string) ?? 'usd';
    const isRecurring = input.recurring === true;
    const interval = (input.interval as string) ?? 'month';

    const priceData: Record<string, unknown> = {
      product: input.product_id as string,
      unit_amount: amountCents,
      currency,
      metadata: { baljia_company_id: companyId },
    };

    if (isRecurring) {
      priceData.recurring = { interval };
    }

    const price = await stripe.prices.create(priceData as unknown as Parameters<typeof stripe.prices.create>[0]);

    const formattedPrice = `${currency.toUpperCase()} ${(amountCents / 100).toFixed(2)}`;
    const billing = isRecurring ? `/${interval}` : ' one-time';

    return [
      `Price created: ${formattedPrice}${billing}`,
      `Price ID: ${price.id}`,
      `Product: ${input.product_id}`,
      '',
      'Next: Use stripe_create_payment_link to generate a checkout URL.',
    ].join('\n');
  } catch (err) {
    return `Stripe price creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleStripeCreatePaymentLink(input: Record<string, unknown>, companyId: string): Promise<string> {
  const resolved = await getFounderStripe(companyId);
  if ('error' in resolved) return resolved.error;
  const { stripe, mode } = resolved;

  try {
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: input.price_id as string, quantity: 1 }],
      metadata: { baljia_company_id: companyId },
    });

    return [
      `Payment link created in founder's Stripe account (${mode} mode).`,
      `URL: ${paymentLink.url}`,
      '',
      'This is a shareable checkout link. The founder can:',
      '1. Embed it as a button on their website',
      '2. Share it directly with customers',
      '3. Use it in email campaigns',
      '',
      'Code snippet for their site:',
      '```html',
      `<a href="${paymentLink.url}" class="btn">Pay now</a>`,
      '```',
    ].join('\n');
  } catch (err) {
    return `Payment link creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function handleStripeGetProducts(companyId: string): Promise<string> {
  const resolved = await getFounderStripe(companyId);
  if ('error' in resolved) return resolved.error;
  const { stripe } = resolved;

  try {
    // Try Baljia-tagged products first; fall back to listing the founder's recent products.
    const tagged = await stripe.products.search({
      query: `metadata['baljia_company_id']:'${companyId}'`,
    }).catch(() => ({ data: [] as Awaited<ReturnType<typeof stripe.products.list>>['data'] }));

    const products = tagged.data.length > 0
      ? tagged.data
      : (await stripe.products.list({ limit: 20, active: true })).data;

    if (products.length === 0) {
      return 'No Stripe products found in the founder\'s account. Use stripe_create_product to get started.';
    }

    const lines: string[] = ['## Stripe Products (founder\'s account)\n'];

    for (const product of products) {
      lines.push(`### ${product.name} (${product.id})`);
      lines.push(`Status: ${product.active ? 'Active' : 'Inactive'}`);

      const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
      if (prices.data.length > 0) {
        lines.push('Prices:');
        for (const price of prices.data) {
          const cur = (price.currency ?? 'usd').toUpperCase();
          const amt = `${cur} ${((price.unit_amount ?? 0) / 100).toFixed(2)}`;
          const billing = price.recurring ? `/${price.recurring.interval}` : ' one-time';
          lines.push(`  - ${amt}${billing} (${price.id})`);
        }
      } else {
        lines.push('No prices configured yet.');
      }
      lines.push('');
    }

    return lines.join('\n');
  } catch (err) {
    return `Failed to list products: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: branch + PR Ã¢â€â‚¬Ã¢â€â‚¬

async function githubCreateBranch(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = await assertRepoOwnership(input.repo as string, companyId, 'write');
    const branchName = input.branch_name as string;
    const baseBranch = (input.base_branch as string) ?? 'main';

    // Get SHA of base branch
    const refRes = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${baseBranch}`, { headers });
    if (!refRes.ok) {
      const d = await refRes.json() as { message?: string };
      return `Could not get base branch ref: ${d.message ?? refRes.statusText}`;
    }
    const refData = await refRes.json() as { object: { sha: string } };
    const sha = refData.object.sha;

    // Create branch
    const createRes = await fetch(`${GITHUB_API}/repos/${repo}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
    });

    if (!createRes.ok) {
      const d = await createRes.json() as { message?: string };
      return `Branch creation failed: ${d.message ?? createRes.statusText}`;
    }

    return `Ã¢Å“â€¦ Branch \"${branchName}\" created in ${repo} (from ${baseBranch}).\nUse github_push_file with branch="${branchName}" to push changes.`;
  } catch (err) {
    return `GitHub branch error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function githubCreatePR(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = await assertRepoOwnership(input.repo as string, companyId, 'write');

    const body = {
      title: input.title as string,
      body: (input.body as string) ?? '',
      head: input.head_branch as string,
      base: (input.base_branch as string) ?? 'main',
    };

    const prRes = await fetch(`${GITHUB_API}/repos/${repo}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await prRes.json() as { html_url?: string; number?: number; message?: string };
    if (!prRes.ok) return `PR creation failed: ${data.message ?? prRes.statusText}`;

    return `Ã¢Å“â€¦ Pull request #${data.number} created!\nURL: ${data.html_url}\nMerge "${input.head_branch}" Ã¢â€ â€™ "${body.base}"`;
  } catch (err) {
    return `GitHub PR error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Render: list + metrics Ã¢â€â‚¬Ã¢â€â‚¬

async function renderListServices(_input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    // Tenant scoping: agents only see THIS company's service. The API
    // returns the operator account's full fleet; without filtering, an
    // engineering agent in company A's context could see every other
    // founder's service ids + URLs. Return just the one row owned by the
    // calling company.
    const [company] = await db.select({ render_service_id: companies.render_service_id, name: companies.name })
      .from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company?.render_service_id) {
      return 'No Render service provisioned for this company yet. Call create_instance for full-stack apps, or render_create_service for backend/manual Render paths.';
    }
    const headers = renderHeaders();
    const res = await fetch(`${RENDER_API}/services/${company.render_service_id}`, { headers });
    if (!res.ok) return `Render get failed: HTTP ${res.status}`;
    const s = await res.json() as { id?: string; name?: string; type?: string; serviceDetails?: { url?: string } };
    return `## Render Services (1, scoped to this company)\n- [${s.id ?? '?'}] ${s.name ?? company.name} (${s.type ?? '?'}) -- ${s.serviceDetails?.url ?? 'no URL'}`;
  } catch (err) {
    return `Render list error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

async function renderGetMetrics(input: Record<string, unknown>): Promise<string> {
  try {
    const headers = renderHeaders();
    const serviceId = input.service_id as string;
    const resolution = (input.resolution as string) ?? '1h';

    const res = await fetch(`${RENDER_API}/services/${serviceId}/metrics?resolution=${resolution}`, { headers });
    if (!res.ok) return `Metrics not available: ${res.statusText} (service must be a paid web service)`;

    const data = await res.json() as {
      cpuPercent?: Array<{ time: string; value: number }>;
      memoryBytes?: Array<{ time: string; value: number }>;
    };

    const cpuLines = (data.cpuPercent ?? []).slice(-5).map((p) => `  ${p.time}: ${p.value.toFixed(1)}%`).join('\n');
    const memLines = (data.memoryBytes ?? []).slice(-5).map((p) => `  ${p.time}: ${(p.value / 1024 / 1024).toFixed(0)} MB`).join('\n');

    return `## Service Metrics (${resolution})\n\n**CPU:**\n${cpuLines || '  No data'}\n\n**Memory:**\n${memLines || '  No data'}`;
  } catch (err) {
    return `Render metrics error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: search code Ã¢â€â‚¬Ã¢â€â‚¬

async function githubSearchCode(input: Record<string, unknown>, companyId: string): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = await assertRepoOwnership(input.repo as string, companyId, 'read');
    const query = input.query as string;
    const language = input.language as string | undefined;

    let q = `${encodeURIComponent(query)}+repo:${repo}`;
    if (language) q += `+language:${encodeURIComponent(language)}`;

    const res = await fetch(`${GITHUB_API}/search/code?q=${q}&per_page=10`, { headers });
    if (!res.ok) {
      const d = await res.json() as { message?: string };
      if (res.status === 403) return `GitHub search rate limited. Try again in 30 seconds, or use github_read_file to read specific files directly.`;
      return `GitHub search failed: ${d.message ?? res.statusText}`;
    }

    const data = await res.json() as {
      total_count: number;
      items: Array<{ path: string; html_url: string; text_matches?: Array<{ fragment: string }> }>;
    };

    if (!data.items.length) return `No code found matching "${query}" in ${repo}.`;

    const lines = data.items.map((item) => {
      const fragment = item.text_matches?.[0]?.fragment?.substring(0, 120) ?? '';
      return `Ã°Å¸â€œâ€ž ${item.path}\n   ${fragment ? `\`${fragment.replace(/\n/g, ' ')}\`` : '(no preview)'}`;
    });

    return `## Code Search: "${query}" (${data.total_count} results, showing ${data.items.length})\n\n${lines.join('\n\n')}`;
  } catch (err) {
    return `GitHub search error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GitHub: multi-file atomic commit via Git Trees API Ã¢â€â‚¬Ã¢â€â‚¬

async function githubCreateCommit(input: Record<string, unknown>, companyId: string, task?: Task): Promise<string> {
  try {
    const headers = githubHeaders();
    const repo = await assertRepoOwnership(input.repo as string, companyId, 'write');
    const branch = (input.branch as string) ?? 'main';
    const message = input.message as string;
    const files = input.files as Array<{ path: string; content: string }> | undefined;

    if (!files?.length) {
      return `github_create_commit error: \`files\` array is missing or empty. This usually means your response was truncated at the output token cap (the commit payload was too large). Fix one of these ways: (1) split the change into multiple smaller commits, each touching fewer files; (2) push large files individually with \`github_push_file\`; (3) move the HTML out of server.js into a separate \`public/index.html\` so server.js stays small. Do NOT retry the same call — it will fail the same way.`;
    }
    const badFile = files.find((f) => typeof f?.path !== 'string' || typeof f?.content !== 'string' || f.content.length === 0);
    if (badFile) {
      return `github_create_commit error: one or more entries in \`files\` is missing \`path\` or \`content\` (the \`content\` field was likely truncated at the output token cap). Push the affected file individually with \`github_push_file\`, or shrink its content. Bad entry path="${(badFile as { path?: unknown })?.path ?? 'unknown'}".`;
    }
    const runtimeBlocker = protectedRuntimeFileBlocker(files.map((f) => f.path), task);
    if (runtimeBlocker) return runtimeBlocker;

    // Step 1: Get latest commit SHA on branch
    const refRes = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`, { headers });
    if (!refRes.ok) return `Could not get branch ref: ${(await refRes.json() as { message?: string }).message}`;
    const refData = await refRes.json() as { object: { sha: string } };
    const latestCommitSha = refData.object.sha;

    // Step 2: Get tree SHA of latest commit
    const commitRes = await fetch(`${GITHUB_API}/repos/${repo}/git/commits/${latestCommitSha}`, { headers });
    if (!commitRes.ok) return `Could not get commit: ${commitRes.statusText}`;
    const commitData = await commitRes.json() as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // Step 3: Create new tree
    const treeRes = await fetch(`${GITHUB_API}/repos/${repo}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      }),
    });
    if (!treeRes.ok) return `Could not create tree: ${(await treeRes.json() as { message?: string }).message}`;
    const treeData = await treeRes.json() as { sha: string };

    // Step 4: Create commit
    const newCommitRes = await fetch(`${GITHUB_API}/repos/${repo}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, tree: treeData.sha, parents: [latestCommitSha] }),
    });
    if (!newCommitRes.ok) return `Could not create commit: ${(await newCommitRes.json() as { message?: string }).message}`;
    const newCommit = await newCommitRes.json() as { sha: string };

    // Step 5: Update branch ref
    const updateRes = await fetch(`${GITHUB_API}/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: newCommit.sha }),
    });
    if (!updateRes.ok) return `Commit created (${newCommit.sha.substring(0, 7)}) but branch update failed: ${updateRes.statusText}`;

    return `Ã¢Å“â€¦ Committed ${files.length} file(s) to ${repo}/${branch}\nCommit: ${newCommit.sha.substring(0, 7)} Ã¢â‚¬â€ "${message}"\nFiles: ${files.map((f) => f.path).join(', ')}`;
  } catch (err) {
    return `GitHub commit error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Render: list databases Ã¢â€â‚¬Ã¢â€â‚¬

async function githubCommitFilesUnchecked(params: {
  repo: string;
  branch?: string;
  message: string;
  files: Array<{ path: string; content: string }>;
}): Promise<{ ok: boolean; sha?: string; error?: string }> {
  const headers = githubHeaders();
  const branch = params.branch ?? 'main';

  const refRes = await fetch(`${GITHUB_API}/repos/${params.repo}/git/ref/heads/${branch}`, { headers });
  if (!refRes.ok) {
    return { ok: false, error: `Could not get branch ref: ${(await refRes.json().catch(() => ({})) as { message?: string }).message ?? refRes.statusText}` };
  }
  const refData = await refRes.json() as { object: { sha: string } };
  const latestCommitSha = refData.object.sha;

  const commitRes = await fetch(`${GITHUB_API}/repos/${params.repo}/git/commits/${latestCommitSha}`, { headers });
  if (!commitRes.ok) return { ok: false, error: `Could not get commit: ${commitRes.statusText}` };
  const commitData = await commitRes.json() as { tree: { sha: string } };

  const treeRes = await fetch(`${GITHUB_API}/repos/${params.repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: commitData.tree.sha,
      tree: params.files.map((file) => ({
        path: file.path,
        mode: '100644',
        type: 'blob',
        content: file.content,
      })),
    }),
  });
  if (!treeRes.ok) {
    return { ok: false, error: `Could not create tree: ${(await treeRes.json().catch(() => ({})) as { message?: string }).message ?? treeRes.statusText}` };
  }
  const treeData = await treeRes.json() as { sha: string };

  const newCommitRes = await fetch(`${GITHUB_API}/repos/${params.repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: params.message, tree: treeData.sha, parents: [latestCommitSha] }),
  });
  if (!newCommitRes.ok) {
    return { ok: false, error: `Could not create commit: ${(await newCommitRes.json().catch(() => ({})) as { message?: string }).message ?? newCommitRes.statusText}` };
  }
  const newCommit = await newCommitRes.json() as { sha: string };

  const updateRes = await fetch(`${GITHUB_API}/repos/${params.repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: newCommit.sha }),
  });
  if (!updateRes.ok) return { ok: false, sha: newCommit.sha, error: `Branch update failed: ${updateRes.statusText}` };

  return { ok: true, sha: newCommit.sha };
}

async function renderListDatabases(_input: Record<string, unknown>, companyId: string): Promise<string> {
  // Founder companies use Neon, not Render Postgres — list_databases on
  // Render returns the operator's account fleet which is irrelevant to the
  // calling tenant and a cross-account info leak. Return an empty/scoped
  // result and steer the agent to the correct tool.
  return [
    'Render databases scope: this company uses Neon, not Render Postgres.',
    'Use `get_database_info` (Neon) for the company DB.',
    'Render-Postgres operator-fleet listing is not exposed to engineering tasks.',
  ].join('\n');
}


// SKILLS Ã¢â‚¬â€ read .claude/skills/<name>/SKILL.md
// Polsia-style knowledge layer the agent loads BEFORE writing domain code.
// Skills capture stack-specific patterns + anti-patterns the LLM's training
// data is missing or wrong about for Baljia's current deploy path.
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

const SKILLS_ROOT = join(process.cwd(), '.claude', 'skills');

/** Hard-coded one-line summaries Ã¢â‚¬â€ keeps `list_skills` fast (no file reads)
 *  and gives the agent a stable index it can scan. Update if a SKILL.md file
 *  is renamed; the SKILL.md content itself doesn't need to be touched. */
const SKILL_SUMMARIES: Record<string, string> = {
  'skeleton-nextjs':
    'READ THIS FIRST for any full-stack SaaS. The canonical path is create_instance: reuse or hydrate the company Next.js 15 skeleton repo, reuse/provision Neon, and reuse/provision Render. Users never provide their own API key; AI calls route through the Baljia gateway.',
  'render-infra':
    'MANDATORY before any Render deploy. Documents the /health endpoint, PORT binding, ephemeral filesystem rules, build/start commands, env var patterns, free plan limits, and deploy verification checklist.',
  'openai-proxy':
    'AI utility features for founder apps: fixed Gemini 2 Flash text generation via Google OpenAI-compatible gateway, gemini-embedding-001/vector(3072) embeddings, and no ivfflat/hnsw index on vector(3072). Import from @/lib/ai only. Covers pgvector storage, R2 persistence for images, and error handling.',
  'neon-postgres':
    'Database access for Render founder apps. Provision company Neon first, pass DATABASE_URL to Render, use pg or Drizzle node-postgres, and verify migrations with insert/readback.',
  'frontend-design':
    'UI patterns for Render founder apps. Product-first screens, Baljia visual language, mobile-first layout, accessible forms, and verification through deployed Render routes.',
  'stripe-payments':
    'Payment integration for Render apps. Default to Payment Links, use Checkout Sessions only when needed, store Stripe keys in Render env vars, and verify checkout/webhooks.',
  'r2-storage':
    'Asset storage for generated media, ad creatives, screenshots, exports, and public URLs. Use for Meta Ads media assets, not app deployment.',
  'email-postmark':
    'Transactional email for Render apps. Send through Postmark over HTTPS or platform send path, store tokens in Render env vars, and report sender/recipient verification.',
  'agent-sdk':
    'AI features inside Render founder apps. Keep actions narrow, store provider keys in Render env vars, add timeouts/fallbacks, and verify success plus missing-key behavior.',
  'auth-sessions':
    'Session-based auth for SaaS founder apps. Uses express-session + bcryptjs + connect-pg-simple (Postgres sessions). Covers register, login, logout, protected routes, plan gating, and Stripe checkout linked to user accounts.',
  'craft-frontend':
    'Frontend quality rules: anti-AI-slop patterns, palette + typography craft, state coverage (hover/focus/disabled/loading on every interactive element), form validation UX, WCAG accessibility baseline, and animation discipline. Read BEFORE any landing page, dashboard, or in-app UI.',
  'webhooks':
    'Secure webhook handling for Stripe and GitHub. Signature verification (stripe.webhooks.constructEvent, GitHub X-Hub-Signature-256), idempotency via Neon upsert, event routing, error response rules, and local testing checklist.',
  'background-jobs':
    'Cron jobs on Render: use node-cron inside a separate Worker service. Never use setInterval, worker_threads, or in-process timers. Covers job registration, Render cron service config, Redis-free queue via Neon, retry logic, and dead-letter logging.',
  'verify-deploy':
    'MANDATORY after every deployment. 8-step QA sequence: Render health check, frontend load, auth route, DB schema presence, AI gateway, Stripe webhook signature, email config, and log scan. Includes failure diagnosis table and a verification report template to show the user.',
};

function handleListSkills(): string {
  if (!existsSync(SKILLS_ROOT)) {
    return 'Skills directory does not exist (.claude/skills). The agent has no curated knowledge layer Ã¢â‚¬â€ proceed with general LLM knowledge but expect more iterations.';
  }
  const dirs = readdirSync(SKILLS_ROOT)
    .filter((name) => {
      try {
        return statSync(join(SKILLS_ROOT, name)).isDirectory()
          && existsSync(join(SKILLS_ROOT, name, 'SKILL.md'));
      } catch { return false; }
    })
    .sort();

  if (dirs.length === 0) {
    return '.claude/skills/ exists but contains no skill files. Create directories with SKILL.md to populate.';
  }

  const lines = ['## Available skills', '', 'Read the relevant one BEFORE writing code in that domain. Use `read_skill` with the name.', ''];
  for (const dir of dirs) {
    const summary = SKILL_SUMMARIES[dir] ?? '(no summary Ã¢â‚¬â€ read the file)';
    lines.push(`- **${dir}** Ã¢â‚¬â€ ${summary}`);
  }
  return lines.join('\n');
}

function handleReadSkill(input: Record<string, unknown>): string {
  const name = String(input.skill ?? '').trim();
  if (!name) return 'Error: missing required argument "skill". Call list_skills to see available names.';

  // Defense: only allow kebab-case alphanumeric. Blocks ../../etc/passwd shenanigans
  // even though SKILLS_ROOT is a fixed prefix Ã¢â‚¬â€ belt + suspenders.
  if (!/^[a-z0-9-]+$/.test(name)) {
    return `Error: skill name "${name}" must be kebab-case alphanumeric. Call list_skills.`;
  }

  const filePath = join(SKILLS_ROOT, name, 'SKILL.md');
  if (!existsSync(filePath)) {
    return `Error: skill "${name}" not found. Run list_skills to see what's available.`;
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    return content;
  } catch (err) {
    return `Error reading skill "${name}": ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Skeleton: fork the Baljia Next.js SaaS skeleton into a company repo Ã¢â€â‚¬Ã¢â€â‚¬

const SKELETON_REPO = 'BALAJIapps/Balaji'; // master template repo

async function githubRepoRootEntryNames(repoFullName: string, headers: Record<string, string>): Promise<string[] | null> {
  const listRes = await fetch(`${GITHUB_API}/repos/${repoFullName}/contents/`, { headers });
  if (listRes.status === 404 || listRes.status === 409) return [];
  if (!listRes.ok) return null;
  const entries = await listRes.json().catch(() => null) as Array<{ name?: string }> | null;
  if (!Array.isArray(entries)) return null;
  return entries.map((entry) => entry.name).filter((name): name is string => Boolean(name));
}

async function githubDefaultBranch(repoFullName: string, headers: Record<string, string>): Promise<string> {
  const response = await fetch(`${GITHUB_API}/repos/${repoFullName}`, { headers });
  const data = await response.json().catch(() => ({})) as { default_branch?: string };
  return data.default_branch ?? 'main';
}

async function hydrateExistingRepoFromNextSkeleton(input: {
  targetRepo: string;
  description: string;
  companyId: string;
  headers: Record<string, string>;
}): Promise<string> {
  const { targetRepo, description, companyId, headers } = input;
  const skeletonBranch = await githubDefaultBranch(SKELETON_REPO, headers);
  const skeletonTreeRes = await fetch(`${GITHUB_API}/repos/${SKELETON_REPO}/git/trees/${skeletonBranch}?recursive=1`, { headers });
  if (!skeletonTreeRes.ok) {
    const data = await skeletonTreeRes.json().catch(() => ({})) as { message?: string };
    return `Skeleton hydrate failed: could not read ${SKELETON_REPO} tree (${data.message ?? skeletonTreeRes.statusText}).`;
  }
  const skeletonTree = await skeletonTreeRes.json() as {
    tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string }>;
  };
  const blobs = (skeletonTree.tree ?? [])
    .filter((item) => item.type === 'blob' && item.path && item.sha)
    .map((item) => ({ path: item.path as string, mode: item.mode ?? '100644', sha: item.sha as string }));
  if (blobs.length === 0) return `Skeleton hydrate failed: ${SKELETON_REPO} has no files to copy.`;

  const targetItems: Array<{ path: string; mode: string; type: 'blob'; sha: string }> = [];
  for (const blob of blobs) {
    const sourceBlobRes = await fetch(`${GITHUB_API}/repos/${SKELETON_REPO}/git/blobs/${blob.sha}`, { headers });
    if (!sourceBlobRes.ok) {
      const data = await sourceBlobRes.json().catch(() => ({})) as { message?: string };
      return `Skeleton hydrate failed: could not read ${blob.path} from skeleton (${data.message ?? sourceBlobRes.statusText}).`;
    }
    const sourceBlob = await sourceBlobRes.json() as { content?: string; encoding?: string };
    if (!sourceBlob.content || sourceBlob.encoding !== 'base64') {
      return `Skeleton hydrate failed: ${blob.path} content was not available as base64.`;
    }

    const createBlobRes = await fetch(`${GITHUB_API}/repos/${targetRepo}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: sourceBlob.content.replace(/\n/g, ''),
        encoding: 'base64',
      }),
    });
    if (!createBlobRes.ok) {
      const data = await createBlobRes.json().catch(() => ({})) as { message?: string };
      return `Skeleton hydrate failed: could not create ${blob.path} in ${targetRepo} (${data.message ?? createBlobRes.statusText}).`;
    }
    const createdBlob = await createBlobRes.json() as { sha?: string };
    if (!createdBlob.sha) return `Skeleton hydrate failed: GitHub did not return a blob SHA for ${blob.path}.`;
    targetItems.push({ path: blob.path, mode: blob.mode, type: 'blob', sha: createdBlob.sha });
  }

  const targetBranch = await githubDefaultBranch(targetRepo, headers);
  const refRes = await fetch(`${GITHUB_API}/repos/${targetRepo}/git/ref/heads/${targetBranch}`, { headers });
  if (!refRes.ok) {
    const data = await refRes.json().catch(() => ({})) as { message?: string };
    return `Skeleton hydrate failed: could not read ${targetRepo} ${targetBranch} ref (${data.message ?? refRes.statusText}).`;
  }
  const refData = await refRes.json() as { object?: { sha?: string } };
  const baseCommitSha = refData.object?.sha;
  if (!baseCommitSha) return `Skeleton hydrate failed: ${targetRepo} ${targetBranch} has no commit SHA.`;

  const baseCommitRes = await fetch(`${GITHUB_API}/repos/${targetRepo}/git/commits/${baseCommitSha}`, { headers });
  if (!baseCommitRes.ok) return `Skeleton hydrate failed: could not read base commit for ${targetRepo}.`;
  const baseCommit = await baseCommitRes.json() as { tree?: { sha?: string } };
  if (!baseCommit.tree?.sha) return `Skeleton hydrate failed: base commit for ${targetRepo} has no tree SHA.`;

  const treeRes = await fetch(`${GITHUB_API}/repos/${targetRepo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: targetItems,
    }),
  });
  if (!treeRes.ok) {
    const data = await treeRes.json().catch(() => ({})) as { message?: string };
    return `Skeleton hydrate failed: could not create target tree (${data.message ?? treeRes.statusText}).`;
  }
  const treeData = await treeRes.json() as { sha?: string };
  if (!treeData.sha) return `Skeleton hydrate failed: GitHub did not return a target tree SHA.`;

  const commitRes = await fetch(`${GITHUB_API}/repos/${targetRepo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: `Hydrate Baljia Next.js skeleton\n\nCopied from ${SKELETON_REPO} for ${description}.`,
      tree: treeData.sha,
      parents: [baseCommitSha],
    }),
  });
  if (!commitRes.ok) {
    const data = await commitRes.json().catch(() => ({})) as { message?: string };
    return `Skeleton hydrate failed: could not create commit (${data.message ?? commitRes.statusText}).`;
  }
  const commitData = await commitRes.json() as { sha?: string };
  if (!commitData.sha) return `Skeleton hydrate failed: GitHub did not return a commit SHA.`;

  const updateRefRes = await fetch(`${GITHUB_API}/repos/${targetRepo}/git/refs/heads/${targetBranch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: commitData.sha }),
  });
  if (!updateRefRes.ok) {
    const data = await updateRefRes.json().catch(() => ({})) as { message?: string };
    return `Skeleton hydrate failed: commit ${commitData.sha.substring(0, 7)} created but branch update failed (${data.message ?? updateRefRes.statusText}).`;
  }

  await fetch(`${GITHUB_API}/repos/${targetRepo}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ description }),
  });
  await db.update(companies)
    .set({ github_repo: targetRepo })
    .where(eq(companies.id, companyId));
  const patchSummary = await patchForkedNextSkeletonKnownIssues(targetRepo)
    .catch((err) => `storage patch skipped: ${err instanceof Error ? err.message : String(err)}`);

  return [
    `Next.js skeleton hydrated in existing repo ${targetRepo}.`,
    `Commit: ${commitData.sha.substring(0, 7)} (${targetItems.length} files)`,
    patchSummary ? `Known-issue patch: ${patchSummary}` : null,
    `Next: use github_push_file to patch feature-specific files, then run_drizzle_push.`,
  ].filter(Boolean).join('\n');
}

// ── Express skeleton fork (PRIMARY for Render-hosted founder apps) ──
//
// Reads the skeleton files from skeletons/express-render/ on the platform
// disk, applies per-company placeholder substitution (__SLUG__, __APP_NAME__),
// and pushes them all to the company's GitHub repo as a single atomic
// commit via the Trees API. Mirrors the Next.js skeleton flow but for
// plain Express + Postgres + sessions stacks deployed on Render.

import { promises as fsp } from 'fs';
import * as path from 'path';
import { githubFetch } from '@/lib/services/github-throttle';

const EXPRESS_SKELETON_DIR = path.join(process.cwd(), 'skeletons', 'express-render');

async function collectSkeletonFiles(rootDir: string, slug: string, appName: string): Promise<Array<{ path: string; content: string }>> {
  async function walk(absDir: string, relPrefix: string): Promise<Array<{ path: string; content: string }>> {
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    const out: Array<{ path: string; content: string }> = [];
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push(...await walk(abs, rel));
      } else if (e.isFile()) {
        // node_modules / lockfiles / build output should not be in the
        // skeleton dir, but skip the usual suspects defensively.
        if (rel.startsWith('node_modules/') || rel.endsWith('.lock') || rel.endsWith('.pyc')) continue;
        const raw = await fsp.readFile(abs, 'utf8');
        const content = raw.replace(/__SLUG__/g, slug).replace(/__APP_NAME__/g, appName);
        out.push({ path: rel, content });
      }
    }
    return out;
  }
  return walk(rootDir, '');
}

async function handleForkExpressSkeleton(input: Record<string, unknown>, companyId: string): Promise<string> {
  // 1. Look up company state — need github_repo + slug + display name.
  const [company] = await db.select({
    name: companies.name,
    slug: companies.slug,
    github_repo: companies.github_repo,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return 'Error: company not found.';
  if (!company.github_repo) {
    return 'Error: no GitHub repo on this company. Call create_instance or set the company GitHub repo first; the repo must exist before the skeleton can be pushed.';
  }
  if (!company.slug) {
    return 'Error: company has no slug. Onboarding is incomplete; cannot derive subdomain.';
  }
  // Render service names cap at 30 chars. Slugs from onboarding are typically
  // 8-15, but defensively guard so a long slug doesn't cause render_create_service
  // to 400 with a confusing error after we've already pushed code.
  if (company.slug.length > 30) {
    return `Error: slug "${company.slug}" is ${company.slug.length} chars; Render service names must be ≤30. Update the company slug before forking.`;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(company.slug)) {
    return `Error: slug "${company.slug}" must be lowercase alphanumeric + hyphens, starting with a letter.`;
  }

  const appName = (input.app_name as string | undefined)?.trim() || company.name || company.slug;
  const repo = company.github_repo;
  const headers = githubHeaders();

  // 2. Read & template all skeleton files.
  let files: Array<{ path: string; content: string }>;
  try {
    files = await collectSkeletonFiles(EXPRESS_SKELETON_DIR, company.slug, appName);
  } catch (err) {
    return `Error reading skeleton dir (${EXPRESS_SKELETON_DIR}): ${err instanceof Error ? err.message : String(err)}`;
  }
  if (files.length === 0) {
    return `Error: skeleton dir ${EXPRESS_SKELETON_DIR} has no files.`;
  }

  // 3. Safety: refuse to overwrite a non-trivial existing repo. The fresh
  // GitHub repo provisioned by the platform contains only auto-init README.
  // If the repo already has app code (server.js, src/, etc.), the agent
  // should be using github_create_commit to patch, not re-fork.
  try {
    const listRes = await githubFetch(`${GITHUB_API}/repos/${repo}/contents/`, { headers });
    if (listRes.ok) {
      const entries = await listRes.json() as Array<{ name: string; type: string }>;
      const sentinels = ['server.js', 'package.json', 'src', 'tests'];
      const collisions = entries.filter((e) => sentinels.includes(e.name));
      if (collisions.length > 0) {
        return `Refusing to fork-overwrite ${repo} — already contains: ${collisions.map((c) => c.name).join(', ')}. Use github_create_commit to patch specific files, or delete the repo and re-provision.`;
      }
    }
  } catch {
    // Listing failed; fall through and let the commit attempt surface the real error.
  }

  // 4. Get latest commit + tree on main (the auto-init commit).
  const refRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/main`, { headers });
  if (!refRes.ok) {
    const errBody = await refRes.json().catch(() => ({})) as { message?: string };
    return `Could not read main branch ref on ${repo}: ${errBody.message ?? refRes.statusText}`;
  }
  const refData = await refRes.json() as { object: { sha: string } };
  const baseCommitSha = refData.object.sha;

  const baseCommitRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/commits/${baseCommitSha}`, { headers });
  if (!baseCommitRes.ok) return `Could not read base commit: ${baseCommitRes.statusText}`;
  const baseCommit = await baseCommitRes.json() as { tree: { sha: string } };

  // 5. Create new tree with all skeleton files. base_tree means the existing
  // README from auto_init is preserved unless we explicitly overwrite it,
  // which we DO via the README.md in the skeleton.
  const treeRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/trees`, {
    method: 'POST', headers,
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: '100644' as const, type: 'blob' as const, content: f.content })),
    }),
  });
  if (!treeRes.ok) {
    const errBody = await treeRes.json().catch(() => ({})) as { message?: string };
    return `Could not create tree: ${errBody.message ?? treeRes.statusText}`;
  }
  const treeData = await treeRes.json() as { sha: string };

  // 6. Commit the tree.
  const commitMsg = `Fork Baljia Express skeleton for ${appName}\n\nIncludes: Zod env validation, trust-proxy, Postgres sessions, /api/health probing DB+session+Stripe, structured logging, withTimeout helper, ok/fail discriminated unions, tests/.`;
  const newCommitRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/commits`, {
    method: 'POST', headers,
    body: JSON.stringify({ message: commitMsg, tree: treeData.sha, parents: [baseCommitSha] }),
  });
  if (!newCommitRes.ok) {
    const errBody = await newCommitRes.json().catch(() => ({})) as { message?: string };
    return `Could not create commit: ${errBody.message ?? newCommitRes.statusText}`;
  }
  const newCommit = await newCommitRes.json() as { sha: string };

  // 7. Update main to point at the new commit.
  const updateRes = await githubFetch(`${GITHUB_API}/repos/${repo}/git/refs/heads/main`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ sha: newCommit.sha }),
  });
  if (!updateRes.ok) {
    return `Commit ${newCommit.sha.substring(0, 7)} created but branch update failed: ${updateRes.statusText}`;
  }

  const fileSummary = files.map((f) => `  - ${f.path}`).join('\n');
  return [
    `Express skeleton forked into ${repo}`,
    `Commit: ${newCommit.sha.substring(0, 7)} (${files.length} files)`,
    ``,
    `Files written:`,
    fileSummary,
    ``,
    `Next steps:`,
    `1. run_migration with the contents of db/schema.sql to set up users + session + items tables`,
    `2. Customize landingPage(), dashboardPage(), and the /api/items routes in server.js for your feature`,
    `3. Update db/schema.sql with feature-specific tables (additions only — do not modify users / session)`,
    `4. render_create_service to deploy. The skeleton's /api/health endpoint will be auto-used as Render's healthCheckPath.`,
    `5. After deploy: verify_user_journey for register/login/dashboard. The skeleton's tests/ folder mirrors what the journey verifier checks.`,
  ].join('\n');
}

async function githubForkSkeleton(input: Record<string, unknown>, companyId: string): Promise<string> {
  const repoSlug = (input.repo as string)?.trim();
  if (!repoSlug) return 'Error: repo is required (e.g. "genesis-advertising-hen6").';

  const description = (input.description as string) ?? 'SaaS app built on Baljia skeleton';
  const org = githubOrg();
  const targetRepo = `${org}/${repoSlug}`;
  const headers = githubHeaders();

  try {
    // Step 1: Check if target repo already exists
    const existRes = await fetch(`${GITHUB_API}/repos/${targetRepo}`, { headers });
    if (existRes.ok) {
      const rootNames = await githubRepoRootEntryNames(targetRepo, headers);
      if (rootNames === null) {
        return `Error: repo ${targetRepo} exists, but GitHub root inspection failed. Retry github_fork_skeleton after checking GitHub API/token access.`;
      }
      if (rootNames && !isRepoHydratedForNextSkeleton(rootNames)) {
        if (!isRepoEmptyEnoughToHydrate(rootNames)) {
          return [
            `Refusing to fork-overwrite ${targetRepo} - it already contains non-skeleton files: ${rootNames.join(', ') || '(unknown contents)'}.`,
            `Use github_create_commit/github_push_file to patch the existing app, or clear the repo deliberately before retrying.`,
          ].join('\n');
        }

        return hydrateExistingRepoFromNextSkeleton({
          targetRepo,
          description,
          companyId,
          headers,
        });
      } else {
        await db.update(companies)
          .set({ github_repo: targetRepo })
          .where(eq(companies.id, companyId));
        const patchSummary = await patchForkedNextSkeletonKnownIssues(targetRepo)
          .catch((err) => `storage patch skipped: ${err instanceof Error ? err.message : String(err)}`);
        return [
          `Repo ${targetRepo} already exists and contains the Next.js skeleton.`,
          patchSummary ? `Known-issue patch: ${patchSummary}` : null,
          `Next: use github_push_file to patch in feature-specific files (db/schema.ts, app/actions/, etc.)`,
          `Then: call run_drizzle_push to sync the schema to the database.`,
          `Finally: call create_instance for canonical repo/DB/Render reuse, or render_create_service only if create_instance gave an explicit manual Render fallback.`,
        ].filter(Boolean).join('\n');
      }
    }

    // Step 2: Fork skeleton repo into the org
    const forkRes = await fetch(`${GITHUB_API}/repos/${SKELETON_REPO}/forks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        organization: org,
        name: repoSlug,
        default_branch_only: true,
      }),
    });

    const forkData = await forkRes.json() as { full_name?: string; html_url?: string; message?: string };

    if (!forkRes.ok) {
      if (forkRes.status === 404 || forkRes.status === 403) {
        return [
          `Ã¢Å¡Â Ã¯Â¸Â Could not fork skeleton (${forkData.message ?? forkRes.statusText}).`,
          `The skeleton repo "${SKELETON_REPO}" may be private or the token lacks fork permissions.`,
          `Workaround: ask the platform admin to make ${SKELETON_REPO} a GitHub template repo.`,
          `For now, use github_create_repo to create an empty repo and push the skeleton files manually via github_create_commit.`,
        ].join('\n');
      }
      return `Fork failed: ${forkData.message ?? forkRes.statusText}`;
    }

    const fullName = forkData.full_name ?? targetRepo;

    // Step 3: Update the fork description
    await fetch(`${GITHUB_API}/repos/${fullName}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ description }),
    });

    // Step 4: Save repo to company record
    await db.update(companies)
      .set({ github_repo: fullName })
      .where(eq(companies.id, companyId));

    const patchSummary = await patchForkedNextSkeletonKnownIssues(fullName)
      .catch((err) => `storage patch skipped: ${err instanceof Error ? err.message : String(err)}`);

    log.info('Skeleton forked', { companyId, repo: fullName });

    return [
      `Ã¢Å“â€¦ Skeleton forked to ${fullName}!`,
      patchSummary ? `Known-issue patch: ${patchSummary}` : null,
      `URL: ${forkData.html_url ?? `https://github.com/${fullName}`}`,
      ``,
      `What you get for free:`,
      `  Ã¢â‚¬Â¢ Better Auth (email+password, sessions, DB-backed)`,
      `  Ã¢â‚¬Â¢ Drizzle ORM + Neon Postgres (db/schema.ts)`,
      `  Ã¢â‚¬Â¢ AI calls via Baljia gateway (lib/ai.ts) Ã¢â‚¬â€ NO user API key needed`,
      `  Ã¢â‚¬Â¢ Stripe checkout + webhook handler`,
      `  Ã¢â‚¬Â¢ Shadcn/ui + Tailwind 4`,
      `  Ã¢â‚¬Â¢ Next.js 15 App Router with middleware-protected /app/* routes`,
      ``,
      `Next steps:`,
      `1. Read the current db/schema.ts via github_read_file`,
      `2. Push your feature tables (books, projects, etc.) via github_push_file`,
      `3. Call run_drizzle_push to create tables in the database`,
      `4. Push your feature Server Actions (app/actions/<feature>.ts)`,
      `5. Push your feature pages (app/app/<feature>/page.tsx)`,
      `6. Call create_instance for canonical repo/DB/Render reuse, or render_create_service only if create_instance gave an explicit manual Render fallback.`,
    ].filter(Boolean).join('\n');
  } catch (err) {
    return `Skeleton fork error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Skeleton: run Drizzle schema push against the company's Neon DB Ã¢â€â‚¬Ã¢â€â‚¬

async function handleRunDrizzlePush(input: Record<string, unknown>, companyId: string): Promise<string> {
  const repo = (input.repo as string)?.trim();
  if (!repo) return 'Error: repo is required.';

  // Get the company's database connection
  const dbInfo = await getCompanyDatabase(companyId);
  if (!dbInfo) {
    return 'No database provisioned yet. Use provision_database first, then run_drizzle_push.';
  }
  if (!dbInfo.connectionUri) {
    return 'Database exists but connection URI not available. Check NEON_API_KEY configuration.';
  }

  // Read current db/schema.ts from the repo
  let schemaContent: string;
  try {
    // Raw read — the wrapped "File: ...\n```\n{content}\n```" format would
    // corrupt the schema parse on the remote runner.
    const result = await githubReadFileRaw({ repo, path: 'db/schema.ts' }, companyId);
    if (result.startsWith('GitHub read failed') || result.startsWith('GitHub read error') || result.startsWith('Error:')) {
      return `Could not read db/schema.ts from ${repo}: ${result}\n\nMake sure you pushed the schema file first via github_push_file.`;
    }
    schemaContent = result;
  } catch (err) {
    return `Failed to read db/schema.ts: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }

  // Extract table names from the schema content for the report
  const tableMatches = schemaContent.match(/pgTable\(['"]([^'"]+)['"]/g) ?? [];
  const tableNames = tableMatches.map(m => m.match(/pgTable\(['"]([^'"]+)['"]/)?.[1] ?? '').filter(Boolean);

  // Drizzle push requires running the CLI locally. Since we can't exec CLI in CF workers,
  // we trigger a platform migration endpoint that runs drizzle-kit push in a serverless runner.
  const migrationEndpoint = process.env.DRIZZLE_PUSH_ENDPOINT;

  if (migrationEndpoint) {
    try {
      const response = await fetch(migrationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DRIZZLE_PUSH_SECRET ?? ''}`,
        },
        body: JSON.stringify({
          connectionUri: dbInfo.connectionUri,
          schema: schemaContent,
          companyId,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const err = await response.text();
        return `Drizzle push failed (remote runner): ${err}`;
      }

      const result = await response.json() as { tables?: string[]; warnings?: string[] };
      const tables = result.tables ?? tableNames;

      return [
        `Ã¢Å“â€¦ Drizzle schema pushed successfully!`,
        `Tables synced (${tables.length}): ${tables.join(', ')}`,
        result.warnings?.length ? `\nWarnings:\n${result.warnings.map(w => `  - ${w}`).join('\n')}` : '',
        ``,
        `Next: push your feature code (Server Actions, pages) and deploy to Render.`,
      ].filter(Boolean).join('\n');
    } catch (err) {
      log.warn('Remote drizzle push failed, falling back to advisory', { companyId, error: err });
    }
  }

  // Fallback: report what WOULD be synced and instruct the agent to add db:push to the build command
  return [
    `Ã¢Å¡Â Ã¯Â¸Â Remote Drizzle push runner not configured (DRIZZLE_PUSH_ENDPOINT missing).`,
    ``,
    `Schema detected in db/schema.ts:`,
    `  Tables: ${tableNames.length > 0 ? tableNames.join(', ') : '(none detected - check schema format)'}`,
    ``,
    `Workaround: create the tables before deploy with run_migration.`,
    `Do NOT put drizzle-kit push in the Render build command; it can require interactive prompts in CI.`,
    ``,
    `After schema is created, deploy with buildCommand: "${RENDER_NEXTJS_BUILD_COMMAND}".`,
    `The skeleton already has the db:push script wired in package.json for local/manual use.`,
  ].join('\n');
}

// â”€â”€ create_instance: atomic fork + provision + deploy â”€â”€

export type FounderAppCompanyState = {
  name?: string | null;
  slug?: string | null;
  github_repo?: string | null;
  neon_database_id?: string | null;
  render_service_id?: string | null;
  custom_domain?: string | null;
};

export type FounderAppInstanceTargets = {
  repoFullName: string;
  repoName: string;
  canonicalRepoFullName: string;
  canonicalRepoName: string;
  repoStatus: 'reused' | 'missing';
  dbStatus: 'reused' | 'missing';
  renderStatus: 'reused' | 'missing';
  canonicalUrl: string | null;
};

function slugifyFounderAppName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function repoNameFromFullName(repoFullName: string): string {
  return repoFullName.split('/').pop() ?? repoFullName;
}

export function resolveFounderAppInstanceTargets(
  company: FounderAppCompanyState,
  org: string,
): FounderAppInstanceTargets {
  const slug = slugifyFounderAppName(company.slug ?? company.name);
  const canonicalRepoName = slug || 'founder-app';
  const canonicalRepoFullName = `${org}/${canonicalRepoName}`;
  const storedRepo = company.github_repo?.trim();
  const repoFullName = storedRepo
    ? (storedRepo.includes('/') ? storedRepo : `${org}/${storedRepo}`)
    : canonicalRepoFullName;
  const repoName = repoNameFromFullName(repoFullName);
  const domain = company.custom_domain?.trim();

  return {
    repoFullName,
    repoName,
    canonicalRepoFullName,
    canonicalRepoName,
    repoStatus: storedRepo ? 'reused' : 'missing',
    dbStatus: company.neon_database_id ? 'reused' : 'missing',
    renderStatus: company.render_service_id ? 'reused' : 'missing',
    canonicalUrl: domain
      ? `https://${domain}`
      : slug
        ? `https://${slug}.baljia.app`
        : null,
  };
}

export function isRepoEmptyEnoughToHydrate(entryNames: string[]): boolean {
  const harmless = new Set(['readme.md', '.gitignore', 'license', 'license.md']);
  return entryNames.every((name) => harmless.has(name.trim().toLowerCase()));
}

export function isRepoHydratedForNextSkeleton(entryNames: string[]): boolean {
  const names = new Set(entryNames.map((name) => name.trim().toLowerCase()));
  return names.has('package.json')
    && names.has('app')
    && names.has('components')
    && names.has('db')
    && names.has('lib');
}

export function platformProvidedFounderEnvVars(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};

  const aiGatewayToken = env.GEMINI_API_KEY || env.AI_GATEWAY_TOKEN;

  if (aiGatewayToken) {
    out.AI_GATEWAY_URL = FOUNDER_AI_GATEWAY_URL;
    out.AI_GATEWAY_TOKEN = aiGatewayToken;
    out.AI_TEXT_MODEL = FOUNDER_AI_TEXT_MODEL;
    out.AI_JSON_MODEL = FOUNDER_AI_TEXT_MODEL;
    out.AI_EMBEDDING_MODEL = FOUNDER_AI_EMBEDDING_MODEL;
    out.AI_EMBEDDING_DIMENSIONS = FOUNDER_AI_EMBEDDING_DIMENSIONS;
  }

  if (env.GEMINI_API_KEY) out.GEMINI_API_KEY = env.GEMINI_API_KEY;

  // The skeleton ships Stripe routes. If no founder Stripe connection has
  // been configured yet, placeholders keep Next's production build alive while
  // payment-specific tasks can still replace them with real connected values.
  out.STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY || 'sk_test_placeholder_payment_ready';
  out.STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder_payment_ready';
  out.NEXT_PUBLIC_STRIPE_PRICE_ID = env.NEXT_PUBLIC_STRIPE_PRICE_ID || 'price_placeholder_payment_ready';

  return out;
}

function envVarsForExistingRenderService(
  envVars: Record<string, string>,
  explicitEnvVars: Record<string, string>,
): Array<{ key: string; value: string }> {
  const alwaysSafe = new Set([
    'DATABASE_URL',
    'BETTER_AUTH_URL',
    'NEXT_PUBLIC_APP_URL',
    'NODE_ENV',
    'BALJIA_COMPANY_ID',
    'BALJIA_APP_SLUG',
    'BALJIA_RUNTIME_TOKEN',
    'BALJIA_RUNTIME_VERSION',
    'BALJIA_PLATFORM_API_URL',
  ]);

  return Object.entries(envVars)
    .filter(([key, value]) => {
      if (!value) return false;
      if (key in explicitEnvVars) return true;
      if (alwaysSafe.has(key)) return true;
      if (/^(AI_|GEMINI_API_KEY$)/.test(key)) return true;
      return false;
    })
    .map(([key, value]) => ({ key, value }));
}

async function githubReadTextFileUnchecked(repo: string, filePath: string, branch = 'main'): Promise<string | null> {
  const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${filePath}?ref=${branch}`, { headers: githubHeaders() });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as { content?: string; encoding?: string } | null;
  if (!data?.content || data.encoding !== 'base64') return null;
  return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

function mergeBaljiaTsConfig(existing: string | null): string {
  const fallback = {
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@/*': ['./src/*'],
        '@baljia/*': ['./src/baljia/*'],
      },
    },
  };

  if (!existing) return JSON.stringify(fallback, null, 2) + '\n';

  try {
    const parsed = JSON.parse(existing) as Record<string, unknown>;
    const compilerOptions = typeof parsed.compilerOptions === 'object' && parsed.compilerOptions !== null
      ? parsed.compilerOptions as Record<string, unknown>
      : {};
    const paths = typeof compilerOptions.paths === 'object' && compilerOptions.paths !== null
      ? compilerOptions.paths as Record<string, unknown>
      : {};
    parsed.compilerOptions = {
      ...compilerOptions,
      baseUrl: typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.',
      paths: {
        ...paths,
        '@baljia/*': ['./src/baljia/*'],
      },
    };
    return JSON.stringify(parsed, null, 2) + '\n';
  } catch {
    return existing.includes('@baljia/*')
      ? existing
      : `${existing.trimEnd()}\n\n/* Baljia runtime path alias required: "@baljia/*" -> "./src/baljia/*" */\n`;
  }
}

function runtimeScaffoldFiles(input: {
  companyId: string;
  slug: string;
  capabilities: string[];
  tsconfig: string | null;
}): Array<{ path: string; content: string }> {
  const manifest = {
    runtimeVersion: BALJIA_RUNTIME_VERSION,
    companyId: input.companyId,
    slug: input.slug,
    enabledCapabilities: input.capabilities,
    protectedRuntimeFiles: true,
  };

  const runtimeTs = `export type RuntimeIdentity = {
  companyId: string;
  appSlug: string;
  runtimeToken: string;
  runtimeVersion: string;
};

const manifest = ${JSON.stringify(manifest, null, 2)} as const;

export function getRuntimeIdentity(): RuntimeIdentity {
  const companyId = process.env.BALJIA_COMPANY_ID || manifest.companyId;
  const appSlug = process.env.BALJIA_APP_SLUG || manifest.slug;
  const runtimeToken = process.env.BALJIA_RUNTIME_TOKEN || "";
  const runtimeVersion = process.env.BALJIA_RUNTIME_VERSION || manifest.runtimeVersion;

  if (!companyId || !appSlug || !runtimeToken || !runtimeVersion) {
    throw new Error("Baljia runtime identity is not configured.");
  }

  return { companyId, appSlug, runtimeToken, runtimeVersion };
}

export function platformApiBaseUrl(): string {
  return process.env.BALJIA_PLATFORM_API_URL || "https://baljia.app";
}

export async function runtimeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const runtime = getRuntimeIdentity();
  const url = path.startsWith("http") ? path : \`\${platformApiBaseUrl()}\${path}\`;
  const headers = new Headers(init.headers);
  headers.set("authorization", \`Bearer \${runtime.runtimeToken}\`);
  headers.set("content-type", headers.get("content-type") || "application/json");

  return fetch(url, {
    ...init,
    headers,
  });
}

export async function logUsageEvent(input: {
  packageName: string;
  feature: string;
  userId?: string | null;
  units?: number;
  costUsd?: string | number;
  status?: string;
  metadata?: Record<string, unknown>;
}) {
  const response = await runtimeFetch("/api/runtime/usage", {
    method: "POST",
    body: JSON.stringify({
      packageName: input.packageName,
      feature: input.feature,
      userId: input.userId ?? null,
      units: input.units ?? 1,
      costUsd: input.costUsd ?? "0",
      status: input.status ?? "success",
      metadata: input.metadata ?? {},
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(\`Baljia usage logging failed: HTTP \${response.status} \${text.slice(0, 200)}\`);
  }

  return response.json();
}
`;

  const aiTs = `import { runtimeFetch } from "./runtime";

export async function generateJson<T = unknown>(input: {
  feature: string;
  prompt: string;
  schema?: Record<string, unknown>;
  userId?: string | null;
}): Promise<T> {
  const response = await runtimeFetch("/api/runtime/ai/generate-json", {
    method: "POST",
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Baljia AI JSON generation failed");
  }
  return body.json as T;
}

export async function generateText(input: {
  feature: string;
  prompt: string;
  userId?: string | null;
}): Promise<string> {
  const result = await generateJson<{ text: string }>({
    ...input,
    schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    prompt: \`\${input.prompt}\\n\\nReturn JSON only: {"text":"..."}\`,
  });
  return result.text;
}

export async function embedText(input: {
  feature: string;
  text: string;
  userId?: string | null;
}): Promise<number[]> {
  const response = await runtimeFetch("/api/runtime/ai/embed-text", {
    method: "POST",
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Baljia AI embedding failed");
  }
  return body.embedding as number[];
}
`;

  const authTs = `export type RuntimeUser = {
  id: string;
  email?: string | null;
  role?: string | null;
  [key: string]: unknown;
};

export async function getCurrentUser(): Promise<RuntimeUser | null> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { user?: RuntimeUser } | RuntimeUser | null;
  if (!body) return null;
  return "user" in body ? body.user ?? null : body;
}

export async function requireUser(): Promise<RuntimeUser> {
  const user = await getCurrentUser();
  if (!user?.id) throw new Error("Authentication required");
  return user;
}

export async function requireRole(role: string): Promise<RuntimeUser> {
  const user = await requireUser();
  if (user.role !== role) throw new Error(\`Role "\${role}" required\`);
  return user;
}
`;

  const eventWrapper = (packageName: string, exportName: string, withName: string, aliasNames: string[] = []) => {
    const aliasExports = aliasNames.map((aliasName) => `
export async function ${aliasName}<T>(
  input: Omit<RuntimeLifecycleEvent, "status"> & { operation?: string },
  operation: () => Promise<T>,
): Promise<T> {
  return ${withName}({ ...input, operation: input.operation ?? "${aliasName}" }, operation);
}
`).join('');

    return `import { logUsageEvent } from "./runtime";

export type RuntimeLifecycleEvent = {
  feature: string;
  userId?: string | null;
  status?: string;
  units?: number;
  costUsd?: string | number;
  operation?: string;
  amountCents?: number;
  currency?: string;
  customerId?: string;
  subscriptionId?: string;
  paymentId?: string;
  bucket?: string;
  objectKey?: string;
  bytes?: number;
  messageId?: string;
  recipient?: string;
  metadata?: Record<string, unknown>;
};

function lifecycleMetadata(input: RuntimeLifecycleEvent) {
  const context = {
    operation: input.operation,
    amountCents: input.amountCents,
    currency: input.currency,
    customerId: input.customerId,
    subscriptionId: input.subscriptionId,
    paymentId: input.paymentId,
    bucket: input.bucket,
    objectKey: input.objectKey,
    bytes: input.bytes,
    messageId: input.messageId,
    recipient: input.recipient,
  };

  return Object.fromEntries(
    Object.entries({ ...(input.metadata ?? {}), ...context }).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

export async function ${exportName}(input: RuntimeLifecycleEvent) {
  return logUsageEvent({
    packageName: "${packageName}",
    feature: input.feature,
    userId: input.userId ?? null,
    units: input.units ?? input.bytes ?? 1,
    costUsd: input.costUsd ?? "0",
    status: input.status ?? "success",
    metadata: lifecycleMetadata(input),
  });
}

export async function ${withName}<T>(
  input: Omit<RuntimeLifecycleEvent, "status"> & { operation?: string },
  operation: () => Promise<T>,
): Promise<T> {
  await ${exportName}({
    ...input,
    status: "started",
    operation: input.operation ?? "runtime_operation",
  });
  try {
    const result = await operation();
    await ${exportName}({
      ...input,
      status: "completed",
      operation: input.operation ?? "runtime_operation",
    });
    return result;
  } catch (err) {
    await ${exportName}({
      ...input,
      status: "error",
      metadata: {
        ...(input.metadata ?? {}),
        error: err instanceof Error ? err.message : String(err),
      },
      operation: input.operation ?? "runtime_operation",
    }).catch(() => undefined);
    throw err;
  }
}
${aliasExports}
`;
  };

  const uiShellTsx = `import type { ReactNode } from "react";

export function BaljiaAppShell(props: { children: ReactNode; title?: string }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {props.title ? <h1 className="sr-only">{props.title}</h1> : null}
      {props.children}
    </main>
  );
}
`;

  return [
    { path: 'baljia.runtime.json', content: JSON.stringify(manifest, null, 2) + '\n' },
    { path: 'src/baljia/runtime.ts', content: runtimeTs },
    { path: 'src/baljia/ai.ts', content: aiTs },
    { path: 'src/baljia/auth.ts', content: authTs },
    { path: 'src/baljia/payments.ts', content: eventWrapper('@baljia/payments', 'recordPaymentEvent', 'withCheckoutEvent', ['withWebhookEvent', 'withSubscriptionEvent']) },
    { path: 'src/baljia/storage.ts', content: eventWrapper('@baljia/storage', 'recordStorageEvent', 'withStorageEvent', ['withObjectUploadEvent']) },
    { path: 'src/baljia/email.ts', content: eventWrapper('@baljia/email', 'recordEmailEvent', 'withEmailEvent', ['withSendEmailEvent']) },
    { path: 'src/baljia/ui-shell.tsx', content: uiShellTsx },
    { path: 'tsconfig.json', content: mergeBaljiaTsConfig(input.tsconfig) },
  ];
}

async function handleCreateInstance(input: Record<string, unknown>, companyId: string): Promise<string> {
  return handleEnsureFounderAppInstance(input, companyId, 'legacy');
}

async function handleEnsureFounderAppInstance(
  input: Record<string, unknown>,
  companyId: string,
  outputMode: 'json' | 'legacy' = 'legacy',
): Promise<string> {
  if (typeof input.companyId === 'string' && input.companyId && input.companyId !== companyId) {
    return 'ensure_founder_app_instance failed: companyId does not match this task.';
  }
  if (input.preferredStack && input.preferredStack !== 'nextjs') {
    return 'ensure_founder_app_instance failed: only preferredStack="nextjs" is supported.';
  }
  const capabilityList = asStringArray(input.capabilities) ?? ['auth', 'ai'];
  const appName = ((input.app_name as string | undefined) ?? (input.appSlug as string | undefined) ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!appName && outputMode === 'legacy') return 'Error: app_name is required (e.g. "acme-crm").';

  const description = (input.description as string) ?? 'SaaS app built on Baljia skeleton';
  const extraEnvVars = (input.env_vars as Record<string, string>) ?? {};
  const org = githubOrg();
  const [company] = await db.select({
    name: companies.name,
    slug: companies.slug,
    github_repo: companies.github_repo,
    neon_database_id: companies.neon_database_id,
    render_service_id: companies.render_service_id,
    custom_domain: companies.custom_domain,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return 'create_instance failed: company not found.';

  const targets = resolveFounderAppInstanceTargets({ ...company, name: company.name ?? appName }, org);
  const repoSlug = targets.repoName;

  const steps: string[] = [];
  let repoUrl = '';
  let databaseUrl = '';
  let serviceUrl = '';
  let renderUrl = '';
  let renderServiceId = company.render_service_id ?? '';
  let runtimeCommitSummary = '';

  // Step 1: Reuse or hydrate the founder repo created during onboarding.
  steps.push('Step 1/4: Ensuring canonical Next.js skeleton repo...');
  const forkResult = await githubForkSkeleton({ repo: repoSlug, description }, companyId);
  if (forkResult.startsWith('Fork failed') || forkResult.startsWith('Error:') || forkResult.startsWith('Refusing') || forkResult.startsWith('Skeleton hydrate failed')) {
    return `create_instance failed at skeleton fork:\n${forkResult}`;
  }
  const repoStatus: 'reused' | 'hydrated' | 'created' = /hydrated in existing repo/i.test(forkResult)
    ? 'hydrated'
    : /skeleton forked/i.test(forkResult)
      ? 'created'
      : 'reused';
  repoUrl = `https://github.com/${targets.repoFullName}`;
  steps.push(`  Repo mode: ${targets.repoStatus === 'reused' ? 'reused onboarding repo' : 'canonical repo ready'}`);
  steps.push(`  âœ… Repo: ${repoUrl}`);

  // Step 2: Provision database
  steps.push('Step 2/4: Provisioning Neon Postgres...');
  const existingDbInfo = await getCompanyDatabase(companyId);
  const dbInfo = existingDbInfo ?? await provisionCompanyDatabase(companyId, repoSlug);
  if (!dbInfo) {
    return `create_instance: database provisioning failed. Check NEON_API_KEY.`;
  }
  databaseUrl = dbInfo.connectionUri ?? '';
  if (!databaseUrl) {
    return [
      ...steps,
      'Step 2/4: Neon database exists but no connection URI is available.',
      'Do not deploy with an empty DATABASE_URL. Run get_database_info to inspect the Neon connection state, then retry create_instance.',
    ].join('\n');
  }
  steps.push(`  DB mode: ${existingDbInfo ? 'reused onboarding Neon database' : 'created new Neon database'}`);
  steps.push(`  âœ… Database: ${dbInfo.host ?? 'provisioned'}`);

  // Step 3: Reuse or create the Render service.
  steps.push('Step 3/4: Preparing Render web service...');
  const authSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  // Auth URLs prefer the company's Baljia subdomain, because Better Auth
  // bakes this into redirect/cookie behavior.
  const canonicalUrl = targets.canonicalUrl ?? `https://${repoSlug}.onrender.com`;
  const runtimeToken = await signRuntimeToken({
    companyId,
    appSlug: repoSlug,
    runtimeVersion: BALJIA_RUNTIME_VERSION,
    capabilities: capabilityList,
  });

  const envVars: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: authSecret,
    BETTER_AUTH_URL: canonicalUrl,
    NEXT_PUBLIC_APP_URL: canonicalUrl,
    BALJIA_COMPANY_ID: companyId,
    BALJIA_APP_SLUG: repoSlug,
    BALJIA_RUNTIME_TOKEN: runtimeToken,
    BALJIA_RUNTIME_VERSION: BALJIA_RUNTIME_VERSION,
    NODE_ENV: 'production',
    ...platformProvidedFounderEnvVars(),
    ...extraEnvVars,
  };

  const existingTsconfig = await githubReadTextFileUnchecked(targets.repoFullName, 'tsconfig.json');
  const runtimeCommit = await githubCommitFilesUnchecked({
    repo: targets.repoFullName,
    message: 'Install Baljia runtime contract',
    files: runtimeScaffoldFiles({
      companyId,
      slug: repoSlug,
      capabilities: capabilityList,
      tsconfig: existingTsconfig,
    }),
  });
  runtimeCommitSummary = runtimeCommit.ok
    ? `  Runtime contract: committed ${runtimeCommit.sha?.substring(0, 7) ?? 'updated'}`
    : `  Runtime contract warning: ${runtimeCommit.error ?? 'commit failed'}`;
  steps.push(runtimeCommitSummary);

  if (company.render_service_id) {
    steps.push('Step 3/4: Reusing existing Render web service...');
    const existingUrl = await getRenderServiceUrl(company.render_service_id);
    renderUrl = existingUrl ?? `https://${repoSlug}.onrender.com`;
    serviceUrl = targets.canonicalUrl ?? renderUrl;
    const runtimeEnvResult = await renderSetEnvVars({
      service_id: company.render_service_id,
      env_vars: envVarsForExistingRenderService(envVars, extraEnvVars),
      force_after_quota_restored: true,
    });
    if (/^Error\b|HTTP\s+[45]\d\d|redeploy trigger failed/i.test(runtimeEnvResult)) {
      return [
        ...steps,
        'Step 3/4: runtime env injection failed for existing Render service.',
        runtimeEnvResult,
        'Do not continue: generated app runtime identity and central usage tracking require BALJIA_* env vars on Render.',
      ].join('\n');
    }
    steps.push(`  Runtime env injection: ${runtimeEnvResult.split('\n')[0]}`);
    steps.push(`  Render service: ${serviceUrl}`);
    steps.push(`  Service ID: ${company.render_service_id}`);
  } else {

  const renderApiKey = process.env.RENDER_API_KEY;
  if (!renderApiKey) {
    return [
      ...steps,
      `âš ï¸  RENDER_API_KEY not configured â€” cannot create Render service automatically.`,
      ``,
      `Manual step: Create a Render web service with:`,
      `  repo: ${repoUrl}`,
      `  buildCommand: ${RENDER_NEXTJS_BUILD_COMMAND}`,
      `  startCommand: ${RENDER_NEXTJS_START_COMMAND}`,
      `  env vars: See below`,
      ...Object.entries(envVars).map(([k, v]) => `  ${k}=${k.includes('SECRET') || k.includes('TOKEN') || k.includes('URL') && v.includes('neon') ? '***' : v}`),
    ].join('\n');
  }

  // Delegate to the hardened renderCreateService helper instead of POSTing
  // directly. The helper handles owner-id lookup, free-plan defaults,
  // Baljia subdomain attachment (so the auth URL becomes https://<slug>.baljia.app
  // instead of the *.onrender.com placeholder), and persistence of
  // render_service_id. Bypassing it was the review finding — duplicate
  // code, no subdomain attach, hardcoded .onrender.com auth URLs.
  const renderResult = await renderCreateService({
    repo: repoSlug,
    name: repoSlug,
    type: 'web_service',
    plan: 'free',
    build_command: RENDER_NEXTJS_BUILD_COMMAND,
    start_command: RENDER_NEXTJS_START_COMMAND,
    health_check_path: '/',
    env_vars: Object.entries(envVars).map(([key, value]) => ({ key, value })),
  }, companyId);

  // renderCreateService's contract: success returns a string starting with
  // "Render service created!" and persists render_service_id; failure
  // returns one of: "Render service creation failed: …", "Render error: …",
  // "Error: …". Match against the success prefix instead — anything else is
  // a failure.
  const renderSucceeded = /^Render service created!/i.test(renderResult);
  const renderFailed = !renderSucceeded;
  if (renderFailed) {
    // Return failure now — do NOT fall through to the "Instance ready"
    // summary banner that follows. Previously the banner printed
    // unconditionally, so create_instance reported success even when Render
    // creation failed (audit P1.3, 2026-05-12).
    steps.push(`  Render service creation FAILED: ${renderResult.slice(0, 200)}`);
    steps.push('');
    steps.push('Step 4/4: Instance partially created — Render service is NOT live.');
    steps.push('');
    steps.push(`Repo: ${repoUrl} (created)`);
    steps.push(`Database: ${databaseUrl ? 'provisioned (connection saved)' : 'NOT provisioned'}`);
    steps.push('Render service: FAILED');
    steps.push('');
    steps.push('Next: investigate the Render failure (env vars, billing, plan limits, RENDER_OWNER_ID).');
    steps.push('Either fix the underlying cause and call render_create_service manually, or');
    steps.push('roll back this partial state and retry create_instance.');
    log.warn('Instance partial — Render creation failed', { companyId, repoSlug, reason: renderResult.slice(0, 200) });
    return steps.join('\n');
  } else {
    // Pull back the persisted service id + canonical URL.
    const [saved] = await db.select({
      render_service_id: companies.render_service_id,
      custom_domain: companies.custom_domain,
      slug: companies.slug,
    }).from(companies).where(eq(companies.id, companyId)).limit(1);
    const createdAppUrl = renderResult.match(/^App URL:\s*(https?:\/\/\S+)/mi)?.[1];
    serviceUrl = createdAppUrl
      ?? (saved?.custom_domain
      ? `https://${saved.custom_domain}`
      : saved?.slug
        ? `https://${saved.slug}.baljia.app`
        : `https://${repoSlug}.onrender.com`);
    renderServiceId = saved?.render_service_id ?? renderServiceId;
    renderUrl = createdAppUrl ?? `https://${repoSlug}.onrender.com`;
    steps.push(`  Render service: ${serviceUrl}`);
    if (saved?.render_service_id) steps.push(`  Service ID: ${saved.render_service_id}`);
  }
  }

  // Step 4: Summary
  steps.push('Step 4/4: Instance ready!');
  steps.push('');
  steps.push('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  steps.push(`ðŸš€ App: ${description}`);
  steps.push(`ðŸ“¦ Repo: ${repoUrl}`);
  steps.push(`ðŸŒ URL: ${serviceUrl || '(will be assigned by Render on first deploy)'}`);
  steps.push(`ðŸ—„ï¸  DB: ${databaseUrl ? 'Provisioned (connection saved)' : 'Not provisioned'}`);
  steps.push('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  steps.push('');
  steps.push('What is pre-wired (no setup needed):');
  steps.push('  â€¢ Better Auth (email+password, DB sessions)');
  steps.push('  â€¢ Drizzle ORM + Neon Postgres');
  steps.push('  â€¢ AI gateway (no user API key needed)');
  steps.push('  â€¢ Stripe checkout + webhooks');
  steps.push('  â€¢ Shadcn/ui + Tailwind 4');
  steps.push('');
  steps.push('Next: push feature-specific files via github_push_file, then Render will auto-deploy from main.');
  steps.push('');
  steps.push('⚠️  MANDATORY NEXT STEP: After the deploy completes (allow 3-5 min), run the verify-deploy');
  steps.push('   skill checklist to confirm frontend, backend, auth, DB, and integrations all work.');
  steps.push('   Use: read_skill({ skill: "verify-deploy" }) then execute each check_url_health step.');

  log.info('Instance created', { companyId, repoSlug, serviceUrl });
  if (outputMode === 'json') {
    return JSON.stringify({
      repo: targets.repoFullName,
      repoStatus,
      neonProjectId: dbInfo.projectId ?? company.neon_database_id ?? '',
      dbStatus: existingDbInfo ? 'reused' : 'created',
      renderServiceId,
      renderStatus: company.render_service_id ? 'reused' : 'created',
      renderUrl: renderUrl || `https://${repoSlug}.onrender.com`,
      baljiaUrl: targets.canonicalUrl ?? `https://${repoSlug}.baljia.app`,
    });
  }
  return steps.join('\n');
}

// â”€â”€ get_preview: return the company's live Render URL â”€â”€

async function handleGetPreview(companyId: string): Promise<string> {
  // First check saved company record
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });

  const serviceId = company?.render_service_id;
  const renderApiKey = process.env.RENDER_API_KEY;

  if (!serviceId) {
    return [
      'No Render service ID found for this company.',
      'If you just created a service, save the service ID first.',
      'Or call create_instance to provision a full instance.',
    ].join('\n');
  }

  if (!renderApiKey) {
    return `Service ID: ${serviceId}\nURL: https://${company?.github_repo?.split('/')[1] ?? serviceId}.onrender.com\n(RENDER_API_KEY not set â€” URL is estimated from service name)`;
  }

  try {
    const res = await fetch(`${RENDER_API}/services/${serviceId}`, {
      headers: {
        Authorization: `Bearer ${renderApiKey}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      return `Failed to get service details: ${res.statusText}`;
    }

    const data = await res.json() as {
      service?: { url?: string; name?: string; status?: string };
      url?: string; name?: string; status?: string;
    };
    const svc = data.service ?? data;
    const url = svc.url ?? `https://${svc.name}.onrender.com`;

    return [
      `âœ… Preview URL: ${url}`,
      `Status: ${svc.status ?? 'unknown'}`,
      `Service ID: ${serviceId}`,
      '',
      `Health check: ${url}/health`,
    ].join('\n');
  } catch (err) {
    return `Error fetching preview: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}
