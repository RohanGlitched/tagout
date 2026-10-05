// Product screenshots for the README and the gallery: node scripts/readme-shots.cjs [base] [checkId]
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const base = process.argv[2] || "https://tagout-recalls.vercel.app";
const CHECK = process.argv[3] || "4r6ktc8zfm";
const out = "docs/screens";
(async () => {
  const b = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  const desk = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await desk.goto(base + "/", { waitUntil: "load" });
  await desk.waitForTimeout(5200);
  await desk.screenshot({ path: `${out}/home.png` });
  for (const [id, name] of [["#wall-h", "wall"], ["#spec-h", "anatomy"], ["#codes-h", "codes"]]) {
    await desk.locator(id).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
    await desk.waitForTimeout(2200);
    await desk.screenshot({ path: `${out}/${name}.png` });
  }

  await desk.goto(`${base}/check/${CHECK}`, { waitUntil: "load" });
  await desk.waitForTimeout(1500);
  await desk.screenshot({ path: `${out}/check-top.png` });
  const rows = desk.locator("ol > li[data-level]");
  for (const [i, name] of [[0, "check-red"], [2, "check-orange"]]) {
    await rows.nth(i).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20));
    await desk.waitForTimeout(400);
    await desk.screenshot({ path: `${out}/${name}.png` });
  }
  // The agent's log, opened.
  await rows.nth(0).getByRole("button", { name: /searches/ }).click();
  await rows.nth(0).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20));
  await desk.waitForTimeout(500);
  await desk.screenshot({ path: `${out}/check-log.png` });

  await desk.goto(base + "/recalls", { waitUntil: "load" });
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: `${out}/recalls.png` });

  const phone = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.goto(base + "/", { waitUntil: "load" });
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: `${out}/phone-home.png` });
  await phone.goto(`${base}/check/${CHECK}`, { waitUntil: "load" });
  await phone.waitForTimeout(800);
  await phone.locator("ol > li[data-level]").first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70));
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: `${out}/phone-check.png` });
  await b.close();
})();
