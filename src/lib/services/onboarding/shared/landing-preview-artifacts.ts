import type { LandingArtifactKind, LandingTemplateKind } from './landing-template-kind';

export interface LandingArtifactItem {
  label: string;
  value: string;
  detail: string;
}

export interface LandingPreviewSummary {
  audience: string;
  problem: string;
  positioning: string;
}

export interface LandingPreviewContent {
  template_kind?: LandingTemplateKind;
  preview_summary?: LandingPreviewSummary;
  artifact?: {
    kind: LandingArtifactKind;
    title: string;
    items: LandingArtifactItem[];
  };
  generator_version?: 'v1' | 'v2';
}

export function hasLandingPreview(content: LandingPreviewContent): boolean {
  return Boolean(
    content.generator_version === 'v2'
    && content.template_kind
    && content.preview_summary?.audience
    && content.preview_summary.problem
    && content.preview_summary.positioning
    && content.artifact?.kind
    && content.artifact.title
    && Array.isArray(content.artifact.items)
    && content.artifact.items.length >= 3
  );
}

export function renderPreviewArtifactStyles(): string {
  return `/* Day-0 founder preview artifact */
.preview-hero {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(320px, 1.08fr);
  gap: clamp(32px, 6vw, 72px);
  align-items: center;
}
@media (min-width: 900px) {
  .wrap:has(> .preview-hero),
  .inner:has(> .preview-hero) {
    max-width: min(1120px, calc(100vw - 96px));
  }
}
.preview-copy { min-width: 0; }
.preview-artifact {
  background: color-mix(in srgb, var(--bg-elev) 88%, var(--accent) 12%);
  border: var(--border-w) solid color-mix(in srgb, var(--line) 70%, var(--accent) 30%);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  min-width: 0;
}
.preview-artifact__header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: baseline;
  padding: 18px 20px;
  border-bottom: var(--border-w) solid color-mix(in srgb, var(--line) 80%, transparent);
}
.preview-artifact__header > span:first-child {
  display: grid;
  gap: 4px;
}
.preview-artifact__eyebrow {
  font-family: var(--font-heading);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}
.preview-artifact__title {
  font-family: var(--font-heading);
  font-size: clamp(18px, 2vw, 24px);
  font-weight: var(--heading-w);
  line-height: 1.12;
}
.preview-artifact__kind {
  font-size: 12px;
  color: var(--ink-soft);
  white-space: nowrap;
}
.preview-artifact__body { padding: 18px 20px 20px; }
.preview-item-title {
  display: block;
  font-family: var(--font-heading);
  font-weight: var(--heading-w);
  color: var(--ink);
  line-height: 1.2;
  min-width: 0;
  overflow-wrap: anywhere;
}
.preview-item-meta {
  display: block;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-soft);
  min-width: 0;
  overflow-wrap: anywhere;
}
.preview-item-detail {
  display: block;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.45;
  min-width: 0;
  overflow-wrap: anywhere;
}
.preview-board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.preview-board__lane {
  display: grid;
  gap: 10px;
  align-content: start;
  padding: 12px;
  min-height: 188px;
  background: color-mix(in srgb, var(--bg) 72%, var(--bg-elev) 28%);
  border: var(--border-w) solid color-mix(in srgb, var(--line) 74%, transparent);
}
.preview-board__lane-label {
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--accent);
}
.preview-board__ticket {
  display: grid;
  gap: 7px;
  padding: 11px;
  background: var(--bg-elev);
  border-top: 2px solid var(--accent);
}
.preview-dashboard {
  display: grid;
  gap: 16px;
}
.preview-dashboard__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.preview-dashboard__metric {
  display: grid;
  gap: 6px;
  padding: 14px 12px;
  background: color-mix(in srgb, var(--bg) 76%, var(--bg-elev) 24%);
  border-top: 2px solid var(--accent);
}
.preview-dashboard__activity {
  display: grid;
  gap: 0;
  border-top: var(--border-w) solid color-mix(in srgb, var(--line) 76%, transparent);
}
.preview-dashboard__event {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  padding: 12px 0;
  border-bottom: var(--border-w) solid color-mix(in srgb, var(--line) 72%, transparent);
}
.preview-flow {
  display: grid;
  gap: 12px;
}
.preview-flow__step {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  padding: 14px;
  background: color-mix(in srgb, var(--bg) 78%, var(--bg-elev) 22%);
  border: var(--border-w) solid color-mix(in srgb, var(--line) 76%, transparent);
}
.preview-flow__num {
  font-family: var(--font-heading);
  font-weight: var(--heading-w);
  color: var(--accent);
}
.preview-storefront {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.preview-storefront__item {
  display: grid;
  gap: 10px;
  padding: 14px;
  background: color-mix(in srgb, var(--bg) 76%, var(--bg-elev) 24%);
  border: var(--border-w) solid color-mix(in srgb, var(--line) 76%, transparent);
}
.preview-storefront__image {
  aspect-ratio: 4 / 3;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 34%, transparent), transparent 58%),
    color-mix(in srgb, var(--bg-elev) 82%, var(--accent) 18%);
  border: var(--border-w) solid color-mix(in srgb, var(--line) 70%, transparent);
}
.preview-program {
  display: grid;
  gap: 0;
}
.preview-program__module {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 14px;
  padding: 14px 0;
  border-bottom: var(--border-w) solid color-mix(in srgb, var(--line) 72%, transparent);
}
.preview-program__module:last-child { border-bottom: 0; }
.preview-program__marker {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  background: color-mix(in srgb, var(--accent) 16%, var(--bg) 84%);
  color: var(--accent);
  font-family: var(--font-heading);
  font-weight: var(--heading-w);
}
.preview-match {
  display: grid;
  gap: 12px;
}
.preview-match__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 54px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 13px;
  background: color-mix(in srgb, var(--bg) 76%, var(--bg-elev) 24%);
  border: var(--border-w) solid color-mix(in srgb, var(--line) 76%, transparent);
}
.preview-match__score {
  display: grid;
  place-items: center;
  min-height: 42px;
  color: var(--accent);
  font-family: var(--font-heading);
  font-weight: var(--heading-w);
  border-top: 2px solid var(--accent);
  border-bottom: 2px solid var(--accent);
}
.preview-growth {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.preview-growth__metric {
  display: grid;
  gap: 8px;
  padding: 15px;
  background: color-mix(in srgb, var(--bg) 76%, var(--bg-elev) 24%);
  border-top: 2px solid var(--accent);
}
.preview-scope,
.preview-snapshot {
  display: grid;
  gap: 12px;
}
.preview-scope__row,
.preview-snapshot__row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 14px;
  padding: 13px 0;
  border-bottom: var(--border-w) solid color-mix(in srgb, var(--line) 72%, transparent);
}
.preview-scope__row:last-child,
.preview-snapshot__row:last-child { border-bottom: 0; }
.preview-proof {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: color-mix(in srgb, var(--line) 72%, transparent);
  margin-top: 28px;
}
.preview-proof__item {
  background: var(--bg);
  padding: 14px 12px;
}
.preview-proof__label {
  display: block;
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 6px;
}
.preview-proof__value {
  display: block;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.35;
}
.preview-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.preview-summary__item {
  padding-top: 16px;
  border-top: var(--border-w) solid color-mix(in srgb, var(--accent) 55%, var(--line));
}
.preview-summary__item dt {
  font-family: var(--font-heading);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 10px;
}
.preview-summary__item dd {
  margin: 0;
  color: var(--ink);
  opacity: 0.84;
}
@media (max-width: 760px) {
  .preview-hero {
    grid-template-columns: 1fr;
    gap: 20px;
    padding-top: 32px;
    padding-bottom: 40px;
  }
  .preview-hero h1 { margin-bottom: 18px; }
  .preview-hero p { line-height: 1.45; }
  .preview-artifact__header { align-items: flex-start; flex-direction: column; gap: 8px; }
  .preview-artifact__kind { white-space: normal; }
  .preview-artifact__body { padding: 14px 16px 16px; }
  .preview-board,
  .preview-dashboard__metrics,
  .preview-storefront,
  .preview-growth {
    grid-template-columns: 1fr;
  }
  .preview-board__lane { min-height: auto; }
  .preview-dashboard__event,
  .preview-flow__step,
  .preview-program__module,
  .preview-match__row,
  .preview-scope__row,
  .preview-snapshot__row {
    grid-template-columns: 1fr;
  }
  .preview-proof { margin-top: 18px; }
  .preview-proof__item { padding: 10px; }
  .preview-proof { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .preview-summary { grid-template-columns: 1fr; gap: 18px; }
}`;
}

