/**
 * 選取項目的形狀與查詢 —— **全專案唯一的定義處**。
 *
 * `multiSelectedBlocks` 裡的每一筆長這樣：
 *
 * ```js
 * { armorIndex, partIndex, segmentId }
 * ```
 *
 * ## 為什麼是 id 而不是索引
 *
 * 這裡曾經還帶著一個 `blockIndex`（色塊在 keyframe 陣列裡的位置），Phase 5g
 * 隨最後一個消費者一起刪掉了。索引會位移：Phase 4 期間連續踩到三次同一類
 * bug——`blockIndex + 2` 假設中間一定有黑哨兵、亮度階梯用 stride 2 找下一個
 * 色塊、剪下後選取落在隔壁色塊——根因都是「用位置當識別」。色塊被切開或鄰居
 * 被刪除時，索引指向的東西就換人了，而且不會報錯，只是靜默選錯。
 *
 * id 沒有這個問題：找不到就是找不到（回傳 null），可以明確處理。
 */

/**
 * 建立一筆選取項目。
 *
 * @param {object} params
 *   armorIndex / partIndex: 位置；segment: 被選中的 segment（要有 id）
 */
export const makeSelection = ({ armorIndex, partIndex, segment }) => ({
  armorIndex,
  partIndex,
  segmentId: segment?.id ?? null,
});

/** 以 id 找出 segment；找不到回傳 null（呼叫端必須處理這個情況） */
export const findSegmentById = (segments, segmentId) => {
  if (!segmentId || !Array.isArray(segments)) return null;
  return segments.find((segment) => segment.id === segmentId) ?? null;
};

/** 兩筆選取是否指向同一個色塊 */
export const isSameSelection = (a, b) =>
  !!a &&
  !!b &&
  a.armorIndex === b.armorIndex &&
  a.partIndex === b.partIndex &&
  a.segmentId === b.segmentId;

/** 這筆選取是不是落在指定的部位上 */
export const isSelectionOnPart = (selection, armorIndex, partIndex) =>
  !!selection &&
  selection.armorIndex === armorIndex &&
  selection.partIndex === partIndex;

/**
 * 選取清單中落在指定部位上的 segmentId 集合。
 *
 * 渲染時要逐 block 判斷「我被選中了嗎」，用 Set 才不會變成 O(blocks × selections)。
 */
export const selectedIdsOnPart = (selections, armorIndex, partIndex) => {
  const ids = new Set();
  if (!Array.isArray(selections)) return ids;

  for (const selection of selections) {
    if (
      isSelectionOnPart(selection, armorIndex, partIndex) &&
      selection.segmentId
    ) {
      ids.add(selection.segmentId);
    }
  }
  return ids;
};

/**
 * 把選取解析成真正的 segment 物件，順便濾掉已經不存在的（例如被 undo 掉）。
 *
 * @returns {Array} `[{selection, segment}]`，依 segment 起始時間排序
 */
export const resolveSelections = (selections, segments) => {
  if (!Array.isArray(selections)) return [];

  return selections
    .map((selection) => ({
      selection,
      segment: findSegmentById(segments, selection.segmentId),
    }))
    .filter((entry) => entry.segment !== null)
    .sort((a, b) => a.segment.start - b.segment.start);
};

