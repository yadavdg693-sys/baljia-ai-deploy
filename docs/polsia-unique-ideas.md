# Unique Ideas From Polsia Landing-Page Study

14 specific patterns extracted from 32 live Polsia-generated sites (April 2026), ranked by leverage for Baljia's Day-0 landing-page format. Each includes:

- **Source** — the specific Polsia page where the pattern appears.
- **What it does** — the mechanic in one sentence.
- **Why it works** — the underlying persuasion or UX reason.
- **Baljia port** — how to adapt it for Baljia's generator (journey / category / slot).

See [polsia-landing-studies.md](polsia-landing-studies.md) for the structural analysis that surfaced these.

---

## Tier 1 — Highest leverage (port now)

### 1. Embedded instant-quote / scope generator
**Source:** forgeworkgroup.com (dev-agency scope builder), echoed by churnova live dashboard mockup.
**What it does:** 2-field form inline on the hero generates a full project breakdown (scope, cost, timeline) *before* requesting contact.
**Why it works:** Creates perceived value pre-transaction. Converts "info-seeker" into "invested lead" via sunk-cost of form completion.
**Baljia port:** For Build / Grow journeys, if the business has a quantifiable scoping surface (dev agency, bookkeeping tiers, roofing sq-footage, coaching package), render an inline calculator in the hero that uses the founder's pricing logic. Ship this as a first-class template block `<QuoteWidget/>`, not an optional extra. *Applies to: SaaS, Local Services.*

### 2. Named founder + credential stack + transparent pricing
**Source:** phinished-doc.polsia.app (Dr. Adriann Wolfe, DBA/MBA/M.Ed, $299/mo, 97% completion).
**What it does:** Named human + 3+ credentials + specific metric + transparent price = immediate credibility without logos or reviews.
**Why it works:** For solo / niche experts, quantified specifics outperform borrowed authority. "As featured in TechCrunch" is substitutable; "Dr. Wolfe, DBA, 100+ students, 97% completion" is not.
**Baljia port:** Content/Coaching template must REQUIRE a named-founder slot with photo placeholder + credential stack + at least one specific metric + transparent pricing. Generation fails if any of these four are empty. *Applies to: Content/Coaching, Local Services.*

### 3. "Why existing solutions fail" pre-pitch section
**Source:** nightbloom.polsia.app (dismantles melatonin, chamomile, prescriptions, sleep apps before naming the product).
**What it works:** Converts skepticism into curiosity. Readers finish the section asking "so what DOES work?" in their own head — primed to hear the product pitch.
**Why it works:** Audience has already tried the obvious options. Specificity about why those failed signals the seller understands the problem at expert level.
**Baljia port:** For any "niche solution" positioning (Build or Surprise journeys where market research found named competitors), add a `<WhyOthersFail/>` section between hero and product description. Populate from the market-research report's competitor `gap` field. *Applies to: Content/Coaching, SaaS, E-commerce.*

### 4. Graceful-degradation CTA ladder (inventory-state aware)
**Source:** CTA patterns across biasheart / colorcove / 2-cool-cones / aura-cane (compared).
**What it does:** Primary CTA varies by inventory state instead of forcing "Shop Now" into empty collections.
**Why it works:** Day-0 founders have nothing to sell yet. "Shop Now" into an empty grid is worse than no button. A correctly-degraded CTA ("Notify Me When It Drops") converts to email list instead of a 404.
**Baljia port:** E-com template generator detects inventory state before rendering. Logic:
```
stocked       → "Shop Now"
pre-launch w/ date  → "Notify Me When It Drops" + date
pre-launch no date  → "Download Free Sample" + email capture
vendor/pop-up       → "Follow Us" + social + location tracker
drop-shipped POD    → "Shop Now" + POD mockups
```
*Applies to: E-commerce.*

