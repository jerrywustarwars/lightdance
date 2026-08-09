import React, { useRef, useState, useEffect, createRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  updateActionTable,
  updateMultiSelectedBlocks,
  toggleMoveMode,
  // updateMusicIndex,
} from "../../redux/actions.js";
import "./audioplayer.css";
import Waveform from "./waveform.jsx";
import MusicSelector from "./MusicSelector.jsx";
import PlayerControls from "./PlayerControls.jsx";
import { useTimeShift, ShiftToolButton, ShiftMarkers } from "./ShiftTool.jsx";
import EffectMenu, { useLightEffects } from "./EffectMenu.jsx";
import { useCopyPaste, CopyModeBanner } from "./CopyPasteManager.jsx";
import {
  useTrackActions,
  TrackNavigation,
  TrackEditButtons,
  UniformAlphaMenu,
} from "./TrackToolbar.jsx";
import Timeline from "./Timeline.jsx";
import { produce } from "immer";
import { updateChosenColor, updateCurrentTime } from "../../redux/actions.js";
import { TICK_MS, LEGACY_BLACK_SENTINEL_MS } from "../../constants/time.js";
import { insertColorKeyframes } from "../../utils/actionTable/insertColorKeyframes.js";

function AudioPlayer({ setButtonState, timelineRef }) {
  const dispatch = useDispatch();
  const data = useSelector((state) => state.profiles.data);
  const showPart = useSelector((state) => state.profiles.showPart);
  const currentTime = useSelector((state) => state.profiles.currentTime);
  const duration = useSelector((state) => state.profiles.duration); // 音樂總長度
  const actionTable = data?.actionTable || []; // Redux 狀態中的動作表
  const chosenColor = useSelector((state) => state.profiles.chosenColor);
  const favoriteColor = useSelector((state) => state.profiles.favoriteColor);
  const isColorChangeActive = useSelector(
    (state) => state.profiles.isColorChangeActive,
  );
  const multiSelectedBlocks = useSelector(
    (state) => state.profiles.multiSelectedBlocks,
  );

  const scrollRef = useRef(null); // 滾動條的容器
  const containerRef = useRef(null); // 波形的容器
  const [volume, setVolume] = useState(0.5); // 音量
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // 放大級別
  const progressFlagRef = useRef(null); // P0: 進度條 DOM ref，60fps 直接操作
  const [sourceNode, setSourceNode] = useState(null);
  const elRefs = useRef([]);

  const effects = useLightEffects(); // 漸變/頻閃/亮度階梯：選單與快捷鍵共用
  const shift = useTimeShift(); // 區間平移：按鈕與時間軸標記共用同一份狀態
  const trackActions = useTrackActions(); // 剪下/刪除/導航/亮度/改色：工具列與快捷鍵共用
  const copyPaste = useCopyPaste(); // 複製貼上與複製模式

  useEffect(() => {
    setButtonState(isPlaying);
  }, [isPlaying, setButtonState]);

  useEffect(() => {
    console.log("multiSelectedBlocks for debugging:", multiSelectedBlocks);
  }, [multiSelectedBlocks]);

  useEffect(() => {
    elRefs.current = showPart.map((_, i) => elRefs.current[i] || createRef());
  }, [showPart]);

  useEffect(() => {
    if (isColorChangeActive && multiSelectedBlocks.length > 0 && chosenColor) {
      // 使用 Immer 深拷贝并更新
      const updatedActionTable = produce(actionTable, (draft) => {
        multiSelectedBlocks.forEach(({ armorIndex, partIndex, blockIndex }) => {
          const timeline = draft[armorIndex][partIndex];
          if (timeline && timeline[blockIndex]) {
            timeline[blockIndex].color = chosenColor; // 更新 block 的颜色
          }
        });
      });

      // 通过 Redux 更新 actionTable
      dispatch(updateActionTable(updatedActionTable));

      console.log("Updated actionTable with new color:", chosenColor);

      // 重置调色状态
    }
  }, [
    isColorChangeActive,
    chosenColor,
    multiSelectedBlocks,
    actionTable,
    dispatch,
  ]);

  // P0: 進度條改由 waveform.jsx 的 rAF 透過 onTimeUpdate callback 直接操作 DOM（60fps）
  // 移除了 setProgressWidth 的 useEffect，避免播放期間不必要的 re-render

  // 在 AudioPlayer 內部新增狀態
  const keyPress = useRef(false);

  const handleKeyDown = (event) => {
    if (keyPress.current) return; // 避免重複觸發

    keyPress.current = true;
    setTimeout(() => (keyPress.current = false), 100);

    console.log(
      "Pressed key:",
      event.key,
      "Code:",
      event.code,
      "Shift:",
      event.shiftKey,
    );

    if (event.key === "Escape") {
      if (copyPaste.isCopying) {
        event.preventDefault(); // ✅ 攔截瀏覽器預設行為
        event.stopPropagation();
        copyPaste.cancelCopying();
        return;
      }
    }
    if (event.key === "b" || event.key === "B") {
      event.preventDefault();
      if (multiSelectedBlocks.length === 1) {
        const userInput = window.prompt(
          `請輸入頻閃間隔 (ms)，必須為 ${TICK_MS} 的倍數：`,
          "100",
        );
        if (userInput !== null) {
          // 如果使用者沒點取消
          effects.applyBlink(userInput);
        }
      } else {
        console.warn("Please select exactly one block to use Blink effect.");
      }
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (event.key === "ArrowRight") {
        console.log("ArrowRight pressed. Advancing 50ms");
        dispatch(
          updateCurrentTime(
            currentTime + 50 > duration
              ? Math.floor(duration / 50) * 50
              : currentTime + 50,
          ),
        );
      } else if (event.key === "ArrowLeft") {
        console.log("ArrowLeft pressed. Going back 50ms");
        dispatch(
          updateCurrentTime(currentTime - 50 < 0 ? 0 : currentTime - 50),
        );
      }
    }

    if (event.shiftKey) {
      // Shift + C: 複製整個部位
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        console.log("Shift + C: Copy whole timeline");
        copyPaste.copyWholePart();
      }
      // Shift + V: 貼上整個部位 (整條覆蓋)
      else if (event.key === "v" || event.key === "V") {
        if (!event.ctrlKey) {
          // 排除 Ctrl+Shift+V
          event.preventDefault();
          console.log("Shift + V: Paste whole timeline");
          copyPaste.pasteWholePart();
        }
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        console.log("Shift + ArrowRight pressed. Moving right.");
        trackActions.goToNextPoint();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        console.log("Shift + ArrowLeft pressed. Moving left.");
        trackActions.goToPreviousPoint();
      }
    }

    if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      dispatch(toggleMoveMode());
    }
    if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      trackActions.openColorPicker();
    }
    if (event.key === "c" && !event.ctrlKey) {
      event.preventDefault();
      trackActions.cutSelected();
    }
    if (event.key === "L" || event.key === "l") {
      // Add shortcut for 'L' key
      event.preventDefault();
      console.log("L key pressed. Toggling linear property.");
      effects.toggleLinear();
    }

    if (["1", "2", "3", "4", "5", "6", "7", "8"].includes(event.key)) {
      console.log("Number key pressed.");
      event.preventDefault();
      handleFavoriteColorChoose(parseInt(event.key) - 1);
    }
    if (event.ctrlKey) {
      // Ctrl + C: 只要有東西被選中就執行
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        copyPaste.copyRange();
      }
      // 處理 Ctrl + V 家族 (保持原樣)
      else if (event.key === "v" || event.key === "V") {
        event.preventDefault();
        if (event.shiftKey) {
          copyPaste.pasteAtFixedTime();
        } else {
          copyPaste.pasteAlignedToTarget();
        }
      }
      // Ctrl+數字: 設定透明度
      else if (
        ["1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)
      ) {
        event.preventDefault();
        const alphaValue = parseFloat(event.key) / 10;
        trackActions.changeBrightness(alphaValue);
      } else if (event.key === "0") {
        event.preventDefault();
        trackActions.changeBrightness(0);
      }
    }
    // Shift + 1~8：在播放位置插入最愛顏色（和不按 Shift 的 1~8「改選取色塊的顏色」不同）
    //
    // 這裡必須用 event.code 而不是 event.key：按住 Shift 時 event.key 會是符號
    // （Shift+1 → "!"），所以原本用 key 比對數字的寫法永遠不成立，這個功能一直進不來。
    if (event.shiftKey && !event.ctrlKey && /^Digit[1-8]$/.test(event.code)) {
      event.preventDefault();
      const colorIndex = parseInt(event.code.slice("Digit".length), 10) - 1;
      handleFavoriteColorInsert(colorIndex);
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      // 原本分成「多選 → handleMultiDelete」與「單選 → ClickedDelete」兩條，
      // 但 ClickedDelete 只是「有選取才呼叫 handleMultiDelete」，兩條同義
      trackActions.deleteSelected();
    }

    if (event.key === " ") {
      // 監聽空白鍵
      event.preventDefault();
      console.log("Space pressed.");
      handlePlayPause();
    }
  };

  // P2: 使用 ref 確保鍵盤監聽器只綁定一次，但總是呼叫最新的 handleKeyDown
  // 在 render 期間直接賦值（而非 useEffect），確保在下一個事件（如 keydown）
  // 觸發前 ref 已指向最新版本，避免 stale closure
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;

  useEffect(() => {
    const stableHandler = (e) => handleKeyDownRef.current(e);
    document.addEventListener("keydown", stableHandler);
    return () => {
      document.removeEventListener("keydown", stableHandler);
    };
  }, []); // 只掛載一次，不再因 currentTime/multiSelectedBlocks 變化而重新綁定

  /**
   * 把 1~8 的序號換算成最愛顏色盤上的座標。
   * 顏色盤還沒載入時（favoriteColor 預設是空陣列）回傳 null，呼叫端跳過。
   */
  const favoriteColorAt = (colorIndex) => {
    const columns = favoriteColor?.[0]?.length;
    if (!columns) return null;
    const row = Math.floor(colorIndex / columns); // 計算第幾列
    const col = colorIndex % columns; // 計算第幾行
    return favoriteColor[row % favoriteColor.length][col] ?? null;
  };

  const handleFavoriteColorInsert = (colorIndex) => {
    const color = favoriteColorAt(colorIndex);
    if (!color) return;
    insertFavoriteColorArray(color);
  };

  const insertFavoriteColorArray = (color) => {
    if (multiSelectedBlocks.length === 0) {
      console.warn("No block selected.");
      return;
    }

    const { armorIndex, partIndex } = multiSelectedBlocks[0];

    // 將時間 floor 到最近的一個 tick
    const nowTime = Math.floor(currentTime / TICK_MS) * TICK_MS;
    dispatch(updateCurrentTime(nowTime));

    // 保留原本的守衛：時間太靠近 0 時不插入（黑色斷點會落到負時間）
    if (nowTime - LEGACY_BLACK_SENTINEL_MS <= 0) return;

    // 容器維持 array（見 utils/actionTable/toNestedArray.js）
    const updatedActionTable = Array.from(actionTable).map(
      (player, playerIdx) => {
        if (playerIdx !== armorIndex) return player;
        const updatedPlayer = Array.from(player);
        updatedPlayer[partIndex] = insertColorKeyframes(player[partIndex], {
          time: nowTime,
          color,
          duration,
        });
        return updatedPlayer;
      },
    );

    dispatch(updateActionTable(updatedActionTable)); // 更新 Redux
  };

  const handlePlayPause = () => {
    if (!isPlaying) {
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  };

  const handleFavoriteColorChoose = (index) => {
    if (multiSelectedBlocks.length === 0) return;

    const newColor = favoriteColorAt(index);
    if (!newColor) return; // 顏色盤還沒載入

    const updatedActionTable = produce(actionTable, (draft) => {
      multiSelectedBlocks.forEach(({ armorIndex, partIndex, blockIndex }) => {
        const timeline = draft[armorIndex]?.[partIndex];
        if (timeline && timeline[blockIndex]) {
          timeline[blockIndex].color = { ...newColor };
        }
      });
    });

    dispatch(updateActionTable(updatedActionTable));
  };

  const listitem = showPart.map((setting) => (
    <Timeline
      key={setting.id}
      armorIndex={setting.armorIndex}
      partIndex={setting.partIndex}
      hidden={setting.hidden}
      zoomValue={zoomLevel}
      ref={elRefs.current[showPart.findIndex((s) => s.id === setting.id)]}
      height={showPart.length <= 7 ? 100 / showPart.length : 14}
      isCopying={copyPaste.isCopying}
    />
  ));

  return (
    <div className="audio-player-container">
      <CopyModeBanner isCopying={copyPaste.isCopying} />
      <div className="controls">
        <MusicSelector
          onTrackChange={() => {
            // 換歌時停止播放，讓 waveform 重新載入音檔
            if (isPlaying) setIsPlaying(false);
          }}
        />
        <UniformAlphaMenu actions={trackActions} />
        <ShiftToolButton shift={shift} />
        <EffectMenu effects={effects} />
        <TrackNavigation actions={trackActions} />
        <TrackEditButtons actions={trackActions} />
        <PlayerControls
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          zoomLevel={zoomLevel}
          setZoomLevel={setZoomLevel}
          volume={volume}
          setVolume={setVolume}
        />
      </div>
      <div className="scroll-container" ref={scrollRef}>
        <div
          className="main-controlPanel"
          style={{
            width: `${100 * zoomLevel}%`, // 根据 zoomValue 动态调整容器宽度
          }}
        >
          <ShiftMarkers shift={shift} />
          <div
            className="timeline-container"
            ref={timelineRef}
            onKeyDown={handleKeyDown}
          >
            {listitem}
          </div>
          <div className="waveform-container" ref={containerRef}>
            {/* 波形顯示區域 */}
            <Waveform
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              scrollRef={scrollRef}
              sourceNode={sourceNode}
              setSourceNode={setSourceNode}
              zoomValue={zoomLevel}
              containerRef={containerRef}
              volume={volume}
              onTimeUpdate={(elapsed) => {
                if (progressFlagRef.current && duration > 0) {
                  progressFlagRef.current.style.left = `${(elapsed / duration) * 100}%`;
                }
              }}
            />
          </div>
        </div>
      </div>
      <div
        ref={progressFlagRef}
        className="progress-flag"
        style={{
          left: "0%", // 初始位置，播放時由 rAF callback 直接操作 DOM（60fps）
        }}
      ></div>

      {/* 放大/縮小滑桿 */}
    </div>
  );
}

export default AudioPlayer;
