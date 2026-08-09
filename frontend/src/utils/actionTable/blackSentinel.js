import { produce } from "immer";

import { LEGACY_BLACK_SENTINEL_MS } from "../../constants/time.js";

/**
 * 黑色哨兵（black sentinel）的維護工具 —— **整份檔案都是過渡期的東西**。
 *
 * 目前的資料模型用「關鍵格 + 黑點」表達色塊邊界：色塊要在某個時間結束、而且
 * 不要漸變到下一段時，必須在該時間前 `LEGACY_BLACK_SENTINEL_MS` 毫秒插一個純黑點。
 * 這兩個函式就是在維護那個約定——補上缺的黑點、清掉多餘的黑點。
 *
 * @deprecated Phase 4 換成 segment 模型後，色塊邊界由 `start`/`end` 直接表達，
 * 黑點不再是資料，這整個檔案會被刪除。新程式碼不要再呼叫。
 *
 * 從 audioplayer.jsx 原樣搬出（Phase 3c 拆件），行為未變，讓拆出來的
 * ShiftTool / CopyPasteManager 共用同一份而不是各自複製。
 */

/** 判斷一個關鍵格是不是純黑（RGB 全 0；不看 alpha） */
const isBlack = (point) =>
  point.color.R === 0 && point.color.G === 0 && point.color.B === 0;

/**
 * 從 `fromIndex` 開始往後找下一個「有顏色」的關鍵格，找不到回傳 -1。
 *
 * **不要用 `index + 2` 代替這個函式。** 黑哨兵模型下「一個視覺色塊 = 顏色點
 * + 黑點」，往後跳 2 格剛好是下一個色塊——但那只在色塊之間真的有黑點時成立。
 * 兩個色塊緊鄰時沒有黑點，stride 2 會直接跳過一整個色塊。
 *
 * Phase 4 之後這件事變成常態：store 存 segments，壓平回 keyframe 時緊鄰的
 * 色塊之間本來就不會有黑點，寫死的 stride 2 會落在錯誤的位置。
 */
export const findNextColorIndex = (timeline, fromIndex) => {
  for (let i = Math.max(0, fromIndex); i < timeline.length; i++) {
    if (!isBlack(timeline[i])) return i;
  }
  return -1;
};

/**
 * 確保 `targetTime` 之前有黑點，讓前一段色塊在此確實熄滅。
 *
 * 就地修改傳入的 timeline（呼叫端通常在 immer draft 裡用）。
 */
export const ensureBlackBefore = (
  timeline,
  targetTime,
  threshold = LEGACY_BLACK_SENTINEL_MS,
) => {
  const blackTime = targetTime - threshold;
  if (blackTime <= 0) return;

  // 尋找 blackTime 附近的點
  const existingIdx = timeline.findIndex(
    (p) => Math.abs(p.time - blackTime) < 5,
  );

  if (existingIdx !== -1) {
    // 如果已經有黑點就不用動，但如果是有顏色的點，就把他變黑
    const p = timeline[existingIdx];
    if (!isBlack(p)) {
      p.color = { R: 0, G: 0, B: 0, A: 1 };
      p.linear = 0;
    }
  } else {
    // 檢查 blackTime 之前的最後一個點
    const prevPoints = timeline.filter((p) => p.time < blackTime);
    if (prevPoints.length > 0) {
      const lastPoint = prevPoints[prevPoints.length - 1];
      // 如果前一個點不是黑色的，則必須補一個黑點
      if (!isBlack(lastPoint)) {
        timeline.push({
          time: blackTime,
          color: { R: 0, G: 0, B: 0, A: 1 },
          linear: 0,
        });
      }
    }
  }
};

/**
 * 清掉多餘的黑點：連續兩個黑點、或和前一點時間幾乎重疊的黑點，只留前面那個。
 *
 * @returns 新的 actionTable（immer produce，不改動輸入）
 */
export const removeDuplicateBlackBlocks = (actionTable) =>
  produce(actionTable, (draft) => {
    Object.values(draft).forEach((armor) => {
      Object.keys(armor).forEach((partKey) => {
        const timeline = armor[partKey];
        if (!Array.isArray(timeline)) return;

        armor[partKey] = timeline.filter((block, index) => {
          if (!isBlack(block)) return true;

          const prev = timeline[index - 1];
          if (prev) {
            // 如果連續兩個黑點，或者是時間點重疊/太接近的黑點，刪除後者
            if (isBlack(prev) || Math.abs(block.time - prev.time) < 5)
              return false;
          }
          return true;
        });
      });
    });
  });
