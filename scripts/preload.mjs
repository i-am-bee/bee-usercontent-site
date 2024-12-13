import { chromium } from 'playwright';
import fs from 'fs/promises';
import { glob } from 'glob';
import stlitePackage from '../node_modules/@stlite/mountable/package.json' with { type: "json" };

const url = process.argv[2];
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const PREFIXES_TO_PRELOAD = [
  'https://cdn.jsdelivr.net/',
  'https://files.pythonhosted.org/',
  'https://pypi.org/simple/',
];

const preloadItems = [
  ...(await glob("./node_modules/@stlite/mountable/build/pypi/*.whl", { withFileTypes: true })).map(path => ({url: `/lib/stlite@${stlitePackage.version}/pypi/${path.name}`, contentType: 'application/wasm'})),
  ...(await glob("./node_modules/@stlite/mountable/build/*.module.wasm", { withFileTypes: true })).map(path => ({url: `/lib/stlite@${stlitePackage.version}/${path.name}`, contentType: 'application/wasm'}))
];

page.on('requestfinished', async request => {
  const url = request.url();
  const contentType = (await request.response())?.headers()['content-type'] || 'unknown';
  if (PREFIXES_TO_PRELOAD.some(prefix => url.startsWith(prefix))) {
    preloadItems.push({ url, contentType });
  }
});

try {
  await page.goto(url);
  await page.locator("html", { hasText: "APP LOADED!" }).waitFor({ state: "attached" });
  await fs.writeFile('./public/meta/preload.json', JSON.stringify({ items: preloadItems }, null, 2));
  console.log(`Updated ./public/meta/preload.json`);
} catch (error) {
  console.error('An error occurred:', error);
} finally {
  await browser.close();
}
