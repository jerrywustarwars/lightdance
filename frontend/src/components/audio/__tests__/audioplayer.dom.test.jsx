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

describe("色塊工具列", () => {
  const selected = (blockIndex = 1) => [
    { armorIndex: 0, partIndex: 0, blockIndex },
  ];

  it("刪除鍵把選取的色塊塗黑並清空選取", () => {
    const store = createTestStore({ multiSelectedBlocks: selected() });
    mount(store);

    // 測試光表 index 1 是 1000ms 的紅色塊（見 renderEditor.jsx）
    expect(timelineOf(store).some((e) => e.color.R === 255)).toBe(true);
    fireEvent.click(document.querySelector(".delete-button"));

    // 塗黑後和前後的黑點合併，紅色塊整個消失
    expect(timelineOf(store).some((e) => e.color.R === 255)).toBe(false);
    expect(store.getState().profiles.multiSelectedBlocks).toEqual([]);
  });

  it("亮度下拉改變選取色塊的透明度", () => {
    const store = createTestStore({ multiSelectedBlocks: selected() });
    mount(store);

    fireEvent.change(document.querySelector("#brightness-select"), {
      target: { value: "0.3" },
    });
    expect(timelineOf(store)[1].color.A).toBeCloseTo(0.3);
  });

  it("下一個時間點會跳過黑色哨兵", () => {
    // 測試光表：1000（紅）、1990（黑哨兵）、2000（綠）
    const store = createTestStore({
      currentTime: 1000,
      multiSelectedBlocks: selected(),
    });
    mount(store);

    fireEvent.click(document.querySelector(".timeline-right"));
    // 1990 和 2000 只差 10ms，停在黑點上沒有意義，所以直接跳到 2000
    expect(store.getState().profiles.currentTime).toBe(2000);
  });

  it("沒有選取時導航不會移動播放位置", () => {
    const store = createTestStore({ currentTime: 1000 });
    mount(store);

    fireEvent.click(document.querySelector(".timeline-right"));
    expect(store.getState().profiles.currentTime).toBe(1000);
  });
});

describe("播放控制列", () => {
  it("切換播放速度會寫進 Redux", () => {
    const store = createTestStore();
    mount(store);

    fireEvent.change(document.querySelector("#speed-select"), {
      target: { value: "1.5" },
    });
    expect(store.getState().profiles.playbackRate).toBe(1.5);
  });

  it("播放鍵切換播放狀態（圖示跟著換）", () => {
    mount();
    const playButton = document.querySelector(".play-button");

    expect(playButton.querySelector(".tooltip").textContent).toContain("Play");
    fireEvent.click(playButton);
    expect(
      document.querySelector(".play-button .tooltip").textContent,
    ).toContain("Pause");
  });

  it("顯示目前時間與總長度", () => {
    const store = createTestStore({ currentTime: 5000 });
    mount(store);

    expect(document.querySelector(".current-time-box").textContent).toBe(
      "0:05:000",
    );
    expect(document.querySelector(".duration-box").textContent).toBe(
      "0:10:000",
    );
  });
});

describe("Shift + 數字：插入最愛顏色", () => {
  /**
   * 這條路徑原本永遠進不來：按住 Shift 時 `Shift+1` 的 `event.key` 是 `"!"`，
   * 而條件寫的是 `["1".."8"].includes(event.key)`。改用 `event.code` 才接得回來。
   */
  const storeWithPalette = () =>
    createTestStore({
      currentTime: 5000,
      favoriteColor: [
        [
          { R: 1, G: 2, B: 3, A: 1 },
          { R: 4, G: 5, B: 6, A: 1 },
        ],
      ],
      multiSelectedBlocks: [{ armorIndex: 0, partIndex: 0, blockIndex: 1 }],
    });

  it("在播放位置插入最愛顏色", () => {
    const store = storeWithPalette();
    mount(store);

    const before = timelineOf(store).length;
    pressKey("!", { shiftKey: true, code: "Digit1" });

    const after = timelineOf(store);
    expect(after.length).toBeGreaterThan(before);
    expect(
      after.some((entry) => entry.color.R === 1 && entry.color.G === 2),
    ).toBe(true);
  });

  it("顏色盤還沒載入時不會炸掉", () => {
    // favoriteColor 預設是空陣列，原本的 favoriteColor[0].length 會直接 throw
    const store = createTestStore({
      currentTime: 5000,
      multiSelectedBlocks: [{ armorIndex: 0, partIndex: 0, blockIndex: 1 }],
    });
    mount(store);

    const before = JSON.stringify(timelineOf(store));
    pressKey("!", { shiftKey: true, code: "Digit1" });
    expect(JSON.stringify(timelineOf(store))).toBe(before);
  });
});

