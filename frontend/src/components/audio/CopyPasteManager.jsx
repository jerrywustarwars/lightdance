import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { produce } from "immer";

import {
  updateClipboard,
  updateMultiSelectedBlocks,
} from "../../redux/actions.js";
import { TICK_MS } from "../../constants/time.js";
import {
  ensureBlackBefore,
  removeDuplicateBlackBlocks,
} from "../../utils/actionTable/blackSentinel.js";
import { useKeyframeActionTable } from "../../hooks/useKeyframeActionTable.js";

/**
 * 複製貼上：兩種粒度、兩種貼上對齊方式。
 *
 * | 操作 | 快捷鍵 | 行為 |
 * |---|---|---|
 * | 複製區間 | Ctrl+C | 把選取的色塊範圍存進剪貼簿，並進入「複製模式」 |
 * | 貼到選取處 | Ctrl+V | 以選取色塊的時間為基準對齊貼上 |
 * | 原時間貼上 | Ctrl+Shift+V | 保持原本的時間位置貼上（貼到另一個部位用） |
 * | 複製整個部位 | Shift+C | 整條 timeline 存進剪貼簿 |
 * | 覆蓋整個部位 | Shift+V | 整條 timeline 覆蓋過去 |
 *
 * `isCopying`（複製模式）是純 UI 狀態——Timeline 靠它顯示來源標記、
 * 頂端顯示提示橫幅——所以留在元件裡用 hook 傳遞，不進 Redux。
 */

const isBlack = (point) =>
  (point.color?.R ?? 0) === 0 &&
  (point.color?.G ?? 0) === 0 &&
  (point.color?.B ?? 0) === 0;

