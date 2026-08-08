import { describe, it, expect } from "vitest";
import { fireEvent } from "@testing-library/react";

import Armor from "../Armor.jsx";
import {
  renderWithStore,
  createTestStore,
  timelineOf,
} from "../../test/renderEditor.jsx";

/**
 * 光衣放色的冒煙測試。
 *
 * Phase 1 把三份重複的 insertArray 合併成 utils/actionTable/insertColorKeyframes.js，
 * 當時是用 20,000 組隨機輸入證明純函式等價；但「點擊 SVG → dispatch → state 變動」
 * 這條線只有這裡守得住。
 */

/** 點擊光衣上代表某部位的圖形。部位 0（帽子）是最上面的 path。 */
const clickPart = (container, index) => {
  const shapes = container.querySelectorAll("svg [fill]:not([fill='none'])");
  fireEvent.click(shapes[index]);
};

describe("Armor 放色", () => {
  it("點擊部位會在該部位的時間軸插入選定顏色", () => {
    const store = createTestStore({
      currentTime: 5000,
      chosenColor: { R: 10, G: 20, B: 30, A: 1 },
    });
    const { container } = renderWithStore(<Armor index={0} />, { store });

    const before = timelineOf(store, 0, 0).length;
    clickPart(container, 0);
    const after = timelineOf(store, 0, 0);

    expect(after.length).toBeGreaterThan(before);
    expect(
      after.some(
        (entry) =>
          entry.color.R === 10 && entry.color.G === 20 && entry.color.B === 30,
      ),
    ).toBe(true);
  });

  it("插入時間對齊到 tick 網格", () => {
    const store = createTestStore({
      currentTime: 5017,
      chosenColor: { R: 10, G: 20, B: 30, A: 1 },
    });
    const { container } = renderWithStore(<Armor index={0} />, { store });

    clickPart(container, 0);

    const inserted = timelineOf(store, 0, 0).find(
      (entry) => entry.color.R === 10,
    );
    expect(inserted.time).toBe(5000);
    // 播放位置也會被對齊
    expect(store.getState().profiles.currentTime).toBe(5000);
  });

  it("時間軸永遠保持依時間排序", () => {
    const store = createTestStore({
      currentTime: 1500,
      chosenColor: { R: 1, G: 2, B: 3, A: 1 },
    });
    const { container } = renderWithStore(<Armor index={0} />, { store });

    clickPart(container, 0);

    const times = timelineOf(store, 0, 0).map((entry) => entry.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("只改動被點擊的舞者與部位", () => {
    const store = createTestStore({
      currentTime: 5000,
      chosenColor: { R: 10, G: 20, B: 30, A: 1 },
    });
    const otherBefore = JSON.stringify(timelineOf(store, 1, 0));
    const samePlayerOtherPart = JSON.stringify(timelineOf(store, 0, 5));

    const { container } = renderWithStore(<Armor index={0} />, { store });
    clickPart(container, 0);

    expect(JSON.stringify(timelineOf(store, 1, 0))).toBe(otherBefore);
    expect(JSON.stringify(timelineOf(store, 0, 5))).toBe(samePlayerOtherPart);
  });
});
