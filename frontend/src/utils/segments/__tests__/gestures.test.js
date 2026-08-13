/**
 * 拖曳與 resize 的邊界測試。
 *
 * 這段邏輯原本內嵌在 Timeline 的滑鼠事件處理器裡，跟 DOM 綁死，
 * jsdom 量不到版面所以**一行測試都沒有**。抽成純函式之後才有辦法窮舉邊界，
 * 而邊界正是手勢最容易寫錯的地方。
 */
import { describe, it, expect } from "vitest";
import {
  moveSegment,
  resizeSegment,
  MIN_BLOCK_GAP_MS,
  MIN_SEGMENT_MS,
} from "../gestures.js";

const DURATION = 10_000;

/** 兩個色塊：A 1000~2000、B 4000~5000 */
const makeSegments = () => [
  { id: "a", start: 1000, end: 2000, colorStart: {}, colorEnd: {}, linear: 0 },
  { id: "b", start: 4000, end: 5000, colorStart: {}, colorEnd: {}, linear: 0 },
];

const opts = { duration: DURATION };

describe("moveSegment", () => {
  it("往右平移，長度不變", () => {
    const next = moveSegment(makeSegments(), "a", 500, opts);
    expect(next[0]).toMatchObject({ start: 1500, end: 2500 });
  });

  it("往左平移", () => {
    const next = moveSegment(makeSegments(), "a", -500, opts);
    expect(next[0]).toMatchObject({ start: 500, end: 1500 });
  });

  it("位移量對齊網格（拖到哪都會吸附）", () => {
    const next = moveSegment(makeSegments(), "a", 137, opts);
    expect(next[0].start % 50).toBe(0);
    expect(next[0]).toMatchObject({ start: 1150, end: 2150 });
  });

  it("往右撞到鄰居時停在「鄰居起點 − 長度 − 間距」", () => {
    const next = moveSegment(makeSegments(), "a", 99_999, opts);
    // B 從 4000 開始，A 長 1000，最小間距 50 → 最遠只能到 2950
    expect(next[0]).toMatchObject({ start: 4000 - 1000 - MIN_BLOCK_GAP_MS });
    expect(next[0].end).toBeLessThanOrEqual(4000 - MIN_BLOCK_GAP_MS);
  });

  it("往左不會越過 0", () => {
    const next = moveSegment(makeSegments(), "a", -99_999, opts);
    expect(next[0]).toMatchObject({ start: 0, end: 1000 });
  });

  it("最後一段往右不會超過總長", () => {
    const next = moveSegment(makeSegments(), "b", 99_999, opts);
    expect(next[1].end).toBe(DURATION);
    expect(next[1].start).toBe(DURATION - 1000);
  });

  it("被左右夾死時整個不動（不會算出負的可用範圍）", () => {
    const tight = [
      { id: "l", start: 0, end: 1000 },
      { id: "m", start: 1050, end: 2000 },
      { id: "r", start: 2050, end: 3000 },
    ];
    expect(moveSegment(tight, "m", 500, opts)).toBe(tight);
  });

  it("沒有實際位移時回傳原陣列（reference 相同 → 不會佔一格 undo）", () => {
    const segments = makeSegments();
    expect(moveSegment(segments, "a", 0, opts)).toBe(segments);
    // 20ms 的位移對齊網格之後還是原位
    expect(moveSegment(segments, "a", 20, opts)).toBe(segments);
  });

  it("找不到 id 時回傳原陣列", () => {
    const segments = makeSegments();
    expect(moveSegment(segments, "nope", 500, opts)).toBe(segments);
  });

  it("不會動到其他段的 reference", () => {
    const segments = makeSegments();
    const next = moveSegment(segments, "a", 500, opts);
    expect(next[1]).toBe(segments[1]);
  });
});

