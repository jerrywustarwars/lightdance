import { TICK_MS } from "../../constants/time.js";
import { totalDuration } from "./schedule.js";

/**
 * 音訊 clip 清單的形狀與不變式 —— **唯一定義處**。
 *
 * 一場表演是 5–6 首歌接續播放，所以音訊時間軸是一串 clip：
 *
 * ```js
 * { id, name, sourceFile, sourceOffset, start, end, gain, fadeIn, fadeOut }
 * ```
 *
 * `start`/`end` 是**表演時間**（ms，和燈光色塊同一條軸）。播放怎麼排在
 * `schedule.js`，這裡只管「清單長什麼樣、怎麼加一首、怎麼換順序」。
 *
 * ## 順序決定位置
 *
 * 使用者排的是**順序**，不是時間點——「第三首換成另一首」時不該要求他手動把
 * 後面每一首的起訖時間都改一遍。所以每次動到清單就 `resequence()` 重算一次
 * 首尾相接的位置，`start`/`end` 是推導出來的，不是使用者維護的。
 *
 * ## 接縫
 *
 * 相鄰兩首重疊 `overlapMs`（預設 0 = 硬切）。重疊時前一首在重疊區間淡出、
 * 後一首淡入，兩段疊起來就是交叉淡入淡出。這是清單裡**唯一允許重疊**的地方
 * ——不相鄰的 clip 永遠不會疊到。
 *
 * ## 為什麼不用 `utils/segments/core.js`
 *
 * 那一份的不變式是「排序且**不重疊**」，而接縫的重疊正好違反它。與其為了共用
 * 去放寬那個不變式（燈光色塊依賴它，放寬會讓拖曳與框選的邊界判斷全部失去
 * 保證），不如在這裡寫一份 30 行的排序邏輯。共用要付的代價比重寫高。
 */

/** 接縫預設不重疊（硬切）。要交叉淡入淡出時由使用者調 */
export const DEFAULT_OVERLAP_MS = 0;

/** 重疊上限：再長就不像接縫而像兩首歌一起放了 */
export const MAX_OVERLAP_MS = 5000;

let counter = 0;
const makeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `clip-${Date.now()}-${++counter}`;

/** 從檔名推一個看得懂的名字（去掉副檔名） */
export const nameFromFile = (sourceFile = "") =>
  String(sourceFile).split("/").pop()?.replace(/\.[^.]+$/, "") || "未命名";

/** 對齊到網格。clip 的邊界跟燈光色塊在同一條軸上，不對齊會讓兩者永遠差幾毫秒 */
const toTick = (ms) => Math.round(ms / TICK_MS) * TICK_MS;

/**
 * 建立一個 clip。`durationMs` 是音檔本身的長度（解碼後才知道）。
 *
 * `start`/`end` 先給 0，等 `resequence()` 依順序算出來——這裡不知道它排第幾個。
 */
export const createClip = ({
  sourceFile,
  durationMs,
  name,
  sourceOffset = 0,
  gain = 1,
}) => ({
  id: makeId(),
  name: name || nameFromFile(sourceFile),
  sourceFile,
  sourceOffset,
  // 音檔實際會用到的長度。resequence 靠它算位置，所以要記著
  lengthMs: toTick(Math.max(TICK_MS, durationMs ?? 0)),
  start: 0,
  end: 0,
  gain,
  fadeIn: 0,
  fadeOut: 0,
});

/** 一個 clip 實際會用到的長度（壞資料一律退回一格，不讓 NaN 流進位置運算） */
const lengthOf = (clip) => {
  const raw = clip?.lengthMs ?? (clip?.end ?? 0) - (clip?.start ?? 0);
  return Number.isFinite(raw) ? Math.max(TICK_MS, toTick(raw)) : TICK_MS;
};

/**
 * 依清單順序重算每一首的起訖時間與接縫的淡入淡出。
 *
 * 這是清單的**唯一排版規則**：第一首從 0 開始，之後每一首往前疊一個接縫。
 * 重疊的那一段前一首淡出、後一首淡入，疊起來就是交叉淡入淡出。
 *
 * ⚠️ **接縫的實際長度是逐條算的，不是直接用 `overlapMs`。** 兩首歌各自要留下
 * 一段沒有被疊到的部分，否則短的那一首會整首被蓋在重疊區裡——三首歌接在一起
 * 時甚至會排出「第三首比第二首還早開始」這種順序反過來的清單。所以接縫取
 * `min(overlapMs, 前一首 - 一格, 後一首 - 一格)`，而 `fadeOut`/`fadeIn` 記的是
 * 這個**實際值**：包絡與位置由同一個數字推導，才不會出現淡出比重疊區還長。
 */
