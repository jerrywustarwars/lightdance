import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import {
  updateClipboard,
  updateMultiSelectedBlocks,
} from "../../redux/actions.js";
import { roundToTick, clearRange, createId } from "../../utils/segments/core.js";
import { makeSelection, resolveSelections } from "../../utils/selection.js";
import { useSegmentActionTable } from "../../hooks/useSegmentActionTable.js";

/**
 * 複製貼上：兩種粒度、兩種貼上對齊方式。
 *
 * | 操作 | 快捷鍵 | 行為 |
 * |---|---|---|
 * | 複製區間 | Ctrl+C | 把選取的色塊範圍存進剪貼簿，並進入「複製模式」 |
 * | 貼到選取處 | Ctrl+V | 以選取色塊的起點為基準對齊貼上 |
 * | 原時間貼上 | Ctrl+Shift+V | 保持原本的時間位置貼上（貼到另一個部位用） |
 * | 複製整個部位 | Shift+C | 整條 timeline 存進剪貼簿 |
 * | 覆蓋整個部位 | Shift+V | 整條 timeline 覆蓋過去 |
 *
 * `isCopying`（複製模式）是純 UI 狀態——Timeline 靠它顯示來源標記、
 * 頂端顯示提示橫幅——所以留在元件裡用 hook 傳遞，不進 Redux。
 *
 * ## Phase 5e：改成 segment 原生
 *
 * 舊版在壓平出來的 keyframe 陣列上操作，貼上一次要做四件跟黑點有關的事：
 * 平移時「有色點對齊網格、黑點保持原偏移」、清衝突時「衝突結束後緊跟的黑塊
 * 也要刪」、插入後「檢查起點前方需不需要補黑點」（`ensureBlackBefore`）、
 * 最後再跑一次 `removeDuplicateBlackBlocks` 收拾殘留。
 *
 * segment 模型裡這四件事全部消失：熄滅就是段與段之間的空隙，貼上就是
 * 「把要貼的區間清空，再把平移過的段放進去」。`clearRange` 連被切成兩半的
 * 情況都處理好了。
 */

/** 剪貼簿內容的格式標記。舊格式（keyframe 陣列）一律視為空。 */
const CLIPBOARD_KIND = "segments";