export function renderPreviewArtifact(content: LandingPreviewContent, esc: (s: string) => string): string {
  if (!hasLandingPreview(content) || !content.artifact) return '';

  const body = renderArtifactBody(content.artifact.kind, content.artifact.items.slice(0, 5), esc);

  return `<figure class="preview-artifact preview-artifact--${esc(content.artifact.kind)}" data-preview-artifact="${esc(content.artifact.kind)}">
      <figcaption class="preview-artifact__header">
        <span>
          <span class="preview-artifact__eyebrow">Generated artifact</span>
          <span class="preview-artifact__title">${esc(content.artifact.title)}</span>
        </span>
        <span class="preview-artifact__kind">${artifactLabel(content.artifact.kind)}</span>
      </figcaption>
      <div class="preview-artifact__body">
        ${body}
      </div>
    </figure>`;
}

function renderArtifactBody(kind: LandingArtifactKind, items: LandingArtifactItem[], esc: (s: string) => string): string {
  switch (kind) {
    case 'pipeline_board':
      return renderPipelineBoard(items, esc);
    case 'app_dashboard':
      return renderAppDashboard(items, esc);
    case 'booking_flow':
      return renderBookingFlow(items, esc);
    case 'storefront_drop':
      return renderStorefrontDrop(items, esc);
    case 'coaching_map':
      return renderCoachingMap(items, esc);
    case 'marketplace_match':
      return renderMarketplaceMatch(items, esc);
    case 'growth_snapshot':
      return renderGrowthSnapshot(items, esc);
    case 'service_scope':
      return renderServiceScope(items, esc);
    case 'general_snapshot':
    default:
      return renderGeneralSnapshot(items, esc);
  }
}

