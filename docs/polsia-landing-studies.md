# Polsia Landing Page Studies

Structural analysis of 32 live Polsia-generated landing pages (April 2026), sampled across 4 categories: SaaS / B2B AI-tool, local & professional services, e-commerce & lifestyle, content / education / coaching. Goal: inform Baljia AI's Day-0 landing-page format for `{slug}.baljia.app`.

Sample URLs were drawn from `company_urls_working_only.txt` (~500 URLs). Each page was fetched and analyzed for section order, hero copy, CTA mechanics, visual style, trust signals, differentiator, reality check. Pages self-identify as built on Polsia via footer credit; all share the same generator template.

---

## 1. SaaS / B2B AI Tools

**Sample:** pipeforge-86, callringo, admatiq, churnova, setlyne, postly-ai, zeitboard, pitchpilot-55.
All position as "AI employee" for a single business function (SDR, receptionist, ad manager, churn guardian, booking agent, social manager, trend tracker).

### Canonical skeleton

```
nav → hero (headline + subhead) → 3-step "how it works" → 4-feature grid → comparison table → closing statement → footer
```

6 of 8 pages follow this exact sequence. CallRingo, PitchPilot, Zeitboard extend it with pricing or forms. The template is visibly one artifact.

### Hero pattern (highly templated)

- **Headlines:** 4–12 words, always sell *autonomy* not capability. "never sleeps," "runs themselves," "while you sleep," "walk away," "team of one," "always on" — 7 of 8.
- **Subheads:** consistently 19–31 words, shape: `"[Product] is an AI [agent] that [verb1], [verb2], and [verb3]. [Autonomy punchline]."` Too uniform to be accidental — this is a generator slot.

### Critical failure: CTAs missing

**5 of 8 pages ship with no working primary CTA** — no email capture, no demo button, no "get started." The 3 that convert (CallRingo, PitchPilot, Zeitboard) add either a trial form, waitlist, or pricing + checkout.

### Social proof: systematically absent

**Zero testimonials across 8 pages.** The generator clearly refuses to fabricate names — a credibility floor that's also a conversion ceiling. Fallback: stats (often generic: "65% of SDR time wasted," "$2.5B market") or competitor cost comparisons.

### AI tells

- `© 2026` footer on every page despite live-in-April-2026 timing — generator default never swapped.
- Identical sans-serif + light-mode + emoji-icon visual signature across all 8.
- Identical subhead shape (Product + 3 verbs + autonomy line).

### Standout: Churnova + Zeitboard + CallRingo

- **Churnova:** live-subscriber-feed mockup in hero (MRR $247K ↑ 3.2%, 12 at-risk accounts) — only page with a faux-live product shot. One-liner: *"Not a dashboard you check. An employee that works."*
- **Zeitboard:** "Trending Now" section doubles as demo + social proof (3 visible trends, 11 locked behind 🔒). Shows product output without video.
- **CallRingo:** 3-column cost comparison (CallRingo vs Traditional Service vs Voicemail) reframes price objection by showing alternative costs.

### Quality split

- **Conversion-ready (3):** CallRingo, PitchPilot, Zeitboard.
- **Pitch-deck-as-webpage (5):** PipeForge, Admatiq, Churnova, Setlyne, Postly — beautiful, dead-end.

---

## 2. Local & Professional Services

**Sample:** blacktoplifecoffeeco, gm-roofers, dieselspawshop, buchholz-bookkeeping, forgeworkgroup, policydocs, crewcoat, cjtfabrication.
Trades, retail, compliance, bookkeeping.

### Canonical skeleton

```
nav → hero → value prop → services / process → trust strip → gallery → form / CTA → footer
```

Trades pages add a project gallery (GM Roofing, CJT); SaaS-flavored variants (Forgework, ShieldDocs, CrewCoat) swap gallery for a comparison table.

### Critical failures

