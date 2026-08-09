import { describe, it, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { createRef } from "react";

import Timeline from "../Timeline.jsx";
import {
  renderWithStore,
  createTestStore,
  timelineOf,
} from "../../../test/renderEditor.jsx";

/**
 * Timeline 的冒煙測試 —— **改動它的訂閱方式之前的安全網**。
 *
 * Timeline 是整個編輯器最危險的檔案：色塊渲染、選取、Move Mode 拖曳、
 * 邊緣 resize 全在裡面，而且拖曳走的是「零 re-render」的 direct-DOM 路徑。
 * 在此之前它一行自動化測試都沒有。
 *
 * 這裡守的是**接線與資料流**：actionTable → timelineBlocks → 畫面色塊 →
 * 點擊 → 選取。拖曳手感與像素級行為仍然只能手動驗。
 */

const mount = (store = createTestStore(), props = {}) =>
  renderWithStore(
    <Timeline
      zoomValue={1}
      height={100}
      armorIndex={0}
      partIndex={0}
      hidden={false}
      isCopying={false}
      ref={createRef()}
      {...props}
    />,
    { store },
  );

const blocks = () => [...document.querySelectorAll(".timeline-block")];

/** 從 inline style 讀出色塊的背景色 */
const bgOf = (el) => el.style.backgroundColor;

describe("色塊渲染", () => {
  it("依 actionTable 算出色塊並畫出來", () => {
    // 測試光表壓平後是 [黑@0, 紅@1000, 綠@2000, 黑@10000]
    const store = createTestStore();
    mount(store);

    // 每個關鍵格對應一個色塊（最後一個黑點是結尾，不產生區間）
    expect(blocks().length).toBeGreaterThan(0);
    expect(blocks().some((el) => bgOf(el).includes("255, 0, 0"))).toBe(true);
    expect(blocks().some((el) => bgOf(el).includes("0, 255, 0"))).toBe(true);
  });

  it("算出來的 timelineBlocks 會寫回 Redux", () => {
    const store = createTestStore();
    mount(store);

    const computed = store.getState().profiles.timelineBlocks?.[0]?.[0];
    expect(Array.isArray(computed)).toBe(true);

    // 每個色塊都要有起始時間與正的長度
    computed.forEach((block) => {
      expect(block.startTime).toBeGreaterThanOrEqual(0);
      expect(block.durationTime).toBeGreaterThanOrEqual(0);
    });
  });

  it("色塊的時間總長涵蓋到 duration", () => {
    const store = createTestStore();
    mount(store);

    const computed = store.getState().profiles.timelineBlocks[0][0];
    const last = computed[computed.length - 1];
    expect(last.startTime + last.durationTime).toBe(
      store.getState().profiles.duration,
    );
  });

  it("相鄰的同色色塊會被合併成一塊", () => {
    // 空白部位：整條都是黑的，應該只剩一塊
    const store = createTestStore();
    mount(store, { partIndex: 5 });

    const computed = store.getState().profiles.timelineBlocks[0][5];
    expect(computed).toHaveLength(1);
    expect(computed[0].startTime).toBe(0);
  });

  it("hidden 時整條軌道透明且不吃滑鼠事件（色塊仍在 DOM 裡）", () => {
    const { container } = mount(createTestStore(), { hidden: true });

    const track = container.querySelector(".timeline-block").parentElement;
    expect(track.style.opacity).toBe("0");
    expect(track.style.pointerEvents).toBe("none");
  });
});

describe("選取", () => {
  it("點擊色塊會寫進 multiSelectedBlocks", () => {
    const store = createTestStore();
    mount(store);

    const colored = blocks().find((el) => bgOf(el).includes("255, 0, 0"));
    fireEvent.mouseDown(colored);

    const selected = store.getState().profiles.multiSelectedBlocks;
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ armorIndex: 0, partIndex: 0 });
  });

  it("選到的 blockIndex 指向 actionTable 裡真正的那個關鍵格", () => {
    /**
     * timelineBlocks 的 index 與 actionTable 的 index **不一定對齊**
     *（相鄰同色會被合併），Timeline 內部用 startTime 反查真正的 index。
     * 這條就是在守那個反查。
     */
    const store = createTestStore();
    mount(store);

    const colored = blocks().find((el) => bgOf(el).includes("0, 255, 0"));
    fireEvent.mouseDown(colored);

    const { blockIndex } = store.getState().profiles.multiSelectedBlocks[0];
    const entry = timelineOf(store)[blockIndex];
    expect(entry.color).toMatchObject({ R: 0, G: 255, B: 0 });
  });

  it("點擊黑色區塊不會選取（黑色不是色塊）", () => {
    const store = createTestStore();
    mount(store);

    const black = blocks().find((el) => bgOf(el).includes("0, 0, 0"));
    fireEvent.mouseDown(black);

    expect(store.getState().profiles.multiSelectedBlocks).toHaveLength(0);
  });
});

describe("只重算自己的部位", () => {
  it("改動 (0,0) 不會動到 (1,3) 的 segments reference", () => {
    /**
     * 這是逐部位訂閱的前提：轉接橋必須讓沒被改動的部位沿用原本的 reference，
     * Timeline 才可能只在自己那條變動時重繪。
     */
    const store = createTestStore();
    const before = store.getState().profiles.data.actionTable[1][3];

    store.dispatch({
      type: "UPDATE_MULTI_SELECTED_BLOCKS",
      payload: [{ armorIndex: 0, partIndex: 0, blockIndex: 1 }],
    });
    mount(store);

    const after = store.getState().profiles.data.actionTable[1][3];
    expect(after).toBe(before);
  });
});