### 5. Specific-artifact lead magnet as hero CTA
**Source:** babysafe (27-point baby-proofing checklist), policydocs (27-point SOC 2 checklist), colorcove (3 free sample pages).
**What it does:** Email capture promises a specific artifact (checklist, PDF, template), never abstract "tips" or "newsletter."
**Why it works:** Specificity of deliverable does the persuasion. "27 items" converts 5× better than "useful tips."
**Baljia port:** Content/Coaching template requires a lead-magnet slot with artifact type, count, and delivery mechanism. Generator derives the artifact from the business (parenting → room-by-room checklist; compliance → N-point audit; fitness → 30-day protocol). *Applies to: Content/Coaching, some SaaS (lead-gen variants).*

---

## Tier 2 — Strong pattern (port next)

### 6. Three-column cost comparison (your tool vs alternatives)
**Source:** callringo.polsia.app (CallRingo vs Traditional Receptionist vs Voicemail).
**What it does:** Compare not against competitors, but against the *cost of alternatives* (including doing nothing).
**Why it works:** Reframes price objection before founder raises it. Voicemail seems "free" until you see "85% of callers lost."
**Baljia port:** For SaaS with pricing on-page, add a comparison row against (a) hiring a person for this job, (b) using 3 point tools, (c) doing nothing. Populate dollar/time values from market research. *Applies to: SaaS, Local Services.*

### 7. Calendar-as-spine navigation
**Source:** mazelcharms.com (Jewish year drives drop cadence — Passover, Hanukkah, Rosh Hashanah).
**What it does:** Calendar / seasonal cycle becomes primary navigation metaphor instead of product categories.
**Why it works:** For cyclical businesses (holidays, seasons, events, academic year), calendar aligns with buyer intent timing. Collections feel arbitrary; calendar feels inevitable.
**Baljia port:** E-com template detects cyclic pattern from market research (holiday-keyed, seasonal, event-driven) and swaps default "Shop by Collection" for a drops/calendar layout. Optional module — renders only when pattern detected. *Applies to: E-commerce.*

### 8. Framework-as-hero (named 3-step model)
**Source:** joyxchange.polsia.app (Create → Curate → Cash), postly-ai (Teach → Set → Walk Away).
**What it does:** Named visual 3-step model does the persuasive work when customer proof doesn't exist yet.
**Why it works:** Day-0 founders have no reviews. A crisp framework provides structure for belief-formation — "I understand how this works" substitutes for "I see that it works for others."
**Baljia port:** All 4 templates support a `<Framework/>` block with 3 named steps derived from the business's "how it works" section. Default when testimonials count is zero. *Applies to: all 4 templates.*

### 9. Manifesto-as-trust-substitute
**Source:** pushedenvelope.com (anti-materialist 3-paragraph manifesto replaces review widget).
**What it does:** Loud, opinionated short-form copy fills the social-proof gap for cause / commentary / niche brands.
**Why it works:** Strong point of view signals the founder actually cares. Noncommittal brand copy + no reviews = dead. Committed manifesto + no reviews = alive.
**Baljia port:** E-com template supports a `<Manifesto/>` block for positioning-driven brands (niche cultural, cause, contrarian). Generator detects positioning strength from mission / market-research tone and offers manifesto as alternative to stats-based trust block. *Applies to: E-commerce, some Content.*

### 10. Locked-rows live-data teaser
**Source:** zeitboard.polsia.app ("Trending Now" shows 3 real trends, 11 locked behind 🔒).
**What it does:** Renders 3 rows of real product output visible on the landing; remaining rows grayed with lock icon.
**Why it works:** Demonstrates the product without a video. Creates urgency. Shows it's real because it's working. Cheaper than a demo video, higher fidelity.
**Baljia port:** SaaS template supports a `<LockedTeaser/>` block — shows 3 recent sample outputs (tasks run, trends tracked, reports generated), locks 11 more behind signup. For Baljia's own page: "3 tasks your AI team did today" + 11 locked. *Applies to: SaaS.*

---

## Tier 3 — Situational (use when fit)

### 11. Founder origin narrative (specific founding moment)
**Source:** gm-roofers.com ("Born from a genuine desire to help friends in need after a hail storm, 1995").
**What it does:** Specific founding moment + year beats generic "trusted since 1995."
**Why it works:** A moment is memorable, a tagline isn't. Turns a local service into a story.
**Baljia port:** Local Services template includes an `<OriginStory/>` block. Generator mines founder angle (from onboarding enrichment) for a specific moment. If nothing specific, omits block — never fabricates one. *Applies to: Local Services, some Content.*