function renderPipelineBoard(items: LandingArtifactItem[], esc: (s: string) => string): string {
  const lanes = ['New', 'Review', 'Next'];
  return `<div class="preview-board">
    ${lanes.map((lane, index) => {
      const item = items[index % items.length];
      return `<div class="preview-board__lane">
        <span class="preview-board__lane-label">${lane}</span>
        <article class="preview-board__ticket">
          ${renderItem(item, esc)}
        </article>
      </div>`;
    }).join('')}
  </div>`;
}

function renderAppDashboard(items: LandingArtifactItem[], esc: (s: string) => string): string {
  const metrics = items.slice(0, 3).map((item) => `<div class="preview-dashboard__metric">${renderItem(item, esc)}</div>`).join('');
  const events = items.slice(0, 4).map((item) => `<div class="preview-dashboard__event">
    <span class="preview-item-meta">${esc(item.label)}</span>
    <span class="preview-item-detail">${esc(item.detail)}</span>
  </div>`).join('');
  return `<div class="preview-dashboard">
    <div class="preview-dashboard__metrics">${metrics}</div>
    <div class="preview-dashboard__activity">${events}</div>
  </div>`;
}

function renderBookingFlow(items: LandingArtifactItem[], esc: (s: string) => string): string {
  return `<div class="preview-flow">
    ${items.map((item, index) => `<div class="preview-flow__step">
      <span class="preview-flow__num">${String(index + 1).padStart(2, '0')}</span>
      <span>${renderItem(item, esc)}</span>
    </div>`).join('')}
  </div>`;
}

function renderStorefrontDrop(items: LandingArtifactItem[], esc: (s: string) => string): string {
  return `<div class="preview-storefront">
    ${items.slice(0, 4).map((item) => `<article class="preview-storefront__item">
      <span class="preview-storefront__image" aria-hidden="true"></span>
      ${renderItem(item, esc)}
    </article>`).join('')}
  </div>`;
}

