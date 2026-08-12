/**
 * 手動驗收清單的瀏覽器版本。
 *
 * `todo.md` 文末那份 checklist 一直只能靠人手動點，這支腳本把其中
 * **不需要人眼判斷手感**的項目自動化：放色 / 選取 / 剪下 / 刪除 /
 * undo-redo / 快捷鍵 / 重新整理後的持久化 / Output 觸發上傳。
 *
 * ## 為什麼要有這個（元件測試不是已經很多了嗎）
 *
 * jsdom 測不到真實瀏覽器的鍵盤事件序列。實測抓到的第一個 bug 就是這類：
 * 按 Ctrl+3 會先送一個 `Control` keydown，它會吃掉快捷鍵的防彈跳名額，
 * 導致緊接著的 `3` 被丟棄——**所有 Ctrl+數字與 Shift+數字在瀏覽器上完全
 * 按不動**，但 jsdom 測試全綠（因為測試直接送最終那一下按鍵）。
 *
 * ## 執行
 *
 * ```bash
 * npm run dev          # 另一個終端機
 * npm run e2e
 * ```
 *
 * 後端不需要跑：所有 /api/** 都被攔截回假資料，音檔用臨時產生的 30 秒 WAV。
 * 因此「真的寫進 mongo」那一段測不到，其餘前端行為都會走過一次。
 * 截圖放在 `e2e/shots/`。
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "shots");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

mkdirSync(OUT, { recursive: true });

/** 產生一段可辨識的 30 秒 WAV，讓 waveform decode 得出 duration */
const makeWav = (seconds = 30, sampleRate = 8000) => {
  const n = sampleRate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(
      Math.round(8000 * Math.sin(i / 20) * Math.sin(i / 9000)),
      44 + i * 2,
    );
  }
  return buf;
};

const WAV = makeWav();
const results = [];
let shotIndex = 0;

