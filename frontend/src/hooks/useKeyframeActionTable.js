import { useCallback, useMemo, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";

import { updateActionTable } from "../redux/actions.js";
import { keyframesToSegments } from "../utils/segments/convert.js";
import {
  toKeyframes,
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
/**
 * 只取**單一部位**的 keyframe 時間軸。
 *
 * `useKeyframeActionTable()` 給的是整張 7×22 的表，任何地方的編輯都會換掉
 * 它的 reference —— 訂閱它的元件就全部跟著重算。但 Timeline / Armor /
 * AccessoryPanel 其實只讀自己那一格。
 *
 * 這個 hook 直接在 selector 裡取到該部位的 segments，只有**那個部位**真的
 * 被改動時 reference 才會變（轉接橋對沒動到的部位沿用原陣列，見
 * `toSegmentTableIncremental`），於是：
 *
 * - 改動舞者 0 部位 0 時，其餘 153 條 Timeline 完全不重算、不重繪
 * - `React.memo(Timeline)` 第一次真正發揮作用
 *
 * 轉換本身是逐部位以 reference 做快取的，所以這裡幾乎沒有額外成本。
 */
export function useKeyframePartTimeline(armorIndex, partIndex) {
  const dispatch = useDispatch();
  // 從 context 取 store，不要 import 那個 module-level singleton——
  // 那會讓元件綁死在單一 store 上（測試就用不了），也是隱藏的耦合。
  const store = useStore();
  const duration = useSelector((state) => state.profiles.duration);
  const segments = useSelector(
    (state) => state.profiles.data?.actionTable?.[armorIndex]?.[partIndex],
  );

  const timeline = useMemo(
    () => (segments ? toKeyframes(segments, duration) : EMPTY_TIMELINE),
    [segments, duration],
  );

  const latest = useRef({ timeline, duration });
  latest.current = { timeline, duration };

  /**
   * 只寫回這一個部位。
   *
   * 從 store 現讀整張表，是為了拿到「dispatch 當下」的版本 —— 呼叫端常常在
   * 拖曳結束、非同步流程之後才 commit，用 render 時捕捉到的表可能已經過期。
   */
  const commitPart = useCallback(
    (nextTimeline, meta) => {
      const { timeline: prev, duration: dur } = latest.current;
      if (nextTimeline === prev) return; // 什麼都沒改，不佔 undo

      const state = store.getState().profiles;
      const nextSegments = keyframesToSegments(nextTimeline, {
        duration: dur ?? state.duration,
      });

      const nextTable = state.data.actionTable.map((armor, a) =>
        a === armorIndex
          ? armor.map((segs, p) => (p === partIndex ? nextSegments : segs))
          : armor,
      );

      dispatch(updateActionTable(nextTable, meta));
    },
    [dispatch, store, armorIndex, partIndex],
  );

  return { timeline, commitPart };
}

/** 穩定的空陣列，避免 selector 每次回傳新的 `[]` 造成無謂重繪 */
const EMPTY_TIMELINE = Object.freeze([]);
const EMPTY_ARMOR = Object.freeze([]);

/**
 * 取**一位舞者的 22 個部位**的 keyframe 時間軸。
 *
 * Armor 與 AccessoryPanel 要同時顯示一整套光衣的顏色，所以粒度是「舞者」
 * 而不是「部位」。轉接橋對沒被動到的舞者會沿用整列 reference，因此編輯
 * 舞者 3 時，舞者 0 的 Armor 完全不會重算 22 個顏色。
 */
export function useKeyframeArmorTimelines(armorIndex) {
  const dispatch = useDispatch();
  const store = useStore();
  const duration = useSelector((state) => state.profiles.duration);
  const armorSegments = useSelector(
    (state) => state.profiles.data?.actionTable?.[armorIndex],
  );

  const timelines = useMemo(
    () =>
      Array.isArray(armorSegments)
        ? armorSegments.map((segments) => toKeyframes(segments, duration))
        : EMPTY_ARMOR,
    [armorSegments, duration],
  );

  const latest = useRef({ timelines, duration });
  latest.current = { timelines, duration };

  /** 只寫回這位舞者的某一個部位 */
  const commitPart = useCallback(
    (partIndex, nextTimeline, meta) => {
      const { timelines: prev, duration: dur } = latest.current;
      if (nextTimeline === prev[partIndex]) return; // 沒改，不佔 undo

      const state = store.getState().profiles;
      const nextSegments = keyframesToSegments(nextTimeline, {
        duration: dur ?? state.duration,
      });

      const nextTable = state.data.actionTable.map((armor, a) =>
        a === armorIndex
          ? armor.map((segs, p) => (p === partIndex ? nextSegments : segs))
          : armor,
      );

      dispatch(updateActionTable(nextTable, meta));
    },
    [dispatch, store, armorIndex],
  );

  return { timelines, commitPart };
}

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
