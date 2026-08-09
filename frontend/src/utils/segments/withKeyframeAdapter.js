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

/**
 * 單一部位的 segments → keyframes，以 segments 陣列的 reference 做快取。
 *
 * 同一份 segments 轉出來的一定是同一個 keyframe 陣列，呼叫端因此可以用
 * reference 比較判斷「這條時間軸有沒有變」。
 */
export function toKeyframes(segments, duration) {
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
    armor.map((segments) => toKeyframes(segments, duration)),
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
  let changed = false;

  const nextSegmentTable = nextKeyframeTable.map((armor, armorIdx) => {
    const prevArmorSegments = prevSegmentTable?.[armorIdx];
    let armorChanged = false;

    const nextArmor = armor.map((timeline, partIdx) => {
      const prevTimeline = prevKeyframeTable?.[armorIdx]?.[partIdx];
      const prevSegments = prevArmorSegments?.[partIdx];

      // immer 對沒動到的路徑回傳同一個 reference —— 直接沿用舊的 segments，
      // 連 id 都保住
      if (prevSegments && timeline === prevTimeline) return prevSegments;

      armorChanged = true;
      changed = true;
      return keyframesToSegments(timeline, { duration });
    });

    // 這位舞者完全沒被動到就沿用原本那一列。
    // 讓「只訂閱某位舞者」的元件（Armor、AccessoryPanel）也能用 reference
    // 比較跳過重算——否則每次編輯都會換掉全部 7 列的 reference。
    if (
      !armorChanged &&
      Array.isArray(prevArmorSegments) &&
      prevArmorSegments.length === nextArmor.length
    ) {
      return prevArmorSegments;
    }

    return nextArmor;
  });

  // 沒有任何部位變動就回傳**原本那張表**，而不是內容相同的新陣列。
  //
  // 這件事看起來只是省一次配置，其實決定了 undo 對不對：reducer 靠
  // `newActionTable === state.data.actionTable` 這個 O(1) 比較判斷「這次
  // dispatch 什麼都沒改」而跳過 history。外層每次都給新陣列的話，短路永遠
  // 不成立——無效的剪下、對已經是黑的色塊按刪除、拖回原位，全都會佔掉一格
  // undo，使用者會遇到「Ctrl+Z 按一次沒反應」。
  //
  // 形狀變了（部位數不同）也算變動，否則會把補齊 7×22 的結果吃掉。
  if (!changed && sameShape(nextSegmentTable, prevSegmentTable)) {
    return prevSegmentTable;
  }

  return nextSegmentTable;
}

/** 兩張表的舞者數與各自的部位數是否完全相同 */
function sameShape(a, b) {
  if (!Array.isArray(b) || a.length !== b.length) return false;
  return a.every((armor, idx) => armor.length === b[idx]?.length);
}