const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`,
  );
};

const shot = async (page, label) => {
  await page.screenshot({
    path: join(OUT, `${String(++shotIndex).padStart(2, "0")}-${label}.png`),
  });
};

/** 第 track 條時間軸上的所有 block（含空隙） */
const blocksOf = (page, track = 0) =>
  page.evaluate((t) => {
    const groups = new Map();
    for (const el of document.querySelectorAll(".timeline-block")) {
      const parent = el.parentElement;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    }
    const els = [...groups.values()][t] ?? [];
    return els.map((el) => ({
      background: el.style.background || el.style.backgroundColor,
      width: el.style.width,
      selected: /solid/.test(el.style.border || ""),
    }));
  }, track);

/** 空隙在畫面上是純黑（segment 模型：沒有段就是沒有光） */
const isGap = (bg) => !bg || /rgba?\(\s*0,\s*0,\s*0/.test(bg);

const coloredBlocks = async (page, track = 0) =>
  (await blocksOf(page, track)).filter((b) => !isGap(b.background));

const findBlockIndex = (page, wantGap) =>
  page.evaluate((gap) => {
    const els = [...document.querySelectorAll(".timeline-block")];
    return els.findIndex((el) => {
      const bg = el.style.background || el.style.backgroundColor;
      const black = !bg || /rgba?\(\s*0,\s*0,\s*0/.test(bg);
      return gap ? black : !black;
    });
  }, wantGap);

const stubApi = (context) =>
  context.route("**/api/**", (route) => {
    const url = route.request().url();
    const json = (body) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.includes("/api/token")) return json({ access_token: "tester" });
    if (url.includes("/api/users/me"))
      return json({ username: "tester", disabled: false });
    if (url.includes("/api/get_music_list"))
      return json({ list: ["test.wav"] });
    if (url.includes("/api/get_music/"))
      return route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: WAV,
      });
    if (url.includes("/api/timelist")) return json({ list: [] });
    if (url.includes("/api/raw/")) return json({ message: "not found" });
    if (url.includes("/api/upload")) return json({ status: "ok" });
    return json({});
  });

const clickArmorPart = (page, armor, part) =>
  page
    .locator(".personBackGround")
    .nth(armor)
    .locator("svg [fill]:not([fill='none'])")
    .nth(part)
    .click({ force: true });

/**
 * 開啟編輯器，必要時重試。
 *
 * /home 掛載時會檢查 redux 裡的 token，但 redux-persist 的 rehydrate 是
 * 非同步的——整頁載入後若 rehydrate 還沒完成會被判定成未登入而彈回 "/"。
 * 這是 app 既有的競態，這裡用重試繞過（不是這支腳本要驗的東西）。
 */
const openEditor = async (page, attempts = 4) => {
  for (let i = 0; i < attempts; i++) {
    await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
    try {
      await page.waitForSelector(".timeline-container", { timeout: 12000 });
      await page.waitForTimeout(3000); // 等音檔 decode 出 duration
      return true;
    } catch {
      /* 被彈回 "/"，再試一次 */
    }
  }
  return false;
};

const run = async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 950 },
  });
  await stubApi(context);
  const page = await context.newPage();

  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on("dialog", (d) => d.accept());

  const uploads = [];
  page.on(
    "request",
    (r) => r.url().includes("/api/upload") && uploads.push(r.url()),
  );

  // ── 登入 ──────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="text"]', "tester");
  await page.fill('input[type="password"]', "pw");
  await page.click("text=登入");
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  record("登入", true);

  const opened = await openEditor(page);
  record("進入編輯器", opened);
  if (!opened) throw new Error("編輯器一直載入不了");

  const header = await page.locator(".controls").first().innerText();
  record("音檔載入出 duration", /0:30|0:29/.test(header));
  await shot(page, "editor-loaded");

  // 換一個亮色，截圖才看得出東西（預設 chosenColor 是接近全黑的 rgb(5,5,5)）
  await page.evaluate(() => {
    const well = document.querySelector("#colorWell");
    if (!well) return;
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(well, "#ff3b30");
    well.dispatchEvent(new Event("input", { bubbles: true }));
    well.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(500);

  // ── 放色 ──────────────────────────────────────────────
  const before = (await coloredBlocks(page, 0)).length;
  await clickArmorPart(page, 0, 0);
  await page.waitForTimeout(500);
  const after = await coloredBlocks(page, 0);
  record(
    "點光衣放色 → 時間軸出現色塊",
    after.length === before + 1,
    `${before} → ${after.length} 塊`,
  );

  // 預設 1 秒 / 30 秒總長 ≈ 3.33%
  const widthPct = parseFloat(after[0]?.width ?? "0");
  record(
    "新色塊是預設 1 秒（Phase 5 語意）",
    Math.abs(widthPct - 100 / 30) < 0.6,
    `寬度 ${after[0]?.width}`,
  );
  await shot(page, "place-color");

  const blockEls = page.locator(".timeline-block");

  // ── 選取 ──────────────────────────────────────────────
  await blockEls.nth(await findBlockIndex(page, false)).click({ force: true });
  await page.waitForTimeout(300);
  const selected = (await blocksOf(page, 0)).filter((b) => b.selected).length;
  record("點色塊 → 出現選取框", selected === 1, `${selected} 塊被選`);
  await shot(page, "select-block");

  // ── 亮度快捷鍵（就是這條抓到 modifier 吃掉防彈跳的 bug）──
  await page.keyboard.press("Control+3");
  await page.waitForTimeout(600);
  const dimmed = await coloredBlocks(page, 0);
  record(
    "Ctrl+3 設透明度 30%",
    /0\.3/.test(dimmed[0]?.background ?? ""),
    dimmed[0]?.background,
  );
  await shot(page, "brightness");

  // ── 剪下 ──────────────────────────────────────────────
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const beforeCut = (await coloredBlocks(page, 0)).length;
  await page.keyboard.press("c");
  await page.waitForTimeout(500);
  const afterCut = (await coloredBlocks(page, 0)).length;
  record(
    "C 鍵剪下 → 一塊變兩塊",
    afterCut === beforeCut + 1,
    `${beforeCut} → ${afterCut}`,
  );
  await shot(page, "cut");

  // ── Undo / Redo ───────────────────────────────────────
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(500);
  record(
    "Ctrl+Z 復原剪下",
    (await coloredBlocks(page, 0)).length === beforeCut,
  );

  await page.keyboard.press("Control+y");
  await page.waitForTimeout(500);
  record("Ctrl+Y 重做", (await coloredBlocks(page, 0)).length === afterCut);
  await shot(page, "undo-redo");

  // ── 刪除 ──────────────────────────────────────────────
  await blockEls.nth(await findBlockIndex(page, false)).click({ force: true });
  await page.waitForTimeout(300);
  const beforeDel = (await coloredBlocks(page, 0)).length;
  await page.click(".delete-button", { force: true });
  await page.waitForTimeout(500);
  const afterDel = (await coloredBlocks(page, 0)).length;
  record(
    "刪除鍵移除色塊",
    afterDel === beforeDel - 1,
    `${beforeDel} → ${afterDel}`,
  );
  await shot(page, "delete");

  // ── 點空隙取消選取（segment 模型的新語意）──────────────
  await blockEls.nth(await findBlockIndex(page, false)).click({ force: true });
  await page.waitForTimeout(200);
  await blockEls.nth(await findBlockIndex(page, true)).click({ force: true });
  await page.waitForTimeout(300);
  record(
    "點空隙 → 取消選取",
    (await blocksOf(page, 0)).filter((b) => b.selected).length === 0,
  );

  // ── Effect 選單 ───────────────────────────────────────
  const effectBtn = page.locator("button.effect-button");
  if (await effectBtn.count()) {
    // 用 DOM click：按鈕被上層 SVG 蓋住，座標點擊會打到別人
    await effectBtn.first().evaluate((el) => el.click());
    await page.waitForTimeout(400);
    const options = await page.locator(".effect-menu-item").count();
    record("Effect 選單展開", options >= 3, `${options} 個選項`);
    await shot(page, "effect-menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // ── 重新整理後 persist 復原（風險最高的一項）────────────
  const beforeReload = await coloredBlocks(page, 0);
  await page.waitForTimeout(3000); // redux-persist 有 2 秒 debounce
  await openEditor(page);
  const afterReload = await coloredBlocks(page, 0);
  record(
    "重新整理後光表復原（serialize:false 路徑）",
    afterReload.length === beforeReload.length && afterReload.length > 0,
    `${beforeReload.length} → ${afterReload.length} 塊`,
  );
  await shot(page, "after-reload");

  // ── Output ────────────────────────────────────────────
  const outputBtn = page.locator("button.output-button");
  if (await outputBtn.count()) {
    await outputBtn.first().evaluate((el) => el.click());
    await page.waitForTimeout(2000);
    record("Output 觸發上傳", uploads.length > 0, `${uploads.length} 次請求`);
    await shot(page, "output");
  }

  writeFileSync(join(OUT, "console-errors.txt"), errors.join("\n") || "(無)");
  const unexpected = errors.filter(
    // Dashboard 那則是導航中斷造成的，音訊相關的是 headless 環境限制
    (e) =>
      !/音樂|Failed to load resource|autoplay|AudioContext|Fetch initial data/.test(
        e,
      ),
  );
  record(
    "沒有未預期的 console 錯誤",
    unexpected.length === 0,
    `${errors.length} 則`,
  );

  await browser.close();
  return results;
};

run()
  .then((r) => {
    const failed = r.filter((x) => !x.ok);
    console.log(`\n=== ${r.length - failed.length}/${r.length} 通過 ===`);
    if (failed.length)
      console.log("失敗：", failed.map((f) => f.name).join(" / "));
    process.exit(failed.length ? 1 : 0);
  })
  .catch((err) => {
    console.error("HARNESS ERROR:", err);
    process.exit(2);
  });
