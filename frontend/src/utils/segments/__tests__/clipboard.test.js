/**
 * 剪貼簿與貼上落點的測試。
 *
 * 這裡真正要守住的是**軌道怎麼平移**：貼錯軌不會報錯、不會壞掉，只是燈亮在
 * 別人身上——而排練時沒有人會逐軌對照，通常是彩排當天才發現。
 */
import { describe, it, expect } from "vitest";

import {
  CLIPBOARD_KIND,
  hasContent,
  packClipboard,
  planOverwrite,
  planPaste,
  sourceSelections,
} from "../clipboard.js";

const seg = (id, start, end, extra = {}) => ({
  id,
  start,
  end,
  colorStart: { R: 255, G: 0, B: 0, A: 1 },
  colorEnd: { R: 255, G: 0, B: 0, A: 1 },
  linear: 0,
  ...extra,
});

/** 3 位舞者 × 4 個部位的空表 */
const emptyTable = () =>
  Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => []));

const groupOf = (armorIndex, partIndex, segments) => ({
  armorIndex,
  partIndex,
  segments,
  segmentIds: new Set(segments.map((s) => s.id)),
});

describe("packClipboard", () => {
  it("把跨軌的選取打包成一個矩形", () => {
    const packed = packClipboard(
      [
        groupOf(0, 0, [seg("a", 1000, 2000)]),
        groupOf(1, 0, [seg("b", 1000, 2000), seg("c", 3000, 4000)]),
      ],
      { armorIndex: 0, partIndex: 0 },
    );

    expect(packed.kind).toBe(CLIPBOARD_KIND);
    expect(packed.parts).toHaveLength(2);
    expect(packed.startTime).toBe(1000);
    expect(packed.endTime).toBe(4000);
  });

  it("startTime 是整份內容最早的起點，不是錨點那一條的", () => {
    /*
     * 七位舞者的同一個樂句起點可能差半拍。用錨點那一條當基準的話，Ctrl+V
     * 對齊之後整組會相對目標偏移那半拍——而使用者以為自己貼在選到的色塊上。
     */
    const packed = packClipboard(
      [
        groupOf(0, 0, [seg("late", 2000, 3000)]), // 錨點這一條比較晚
        groupOf(1, 0, [seg("early", 1000, 2000)]),
      ],
      { armorIndex: 0, partIndex: 0 },
    );

    expect(packed.startTime).toBe(1000);
  });

  it("一段都沒選到時回傳 null", () => {
    expect(packClipboard([groupOf(0, 0, [])], { armorIndex: 0, partIndex: 0 }))
      .toBeNull();
    expect(packClipboard([], { armorIndex: 0, partIndex: 0 })).toBeNull();
  });
});

describe("hasContent", () => {
  it("認不得舊格式", () => {
    // Phase 5e 的單軌剪貼簿
    expect(hasContent({ kind: "segments", segments: [seg("a", 0, 1000)] })).toBe(
      false,
    );
    expect(hasContent(null)).toBe(false);
    expect(hasContent({ kind: CLIPBOARD_KIND, parts: [] })).toBe(false);
  });
});

