/**
 * 選取項目的形狀與查詢 —— **全專案唯一的定義處**。
 *
 * `multiSelectedBlocks` 裡的每一筆長這樣：
 *
 * ```js
 * { armorIndex, partIndex, segmentId, blockIndex }
 * ```
 *
 * ## segmentId 是目標，blockIndex 是遷移期的殘留
 *
 * | 欄位 | 狀態 | 說明 |
 * |---|---|---|
 * | `segmentId` | ✅ 目標形狀 | 穩定識別。鄰居被編輯、色塊被切開、undo 之後都還指向同一個色塊 |
 * | `blockIndex` | ⚠️ 待刪除 | keyframe 陣列的索引，只給還沒原生化的消費者用 |
 *
 * **新程式碼一律只讀 `segmentId`。** `blockIndex` 會在最後一個消費者
 * （TrackToolbar / EffectMenu / CopyPasteManager / ControlPanel /
 * EditActionTable）改完之後從這個檔案與 Timeline 一起刪掉。
 *
 * ## 為什麼非換不可
 *
 * 索引會位移。Phase 4 期間連續踩到三次同一類 bug——`blockIndex + 2`
 * 假設中間一定有黑哨兵、亮度階梯用 stride 2 找下一個色塊、剪下後選取
 * 落在隔壁色塊——根因都是「用位置當識別」。色塊被切開或鄰居被刪除時，
 * 索引指向的東西就換人了，而且不會報錯，只是靜默選錯。
 *
 * id 沒有這個問題：找不到就是找不到（回傳 null），可以明確處理。
 */

/**
 * 建立一筆選取項目。
 *
 * @param {object} params
 *   armorIndex / partIndex: 位置
 *   segment: 被選中的 segment（要有 id）
 *   blockIndex: 遷移期相容欄位，見上方說明；原生化的呼叫端可以不傳
 */
export const makeSelection = ({
  armorIndex,
  partIndex,
  segment,
  blockIndex,
}) => ({
  armorIndex,
  partIndex,
  segmentId: segment?.id ?? null,
  blockIndex,
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

/**
 * 某個 segment 在 keyframe 視圖裡的索引 —— **遷移期專用**。
 *
 * 壓平成 keyframe 之後，一個 segment 的起點會變成「時間等於 segment.start
 * 的那個非黑關鍵格」。要排除黑點是因為空隙結束時也會在同一個網格點發一個
 * 黑關鍵格，只比時間會取到錯的那一個。
 *
 * 這個函式存在的唯一理由是餵給還沒原生化的消費者，會和 `blockIndex`
 * 一起刪除。
 */
export const keyframeIndexOfSegment = (timeline, segment) => {
  if (!Array.isArray(timeline) || !segment) return -1;

  return timeline.findIndex(
    (entry) =>
      entry?.time === segment.start &&
      !(
        (entry?.color?.R ?? 0) === 0 &&
        (entry?.color?.G ?? 0) === 0 &&
        (entry?.color?.B ?? 0) === 0
      ),
  );
};
