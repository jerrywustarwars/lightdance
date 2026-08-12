import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrash,
  faPalette,
  faArrowRight,
  faArrowLeft,
  faScissors,
  faCircleHalfStroke,
} from "@fortawesome/free-solid-svg-icons";
import {
  updateMultiSelectedBlocks,
  updateChosenColor,
  updatePaletteColor,
  updateIsColorChangeActive,
  updateCurrentTime,
} from "../../redux/actions.js";
import { TICK_MS } from "../../constants/time.js";
import { useSegmentActionTable } from "../../hooks/useSegmentActionTable.js";
import { splitSegmentAt } from "../../utils/segments/color.js";
import {
  findSegmentById,
  makeSelection,
  resolveSelections,
} from "../../utils/selection.js";

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
  // 從 Provider 拿 store，不要 import 模組層的 singleton——singleton 在測試裡
  // 會是另一個 store instance，讀到的 state 跟畫面上的無關。
  const store = useStore();
  const { segmentTable, duration, commit, commitPart } =
    useSegmentActionTable();
  const currentTime = useSelector((state) => state.profiles.currentTime);
  const multiSelectedBlocks = useSelector(
    (state) => state.profiles.multiSelectedBlocks,
  );

  /** 選取所在的部位（所有動作都以第一筆選取為準） */
  const activePart = multiSelectedBlocks[0] ?? null;

  /** 該部位的 segments */
  const activeSegments = activePart
    ? (segmentTable?.[activePart.armorIndex]?.[activePart.partIndex] ?? [])
    : [];

  /** 選取解析成真正的 segment，並濾掉已經不存在的（例如剛被 undo 掉） */
  const selectedSegments = resolveSelections(
    multiSelectedBlocks,
    activeSegments,
  ).map((entry) => entry.segment);

  /** 第一個選取的 segment，工具列的顏色/亮度都以它為準 */
  const firstSegment = selectedSegments[0] ?? null;

  // 亮度下拉的顯示值，會跟著目前選取的色塊同步
  const [brightness, setBrightness] = useState(1);

  useEffect(() => {
    const alpha = firstSegment?.colorStart?.A;
    if (alpha !== undefined) setBrightness(alpha);
  }, [firstSegment]);

  /**
   * 刪除選取的色塊。
   *
   * segment 模型不需要「塗黑」——把那幾段從資料裡拿掉就是熄滅。舊版要把
   * 第一個關鍵格改成黑色、再把後面到選取結束之間的關鍵格 splice 掉，
   * 最後還得跑 removeDuplicateBlackBlocks 收拾殘留的黑點。
   */
  const deleteSelected = () => {
    if (multiSelectedBlocks.length === 0) return;

    // 依部位分組：一次選取可能跨好幾條時間軸
    const byPart = new Map();
    for (const selection of multiSelectedBlocks) {
      const key = `${selection.armorIndex}-${selection.partIndex}`;
      if (!byPart.has(key)) byPart.set(key, []);
      byPart.get(key).push(selection);
    }

    let nextTable = segmentTable;

    for (const selections of byPart.values()) {
      const { armorIndex, partIndex } = selections[0];
      const segments = nextTable?.[armorIndex]?.[partIndex] ?? [];
      const doomed = new Set(selections.map((s) => s.segmentId));

      const remaining = segments.filter((segment) => !doomed.has(segment.id));
      if (remaining.length === segments.length) continue; // 這條沒東西被刪到

      nextTable = nextTable.map((armor, a) =>
        a === armorIndex
          ? armor.map((segs, p) => (p === partIndex ? remaining : segs))
          : armor,
      );
    }

    commit(nextTable);
    dispatch(updateMultiSelectedBlocks([]));
  };

  /**
   * 在播放位置把選取的色塊切成兩段。
   *
   * 漸變的插值、id 分配、邊界檢查全在 `splitSegmentAt` 裡（有測試證明
   * 切開前後逐格顏色一致）。這裡只負責讀播放位置、寫回、把選取移到後半段。
   */
  const cutSelected = () => {
    if (multiSelectedBlocks.length !== 1) {
      console.warn(
        "Cut operation is only valid when exactly one block is selected.",
      );
      return;
    }

    // 直接從 Redux store 讀取最新 currentTime，繞過 closure stale 問題
    const curTime = store.getState().profiles.currentTime;
    const { armorIndex, partIndex, segmentId } = multiSelectedBlocks[0];
    const segments = segmentTable?.[armorIndex]?.[partIndex] ?? [];

    const target = findSegmentById(segments, segmentId);
    if (!target || curTime <= target.start || curTime >= target.end) {
      console.warn("Cut operation is not valid at the current time.");
      return;
    }

    const nextSegments = splitSegmentAt(segments, curTime);
    if (nextSegments === segments) return;

    commitPart(armorIndex, partIndex, nextSegments);

    // 選取移到切出來的後半段（它拿到新的 id）
    const back = nextSegments.find((segment) => segment.start === curTime);
    if (back) {
      dispatch(
        updateMultiSelectedBlocks([
          makeSelection({ armorIndex, partIndex, segment: back }),
        ]),
      );
    }
  };

  /**
   * 選取部位上所有色塊的邊界時間（起點與終點），由小到大且不重複。
   *
   * 這就是導航會停的點。舊版是走 keyframe 的 time 清單，因此會停在黑色哨兵上
   * ——那個點只差色塊 10ms，對使用者沒有意義，所以還要額外判斷「差距剛好是
   * 哨兵間距就再跳一格」。segment 世界沒有哨兵，邊界就是邊界。
   */
  const boundaryTimes = () => {
    if (!activePart) return [];
    const times = new Set();
    for (const segment of activeSegments) {
      times.add(segment.start);
      times.add(segment.end);
    }
    return [...times].sort((a, b) => a - b);
  };

  const goToPreviousPoint = () => {
    if (multiSelectedBlocks.length === 0) return;

    const previous = boundaryTimes()
      .filter((time) => time < currentTime)
      .pop();

    if (previous === undefined) {
      console.warn("No previous time point found.");
      return;
    }
    dispatch(updateCurrentTime(Math.round(previous / TICK_MS) * TICK_MS));
  };

  const goToNextPoint = () => {
    if (multiSelectedBlocks.length === 0) return;

    const next = boundaryTimes().find((time) => time > currentTime);

    if (next === undefined) {
      console.warn("No next time point found.");
      return;
    }
    dispatch(
      updateCurrentTime(
        Math.min(Math.round(next / TICK_MS) * TICK_MS, duration),
      ),
    );
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
    const doomed = new Set(multiSelectedBlocks.map((s) => s.segmentId));

    // 選取一定落在同一個部位上（Timeline 的多選不跨軌），所以只改那一條
    const nextSegments = activeSegments.map((segment) =>
      doomed.has(segment.id)
        ? {
            ...segment,
            colorStart: { ...segment.colorStart, A: alphaValue },
            colorEnd: { ...segment.colorEnd, A: alphaValue },
          }
        : segment,
    );

    commitPart(activePart.armorIndex, activePart.partIndex, nextSegments);

    if (firstSegment) {
      dispatch(
        updateChosenColor({ ...firstSegment.colorStart, A: alphaValue }),
      );
    }

    setBrightness(alphaValue);
  };

  /** 開啟調色盤，並把它的初始顏色設成選取色塊的顏色 */
  const openColorPicker = () => {
    if (multiSelectedBlocks.length === 0) return;

    if (!firstSegment) {
      console.warn("Selected block has no color information.");
      return;
    }

    const blockColor = firstSegment.colorStart;
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

    if (!firstSegment) {
      alert("找不到 selectedBlock 的顏色資料");
      return;
    }

    const selectedColor = firstSegment.colorStart;
    const isTargetColor = (color) =>
      Number(color?.R) === Number(selectedColor.R) &&
      Number(color?.G) === Number(selectedColor.G) &&
      Number(color?.B) === Number(selectedColor.B);

    // 全場掃一遍，但**逐層維持結構共享**：沒被改到的部位沿用原陣列、
    // 沒被改到的舞者沿用整列、整張表都沒變就回傳原表（commit 會判斷成 no-op，
    // 不佔一格 undo）。少做這件事的話，7 個 Armor 與 154 條 Timeline 會全部重繪。
    let tableChanged = false;

    const nextTable = segmentTable.map((armor) => {
      let armorChanged = false;

      const nextArmor = armor.map((segments) => {
        let partChanged = false;

        const nextSegments = segments.map((segment) => {
          if (!isTargetColor(segment.colorStart)) return segment;
          if (segment.colorStart.A === alphaValue) return segment;
          partChanged = true;
          return {
            ...segment,
            colorStart: { ...segment.colorStart, A: alphaValue },
            colorEnd: { ...segment.colorEnd, A: alphaValue },
          };
        });

        if (!partChanged) return segments;
        armorChanged = true;
        return nextSegments;
      });

      if (!armorChanged) return armor;
      tableChanged = true;
      return nextArmor;
    });

    commit(tableChanged ? nextTable : segmentTable);
    dispatch(updateChosenColor({ ...selectedColor, A: alphaValue }));
    setBrightness(alphaValue);
  };

  /** 只有恰好選取一個有顏色的色塊時，才能開統一透明度選單 */
  const canSetAlphaForSameColor = () => {
    if (!multiSelectedBlocks || multiSelectedBlocks.length !== 1) {
      alert("請先只選取一個色塊");
      return false;
    }

    if (!firstSegment) {
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
        <span className="tooltip">上一個時間點<kbd>Shift+←</kbd></span>
      </button>
      <button className="timeline-right" onClick={actions.goToNextPoint}>
        <FontAwesomeIcon icon={faArrowRight} size="lg" />
        <span className="tooltip">下一個時間點<kbd>Shift+→</kbd></span>
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
        <span className="tooltip">剪下色塊<kbd>C</kbd></span>
      </button>
      <button className="delete-button" onClick={actions.deleteSelected}>
        <FontAwesomeIcon icon={faTrash} size="lg" />
        <span className="tooltip">刪除色塊<kbd>Del</kbd></span>
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
        <span className="tooltip">亮度</span>
      </div>
      <button className="color-button" onClick={actions.openColorPicker}>
        <FontAwesomeIcon icon={faPalette} size="lg" />
        <span className="tooltip">顏色<kbd>P</kbd></span>
      </button>
    </>
  );
}

export { UniformAlphaMenu };
