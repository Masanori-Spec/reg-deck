import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { example, blankField } from "../../src/example.mjs";
import { mapCSV } from "../../src/export.mjs";
const dir = process.env.BROWSER_ARTIFACT_DIR ?? "tests/browser/artifacts",
  base = process.env.BASE_URL ?? "http://127.0.0.1:4173";
await mkdir(dir, { recursive: true });
let browser;
const results = [],
  errors = [],
  requests = [];
try {
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
} catch (error) {
  await writeFile(
    `${dir}/results.json`,
    JSON.stringify(
      {
        status: "blocked",
        stage: "browser-launch",
        testsRun: 0,
        sandbox: true,
        error: error.message,
      },
      null,
      2,
    ),
  );
  throw error;
}
const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    acceptDownloads: true,
  }),
  page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => requests.push(r.url()));
async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, status: "passed" });
  } catch (error) {
    results.push({ name, status: "failed", error: error.message });
    await page
      .screenshot({ path: `${dir}/failure.png`, fullPage: true })
      .catch(() => {});
    throw error;
  }
}
async function download(id) {
  const waiting = page.waitForEvent("download");
  await page.locator(id).click();
  const item = await waiting,
    stream = await item.createReadStream(),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return {
    name: item.suggestedFilename(),
    text: Buffer.concat(chunks).toString("utf8"),
  };
}
async function load(p) {
  await page.locator("#open-import").click();
  await page.locator("#import-format").selectOption("json");
  await page.locator("#import-text").fill(JSON.stringify(p));
  await page.locator("#apply-import").click();
  assert.equal(await page.locator("#import-dialog").isVisible(), false);
}
const tab = async (name) => page.locator("#tab-" + name).click();
try {
  await scenario("JA/EN, keyboard skip link and roving tabs", async () => {
    await page.goto(base);
    assert.equal(await page.locator("html").getAttribute("lang"), "ja");
    await page.keyboard.press("Tab");
    assert.equal(
      await page.locator(".skip").evaluate((e) => e === document.activeElement),
      true,
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#main").evaluate((e) => e === document.activeElement),
      true,
    );
    await page.locator("#language").selectOption("en");
    assert.ok(
      (await page.locator("h1").textContent()).includes(
        "contract you can test",
      ),
    );
    await page.locator("#tab-map").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#tab-cases").getAttribute("aria-selected"),
      "true",
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.locator("#tab-review").getAttribute("aria-selected"),
      "true",
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.locator("#tab-map").getAttribute("aria-selected"),
      "true",
    );
  });
  await scenario(
    "Reference fixture shows five passing assertions and one alias",
    async () => {
      assert.deepEqual(
        await page.locator("#summary .metric strong").allTextContents(),
        ["5", "5", "0", "1"],
      );
      assert.ok(
        (await page.locator("#overlaps").textContent()).includes("PDU 3"),
      );
      await page.screenshot({
        path: `${dir}/desktop-map-en.png`,
        fullPage: true,
      });
      await page.locator("#language").selectOption("ja");
      await page.screenshot({
        path: `${dir}/desktop-map-ja.png`,
        fullPage: true,
      });
      await page.locator("#language").selectOption("en");
    },
  );
  await scenario(
    "Map drift preserves raw words and independent expectations; Undo restores",
    async () => {
      const before = JSON.parse((await download("#save-project")).text);
      await page.locator("#field-form [name=address]").fill("40002");
      await page.locator("#field-form button[type=submit]").click();
      const after = JSON.parse((await download("#save-project")).text);
      assert.deepEqual(after.cases, before.cases);
      assert.equal(after.fields[0].address, 40002);
      await tab("cases");
      assert.equal(
        await page
          .locator(".assertion[data-field=temperature] .badge")
          .textContent(),
        "MISMATCH",
      );
      assert.equal(
        await page.locator("[data-expected=temperature]").inputValue(),
        "-2.5",
      );
      await page.locator("#undo").click();
      assert.equal(
        await page
          .locator(".assertion[data-field=temperature] .badge")
          .textContent(),
        "PASS",
      );
    },
  );
  await scenario(
    "Draft edits block export and navigation; cancellation and locale remain consistent",
    async () => {
      await tab("map");
      await page.locator("#field-form [name=label]").fill("Unapplied label");
      await page.locator("#save-project").click();
      assert.ok(
        (await page.locator("#status").textContent()).includes(
          "Unapplied edits",
        ),
      );
      await page.locator("#tab-cases").click();
      assert.equal(await page.locator("#panel-map").isVisible(), true);
      await page.locator("#language").selectOption("ja");
      assert.equal(await page.locator("#language").inputValue(), "en");
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      await page.locator("#cancel-field").click();
      assert.equal(
        await page.locator("#field-form [name=label]").inputValue(),
        "Return temperature",
      );
    },
  );
  await scenario(
    "Invalid map commit is atomic and byte order switches intentionally",
    async () => {
      await page.locator("#field-form [name=address]").fill("65536");
      await page.locator("#field-form button[type=submit]").click();
      assert.ok(
        (await page.locator("#status").textContent()).includes("No change"),
      );
      await page.locator("#cancel-field").click();
      await page.locator("#map-rows button[data-id=flow]").click();
      await page.locator("#field-form [name=order]").selectOption("CDAB");
      assert.equal(
        await page
          .locator("#byte-diagram b")
          .allTextContents()
          .then((x) => x.join("")),
        "CDAB",
      );
      await page.locator("#field-form button[type=submit]").click();
      await tab("cases");
      assert.equal(
        await page.locator(".assertion[data-field=flow] .badge").textContent(),
        "MISMATCH",
      );
      await page.locator("#undo").click();
    },
  );
  await scenario(
    "Expected values are entered and saved independently, blank is unasserted",
    async () => {
      await tab("cases");
      await page.locator("[data-expected=temperature]").fill("-3");
      await page.locator(".assertion[data-field=temperature] button").click();
      assert.equal(
        await page
          .locator(".assertion[data-field=temperature] .badge")
          .textContent(),
        "MISMATCH",
      );
      await page.locator("[data-expected=temperature]").fill("");
      await page.locator(".assertion[data-field=temperature] button").click();
      assert.equal(
        await page
          .locator(".assertion[data-field=temperature] .badge")
          .textContent(),
        "UNASSERTED",
      );
      await page.locator("#load-example").click();
    },
  );
  await scenario(
    "Snapshot missing words differ from zero; cancellation keeps saved assertions",
    async () => {
      await tab("cases");
      await page.locator("#snapshot-words").fill("0000");
      await page.locator("#case-form button[type=submit]").click();
      assert.equal(
        await page
          .locator(".assertion[data-field=temperature] .badge")
          .textContent(),
        "MISMATCH",
      );
      assert.equal(
        await page.locator(".assertion[data-field=flow] .badge").textContent(),
        "MISSING WORDS",
      );
      await page.locator("#snapshot-words").fill("FFFF");
      await page.locator("[data-expected=temperature]").fill("99");
      await page.locator("#assertion-rows > button").click();
      assert.equal(await page.locator("#snapshot-words").inputValue(), "FFFF");
      assert.equal(
        await page.locator("[data-expected=temperature]").inputValue(),
        "-2.5",
      );
      await page.locator("#cancel-case").click();
      assert.equal(await page.locator("#snapshot-words").inputValue(), "0000");
      await page.locator("#load-example").click();
    },
  );
  await scenario(
    "JSON import errors and hostile labels cannot mutate DOM or current project",
    async () => {
      const before = (await download("#save-project")).text;
      await page.locator("#open-import").click();
      await page.locator("#import-text").fill('{"x":1,"x":2}');
      await page.locator("#apply-import").click();
      assert.ok(
        (await page.locator("#import-error").textContent()).includes(
          "Duplicate JSON key",
        ),
      );
      await page.locator("#cancel-import").click();
      assert.equal((await download("#save-project")).text, before);
      let p = example();
      p.name = "<img src=x onerror=alert(1)>";
      p.fields[0].label = '=HYPERLINK("https://hostile")';
      p.fields[0].note = "</script><svg onload=alert(1)>";
      await load(p);
      assert.equal(await page.locator("#project-title img").count(), 0);
      assert.equal(await page.locator("script:not([src])").count(), 0);
      assert.deepEqual(JSON.parse((await download("#save-project")).text), p);
      await tab("review");
      let csv = (await download("#export-map")).text;
      assert.ok(csv.includes("'=HYPERLINK"));
      let html = (await download("#export-report")).text;
      assert.ok(!html.includes("<img src=x"));
      assert.ok(html.includes("&lt;img"));
      await page.locator("#load-example").click();
    },
  );
  await scenario(
    "CSV map import retains expectations and validates normalized PDU columns",
    async () => {
      let p = example(),
        csv = mapCSV(p);
      await page.locator("#open-import").click();
      await page.locator("#import-format").selectOption("csv");
      await page
        .locator("#import-text")
        .fill(csv.replace('"40001"', '"40002"'));
      await page.locator("#apply-import").click();
      assert.ok(
        (await page.locator("#import-error").textContent()).includes(
          "normalized PDU",
        ),
      );
      await page.locator("#import-text").fill(csv);
      await page.locator("#apply-import").click();
      assert.deepEqual(
        JSON.parse((await download("#save-project")).text).cases,
        p.cases,
      );
    },
  );
  await scenario(
    "Cancelled and superseded file reads never overwrite newer work",
    async () => {
      await page.locator("#open-import").click();
      await page.locator("#import-format").selectOption("json");
      await page.locator("#import-file").setInputFiles({
        name: "large.json",
        mimeType: "application/json",
        buffer: Buffer.alloc(2097153, 32),
      });
      assert.ok(
        (await page.locator("#import-error").textContent()).includes("2 MiB"),
      );
      const corrupt = Buffer.from(JSON.stringify(example()));
      corrupt[corrupt.indexOf(Buffer.from(example().name))] = 0xff;
      await page
        .locator("#import-file")
        .setInputFiles({
          name: "bad-utf8.json",
          mimeType: "application/json",
          buffer: corrupt,
        });
      await page
        .locator("#import-error")
        .filter({ hasText: "Invalid UTF-8" })
        .waitFor();
      assert.equal(
        await page.locator("#project-title").textContent(),
        example().name,
      );
      await page.evaluate(() => {
        const original = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function () {
          await new Promise((r) => setTimeout(r, 350));
          return original.call(this);
        };
      });
      let p = example();
      p.name = "Stale import";
      await page.locator("#import-file").setInputFiles({
        name: "stale.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(p)),
      });
      await page.locator("#cancel-import").click();
      await page.locator("#load-drift").click();
      await page.waitForTimeout(550);
      assert.ok(
        (await page.locator("#project-title").textContent()).includes(
          "intentional address regression",
        ),
      );
      await page.locator("#open-import").click();
      await page.locator("#import-file").setInputFiles({
        name: "stale.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(p)),
      });
      await page.locator("#import-text").fill(JSON.stringify(example()));
      await page.waitForTimeout(500);
      assert.equal(await page.locator("#import-dialog").isVisible(), true);
      await page.locator("#apply-import").click();
      assert.equal(
        await page.locator("#project-title").textContent(),
        example().name,
      );
    },
  );
  await scenario(
    "Download failure remains visible and repeated export is deterministic",
    async () => {
      await page.evaluate(() => {
        window.originalCreate = URL.createObjectURL;
        URL.createObjectURL = () => {
          throw Error("forced");
        };
      });
      await page.locator("#save-project").click();
      assert.ok(
        (await page.locator("#status").textContent()).includes(
          "download could not be created",
        ),
      );
      await page.evaluate(() => (URL.createObjectURL = window.originalCreate));
      assert.equal(
        (await download("#save-project")).text,
        (await download("#save-project")).text,
      );
    },
  );
  await scenario(
    "Downloaded standalone Python executes pass and fail fixture",
    async () => {
      await tab("review");
      const verifier = await download("#export-python"),
        fixture = await download("#export-fixture");
      assert.equal(verifier.text, await readFile("python/verify.py", "utf8"));
      await writeFile(`${dir}/verify.py`, verifier.text);
      await writeFile(`${dir}/regdeck-project.json`, fixture.text);
      let run = spawnSync(
        "python3",
        [`${dir}/verify.py`, `${dir}/regdeck-project.json`],
        { encoding: "utf8" },
      );
      assert.equal(run.status, 0, run.stdout + run.stderr);
      let p = JSON.parse(fixture.text);
      p.fields[0].address++;
      await writeFile(`${dir}/regdeck-failing.json`, JSON.stringify(p));
      run = spawnSync(
        "python3",
        [`${dir}/verify.py`, `${dir}/regdeck-failing.json`],
        { encoding: "utf8" },
      );
      assert.equal(run.status, 1, run.stdout + run.stderr);
    },
  );
  await scenario(
    "Offline loaded workflow, mobile layout and long content stay bounded",
    async () => {
      await context.setOffline(true);
      await page.locator("#load-drift").click();
      assert.equal(
        await page
          .locator(".assertion[data-field=temperature] .badge")
          .textContent(),
        "MISMATCH",
      );
      await page.locator("#load-example").click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#language").selectOption("ja");
      await tab("map");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: `${dir}/mobile-map-ja.png`,
        fullPage: true,
      });
      await tab("cases");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: `${dir}/mobile-cases-ja.png`,
        fullPage: true,
      });
      await tab("review");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: `${dir}/mobile-review-ja.png`,
        fullPage: true,
      });
      await context.setOffline(false);
    },
  );
  await scenario(
    "Print and reload clearly reset the session-only workspace",
    async () => {
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.locator("#language").selectOption("en");
      await page.screenshot({
        path: `${dir}/desktop-review-en.png`,
        fullPage: true,
      });
      await page.emulateMedia({ media: "print" });
      await page.pdf({
        path: `${dir}/print-review.pdf`,
        format: "A4",
        printBackground: true,
      });
      await page.emulateMedia({ media: "screen" });
      await page.locator("#load-drift").click();
      await page.reload();
      assert.equal(
        await page.locator("#project-title").textContent(),
        example().name,
      );
      assert.deepEqual(
        await page.locator("#summary .metric strong").allTextContents(),
        ["5", "5", "0", "1"],
      );
    },
  );
  await scenario(
    "No external runtime requests or browser exceptions",
    async () => {
      assert.deepEqual(errors, []);
      assert.ok(
        requests.every(
          (url) => url.startsWith(base) || url.startsWith("blob:"),
        ),
        JSON.stringify(requests),
      );
    },
  );
} finally {
  await writeFile(
    `${dir}/results.json`,
    JSON.stringify(
      {
        status: results.some((r) => r.status === "failed")
          ? "failed"
          : "passed",
        sandbox: true,
        results,
        errors,
        requests,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
