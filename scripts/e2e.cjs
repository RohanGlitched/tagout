// End to end in a real browser: a typed check and a label-photo check, desktop and phone.
// Usage: node scripts/e2e.cjs <base> <photo.jpg> <out-dir>
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const [base, photo, out] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  let fails = 0;
  for (const [name, vp, mode] of [["desktop", { width: 1440, height: 900 }, "type"], ["phone", { width: 390, height: 844 }, "photo"]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 800 ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(base + "/", { waitUntil: "load" });
    if (mode === "type") {
      await page.getByRole("button", { name: "A medicine" }).click();
      await page.getByRole("button", { name: "A car seat" }).click();
    } else {
      await page.locator("input[type=file]").setInputFiles(photo);
      await page.getByRole("img", { name: "Label photo 1" }).waitFor();
    }
    await page.getByRole("button", { name: "Check my things" }).click();
    await page.waitForURL(/\/check\//, { timeout: 30000 });
    const id = page.url().split("/").pop();
    await page.locator("main[data-status=done]").waitFor({ timeout: 180000 });
    await page.waitForTimeout(2500);
    const h1 = await page.locator("h1").textContent();
    const tags = await page.locator("[data-level]").evaluateAll((els) => els.map((e) => e.getAttribute("data-level")));
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.screenshot({ path: `${out}/e2e-${name}.png`, fullPage: true });
    console.log(name, id, `${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(h1), "levels", tags.filter((t) => t !== "pending").join(","), "scrollWidth", sw, errors.length ? "ERRORS " + errors.slice(0, 3).join(" | ") : "no console errors");
    if (sw > vp.width || errors.length) fails++;
    // A reload after the run shows the saved check without re-running it.
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1500);
    console.log("  reload h1:", JSON.stringify(await page.locator("h1").textContent()));
    await ctx.close();
  }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
