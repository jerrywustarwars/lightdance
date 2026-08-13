import React, { memo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import "./Inspector.css";
import Palette from "./Palette.jsx";
import { updateCurrentTime } from "../redux/actions";
import { useSegmentArmorTimelines } from "../hooks/useSegmentActionTable.js";
import { ACCESSORY_CONFIGS } from "../config/accessoryConfig.js";
import { BODY_PART_COUNT, PART_LABELS } from "../constants/parts.js";
import { TICK_MS } from "../constants/time.js";
import { getColorAt, insertColorSegment } from "../utils/segments/color.js";

/**
 * Inspector —— 右側唯一的上下文面板。
 *
 * ## 為什麼要合併
 *
 * 這裡原本是兩欄：左邊「裝備編輯」列飾品、右邊調色盤選顏色。但它們回答的是
 * **同一句話**：你正在編輯誰的哪個部位、要塗什麼顏色。分成兩欄的代價是視線
 * 要來回跳，而且兩欄各佔一段寬度（200 + 168），把上面的光衣擠窄。
 *
 * 合併之後還多了一件事：**身體部位可以用點選的**。先前 14 個身體部位只能在
 * 光衣 SVG 上點，而那些形狀在縮小的卡片裡只有十幾像素寬——想塗「左手套」
 * 得先瞄準一個 32×35 的方塊縮到卡片大小之後的樣子。清單是文字，點得到。
 *
 * ## 為什麼部位清單要顯示顏色點
 *
 * 那個點就是該部位**此刻**的顏色（跟著播放頭走）。沒有它的話清單只是一排
 * 文字，你還是得回頭看光衣才知道哪個部位亮著。
 */
function Inspector({ rgba, setRgba }) {
  const dispatch = useDispatch();
  const selectedDancerId = useSelector((s) => s.profiles.selectedDancerId);
  const time = useSelector((s) => s.profiles.currentTime);
  const duration = useSelector((s) => s.profiles.duration);
  const chosenColor = useSelector((s) => s.profiles.chosenColor);
  const multiSelectedBlocks = useSelector((s) => s.profiles.multiSelectedBlocks);

  // 只訂閱目前選到的那位舞者。selectedDancerId 為 null 時這裡本來就沒有內容
  const { armorSegments, commitPart } =
    useSegmentArmorTimelines(selectedDancerId);

  const [tab, setTab] = useState("body");

  const accessory =
    selectedDancerId !== null
      ? (ACCESSORY_CONFIGS[selectedDancerId] ?? null)
      : null;

  /** 這個部位此刻的顏色（與光衣共用同一份取色邏輯） */
  const colorOf = (partIndex) => {
    const { R, G, B, A } = getColorAt(armorSegments[partIndex], time);
    return `rgba(${R}, ${G}, ${B}, ${A})`;
  };

  const isSelected = (partIndex) =>
    multiSelectedBlocks.some(
      (b) => b.armorIndex === selectedDancerId && b.partIndex === partIndex,
    );

  /** 在播放位置放一個色塊——和點光衣是同一個動作 */
  const placeColor = (partIndex) => {
    const nowTime = Math.floor(time / TICK_MS) * TICK_MS;
    dispatch(updateCurrentTime(nowTime));

    commitPart(
      partIndex,
      insertColorSegment(armorSegments[partIndex], {
        time: nowTime,
        color: chosenColor,
        duration,
      }),
    );
  };

  return (
    <aside className="inspector">
      <div className="inspector__head">
        <strong>
          {selectedDancerId !== null ? `舞者 ${selectedDancerId + 1}` : "未選取舞者"}
        </strong>
        <span>{selectedDancerId !== null ? "點部位放色" : "點一位舞者"}</span>
      </div>

      <Palette rgba={rgba} setRgba={setRgba} />

      {selectedDancerId === null ? (
        <div className="inspector__hint">點擊上方任一位舞者以編輯其部位</div>
      ) : (
        <>
          <div className="inspector__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className="inspector__tab"
              aria-selected={tab === "body"}
              onClick={() => setTab("body")}
            >
              部位
            </button>
            <button
              type="button"
              role="tab"
              className="inspector__tab"
              aria-selected={tab === "accessory"}
              onClick={() => setTab("accessory")}
              // 沒有配件的舞者不給切過去，免得切了看到一片空白
              disabled={!accessory}
            >
              飾品
            </button>
          </div>

          {tab === "body" && (
            <div className="inspector__parts">
              {PART_LABELS.slice(0, BODY_PART_COUNT).map((label, partIndex) => (
                <button
                  key={label}
                  type="button"
                  className="inspector__part"
                  aria-selected={isSelected(partIndex)}
                  data-part={partIndex}
                  onClick={() => placeColor(partIndex)}
                >
                  <span
                    className="inspector__dot"
                    style={{ backgroundColor: colorOf(partIndex) }}
                  />
                  {label}
                </button>
              ))}
            </div>
          )}

          {tab === "accessory" &&
            (accessory ? (
              <div className="inspector__accessory">
                <div className="inspector__accessory-name">
                  {accessory.name}
                </div>
                {accessory.groups.map((group) => (
                  <div key={group.label} className="inspector__group">
                    <div className="inspector__group-label">{group.label}</div>
                    <div className="inspector__dots">
                      {group.indices.map((partIndex) => (
                        <button
                          key={partIndex}
                          type="button"
                          className="inspector__acc-dot"
                          aria-selected={isSelected(partIndex)}
                          data-part={partIndex}
                          style={{ backgroundColor: colorOf(partIndex) }}
                          onClick={() => placeColor(partIndex)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="inspector__hint">此舞者無配件</div>
            ))}
        </>
      )}
    </aside>
  );
}

export default memo(Inspector);
