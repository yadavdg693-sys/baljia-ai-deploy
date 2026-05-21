export type VisualContrastIssue = {
  kind: 'text' | 'control' | 'select-option' | 'custom-option' | 'icon-control';
  element: string;
  text: string;
  ratio: number;
  minRatio: number;
  color: string;
  background: string;
  reason: string;
};

type Rgba = { r: number; g: number; b: number; a: number };

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, value));
}

export function parseCssColor(value: string): Rgba | null {
  const raw = value.trim().toLowerCase();
  if (!raw || raw === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const body = hex[1];
    if (body.length === 3 || body.length === 4) {
      const channels = body.split('').map((part) => parseInt(part + part, 16));
      const [r, g, b] = channels;
      const alpha = channels[3] ?? 255;
      return { r, g, b, a: alpha / 255 };
    }
    if (body.length === 6 || body.length === 8) {
      const r = parseInt(body.slice(0, 2), 16);
      const g = parseInt(body.slice(2, 4), 16);
      const b = parseInt(body.slice(4, 6), 16);
      const a = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
  }

  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const parts = rgb[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return null;
  const parseChannel = (part: string) => part.endsWith('%')
    ? Number.parseFloat(part) * 2.55
    : Number.parseFloat(part);
  const r = parseChannel(parts[0]);
  const g = parseChannel(parts[1]);
  const b = parseChannel(parts[2]);
  const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { r: clampColor(r), g: clampColor(g), b: clampColor(b), a: Math.max(0, Math.min(1, a)) };
}

function blend(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top.a + bottom.a * (1 - top.a);
  if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 };
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
    a: alpha,
  };
}

function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const fg = foreground.a < 1 ? blend(foreground, background) : foreground;
  const fgLum = luminance(fg);
  const bgLum = luminance(background);
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatioForCssColors(foreground: string, background: string): number | null {
  const fg = parseCssColor(foreground);
  const bg = parseCssColor(background);
  if (!fg || !bg) return null;
  return contrastRatio(fg, bg);
}

export function formatVisualContrastIssues(issues: VisualContrastIssue[], limit = 8): string {
  if (issues.length === 0) return 'visual_contrast=pass';
  const shown = issues.slice(0, limit).map((issue) =>
    `${issue.kind} ${issue.element} "${issue.text.slice(0, 48)}" ratio=${issue.ratio.toFixed(2)} required=${issue.minRatio.toFixed(1)} color=${issue.color} bg=${issue.background}`,
  );
  const hidden = issues.length > shown.length ? ` (+${issues.length - shown.length} more)` : '';
  return `visual_contrast=fail ${shown.join(' | ')}${hidden}`;
}

