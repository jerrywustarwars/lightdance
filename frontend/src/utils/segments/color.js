import { DEFAULT_SEGMENT_MS, TICK_MS } from "../../constants/time.js";
import {
  clearRange,
  createId,
  findSegmentAt,
  floorToTick,
  insertSegment,
} from "./core.js";

/**
 * 燈光 segment 的色彩層 —— `core.js` 之上的**唯一**認得顏色的地方。
 *
 * `core.js` 刻意不認得 payload（見那個檔案開頭的說明），所以「這段現在是什麼
 * 顏色」「放一個色塊下去」這類事情放在這裡。未來多軌音訊會有一個平行的
 * `audio.js`，共用同一份 `core.js`。
 *
 * ## 段內漸變的語意
 *
 * `linear === 1` 時，segment 在 `[start, end)` 內從 `colorStart` 線性插值到
 * `colorEnd`。這和舊 keyframe 模型「漸變到下一個關鍵格的顏色」是同一件事，
 * 差別是終點色現在**記在自己身上**，不必依賴鄰居 —— 於是拖曳一個色塊不會
 * 改變另一個色塊的外觀。
 *
 * ## 空隙就是熄滅
 *
 * 段與段之間沒有東西，代表 LED 關著。因此 `getColorAt` 在空隙回傳純黑，
 * 而不是「上一段的顏色」。
 */

export const BLACK = Object.freeze({ R: 0, G: 0, B: 0, A: 1 });

/** 複製一份顏色並補齊預設值，避免呼叫端共用同一個物件 */
export const cloneColor = (color) => ({
  R: color?.R ?? 0,
  G: color?.G ?? 0,
  B: color?.B ?? 0,
  A: color?.A ?? 1,
});

export const isBlackColor = (color) =>
  (color?.R ?? 0) === 0 && (color?.G ?? 0) === 0 && (color?.B ?? 0) === 0;

export const sameColor = (a, b) =>
  (a?.R ?? 0) === (b?.R ?? 0) &&
  (a?.G ?? 0) === (b?.G ?? 0) &&
  (a?.B ?? 0) === (b?.B ?? 0) &&
  (a?.A ?? 1) === (b?.A ?? 1);

/**
 * 兩色之間線性插值，`ratio` 為 0 時回傳 `from`、1 時回傳 `to`。
 *
 * RGB 四捨五入成整數（韌體吃的是 8-bit 通道），alpha 保持浮點——
 * 它在打包時才會被量化成 7-bit。等同 C++ 的 `std::lerp` 逐通道版本。
 */
export const lerpColor = (from, to, ratio) => {
  const t = Math.max(0, Math.min(1, ratio));
  return {
    R: Math.round((from?.R ?? 0) * (1 - t) + (to?.R ?? 0) * t),
    G: Math.round((from?.G ?? 0) * (1 - t) + (to?.G ?? 0) * t),
    B: Math.round((from?.B ?? 0) * (1 - t) + (to?.B ?? 0) * t),
    A: (from?.A ?? 1) * (1 - t) + (to?.A ?? 1) * t,
  };
};

/**
 * 某個時間點該顯示什麼顏色。
 *
 * 落在空隙（或所有段之外）回傳純黑——空隙就是熄滅。
 * 落在漸變段內時回傳插值後的顏色，所以播放預覽直接用這個函式即可。
 */
export function getColorAt(segments, time) {
  const segment = findSegmentAt(segments ?? [], time);
  if (!segment) return { ...BLACK };

  if (segment.linear !== 1) return cloneColor(segment.colorStart);

  const span = segment.end - segment.start;
  if (span <= 0) return cloneColor(segment.colorStart);

  return lerpColor(
    segment.colorStart,
    segment.colorEnd,
    (time - segment.start) / span,
  );
}

/**
 * 建立一個純色 segment。
 *
 * 固定色的 `colorEnd` 與 `colorStart` 相同 —— 這樣切換成漸變時不需要另外
 * 補欄位，而且壓平回 keyframe 時的行為與固定色一致。
 */
export function createColorSegment({
  start,
  end,
  color,
  linear = 0,
  colorEnd,
  makeId = createId,
}) {
  const startColor = cloneColor(color);
  return {
    id: makeId(),
    start,
    end,
    colorStart: startColor,
    colorEnd: colorEnd ? cloneColor(colorEnd) : startColor,
    linear: linear === 1 ? 1 : 0,
  };
}

