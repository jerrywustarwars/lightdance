/**
 * 掃描 CSS 檔裡「寫死的顏色」。
 *
 * 抽成獨立模組而不是塞在測試裡，是因為 commit 2 的清理過程需要反覆跑它
 * 來確認還剩幾處（`node -e "..."` 直接引用即可）。
 *
 * ## 判準
 *
 * 違規 = 在**非自訂屬性**的宣告值裡出現顏色字面值。
 *
 * 換句話說，顏色只能定義在 `--foo: #123456` 這種地方，使用時一律 `var(--foo)`。
 * 這條規則讓 `Dashboard.css` 可以保有自己那套獨立的品牌色 token
 * （入口頁不跟燈光顏色同框，維持深綠是刻意的），同時仍然禁止任何人
 * 在規則裡直接寫 `#333`。
 *
 * ## 刻意不算違規的東西
 *
 * - `var(--accent-blue)`：變數名稱裡的 `blue` 只是名字
 * - `transparent` / `currentColor` / `inherit`：不是具體顏色
 * - 註解裡的色碼
 */

/** 顏色字面值：十六進位、rgb()/rgba()、hsl()/hsla()、以及常見的顏色關鍵字 */
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|\b(?:white|black|red|green|blue|yellow|orange|purple|pink|brown|gray|grey|silver|gold|cyan|magenta|lime|navy|teal|olive|maroon)\b/g;

/** 一條宣告：`property: value`（值不含 `;` `{` `}`） */
const DECLARATION = /([-a-zA-Z]+)\s*:\s*([^;{}]+)/g;

/** 去掉註解，免得註解裡提到的色碼被算成違規 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 去掉 `var(...)` 的內容 —— 變數名稱裡的 `blue` 不是顏色 */
const stripVarNames = (value) => value.replace(/var\(\s*--[^)]*\)/g, "var()");

/**
 * 找出一份 CSS 原始碼裡所有寫死的顏色。
 *
 * @param {string} css CSS 原始碼
 * @returns {{property: string, literal: string}[]}
 */
export const findHardcodedColors = (css) => {
  const found = [];
  const source = stripComments(css);

  for (const match of source.matchAll(DECLARATION)) {
    const [, property, rawValue] = match;
    if (property.startsWith("--")) continue; // token 定義本身就是唯一該放顏色的地方

    for (const color of stripVarNames(rawValue).matchAll(COLOR_LITERAL)) {
      found.push({ property, literal: color[0] });
    }
  }
  return found;
};
