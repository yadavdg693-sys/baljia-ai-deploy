// Playwright visibility check for generated onboarding preview HTML.
// Ensures brand, headline, and the preview artifact are visible in the first
// viewport on desktop and mobile, and writes screenshots for manual review.
//
// Run after test-landing-v2-render:
// npx tsx src/scripts/check-onboarding-landing-screenshot.ts tmp-landing-v2-samples/utility-cards.html

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function requireVisibleInFirstViewport(page: Page, selector: string, label: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`${label} did not produce a bounding box.`);

  const intersectsFirstViewport = box.y < viewport.height && box.y + box.height > 0 && box.x < viewport.width && box.x + box.width > 0;
  if (!intersectsFirstViewport) {
    throw new Error(`${label} is not visible in the first viewport. Box=${JSON.stringify(box)}, viewport=${JSON.stringify(viewport)}`);
  }
}

function htmlFilesFromTarget(target: string): string[] {
  const targetPath = resolve(process.cwd(), target);
  if (!existsSync(targetPath)) throw new Error(`Path not found: ${targetPath}`);
  const stat = statSync(targetPath);
  if (stat.isFile()) return [targetPath];
  return readdirSync(targetPath)
    .flatMap((name) => {
      const child = join(targetPath, name);
      const childStat = statSync(child);
      if (childStat.isDirectory()) return htmlFilesFromTarget(child);
      return extname(name).toLowerCase() === '.html' ? [child] : [];
    });
}

async function checkFile(targetPath: string): Promise<void> {
  const outDir = join(dirname(targetPath), 'screenshots');
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport });
      await page.goto(pathToFileURL(targetPath).toString());
      await requireVisibleInFirstViewport(page, '.brand', 'brand');
      await requireVisibleInFirstViewport(page, 'h1', 'headline');
      await requireVisibleInFirstViewport(page, '[data-preview-artifact]', 'preview artifact');

      const screenshotPath = join(outDir, `${basename(targetPath, '.html')}-${viewport.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      await page.close();
      console.log(`PASS ${viewport.name} ${viewport.width}x${viewport.height} -> ${screenshotPath}`);
    }
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? 'tmp-landing-v2-samples/utility-cards.html';
  const files = htmlFilesFromTarget(target);
  if (files.length === 0) throw new Error(`No HTML files found for ${target}`);

  for (const file of files) {
    await checkFile(file);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
