import { useState, memo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { updateCurrentTime } from "../redux/actions";
import { useKeyframeArmorTimelines } from "../hooks/useKeyframeActionTable.js";
import { ACCESSORY_CONFIGS } from "../config/accessoryConfig.js";
import "./AccessoryPanel.css";
import { PART_KEYS } from "../constants/parts.js";
import { TICK_MS } from "../constants/time.js";
import {
  insertColorKeyframes,
  binarySearchFirstGreater,
} from "../utils/actionTable/insertColorKeyframes.js";

const PART_NAMES = PART_KEYS;

function AccessoryPanel() {
  const dispatch = useDispatch();
  const selectedDancerId = useSelector((s) => s.profiles.selectedDancerId);
  // Phase 4 過渡橋：只訂閱目前選到的那位舞者（selectedDancerId 為 null 時
  // 這個面板本來就不顯示內容）
  const { timelines, commitPart } = useKeyframeArmorTimelines(selectedDancerId);
  const time = useSelector((s) => s.profiles.currentTime);
  const duration = useSelector((s) => s.profiles.duration);
  const chosenColor = useSelector((s) => s.profiles.chosenColor);
  const multiSelectedBlocks = useSelector(
    (s) => s.profiles.multiSelectedBlocks,
  );

  const config =
    selectedDancerId !== null
      ? (ACCESSORY_CONFIGS[selectedDancerId] ?? null)
      : null;

  const getColor = (partIdx) => {
    const partData = timelines[partIdx] || [];
    const idx = binarySearchFirstGreater(partData, time);
    const prev = partData[idx - 1];
    const next = partData[idx];

    if (prev?.linear === 1 && next) {
      const ratio = (time - prev.time) / (next.time - prev.time);
      if (next.time > prev.time) {
        const afterNext = partData[idx + 1];
        const end = afterNext?.color || { R: 0, G: 0, B: 0, A: 1 };
        return `rgba(
          ${Math.round(prev.color.R * (1 - ratio) + end.R * ratio)},
          ${Math.round(prev.color.G * (1 - ratio) + end.G * ratio)},
          ${Math.round(prev.color.B * (1 - ratio) + end.B * ratio)},
          ${(prev.color.A ?? 1) * (1 - ratio) + (end.A ?? 1) * ratio}
        )`;
      }
    }
    const c = prev?.color || { R: 0, G: 0, B: 0, A: 1 };
    return `rgba(${c.R},${c.G},${c.B},${c.A})`;
  };

  const isSelected = (partIdx) =>
    multiSelectedBlocks.some(
      (b) => b.armorIndex === selectedDancerId && b.partIndex === partIdx,
    );

  const handleClick = (partIdx) => {
    const nowTime = Math.floor(time / TICK_MS) * TICK_MS;
    dispatch(updateCurrentTime(nowTime));

    commitPart(
      partIdx,
      insertColorKeyframes(timelines[partIdx], {
        time: nowTime,
        color: chosenColor,
        duration,
      }),
    );
  };

  const [open, setOpen] = useState(true);

  return (
    <div className={`accessory-sidebar${open ? "" : " collapsed"}`}>
      <div className="sidebar-header" onClick={() => setOpen((v) => !v)}>
        <span className="sidebar-title-text">
          {selectedDancerId !== null
            ? `舞者 ${selectedDancerId + 1} — 裝備編輯`
            : "裝備編輯"}
        </span>
        <span className="sidebar-toggle-icon">{open ? "▲" : "▼"}</span>
      </div>

      {open && selectedDancerId === null && (
        <div className="sidebar-hint">點擊舞者以查看裝備</div>
      )}

      {open && selectedDancerId !== null && !config && (
        <div className="sidebar-hint">此舞者無配件</div>
      )}

      {open && config && (
        <div className="sidebar-content">
          <div className="sidebar-accessory-name">{config.name}</div>
          {config.groups.map((group) => (
            <div key={group.label} className="sidebar-group">
              <div className="sidebar-group-label">{group.label}</div>
              <div className="sidebar-dots">
                {group.indices.map((partIdx) => (
                  <div
                    key={partIdx}
                    className={`sidebar-dot${isSelected(partIdx) ? " selected" : ""}`}
                    style={{ backgroundColor: getColor(partIdx) }}
                    onClick={() => handleClick(partIdx)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(AccessoryPanel);
