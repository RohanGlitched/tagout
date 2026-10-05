// Usage: node scripts/shots.cjs <base> <out-dir> path[,path...] [widths]
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const [base, out, paths, widths = "1440,390"] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  for (const w of widths.split(",").map(Number)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w > 800 ? 900 : 844 }, deviceScaleFactor: w > 800 ? 1 : 2, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    for (const p of paths.split(",")) {
      await page.goto(base + p, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(2500);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const name = (p.replace(/[/?=&]+/g, "_").replace(/^_|_$/g, "") || "home") + `-${w}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: true });
      console.log(name, "scrollWidth", sw, sw > w ? "OVERFLOW" : "");
    }
    if (errors.length) console.log("console errors @" + w + ":", errors.slice(0, 5));
    await ctx.close();
  }
  await browser.close();
})();
