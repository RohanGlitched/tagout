// Hover a tag on the wall and pick a hazard; saves a screenshot of each state.
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const [base, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + "/", { waitUntil: "load" });
  await p.locator("#wall-h").scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, 200));
  await p.waitForTimeout(1800);
  const tag = p.locator("a[data-i]").nth(120);
  await tag.hover();
  await p.waitForTimeout(300);
  console.log("tooltip:", await p.locator("[data-on='1']").innerText());
  await p.screenshot({ path: `${out}/wall-hover.png` });
  await p.getByRole("button", { name: /Fire and burns/ }).click();
  await p.mouse.move(10, 10);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/wall-fire.png` });
  await b.close();
})();