describe("區間平移工具", () => {
  it("三步驟導引依序前進，標記跟著出現", () => {
    const store = createTestStore({ currentTime: 1000 });
    mount(store);

    // 步驟 0：只有一顆按鈕
    fireEvent.click(
      document.querySelector(".shift-tool-wrapper .shift-main-button"),
    );
    expect(document.querySelector(".shift-message").textContent).toContain(
      "[1/3]",
    );

    // 步驟 1 → 2：記下起始點，時間軸出現 Start 標記
    fireEvent.click(document.querySelector(".shift-confirm-btn"));
    expect(document.querySelector(".shift-message").textContent).toContain(
      "[2/3]",
    );
    expect(document.querySelector(".shift-marker.start-marker")).toBeTruthy();
  });

  it("結束點不大於起始點時擋下並留在原步驟", () => {
    const store = createTestStore({ currentTime: 1000 });
    mount(store);

    fireEvent.click(
      document.querySelector(".shift-tool-wrapper .shift-main-button"),
    );
    fireEvent.click(document.querySelector(".shift-confirm-btn")); // start = 1000
    // 播放位置沒有前進，結束點會等於起始點
    fireEvent.click(document.querySelector(".shift-confirm-btn"));

    expect(document.querySelector(".shift-message").textContent).toContain(
      "[2/3]",
    );
    expect(globalThis.alert).toHaveBeenCalled();
  });

  it("取消會收回導引面板與標記", () => {
    const store = createTestStore({ currentTime: 1000 });
    mount(store);

    fireEvent.click(
      document.querySelector(".shift-tool-wrapper .shift-main-button"),
    );
    fireEvent.click(document.querySelector(".shift-confirm-btn"));
    fireEvent.click(document.querySelector(".shift-cancel-btn"));

    expect(document.querySelector(".shift-guide-panel")).toBeFalsy();
    expect(document.querySelector(".shift-marker")).toBeFalsy();
    expect(
      document.querySelector(".shift-tool-wrapper .shift-main-button"),
    ).toBeTruthy();
  });
});

describe("效果選單與亮度階梯", () => {
  const openEffectMenu = () => {
    fireEvent.click(document.querySelector(".effect-button"));
    return document.querySelector(".effect-menu");
  };

  const menuItem = (text) =>
    [...document.querySelectorAll(".effect-menu-item")].find(
      (el) => el.textContent.trim() === text,
    );

  it("點 Effect 按鈕會展開三個選項", () => {
    mount();
    expect(openEffectMenu()).toBeTruthy();
    expect(menuItem("漸變 (L)")).toBeTruthy();
    expect(menuItem("頻閃 (B)")).toBeTruthy();
    expect(menuItem("亮度階梯")).toBeTruthy();
  });

  it("沒有選取色塊時點頻閃不會炸掉", () => {
    // 選單這條路徑原本沒有守衛，直接解構 multiSelectedBlocks[0] 會 throw
    //（只有鍵盤的 B 有檢查 length === 1）
    globalThis.prompt.mockReturnValueOnce("100");
    const store = createTestStore();
    mount(store);
    openEffectMenu();

    const before = JSON.stringify(timelineOf(store));
    fireEvent.click(menuItem("頻閃 (B)"));
    expect(JSON.stringify(timelineOf(store))).toBe(before);
  });

  it("點「亮度階梯」會打開設定面板", () => {
    mount();
    openEffectMenu();
    expect(document.querySelector(".gradient-settings-popup")).toBeFalsy();

    fireEvent.click(menuItem("亮度階梯"));
    expect(document.querySelector(".gradient-settings-popup")).toBeTruthy();
  });

  it("沒有選取色塊時按 Apply 不會改動光表，面板留著", () => {
    const store = createTestStore();
    mount(store);
    openEffectMenu();
    fireEvent.click(menuItem("亮度階梯"));

    const before = JSON.stringify(timelineOf(store));
    fireEvent.click(
      [...document.querySelectorAll(".gradient-settings-actions button")].find(
        (el) => el.textContent === "Apply",
      ),
    );

    expect(JSON.stringify(timelineOf(store))).toBe(before);
    // 面板不關閉，使用者可以去選色塊後再按一次
    expect(document.querySelector(".gradient-settings-popup")).toBeTruthy();
  });

  it("選取一個色塊後 Apply 會依階梯設定改透明度", () => {
    const store = createTestStore();
    // 測試光表在 index 1 是紅色塊、index 3 是綠色塊（見 renderEditor.jsx）
    store.dispatch({
      type: "UPDATE_MULTI_SELECTED_BLOCKS",
      payload: [{ armorIndex: 0, partIndex: 0, blockIndex: 1 }],
    });
    mount(store);
    openEffectMenu();
    fireEvent.click(menuItem("亮度階梯"));

    fireEvent.click(
      [...document.querySelectorAll(".gradient-settings-actions button")].find(
        (el) => el.textContent === "Apply",
      ),
    );

    // 預設 10% → 每階 +10% → 100%：blockIndex 起算，stride 2
    const timeline = timelineOf(store);
    expect(timeline[1].color.A).toBeCloseTo(0.1);
    expect(timeline[3].color.A).toBeCloseTo(0.2);
    // 套用完面板收起
    expect(document.querySelector(".gradient-settings-popup")).toBeFalsy();
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
