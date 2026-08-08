/**
 * structuredDiff — 比對兩份 players（韌體 PlayerData）輸出的差異，並分類。
 *
 * 用途：Phase 2 的 keyframe→segment 轉換器會讓「黑色哨兵」從 -10ms 移到 50ms 網格上，
 * 這會使線性漸變的內插分母改變（例如 990ms → 1000ms），導致漸變**內部取樣點**的顏色
 * 出現小幅差異。這是已知且被接受的行為變更，但除此之外的任何差異都是 bug。
 *
 * 因此本比對器把差異分成兩類：
 *   1. 結構性差異（時間格、列數、舞者數、非漸變欄位）→ **一律視為錯誤**
 *   2. 漸變內部取樣點的色差 → 允許，但會統計最大通道差供人工判斷
 *
 * 實測數據（2026-08-08，合成 fixture）：
 *   - 1000ms 漸變接離網格黑點：最大通道差 2
 *   - 100ms 漸變接離網格黑點：最大通道差 15
 *   理論上界約為 255 * 10 / (漸變長度ms - 10)，漸變越短誤差越大。
 *   漸變長度 L 對應的上界：L=1000→3、L=500→6、L=200→14、L=100→29。
 *
 * 給 C++ 開發者的類比：這相當於浮點運算的 epsilon 比較，但 epsilon 只允許
 * 套用在特定分類的欄位上，其餘欄位仍要求完全相等。
 */

/** 把 32-bit 打包色解開成各通道 */
export function unpackColor(value) {
  return {
    R: (value >>> 24) & 0xff,
    G: (value >>> 16) & 0xff,
    B: (value >>> 8) & 0xff,
    alpha7: (value >>> 1) & 0x7f,
    linear: value & 1,
  };
}

/**
 * 比對兩份 players 輸出。
 *
 * @param {Array} expected - 基準輸出（通常是 keyframe 路徑的結果）
 * @param {Array} actual - 待驗證輸出（通常是 segment 路徑的結果）
 * @param {{maxChannelDelta?: number}} options
 *   maxChannelDelta: 漸變內部允許的最大通道差，預設 16（實測最大 15，留一格緩衝）。
 *   要調高必須有理由——多半代表出現了比 100ms 更短的漸變。
 * @returns {{ok: boolean, errors: string[], stats: object, gradientDiffs: Array}}
 */
export function comparePlayers(expected, actual, options = {}) {
  const { maxChannelDelta = 16 } = options;
  const errors = [];
  const gradientDiffs = [];

  if (expected.length !== actual.length) {
    errors.push(
      `舞者數量不同：expected ${expected.length}，actual ${actual.length}`,
    );
    return { ok: false, errors, stats: { maxChannelDelta: 0 }, gradientDiffs };
  }

  for (let armor = 0; armor < expected.length; armor++) {
    const expRows = expected[armor];
    const actRows = actual[armor];

    if (expRows.length !== actRows.length) {
      errors.push(
        `舞者 ${armor} 的列數不同：expected ${expRows.length}，actual ${actRows.length}`,
      );
      continue;
    }

    for (let row = 0; row < expRows.length; row++) {
      const expRow = expRows[row];
      const actRow = actRows[row];

      // 時間格是硬性契約，任何偏差都是錯誤
      if (expRow.time !== actRow.time) {
        errors.push(
          `舞者 ${armor} 第 ${row} 列時間格不同：expected ${expRow.time}，actual ${actRow.time}`,
        );
        continue;
      }

      for (const field of Object.keys(expRow)) {
        if (field === "time") continue;
        const expValue = expRow[field];
        const actValue = actRow[field];
        if (expValue === actValue) continue;

        const e = unpackColor(expValue);
        const a = unpackColor(actValue);

        // 只有「兩邊都在漸變中」的欄位才允許有差異
        if (e.linear !== 1 || a.linear !== 1) {
          errors.push(
            `舞者 ${armor} 第 ${row} 列（time=${expRow.time}）欄位 ${field} ` +
              `在非漸變狀態下不同：expected ${expValue}，actual ${actValue}`,
          );
          continue;
        }

        const delta = Math.max(
          Math.abs(e.R - a.R),
          Math.abs(e.G - a.G),
          Math.abs(e.B - a.B),
          Math.abs(e.alpha7 - a.alpha7),
        );

        gradientDiffs.push({
          armor,
          row,
          time: expRow.time,
          field,
          delta,
          expected: e,
          actual: a,
        });
      }
    }
  }

  const observedMax = gradientDiffs.reduce((m, d) => Math.max(m, d.delta), 0);

  if (observedMax > maxChannelDelta) {
    const worst = gradientDiffs
      .filter((d) => d.delta === observedMax)
      .slice(0, 3);
    errors.push(
      `漸變內部色差超出容許值：最大 ${observedMax} > ${maxChannelDelta}。` +
        `代表性位置：${worst
          .map((w) => `舞者${w.armor} time=${w.time} ${w.field}`)
          .join("、")}`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      maxChannelDelta: observedMax,
      gradientDiffCount: gradientDiffs.length,
      allowedMaxChannelDelta: maxChannelDelta,
    },
    gradientDiffs,
  };
}

export default comparePlayers;
