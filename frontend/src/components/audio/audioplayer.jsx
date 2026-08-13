import React, { useRef, useState, useEffect, createRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
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
import TimeRuler from "./TimeRuler.jsx";
import { updateChosenColor, updateCurrentTime } from "../../redux/actions.js";
import { TICK_MS } from "../../constants/time.js";
import {
  insertColorSegment,
  cloneColor,
  sameColor,
} from "../../utils/segments/color.js";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts.js";
import { useSegmentActionTable } from "../../hooks/useSegmentActionTable.js";

function AudioPlayer({ setButtonState, timelineRef }) {
  const dispatch = useDispatch();
  const showPart = useSelector((state) => state.profiles.showPart);
  const currentTime = useSelector((state) => state.profiles.currentTime);
  const duration = useSelector((state) => state.profiles.duration); // 音樂總長度
  const { segmentTable, commit, commitPart } = useSegmentActionTable();
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
  // 「使用者剛指定要跳到哪」。waveform 暫停時會把播放位置寫回 Redux，
  // 這個 ref 是告訴它「這次是 seek，不要用舊位置覆寫」。詳見 seekTo。
  const pendingSeekRef = useRef(null);
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

  /**
   * 把一個顏色套到所有選取的色塊上。
   *
   * 調色盤與最愛色（1~8）走的是同一件事，所以只留這一份。
   *
   * 兩個細節：
   *
   * 固定色的 `colorEnd` 要跟著改，否則之後切成漸變時會漸變到一個使用者從沒
   * 指定過的舊顏色；漸變段則只改起始色，維持「改的是這一段的顏色」的語意。
   *
   * 沒有任何一段真的變色時要回傳**原本那張表**。調色盤的 effect 會在
   * `segmentTable` 變動後再跑一次，每次都給新陣列的話會不斷推進 history，
   * 使用者按 Ctrl+Z 要按很多次才回得去。
   */
  const applyColorToSelection = (color) => {
    if (!color || multiSelectedBlocks.length === 0) return;

    // 一次選取原則上不跨軌，但 API 沒有這個保證，所以照部位分組處理
    const byPart = new Map();
    for (const { armorIndex, partIndex, segmentId } of multiSelectedBlocks) {
      const key = `${armorIndex}-${partIndex}`;
      if (!byPart.has(key)) byPart.set(key, { armorIndex, partIndex, ids: new Set() });
      byPart.get(key).ids.add(segmentId);
    }

    let nextTable = segmentTable;

    for (const { armorIndex, partIndex, ids } of byPart.values()) {
      const segments = nextTable?.[armorIndex]?.[partIndex];
      if (!segments) continue;

      let changed = false;
      const nextSegments = segments.map((segment) => {
        if (!ids.has(segment.id)) return segment;

        const next = cloneColor(color);
        const keepEnd = segment.linear === 1;
        // 已經是這個顏色就原樣回傳。少了這道判斷，下面的 effect 會在自己
        // 寫入之後再跑一次、再產生一份新陣列，然後無限迴圈。
        if (
          sameColor(segment.colorStart, next) &&
          (keepEnd || sameColor(segment.colorEnd, next))
        ) {
          return segment;
        }

        changed = true;
        return {
          ...segment,
          colorStart: next,
          colorEnd: keepEnd ? segment.colorEnd : next,
        };
      });
      if (!changed) continue;

      nextTable = nextTable.map((armor, a) =>
        a === armorIndex
          ? armor.map((segs, p) => (p === partIndex ? nextSegments : segs))
          : armor,
      );
    }

    commit(nextTable); // 相同 reference 時 commit 自己會短路
  };

  useEffect(() => {
    if (isColorChangeActive && multiSelectedBlocks.length > 0 && chosenColor) {
      applyColorToSelection(chosenColor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isColorChangeActive, chosenColor, multiSelectedBlocks, segmentTable]);

  // P0: 進度條改由 waveform.jsx 的 rAF 透過 onTimeUpdate callback 直接操作 DOM（60fps）
  // 移除了 setProgressWidth 的 useEffect，避免播放期間不必要的 re-render

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

  /**
   * 在播放位置放一個最愛色的色塊（放在目前選取所在的那條時間軸上）。
   *
   * 舊版走 `insertColorKeyframes`，要判斷前後鄰居是不是黑的來決定補幾個哨兵，
   * 還得守著「時間太靠近 0 就不插入」——因為哨兵在色塊前 10ms，會落到負時間。
   * segment 模型沒有哨兵也就沒有這個限制，時間 0 一樣放得下去。
   */
  const insertFavoriteColorArray = (color) => {
    if (multiSelectedBlocks.length === 0) {
      console.warn("No block selected.");
      return;
    }

    const { armorIndex, partIndex } = multiSelectedBlocks[0];

    // 將時間 floor 到最近的一個 tick
    const nowTime = Math.floor(currentTime / TICK_MS) * TICK_MS;
    dispatch(updateCurrentTime(nowTime));

    const segments = segmentTable?.[armorIndex]?.[partIndex] ?? [];
    commitPart(
      armorIndex,
      partIndex,
      insertColorSegment(segments, { time: nowTime, color, duration }),
    );
  };

  /** B 鍵與效果選單共用的頻閃流程 */
  const promptBlink = () => {
    if (multiSelectedBlocks.length !== 1) {
      console.warn("Please select exactly one block to use Blink effect.");
      return;
    }
    const userInput = window.prompt(
      `請輸入頻閃間隔 (ms)，必須為 ${TICK_MS} 的倍數：`,
      "100",
    );
    if (userInput !== null) effects.applyBlink(userInput);
  };

  const handlePlayPause = () => {
    if (!isPlaying) {
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  };

  /** 1~8：把最愛色套到選取的色塊上 */
  const handleFavoriteColorChoose = (index) => {
    const newColor = favoriteColorAt(index);
    if (!newColor) return; // 顏色盤還沒載入
    applyColorToSelection(newColor);
  };

  /**
   * 跳到指定時間。
   *
   * 光是 dispatch `updateCurrentTime` 不夠——播放中時 waveform 的 rAF 迴圈
   * 每 40ms 就會用實際播放進度覆蓋掉它，看起來像「點了沒反應」。必須先停掉
   * 正在播放的 `AudioBufferSourceNode`。
   *
   * 這個知識原本只寫在 waveform 的 `handleWaveformClick` 裡，刻度尺一加上來
   * 就踩到了。改由持有 `sourceNode` 的這一層定義一次，兩邊共用。
   */
  const seekTo = (timeMs) => {
    const aligned = Math.round(timeMs / TICK_MS) * TICK_MS;
    pendingSeekRef.current = aligned;

    if (sourceNode) {
      /*
       * 光是 `sourceNode.stop()` 不夠，還會被反咬一口：
       *
       *   stop() → onended → setIsPlaying(false) → waveform 的暫停分支
       *          → 用音訊時鐘重算「播到哪」並 dispatch → 蓋掉我們要跳的時間
       *
       * 所以要把那條連鎖拆掉：清掉 onended、把 sourceNode 設成 null。
       * 暫停分支的條件是 `!isPlaying && sourceNode`，sourceNode 一旦為 null
       * 就整段跳過，不會再覆寫。
       *
       * （這個坑本來就存在於波形的點擊跳轉，只是沒人注意到——播放中點波形
       * 一樣跳不動。現在兩邊共用這個函式，一起修好。）
       */
      sourceNode.onended = null;
      sourceNode.stop();
      setSourceNode(null);
      setIsPlaying(false);
    }
    dispatch(updateCurrentTime(aligned));
  };

  /**
   * 編輯器的鍵盤配置。
   *
   * ⚠️ **`Shift+←/→` 是刻意保留的重疊鍵位**：兩條綁定都會執行，先 ±50ms
   * 再跳到上/下個關鍵格（後者覆蓋前者）。沒有選取色塊時 `goToNextPoint`
   * 會直接 return，於是退化成 ±50ms —— 這個 fallback 蠻好用，所以留著。
   * `updateCurrentTime` 不進 undo history，不會有副作用。
   *
   * （`Ctrl+1~8` 原本也有同樣的重疊，但那組會產生兩筆 history、
   * 讓一次 Ctrl+Z 停在使用者沒看過的中間狀態，已加 `ctrl: false` 修掉。）
   */
  const shortcuts = [
    // 複製模式
    {
      key: "Escape",
      when: () => copyPaste.isCopying,
      stopPropagation: true,
      handler: copyPaste.cancelCopying,
    },
    { key: "c", ctrl: true, handler: copyPaste.copyRange },
    {
      key: "v",
      ctrl: true,
      shift: false,
      handler: copyPaste.pasteAlignedToTarget,
    },
    { key: "v", ctrl: true, shift: true, handler: copyPaste.pasteAtFixedTime },
    { key: "c", ctrl: false, shift: true, handler: copyPaste.copyWholePart },
    { key: "v", ctrl: false, shift: true, handler: copyPaste.pasteWholePart },

    // 播放位置
    {
      key: "ArrowRight",
      handler: () =>
        dispatch(
          updateCurrentTime(
            Math.min(
              currentTime + TICK_MS,
              Math.floor(duration / TICK_MS) * TICK_MS,
            ),
          ),
        ),
    },
    {
      key: "ArrowLeft",
      handler: () =>
        dispatch(updateCurrentTime(Math.max(currentTime - TICK_MS, 0))),
    },
    { key: "ArrowRight", shift: true, handler: trackActions.goToNextPoint },
    { key: "ArrowLeft", shift: true, handler: trackActions.goToPreviousPoint },

    // 編輯
    { key: "m", handler: () => dispatch(toggleMoveMode()) },
    { key: "p", handler: trackActions.openColorPicker },
    { key: "c", ctrl: false, shift: false, handler: trackActions.cutSelected },
    {
      key: ["Delete", "Backspace"],
      // 原本分成「多選 → handleMultiDelete」與「單選 → ClickedDelete」兩條，
      // 但 ClickedDelete 只是「有選取才呼叫 handleMultiDelete」，兩條同義
      handler: trackActions.deleteSelected,
    },
    { key: " ", handler: handlePlayPause },

    // 效果
    { key: "l", handler: effects.toggleLinear },
    { key: "b", handler: promptBlink },

    // 最愛顏色與透明度
    {
      key: ["1", "2", "3", "4", "5", "6", "7", "8"],
      // ctrl: false 是必要的守衛：沒有它，Ctrl+1 會同時打中這條和下面的透明度，
      // 兩個 handler 從同一份 actionTable 快照各自 produce 再 dispatch，
      // 結果是套色被蓋掉、卻多留一筆 history（一次 Ctrl+Z 復原不完）。
      ctrl: false,
      handler: (event) => handleFavoriteColorChoose(parseInt(event.key) - 1),
    },
    {
      key: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
      ctrl: true,
      handler: (event) =>
        trackActions.changeBrightness(parseInt(event.key) / 10),
    },
    // Ctrl+0 補完 Ctrl+1~9 的 10%~90%，所以是 100%（不是 0%）
    { key: "0", ctrl: true, handler: () => trackActions.changeBrightness(1) },
    {
      // 按住 Shift 時數字鍵的 event.key 會是符號（Shift+1 → "!"），只能用 code 比對
      code: /^Digit[1-8]$/,
      shift: true,
      ctrl: false,
      handler: (event) =>
        handleFavoriteColorInsert(
          parseInt(event.code.slice("Digit".length), 10) - 1,
        ),
    },
  ];

  useKeyboardShortcuts(shortcuts);

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
      {/*
        工具列分成五組，中間用分隔線隔開：音樂 / 導航 / 編輯 / 效果 / 播放。

        改之前是 14 顆圖示平鋪、沒有分組也沒有分隔線，剪刀、垃圾桶、調色盤、
        魔杖的視覺權重完全相同，只能一顆一顆 hover 過去猜。光是把間距拉開
        並補上分隔線，同一批按鈕就會變成五個讀得出來的區塊。

        順序照排燈的動作流程：先選歌 → 找到位置 → 編輯色塊 → 套效果 → 播來聽。
      */}
      <div className="controls">
        <div className="tool-group">
          <MusicSelector
            onTrackChange={() => {
              // 換歌時停止播放，讓 waveform 重新載入音檔
              if (isPlaying) setIsPlaying(false);
            }}
          />
        </div>
        <span className="tool-sep" />
        <div className="tool-group">
          <TrackNavigation actions={trackActions} />
        </div>
        <span className="tool-sep" />
        <div className="tool-group">
          <TrackEditButtons actions={trackActions} />
        </div>
        <span className="tool-sep" />
        <div className="tool-group">
          <EffectMenu effects={effects} />
          <ShiftToolButton shift={shift} />
          <UniformAlphaMenu actions={trackActions} />
        </div>
        <span className="tool-sep" />
        <div className="tool-group">
          <PlayerControls
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            volume={volume}
            setVolume={setVolume}
          />
        </div>
      </div>
      <div className="scroll-container" ref={scrollRef}>
        <div
          className="main-controlPanel"
          style={{
            width: `${100 * zoomLevel}%`, // 根据 zoomValue 动态调整容器宽度
          }}
        >
          <TimeRuler onSeek={seekTo} />
          <ShiftMarkers shift={shift} />
          {/* 快捷鍵統一由 useKeyboardShortcuts 掛在 document 上，
              這裡不再重複註冊 onKeyDown（原本同一個 handler 綁了兩次） */}
          <div className="timeline-container" ref={timelineRef}>
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
              onSeek={seekTo}
              pendingSeekRef={pendingSeekRef}
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
