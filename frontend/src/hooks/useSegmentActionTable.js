import { useCallback, useMemo } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";

import { updateActionTable } from "../redux/actions.js";

/**
 * segment 原生的光表存取 —— **全專案唯一的光表讀寫入口**。
 *
 * Phase 4 到 5f 之間還有一個 `useKeyframeActionTable` 轉接橋，讓還在用
 * keyframe 思考的舊程式碼能繼續運作；每次讀寫都要在兩種形狀之間來回轉一趟，
 * 而來回轉換會讓 segment 的 id 漂移。5g 把最後兩個使用者改完之後那個檔案
 * 已經刪除，現在讀寫都是 store 裡原本的東西，轉換成本歸零。
 *
 * 三種粒度，選最小的那個：
 *
 * | hook | 訂閱範圍 | 用在 |
 * |---|---|---|
 * | `useSegmentPartTimeline` | 一個部位 | Timeline |
 * | `useSegmentArmorTimelines` | 一位舞者的所有部位 | Armor、AccessoryPanel |
 * | `useSegmentActionTable` | 整張表 | 跨部位的操作（複製貼上、平移） |
 *
 * 粒度不是潔癖：訂閱整張表的元件，任何地方的一次編輯都會讓它重算。實測
 * （見 `docs/frontend-rendering-optimization.md`）逐部位訂閱後，一次編輯
 * 只需重算 1/154 條時間軸。
 */

/** 穩定的空陣列，避免 selector 每次回傳新的 `[]` 造成無謂重繪 */
const EMPTY = Object.freeze([]);

/**
 * 把單一部位的新 segments 併回整張表，其餘部位維持原 reference。
 *
 * 結構共享是 memo 與逐部位訂閱能生效的前提：只有真的被改動的那條
 * 時間軸換掉 reference，其他 153 條的訂閱者完全不會被喚醒。
 */
const replacePart = (table, armorIndex, partIndex, nextSegments) =>
  table.map((armor, a) =>
    a === armorIndex
      ? armor.map((segments, p) => (p === partIndex ? nextSegments : segments))
      : armor,
  );

/**
 * 一個部位的 segments，以及只寫回這個部位的 commit。
 *
 * `commitPart` 從 store 現讀整張表而不是用 render 時捕捉到的版本——呼叫端
 * 常在拖曳結束或非同步流程之後才 commit，捕捉到的表可能已經過期。
 */
export function useSegmentPartTimeline(armorIndex, partIndex) {
  const dispatch = useDispatch();
  // 從 Provider 拿 store，不要 import 模組層 singleton（測試會是另一個 instance）
  const store = useStore();
  const segments = useSelector(
    (state) => state.profiles.data?.actionTable?.[armorIndex]?.[partIndex],
  );

  const commitPart = useCallback(
    (nextSegments, meta) => {
      const state = store.getState().profiles;
      const current = state.data.actionTable?.[armorIndex]?.[partIndex];
      if (nextSegments === current) return; // 什麼都沒改，不佔一格 undo

      dispatch(
        updateActionTable(
          replacePart(
            state.data.actionTable,
            armorIndex,
            partIndex,
            nextSegments,
          ),
          meta,
        ),
      );
    },
    [dispatch, store, armorIndex, partIndex],
  );

  return { segments: segments ?? EMPTY, commitPart };
}

/**
 * 一位舞者所有部位的 segments。
 *
 * Armor 與 AccessoryPanel 要同時顯示整套光衣，所以粒度是「舞者」而非「部位」。
 */
export function useSegmentArmorTimelines(armorIndex) {
  const dispatch = useDispatch();
  const store = useStore();
  const armorSegments = useSelector(
    (state) => state.profiles.data?.actionTable?.[armorIndex],
  );

  const commitPart = useCallback(
    (partIndex, nextSegments, meta) => {
      const state = store.getState().profiles;
      const current = state.data.actionTable?.[armorIndex]?.[partIndex];
      if (nextSegments === current) return;

      dispatch(
        updateActionTable(
          replacePart(
            state.data.actionTable,
            armorIndex,
            partIndex,
            nextSegments,
          ),
          meta,
        ),
      );
    },
    [dispatch, store, armorIndex],
  );

  return { armorSegments: armorSegments ?? EMPTY, commitPart };
}

/**
 * 整張 segment 表，以及寫回整張表的 commit。
 *
 * 給真正需要跨部位的操作用（複製貼上、區間平移）。單一部位的編輯請用
 * `useSegmentPartTimeline`，否則會被整張表的 reference 變動打到。
 */
export function useSegmentActionTable() {
  const dispatch = useDispatch();
  const store = useStore();
  const segmentTable = useSelector((state) => state.profiles.data?.actionTable);
  const duration = useSelector((state) => state.profiles.duration);

  const table = useMemo(() => segmentTable ?? EMPTY, [segmentTable]);

  const commit = useCallback(
    (nextTable, meta) => {
      const current = store.getState().profiles.data.actionTable;
      if (nextTable === current) return;
      dispatch(updateActionTable(nextTable, meta));
    },
    [dispatch, store],
  );

  /** 只改一個部位時的捷徑，維持其餘部位的 reference */
  const commitPart = useCallback(
    (armorIndex, partIndex, nextSegments, meta) => {
      const state = store.getState().profiles;
      const current = state.data.actionTable?.[armorIndex]?.[partIndex];
      if (nextSegments === current) return;

      dispatch(
        updateActionTable(
          replacePart(
            state.data.actionTable,
            armorIndex,
            partIndex,
            nextSegments,
          ),
          meta,
        ),
      );
    },
    [dispatch, store],
  );

  return { segmentTable: table, duration, commit, commitPart };
}

export default useSegmentActionTable;
