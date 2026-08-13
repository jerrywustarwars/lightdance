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

const ceilTo = (value, step) => Math.ceil(value / step) * step;

const floorTo = (value, step) => Math.floor(value / step) * step;

/** 找出某個 id 在陣列裡的位置，找不到回傳 -1 */
const indexOfId = (segments, segmentId) =>
  segments.findIndex((segment) => segment.id === segmentId);

/** 表演總長沒給（音檔還沒載入）時當作無限長，不要讓 NaN 流進運算 */
const endOfTimeline = (duration) =>
  Number.isFinite(duration) ? duration : Infinity;

/**
 * 這批色塊還能往左／往右移多少毫秒。
 *
 * **像素預覽與放開後的 commit 必須用同一份答案**，否則會出現「拖到底了但
 * 放開後又跳一點」——那是因為兩邊各自算了一次邊界，而且用的是不同的公式。
 * 所以這裡把規則抽出來當單一來源：元件拿它換算成像素做預覽，`moveSegments`
 * 拿它決定最終落點。
 *
 * ## 為什麼只看「最近的未選取鄰居」就夠
 *
 * 整批色塊是**剛性移動**的，彼此相對位置不變，所以選取範圍內部不會互撞。
 * 每一段真正的限制只來自它和最近的那個**沒被選到**的鄰居；把每一段各自的
 * 上下限取交集，就是整批的可動範圍。連續選取時內側那幾段的限制較鬆，
 * 取 min/max 之後自然由最靠近鄰居的那一段決定。
 *
 * @returns {{min: number, max: number} | null}
 *   可移動的毫秒範圍（已對齊網格）。沒有選到東西、或被夾死時回傳 null。
 */
export function movableRange(
  segments,
  segmentIds,
  { duration, gap = MIN_BLOCK_GAP_MS, tick = TICK_MS } = {},
) {
  const ids = segmentIds instanceof Set ? segmentIds : new Set(segmentIds);
  const selected = segments.filter((segment) => ids.has(segment.id));
  if (selected.length === 0) return null;

  const isSelected = (index) => ids.has(segments[index].id);
  const limit = endOfTimeline(duration);

  let min = -Infinity;
  let max = Infinity;

  segments.forEach((segment, index) => {
    if (!isSelected(index)) return;

    let left = index - 1;
    while (left >= 0 && isSelected(left)) left--;
    let right = index + 1;
    while (right < segments.length && isSelected(right)) right++;

    const leftBound = left >= 0 ? segments[left].end + gap : 0;
    const rightBound =
      right < segments.length ? segments[right].start - gap : limit;

    min = Math.max(min, leftBound - segment.start);
    max = Math.min(max, rightBound - segment.end);
  });

  // 對齊網格時往內收（ceil 下界、floor 上界），確保夾出來的位移一定在範圍內。
  // 先夾再對齊的話，間距不是網格倍數時會被 round 推出邊界。
  //
  // 再夾一次 0：**沒有移動一定要是合法的**。segment 模型允許兩個色塊首尾相接
  // （`a.end === b.start`，貼上與 trim 都會產生），這時「與鄰居至少留 50ms」
  // 算出來的下界是 +50 而不是負的；少了這道夾緊，拖 0 像素會把色塊彈開 50ms。
  // 被前後夾死的情況自然收斂成 {0, 0}，也就是整批不動。
  return {
    min: Math.min(0, ceilTo(min, tick)),
    max: Math.max(0, floorTo(max, tick)),
  };
}

/**
 * 整段平移（單一色塊）。
 *
 * @param {Array} segments 該部位的 segments（已排序、不重疊）
 * @param {string} segmentId 要移動的段
 * @param {number} deltaMs 位移量（可負）
 * @param {object} options duration / gap / tick
 * @returns {Array} 新陣列；沒有任何改變時回傳**原陣列**（呼叫端可用 reference 判斷）
 */
export function moveSegment(segments, segmentId, deltaMs, options = {}) {
  if (indexOfId(segments, segmentId) === -1) return segments;
  return moveSegments(segments, [segmentId], deltaMs, options);
}

/**
 * 多個色塊一起平移，彼此的相對位置不變。
 *
 * 選取範圍內部不會互撞（剛性移動），與外部鄰居的距離則由 `movableRange`
 * 夾住。整批共用同一個位移量——這正是使用者對「一起搬」的預期：搬完之後
 * 樂句的節奏不變。
 *
 * @param {Array} segments 該部位的 segments
 * @param {Iterable<string>} segmentIds 要一起移動的 id
 * @param {number} deltaMs 位移量（可負）
 * @param {object} options duration / gap / tick
 * @returns {Array} 新陣列；沒有任何改變時回傳原陣列
 */
export function moveSegments(
  segments,
  segmentIds,
  deltaMs,
  { duration, gap = MIN_BLOCK_GAP_MS, tick = TICK_MS } = {},
) {
  const ids = segmentIds instanceof Set ? segmentIds : new Set(segmentIds);
  const range = movableRange(segments, ids, { duration, gap, tick });
  if (!range) return segments;

  const delta = clamp(roundTo(deltaMs, tick), range.min, range.max);
  if (delta === 0) return segments;

  return segments.map((segment) =>
    ids.has(segment.id)
      ? { ...segment, start: segment.start + delta, end: segment.end + delta }
      : segment,
  );
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
      index < segments.length - 1
        ? segments[index + 1].start - gap
        : endOfTimeline(duration);
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