### 12. Quantified satisfaction guarantee
**Source:** buchholz-bookkeeping.polsia.app ("Love it or month 1 is free"), built-different ("DEXA-backed refund").
**What it does:** Specific risk-reversal with measurable trigger, not verbal "satisfaction guaranteed."
**Why it works:** "Satisfied" is subjective and negotiable; "DEXA baseline + follow-up" is objective and enforceable. Removes purchase-decision friction at ~0 actual cost because the guarantee is rarely invoked.
**Baljia port:** Pricing section in any template supports a `<Guarantee/>` slot. Generator only populates when the business has a measurable baseline (content has consumption metric, coaching has outcome metric). Otherwise omits. *Applies to: SaaS, Local Services, Content/Coaching.*

### 13. Four-vibe front door (mutually-exclusive persona cards)
**Source:** showerpop.polsia.app (Girl / Boy / Neutral / Reveal).
**What it does:** Collapses entire catalogue into 3–5 mutually-exclusive persona/occasion cards on the hero.
**Why it works:** Decision architecture. Gift/occasion buyers arrive with one specific scenario — reducing shop-by-everything to shop-by-intent cuts decision time.
**Baljia port:** E-com template detects occasion/persona axis from market research and offers a `<FrontDoorGrid/>` variant (3–5 cards) instead of "Shop All." Best for occasion-gift brands (weddings, babies, holidays, milestones). *Applies to: E-commerce.*

### 14. Emotional-cost urgency (quantify the stalling tax)
**Source:** phinished-doc.polsia.app ("Every week you wait is another week of tuition, another week of doubt").
**What it does:** Quantifies the cost of *not acting* rather than the benefit of acting.
**Why it works:** Benefits are abstract future; costs are concrete present. Stalling tax is always already happening to the audience.
**Baljia port:** Content/Coaching and some SaaS — `<StallingCost/>` block when the founder's market has an obvious silent tax (unfinished degree, lost deals, waste, burnout, downtime). Generator derives from market-research "pain point" field. *Applies to: Content/Coaching, some SaaS.*

---

## Anti-patterns to design out (seen repeatedly)

These aren't ideas — they're failures observed across multiple sites. Baljia's generator should make these impossible.

1. **`© 2026` hardcoded footer** — seen on 8/8 SaaS pages. Fix: use current year from generation context.
2. **Emoji-as-product-photo** — seen on 7/8 e-com pages. Fix: POD mockup fallback, never emoji for product cards.
3. **Empty "Loading articles…" block** — seen on babysafe. Fix: content-strip block only renders when posts exist.
4. **Anonymous founder on coaching/content** — seen on 5/8 content pages. Fix: require named-founder slot or fall back to "[Company] Team" with appropriate visual (abstract avatar, not empty).
5. **Missing phone on local services** — seen on 6/8 local-service pages. Fix: sticky phone number is non-optional slot for Local template.
6. **"Shop Now" CTA into empty collection** — seen on biasheart, colorcove. Fix: CTA ladder by inventory state.
7. **Identical subhead shape across all companies** — seen on 8/8 SaaS pages ("[Product] is an AI [agent] that [verb1], [verb2], [verb3]"). Fix: subhead template varies by journey + category.
8. **No working primary CTA at all** — seen on 5/8 SaaS pages, aura-cane, crewcoat. Fix: every template requires at least an email capture; generation fails without one.

---

## Porting priority

If implementing in order:

1. **Template branching by journey + category** (foundational — enables everything below).
2. **Required-slot enforcement per template** (eliminates 6 of 8 anti-patterns).
3. **Graceful-degradation CTA ladder** (#4 — biggest e-com quality jump).
4. **Specific-artifact lead magnet** (#5 — biggest content/coaching quality jump).
5. **Instant-quote widget** (#1 — biggest SaaS/Services lead-gen jump).
6. **"Why existing solutions fail" block** (#3 — strongest persuasion pattern observed).
7. **Framework-as-hero fallback** (#8 — handles the no-testimonials Day-0 reality).
8. Everything else as situational modules the generator opts into based on business shape.
