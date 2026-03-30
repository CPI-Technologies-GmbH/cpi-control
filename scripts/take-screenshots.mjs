import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'marketing', 'screenshots');

const pages = [
  { name: '01-dashboard', url: '/', wait: 3000 },
  { name: '02-services', url: '/services', wait: 2000 },
  { name: '03-projects', url: '/projects', wait: 2000 },
  { name: '04-project-detail', url: '/projects', click: 'CloudStore', wait: 3000 },
  { name: '05-deployments', url: '/deployments', wait: 2000 },
  { name: '06-incidents', url: '/incidents', wait: 2000 },
  { name: '07-integrations', url: '/settings', clickTab: 'Integrations', wait: 2000 },
  { name: '08-incident-detail', url: '/incidents', clickFirst: true, wait: 2000 },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  for (const p of pages) {
    console.log(`📸 ${p.name}...`);
    await page.goto(`http://localhost:5173${p.url}`, { waitUntil: 'load' });
    await page.waitForTimeout(p.wait || 2000);

    if (p.click) {
      await page.getByText(p.click, { exact: false }).first().click();
      await page.waitForTimeout(2000);
    }
    if (p.clickTab) {
      await page.getByRole('button', { name: p.clickTab }).click();
      await page.waitForTimeout(1500);
    }
    if (p.clickFirst) {
      const firstLink = page.locator('a[href*="/incidents/"]').first();
      await firstLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: path.join(outDir, `${p.name}.png`),
      type: 'png',
    });
    console.log(`  ✓ saved ${p.name}.png`);
  }

  await browser.close();
  console.log('\nDone! All screenshots saved to marketing/screenshots/');
}

run().catch(console.error);