describe("resizeSegment", () => {
  it("拉長右緣", () => {
    const next = resizeSegment(makeSegments(), "a", "right", 500, opts);
    expect(next[0]).toMatchObject({ start: 1000, end: 2500 });
  });

  it("縮短右緣", () => {
    const next = resizeSegment(makeSegments(), "a", "right", -500, opts);
    expect(next[0]).toMatchObject({ start: 1000, end: 1500 });
  });

  it("右緣最多拉到「鄰居起點 − 間距」", () => {
    const next = resizeSegment(makeSegments(), "a", "right", 99_999, opts);
    expect(next[0].end).toBe(4000 - MIN_BLOCK_GAP_MS);
  });

  it("最後一段的右緣最多拉到總長", () => {
    const next = resizeSegment(makeSegments(), "b", "right", 99_999, opts);
    expect(next[1].end).toBe(DURATION);
  });

  it("右緣不會縮到比最小長度還短", () => {
    const next = resizeSegment(makeSegments(), "a", "right", -99_999, opts);
    expect(next[0].end).toBe(1000 + MIN_SEGMENT_MS);
    expect(next[0].end).toBeGreaterThan(next[0].start);
  });

  it("拉長左緣（往左長）", () => {
    const next = resizeSegment(makeSegments(), "a", "left", -500, opts);
    expect(next[0]).toMatchObject({ start: 500, end: 2000 });
  });

  it("左緣最多退到「前一段結尾 + 間距」", () => {
    const next = resizeSegment(makeSegments(), "b", "left", -99_999, opts);
    expect(next[1].start).toBe(2000 + MIN_BLOCK_GAP_MS);
  });

  it("第一段的左緣最多退到 0", () => {
    const next = resizeSegment(makeSegments(), "a", "left", -99_999, opts);
    expect(next[0].start).toBe(0);
  });

  it("左緣不會超過「結尾 − 最小長度」", () => {
    const next = resizeSegment(makeSegments(), "a", "left", 99_999, opts);
    expect(next[0].start).toBe(2000 - MIN_SEGMENT_MS);
    expect(next[0].start).toBeLessThan(next[0].end);
  });

  it("兩個邊都會對齊網格", () => {
    const right = resizeSegment(makeSegments(), "a", "right", 137, opts);
    expect(right[0].end % 50).toBe(0);
    const left = resizeSegment(makeSegments(), "a", "left", -137, opts);
    expect(left[0].start % 50).toBe(0);
  });

  it("沒有實際改變時回傳原陣列", () => {
    const segments = makeSegments();
    expect(resizeSegment(segments, "a", "right", 0, opts)).toBe(segments);
    expect(resizeSegment(segments, "a", "left", 0, opts)).toBe(segments);
    expect(resizeSegment(segments, "nope", "right", 500, opts)).toBe(segments);
  });

  it("任何操作之後 end 都嚴格大於 start", () => {
    // 窮舉一批位移量，確保不會產生零長度或反向的段
    for (const delta of [-9999, -2000, -137, -50, 0, 50, 137, 2000, 9999]) {
      for (const edge of ["left", "right"]) {
        for (const id of ["a", "b"]) {
          const next = resizeSegment(makeSegments(), id, edge, delta, opts);
          for (const segment of next) {
            expect(segment.end).toBeGreaterThan(segment.start);
          }
        }
      }
    }
  });

  it("任何操作之後段與段都不重疊", () => {
    for (const delta of [-9999, -500, 137, 500, 9999]) {
      for (const edge of ["left", "right"]) {
        for (const id of ["a", "b"]) {
          const next = resizeSegment(makeSegments(), id, edge, delta, opts);
          for (let i = 1; i < next.length; i++) {
            expect(next[i].start).toBeGreaterThanOrEqual(next[i - 1].end);
          }
        }
      }
    }
  });
});

describe("moveSegment 的不變式", () => {
  it("任何位移之後都不重疊、都在 [0, duration] 內、長度不變", () => {
    for (const delta of [-9999, -1234, -50, 50, 1234, 9999]) {
      for (const id of ["a", "b"]) {
        const before = makeSegments();
        const next = moveSegment(before, id, delta, opts);
        const original = before.find((s) => s.id === id);
        const moved = next.find((s) => s.id === id);

        expect(moved.end - moved.start).toBe(original.end - original.start);
        expect(moved.start).toBeGreaterThanOrEqual(0);
        expect(moved.end).toBeLessThanOrEqual(DURATION);
        for (let i = 1; i < next.length; i++) {
          expect(next[i].start).toBeGreaterThanOrEqual(next[i - 1].end);
        }
      }
    }
  });
});
