/**
 * 拖曳與 resize 的**純運算** —— 不碰 DOM、不碰 Redux。
 *
 * ## 為什麼要抽出來
 *
 * 這兩段邏輯原本內嵌在 `Timeline.jsx` 的全域滑鼠事件處理器裡，跟
 * `getBoundingClientRect()`、`requestAnimationFrame`、直接寫 DOM style
 * 綁在一起。jsdom 沒有版面（`getBoundingClientRect()` 全回 0），所以
 * **整個手勢路徑一行測試都沒有**——偏偏它是最容易寫錯的地方：邊界夾緊、
 * 網格對齊、與鄰居的最小間距，每一項錯了都只會在手感上「怪怪的」。
 *
 * 抽出來之後，會動到資料的部分是純函式，可以窮舉邊界；留在元件裡的只剩
 * 「像素 → 毫秒」與「把結果寫回 DOM」，那部分本來就只能靠瀏覽器驗。
 *
 * ## 兩個約束都保持原本的手感
 *
 * | 常數 | 意思 |
 * |---|---|
 * | `MIN_BLOCK_GAP_MS` | 相鄰兩個色塊之間至少留這麼多空隙 |
 * | `MIN_SEGMENT_MS` | 色塊本身至少這麼長，避免縮到看不見也點不到 |
 *
 * segment 模型其實允許兩個色塊首尾相接（`a.end === b.start`），但拖曳時
 * 保留間距是刻意的：貼齊之後要再把它們分開很難，滑鼠不好瞄。
 */
import { TICK_MS } from "../../constants/time.js";

/** 相鄰色塊之間的最小空隙（沿用拖曳原本的手感） */
export const MIN_BLOCK_GAP_MS = 50;

/** 色塊的最小長度 */
export const MIN_SEGMENT_MS = 50;

const roundTo = (value, step) => Math.round(value / step) * step;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** 找出某個 id 在陣列裡的位置，找不到回傳 -1 */
const indexOfId = (segments, segmentId) =>
  segments.findIndex((segment) => segment.id === segmentId);

/**
 * 整段平移。
 *
 * 長度保持不變，起點被夾在「前一段的結尾 + 間距」與
 * 「後一段的起點 − 長度 − 間距」之間，然後對齊網格。
 *
 * @param {Array} segments 該部位的 segments（已排序、不重疊）
 * @param {string} segmentId 要移動的段
 * @param {number} deltaMs 位移量（可負）
 * @param {object} options duration / gap / tick
 * @returns {Array} 新陣列；沒有任何改變時回傳**原陣列**（呼叫端可用 reference 判斷）
 */
export function moveSegment(
  segments,
  segmentId,
  deltaMs,
  { duration, gap = MIN_BLOCK_GAP_MS, tick = TICK_MS } = {},
) {
  const index = indexOfId(segments, segmentId);
  if (index === -1) return segments;

  const target = segments[index];
  const length = target.end - target.start;

  const leftBound = index > 0 ? segments[index - 1].end : 0;
  const rightBound =
    index < segments.length - 1 ? segments[index + 1].start : duration;

  // 空間不夠時（左右鄰居把它夾死）就不要動，免得算出負的可用範圍
  const minStart = leftBound + (index > 0 ? gap : 0);
  const maxStart = rightBound - length - (index < segments.length - 1 ? gap : 0);
  if (maxStart < minStart) return segments;

  const nextStart = roundTo(
    clamp(target.start + deltaMs, minStart, maxStart),
    tick,
  );
  if (nextStart === target.start) return segments;

  const moved = { ...target, start: nextStart, end: nextStart + length };
  return segments.map((segment, i) => (i === index ? moved : segment));
}

/**
 * 拖動單邊調整長度。
 *
 * @param {Array} segments 該部位的 segments
 * @param {string} segmentId 要調整的段
 * @param {"left"|"right"} edge 拖的是哪一邊
 * @param {number} deltaMs 該邊的位移量（可負）
 * @param {object} options duration / gap / minDuration / tick
 * @returns {Array} 新陣列；沒有任何改變時回傳原陣列
 */
export function resizeSegment(
  segments,
  segmentId,
  edge,
  deltaMs,
  {
    duration,
    gap = MIN_BLOCK_GAP_MS,
    minDuration = MIN_SEGMENT_MS,
    tick = TICK_MS,
  } = {},
) {
  const index = indexOfId(segments, segmentId);
  if (index === -1) return segments;

  const target = segments[index];

  if (edge === "right") {
    const rightBound =
      index < segments.length - 1 ? segments[index + 1].start - gap : duration;
    const nextEnd = roundTo(
      clamp(target.end + deltaMs, target.start + minDuration, rightBound),
      tick,
    );
    if (nextEnd === target.end || nextEnd <= target.start) return segments;
    return segments.map((segment, i) =>
      i === index ? { ...segment, end: nextEnd } : segment,
    );
  }

  const leftBound = index > 0 ? segments[index - 1].end + gap : 0;
  const nextStart = roundTo(
    clamp(target.start + deltaMs, leftBound, target.end - minDuration),
    tick,
  );
  if (nextStart === target.start || nextStart >= target.end) return segments;
  return segments.map((segment, i) =>
    i === index ? { ...segment, start: nextStart } : segment,
  );
}