1. **6 of 8 missing phone numbers** — including Buchholz Bookkeeping whose hero literally says "a real person who picks up the phone." Structural failure for local services: a homeowner with a leak at 9pm can't call.
2. **5 of 8 missing founder photo** despite some having detailed founder-voice bios.
3. **4 of 8 have zero or one anonymous testimonial** — unacceptable for categories where trust is person-led (bookkeeper, painter, fabricator).
4. **CrewCoat ships with no CTA at all** — Polsia-generated landing page for a painter-management tool that can't convert anyone.

### The gold standard: GM Roofing

Only page in the batch a buyer could actually use. Phone number 4×, 22+ years in business, 9-city service area list, Google review link, 8+ real project photos, hours listed, license badges, founding story ("born after a hail storm rescue of friends"). Passes the "9pm leak test."

### Forgework's breakthrough: instant-quote generator

2-field form spits out a full project breakdown (architecture, phases, timeline, cost) **before** any sales contact. Flat-rate pricing ($499–$4,999). Creates perceived value before contact exchange — highest-leverage pattern in the entire 32-page set.

### Template divergence: local needs different slots

| SaaS slot | Local-services required slot |
|---|---|
| Pricing table | Service area (city list or map) |
| Comparison chart | License/insurance badges |
| Dashboard screenshot | Before/after photo gallery |
| Trial CTA | Sticky phone number (top-right) |
| Named testimonials | Google/Yelp review widget with star count |
| Founder bio text | Founder photo + years in trade |
| Feature video | Instant-quote calculator |

---

## 3. E-commerce / Creative / Lifestyle

**Sample:** biasheart, joyxchange, colorcove, mazelcharms, showerpop, 2-cool-cones, aura-cane, pushedenvelope.
K-pop fan merch, artist collective, coloring books, Jewish charm bracelets, baby shower bundles, Dallas shave-ice pop-up, premium canes, anti-materialist apparel.

### Canonical skeleton

```
nav → hero → value prop → feature/product grid → story/manifesto → email capture or waitlist → footer
```

Uniform except 2 Cool Cones (pop-up vendor — no cart, no SKUs; primary CTA is "follow us").

### Hero pattern

- **Headlines:** clustered at 4–6 words ("Merch for the End Times," "Elevate Their Comfort," "Collect Your Jewish Year"). A clear Polsia template tell.
- **Subheads:** 17–28 words, triple-task (what + who + differentiator).

### The #1 AI tell: emoji-as-product

**7 of 8 substitute emoji/iconography for product photography.** 💜🎀🧸🍧◈◆ in place of SKU photos. This is the single strongest "AI made a fake Shopify site" signal across all 32 pages studied.

### The photography-absence problem