export function useCopyPaste() {
  const dispatch = useDispatch();
  const { segmentTable, commitPart } = useSegmentActionTable();
  const clipboard = useSelector((state) => state.profiles.clipboard);
  const multiSelectedBlocks = useSelector(
    (state) => state.profiles.multiSelectedBlocks,
  );

  // 複製模式：Timeline 靠它顯示來源標記，純 UI 狀態不進 Redux
  const [isCopying, setIsCopying] = useState(false);

  /** 選取所在的部位與它的 segments */
  const activePart = multiSelectedBlocks[0] ?? null;
  const activeSegments = activePart
    ? (segmentTable?.[activePart.armorIndex]?.[activePart.partIndex] ?? [])
    : [];

  /** 剪貼簿裡有沒有這個版本認得的資料 */
  const hasClipboard =
    clipboard?.kind === CLIPBOARD_KIND && clipboard.segments?.length > 0;

  /** Ctrl+C：複製選取的區間 */
  const copyRange = () => {
    const selected = resolveSelections(multiSelectedBlocks, activeSegments);
    if (selected.length === 0) {
      console.warn("請先選取色塊再進行複製。");
      return;
    }

    const segments = selected.map((entry) => entry.segment);
    const startTime = segments[0].start;
    const endTime = segments[segments.length - 1].end;

    dispatch(
      updateClipboard({
        kind: CLIPBOARD_KIND,
        segments: segments.map((segment) => ({ ...segment })),
        startTime,
        endTime,
        sourceArmorIndex: activePart.armorIndex,
        sourcePartIndex: activePart.partIndex,
        // Timeline 靠這個畫「來源」標記
        sourceBlocks: multiSelectedBlocks,
        timestamp: Date.now(),
      }),
    );

    setIsCopying(true); // 進入模式，讓 Timeline 顯示標記
  };

  /**
   * 把剪貼簿內容平移 `offset` 後貼進目標部位，覆蓋衝突區間。
   *
   * 每一段都會重新產生 id：貼上的是**副本**，跟來源是不同的色塊。沿用舊 id
   * 會讓選取、undo diff 指到兩個地方。
   */
  const executePaste = (targetArmor, targetPart, offset) => {
    const moved = clipboard.segments.map((segment) => ({
      ...segment,
      id: createId(),
      start: roundToTick(segment.start + offset),
      end: roundToTick(segment.end + offset),
    }));

    const newStart = moved[0].start;
    const newEnd = moved[moved.length - 1].end;

    const target = segmentTable?.[targetArmor]?.[targetPart] ?? [];
    const next = [...clearRange(target, newStart, newEnd), ...moved].sort(
      (a, b) => a.start - b.start,
    );

    commitPart(targetArmor, targetPart, next);
    setIsCopying(false);

    // 貼上之後選取貼進去的第一段，接著可以直接繼續編輯
    dispatch(
      updateMultiSelectedBlocks([
        makeSelection({
          armorIndex: targetArmor,
          partIndex: targetPart,
          segment: moved[0],
        }),
      ]),
    );
  };

  /** Ctrl+V：以選取色塊的起點為基準對齊貼上 */
  const pasteAlignedToTarget = () => {
    if (!hasClipboard) return;
    const selected = resolveSelections(multiSelectedBlocks, activeSegments);
    if (selected.length === 0) return;

    const targetStart = selected[0].segment.start;
    executePaste(
      activePart.armorIndex,
      activePart.partIndex,
      targetStart - clipboard.startTime,
    );
  };

  /** Ctrl+Shift+V：保持原本的時間位置貼上 */
  const pasteAtFixedTime = () => {
    if (!hasClipboard || !activePart) return;
    executePaste(activePart.armorIndex, activePart.partIndex, 0);
  };

  /** Shift+C：複製整個部位的 timeline */
  const copyWholePart = () => {
    if (!activePart) {
      console.warn("請先選取色塊，才知道要複製哪個部位。");
      return;
    }
    if (activeSegments.length === 0) {
      console.warn("這個部位沒有任何色塊。");
      return;
    }

    dispatch(
      updateClipboard({
        kind: CLIPBOARD_KIND,
        segments: activeSegments.map((segment) => ({ ...segment })),
        startTime: activeSegments[0].start,
        endTime: activeSegments[activeSegments.length - 1].end,
        sourceArmorIndex: activePart.armorIndex,
        sourcePartIndex: activePart.partIndex,
        sourceBlocks: [],
        timestamp: Date.now(),
      }),
    );
  };

  /** Shift+V：整條 timeline 覆蓋到目標部位 */
  const pasteWholePart = () => {
    if (!hasClipboard) {
      console.warn("剪貼簿是空的。");
      return;
    }
    if (!activePart) {
      console.warn("請先選取色塊，才知道要貼到哪個部位。");
      return;
    }

    // 整個部位覆蓋掉，一樣要換新 id（貼上的是副本）
    const pasted = clipboard.segments.map((segment) => ({
      ...segment,
      id: createId(),
    }));

    commitPart(activePart.armorIndex, activePart.partIndex, pasted);
    dispatch(
      updateMultiSelectedBlocks(
        pasted.length
          ? [
              makeSelection({
                armorIndex: activePart.armorIndex,
                partIndex: activePart.partIndex,
                segment: pasted[0],
              }),
            ]
          : [],
      ),
    );
  };

  /** Esc：離開複製模式 */
  const cancelCopying = () => {
    setIsCopying(false);
    dispatch(updateMultiSelectedBlocks([]));
  };

  return {
    isCopying,
    copyRange,
    pasteAlignedToTarget,
    pasteAtFixedTime,
    copyWholePart,
    pasteWholePart,
    cancelCopying,
  };
}

/** 複製模式時顯示在最上方的提示橫幅 */
export function CopyModeBanner({ isCopying }) {
  const clipboard = useSelector((state) => state.profiles.clipboard);

  if (!isCopying) return null;

  return (
    <div className="copy-mode-banner">
      <span>
        📋 Copy Mode Active (Interval: {clipboard?.startTime}ms ~{" "}
        {clipboard?.endTime}ms)
      </span>
      <span className="hint-text">
        Press [ESC] to Cancel or click Target then [Ctrl+V]
      </span>
    </div>
  );
}
