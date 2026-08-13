import { useState } from "react";
import { useSelector } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";

import { useSegmentActionTable } from "../../hooks/useSegmentActionTable.js";
import { TICK_MS } from "../../constants/time.js";
import { resolveSelections } from "../../utils/selection.js";
import { cloneColor, lerpColor, BLACK } from "../../utils/segments/color.js";
import { createId } from "../../utils/segments/core.js";

/**
 * 效果選單：三種套用在選取色塊上的效果。
 *
 * | 效果 | 作用 |
 * |---|---|
 * | 漸變 (L) | 切換色塊的 `linear`，讓它在段內從 colorStart 漸變到 colorEnd |
 * | 頻閃 (B) | 把色塊切成固定週期的閃爍序列 |
 * | 亮度階梯 | 從選取的色塊往後，把連續色塊的透明度做成階梯 |
 *
 * 邏輯放在 `useLightEffects()`，因為 L / B 也有鍵盤快捷鍵——外殼呼叫一次 hook，
 * 鍵盤與選單共用同一組函式。
 *
 * ## Phase 5d：改成 segment 原生
 *
 * 這三個效果原本都透過 `useKeyframeActionTable` 的轉接橋，在壓平出來的
 * keyframe 陣列上用 `blockIndex` 操作。三個都因此帶著黑色哨兵的假設：
 *
 * - 頻閃每個週期都要自己補一個「結束前 10ms 的純黑關鍵格」
 * - 亮度階梯原本寫死 `blockIndex + step * 2`（假設每個色塊後面都跟著一個
 *   黑哨兵），色塊緊鄰時會跳過一整塊
 * - 漸變只能切旗標，「漸變到什麼顏色」得靠往後找下一個非黑關鍵格
 *
 * segment 模型裡這些都消失了：熄滅就是段與段之間的空隙，「下一個色塊」就是
 * 陣列的下一格，漸變的終點色記在段自己的 `colorEnd` 上。
 */

export function useLightEffects() {
  const { segmentTable, commitPart } = useSegmentActionTable();
  const multiSelectedBlocks = useSelector(
    (state) => state.profiles.multiSelectedBlocks,
  );

  /** 選取所在的部位（所有效果都以第一筆選取為準） */
  const activePart = multiSelectedBlocks[0] ?? null;

  /** 該部位的 segments */
  const activeSegments = activePart
    ? (segmentTable?.[activePart.armorIndex]?.[activePart.partIndex] ?? [])
    : [];

  /** 把選取解析成真正的 segment，濾掉已經不存在的（例如剛被 undo 掉） */
  const selected = resolveSelections(multiSelectedBlocks, activeSegments);

  /** 寫回目前這個部位 */
  const commitActive = (nextSegments) =>
    commitPart(activePart.armorIndex, activePart.partIndex, nextSegments);

  /**
   * 漸變：切換選取色塊的 `linear`。
   *
   * 開啟漸變時要決定「漸變到什麼顏色」。舊模型只有一個旗標，實際的終點色是
   * 渲染時往後找下一個非黑關鍵格推出來的；segment 模型把它記在段自己身上，
   * 所以這裡要明確算出來：
   *
   * - 後面緊接著另一個色塊 → 漸變到它的起始色（接得上，視覺與舊版一致）
   * - 後面是空隙或已經是最後一段 → 漸變到黑（fade out）
   *
   * 關掉漸變則把 `colorEnd` 收回成 `colorStart`，變回單純的固定色。
   */
  const toggleLinear = () => {
    if (selected.length === 0) return;

    const selectedIds = new Set(selected.map((entry) => entry.segment.id));

    const next = activeSegments.map((segment, index) => {
      if (!selectedIds.has(segment.id)) return segment;

      const turningOn = segment.linear !== 1;
      if (!turningOn) {
        return { ...segment, linear: 0, colorEnd: cloneColor(segment.colorStart) };
      }

      const following = activeSegments[index + 1];
      // 只有「首尾相接」才算接得上；中間有空隙的話中途本來就會熄滅
      const touching = following && following.start === segment.end;
      return {
        ...segment,
        linear: 1,
        colorEnd: cloneColor(touching ? following.colorStart : BLACK),
      };
    });

    commitActive(next);
  };

  /**
   * 頻閃：把選取的色塊切成 `period` 毫秒一次的閃爍。
   *
   * 每個週期是「亮 `period - TICK_MS`、熄滅一格」——熄滅用**空隙**表達，
   * 不再補黑色關鍵格。壓平回 keyframe 時，空隙前會在網格整點發一個黑點，
   * 落在跟舊版 `period - 10ms` 相同的 tick 上，所以韌體看到的東西不變。
   *
   * 原本的色塊若是漸變，閃爍的每一段會取該時間點在漸變曲線上的顏色，
   * 讓「一邊漸變一邊閃」看起來仍然連續。
   */
  const applyBlink = (periodInput) => {
    const period = parseInt(periodInput, 10);
    if (isNaN(period) || period <= 0 || period % TICK_MS !== 0) {
      alert(`請輸入 ${TICK_MS} 的倍數！`);
      return;
    }
    // 一個週期至少要兩格：一格亮、一格滅。只有一格的話等於整段熄滅。
    if (period < TICK_MS * 2) {
      alert(`頻閃間隔至少要 ${TICK_MS * 2}ms，否則沒有亮的部分。`);
      return;
    }
    if (selected.length !== 1) {
      alert("請先選取「一個」色塊，再套用頻閃。");
      return;
    }

    const target = selected[0].segment;
    const span = target.end - target.start;
    const blinkCount = Math.floor(span / period);
    if (blinkCount < 1) {
      alert("色塊比一個頻閃週期還短，請選長一點的色塊或縮小間隔。");
      return;
    }

    const pulses = [];
    for (let i = 0; i < blinkCount; i++) {
      const start = target.start + i * period;
      // 段內漸變時，取這一刻在漸變曲線上的顏色
      const ratio = span > 0 ? (start - target.start) / span : 0;
      const color =
        target.linear === 1
          ? lerpColor(target.colorStart, target.colorEnd, ratio)
          : cloneColor(target.colorStart);

      pulses.push({
        id: createId(),
        start,
        end: start + period - TICK_MS, // 最後一格留給空隙 = 熄滅
        colorStart: color,
        colorEnd: cloneColor(color),
        linear: 0,
      });
    }

    const index = activeSegments.indexOf(target);
    const next = [
      ...activeSegments.slice(0, index),
      ...pulses,
      ...activeSegments.slice(index + 1),
    ];
    commitActive(next);
  };

  /**
   * 亮度階梯：從選取的色塊開始往後，把連續色塊的透明度依 start → end 逐階套用。
   *
   * @returns {boolean} 是否真的套用了（沒有恰好選一個色塊時回傳 false，讓面板留著）
   */
  const applyBrightnessLadder = (startPercent, stepPercent, endPercent) => {
    if (selected.length !== 1) {
      // 原本只 console.warn，使用者按下 Apply 會完全沒有反應——改成看得見的提示
      alert("請先選取「一個」色塊，再套用亮度階梯。");
      return false;
    }
    if (stepPercent <= 0) {
      alert("每階的變化量必須大於 0。");
      return false;
    }

    const startIndex = activeSegments.indexOf(selected[0].segment);
    const ascending = endPercent > startPercent;
    let current = startPercent;

    const next = activeSegments.map((segment, index) => {
      if (index < startIndex) return segment;
      const withinRange = ascending
        ? current <= endPercent
        : current >= endPercent;
      if (!withinRange) return segment;

      const alpha = current / 100;
      current += ascending ? stepPercent : -stepPercent;
      return {
        ...segment,
        colorStart: { ...segment.colorStart, A: alpha },
        colorEnd: { ...segment.colorEnd, A: alpha },
      };
    });

    commitActive(next);
    return true;
  };

  return { toggleLinear, applyBlink, applyBrightnessLadder };
}

