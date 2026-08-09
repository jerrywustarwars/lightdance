import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render } from "@testing-library/react";

import profiles from "../redux/reducers/profiles.js";
import { normalizeActionTable } from "../utils/actionTable/normalizeActionTable.js";
import { toSegmentTable } from "../utils/migration/loadProjectData.js";
import { toKeyframeTable } from "../utils/segments/withKeyframeAdapter.js";

/**
 * 元件測試的共用掛載工具。
 *
 * 刻意用**真的 reducer**（不是 mock store）：這些測試要驗證的是
 * 「按鍵/點擊 → dispatch → state 真的變了」這條完整路徑，用 mock store
 * 只會驗證到有沒有呼叫 dispatch，抓不到 reducer 或選取邏輯的漂移。
 *
 * ## Phase 4 之後：store 存 segments，測試仍用 keyframe 描述
 *
 * 測試裡描述光表最直覺的方式還是「幾點幾分是什麼顏色」，而編輯器的寫入者
 * 也都還透過 `useKeyframeActionTable` 用 keyframe 思考。所以這裡：
 *
 * - `makeTestActionTable()` 用 keyframe 寫，掛載前轉成 segments 進 store
 * - `timelineOf()` 把 store 的 segments 轉回 keyframe 再回傳
 *
 * 斷言因此可以維持原樣，同時真的走過一次 segment ↔ keyframe 的來回。
 */

const DURATION = 10000;

/** 產生一張有內容的光表：舞者 0 的部位 0 有一個 1~2 秒的紅色色塊 */
export function makeTestActionTable() {
  const table = normalizeActionTable([], DURATION);
  table[0][0] = [
    { time: 0, color: { R: 0, G: 0, B: 0, A: 1 }, linear: 0 },
    { time: 1000, color: { R: 255, G: 0, B: 0, A: 1 }, linear: 0 },
    { time: 1990, color: { R: 0, G: 0, B: 0, A: 1 }, linear: 0 },
    { time: 2000, color: { R: 0, G: 255, B: 0, A: 1 }, linear: 0 },
    { time: DURATION, color: { R: 0, G: 0, B: 0, A: 1 }, linear: 0 },
  ];
  return table;
}

/** 同一張光表的 segment 形式（store 實際存的東西） */
export function makeTestSegmentTable() {
  return toSegmentTable(makeTestActionTable(), { duration: DURATION });
}

export function createTestStore(overrides = {}) {
  return configureStore({
    reducer: { profiles },
    preloadedState: {
      profiles: {
        ...profiles(undefined, { type: "@@INIT" }),
        duration: DURATION,
        data: {
          music_filename: "2026_show.mp3",
          actionTable: makeTestSegmentTable(),
        },
        ...overrides,
      },
    },
    middleware: (getDefault) =>
      // actionTable 很大且含巢狀物件，序列化/不可變檢查在測試裡只會拖慢速度
      getDefault({ serializableCheck: false, immutableCheck: false }),
  });
}

/** 掛載一個元件並附上真 store，回傳 RTL 的結果加上 store */
export function renderWithStore(ui, { store = createTestStore() } = {}) {
  const result = render(<Provider store={store}>{ui}</Provider>);
  return { ...result, store };
}

/**
 * 取得目前 state 中某個部位的時間軸（**keyframe 形式**），方便斷言編輯結果。
 *
 * store 存的是 segments，這裡轉回 keyframe —— 和編輯器渲染時看到的是同一份。
 */
export const timelineOf = (store, armor = 0, part = 0) => {
  const state = store.getState().profiles;
  return toKeyframeTable(state.data.actionTable, state.duration)[armor][part];
};

/** 取得 store 裡真正的 segments，用來斷言 segment 層的行為 */
export const segmentsOf = (store, armor = 0, part = 0) =>
  store.getState().profiles.data.actionTable[armor][part];

export { DURATION };
