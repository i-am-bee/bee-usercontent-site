import { chromium } from 'playwright';
import fs from 'fs/promises';

const url = process.argv[2];
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const PREFIXES_TO_PRELOAD = [
  'https://cdn.jsdelivr.net/',
  'https://files.pythonhosted.org/',
  'https://pypi.org/simple/',
];

const requestDetails = [];

page.on('requestfinished', async request => {
  const response = await request.response();
  const contentType = response?.headers()['content-type'] || 'unknown';
  requestDetails.push({
    url: request.url(),
    contentType,
  });
});

try {
  await page.goto(url);
  await page.locator("html", { hasText: "APP LOADED!" }).waitFor({ state: "attached" });

  const filteredRequests = requestDetails.filter(requestDetail =>
    PREFIXES_TO_PRELOAD.some(prefix => requestDetail.url.startsWith(prefix))
  );

  await fs.writeFile('preload.json', JSON.stringify({ items: filteredRequests }, null, 2));
  console.log(`Updated preload.json`);
} catch (error) {
  console.error('An error occurred:', error);
} finally {
  await browser.close();
}
