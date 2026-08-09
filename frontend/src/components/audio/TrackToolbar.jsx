import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrash,
  faPalette,
  faArrowRight,
  faArrowLeft,
  faScissors,
  faCircleHalfStroke,
} from "@fortawesome/free-solid-svg-icons";
import { produce } from "immer";

import { store } from "../../redux/store.js";
import {
  updateActionTable,
  updateMultiSelectedBlocks,
  updateChosenColor,
  updatePaletteColor,
  updateIsColorChangeActive,
  updateCurrentTime,
} from "../../redux/actions.js";
import { TICK_MS, LEGACY_BLACK_SENTINEL_MS } from "../../constants/time.js";
import { removeDuplicateBlackBlocks } from "../../utils/actionTable/blackSentinel.js";

/**
 * 色塊工具列：前一/下一個時間點、切割、刪除、亮度、改色、統一同色透明度。
 *
 * 這些動作大多同時有快捷鍵（C / Del / P / Ctrl+數字），所以邏輯放在
 * `useTrackActions()`，UI 放在 `<TrackToolbar>`；外殼呼叫一次 hook，
 * 按鈕與鍵盤共用同一組函式。
 */

/**
 * 亮度下拉的選項：0%、10%、…、100%。
 * 用 `toFixed(1)` 再轉回數字，避免 `3/10` 這種浮點誤差讓 select 對不上 value。
 */
const ALPHA_OPTIONS = [...Array(11)].map((_, i) => ({
  value: Number((i / 10).toFixed(1)),
  label: `${i * 10}%`,
}));

const rgbaToHex = (rgba) => {
  const r = rgba.R.toString(16).padStart(2, "0");
  const g = rgba.G.toString(16).padStart(2, "0");
  const b = rgba.B.toString(16).padStart(2, "0");

  return `#${r}${g}${b}`;
};

const clampAlpha = (value) => Math.max(0, Math.min(1, Number(value)));

