import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { updateCurrentTime } from "../../redux/actions.js";
import { TICK_MS } from "../../constants/time.js";
import "./TimeRuler.css";

/**
 * 時間刻度尺。
 *
 * 在這之前，整個編輯器**沒有任何時間標記**——30 秒的曲子要把色塊對到副歌那一拍，
 * 只能靠一條紅色播放頭和右上角的 `0:00:000 / 0:30:000` 文字反推。這不只是
 * 美觀問題，它直接影響排燈的準確度。
 *
 * ## 為什麼可以放心插進來
 *
 * 它是 `<ShiftMarkers>` 的兄弟節點，兩者都住在 `.main-controlPanel` 裡：
 *
 * ```
 * .scroll-container            ← 橫向捲動
 *   └── .main-controlPanel     width: 100% × zoomLevel
 *         ├── <TimeRuler>      ← 這個
 *         ├── <ShiftMarkers>
 *         ├── .timeline-container
 *         └── .waveform-container
 * ```
 *
 * 裡面所有東西都用 `time / duration × 100%` 定位，所以縮放與橫向捲動**自動同步**，
 * 不需要任何新的座標邏輯。`ShiftMarkers` 已經證明這個模式可行。
 *
 * ## 刻度密度是算出來的，不是寫死的
 *
 * 固定「每 5 秒一格」在縮放 8 倍時會擠成一團。規則改成
 * **相鄰標籤至少相隔 `MIN_LABEL_GAP_PX`**，依此從 `NICE_STEPS` 裡挑最小的
 * 合適間隔——這是 DAW 的標準做法。
 */

/** 標籤之間至少要隔這麼多像素，否則文字會黏在一起 */
const MIN_LABEL_GAP_PX = 60;

/** 人看得懂的時間間隔（秒）。不用 3 秒、7 秒這種讀起來要換算的數字。 */
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];

/** 每個主刻度之間切幾格次刻度 */
const MINOR_DIVISIONS = 5;

/** 毫秒 → `m:ss` */
const formatLabel = (ms) => {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

/** 依目前的像素寬度挑一個「標籤不會擠在一起」的間隔（秒） */
export const pickStepSeconds = (durationMs, widthPx) => {
  if (!(durationMs > 0) || !(widthPx > 0)) return NICE_STEPS[0];
  const pxPerSecond = widthPx / (durationMs / 1000);
  return (
    NICE_STEPS.find((step) => step * pxPerSecond >= MIN_LABEL_GAP_PX) ??
    NICE_STEPS[NICE_STEPS.length - 1]
  );
};

function TimeRuler() {
  const dispatch = useDispatch();
  const duration = useSelector((state) => state.profiles.duration);
  const hostRef = useRef(null);
  const [width, setWidth] = useState(0);

  // 寬度會因為兩件事改變：縮放（.main-controlPanel 的 width 跟著 zoomLevel）
  // 與視窗大小。ResizeObserver 兩者都涵蓋，不必分別去訂閱。
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const ticks = useMemo(() => {
    if (!(duration > 0)) return [];

    const stepMs = pickStepSeconds(duration, width) * 1000;
    const minorMs = stepMs / MINOR_DIVISIONS;
    const result = [];

    for (let time = 0; time <= duration; time += minorMs) {
      // 浮點累加會漂移，用「離最近的主刻度多遠」判斷而不是直接比相等
      const isMajor = Math.abs(time % stepMs) < 1 || Math.abs((time % stepMs) - stepMs) < 1;
      result.push({
        time,
        isMajor,
        // 最後一格的標籤會貼齊右邊界被裁掉，不畫
        label: isMajor && time < duration - minorMs ? formatLabel(time) : null,
      });
    }
    return result;
  }, [duration, width]);

  /** 點刻度尺 = 跳到那個時間（對齊網格，與色塊的時間語意一致） */
  const handleSeek = (event) => {
    if (!(duration > 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const raw = Math.max(0, Math.min(ratio, 1)) * duration;
    dispatch(updateCurrentTime(Math.round(raw / TICK_MS) * TICK_MS));
  };

  return (
    <div
      className="time-ruler"
      ref={hostRef}
      onClick={handleSeek}
      role="slider"
      aria-label="時間軸刻度"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={0}
      tabIndex={-1}
    >
      {ticks.map(({ time, isMajor, label }) => (
        <React.Fragment key={time}>
          <span
            className={`ruler-tick${isMajor ? " is-major" : ""}`}
            style={{ left: `${(time / duration) * 100}%` }}
          />
          {label && (
            <span
              className="ruler-label"
              style={{ left: `${(time / duration) * 100}%` }}
            >
              {label}
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default React.memo(TimeRuler);
