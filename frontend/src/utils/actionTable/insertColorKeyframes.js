import { LEGACY_BLACK_SENTINEL_MS } from "../../constants/time.js";

/**
 * @deprecated 舊「關鍵格 + 黑色哨兵」模型的放色邏輯，**Phase 5 會被 insertSegment 取代**。
 *
 * 這裡把原本散在 Armor.jsx、AccessoryPanel.jsx、audioplayer.jsx 三處的同一份
 * 「5 分支黑點判斷」合而為一。三份原始碼經逐分支比對後確認在**所有可觸及的路徑上
 * 行為相同**，差異都落在死路徑上：
 *
 *   - `isNextBlack` 的兩種寫法（`!element` vs `indexToCopy === 0` 三元式）：
 *     binarySearchFirstGreater 找不到更大值時回傳 0，所以「插在結尾」也會走
 *     `indexToCopy === 0` 分支，兩種寫法的差異永遠碰不到。
 *   - audioplayer 版多出的最後一個 `else`：前面的分支已窮盡 isPrev × isNext
 *     四種布林組合，該分支不可達。
 *   - 唯一真實差異是 audioplayer 版的 `nowTime - blackthreshold > 0` 守衛
 *     （t=0 時不插入）。這個守衛**留在呼叫端**，不進本函式，以保持行為不變。
 *
 * 給 C++ 開發者的類比：這就是把三份 copy-paste 的函式收斂成一個 TU 裡的實作，
 * 但在收斂前必須先證明它們的可觀察行為一致——否則就是偷偷改行為。
 */

/** 找出第一個 time > target 的索引；找不到時回傳 0（沿用原本的語意） */
export function binarySearchFirstGreater(arr, target) {
  if (!arr) return;
  let left = 0;
  let right = arr?.length - 1;
  let result = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid].time > target) {
      result = mid;
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  return result;
}

const makeBlack = (time) => ({
  time,
  color: { R: 0, G: 0, B: 0, A: 1 },
  linear: 0,
});

const isBlack = (entry) =>
  !entry ||
  (entry?.color?.R === 0 && entry?.color?.G === 0 && entry?.color?.B === 0);

/**
 * 在單一部位的時間軸上放一個顏色，並依前後鄰居補上必要的黑色斷點。
 *
 * @param {Array} timeline - 該部位的關鍵格陣列（不會被修改）
 * @param {{time: number, color: object, duration: number}} params
 *   time: 已對齊網格的插入時間；color: 要放的顏色；duration: 音樂總長（收尾黑點用）
 * @returns {Array} 新的關鍵格陣列（已依 time 排序）
 */
export function insertColorKeyframes(timeline, { time, color, duration }) {
  const partData = timeline || [];
  const indexToCopy = binarySearchFirstGreater(partData, time);

  let updated = [...partData];
  const newEntry = { time, color: { ...color }, linear: 0 };

  const nextElement = updated[indexToCopy];
  const previousElement = updated[indexToCopy - 1] || updated[indexToCopy];
  const isNextBlack = isBlack(nextElement);
  const isPreviousBlack = isBlack(previousElement);

  const existingIndex = updated.findIndex((entry) => entry.time === time);

  if (existingIndex !== -1) {
    // 同一時間已有關鍵格：只換顏色
    updated = updated.map((entry, index) =>
      index === existingIndex ? { ...entry, color: { ...color } } : entry,
    );
  } else if (indexToCopy === 0) {
    // 插在開頭或結尾：補一個收尾黑點到音樂結束
    updated.splice(partData.length, 0, newEntry, makeBlack(duration));
  } else if (!isPreviousBlack && isNextBlack) {
    // 前面是彩色：先切斷前一段
    updated.splice(
      indexToCopy + 1,
      0,
      makeBlack(time - LEGACY_BLACK_SENTINEL_MS),
      newEntry,
    );
  } else if (!isPreviousBlack && !isNextBlack) {
    // 前後都是彩色：兩側都要切斷
    updated.splice(
      indexToCopy + 1,
      0,
      makeBlack(time - LEGACY_BLACK_SENTINEL_MS),
      newEntry,
      makeBlack(
        nextElement?.time - LEGACY_BLACK_SENTINEL_MS ||
          time + LEGACY_BLACK_SENTINEL_MS,
      ),
    );
  } else if (isPreviousBlack && !isNextBlack) {
    // 後面是彩色：切斷後一段
    updated.splice(
      indexToCopy + 1,
      0,
      newEntry,
      makeBlack(
        nextElement?.time - LEGACY_BLACK_SENTINEL_MS ||
          time + LEGACY_BLACK_SENTINEL_MS,
      ),
    );
  } else {
    // 前後都是黑：直接放，不需要額外斷點
    updated.splice(partData.length, 0, newEntry);
  }

  updated.sort((a, b) => a.time - b.time);
  return updated;
}

export default insertColorKeyframes;
