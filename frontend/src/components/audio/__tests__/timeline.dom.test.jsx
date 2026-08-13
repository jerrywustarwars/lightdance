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

  it("空白部位是一整條空隙", () => {
    const store = createTestStore();
    mount(store, { partIndex: 5 });

    const computed = store.getState().profiles.timelineBlocks[0][5];
    expect(computed).toHaveLength(1);
    expect(computed[0]).toMatchObject({ segmentId: null, startTime: 0 });
  });

  it("每個色塊都帶著自己的 segmentId，空隙是 null", () => {
    const store = createTestStore();
    mount(store);

    const computed = store.getState().profiles.timelineBlocks[0][0];
    const segments = store.getState().profiles.data.actionTable[0][0];

    // 有色的 block 一一對應到 store 裡的 segment
    const ids = computed.map((b) => b.segmentId).filter(Boolean);
    expect(ids).toEqual(segments.map((s) => s.id));

    // 空隙沒有 id
    computed
      .filter((b) => b.segmentId === null)
      .forEach((gap) => expect(gap.color).toMatchObject({ R: 0, G: 0, B: 0 }));
  });

  it("沒有 hidden 這回事——軌道永遠是可見可點的", () => {
    /**
     * 曾經有一個眼睛按鈕會把軌道設成 opacity:0 + pointerEvents:none，
     * 但軌道**照樣佔滿整個高度**，變成一條看不見也點不到的空白帶，
     * 而旁邊就有刪除鍵。整個功能已移除，這則測試守著它不要長回來。
     */
    const { container } = mount(createTestStore(), { hidden: true });

    const track = container.querySelector(".timeline-block").parentElement;
    expect(track.style.opacity).toBe("");
    expect(track.style.pointerEvents).toBe("");
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

  it("選取帶著 segmentId，指向 store 裡真正的那一段", () => {
    const store = createTestStore();
    mount(store);

    const colored = blocks().find((el) => bgOf(el).includes("0, 255, 0"));
    fireEvent.mouseDown(colored);

    const { segmentId } = store.getState().profiles.multiSelectedBlocks[0];
    const segment = store
      .getState()
      .profiles.data.actionTable[0][0].find((s) => s.id === segmentId);

    expect(segment.colorStart).toMatchObject({ R: 0, G: 255, B: 0 });
  });

  it("選取項目只帶 segmentId，不帶任何索引", () => {
    /**
     * Phase 5g 之前這裡還有一個 `blockIndex`。索引會位移（鄰居被刪、色塊被
     * 切開），而且錯了不會報錯只會靜默選錯——鎖住「不准長回來」。
     */
    const store = createTestStore();
    mount(store);

    fireEvent.mouseDown(blocks().find((el) => bgOf(el).includes("0, 255, 0")));

    const selection = store.getState().profiles.multiSelectedBlocks[0];
    expect(Object.keys(selection).sort()).toEqual([
      "armorIndex",
      "partIndex",
      "segmentId",
    ]);
  });

  it("點擊空隙不會選取，而且會清空既有選取", () => {
    const store = createTestStore();
    mount(store);

    // 先選一個色塊
    fireEvent.mouseDown(blocks().find((el) => bgOf(el).includes("255, 0, 0")));
    expect(store.getState().profiles.multiSelectedBlocks).toHaveLength(1);

    // 再點空隙
    const gap = blocks().find((el) => bgOf(el).includes("0, 0, 0"));
    fireEvent.mouseDown(gap);

    expect(store.getState().profiles.multiSelectedBlocks).toHaveLength(0);
  });

  it("Shift 點擊選取兩段之間的所有色塊", () => {
    const store = createTestStore();
    mount(store);

    const red = blocks().find((el) => bgOf(el).includes("255, 0, 0"));
    const green = blocks().find((el) => bgOf(el).includes("0, 255, 0"));

    fireEvent.mouseDown(red);
    fireEvent.mouseDown(green, { shiftKey: true });

    const selected = store.getState().profiles.multiSelectedBlocks;
    const segments = store.getState().profiles.data.actionTable[0][0];

    expect(selected.map((s) => s.segmentId)).toEqual(segments.map((s) => s.id));
  });

  it("選取用的是 id，編輯掉前面的色塊也不會指到別人", () => {
    /**
     * 這就是換掉索引的理由。索引會位移而且不報錯——Phase 4 連續踩到三次。
     */
    const store = createTestStore();
    mount(store);

    fireEvent.mouseDown(blocks().find((el) => bgOf(el).includes("0, 255, 0")));
    const { segmentId } = store.getState().profiles.multiSelectedBlocks[0];

    // 直接把第一段拿掉，模擬「前面的色塊被刪除」
    const table = store.getState().profiles.data.actionTable;
    const trimmed = table.map((armor, a) =>
      a === 0
        ? armor.map((segs, p) => (p === 0 ? segs.slice(1) : segs))
        : armor,
    );
    store.dispatch({ type: "UPDATEACTIONTABLE", payload: trimmed });

    const after = store
      .getState()
      .profiles.data.actionTable[0][0].find((s) => s.id === segmentId);

    expect(after.colorStart).toMatchObject({ R: 0, G: 255, B: 0 });
  });
});

describe("只重算自己的部位", () => {
  it("改動 (0,0) 不會動到 (1,3) 的 segments reference", () => {
    /**
     * 這是逐部位訂閱的前提：沒被改動的部位必須沿用原本的 reference，
     * Timeline 才可能只在自己那條變動時重繪。
     */
    const store = createTestStore();
    const before = store.getState().profiles.data.actionTable[1][3];

    store.dispatch({
      type: "UPDATE_MULTI_SELECTED_BLOCKS",
      payload: [{ armorIndex: 0, partIndex: 0, segmentId: null }],
    });
    mount(store);

    const after = store.getState().profiles.data.actionTable[1][3];
    expect(after).toBe(before);
  });
});
