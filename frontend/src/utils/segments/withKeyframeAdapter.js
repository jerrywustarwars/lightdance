import { keyframesToSegments, segmentsToKeyframes } from "./convert.js";

/**
 * keyframe ↔ segment 的雙向轉接橋 —— **Phase 4 的過渡期產物**。
 *
 * Phase 4 只換 store 的形狀，既有的寫入者與渲染邏輯一行都不改：它們繼續
 * 用 keyframe 思考，由這裡負責把 store 的 segments 翻譯進去、再翻譯回來。
 * Phase 5 逐項原生化之後整個檔案會被刪掉。
 *
 * @deprecated 過渡期用。新程式碼請直接操作 segments。
 *
 * ## 為什麼要在意 reference
 *
 * 天真的做法是「整張表轉過去、整張表轉回來」，但那會讓每次編輯都產生
 * 全新的 154 條 timeline，於是：
 *
 * - `React.memo` / memoized selector 全部失效，每次編輯重繪整個編輯器
 * - 每個 segment 的 `id` 都被重新產生，Phase 5/6 要靠 id 做多選與 undo diff
 *
 * 所以兩個方向都做**逐 (armor, part) 的 reference 快取**：immer 對沒動到的
 * 路徑會回傳同一個 reference，我們就沿用上一輪的結果。
 */

/**
 * segments → keyframes，逐部位以 segments 陣列的 reference 做快取。
 *
 * 用 WeakMap 讓被丟棄的舊 state 能正常回收。
 */
const keyframeCache = new WeakMap();

function cachedSegmentsToKeyframes(segments, duration) {
  const cached = keyframeCache.get(segments);
  if (cached && cached.duration === duration) return cached.keyframes;

  const keyframes = segmentsToKeyframes(segments, { duration });
  keyframeCache.set(segments, { duration, keyframes });
  return keyframes;
}

/** 整張 segment table → keyframe actionTable（逐部位快取） */
export function toKeyframeTable(segmentTable, duration) {
  if (!Array.isArray(segmentTable)) return [];

  return segmentTable.map((armor) =>
    armor.map((segments) => cachedSegmentsToKeyframes(segments, duration)),
  );
}

/**
 * keyframes → segments，只轉換真的被改動的部位。
 *
 * @param {Array} nextKeyframeTable - 寫入者 produce 出來的新 keyframe 表
 * @param {Array} prevKeyframeTable - 寫入者當初讀到的 keyframe 表（比對基準）
 * @param {Array} prevSegmentTable  - store 目前的 segment 表（沿用來源）
 * @param {{duration?: number}} options
 * @returns {Array} 新的 segment table；沒動過的部位是原本的 reference
 */
export function toSegmentTableIncremental(
  nextKeyframeTable,
  prevKeyframeTable,
  prevSegmentTable,
  { duration } = {},
) {
  return nextKeyframeTable.map((armor, armorIdx) =>
    armor.map((timeline, partIdx) => {
      const prevTimeline = prevKeyframeTable?.[armorIdx]?.[partIdx];
      const prevSegments = prevSegmentTable?.[armorIdx]?.[partIdx];

      // immer 對沒動到的路徑回傳同一個 reference —— 直接沿用舊的 segments，
      // 連 id 都保住
      if (prevSegments && timeline === prevTimeline) return prevSegments;

      return keyframesToSegments(timeline, { duration });
    }),
  );
}
