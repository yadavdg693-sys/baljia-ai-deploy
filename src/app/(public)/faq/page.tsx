'use client';

// FAQ Page — Categorized accordion
// Replaces the "coming soon" stub in DashboardHeader

import { useState } from 'react';

interface FaqItem {
  q: string;
  a: string;
}

interface FaqCategory {
  title: string;
  icon: string;
  items: FaqItem[];
}

const FAQ_CATEGORIES: FaqCategory[] = [
  {
    title: 'Getting Started',
    icon: '🚀',
    items: [
      { q: 'What is Baljia?', a: 'Baljia is an AI platform that autonomously runs your company. You get a full AI team — CEO + 8 specialist agents — that handle engineering, research, growth, ads, outreach, support, and more, all while you stay in control.' },
      { q: 'What happens after I sign up?', a: "Our onboarding pipeline runs in the background — it researches your market, names your company, provisions infrastructure (subdomain, email, database, repo), generates a roadmap, and creates your first set of tasks. Typically takes 5–10 minutes." },
      { q: 'What are the 3 onboarding paths?', a: '**Surprise Me** — You have a rough idea and let the AI shape the company. **Build My Idea** — You have a specific product in mind and give us the URL or description. **Grow My Company** — You already have an existing company and want the agents to accelerate growth.' },
      { q: 'Can I use Baljia during the trial?', a: 'Yes. Trial includes 10 task credits and 3 night shifts. You can run tasks, review proposals, interact with the CEO, and see the platform in action before committing.' },
    ],
  },
  {
    title: 'Tasks & Credits',
    icon: '⚡',
    items: [
      { q: 'How does the credit system work?', a: '1 task = 1 credit. Credits are only charged when a task starts execution — planning is always free. Credits never roll over between billing periods.' },
      { q: 'What types of tasks can agents run?', a: 'Engineering (build features, fix bugs, deploy), Research (web analysis, market reports), Browser (fill forms, scrape data), Data (SQL queries, analytics), Support (reply to emails, escalate), Twitter (compose and post), Meta Ads (create and optimize campaigns), Cold Outreach (email leads).' },
      { q: 'What happens if a task fails?', a: 'Failed tasks are fingerprinted and categorized. The credit is consumed. Whether you get a refund depends on the failure class — platform errors are auto-refunded; ambiguous requests are reviewed manually.' },
      { q: 'What is a night shift?', a: 'Night shifts are scheduled autonomous runs that happen while you sleep. The platform reviews failed tasks, creates retries, executes queued work, and advances your roadmap — without consuming your manual credits.' },
    ],
  },
  {
    title: 'Agents & Capabilities',
    icon: '🤖',
    items: [
      { q: 'Who is the CEO agent?', a: 'The CEO is your primary interface. You chat with the CEO to propose tasks, ask for strategy, get updates, and manage your company direction. The CEO routes work to the right specialist agents.' },
      { q: 'Can agents access my accounts?', a: 'Yes — with your permission. OAuth connections (Twitter, Meta Ads, GitHub, Gmail) unlock when you activate execution. The Browser agent can also use stored credentials for site interactions.' },
      { q: 'How does the Engineering agent work?', a: 'It operates in 3 modes: Deterministic (CRUD, simple admin tasks — no model needed), Template + Params (familiar patterns with custom variations), and Full Agent (novel or ambiguous work requiring reasoning).' },
      { q: 'What is verification?', a: "After a task completes, the platform independently verifies the work. There are 5 levels: None, Deterministic (API/DB assertions), Browser Flow (UI testing), Quality Review (LLM rubric), Hybrid. The verifier — not the agent — sets the final task status." },
    ],
  },
  {
    title: 'Billing & Plans',
    icon: '💳',
    items: [
      { q: 'What plans are available?', a: '**Trial** — Free, 10 credits, 3 night shifts. **Full** — Monthly subscription, 30 night shifts, credit top-ups available. **Keep Live** — Maintenance mode for companies between active growth phases.' },
      { q: 'Can I buy more credits?', a: 'Yes. Credit add-ons are available from the billing section. They are charged as one-time payments via Stripe.' },
      { q: 'How do ad spend charges work?', a: 'Ad spend (Meta Ads) is billed daily based on actual campaign spend + a 20% platform fee. These are separate from task credits.' },
      { q: 'Does Baljia take a cut of my revenue?', a: 'Yes — a 20% platform fee applies to revenue processed through Baljia (e.g. Stripe payments handled on your behalf). This is separate from subscription and credit costs.' },
    ],
  },
  {
    title: 'Privacy & Security',
    icon: '🔒',
    items: [
      { q: 'Is my data safe?', a: 'Each company gets an isolated Neon database. Your data is never mixed with other companies. Credentials are encrypted at rest (AES-256-GCM). We do not train on your data.' },
      { q: 'Can I pause my agents?', a: 'Yes. Company Settings → Agent Execution → Paused. Agents stop running tasks immediately. You can resume at any time.' },
      { q: 'What happens if my account is suspended?', a: 'Suspension is triggered by billing failures or policy violations. Agent execution is locked by the platform, not just paused. Contact support to restore access.' },
      { q: 'How do I delete my account?', a: 'Contact support. Company data is soft-deleted and retained for 30 days before permanent deletion. This period allows you to recover data if needed.' },
    ],
  },
];

