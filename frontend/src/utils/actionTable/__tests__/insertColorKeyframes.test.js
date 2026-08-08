import { describe, it, expect } from "vitest";

import {
  insertColorKeyframes,
  binarySearchFirstGreater,
} from "../insertColorKeyframes.js";
import { LEGACY_BLACK_SENTINEL_MS } from "../../../constants/time.js";

/**
 * 舊放色邏輯（5 分支黑點判斷）的行為測試。
 *
 * 這份 util 是把 Armor / AccessoryPanel / audioplayer 三處重複實作合併而來，
 * 合併前已用 2 萬組隨機輸入驗證三者在可觸及路徑上完全等價。這些測試把各分支
 * 的預期行為釘住，讓 Phase 5 改寫成 insertSegment 時有對照基準。
 */

const BT = LEGACY_BLACK_SENTINEL_MS;
const black = (time) => ({
  time,
  color: { R: 0, G: 0, B: 0, A: 1 },
  linear: 0,
});
const red = { R: 255, G: 0, B: 0, A: 1 };
const green = (time) => ({
  time,
  color: { R: 0, G: 255, B: 0, A: 1 },
  linear: 0,
});

const DURATION = 5000;
const insert = (timeline, time, color = red) =>
  insertColorKeyframes(timeline, { time, color, duration: DURATION });

describe("binarySearchFirstGreater", () => {
  const timeline = [black(0), green(1000), green(2000)];

  it("找到第一個 time 大於目標的索引", () => {
    expect(binarySearchFirstGreater(timeline, 500)).toBe(1);
    expect(binarySearchFirstGreater(timeline, 1500)).toBe(2);
  });

  it("找不到更大值時回傳 0（沿用原本語意，插在結尾也走 index 0 分支）", () => {
    expect(binarySearchFirstGreater(timeline, 9999)).toBe(0);
  });
});

describe("insertColorKeyframes", () => {
  it("同一時間已有關鍵格時只換顏色，不新增", () => {
    const timeline = [black(0), green(1000), black(1990)];
    const result = insert(timeline, 1000);

    expect(result).toHaveLength(3);
    expect(result[1].color).toEqual(red);
  });

  it("插在結尾時補一個收尾黑點到音樂結束", () => {
    const timeline = [black(0)];
    const result = insert(timeline, 1000);

    expect(result.map((entry) => entry.time)).toEqual([0, 1000, DURATION]);
    expect(result[1].color).toEqual(red);
    expect(result[2].color).toEqual(black(0).color);
  });

  it("前面是彩色、後面是黑：在新色塊前插黑點切斷前一段", () => {
    const timeline = [black(0), green(500), black(2000), green(3000)];
    const result = insert(timeline, 1000);

    expect(result.map((entry) => entry.time)).toEqual([
      0,
      500,
      1000 - BT,
      1000,
      2000,
      3000,
    ]);
  });

  it("前後都是彩色：兩側都插黑點切斷", () => {
    const timeline = [black(0), green(500), green(2000)];
    const result = insert(timeline, 1000);

    expect(result.map((entry) => entry.time)).toEqual([
      0,
      500,
      1000 - BT,
      1000,
      2000 - BT,
      2000,
    ]);
  });

  it("前面是黑、後面是彩色：只在新色塊後插黑點", () => {
    const timeline = [black(0), green(500), black(700), green(2000)];
    const result = insert(timeline, 1000);

    expect(result.map((entry) => entry.time)).toEqual([
      0,
      500,
      700,
      1000,
      2000 - BT,
      2000,
    ]);
  });

  it("回傳新陣列，不修改輸入", () => {
    const timeline = [black(0), green(1000)];
    const snapshot = JSON.stringify(timeline);

    insert(timeline, 1500);
    expect(JSON.stringify(timeline)).toBe(snapshot);
  });

  it("結果一律依時間排序", () => {
    const timeline = [black(0), green(500), green(2000)];
    const result = insert(timeline, 1000);

    const times = result.map((entry) => entry.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
