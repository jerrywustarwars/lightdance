import { describe, it, expect } from "vitest";

import {
  toKeyframeTable,
  toSegmentTableIncremental,
} from "../withKeyframeAdapter.js";
import { toSegmentTable } from "../../migration/loadProjectData.js";
import { produce } from "immer";

/**
 * 轉接橋的測試。
 *
 * 這裡最要緊的不是「轉得對不對」（那由 convert.test.js 與遷移閘門負責），
 * 而是 **reference 有沒有被無謂地換掉** —— 換掉就代表每次編輯都會重繪整個
 * 編輯器、而且所有 segment 的 id 都被重新產生。
 */

const DURATION = 10000;

const black = (time) => ({
  time,
  color: { R: 0, G: 0, B: 0, A: 1 },
  linear: 0,
});

/** 兩個舞者、每人兩個部位；(0,0) 有紅色塊、(1,1) 有綠色塊 */
const makeKeyframeTable = () => [
  [
    [
      black(0),
      { time: 1000, color: { R: 255, G: 0, B: 0, A: 1 }, linear: 0 },
      black(2000),
    ],
    [black(0), black(DURATION)],
  ],
  [
    [black(0), black(DURATION)],
    [
      black(0),
      { time: 3000, color: { R: 0, G: 255, B: 0, A: 1 }, linear: 0 },
      black(4000),
    ],
  ],
];

const makeSegmentTable = () =>
  toSegmentTable(makeKeyframeTable(), { duration: DURATION }).slice(0, 2);

describe("toKeyframeTable 的快取", () => {
  it("同一份 segments 轉兩次回傳同一個 reference", () => {
    const segments = makeSegmentTable();

    const first = toKeyframeTable(segments, DURATION);
    const second = toKeyframeTable(segments, DURATION);

    expect(second[0][0]).toBe(first[0][0]);
    expect(second[1][1]).toBe(first[1][1]);
  });

  it("duration 變了就重算（尾端補齊的位置會不同）", () => {
    const segments = makeSegmentTable();

    const first = toKeyframeTable(segments, DURATION);
    const second = toKeyframeTable(segments, DURATION * 2);

    expect(second[0][0]).not.toBe(first[0][0]);
  });
});

describe("toSegmentTableIncremental", () => {
  it("沒動到的部位沿用原本的 segments（含 id）", () => {
    const prevSegments = makeSegmentTable();
    const prevKeyframes = toKeyframeTable(prevSegments, DURATION);

    // 只改舞者 0 的部位 0
    const nextKeyframes = produce(prevKeyframes, (draft) => {
      draft[0][0][1].color.R = 128;
    });

    const nextSegments = toSegmentTableIncremental(
      nextKeyframes,
      prevKeyframes,
      prevSegments,
      { duration: DURATION },
    );

    // 動到的部位：新物件
    expect(nextSegments[0][0]).not.toBe(prevSegments[0][0]);
    expect(nextSegments[0][0][0].colorStart.R).toBe(128);

    // 其餘三個部位：完全同一個 reference，id 也沒變
    expect(nextSegments[0][1]).toBe(prevSegments[0][1]);
    expect(nextSegments[1][0]).toBe(prevSegments[1][0]);
    expect(nextSegments[1][1]).toBe(prevSegments[1][1]);
    expect(nextSegments[1][1][0].id).toBe(prevSegments[1][1][0].id);
  });

  it("完全沒改動時每個部位都沿用原本的 reference", () => {
    const prevSegments = makeSegmentTable();
    const prevKeyframes = toKeyframeTable(prevSegments, DURATION);

    const nextSegments = toSegmentTableIncremental(
      prevKeyframes,
      prevKeyframes,
      prevSegments,
      { duration: DURATION },
    );

    nextSegments.forEach((armor, a) =>
      armor.forEach((segments, p) => {
        expect(segments).toBe(prevSegments[a][p]);
      }),
    );
  });

  it("keyframe → segment → keyframe 達到不動點（冪等）", () => {
    const prevSegments = makeSegmentTable();
    const once = toKeyframeTable(prevSegments, DURATION);

    const roundTripped = toSegmentTableIncremental(once, [], [], {
      duration: DURATION,
    });
    const twice = toKeyframeTable(roundTripped, DURATION);

    expect(twice).toEqual(once);
  });
});
