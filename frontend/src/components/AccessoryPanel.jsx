import { useState, memo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { updateCurrentTime } from "../redux/actions";
import { useSegmentArmorTimelines } from "../hooks/useSegmentActionTable.js";
import { ACCESSORY_CONFIGS } from "../config/accessoryConfig.js";
import "./AccessoryPanel.css";
import { TICK_MS } from "../constants/time.js";
import { getColorAt, insertColorSegment } from "../utils/segments/color.js";

function AccessoryPanel() {
  const dispatch = useDispatch();
  const selectedDancerId = useSelector((s) => s.profiles.selectedDancerId);
  // 只訂閱目前選到的那位舞者（selectedDancerId 為 null 時
  // 這個面板本來就不顯示內容）
  const { armorSegments, commitPart } =
    useSegmentArmorTimelines(selectedDancerId);
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

  // 與 Armor.jsx 共用同一份取色邏輯（見 utils/segments/color.js）。
  // 這裡原本有一份自己的插值實作，和光衣那份只差在字串格式。
  const getColor = (partIdx) => {
    const { R, G, B, A } = getColorAt(armorSegments[partIdx], time);
    return `rgba(${R}, ${G}, ${B}, ${A})`;
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
      insertColorSegment(armorSegments[partIdx], {
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