export async function auditPageVisualContrast(
  page: { evaluate: <T>(fn: (arg: { maxIssues: number }) => T | Promise<T>, arg: { maxIssues: number }) => Promise<T> },
  options: { maxIssues?: number } = {},
): Promise<VisualContrastIssue[]> {
  const maxIssues = options.maxIssues ?? 20;
  return page.evaluate(({ maxIssues }) => {
    type LocalRgba = { r: number; g: number; b: number; a: number };
    type LocalIssue = {
      kind: 'text' | 'control' | 'select-option' | 'custom-option' | 'icon-control';
      element: string;
      text: string;
      ratio: number;
      minRatio: number;
      color: string;
      background: string;
      reason: string;
    };

    function parseColor(value: string): LocalRgba | null {
      const raw = value.trim().toLowerCase();
      if (!raw || raw === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
      if (!rgb) return null;
      const parts = rgb[1].split(',').map((part) => part.trim());
      if (parts.length < 3) return null;
      const parseChannel = (part: string) => part.endsWith('%')
        ? Number.parseFloat(part) * 2.55
        : Number.parseFloat(part);
      const r = parseChannel(parts[0]);
      const g = parseChannel(parts[1]);
      const b = parseChannel(parts[2]);
      const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
      if (![r, g, b, a].every(Number.isFinite)) return null;
      return {
        r: Math.max(0, Math.min(255, r)),
        g: Math.max(0, Math.min(255, g)),
        b: Math.max(0, Math.min(255, b)),
        a: Math.max(0, Math.min(1, a)),
      };
    }

    function blendColors(top: LocalRgba, bottom: LocalRgba): LocalRgba {
      const alpha = top.a + bottom.a * (1 - top.a);
      if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 };
      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        a: alpha,
      };
    }

    function relativeLuminance(color: LocalRgba): number {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    }

    function ratio(foreground: LocalRgba, background: LocalRgba): number {
      const fg = foreground.a < 1 ? blendColors(foreground, background) : foreground;
      const fgLum = relativeLuminance(fg);
      const bgLum = relativeLuminance(background);
      const lighter = Math.max(fgLum, bgLum);
      const darker = Math.min(fgLum, bgLum);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function effectiveBackground(element: Element): LocalRgba {
      const chain: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) {
        chain.unshift(current);
      }
      let currentColor: LocalRgba = { r: 255, g: 255, b: 255, a: 1 };
      for (const node of chain) {
        const bg = parseColor(getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0) currentColor = blendColors(bg, currentColor);
      }
      return currentColor;
    }

    function visible(element: Element): boolean {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) return false;
      if (element.closest('[hidden],[aria-hidden="true"]')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    }

    function isControl(element: Element): boolean {
      return element.matches('button,[role="button"],input,select,textarea,a[role="button"],a[class*="button" i],a[class*="btn" i]');
    }

    function controlAccessibleName(element: Element): string {
      const ariaLabel = element.getAttribute('aria-label') || '';
      const title = element.getAttribute('title') || '';
      const labelledBy = element.getAttribute('aria-labelledby') || '';
      const labelledText = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      const inputValue = element instanceof HTMLInputElement ? (element.value || element.placeholder || '') : '';
      return `${ariaLabel} ${title} ${labelledText} ${inputValue}`.replace(/\s+/g, ' ').trim();
    }

    function elementText(element: Element): string {
      if (element instanceof HTMLInputElement) return element.value || element.placeholder || element.getAttribute('aria-label') || '';
      if (element instanceof HTMLTextAreaElement) return element.value || element.placeholder || element.getAttribute('aria-label') || '';
      if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.textContent || element.getAttribute('aria-label') || '';
      if (isControl(element)) return element.textContent || element.getAttribute('aria-label') || '';
      const direct = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ');
      return direct;
    }

    function describe(element: Element): string {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : '';
      const name = element.getAttribute('name') ? `[name="${element.getAttribute('name')}"]` : '';
      const role = element.getAttribute('role') ? `[role="${element.getAttribute('role')}"]` : '';
      return `${tag}${id}${name}${role}`;
    }

    function minimumRatio(element: Element): number {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize || '16');
      const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
      const large = fontSize >= 24 || (fontSize >= 18.5 && fontWeight >= 700);
      return large ? 3 : 4.5;
    }

    const issues: LocalIssue[] = [];
    const candidates = Array.from(document.body.querySelectorAll('*'));
    for (const element of candidates) {
      if (issues.length >= maxIssues) break;
      if (!visible(element)) continue;
      const text = elementText(element).replace(/\s+/g, ' ').trim();
      if (text.length < 2) continue;
      const style = getComputedStyle(element);
      const fg = parseColor(style.color);
      const bg = effectiveBackground(element);
      if (!fg) continue;
      const minRatio = minimumRatio(element);
      const actual = ratio(fg, bg);
      if (actual < minRatio) {
        issues.push({
          kind: isControl(element) ? 'control' : 'text',
          element: describe(element),
          text,
          ratio: Math.round(actual * 100) / 100,
          minRatio,
          color: style.color,
          background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          reason: 'Visible text/control label does not meet contrast floor.',
        });
      }
    }

    for (const select of Array.from(document.querySelectorAll('select'))) {
      if (issues.length >= maxIssues) break;
      if (!visible(select)) continue;
      const selectBg = effectiveBackground(select);
      for (const option of Array.from(select.options).slice(0, 8)) {
        const optionStyle = getComputedStyle(option);
        const optionFg = parseColor(optionStyle.color || getComputedStyle(select).color);
        const optionBg = parseColor(optionStyle.backgroundColor);
        if (!optionFg) continue;
        const effectiveOptionBg = optionBg && optionBg.a > 0 ? blendColors(optionBg, selectBg) : selectBg;
        const actual = ratio(optionFg, effectiveOptionBg);
        if (actual < 4.5) {
          issues.push({
            kind: 'select-option',
            element: describe(select),
            text: option.textContent?.replace(/\s+/g, ' ').trim() || 'option',
            ratio: Math.round(actual * 100) / 100,
            minRatio: 4.5,
            color: optionStyle.color || getComputedStyle(select).color,
            background: `rgb(${Math.round(effectiveOptionBg.r)}, ${Math.round(effectiveOptionBg.g)}, ${Math.round(effectiveOptionBg.b)})`,
            reason: 'Native select option text is unreadable against its dropdown background.',
          });
          break;
        }
      }
    }

    for (const option of Array.from(document.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[data-radix-collection-item]'))) {
      if (issues.length >= maxIssues) break;
      if (!visible(option)) continue;
      const text = (option.textContent || option.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (text.length < 2) continue;
      const style = getComputedStyle(option);
      const fg = parseColor(style.color);
      const bg = effectiveBackground(option);
      if (!fg) continue;
      const actual = ratio(fg, bg);
      if (actual < 4.5) {
        issues.push({
          kind: 'custom-option',
          element: describe(option),
          text,
          ratio: Math.round(actual * 100) / 100,
          minRatio: 4.5,
          color: style.color,
          background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          reason: 'Custom dropdown/menu/listbox option text is unreadable against its rendered background.',
        });
      }
    }

    for (const control of Array.from(document.querySelectorAll('button,[role="button"],input,select,textarea,a[role="button"],a[class*="button" i],a[class*="btn" i]'))) {
      if (issues.length >= maxIssues) break;
      if (!visible(control)) continue;
      if (control instanceof HTMLInputElement && control.type === 'hidden') continue;
      if ('disabled' in control && Boolean((control as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled)) continue;
      const visibleText = (control.textContent || '').replace(/\s+/g, ' ').trim();
      if (visibleText.length > 0) continue;
      const accessibleName = controlAccessibleName(control);
      if (accessibleName.length > 0) continue;
      const style = getComputedStyle(control);
      const bg = effectiveBackground(control);
      issues.push({
        kind: 'icon-control',
        element: describe(control),
        text: '(icon-only control)',
        ratio: 0,
        minRatio: 1,
        color: style.color,
        background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        reason: 'Icon-only interactive control has no visible label, aria-label, title, or aria-labelledby accessible name.',
      });
    }

    return issues;
  }, { maxIssues });
}