export function useTrackActions() {
  const dispatch = useDispatch();
  const actionTable = useSelector((state) => state.profiles.data?.actionTable);
  const currentTime = useSelector((state) => state.profiles.currentTime);
  const duration = useSelector((state) => state.profiles.duration);
  const multiSelectedBlocks = useSelector(
    (state) => state.profiles.multiSelectedBlocks,
  );

  // 亮度下拉的顯示值，會跟著目前選取的色塊同步
  const [brightness, setBrightness] = useState(1);

  useEffect(() => {
    if (multiSelectedBlocks.length > 0) {
      const { armorIndex, partIndex, blockIndex } = multiSelectedBlocks[0];
      const block = actionTable?.[armorIndex]?.[partIndex]?.[blockIndex];
      if (block?.color?.A !== undefined) {
        setBrightness(block.color.A);
      }
    }
  }, [multiSelectedBlocks, actionTable]);

  /** 把整段選取塗黑（等同刪除色塊） */
  const deleteSelected = () => {
    if (multiSelectedBlocks.length === 0) return;

    const groupedByPart = multiSelectedBlocks.reduce((acc, block) => {
      const key = `${block.armorIndex}-${block.partIndex}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(block.blockIndex);
      return acc;
    }, {});

    const updatedActionTable = produce(actionTable, (draft) => {
      Object.keys(groupedByPart).forEach((key) => {
        const [armorIndexStr, partIndexStr] = key.split("-");
        const armorIndex = parseInt(armorIndexStr, 10);
        const partIndex = parseInt(partIndexStr, 10);
        const blockIndexes = groupedByPart[key];

        const minBlockIndex = Math.min(...blockIndexes);
        const maxBlockIndex = Math.max(...blockIndexes);

        const timeline = draft[armorIndex]?.[partIndex];

        if (!timeline) return;

        const selectionStartTime = timeline[minBlockIndex]?.time;
        const selectionEndTime = timeline[maxBlockIndex + 1]?.time ?? duration;

        const startIndex = timeline.findIndex(
          (entry) => entry.time === selectionStartTime,
        );

        if (startIndex === -1) return;

        // 選取的第一個關鍵格塗黑，其後到選取結束之間的關鍵格全部移除
        timeline[startIndex].color = { R: 0, G: 0, B: 0, A: 1 };
        timeline[startIndex].linear = 0;

        let deleteStartIndex = startIndex + 1;
        let deleteCount = 0;
        while (
          deleteStartIndex + deleteCount < timeline.length &&
          timeline[deleteStartIndex + deleteCount].time < selectionEndTime
        ) {
          deleteCount++;
        }

        if (deleteCount > 0) {
          timeline.splice(deleteStartIndex, deleteCount);
        }
      });
    });

    dispatch(updateActionTable(removeDuplicateBlackBlocks(updatedActionTable)));
    dispatch(updateMultiSelectedBlocks([]));
  };

  /** 在播放位置把選取的色塊切成兩段 */
  const cutSelected = () => {
    if (multiSelectedBlocks.length !== 1) {
      console.warn(
        "Cut operation is only valid when exactly one block is selected.",
      );
      return;
    }

    // 直接從 Redux store 讀取最新 currentTime，繞過 closure stale 問題
    const curTime = store.getState().profiles.currentTime;

    const { armorIndex, partIndex, blockIndex } = multiSelectedBlocks[0];

    const updatedActionTable = produce(actionTable, (draft) => {
      const timeline = draft[armorIndex]?.[partIndex];
      const originalBlock = timeline?.[blockIndex];
      const nextBlock = timeline?.[blockIndex + 1];

      // 若為最後一個區塊，以 duration 作為隱含結束邊界
      const blockEndTime = nextBlock?.time ?? duration;

      if (
        !originalBlock ||
        curTime <= originalBlock.time ||
        curTime >= blockEndTime
      ) {
        console.warn("Cut operation is not valid at the current time.");
        return;
      }

      let newBlockColor = originalBlock.color;
      const isOriginalLinear = originalBlock.linear === 1;

      // 漸變中的色塊要在切點取出當下的插值顏色，兩段才接得起來
      if (isOriginalLinear) {
        const gradientTargetBlock = timeline[blockIndex + 2];
        const startColor = originalBlock.color;
        const endColor = gradientTargetBlock?.color || {
          R: 0,
          G: 0,
          B: 0,
          A: 1,
        };
        const startTime = originalBlock.time;
        const endTime = nextBlock?.time ?? duration;

        if (endTime > startTime) {
          const ratio = (curTime - startTime) / (endTime - startTime);
          newBlockColor = {
            R: Math.round(startColor.R * (1 - ratio) + endColor.R * ratio),
            G: Math.round(startColor.G * (1 - ratio) + endColor.G * ratio),
            B: Math.round(startColor.B * (1 - ratio) + endColor.B * ratio),
            A: (startColor.A ?? 1) * (1 - ratio) + (endColor.A ?? 1) * ratio,
          };
        }
        originalBlock.linear = 1;
      }

      const newBlackBlock = {
        time: curTime - LEGACY_BLACK_SENTINEL_MS,
        color: { R: 0, G: 0, B: 0, A: 1 },
        linear: 0,
      };

      const newBlock = {
        time: curTime,
        color: newBlockColor,
        linear: isOriginalLinear ? 1 : 0,
      };

      timeline.splice(blockIndex + 1, 0, newBlackBlock, newBlock);
      timeline.sort((a, b) => a.time - b.time);
    });

    dispatch(updateActionTable(updatedActionTable));

    // 選取跟著移到切出來的後半段（黑點 + 新色塊 = 往後 2 格）
    dispatch(
      updateMultiSelectedBlocks([
        { armorIndex, partIndex, blockIndex: blockIndex + 2 },
      ]),
    );
  };

  /**
   * 把播放位置移到選取部位的上/下一個關鍵格。
   *
   * 黑色哨兵和它守護的色塊只差 10ms，跳到黑點上對使用者沒有意義，
   * 所以差距剛好是哨兵間距時要再跳一格。
   */
  const goToPreviousPoint = () => {
    if (multiSelectedBlocks.length === 0) return;

    const { armorIndex, partIndex } = multiSelectedBlocks[0];
    const timeline = actionTable[armorIndex]?.[partIndex];

    if (!timeline || timeline.length === 0) {
      console.warn("No valid timeline found for the selected block.");
      return;
    }

    const filteredTimes = timeline
      .map((block) => block.time)
      .filter((time) => time < currentTime)
      .sort((a, b) => b - a);

    const previousTime = filteredTimes[0];
    const secondPreviousTime = filteredTimes[1];

    let selectedTime = previousTime;
    if (
      previousTime !== undefined &&
      secondPreviousTime !== undefined &&
      currentTime - previousTime === LEGACY_BLACK_SENTINEL_MS
    ) {
      selectedTime = secondPreviousTime;
    }

    if (selectedTime !== undefined) {
      dispatch(updateCurrentTime(Math.round(selectedTime / TICK_MS) * TICK_MS));
    } else {
      console.warn("No previous time point found.");
    }
  };

  const goToNextPoint = () => {
    if (multiSelectedBlocks.length === 0) return;
    const { armorIndex, partIndex } = multiSelectedBlocks[0];
    const timeline = actionTable[armorIndex]?.[partIndex];

    if (!timeline || timeline.length === 0) {
      console.warn("No valid timeline found for the selected block.");
      return;
    }

    const filteredTimes = timeline
      .map((block) => block.time)
      .filter((time) => time > currentTime)
      .sort((a, b) => a - b);

    if (filteredTimes.length === 0) {
      console.warn("No next time point found.");
      return;
    }

    const firstTime = filteredTimes[0];
    const secondTime = filteredTimes[1];

    let nextTime = firstTime;

    if (
      secondTime !== undefined &&
      secondTime - firstTime === LEGACY_BLACK_SENTINEL_MS
    ) {
      nextTime = secondTime;
    }

    nextTime = Math.min(Math.round(nextTime / TICK_MS) * TICK_MS, duration);
    dispatch(updateCurrentTime(nextTime));
  };

  /** 設定選取色塊的透明度 */
  const changeBrightness = (newBrightness) => {
    if (!multiSelectedBlocks || multiSelectedBlocks.length === 0) {
      console.warn("No blocks selected to change brightness.");
      return;
    }

    if (Number.isNaN(Number(newBrightness))) {
      console.warn("Invalid brightness value:", newBrightness);
      return;
    }

    const alphaValue = clampAlpha(newBrightness);

    const updatedActionTable = produce(actionTable, (draft) => {
      multiSelectedBlocks.forEach(({ armorIndex, partIndex, blockIndex }) => {
        const timeline = draft[armorIndex]?.[partIndex];

        if (timeline?.[blockIndex]?.color) {
          timeline[blockIndex].color.A = alphaValue;
        }
      });
    });

    dispatch(updateActionTable(updatedActionTable));

    const { armorIndex, partIndex, blockIndex } = multiSelectedBlocks[0];
    const firstBlockColor =
      actionTable?.[armorIndex]?.[partIndex]?.[blockIndex]?.color;

    if (firstBlockColor) {
      dispatch(updateChosenColor({ ...firstBlockColor, A: alphaValue }));
    }

    setBrightness(alphaValue);
  };

  /** 開啟調色盤，並把它的初始顏色設成選取色塊的顏色 */
  const openColorPicker = () => {
    if (multiSelectedBlocks.length === 0) return;

    const { armorIndex, partIndex, blockIndex } = multiSelectedBlocks[0];
    const block = actionTable?.[armorIndex]?.[partIndex]?.[blockIndex];

    if (!block || !block.color) {
      console.warn("Selected block has no color information.");
      return;
    }

    const blockColor = block.color;
    dispatch(updatePaletteColor(rgbaToHex(blockColor)));
    dispatch(updateChosenColor(blockColor));
    dispatch(updateIsColorChangeActive(true));

    const palette = document.querySelector("#colorWell");
    if (palette) {
      palette.value = rgbaToHex(blockColor);
      palette.dispatchEvent(new Event("input"));
      palette.click();
    }
  };

  /** 統一調整「全場所有和選取色塊同色」的色塊透明度 */
  const setAlphaForSameColor = (newAlpha) => {
    if (!multiSelectedBlocks || multiSelectedBlocks.length !== 1) {
      alert("請先只選取一個色塊");
      return;
    }

    if (Number.isNaN(Number(newAlpha))) {
      console.warn("Invalid alpha value:", newAlpha);
      return;
    }

    const alphaValue = clampAlpha(newAlpha);

    const { armorIndex, partIndex, blockIndex } = multiSelectedBlocks[0];
    const selectedColor =
      actionTable?.[armorIndex]?.[partIndex]?.[blockIndex]?.color;

    if (!selectedColor) {
      alert("找不到 selectedBlock 的顏色資料");
      return;
    }

    const targetR = Number(selectedColor.R);
    const targetG = Number(selectedColor.G);
    const targetB = Number(selectedColor.B);

    const updatedActionTable = produce(actionTable, (draft) => {
      Object.values(draft || {}).forEach((armor) => {
        Object.values(armor || {}).forEach((timeline) => {
          if (!Array.isArray(timeline)) return;

          timeline.forEach((block) => {
            const color = block?.color;
            if (!color) return;

            const sameColor =
              Number(color.R) === targetR &&
              Number(color.G) === targetG &&
              Number(color.B) === targetB;

            if (sameColor) {
              color.A = alphaValue;
            }
          });
        });
      });
    });

    dispatch(updateActionTable(updatedActionTable));
    dispatch(updateChosenColor({ ...selectedColor, A: alphaValue }));
    setBrightness(alphaValue);
  };

  /** 只有恰好選取一個有顏色的色塊時，才能開統一透明度選單 */
  const canSetAlphaForSameColor = () => {
    if (!multiSelectedBlocks || multiSelectedBlocks.length !== 1) {
      alert("請先只選取一個色塊");
      return false;
    }

    const { armorIndex, partIndex, blockIndex } = multiSelectedBlocks[0];
    const selectedBlock = actionTable?.[armorIndex]?.[partIndex]?.[blockIndex];

    if (!selectedBlock?.color) {
      alert("找不到 selectedBlock 的顏色資料");
      return false;
    }

    return true;
  };

  return {
    brightness,
    deleteSelected,
    cutSelected,
    goToPreviousPoint,
    goToNextPoint,
    changeBrightness,
    openColorPicker,
    setAlphaForSameColor,
    canSetAlphaForSameColor,
  };
}

/** 「統一同色透明度」按鈕與它的百分比選單 */
function UniformAlphaMenu({ actions }) {
  const [visible, setVisible] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        visible &&
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target)
      ) {
        setVisible(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [visible]);

  return (
    <div
      ref={wrapperRef}
      className="uniform-alpha-wrapper"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className="shift-main-button uniform-alpha-button"
        onClick={(e) => {
          e?.stopPropagation();
          if (!actions.canSetAlphaForSameColor()) return;
          setVisible((prev) => !prev);
        }}
      >
        <FontAwesomeIcon icon={faCircleHalfStroke} size="lg" />
        <span className="tooltip">
          Set opacity for all blocks with selected color
        </span>
      </button>

      {visible && (
        <div className="uniform-alpha-menu">
          {ALPHA_OPTIONS.map((item) => (
            <button
              key={item.value}
              className="uniform-alpha-option"
              onClick={(e) => {
                e.stopPropagation();
                actions.setAlphaForSameColor(item.value);
                setVisible(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrackNavigation({ actions }) {
  return (
    <div className="timeline-controls">
      <button className="timeline-left" onClick={actions.goToPreviousPoint}>
        <FontAwesomeIcon icon={faArrowLeft} size="lg" />
        <span className="tooltip">Previous Time Point (Shift + ←)</span>
      </button>
      <button className="timeline-right" onClick={actions.goToNextPoint}>
        <FontAwesomeIcon icon={faArrowRight} size="lg" />
        <span className="tooltip">Next Time Point (Shift + →)</span>
      </button>
    </div>
  );
}

/** 剪下、刪除、亮度、改色 */
export function TrackEditButtons({ actions }) {
  return (
    <>
      <button className="cut-button" onClick={actions.cutSelected}>
        <FontAwesomeIcon icon={faScissors} size="lg" />
        <span className="tooltip">Cut Selected Block ( C )</span>
      </button>
      <button className="delete-button" onClick={actions.deleteSelected}>
        <FontAwesomeIcon icon={faTrash} size="lg" />
        <span className="tooltip">Delete Selected Block ( Del )</span>
      </button>

      <div className="brightness-control">
        <FontAwesomeIcon icon={faCircleHalfStroke} />
        <select
          id="brightness-select"
          className="dropdown-select"
          value={actions.brightness}
          onChange={(e) => actions.changeBrightness(e.target.value)}
          style={{ marginLeft: "10px" }}
        >
          {ALPHA_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="tooltip">Brightness</span>
      </div>
      <button className="color-button" onClick={actions.openColorPicker}>
        <FontAwesomeIcon icon={faPalette} size="lg" />
        <span className="tooltip">Color( P )</span>
      </button>
    </>
  );
}

export { UniformAlphaMenu };