export function useCopyPaste() {
  const dispatch = useDispatch();
  const data = useSelector((state) => state.profiles.data);
  // Phase 4 過渡橋：store 存 segments，這裡取得 keyframe 視圖 + 寫回用的 commit
  const { actionTable, commit } = useKeyframeActionTable();
  const duration = useSelector((state) => state.profiles.duration);
  const clipboard = useSelector((state) => state.profiles.clipboard);
  const timelineBlocks = useSelector((state) => state.profiles.timelineBlocks);
  const multiSelectedBlocks = useSelector(
    (state) => state.profiles.multiSelectedBlocks,
  );

  // 複製模式：Timeline 靠它顯示來源標記，純 UI 狀態不進 Redux
  const [isCopying, setIsCopying] = useState(false);

  /** Ctrl+C：複製選取的區間 */
  const copyRange = () => {
    let startTime, endTime, armorIndex, partIndex;
    let sourceBlocksInfo = [];

    // 1. 優先檢查是否有多選 (Shift 多選)
    if (multiSelectedBlocks && multiSelectedBlocks.length > 0) {
      const firstBlockPos = multiSelectedBlocks[0];
      armorIndex = firstBlockPos.armorIndex;
      partIndex = firstBlockPos.partIndex;
      sourceBlocksInfo = multiSelectedBlocks;

      const timelineDataForCopy = actionTable[armorIndex][partIndex];
      const selectedIndices = multiSelectedBlocks.map((b) => b.blockIndex);
      const minIdx = Math.min(...selectedIndices);
      const maxIdx = Math.max(...selectedIndices);

      startTime = timelineDataForCopy[minIdx].time;
      endTime = timelineDataForCopy[maxIdx + 1]?.time ?? duration;
    }
    // 2. 如果沒有多選，檢查是否有單選 (點擊單個 Block)
    else if (
      multiSelectedBlocks.length === 0 &&
      data?.selectedBlock?.armorIndex !== undefined
    ) {
      const sBlock = data.selectedBlock;
      armorIndex = sBlock.armorIndex;
      partIndex = sBlock.partIndex;
      sourceBlocksInfo = [sBlock]; // 單選包裝成陣列，讓渲染邏輯統一

      const block =
        timelineBlocks?.[armorIndex]?.[partIndex]?.[sBlock.blockIndex];
      if (!block) {
        console.warn("找不到選中的方塊資料");
        return;
      }

      startTime = block.startTime;
      endTime = block.startTime + block.durationTime;
    } else {
      console.warn("請先選取方塊再進行複製。");
      return;
    }

    // 3. 從 actionTable 提取資料
    const timelineData = actionTable[armorIndex][partIndex];
    const copiedPoints = timelineData.filter(
      (p) => p.time >= startTime && p.time <= endTime,
    );

    if (copiedPoints.length === 0) return;

    // 4. 存入剪貼簿
    dispatch(
      updateClipboard({
        type: "range_fixed_time",
        data: JSON.parse(JSON.stringify(copiedPoints)),
        startTime,
        endTime,
        sourceBlocks: sourceBlocksInfo,
      }),
    );

    setIsCopying(true); // 進入模式，讓 Timeline 顯示標記
  };

  /** 把剪貼簿內容平移 `offset` 後貼進目標部位，覆蓋衝突區間 */
  const executePaste = (targetArmor, targetPart, offset, copiedData) => {
    const updatedActionTable = produce(actionTable, (draft) => {
      const timeline = draft[targetArmor][targetPart];
      if (!Array.isArray(timeline)) return;

      // A. 產生平移後的點，有色區塊強制對齊網格（黑點保持原本的偏移）
      const movedPoints = copiedData.map((p) => {
        const newTime = p.time + offset;
        return {
          ...p,
          time: isBlack(p) ? newTime : Math.round(newTime / TICK_MS) * TICK_MS,
        };
      });
      const newStart = movedPoints[0].time;
      const newEnd = movedPoints[movedPoints.length - 1].time;

      // B. 清理衝突區間：移除目標部位在 [newStart, newEnd] 內的所有點
      const indicesToRemove = new Set();
      let lastConflictIdx = -1;
      timeline.forEach((item, idx) => {
        if (item.time >= newStart && item.time <= newEnd) {
          indicesToRemove.add(idx);
          lastConflictIdx = idx;
        }
      });

      // 衝突後方黑塊清理：如果衝突結束後緊跟黑塊，也刪除
      if (lastConflictIdx !== -1 && lastConflictIdx + 1 < timeline.length) {
        if (isBlack(timeline[lastConflictIdx + 1])) {
          indicesToRemove.add(lastConflictIdx + 1);
        }
      }

      let nextTimeline = timeline.filter((_, idx) => !indicesToRemove.has(idx));

      // C. 插入點位並排序
      nextTimeline = [...nextTimeline, ...movedPoints].sort(
        (a, b) => a.time - b.time,
      );

      // D. 智慧黑點緩衝 (檢查起點前方是否需要黑點)
      const firstColorPoint = movedPoints.find((p) => !isBlack(p));
      if (firstColorPoint) {
        ensureBlackBefore(nextTimeline, firstColorPoint.time);
      }

      draft[targetArmor][targetPart] = nextTimeline.sort(
        (a, b) => a.time - b.time,
      );
    });

    // E. 全域重複清理並更新 Redux
    commit(removeDuplicateBlackBlocks(updatedActionTable));
    setIsCopying(false);
    dispatch(updateMultiSelectedBlocks([]));
  };

  /** Ctrl+V：以選取色塊的時間為基準對齊貼上 */
  const pasteAlignedToTarget = () => {
    if (!clipboard || multiSelectedBlocks.length === 0) return;

    const {
      armorIndex: targetArmor,
      partIndex: targetPart,
      blockIndex: targetBlockIdx,
    } = multiSelectedBlocks[0];
    const targetTime =
      actionTable[targetArmor][targetPart][targetBlockIdx]?.time ?? 0;

    // 計算偏移量：使用第一個有色區塊時間，避免黑點非對齊時間污染 offset
    const firstColorPoint = clipboard.data.find((p) => !isBlack(p));
    const firstTime = firstColorPoint
      ? firstColorPoint.time
      : clipboard.data[0].time;

    executePaste(
      targetArmor,
      targetPart,
      targetTime - firstTime,
      clipboard.data,
    );
  };

  /** Ctrl+Shift+V：保持原本的時間位置貼上 */
  const pasteAtFixedTime = () => {
    if (!clipboard || multiSelectedBlocks.length === 0) return;
    executePaste(
      multiSelectedBlocks[0].armorIndex,
      multiSelectedBlocks[0].partIndex,
      0,
      clipboard.data,
    );
  };

  /** Shift+C：複製整個部位的 timeline */
  const copyWholePart = () => {
    if (multiSelectedBlocks.length === 0) {
      console.warn("No block selected. Cannot copy.");
      return;
    }

    const { armorIndex, partIndex } = multiSelectedBlocks[0];
    const timeline = actionTable?.[armorIndex]?.[partIndex];

    if (!timeline || timeline.length === 0) {
      console.warn("No timeline data found for the selected block.");
      return;
    }

    dispatch(
      updateClipboard({
        data: JSON.parse(JSON.stringify(timeline)),
        sourceArmorIndex: armorIndex,
        sourcePartIndex: partIndex,
        timestamp: Date.now(),
      }),
    );
  };

  /** Shift+V：整條 timeline 覆蓋到目標部位 */
  const pasteWholePart = () => {
    if (!clipboard || !clipboard.data || clipboard.data.length === 0) {
      console.warn("Clipboard is empty. Nothing to paste.");
      return;
    }

    if (multiSelectedBlocks.length === 0) {
      console.warn("No block selected. Cannot determine paste target.");
      return;
    }

    const { armorIndex: targetArmorIndex, partIndex: targetPartIndex } =
      multiSelectedBlocks[0];

    const pastedData = JSON.parse(JSON.stringify(clipboard.data));

    const updatedActionTable = produce(actionTable, (draft) => {
      // 完全覆蓋目標部位的 timeline
      draft[targetArmorIndex][targetPartIndex] = pastedData;
    });

    commit(updatedActionTable);

    // 貼上後，選中目標部位的第一個有效方塊（非黑色）
    const firstColorIndex = pastedData.findIndex((block) => !isBlack(block));

    dispatch(
      updateMultiSelectedBlocks([
        {
          armorIndex: targetArmorIndex,
          partIndex: targetPartIndex,
          blockIndex: firstColorIndex === -1 ? 0 : firstColorIndex,
        },
      ]),
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
