import { useCallback, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";

import { updateActionTable } from "../redux/actions.js";
import {
  toKeyframeTable,
  toSegmentTableIncremental,
} from "../utils/segments/withKeyframeAdapter.js";

/**
 * `commit` 回傳「寫入後的 keyframe 表」，因為 segment 的來回會改變 keyframe
 * 的索引：黑哨兵在轉成 segment 時被吸收成邊界，緊鄰的色塊之間就不再有黑點。
 * 需要在寫入後定位某個色塊的呼叫端（例如剪下後要選中新的那一半）必須用
 * 這個回傳值查 index，不能自己用 `blockIndex + 2` 算。
 */

/**
 * 讓「還在用 keyframe 思考」的程式碼繼續運作的橋 —— **Phase 4 過渡期**。
 *
 * store 從 Phase 4 起存的是 segments，但編輯器的所有寫入者都還是
 * 「讀 actionTable → immer produce → dispatch」的 keyframe 寫法。
 * 這個 hook 把兩邊接起來，讓每個寫入者只要改兩行：
 *
 * ```diff
 * - const actionTable = useSelector((s) => s.profiles.data?.actionTable);
 * - const dispatch = useDispatch();
 * + const { actionTable, commit } = useKeyframeActionTable();
 *
 *   const updated = produce(actionTable, (draft) => { ... });
 * - dispatch(updateActionTable(updated));
 * + commit(updated);
 * ```
 *
 * @deprecated Phase 5 逐項 segment 原生化後，這個 hook 會隨著最後一個
 * 呼叫端一起消失。
 */
export function useKeyframeActionTable() {
  const dispatch = useDispatch();
  const segmentTable = useSelector((state) => state.profiles.data?.actionTable);
  const duration = useSelector((state) => state.profiles.duration);

  const actionTable = useMemo(
    () => toKeyframeTable(segmentTable, duration),
    [segmentTable, duration],
  );

  // commit 需要知道「這次編輯的基準是哪一份 keyframe 表」才能判斷哪些部位
  // 真的被改動。用 ref 而不是把 actionTable 放進 useCallback 的依賴，
  // 是為了讓 commit 的 identity 穩定（呼叫端常把它放進其他 callback）。
  const latest = useRef({ actionTable, segmentTable, duration });
  latest.current = { actionTable, segmentTable, duration };

  const commit = useCallback(
    (nextKeyframeTable, meta) => {
      const {
        actionTable: prev,
        segmentTable: prevSegments,
        duration: dur,
      } = latest.current;

      const nextSegments = toSegmentTableIncremental(
        nextKeyframeTable,
        prev,
        prevSegments,
        { duration: dur },
      );

      dispatch(updateActionTable(nextSegments, meta));

      // 回傳寫入後的 keyframe 視圖（見檔頭說明）
      return toKeyframeTable(nextSegments, dur);
    },
    [dispatch],
  );

  return { actionTable, commit };
}

export default useKeyframeActionTable;
