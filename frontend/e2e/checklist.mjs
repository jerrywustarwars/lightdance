/**
 * 手動驗收清單的瀏覽器版本。
 *
 * `todo.md` 文末那份 checklist 一直只能靠人手動點，這支腳本把其中
 * **不需要人眼判斷手感**的項目自動化：放色 / 選取 / 剪下 / 刪除 /
 * undo-redo / 快捷鍵 / 重新整理後的持久化 / 刻度尺跳時間 / Output 觸發上傳。
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
import { launchOptions, warmUp } from "./browser.mjs";

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
      // 選取框改成白色雙層 ring（box-shadow），不再是 border——
      // 舊版靠顏色分三種狀態，撞到同色系的色塊時會整個消失
      selected: /inset|0 0 0/.test(el.style.boxShadow || ""),
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
    .click();

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
      return i + 1; // 試了幾次才成功
    } catch {
      /* 被彈回 "/"，再試一次 */
    }
  }
  return 0;
};

const run = async () => {
  // 先暖機：開發伺服器剛啟動時第一次載入 /home 要現場轉譯幾百個模組，
  // 會超過 openEditor 等待選擇器的時限。用獨立 browser 跑完就關掉——
  // 同一個 browser 裡開第二個 context 會載入不了（各自解碼 30 秒 WAV、
  // 各開一個 AudioContext，容器的記憶體吃不消）。
  {
    const warmBrowser = await chromium.launch(launchOptions());
    await warmUp(warmBrowser, BASE);
    await warmBrowser.close();
  }

  const browser = await chromium.launch(launchOptions());
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

  // /home 掛載時會檢查 redux 裡的 token，而 redux-persist 的寫入是非同步的。
  // 程式裡用 flushPersist() 把窗口縮到很小，但沒有完全消除，所以先讓它落地。
  // （版面稽核也是這樣處理的。）
  await page.waitForTimeout(2500);

  // 一次就要成功。登入後 token 有沒有立刻落地就看這條——persist 有 2 秒
  // debounce，沒有 flushPersist() 的話整頁載入 /home 會讀不到 token 而彈回首頁。
  const tries = await openEditor(page);
  record(
    "登入後直接開 /home 一次就進得去",
    tries === 1,
    tries === 0 ? "一直被彈回首頁" : `試了 ${tries} 次`,
  );
  if (!tries) throw new Error("編輯器一直載入不了");

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
  await blockEls.nth(await findBlockIndex(page, false)).click();
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
  await blockEls.nth(await findBlockIndex(page, false)).click();
  await page.waitForTimeout(300);
  const beforeDel = (await coloredBlocks(page, 0)).length;
  await page.click(".delete-button");
  await page.waitForTimeout(500);
  const afterDel = (await coloredBlocks(page, 0)).length;
  record(
    "刪除鍵移除色塊",
    afterDel === beforeDel - 1,
    `${beforeDel} → ${afterDel}`,
  );
  await shot(page, "delete");

  // ── 點空隙取消選取（segment 模型的新語意）──────────────
  await blockEls.nth(await findBlockIndex(page, false)).click();
  await page.waitForTimeout(200);
  await blockEls.nth(await findBlockIndex(page, true)).click();
  await page.waitForTimeout(300);
  record(
    "點空隙 → 取消選取",
    (await blocksOf(page, 0)).filter((b) => b.selected).length === 0,
  );

  // ── Effect 選單 ───────────────────────────────────────
  const effectBtn = page.locator("button.effect-button");
  if (await effectBtn.count()) {
    await effectBtn.first().click();
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
  const reloadTries = await openEditor(page);
  record("重新整理後仍在編輯器裡（沒被彈回首頁）", reloadTries === 1);
  const afterReload = await coloredBlocks(page, 0);
  record(
    "重新整理後光表復原（serialize:false 路徑）",
    afterReload.length === beforeReload.length && afterReload.length > 0,
    `${beforeReload.length} → ${afterReload.length} 塊`,
  );
  await shot(page, "after-reload");

  // ── 拖曳邊緣調整長度 ──────────────────────────────────
  //
  // 這條路徑 jsdom 測不到（沒有版面，getBoundingClientRect 全回 0），
  // 而它同時牽涉像素換算、邊界夾緊與網格對齊——只有真瀏覽器驗得了。
  const coloredBlockHandle = await page.evaluateHandle(() => {
    return [...document.querySelectorAll(".timeline-block")].find((el) =>
      /rgba?\((?!\s*0,\s*0,\s*0)/.test(el.style.background || ""),
    );
  });
  const beforeResize = await coloredBlockHandle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  if (beforeResize && beforeResize.w > 4) {
    // 邊緣偵測只對**已選取**的色塊生效（handleBlockMouseMove 的守衛），
    // 所以要先點一下讓它進入選取狀態，否則 hoverEdge 永遠是 null。
    await page.mouse.click(
      beforeResize.x + beforeResize.w / 2,
      beforeResize.y + beforeResize.h / 2,
    );
    await page.waitForTimeout(300);

    // 再把游標移到右緣（8px 內）讓 hoverEdge 亮起來，然後按住往右拖
    const edgeX = beforeResize.x + beforeResize.w - 3;
    const midY = beforeResize.y + beforeResize.h / 2;
    await page.mouse.move(edgeX, midY);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.mouse.move(edgeX + 120, midY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const afterResize = await coloredBlockHandle.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    record(
      "拖曳右緣可以把色塊拉長",
      afterResize > beforeResize.w + 20,
      `${Math.round(beforeResize.w)}px → ${Math.round(afterResize)}px`,
    );
  } else {
    record("拖曳右緣可以把色塊拉長", false, "找不到有色色塊");
  }

  // ── 刻度尺跳時間 ──────────────────────────────────────
  //
  // 播放中的那一項特別容易壞：停掉音源之後，waveform 有兩處「把播放位置寫回
  // Redux」的邏輯會蓋掉剛指定的時間，看起來就像「點了沒反應」。
  const readTimeMs = () =>
    page.evaluate(() => {
      const txt = document.querySelector(".controls").textContent.replace(/\s+/g, " ");
      const m = txt.match(/(\d+):(\d\d):(\d\d\d)\s*\/\s*\d+:\d\d:\d\d\d/);
      return m ? (+m[1] * 60 + +m[2]) * 1000 + +m[3] : null;
    });

  const clickRulerAt = async (fraction) => {
    const box = await page.locator(".time-ruler").boundingBox();
    await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
    await page.waitForTimeout(700);
  };

  const rulerBox = await page.locator(".time-ruler").boundingBox();
  if (rulerBox) {
    await clickRulerAt(0.5);
    const pausedSeek = await readTimeMs();
    record(
      "暫停中點刻度尺會跳時間",
      Math.abs(pausedSeek - 15000) <= 100,
      `${pausedSeek}ms（期望 15000）`,
    );

    await page.locator(".play-button").click();
    await page.waitForTimeout(1200);
    await clickRulerAt(0.75);
    const playingSeek = await readTimeMs();
    record(
      "播放中點刻度尺也會跳時間",
      Math.abs(playingSeek - 22500) <= 100,
      `${playingSeek}ms（期望 22500）`,
    );
  } else {
    record("刻度尺存在", false, "找不到 .time-ruler");
  }

  // ── Move Mode：多個色塊一起搬 ──────────────────────────
  //
  // 這一項要同時對三件事：拖曳過程的像素邊界、放開後 moveSegments 算出來的
  // 落點、以及「整批共用同一個位移量」。相對位置只要差一格，樂句的節奏就變了。
  // jsdom 連色塊有多寬都不知道，只有真瀏覽器驗得到。
  const litBoxes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".timeline-block")]
        .filter((el) =>
          /rgba?\((?!\s*0,\s*0,\s*0)/.test(el.style.background || ""),
        )
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        })
        .sort((a, b) => a.x - b.x),
    );

  // 再放一個色塊，讓這條時間軸上有兩個可以一起搬的東西
  await clickRulerAt(0.35);
  await clickArmorPart(page, 0, 0);
  await page.waitForTimeout(600);

  const dragBefore = await litBoxes();
  if (dragBefore.length >= 2) {
    const centerOf = (b) => [b.x + b.w / 2, b.y + b.h / 2];

    // 選起兩個色塊：點第一個、Shift 點第二個
    await page.mouse.click(...centerOf(dragBefore[0]));
    await page.waitForTimeout(200);
    await page.keyboard.down("Shift");
    await page.mouse.click(...centerOf(dragBefore[1]));
    await page.keyboard.up("Shift");
    await page.waitForTimeout(300);

    const selected = await page.evaluate(
      () => document.querySelectorAll(".timeline-block[data-selected='true']").length,
    );

    // 進 Move Mode → 點色塊開始追蹤 → 移動滑鼠 → 再點一下提交
    await page.keyboard.press("m");
    await page.waitForTimeout(200);
    const [gx, gy] = centerOf(dragBefore[0]);
    await page.mouse.click(gx, gy);
    await page.waitForTimeout(150);
    await page.mouse.move(gx + 100, gy, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.click(gx + 100, gy);
    await page.waitForTimeout(600);

    const after = await litBoxes();
    const moved = after.length === dragBefore.length;
    const shifts = moved ? after.map((b, i) => b.x - dragBefore[i].x) : [];
    const sameShift =
      shifts.length >= 2 && shifts.every((d) => Math.abs(d - shifts[0]) <= 2);

    record("Shift 多選兩個色塊", selected === 2, `${selected} 塊被選`);
    record(
      "Move Mode 整批一起搬，位移量相同",
      moved && shifts[0] > 20 && sameShift,
      `位移 ${shifts.map(Math.round).join(" / ")} px`,
    );
    await shot(page, "multi-drag");
  } else {
    record("Move Mode 整批一起搬", false, `只有 ${dragBefore.length} 個色塊`);
  }

  // ── 工作集 ────────────────────────────────────────────
  //
  // 切換工作集要真的換掉軌道清單，而且**存得住**——這一項最容易壞的地方是
  // 遷移：舊的 persist 資料裡只有 showPart，載入時要收成「未命名」那一組。
  const trackCount = () =>
    page.evaluate(
      () => document.querySelectorAll(".timeline-settings-block").length,
    );
  const chipNames = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".workset-chip")].map((el) =>
        el.textContent.replace(/\d+$/, "").trim(),
      ),
    );

  const beforeChips = await chipNames();
  record(
    "工作集列出現，舊資料收成一組",
    beforeChips.length >= 1,
    beforeChips.join(" / ") || "沒有任何工作集",
  );

  const tracksBefore = await trackCount();

  // 新增一組（會複製目前這一組），然後從新的那組刪掉一條軌。
  // 命名的 prompt 由檔案開頭的全域 dialog handler 接受（回傳空字串），
  // 所以新組會拿到自動產生的名字——這裡不驗名字，驗的是切換行為。
  await page.click(".workset-bar__action");
  await page.waitForTimeout(500);

  const afterAdd = await chipNames();
  const activeName = await page.evaluate(
    () => document.querySelector(".workset-chip.is-current")?.textContent ?? "",
  );
  record(
    "新增工作集並自動切換過去",
    afterAdd.length === beforeChips.length + 1 &&
      !activeName.includes(beforeChips[0]),
    `${afterAdd.join(" / ")}（目前：${activeName.trim()}）`,
  );

  await page.click(".timeline-settings-block .delete-timeline-button");
  await page.waitForTimeout(400);
  const tracksInNew = await trackCount();

  // 切回原本那一組，軌道數要回到原本的
  await page.click(".workset-chip");
  await page.waitForTimeout(400);
  const tracksBack = await trackCount();

  record(
    "切換工作集會換掉軌道清單",
    tracksInNew === tracksBefore - 1 && tracksBack === tracksBefore,
    `原本 ${tracksBefore} → 新組 ${tracksInNew} → 切回 ${tracksBack}`,
  );
  await shot(page, "worksets");

  // ── Output ────────────────────────────────────────────
  const outputBtn = page.locator("button.output-button");
  if (await outputBtn.count()) {
    await outputBtn.first().click();
    await page.waitForTimeout(2000);
    record("Output 觸發上傳", uploads.length > 0, `${uploads.length} 次請求`);
    await shot(page, "output");
  }

  // ── 原始表格編輯器（/edit）─────────────────────────────
  // 這頁在 Phase 5g 從 keyframe 整個改寫成 segment，而它沒有元件測試
  // （唯一的路由入口是網址列）。至少要確認它打得開、看得到資料、改得動。
  await page.goto(`${BASE}/edit`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const rowCount = await page.locator(".edit-container tbody tr").count();
  record("/edit 列出目前部位的色塊", rowCount > 0, `${rowCount} 列`);

  if (rowCount > 0) {
    const startInput = page
      .locator(".edit-container tbody tr input[type='number']")
      .first();
    const before = Number(await startInput.inputValue());
    await startInput.fill(String(before + 500));
    await startInput.blur();
    await page.waitForTimeout(400);

    const after = Number(
      await page
        .locator(".edit-container tbody tr input[type='number']")
        .first()
        .inputValue(),
    );
    record(
      "/edit 改起始時間會寫回 store",
      after === before + 500,
      `${before} → ${after}`,
    );
    await shot(page, "edit-table");
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
