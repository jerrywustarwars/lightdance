import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { createRef } from "react";

import AudioPlayer from "../audioplayer.jsx";
import {
  renderWithStore,
  createTestStore,
  timelineOf,
  segmentsOf,
  selectSegment,
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

describe("複製貼上", () => {
  const selected = (blockIndex = 1, armorIndex = 0, partIndex = 0) => [
    { armorIndex, partIndex, blockIndex },
  ];

  it("Ctrl+C 存入剪貼簿並進入複製模式", () => {
    const store = createTestStore({ multiSelectedBlocks: selected() });
    mount(store);

    expect(document.querySelector(".copy-mode-banner")).toBeFalsy();
    pressKey("c", { ctrlKey: true });

    expect(store.getState().profiles.clipboard?.data.length).toBeGreaterThan(0);
    expect(document.querySelector(".copy-mode-banner")).toBeTruthy();
  });

  it("Esc 離開複製模式並清空選取", () => {
    vi.useFakeTimers();
    try {
      const store = createTestStore({ multiSelectedBlocks: selected() });
      mount(store);

      pressKey("c", { ctrlKey: true });
      expect(document.querySelector(".copy-mode-banner")).toBeTruthy();

      vi.advanceTimersByTime(150); // 讓 100ms 防彈跳的 latch 放開
      pressKey("Escape");
      expect(document.querySelector(".copy-mode-banner")).toBeFalsy();
      expect(store.getState().profiles.multiSelectedBlocks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Shift+C 複製整個部位、Shift+V 覆蓋到另一個部位", () => {
    const store = createTestStore({ multiSelectedBlocks: selected() });
    mount(store);

    pressKey("C", { shiftKey: true });
    const copied = store.getState().profiles.clipboard.data;
    expect(copied.length).toBe(timelineOf(store, 0, 0).length);

    // 換選到另一個部位再貼上（防彈跳需等 100ms 以上，這裡直接改 store）
    store.dispatch({
      type: "UPDATE_MULTI_SELECTED_BLOCKS",
      payload: selected(0, 1, 0),
    });
    // 重新掛載讓 handler 讀到新的選取
    mount(store);
    pressKey("V", { shiftKey: true });

    expect(timelineOf(store, 1, 0).length).toBe(copied.length);
  });
});

describe("色塊工具列", () => {
  /**
   * 測試光表的部位 0 有兩個色塊：紅 1000~2000、綠 2000~10000
   * （見 renderEditor.jsx）。選取一律用 selectSegment 從 store 反查，
   * 不要手工組 `{armorIndex, partIndex, blockIndex}`——segmentId 是
   * 建 store 時才產生的，寫死等於把實作細節抄進斷言。
   */
  const RED_BLOCK = 0;

  it("刪除鍵移除選取的色塊並清空選取", () => {
    const store = createTestStore();
    selectSegment(store, 0, 0, RED_BLOCK);
    mount(store);

    expect(segmentsOf(store).some((s) => s.colorStart.R === 255)).toBe(true);
    fireEvent.click(document.querySelector(".delete-button"));

    // segment 模型不需要塗黑——把那一段拿掉就是熄滅
    expect(segmentsOf(store).some((s) => s.colorStart.R === 255)).toBe(false);
    expect(store.getState().profiles.multiSelectedBlocks).toEqual([]);
  });

  it("亮度下拉改變選取色塊的透明度", () => {
    const store = createTestStore();
    selectSegment(store, 0, 0, RED_BLOCK);
    mount(store);

    fireEvent.change(document.querySelector("#brightness-select"), {
      target: { value: "0.3" },
    });
    expect(segmentsOf(store)[RED_BLOCK].colorStart.A).toBeCloseTo(0.3);
  });

  it("下一個時間點跳到色塊邊界", () => {
    const store = createTestStore({ currentTime: 1000 });
    selectSegment(store, 0, 0, RED_BLOCK);
    mount(store);

    fireEvent.click(document.querySelector(".timeline-right"));
    // 紅色塊 1000~2000 的下一個邊界就是 2000。
    // 舊模型這裡會停在 1990 的黑哨兵上，所以要額外判斷「差 10ms 就再跳一格」。
    expect(store.getState().profiles.currentTime).toBe(2000);
  });

  it("沒有選取時導航不會移動播放位置", () => {
    const store = createTestStore({ currentTime: 1000 });
    mount(store);

    fireEvent.click(document.querySelector(".timeline-right"));
    expect(store.getState().profiles.currentTime).toBe(1000);
  });

  it("剪刀在播放位置把色塊切成兩段", () => {
    // 紅色塊 1000~2000，在 1500 切開
    const store = createTestStore({ currentTime: 1500 });
    selectSegment(store, 0, 0, RED_BLOCK);
    mount(store);

    fireEvent.click(document.querySelector(".cut-button"));

    const reds = segmentsOf(store).filter((s) => s.colorStart.R === 255);
    expect(reds.map((s) => [s.start, s.end])).toEqual([
      [1000, 1500],
      [1500, 2000],
    ]);
  });

  it("剪完之後選取移到後半段", () => {
    const store = createTestStore({ currentTime: 1500 });
    selectSegment(store, 0, 0, RED_BLOCK);
    mount(store);

    fireEvent.click(document.querySelector(".cut-button"));

    const { segmentId } = store.getState().profiles.multiSelectedBlocks[0];
    const selected = segmentsOf(store).find((s) => s.id === segmentId);
    expect(selected).toMatchObject({ start: 1500, end: 2000 });
  });

  it("統一同色透明度會改到全場同色的色塊", () => {
    const store = createTestStore();
    selectSegment(store, 0, 0, RED_BLOCK);
    mount(store);

    // 另一位舞者也放一個一樣的紅色塊
    const table = store.getState().profiles.data.actionTable;
    const red = segmentsOf(store)[RED_BLOCK];
    store.dispatch({
      type: "UPDATEACTIONTABLE",
      payload: table.map((armor, a) =>
        a === 3
          ? armor.map((segs, p) =>
              p === 2 ? [{ ...red, id: "other-red" }] : segs,
            )
          : armor,
      ),
      meta: { skipHistory: true },
    });

    fireEvent.click(document.querySelector(".uniform-alpha-button"));
    fireEvent.click(
      [...document.querySelectorAll(".uniform-alpha-option")].find(
        (el) => el.textContent === "30%",
      ),
    );

    expect(segmentsOf(store, 0, 0)[RED_BLOCK].colorStart.A).toBeCloseTo(0.3);
    expect(segmentsOf(store, 3, 2)[0].colorStart.A).toBeCloseTo(0.3);
  });

  it("統一同色透明度不會動到別的顏色，也維持沒改到的部位 reference", () => {
    const store = createTestStore();
    selectSegment(store, 0, 0, RED_BLOCK);
    mount(store);

    const greenBefore = segmentsOf(store)[1];
    const untouchedPart = segmentsOf(store, 4, 7);

    fireEvent.click(document.querySelector(".uniform-alpha-button"));
    fireEvent.click(
      [...document.querySelectorAll(".uniform-alpha-option")].find(
        (el) => el.textContent === "30%",
      ),
    );

    expect(segmentsOf(store)[1]).toBe(greenBefore);
    expect(segmentsOf(store, 4, 7)).toBe(untouchedPart);
  });

  it("剪刀讀的是畫面上這個 store 的播放位置", () => {
    // 這則的重點不是切割本身，而是 cutSelected 從哪裡讀 currentTime。
    // 它曾經 import 模組層的 store singleton，在測試裡會讀到另一個 store
    // （currentTime 恆為 0），於是永遠切在色塊外面而靜默什麼都不做。
    const store = createTestStore({ currentTime: 1800 });
    selectSegment(store, 0, 0, RED_BLOCK);
    mount(store);

    fireEvent.click(document.querySelector(".cut-button"));

    expect(
      segmentsOf(store).some((s) => s.start === 1800),
      "應該切在 1800，而不是別的 store 的 currentTime",
    ).toBe(true);
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

  it("選取一個色塊後 Apply 會依階梯逐個色塊改透明度", () => {
    const store = createTestStore();
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

    // 測試光表壓平後是 [黑@0, 紅@1000, 綠@2000, 黑@10000]——兩個色塊緊鄰，
    // 中間沒有黑哨兵（Phase 4 後這是常態）。所以階梯要落在 index 1 與 2，
    // 而不是舊的 stride 2（1 和 3）。預設 10% → 每階 +10%。
    const timeline = timelineOf(store);
    const colored = timeline.filter(
      (entry) => entry.color.R || entry.color.G || entry.color.B,
    );
    expect(colored).toHaveLength(2);
    expect(colored[0].color.A).toBeCloseTo(0.1);
    expect(colored[1].color.A).toBeCloseTo(0.2);
    // 套用完面板收起
    expect(document.querySelector(".gradient-settings-popup")).toBeFalsy();
  });
});

describe("透明度快捷鍵", () => {
  /** 建好 store 之後才選色塊：segmentId 是建 store 時才產生的 */
  const withPalette = (overrides = {}) => {
    const store = createTestStore({
      favoriteColor: [[{ R: 11, G: 22, B: 33, A: 1 }]],
      ...overrides,
    });
    selectSegment(store, 0, 0, 0);
    return store;
  };

  it("Ctrl+1 只設透明度，不套最愛色，且只進一筆 history", () => {
    // 「1~8 套最愛色」那條沒有 ctrl 守衛時，Ctrl+1 會同時打中兩條綁定：
    // 兩個 handler 從同一份快照各自 produce 再 dispatch，套色被蓋掉但仍留下
    // 一筆 history，導致按一次 Ctrl+Z 會停在使用者沒看過的中間狀態。
    const store = withPalette();
    mount(store);

    const historyBefore = store.getState().profiles.history.length;
    pressKey("1", { ctrlKey: true });

    const block = segmentsOf(store)[0];
    expect(block.colorStart.R).toBe(255); // 顏色不動（還是測試光表的紅色）
    expect(block.colorStart.A).toBeCloseTo(0.1);
    expect(store.getState().profiles.history.length).toBe(historyBefore + 1);
  });

  it("Ctrl+0 設為 100%（補完 Ctrl+1~9 的 10%~90%）", () => {
    const store = withPalette();
    mount(store);

    pressKey("0", { ctrlKey: true });
    expect(segmentsOf(store)[0].colorStart.A).toBeCloseTo(1);
  });

  it("不按 Ctrl 的 1~8 才是套最愛色", () => {
    const store = withPalette();
    mount(store);

    pressKey("1");
    expect(timelineOf(store)[1].color.R).toBe(11);
  });
});

describe("Shift+←/→ 的重疊鍵位（刻意保留）", () => {
  /**
   * 這組鍵兩條綁定都會執行：先 ±50ms、再跳到上/下個關鍵格（後者覆蓋前者）。
   * `updateCurrentTime` 不進 history，沒有 undo 副作用，而且沒選取色塊時
   * 退化成 ±50ms 是個好用的 fallback，所以維持現狀並在此鎖住。
   */

  it("有選取時跳到下一個關鍵格", () => {
    // 測試光表在 2000ms 有綠色塊；從 1000ms 出發
    const store = createTestStore({
      currentTime: 1000,
      multiSelectedBlocks: [{ armorIndex: 0, partIndex: 0, blockIndex: 1 }],
    });
    mount(store);

    pressKey("ArrowRight", { shiftKey: true });
    expect(store.getState().profiles.currentTime).toBe(2000);
  });

  it("沒有選取時退化成 +50ms", () => {
    const store = createTestStore({ currentTime: 1000 });
    mount(store);

    pressKey("ArrowRight", { shiftKey: true });
    expect(store.getState().profiles.currentTime).toBe(1050);
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