describe("planPaste：軌道的平移", () => {
  const clipboard = packClipboard(
    [
      groupOf(0, 0, [seg("a", 1000, 2000)]),
      groupOf(0, 1, [seg("b", 1000, 2000)]),
    ],
    { armorIndex: 0, partIndex: 0 },
  );

  it("錨點平移到哪，其餘每一條跟著平移同樣的量", () => {
    const plans = planPaste(emptyTable(), clipboard, {
      armorIndex: 2,
      partIndex: 0,
      timeOffset: 0,
    });

    // 來源是 (0,0) 與 (0,1)，錨點 (0,0) → (2,0)，所以差值是 +2 位舞者
    expect(plans.map((p) => [p.armorIndex, p.partIndex])).toEqual([
      [2, 0],
      [2, 1],
    ]);
  });

  it("平移的是二維座標，換部位一樣成立", () => {
    const plans = planPaste(emptyTable(), clipboard, {
      armorIndex: 0,
      partIndex: 2,
      timeOffset: 0,
    });

    expect(plans.map((p) => [p.armorIndex, p.partIndex])).toEqual([
      [0, 2],
      [0, 3],
    ]);
  });

  it("落在光表範圍外的那幾條整條丟掉，不夾回邊界", () => {
    /*
     * 夾回去的話兩條會疊在同一個部位上，後貼的默默蓋掉先貼的——而那看起來
     * 只是「怎麼少了一條」。丟掉至少是「這條沒貼到」。
     */
    const plans = planPaste(emptyTable(), clipboard, {
      armorIndex: 0,
      partIndex: 3, // (0,3) 收得下，(0,4) 收不下
      timeOffset: 0,
    });

    expect(plans.map((p) => [p.armorIndex, p.partIndex])).toEqual([[0, 3]]);
  });

  it("貼上的是副本：id 全部換新", () => {
    const plans = planPaste(emptyTable(), clipboard, {
      armorIndex: 0,
      partIndex: 0,
      timeOffset: 5000,
    });

    const ids = plans.flatMap((p) => p.pasted.map((s) => s.id));
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
    expect(new Set(ids).size).toBe(2);
  });

  it("時間跟著平移並對齊網格", () => {
    const plans = planPaste(emptyTable(), clipboard, {
      armorIndex: 0,
      partIndex: 0,
      timeOffset: 5030, // 不是 50 的倍數
    });

    expect(plans[0].pasted[0].start).toBe(6050);
    expect(plans[0].pasted[0].end).toBe(7050);
  });

  it("平移到負時間的那些段丟掉，不會寫出 start < 0", () => {
    const plans = planPaste(emptyTable(), clipboard, {
      armorIndex: 0,
      partIndex: 0,
      timeOffset: -5000,
    });

    expect(plans).toEqual([]);
  });
});

describe("planPaste：與目標既有內容的碰撞", () => {
  it("蓋到的區間被裁掉（trim），沒蓋到的留著", () => {
    const table = emptyTable();
    table[0][0] = [seg("old", 0, 10000, { colorStart: { G: 255 } })];

    const clipboard = packClipboard(
      [groupOf(1, 0, [seg("new", 2000, 3000)])],
      { armorIndex: 1, partIndex: 0 },
    );

    const plans = planPaste(table, clipboard, {
      armorIndex: 0,
      partIndex: 0,
      timeOffset: 0,
    });

    const result = plans[0].segments;
    // 原本的 0..10000 被切成 0..2000 與 3000..10000，中間讓給貼進來的
    expect(result.map((s) => [s.start, s.end])).toEqual([
      [0, 2000],
      [2000, 3000],
      [3000, 10000],
    ]);
  });
});

describe("planOverwrite（Shift+V）", () => {
  it("整條蓋掉，不保留目標原本的內容", () => {
    const table = emptyTable();
    table[2][0] = [seg("old", 0, 10000)];

    const clipboard = packClipboard(
      [groupOf(0, 0, [seg("a", 1000, 2000)])],
      { armorIndex: 0, partIndex: 0 },
    );

    const plans = planOverwrite(table, clipboard, {
      armorIndex: 2,
      partIndex: 0,
    });

    expect(plans[0].segments.map((s) => [s.start, s.end])).toEqual([
      [1000, 2000],
    ]);
  });
});

describe("sourceSelections", () => {
  it("攤平成選取格式，Timeline 才畫得出跨軌的來源標記", () => {
    const clipboard = packClipboard(
      [
        groupOf(0, 0, [seg("a", 0, 1000)]),
        groupOf(1, 2, [seg("b", 0, 1000), seg("c", 2000, 3000)]),
      ],
      { armorIndex: 0, partIndex: 0 },
    );

    expect(sourceSelections(clipboard)).toEqual([
      { armorIndex: 0, partIndex: 0, segmentId: "a" },
      { armorIndex: 1, partIndex: 2, segmentId: "b" },
      { armorIndex: 1, partIndex: 2, segmentId: "c" },
    ]);
  });

  it("空剪貼簿回傳空陣列", () => {
    expect(sourceSelections(null)).toEqual([]);
  });
});