function renderCoachingMap(items: LandingArtifactItem[], esc: (s: string) => string): string {
  return `<div class="preview-program">
    ${items.map((item, index) => `<div class="preview-program__module">
      <span class="preview-program__marker">${String(index + 1).padStart(2, '0')}</span>
      <span>${renderItem(item, esc)}</span>
    </div>`).join('')}
  </div>`;
}

function renderMarketplaceMatch(items: LandingArtifactItem[], esc: (s: string) => string): string {
  return `<div class="preview-match">
    ${items.slice(0, 4).map((item, index) => `<div class="preview-match__row">
      <span>
        <span class="preview-item-meta">${esc(item.label)}</span>
        <span class="preview-item-title">${esc(item.value)}</span>
      </span>
      <span class="preview-match__score">${90 - index * 7}%</span>
      <span class="preview-item-detail">${esc(item.detail)}</span>
    </div>`).join('')}
  </div>`;
}

function renderGrowthSnapshot(items: LandingArtifactItem[], esc: (s: string) => string): string {
  return `<div class="preview-growth">
    ${items.slice(0, 4).map((item) => `<div class="preview-growth__metric">${renderItem(item, esc)}</div>`).join('')}
  </div>`;
}

function renderServiceScope(items: LandingArtifactItem[], esc: (s: string) => string): string {
  return `<div class="preview-scope">
    ${items.map((item) => `<div class="preview-scope__row">
      <span class="preview-item-meta">${esc(item.label)}</span>
      <span>${renderItem(item, esc, false)}</span>
    </div>`).join('')}
  </div>`;
}

function renderGeneralSnapshot(items: LandingArtifactItem[], esc: (s: string) => string): string {
  return `<div class="preview-snapshot">
    ${items.map((item) => `<div class="preview-snapshot__row">
      <span class="preview-item-meta">${esc(item.label)}</span>
      <span>${renderItem(item, esc, false)}</span>
    </div>`).join('')}
  </div>`;
}

function renderItem(item: LandingArtifactItem, esc: (s: string) => string, includeLabel = true): string {
  return `${includeLabel ? `<span class="preview-item-meta">${esc(item.label)}</span>` : ''}
    <span class="preview-item-title">${esc(item.value)}</span>
    <span class="preview-item-detail">${esc(item.detail)}</span>`;
}

export function renderPreviewProofRail(content: LandingPreviewContent, esc: (s: string) => string): string {
  if (!hasLandingPreview(content) || !content.preview_summary || !content.template_kind) return '';

  const proof = [
    ['Audience', content.preview_summary.audience],
    ['Problem', content.preview_summary.problem],
    ['Positioning', content.preview_summary.positioning],
    ['Preview type', templateLabel(content.template_kind)],
  ];

  return `<div class="preview-proof" aria-label="What Baljia created during onboarding">
    ${proof.map(([label, value]) => `<span class="preview-proof__item"><span class="preview-proof__label">${esc(label)}</span><span class="preview-proof__value">${esc(value)}</span></span>`).join('')}
  </div>`;
}

export function renderPreviewSummary(content: LandingPreviewContent, esc: (s: string) => string): string {
  if (!hasLandingPreview(content) || !content.preview_summary) return '';

  const items = [
    ['Audience', content.preview_summary.audience],
    ['Problem', content.preview_summary.problem],
    ['Positioning', content.preview_summary.positioning],
  ];

  return `<dl class="preview-summary">
    ${items.map(([label, value]) => `<div class="preview-summary__item"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
  </dl>`;
}

function artifactLabel(kind: LandingArtifactKind): string {
  switch (kind) {
    case 'pipeline_board':
      return 'Pipeline preview';
    case 'app_dashboard':
      return 'Dashboard preview';
    case 'booking_flow':
      return 'Booking flow';
    case 'storefront_drop':
      return 'Storefront preview';
    case 'coaching_map':
      return 'Program map';
    case 'marketplace_match':
      return 'Match board';
    case 'growth_snapshot':
      return 'Growth snapshot';
    case 'service_scope':
      return 'Scope preview';
    case 'general_snapshot':
    default:
      return 'Business snapshot';
  }
}

function templateLabel(kind: LandingTemplateKind): string {
  return kind.replace(/_/g, ' ');
}
