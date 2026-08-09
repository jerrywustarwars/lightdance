import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { produce } from "immer";

import { useKeyframeActionTable } from "../../hooks/useKeyframeActionTable.js";
import { TICK_MS, LEGACY_BLACK_SENTINEL_MS } from "../../constants/time.js";
import {
  findNextColorIndex,
  removeDuplicateBlackBlocks,
} from "../../utils/actionTable/blackSentinel.js";

/**
 * 效果選單：三種套用在選取色塊上的效果。
 *
 * | 效果 | 作用 |
 * |---|---|
 * | 漸變 (L) | 切換色塊的 `linear`，讓它漸變到下一個關鍵格 |
 * | 頻閃 (B) | 把色塊切成固定週期的閃爍序列 |
 * | 亮度階梯 | 從選取的色塊往後，把連續色塊的透明度做成階梯 |
 *
 * 邏輯放在 `useLightEffects()`，因為 L / B 也有鍵盤快捷鍵——外殼呼叫一次 hook，
 * 鍵盤與選單共用同一組函式。（Phase 3d 統一鍵盤處理後這個介面會更明顯。）
 */

const isBlack = (point) =>
  point.color.R === 0 && point.color.G === 0 && point.color.B === 0;

export function useLightEffects() {
  const dispatch = useDispatch();
  // Phase 4 過渡橋：store 存 segments，這裡取得 keyframe 視圖 + 寫回用的 commit
  const { actionTable, commit } = useKeyframeActionTable();
  const duration = useSelector((state) => state.profiles.duration);
  const multiSelectedBlocks = useSelector(
    (state) => state.profiles.multiSelectedBlocks,
  );

  /** 漸變：切換選取色塊的 linear 旗標 */
  const toggleLinear = () => {
    if (multiSelectedBlocks.length === 0) return;

    const updatedActionTable = produce(actionTable, (draft) => {
      multiSelectedBlocks.forEach(({ armorIndex, partIndex, blockIndex }) => {
        const block = draft[armorIndex]?.[partIndex]?.[blockIndex];
        if (block) {
          block.linear = block.linear === 1 ? 0 : 1;
        }
      });
    });

    commit(updatedActionTable);
  };

  /** 頻閃：把選取的色塊切成 `period` 毫秒一次的閃爍 */
  const applyBlink = (periodInput) => {
    const period = parseInt(periodInput, 10);
    if (isNaN(period) || period <= 0 || period % TICK_MS !== 0) {
      alert(`請輸入 ${TICK_MS} 的倍數！`);
      return;
    }

    if (multiSelectedBlocks.length !== 1) {
      alert("請先選取「一個」色塊，再套用頻閃。");
      return;
    }

    const { armorIndex, partIndex, blockIndex } = multiSelectedBlocks[0];

    const updatedActionTable = produce(actionTable, (draft) => {
      const timeline = draft[armorIndex][partIndex];
      const viewEntry = timeline[blockIndex];
      if (!viewEntry) return;

      // 1. 強制校正起始點到 tick 網格
      const startTime = Math.round(viewEntry.time / TICK_MS) * TICK_MS;
      const viewNextEntry = timeline[blockIndex + 1];
      const totalDuration = (viewNextEntry?.time ?? duration) - viewEntry.time;
      const activeBlock = timeline[blockIndex];
      const isLinear = activeBlock.linear === 1;

      // 漸變中的色塊要沿著漸變曲線閃，所以先找出漸變的終點色
      let targetEndBlock = null;
      if (isLinear) {
        for (let i = blockIndex + 1; i < timeline.length; i++) {
          if (!isBlack(timeline[i])) {
            targetEndBlock = timeline[i];
            break;
          }
        }
      }

      const blinkCount = Math.floor(totalDuration / period);
      const newPoints = [];

      for (let i = 0; i < blinkCount; i++) {
        const baseTime = startTime + i * period; // 這裡絕對是 tick 的倍數
        let currentColor = { ...activeBlock.color };

        if (isLinear && targetEndBlock) {
          const f =
            (baseTime - activeBlock.time) /
            (targetEndBlock.time - activeBlock.time);
          currentColor = {
            R: Math.round(
              activeBlock.color.R * (1 - f) + targetEndBlock.color.R * f,
            ),
            G: Math.round(
              activeBlock.color.G * (1 - f) + targetEndBlock.color.G * f,
            ),
            B: Math.round(
              activeBlock.color.B * (1 - f) + targetEndBlock.color.B * f,
            ),
            A: activeBlock.color.A * (1 - f) + targetEndBlock.color.A * f,
          };
        }

        // ✅ 彩色點：絕對對齊 tick 網格
        newPoints.push({ time: baseTime, color: currentColor, linear: 0 });

        // ✅ 黑色緩衝點：保留 10ms 縫隙（這點不會落在網格上，但能維持閃爍感）
        newPoints.push({
          time: baseTime + period - LEGACY_BLACK_SENTINEL_MS,
          color: { R: 0, G: 0, B: 0, A: 1 },
          linear: 0,
        });
      }

      timeline.splice(blockIndex, 1, ...newPoints);
      timeline.sort((a, b) => a.time - b.time);
    });

    commit(removeDuplicateBlackBlocks(updatedActionTable));
  };

  /**
   * 亮度階梯：從選取的色塊開始往後，把連續色塊的透明度依 start → end 逐階套用。
   *
   * @returns {boolean} 是否真的套用了（沒有恰好選一個色塊時回傳 false，讓面板留著）
   */
  const applyBrightnessLadder = (startPercent, stepPercent, endPercent) => {
    if (multiSelectedBlocks.length !== 1) {
      // 原本只 console.warn，使用者按下 Apply 會完全沒有反應——改成看得見的提示
      alert("請先選取「一個」色塊，再套用亮度階梯。");
      return false;
    }

    const { armorIndex, partIndex, blockIndex } = multiSelectedBlocks[0];

    const updated = produce(actionTable, (draft) => {
      const timeline = draft[armorIndex][partIndex];
      if (!Array.isArray(timeline)) return;

      // 判斷方向：end 大於 start 就遞增，否則遞減
      const ascending = endPercent > startPercent;
      let current = startPercent;

      // 逐個「有顏色的」關鍵格往後走。原本寫死 blockIndex + step * 2
      //（假設每個色塊後面都跟著一個黑哨兵），色塊緊鄰時會跳過一整塊——
      // Phase 4 之後緊鄰是常態，所以改成明確地找下一個色塊。
      let idx = findNextColorIndex(timeline, blockIndex);

      while (
        idx !== -1 &&
        ((ascending && current <= endPercent) ||
          (!ascending && current >= endPercent))
      ) {
        timeline[idx].color.A = current / 100;
        current += ascending ? stepPercent : -stepPercent;
        idx = findNextColorIndex(timeline, idx + 1);
      }
    });

    commit(updated);
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
        <span className="tooltip">Effect</span>
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
