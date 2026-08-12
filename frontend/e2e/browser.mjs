/**
 * 找出可用的 Chromium 執行檔。
 *
 * Playwright 預設會去自己的快取目錄找瀏覽器，但版本編號是寫死在套件裡的
 * （例如 `chromium_headless_shell-1234`）。只要環境裡預先裝好的是別的版本，
 * `chromium.launch()` 就會直接炸掉並叫你 `npx playwright install`——在沒有
 * 外網或瀏覽器已經裝好的機器上，那個建議沒有意義。
 *
 * 所以這裡自己找一次：
 *   1. `CHROMIUM_PATH` 環境變數（最優先，要指定特定版本時用）
 *   2. `PLAYWRIGHT_BROWSERS_PATH` 或 `/opt/pw-browsers` 底下任何一版 chromium
 *   3. 都找不到 → 回 undefined，交還給 Playwright 的預設解析
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 各平台在 chromium 資料夾裡的執行檔相對路徑 */
const CANDIDATES = [
  "chrome-linux/chrome",
  "chrome-linux/headless_shell",
  "chrome-headless-shell-linux64/chrome-headless-shell",
  "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
];

const findIn = (root) => {
  if (!existsSync(root)) return undefined;
  // 先試 chromium-*，再試 chromium_headless_shell-*：完整版功能較齊
  const dirs = readdirSync(root)
    .filter((name) => name.startsWith("chromium"))
    .sort((a, b) => a.startsWith("chromium-") - b.startsWith("chromium-"))
    .reverse();

  for (const dir of dirs) {
    for (const rel of CANDIDATES) {
      const exe = join(root, dir, rel);
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
};

export const resolveChromiumPath = () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return findIn(process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers");
};

/** 兩支腳本共用的啟動參數（容器裡沒有 sandbox / /dev/shm 很小） */
export const launchOptions = () => ({
  executablePath: resolveChromiumPath(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
