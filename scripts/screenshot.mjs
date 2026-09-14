/**
 * Capture une page du site, avec la possibilité de survoler un élément avant.
 *
 * Sert à vérifier de visu un changement d'interface — et en particulier qu'il
 * tient sur mobile — sans dépendre d'un navigateur piloté à la main. Réutilise
 * le Chrome déjà installé (puppeteer-core ne télécharge rien).
 *
 * Exemples :
 *   node scripts/screenshot.mjs /items
 *   node scripts/screenshot.mjs /items --mobile
 *   node scripts/screenshot.mjs /items --hover 'img[src*="img/item/"]'
 *   node scripts/screenshot.mjs /champions/ahri --base https://metarenastats.tblabs.dev
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = process.argv.slice(2);
const path = args[0] ?? "/";
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const base = flag("base", "http://localhost:3000");
const hover = flag("hover", null);
const out = flag("out", `screenshot${path.replace(/\W+/g, "-")}.png`);
const mobile = args.includes("--mobile");
const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
await page.goto(base + path, { waitUntil: "networkidle2", timeout: 60000 });

if (hover) {
  const el = await page.$(hover);
  if (!el) {
    console.error(`Aucun élément ne correspond à ${hover}`);
  } else {
    await el.hover();
    // Laisse le temps aux descriptions de se charger et à la bulle de se placer.
    await new Promise((r) => setTimeout(r, 800));
  }
}

await page.screenshot({ path: out, fullPage: args.includes("--full") });
console.log(`${base}${path} (${viewport.width}×${viewport.height}) -> ${out}`);
await browser.close();