function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const isOpen = openIdx === i;
        return (
          <div
            key={i}
            className={`rounded-xl border transition-colors ${isOpen ? 'border-baljia-gold/40 bg-baljia-gold/5' : 'border-border-default bg-surface-card hover:border-border-subtle'}`}
          >
            <button
              onClick={() => setOpenIdx(isOpen ? null : i)}
              className="w-full text-left px-4 py-3.5 flex items-center justify-between gap-3"
            >
              <span className="text-sm font-medium text-text-primary">{item.q}</span>
              <span className={`text-text-muted transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-45' : ''}`}>+</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 text-sm text-text-secondary leading-relaxed border-t border-border-subtle pt-3">
                {item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function FaqPage() {
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState('');

  const searchLower = search.toLowerCase().trim();
  const filteredCategories = FAQ_CATEGORIES.map((cat) => ({
    ...cat,
    items: searchLower
      ? cat.items.filter((item) =>
          item.q.toLowerCase().includes(searchLower) ||
          item.a.toLowerCase().includes(searchLower)
        )
      : cat.items,
  })).filter((cat) => cat.items.length > 0);

  const displayCategories = searchLower ? filteredCategories : [FAQ_CATEGORIES[activeCategory]].filter(Boolean);

  return (
    <div className="min-h-screen bg-surface-primary">
      {/* Hero */}
      <div className="border-b border-border-default px-6 py-10 text-center">
        <h1 className="text-3xl font-bold text-text-primary font-display">Frequently Asked Questions</h1>
        <p className="text-text-muted mt-2 text-base">Everything you need to know about Baljia.</p>
        {/* Search */}
        <div className="relative mt-6 max-w-md mx-auto">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface-card border border-border-default text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-baljia-gold transition-colors"
          />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 flex gap-8">
        {/* Category nav (hidden when searching) */}
        {!searchLower && (
          <nav className="hidden md:flex flex-col gap-1 w-44 shrink-0 pt-0.5">
            {FAQ_CATEGORIES.map((cat, i) => (
              <button
                key={cat.title}
                onClick={() => setActiveCategory(i)}
                className={`text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${activeCategory === i ? 'bg-baljia-gold/10 text-baljia-gold font-semibold' : 'text-text-secondary hover:text-text-primary hover:bg-surface-card'}`}
              >
                <span>{cat.icon}</span>
                <span>{cat.title}</span>
              </button>
            ))}
          </nav>
        )}

        {/* Accordion */}
        <div className="flex-1 space-y-6">
          {(searchLower ? filteredCategories : displayCategories).map((cat) => (
            <div key={cat.title}>
              {searchLower && (
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                  {cat.icon} {cat.title}
                </p>
              )}
              <FaqAccordion items={cat.items} />
            </div>
          ))}
          {searchLower && filteredCategories.length === 0 && (
            <p className="text-sm text-text-muted text-center py-10">
              No results for "{search}". Try a different search term.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
