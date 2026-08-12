/**
 * 版面稽核：找出「點不到的控制項」與「溢出容器的元素」。
 *
 * 不靠肉眼看截圖，直接問瀏覽器兩個問題：
 *
 *   1. 每個可互動元素的中心點，`document.elementFromPoint()` 回傳的是不是它自己？
 *      不是 → 被別的東西蓋住了，使用者點不到。
 *   2. 每個元素的 bounding box 有沒有超出容器？超出 → 跑到別人的地盤上。
 *
 * ## 為什麼需要這個
 *
 * 這個編輯器的版面大量使用 `position: absolute` + 寫死的像素座標
 * （`left: 370px` / `left: 584px` / `bottom: 20px`…）。那些數字是照著某一個
 * 視窗尺寸量出來的，換一個尺寸就開始互相重疊，而且**畫面上看起來還好好的**
 * ——被蓋住的按鈕仍然畫得出來，只是點下去沒反應。
 *
 * 第一次跑就抓到 9 處：Edit / Logout 被「尚未儲存」橫幅整個蓋住、音樂選單
 * 被擠到畫面外 x=-16 蓋住左側工具列、舞者開關浮在光衣上蓋掉 12 個部位…
 *
 * ## 執行
 *
 * ```bash
 * npm run dev              # 另一個終端機
 * npm run audit:layout
 * ```
 *
 * 兩種視窗尺寸各跑一次。有任何一項不通過就 exit 1。
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { launchOptions, warmUp } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "shots");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

/** 產生一段 30 秒 WAV，讓 waveform decode 得出 duration */
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
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(8000 * Math.sin(i / 20)), 44 + i * 2);
  return buf;
};
const WAV = makeWav();

const VIEWPORTS = [
  { name: "1600x950", width: 1600, height: 950 },
  { name: "1280x800", width: 1280, height: 800 },
];

/** 頁面內執行：回傳被蓋住的控制項與溢出容器的元素 */
const collectProblems = () => {
  const label = (el) => {
    if (!el) return "null";
    const cls = el.getAttribute?.("class");
    const id = el.id ? `#${el.id}` : "";
    const text = (el.textContent || "").trim().slice(0, 18);
    return `${el.tagName.toLowerCase()}${id}${cls ? "." + cls.split(" ")[0] : ""}${
      text ? `「${text}」` : ""
    }`;
  };

  /** 落在可捲動祖先的可視範圍外 → 捲一下就到得了，不算被蓋住 */
  const isScrolledOut = (el, rect) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) {
        const pr = p.getBoundingClientRect();
        return rect.bottom > pr.bottom + 1 || rect.top < pr.top - 1;
      }
    }
    return false;
  };

  // ── 1. 點不到的控制項 ──────────────────────────────
  const SELECTOR = [
    "button",
    "select",
    "input",
    "[role=button]",
    ".timeline-block",
    ".sidebar-dot",
    ".favorite_color_sample",
    // 光衣的部位也是可點的——放色就是點它們
    ".armor-container svg [fill]:not([fill='none'])",
  ].join(", ");

  const unclickable = [];
  for (const el of document.querySelectorAll(SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (parseFloat(cs.opacity) === 0) continue;
    if (
      r.bottom < 0 ||
      r.top > innerHeight ||
      r.right < 0 ||
      r.left > innerWidth
    )
      continue;
    if (isScrolledOut(el, r)) continue;

    const top = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    if (top && top !== el && !el.contains(top) && !top.contains(el)) {
      unclickable.push({ el: label(el), blocker: label(top) });
    }
  }

  // ── 2. 溢出容器 ────────────────────────────────────
  const CONTAINERS = [
    ".panel",
    ".people-container",
    ".control-panel",
    ".audio-player-container",
    ".palette",
  ];
  const overflow = [];
  for (const sel of CONTAINERS) {
    const box = document.querySelector(sel);
    if (!box) continue;
    if (getComputedStyle(box).overflow !== "visible") continue; // 有裁切就不會漏出去

    const br = box.getBoundingClientRect();
    for (const child of box.querySelectorAll("*")) {
      const cr = child.getBoundingClientRect();
      if (cr.width < 2 || cr.height < 2) continue;
      if (child.classList?.contains("tooltip")) continue; // hover 才顯示，溢出正常

      // 在可捲動容器裡的內容，超出是設計上的
      let inScroller = false;
      for (
        let p = child.parentElement;
        p && p !== box.parentElement;
        p = p.parentElement
      ) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) {
          inScroller = true;
          break;
        }
      }
      if (inScroller) continue;

      const over = {
        top: Math.round(br.top - cr.top),
        bottom: Math.round(cr.bottom - br.bottom),
        left: Math.round(br.left - cr.left),
        right: Math.round(cr.right - br.right),
      };
      if (Math.max(...Object.values(over)) > 2) {
        overflow.push({ container: sel, child: label(child), over });
      }
    }
  }

  return { unclickable, overflow };
};

const stubApi = (context) =>
  context.route("**/api/**", (route) => {
    const url = route.request().url();
    const json = (b) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(b),
      });
    if (url.includes("/api/token")) return json({ access_token: "tester" });
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
    return json({});
  });

const run = async () => {
  // 先暖機：開發伺服器剛啟動時第一次載入 /home 要現場轉譯幾百個模組，
  // 會超過下面等待選擇器的時限。用獨立 browser 跑，不留任何狀態。
  {
    const warmBrowser = await chromium.launch(launchOptions());
    await warmUp(warmBrowser, BASE);
    await warmBrowser.close();
  }

  let failed = 0;

  // 每個視窗尺寸開一個全新的 browser。共用同一個 browser 時第二個 context
  // 會載入不了——兩個 context 各自解碼 30 秒 WAV、各開一個 AudioContext，
  // 在容器的記憶體限制下第二個就卡住。這跟版面無關，純粹是量測環境的問題。
  for (const vp of VIEWPORTS) {
    const browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    await stubApi(context);
    const page = await context.newPage();

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="text"]', "tester");
    await page.fill('input[type="password"]', "pw");
    await page.click("text=登入");
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    let opened = false;
    for (let i = 0; i < 6 && !opened; i++) {
      await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
      try {
        await page.waitForSelector(".timeline-container", { timeout: 25000 });
        opened = true;
      } catch {
        /* 再試一次 */
      }
    }
    if (!opened) {
      console.log(`[${vp.name}] 編輯器載入不了`);
      failed++;
      await browser.close();
      continue;
    }
    await page.waitForTimeout(2500);

    const { unclickable, overflow } = await page.evaluate(collectProblems);

    console.log(`\n===== ${vp.name} =====`);
    console.log(`點不到的控制項：${unclickable.length}`);
    unclickable.forEach((u) =>
      console.log(`  ✗ ${u.el}\n      ← 被 ${u.blocker} 蓋住`),
    );
    console.log(`溢出容器的元素：${overflow.length}`);
    overflow
      .slice(0, 8)
      .forEach((o) =>
        console.log(
          `  ✗ ${o.container} 內 ${o.child} 溢出 ${JSON.stringify(o.over)}`,
        ),
      );

    failed += unclickable.length + overflow.length;

    await page.screenshot({ path: join(OUT, `layout-${vp.name}.png`) });
    await browser.close();
  }

  return failed;
};

run()
  .then((failed) => {
    console.log(
      failed === 0 ? "\n=== 版面稽核通過 ===" : `\n=== 共 ${failed} 個問題 ===`,
    );
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("AUDIT ERROR:", err);
    process.exit(2);
  });
