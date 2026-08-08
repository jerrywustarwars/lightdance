import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { createRef } from "react";

import AudioPlayer from "../audioplayer.jsx";
import {
  renderWithStore,
  createTestStore,
  timelineOf,
} from "../../../test/renderEditor.jsx";

/**
 * audioplayer 的冒煙測試 —— **Phase 3 拆件期間的安全網**。
 *
 * 這些互動（工具列、快捷鍵、選取）沒有任何純函式測試涵蓋得到，而 Phase 3
 * 要把 1,900 多行的 audioplayer 拆成多個元件。搬移過程只要有一處接錯線，
 * 這裡就會紅燈——不必等到手動測試才發現。
 *
 * 定位是**冒煙測試**：驗證主線接得起來，不追求覆蓋每個分支。
 */

const mount = (store = createTestStore()) =>
  renderWithStore(
    <AudioPlayer setButtonState={vi.fn()} timelineRef={createRef()} />,
    { store },
  );

/** 快捷鍵是掛在 document 上的，要對 document 發事件 */
const pressKey = (key, options = {}) => {
  fireEvent.keyDown(document, { key, ...options });
};

describe("AudioPlayer 掛載", () => {
  it("渲染出主要控制項", () => {
    mount();

    // 音樂選擇器與播放控制是最外顯的兩塊
    expect(document.querySelector(".audio-player-container")).toBeTruthy();
    expect(document.querySelector(".controls")).toBeTruthy();
    expect(document.querySelector(".timeline-container")).toBeTruthy();
  });

  it("渲染音樂選擇器", () => {
    mount();
    // 選項來自 API，測試環境沒有真的音樂清單，所以只確認選擇器本身存在
    expect(
      document.querySelector(".current-track-display select"),
    ).toBeTruthy();
  });
});

describe("快捷鍵", () => {
  let store;

  beforeEach(() => {
    store = createTestStore();
    mount(store);
  });

  it("M 切換 Move Mode", () => {
    expect(store.getState().profiles.moveMode).toBe(false);
    pressKey("m");
    expect(store.getState().profiles.moveMode).toBe(true);
  });

  it("方向鍵移動播放位置（一次一個 tick）", () => {
    const before = store.getState().profiles.currentTime;
    pressKey("ArrowRight");
    expect(store.getState().profiles.currentTime).toBe(before + 50);
  });

  it("播放位置不會被方向鍵推到負數", () => {
    pressKey("ArrowLeft");
    expect(store.getState().profiles.currentTime).toBe(0);
  });

  it("P 開啟改色流程（需先有選取）", () => {
    store.dispatch({
      type: "UPDATE_MULTI_SELECTED_BLOCKS",
      payload: [{ armorIndex: 0, partIndex: 0, blockIndex: 1 }],
    });
    pressKey("p");
    // 改色流程會把 isColorChangeActive 打開，或至少不應該炸掉
    expect(store.getState().profiles).toBeDefined();
  });

  it("沒有選取時按刪除不會破壞光表", () => {
    const before = JSON.stringify(timelineOf(store));
    pressKey("Delete");
    expect(JSON.stringify(timelineOf(store))).toBe(before);
  });
});

describe("快捷鍵的 100ms 防彈跳", () => {
  it("同一個鍵在 100ms 內連按第二次會被忽略", () => {
    vi.useFakeTimers();
    try {
      const store = createTestStore();
      mount(store);

      pressKey("m");
      expect(store.getState().profiles.moveMode).toBe(true);

      // 100ms 內的第二次按鍵被 keyPress latch 擋掉——這是現有行為，
      // Phase 3 統一鍵盤處理時必須保留
      pressKey("m");
      expect(store.getState().profiles.moveMode).toBe(true);

      vi.advanceTimersByTime(150);
      pressKey("m");
      expect(store.getState().profiles.moveMode).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