export function resequence(clips, { overlapMs = DEFAULT_OVERLAP_MS } = {}) {
  if (!Array.isArray(clips) || clips.length === 0) return [];

  const overlap = toTick(
    Math.max(0, Math.min(MAX_OVERLAP_MS, Number(overlapMs) || 0)),
  );

  const lengths = clips.map(lengthOf);

  // seams[i] = 第 i 首與第 i+1 首實際重疊多久
  const seams = lengths.slice(0, -1).map((length, index) =>
    Math.max(
      0,
      Math.min(overlap, length - TICK_MS, lengths[index + 1] - TICK_MS),
    ),
  );

  let cursor = 0;
  return clips.map((clip, index) => {
    const length = lengths[index];
    const start = cursor;
    cursor = start + length - (seams[index] ?? 0);

    return {
      ...clip,
      start,
      end: start + length,
      lengthMs: length,
      // 第一首沒有淡入、最後一首沒有淡出——那不是接縫，是整場的開頭與結尾
      fadeIn: index === 0 ? 0 : seams[index - 1],
      fadeOut: index === clips.length - 1 ? 0 : seams[index],
    };
  });
}

/**
 * 音檔解碼完之後把真正的長度補上去並重排。
 *
 * 加一首歌的當下還不知道它多長（要解碼才有），所以 `createClip` 先給一格，
 * 載入完再由這裡補。**沒有任何一條長度改變時回傳原本那個 reference**——
 * 它跑在載入 effect 裡且結果會 dispatch 回 store，不擋住的話每次載入都會寫一次
 * store、store 一變又觸發載入，轉成無窮迴圈。
 *
 * @param {Array} clips 目前的清單
 * @param {Map|object} lengthByFile 檔名 → 音檔長度（ms）
 */
export function applyMeasuredLengths(clips, lengthByFile, options) {
  const list = clips ?? [];
  const lookup = (file) =>
    lengthByFile instanceof Map ? lengthByFile.get(file) : lengthByFile?.[file];

  let changed = false;
  const next = list.map((clip) => {
    const measured = lookup(clip.sourceFile);
    if (!Number.isFinite(measured) || measured <= 0) return clip;

    // sourceOffset 之後的部分才是這個 clip 用得到的
    const available = measured - (clip.sourceOffset ?? 0) * 1000;
    const lengthMs = Math.max(TICK_MS, toTick(available));
    if (clip.lengthMs === lengthMs) return clip;

    changed = true;
    return { ...clip, lengthMs };
  });

  return changed ? resequence(next, options) : list;
}

/** 加一首到最後面 */
export const addClip = (clips, clip, options) =>
  resequence([...(clips ?? []), clip], options);

/** 移除一首 */
export const removeClip = (clips, id, options) =>
  resequence((clips ?? []).filter((clip) => clip.id !== id), options);

/**
 * 把某一首往前／往後移一格。
 *
 * 移到頭或尾之後再移就原樣回傳（reference 相同），呼叫端可以據此不 dispatch。
 */
export function moveClip(clips, id, delta, options) {
  const list = clips ?? [];
  const index = list.findIndex((clip) => clip.id === id);
  if (index === -1) return list;

  const target = index + delta;
  if (target < 0 || target >= list.length) return list;

  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return resequence(next, options);
}

/** 改名（空字串會退回從檔名推出來的名字，不允許無名的 clip） */
export function renameClip(clips, id, name) {
  const list = clips ?? [];
  const trimmed = String(name ?? "").trim();
  return list.map((clip) =>
    clip.id === id
      ? { ...clip, name: trimmed || nameFromFile(clip.sourceFile) }
      : clip,
  );
}

/** 某個時間點播到第幾首（接縫重疊時算**後面**那一首，跟著使用者的注意力走） */
export function clipIndexAt(clips, timeMs) {
  const list = clips ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].start <= timeMs) return i;
  }
  return list.length ? 0 : -1;
}

export { totalDuration };

/**
 * 把舊資料收成 clip 清單。
 *
 * 舊的專案只有一個 `data.music_filename`，那就是一首歌的表演。靠形狀辨認、
 * 不看版本號（和 `utils/worksets.js` 同一套做法）：已經是陣列就當作已經遷移過，
 * 否則從檔名生一個 clip。
 *
 * 長度這裡還不知道（要解碼才有），先給 0，載入時再補上並 resequence。
 */
export function migrateClips(audioClips, musicFilename) {
  if (Array.isArray(audioClips) && audioClips.length > 0) return audioClips;
  if (!musicFilename) return [];
  return resequence([createClip({ sourceFile: musicFilename, durationMs: 0 })]);
}
