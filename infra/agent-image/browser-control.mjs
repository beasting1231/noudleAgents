import { chromium } from "/usr/lib/node_modules/playwright/index.mjs";

const [action, rawUrl] = process.argv.slice(2);

if (action !== "navigate" || !rawUrl) {
  console.error("Usage: browser-control navigate <http-or-https-url>");
  process.exit(2);
}

let url;
try {
  url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported protocol");
} catch {
  console.error("Browser URL must use http or https");
  process.exit(2);
}

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 10_000 });
const context = browser.contexts()[0];
if (!context) throw new Error("Chrome has no active browser context");
const pages = context.pages();
const page = pages.toReversed().find((candidate) => !candidate.url().startsWith("devtools://")) ?? await context.newPage();
page.setDefaultTimeout(10_000);
await page.bringToFront();
await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForFunction(() => Boolean(document.body?.childElementCount), undefined, { timeout: 10_000 });
if (page.url().startsWith("chrome-error://")) throw new Error(`Chrome failed to load ${url.hostname}`);
console.log(JSON.stringify({ ok: true, url: page.url(), title: await page.title() }));
process.exit(0);
