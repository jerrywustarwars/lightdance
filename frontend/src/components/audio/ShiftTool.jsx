import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsLeftRight,
  faCheck,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { produce } from "immer";

import { updateActionTable, updateCurrentTime } from "../../redux/actions.js";
import { TICK_MS } from "../../constants/time.js";
import {
  ensureBlackBefore,
  removeDuplicateBlackBlocks,
} from "../../utils/actionTable/blackSentinel.js";

/**
 * 區間平移工具：把一段時間內所有舞者、所有部位的光點整批搬到別的時間。
 *
 * 操作是三步驟的（用播放位置當游標）：
 *   1. 設定起始點 → 2. 設定結束點 → 3. 設定目標位置，然後執行
 *
 * 狀態放在 `useTimeShift()`，因為按鈕在工具列、起訖標記在時間軸上，
 * 兩處要看同一份 step/times；外殼呼叫一次 hook，再把回傳值分別餵給
 * `<ShiftToolButton>` 和 `<ShiftMarkers>`。
 */

const alignToTick = (ms) => Math.floor(ms / TICK_MS) * TICK_MS;

const isBlack = (point) =>
  point.color.R === 0 && point.color.G === 0 && point.color.B === 0;

export function useTimeShift() {
  const dispatch = useDispatch();
  const actionTable = useSelector((state) => state.profiles.data?.actionTable);
  const currentTime = useSelector((state) => state.profiles.currentTime);

  // 0: 關閉, 1: 選起始, 2: 選結束, 3: 選目標
  const [step, setStep] = useState(0);
  const [times, setTimes] = useState({ start: 0, end: 0, target: 0 });

  const reset = () => {
    setStep(0);
    setTimes({ start: 0, end: 0, target: 0 });
  };

  /** 核心資料搬移邏輯 */
  const executeTimeShift = (start, end, target) => {
    const safeStart = alignToTick(start);
    const safeEnd = alignToTick(end);
    const safeTarget = alignToTick(target);

    if (safeEnd <= safeStart) {
      alert("結束時間必須大於起始時間！");
      return;
    }

    const selectedTimes = [];

    Object.values(actionTable || {}).forEach((armor) => {
      Object.values(armor || {}).forEach((timeline) => {
        if (!Array.isArray(timeline)) return;

        timeline.forEach((p) => {
          if (
            p &&
            typeof p.time === "number" &&
            p.time >= safeStart &&
            p.time <= safeEnd
          ) {
            selectedTimes.push(p.time);
          }
        });
      });
    });

    if (selectedTimes.length === 0) {
      alert("選取區間內沒有任何光點可以平移！");
      return;
    }

    // 以整批光點的最早時間對齊到目標位置
    const globalFirstTime = Math.min(...selectedTimes);
    const offset = safeTarget - globalFirstTime;

    const updatedActionTable = produce(actionTable, (draft) => {
      Object.keys(draft).forEach((armorIdx) => {
        Object.keys(draft[armorIdx]).forEach((partIdx) => {
          const timeline = draft[armorIdx][partIdx];

          if (!Array.isArray(timeline)) return;

          const moveIndices = [];

          timeline.forEach((p, idx) => {
            if (p.time >= safeStart && p.time <= safeEnd) {
              moveIndices.push(idx);
            }
          });

          if (moveIndices.length === 0) return;

          const movedPoints = moveIndices.map((idx) => ({
            ...timeline[idx],
            color: { ...timeline[idx].color },
            time: timeline[idx].time + offset,
          }));

          const newStart = Math.min(...movedPoints.map((p) => p.time));
          const newEnd = Math.max(...movedPoints.map((p) => p.time));

          // 搬走的點，加上落點區間內原本就有的點，都要先移除
          const toRemove = new Set(moveIndices);

          timeline.forEach((p, idx) => {
            if (p.time >= newStart && p.time <= newEnd) {
              toRemove.add(idx);
            }
          });

          let nextTimeline = timeline.filter((_, idx) => !toRemove.has(idx));

          nextTimeline = [...nextTimeline, ...movedPoints].sort(
            (a, b) => a.time - b.time,
          );

          const firstColorPoint = movedPoints.find((p) => !isBlack(p));

          if (firstColorPoint) {
            ensureBlackBefore(nextTimeline, firstColorPoint.time);
          }

          draft[armorIdx][partIdx] = nextTimeline.sort(
            (a, b) => a.time - b.time,
          );
        });
      });
    });

    dispatch(updateActionTable(removeDuplicateBlackBlocks(updatedActionTable)));
    dispatch(updateCurrentTime(safeTarget));
  };

  /** 按下「確定」：依目前步驟記下播放位置，或在最後一步執行平移 */
  const advance = () => {
    const currentT = alignToTick(currentTime);

    if (step === 0) {
      setStep(1);
    } else if (step === 1) {
      setTimes((prev) => ({ ...prev, start: currentT }));
      setStep(2);
    } else if (step === 2) {
      if (currentT <= times.start) {
        alert("結束時間必須大於起始時間！");
        return;
      }
      setTimes((prev) => ({ ...prev, end: currentT }));
      setStep(3);
    } else if (step === 3) {
      executeTimeShift(times.start, times.end, currentT);
      reset();
    }
  };

  return { step, times, setStep, advance, reset };
}

/** 工具列上的按鈕與三步驟導引面板 */
export function ShiftToolButton({ shift }) {
  const currentTime = useSelector((state) => state.profiles.currentTime);
  const { step, times, setStep, advance, reset } = shift;

  return (
    <div className="shift-tool-wrapper">
      {step === 0 ? (
        <button className="shift-main-button" onClick={() => setStep(1)}>
          <FontAwesomeIcon icon={faArrowsLeftRight} size="lg" />
          <span className="tooltip">
            Shift all light dance data within the interval
          </span>
        </button>
      ) : (
        <div className="shift-guide-panel">
          <span className="shift-message">
            {step === 1 &&
              `[1/3] 設定「起始點」: ${alignToTick(currentTime)}ms`}
            {step === 2 && `[2/3] 起始: ${times.start}ms -> 設定「結束點」`}
            {step === 3 &&
              `[3/3] 區塊: ${times.start}~${times.end}ms -> 設定「目標位置」`}
          </span>
          <button className="shift-confirm-btn" onClick={advance}>
            <FontAwesomeIcon icon={faCheck} /> 確定
          </button>
          <button className="shift-cancel-btn" onClick={reset}>
            <FontAwesomeIcon icon={faTimes} /> 取消
          </button>
        </div>
      )}
    </div>
  );
}

/** 時間軸上的起訖標記 */
export function ShiftMarkers({ shift }) {
  const duration = useSelector((state) => state.profiles.duration);
  const { step, times } = shift;

  return (
    <>
      {step >= 2 && (
        <div
          className="shift-marker start-marker"
          style={{ left: `${(times.start / duration) * 100}%` }}
        >
          <span className="marker-label">Start</span>
        </div>
      )}
      {step >= 3 && (
        <div
          className="shift-marker end-marker"
          style={{ left: `${(times.end / duration) * 100}%` }}
        >
          <span className="marker-label">End</span>
        </div>
      )}
    </>
  );
}