/** 百分比選項：10%、20%、…、100% */
const PERCENT_OPTIONS = [...Array(10)].map((_, i) => (i + 1) * 10);

function EffectMenu({ effects }) {
  const { toggleLinear, applyBlink, applyBrightnessLadder } = effects;

  const [menuVisible, setMenuVisible] = useState(false);
  const [ladderVisible, setLadderVisible] = useState(false);

  // 亮度階梯的設定：從 startPercent 每次加減 stepPercent 直到 endPercent
  const [startPercent, setStartPercent] = useState(10);
  const [stepPercent, setStepPercent] = useState(10);
  const [endPercent, setEndPercent] = useState(100);

  const closeAll = () => {
    setMenuVisible(false);
    setLadderVisible(false);
  };

  const toggleMenu = () => {
    setMenuVisible((visible) => !visible);
    // 收起選單時一併隱藏設定面板
    if (menuVisible) setLadderVisible(false);
  };

  const promptBlink = () => {
    const userInput = window.prompt(
      `請輸入頻閃間隔 (ms)，必須為 ${TICK_MS} 的倍數：`,
      "100",
    );
    if (userInput !== null) applyBlink(userInput);
    setMenuVisible(false);
  };

  return (
    <div className="effect-wrapper">
      <button className="effect-button" onClick={toggleMenu}>
        <FontAwesomeIcon icon={faWandMagicSparkles} size="lg" />
        <span className="tooltip">特效</span>
      </button>

      {/* 一級選單 */}
      {menuVisible && (
        <div className="effect-menu">
          <div
            className="effect-menu-item"
            onClick={() => {
              toggleLinear();
              setMenuVisible(false);
            }}
          >
            漸變 (L)
          </div>

          <div className="effect-menu-item" onClick={promptBlink}>
            頻閃 (B)
          </div>

          {/* 亮度階梯：從選取的色塊往後，把連續色塊的透明度做成階梯 */}
          <div
            className="effect-menu-item"
            onClick={() => setLadderVisible(true)}
          >
            亮度階梯
          </div>
        </div>
      )}

      {/* 二級設定 panel */}
      {ladderVisible && (
        <div className="gradient-settings-popup">
          <label>起始亮度：</label>
          <PercentSelect value={startPercent} onChange={setStartPercent} />

          {/* 每一階的亮度增量 */}
          <label>間隔：</label>
          <select
            className="dropdown-select"
            value={stepPercent}
            onChange={(e) => setStepPercent(Number(e.target.value))}
          >
            {[10, 20].map((v) => (
              <option key={v} value={v}>
                {v} %
              </option>
            ))}
          </select>

          <label>結束亮度：</label>
          <PercentSelect value={endPercent} onChange={setEndPercent} />

          <div className="gradient-settings-actions">
            <button
              onClick={() => {
                // 沒有恰好選一個色塊：留著面板讓使用者去選
                if (
                  !applyBrightnessLadder(startPercent, stepPercent, endPercent)
                )
                  return;
                closeAll();
              }}
            >
              Apply
            </button>
            <button onClick={closeAll}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PercentSelect({ value, onChange }) {
  return (
    <select
      className="dropdown-select"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {PERCENT_OPTIONS.map((v) => (
        <option key={v} value={v}>
          {v}%
        </option>
      ))}
    </select>
  );
}

export default EffectMenu;