Day-0 founders don't have product photos. Template response must be a **graceful fallback hierarchy**:
1. Real product photo (ideal)
2. Printify / POD mockup on neutral background (acceptable — see Pushed Envelope, 12 live SKUs)
3. Strong editorial illustration (acceptable for creative brands)
4. Manifesto / framework / waitlist positioning (acceptable if and only if photos genuinely don't exist yet — see JoyXchange framework, Pushed Envelope manifesto)
5. **Emoji (current Polsia default): not acceptable — kills credibility.**

### The CTA ladder problem

SaaS pages land on one CTA ("Start free trial"). E-com Day-0 needs **graceful-degradation CTA logic based on inventory state**:

```
inventory stocked        → "Shop Now"
pre-launch with date     → "Notify Me When It Drops" (waitlist)
pre-launch no date       → "Download Free Sample" / "Email for First Drop"
pop-up / vendor          → "Follow Us" / "Where Are We Today"
drop-shipped POD         → "Shop Now" with POD mockup
```

Aura Cane is the cautionary tale — "Starting from $69" is the only call to action and there's no button, form, or waitlist. Pre-launch page with no capture mechanism = zero funnel.

### Standouts

- **Mazel Charms:** calendar-as-spine navigation — Jewish year drives the drop cadence. Strongest numeric proof of the batch (4.9★ rating, 500+ charms sold).
- **JoyXchange:** framework-as-hero — a named 3-step model (Create → Curate → Cash) does the persuasive work when reviews don't exist yet.
- **Pushed Envelope:** manifesto-substitutes-for-reviews — loud, opinionated 3-paragraph manifesto fills the social-proof gap on Day-0.
- **ShowerPop:** 4-vibe front door — collapses entire catalogue into 4 mutually-exclusive persona/occasion cards on the hero.

### Quality split

- **Would actually buy:** Pushed Envelope, 2 Cool Cones, JoyXchange, Mazel Charms (4 of 8).
- **Abandons in 10 seconds:** BiasHeart, Aura Cane — pre-launch waitlists disguised as stores.

---

## 4. Content / Education / Coaching / Info Products

**Sample:** babysafe, littleword, built-different, nightbloom, coinsense-12lq (LearnToSend), analyticscoursehub (DataPathAfrica), nestededucation, phinished-doc.
Parenting content, children's scripture, men's fitness, women's sleep e-book, fintech course, data-engineering bootcamp, homeschool tool, dissertation coaching.

### Canonical skeleton

```
nav → hero promise → lead magnet CTA → methodology / how-it-works → named founder + credentials → pricing or tiers → testimonials → blog teaser → footer
```

### Hero pattern

- **Primary CTA is almost always email capture** (6 of 8). This category does not sell from the landing page — it builds a list, then sells.
- Lead magnets are **always concrete artifacts**, never abstract value: *free checklist, weekly reading plan, free consult, free guide, free lesson, compliance checker*. Never "free tips" or "our newsletter."

### Critical failure: anonymous authority

**5 of 8 pages have no named human or a named human with no photo.** In content/coaching — where trust is person-led — this is the biggest miss. Babysafe's "50,000+ parents trust us" with no author named; Built Different's 12-month DEXA-verified transformation program with no coach identity anywhere.

### The gold standard: PhinisheD

Dr. Adriann Wolfe, DBA / MBA / M.Ed (4 credentials on the page). "100+ students mentored, 97% completion rate." Cohort limits (3–5). Transparent pricing ($299/mo, $2,500 retreats). Base location (Lansing, MI). Reads as a real consultancy, not a shell.

### Authority without logo strips

None of the 8 pages use "As featured in TechCrunch" logo strips (the default SaaS move). Authority is built via:
- **Credential stacks** (Dr. Wolfe's DBA/MBA/M.Ed; "8+ Years Data Engineering")
- **Specific numbers** (38 peer-reviewed studies, 97% completion, 200+ ATMs, 20 chapters)
- **Methodology specificity** (DEXA scans, FINTRAC compliance, hormonal mechanisms)

Pattern: **quantified specifics > borrowed logos** for solo / niche experts.

### Standouts

- **NightBloom:** "Why Existing Solutions Fail" pre-pitch section — dismantles melatonin, chamomile, prescriptions, sleep apps with specific mechanisms *before* naming the product. Strongest persuasion pattern in the entire 32-page set. Converts skepticism into curiosity.
- **LearnToSend:** certificate + merchant-discount dual-unlock — completion yields both a credential and a 5% ATM discount. Education output doubles as immediate utility.
- **LittleWord:** zero-stat trust anchors — "0 Words removed / 0 Words added" as central numeric proof. Absence as evidence.
- **PhinisheD:** emotional-cost urgency — "Every week you wait is another week of tuition, another week of doubt." Quantifies the cost of *stalling* instead of benefit of *acting*.

### Template divergence: content/coaching needs a different shape

1. **Primary conversion is email, not purchase** — email capture must be architectural center, not footer strip.
2. **Authority must be human** — named founder/author/coach + photo + credentials + methodology claim.
3. **Content strip belongs below the fold** — render only when posts exist (Babysafe's "Loading articles…" is the cautionary tale).
4. **Hero unit is the lead magnet**, not the product — checklist, 30-day roadmap, free lesson, compliance checker.

---

## Master synthesis: 4 templates, not 1

The canonical Polsia skeleton (hero → value → feature → proof → CTA → footer) **holds at the skeleton level** across categories. But the **required slots are fundamentally different** per category, and the current Polsia template forces a single SaaS-flavored shape onto everyone. That's why local-services pages ship without phone numbers, e-com pages ship with emoji-as-product, and content pages ship without author names.

### Required slots per template variant

| Slot | SaaS | Local | E-com | Content |
|---|---|---|---|---|
| Hero headline | ≤8 words, autonomy angle | ≤8 words, benefit + trust | ≤6 words, brand voice | Promise + audience specificity |
| Primary CTA | Trial / demo / waitlist | Phone (sticky) + quote form | Shop / notify / sample (ladder) | Email + lead magnet |
| Trust anchor | Stats, cost comparisons | Years, license, service area, reviews | Product photos or POD mockups | Named founder, credentials, specifics |
| Differentiator block | Comparison table | Instant-quote calc or gallery | Drops calendar, occasion grid, lookbook | Methodology + "why others fail" |
| Social proof fallback | Public usage stats | Google/Yelp widget | Framework-as-hero or manifesto | Zero-stat anchors or credential stack |
| Content strip | — | Gallery | Collection or drops feed | Blog teaser (conditional on posts) |
| Footer requires | Year match + real contact | Address, hours, license # | Shipping / returns / contact | About, privacy, disclaimer |

### 5 AI-tells to eliminate at generation time

1. **`© 2026` footer** on a page going live in 2026. Use current year from the generator, not a hardcoded string.
2. **Identical subhead shape** (Product + 3 verbs + autonomy punchline) across every generated page. Vary sentence shape by journey.
3. **Emoji-as-product / as-icon** ubiquity. E-com must fall back to POD mockup or strong illustration, never emoji for product cards.
4. **Anonymous founder** on content / coaching / local-services pages. Template must require at least a founder name slot + photo placeholder.
5. **Visual signature uniformity** — light mode + teal accent + sans-serif across 30+ pages. Per-company accent color derived from positioning.

### The 3 universal fixes

1. **Always ship a working primary CTA** — even if just an email capture with a specific lead magnet. "Marketing page describing a product" is not a landing page.
2. **At least one piece of verifiable proof** — specific number, named human, concrete artifact, or transparent pricing. Fabrication floor is inviolable; absence needs graceful fallback, not silent omission.
3. **Inventory / content-state awareness** — don't render "Shop Now" into empty collections, don't render "Latest Articles" into empty blog archives, don't render testimonial blocks when none exist. The generator must detect state and swap the block, not leave a "Loading…" placeholder.

---

## Implication for Baljia's Day-0 landing-page format

Baljia's current `landing.ts` produces free-form HTML from a single prompt. Based on this study, the format should:

1. **Branch on journey + business category.** The onboarding already classifies journey (Build / Grow / Surprise) and has enough industry signal from market research to route to one of 4 template variants: SaaS, Local/Pro Services, E-commerce, Content/Coaching. Using one template for all 4 is the single biggest quality lever.

2. **Structured JSON output, not free HTML.** Move from "generate HTML" to "generate a JSON content object" that a per-category template renders. Makes sections addressable, enables future founder edits, and eliminates the "Polsia look" by varying render per company.

3. **Enforce a non-negotiable checklist per template variant.** Local services must have a phone number and service area. Content/coaching must have a named founder with credentials. E-com must have a photography fallback. SaaS must have a working CTA. Violations fail the generation and trigger a retry with explicit slot fill.

4. **Inventory / state detection in the generator.** Before generating sections, the generator checks: does this company have a founder name? Product photos? Testimonials? Blog posts? Pricing? Each check gates a section variant — no "Loading…" placeholders, ever.

5. **Accent color derived per company, not template default.** Even a single derived hue (from market-research category or founder positioning) breaks the "30 identical teal sites" signature.

Separately, see [polsia-unique-ideas.md](polsia-unique-ideas.md) for 14 specific patterns worth porting into Baljia's generator.
