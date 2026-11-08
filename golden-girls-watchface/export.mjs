// Renders the Cheesecake O'Clock wallpapers to PNG.
// Usage: node export.mjs            (writes into ./wallpapers and ./previews)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// require() so a globally installed Playwright (NODE_PATH) is found too.
const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const themes = ['blanche', 'dorothy', 'rose', 'sophia'];
const sizes = [
  { dir: 'ultra-and-ultra-2_410x502', w: 410, h: 502 },
  { dir: 'ultra-3_422x514', w: 422, h: 514 },
];

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch(proxy ? { proxy } : {});
const page = await browser.newPage();
await page.goto(pathToFileURL(join(here, 'export.html')).href);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });

const fontsOk = await page.evaluate(() => ['600 100px Fraunces', '400 32px "Pinyon Script"', '500 12px Jost']
  .every((f) => document.fonts.check(f)));
if (!fontsOk) console.warn('Warning: web fonts did not load; output will use fallback faces.');

function save(path, dataUrl) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', path);
}

for (const size of sizes) {
  for (const theme of themes) {
    const png = await page.evaluate(([t, w, h]) => window.renderPNG(t, w, h, 'wallpaper'), [theme, size.w, size.h]);
    save(join(here, 'wallpapers', size.dir, `${theme}.png`), png);
  }
}

// Live-concept previews at 2x, frozen at 10:09 PM on a Saturday.
for (const theme of themes) {
  const png = await page.evaluate(([t]) => window.renderPNG(t, 820, 1004, 'live', '2026-11-07T22:09:21'), [theme]);
  save(join(here, 'previews', `live-${theme}@2x.png`), png);
}

await browser.close();