/**
 * 在時間軸上放一個色塊 —— 取代舊模型的 `insertColorKeyframes`。
 *
 * 舊版要判斷前後鄰居是不是黑色、決定要補幾個黑點（5 個分支）；segment 模型
 * 只有兩種情況：
 *
 *   - 點在既有色塊上 → 換那一段的顏色（長度、漸變設定都不動）
 *   - 點在空隙 → 放一個新色塊，長度到下一段的開頭為止，最多 `length`
 *
 * 「最多到下一段開頭」是為了不要覆蓋既有的色塊。真的要覆蓋時，呼叫端可以
 * 傳 `collision: "trim"`，被蓋住的部分會被裁掉（必要時 split 成兩段）。
 *
 * @param {Array} segments - 該部位的 segment 陣列（不會被修改）
 * @param {object} params
 *   time: 插入時間（會向下對齊網格）；color: 顏色；
 *   length: 新色塊的長度，預設 DEFAULT_SEGMENT_MS；
 *   duration: 表演總長，用來夾住不要超出結尾；
 *   collision: "keep"（預設，遇到既有色塊就縮短）或 "trim"（覆蓋並裁掉舊的）
 * @returns {Array} 新陣列；沒有任何改變時回傳原陣列（呼叫端可用 reference 判斷）
 */
export function insertColorSegment(
  segments,
  {
    time,
    color,
    length = DEFAULT_SEGMENT_MS,
    duration,
    tick = TICK_MS,
    collision = "keep",
    makeId = createId,
  },
) {
  const list = segments ?? [];
  const start = floorToTick(time, tick);

  // 點在既有色塊上：只換顏色，不動邊界。
  // 使用者的心智模型是「幫這個色塊換色」，不是「在中間插一個新色塊」。
  const existing = findSegmentAt(list, start);
  if (existing) {
    const nextColor = cloneColor(color);
    if (sameColor(existing.colorStart, nextColor) && existing.linear !== 1) {
      return list; // 顏色一樣，不佔 undo
    }
    return list.map((segment) =>
      segment === existing
        ? {
            ...segment,
            colorStart: nextColor,
            // 換色時把漸變收掉：使用者按的是「放這個顏色」，
            // 留著舊的漸變終點會讓色塊看起來不是他選的顏色
            colorEnd: nextColor,
            linear: 0,
          }
        : segment,
    );
  }

  // 點在空隙：長度先取 length，再依邊界收斂。
  // 不要在這裡用 `Math.max(..., start + tick)` 去保證非零長度——那會讓
  // 「點在表演結束之後」硬生出一個超出 duration 的色塊。放不下就是放不下。
  const limit =
    duration !== undefined && duration > 0
      ? floorToTick(duration, tick)
      : Infinity;

  let end = Math.min(start + length, limit);

  if (collision === "keep") {
    // 不覆蓋既有色塊：撞到下一段就停在它的開頭
    const next = list.find((segment) => segment.start >= start);
    if (next) end = Math.min(end, next.start);
  }

  if (end <= start) return list; // 沒有空間可放

  // insertSegment 本身就是 trim 語意。"keep" 模式在上面已經先把 end 收到
  // 下一段的開頭，所以走到這裡不會裁到任何東西——兩種模式共用同一條路徑。
  return insertSegment(
    list,
    createColorSegment({ start, end, color, makeId }),
    {
      makeId,
    },
  );
}

/**
 * 把一段時間範圍熄滅（等同舊模型的「塗黑」）。
 *
 * segment 模型不需要真的放黑色進去——把那段從資料裡拿掉就是熄滅。
 */
export function clearColorRange(
  segments,
  start,
  end,
  { makeId = createId } = {},
) {
  return clearRange(segments ?? [], start, end, { makeId });
}

/**
 * 在 `time` 把涵蓋它的 segment 切成兩段。
 *
 * 漸變段切開時，切點的插值顏色會成為前段的 `colorEnd` 與後段的 `colorStart`，
 * 兩段接起來的視覺結果與切之前完全相同。
 *
 * @returns {Array} 新陣列；切點不在任何段內、或正好落在邊界時回傳原陣列
 */
export function splitSegmentAt(segments, time, { makeId = createId } = {}) {
  const list = segments ?? [];
  const index = list.findIndex(
    (segment) => segment.start < time && segment.end > time,
  );
  if (index === -1) return list;

  const segment = list[index];
  const isLinear = segment.linear === 1;
  const middle = isLinear
    ? lerpColor(
        segment.colorStart,
        segment.colorEnd,
        (time - segment.start) / (segment.end - segment.start),
      )
    : cloneColor(segment.colorStart);

  const front = {
    ...segment,
    end: time,
    colorEnd: isLinear ? middle : segment.colorEnd,
  };
  const back = {
    ...segment,
    id: makeId(),
    start: time,
    colorStart: middle,
  };

  return [...list.slice(0, index), front, back, ...list.slice(index + 1)];
}
