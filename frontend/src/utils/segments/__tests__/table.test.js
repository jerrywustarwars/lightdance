/**
 * 光表層級操作的測試。
 *
 * 這一層的正確性有兩面：**改對了東西**，以及**沒改到的東西 reference 不變**。
 * 後者不是最佳化——逐部位訂閱與 `React.memo` 全靠 reference 判斷「我這條有沒有
 * 變」，一次編輯若讓整張表逐層重建，154 條 Timeline 與 7 個 Armor 會全部重繪。
 * 那在功能測試裡完全看不出來，只有手感上會發現拖曳開始卡。
 */
import { describe, it, expect } from "vitest";

import {
  updateParts,
  mapSelectedParts,
  partsOfSelection,
} from "../table.js";

/** 3 位舞者 × 4 個部位，每格放一個可辨識的 segment */
const makeTable = () =>
  Array.from({ length: 3 }, (_, a) =>
    Array.from({ length: 4 }, (_, p) => [
      { id: `s-${a}-${p}`, start: 0, end: 1000, colorStart: { A: 1 } },
    ]),
  );

const group = (armorIndex, partIndex, ...ids) => ({
  armorIndex,
  partIndex,
  segmentIds: new Set(ids),
});

describe("updateParts", () => {
  it("換掉指定的部位，其餘保持原 reference", () => {
    const table = makeTable();
    const next = updateParts(table, [
      { armorIndex: 1, partIndex: 2, segments: [] },
    ]);

    expect(next[1][2]).toEqual([]);
    // 同一位舞者的其他部位：陣列本身沒換
    expect(next[1][0]).toBe(table[1][0]);
    // 完全沒被動到的舞者：整列沿用
    expect(next[0]).toBe(table[0]);
    expect(next[2]).toBe(table[2]);
  });

  it("一次換好幾條，包含同一位舞者的兩個部位", () => {
    const table = makeTable();
    const next = updateParts(table, [
      { armorIndex: 0, partIndex: 1, segments: [] },
      { armorIndex: 0, partIndex: 3, segments: [] },
      { armorIndex: 2, partIndex: 0, segments: [] },
    ]);

    expect(next[0][1]).toEqual([]);
    expect(next[0][3]).toEqual([]);
    expect(next[2][0]).toEqual([]);
    expect(next[0][0]).toBe(table[0][0]);
    expect(next[1]).toBe(table[1]);
  });

  it("沒有任何一條真的改變時回傳原表", () => {
    const table = makeTable();

    expect(updateParts(table, [])).toBe(table);
    // 傳的是原本那個陣列 = 沒變
    expect(
      updateParts(table, [
        { armorIndex: 0, partIndex: 0, segments: table[0][0] },
      ]),
    ).toBe(table);
  });

  it("指到不存在的部位時跳過，不會長出新欄位", () => {
    const table = makeTable();
    const next = updateParts(table, [
      { armorIndex: 9, partIndex: 0, segments: [] },
      { armorIndex: 0, partIndex: 99, segments: [] },
    ]);

    expect(next).toBe(table);
    expect(next.length).toBe(3);
    expect(next[0].length).toBe(4);
  });
});

describe("mapSelectedParts", () => {
  it("選取跨軌時，每一條各跑一次", () => {
    const table = makeTable();
    const seen = [];

    const next = mapSelectedParts(
      table,
      [group(0, 0, "s-0-0"), group(2, 3, "s-2-3")],
      (segments, ids, where) => {
        seen.push(where);
        return segments.filter((segment) => !ids.has(segment.id));
      },
    );

    expect(seen).toEqual([
      { armorIndex: 0, partIndex: 0 },
      { armorIndex: 2, partIndex: 3 },
    ]);
    expect(next[0][0]).toEqual([]);
    expect(next[2][3]).toEqual([]);
    // 沒被選到的那幾條完全沒動
    expect(next[1]).toBe(table[1]);
    expect(next[0][1]).toBe(table[0][1]);
  });

  it("fn 回傳原陣列的那幾條不算改變", () => {
    const table = makeTable();
    const next = mapSelectedParts(
      table,
      [group(0, 0, "s-0-0"), group(1, 1, "s-1-1")],
      (segments, ids, where) =>
        where.armorIndex === 0 ? [] : segments, // 只有第一條真的改
    );

    expect(next[0][0]).toEqual([]);
    expect(next[1]).toBe(table[1]);
  });

  it("每一條都沒變時回傳原表（呼叫端才不會佔一格 undo）", () => {
    const table = makeTable();
    expect(
      mapSelectedParts(table, [group(0, 0, "s-0-0")], (segments) => segments),
    ).toBe(table);
  });

  it("沒有選取時回傳原表", () => {
    const table = makeTable();
    expect(mapSelectedParts(table, [], () => [])).toBe(table);
  });

  it("id 集合是空的（只選了軌、沒選色塊）時 fn 照樣收到那一條", () => {
    const table = makeTable();
    const seen = [];

    mapSelectedParts(table, [group(0, 2)], (segments, ids, where) => {
      seen.push({ ...where, size: ids.size });
      return segments;
    });

    // 「在播放頭放一個色塊」要的是部位而不是色塊，所以空集合不能被濾掉
    expect(seen).toEqual([{ armorIndex: 0, partIndex: 2, size: 0 }]);
  });
});

describe("partsOfSelection", () => {
  it("附上每一條的內容", () => {
    const table = makeTable();
    const parts = partsOfSelection(table, [group(1, 1, "s-1-1")]);

    expect(parts).toHaveLength(1);
    expect(parts[0].segments).toBe(table[1][1]);
  });

  it("指不到的部位直接略過（選取可能是 undo 之前的）", () => {
    const table = makeTable();
    expect(partsOfSelection(table, [group(9, 9, "x")])).toEqual([]);
  });
});
