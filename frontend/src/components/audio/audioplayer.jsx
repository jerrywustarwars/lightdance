import React, { useRef, useState, useEffect, createRef } from "react";
import { store } from "../../redux/store.js"; // 確保引入你的 Redux store
import { useSelector, useDispatch } from "react-redux";
import {
  updateActionTable,
  updateSelectedBlock,
  updateClipboard,
} from "../../redux/actions.js";
import "./audioplayer.css";
import Waveform from "./waveform.jsx";
import Timeline from "./Timeline.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTrash,
  faPalette,
  faVolumeHigh,
  faArrowRight,
  faArrowLeft,
  faScissors,
  faPlay,
  faCircleHalfStroke,
  faPause,
  faWandMagicSparkles,
  faLink,
} from "@fortawesome/free-solid-svg-icons";
import { produce } from "immer";
import {
  updateChosenColor,
  updatePaletteColor,
  updateIsColorChangeActive,
  updatePlaybackRate,
  updateCurrentTime,
} from "../../redux/actions.js";
import { set } from "lodash";

const MAXZOOMVALUE = 100;

function AudioPlayer({ setButtonState, timelineRef }) {
  const dispatch = useDispatch();
  const showPart = useSelector((state) => state.profiles.showPart);
  const currentTime = useSelector((state) => state.profiles.currentTime);
  const duration = useSelector((state) => state.profiles.duration); // 音樂總長度
  const actionTable = useSelector((state) => state.profiles.actionTable); // Redux 狀態中的動作表
  const timelineBlocks = useSelector((state) => state.profiles.timelineBlocks); // Redux 狀態中的時間軸區塊
  const chosenColor = useSelector((state) => state.profiles.chosenColor);
  const selectedBlock = useSelector((state) => state.profiles.selectedBlock);
  const favoriteColor = useSelector((state) => state.profiles.favoriteColor);
  const isColorChangeActive = useSelector(
    (state) => state.profiles.isColorChangeActive
  );
  const clipboard = useSelector((state) => state.profiles.clipboard);
  const playbackRate = useSelector((state) => state.profiles.playbackRate);

  const audioRef = useRef(null); // 音檔的引用
  const scrollRef = useRef(null); // 滾動條的容器
  const containerRef = useRef(null); // 波形的容器
  const [volume, setVolume] = useState(0.5); // 音量
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // 放大級別
  const [progressWidth, setProgressWidth] = useState(0); // 進度標誌
  const [brightness, setBrightness] = useState(1); // 預設亮度為 1 (100%)
  const [sourceNode, setSourceNode] = useState(null);
  const blackthreshold = 10;
  const elRefs = useRef([]);
  const isExternalSeekRef = useRef(false); // 🔥 用 ref 避免重渲染

  const prevTimeRef = useRef(currentTime);

  const [effectMenuVisible, setEffectMenuVisible] = useState(false);
  const [effectType, setEffectType] = useState(null); // 'gradient' | 'blink'
  const [gradientSettingsVisible, setGradientSettingsVisible] = useState(false);

  const [startBrightness, setStartBrightness] = useState(10);
  const [interval, setInterval] = useState(10);
  const [endBrightness, setEndBrightness] = useState(100);

  useEffect(() => {
    // 如果這不是外部觸發的跳轉，就跳過
    if (!isExternalSeekRef.current) {
      prevTimeRef.current = currentTime;
      return;
    }

    // ✅ 是我們自己用按鍵或 UI 觸發的跳轉！
    console.log("🔁 Detected external seek!");

    if (sourceNode) {
      try {
        sourceNode.stop();
      } catch (e) {
        console.warn("sourceNode already stopped");
      }
    }

    // 讓 waveform 自己重新處理播放
    setIsPlaying(false);
    setTimeout(() => setIsPlaying(true), 0);

    isExternalSeekRef.current = false; // ✅ 重設 flag
    prevTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    console.log("zoomLevel:", zoomLevel);
  }, [zoomLevel]);

  useEffect(() => {
    setButtonState(isPlaying);
  }, [isPlaying, setButtonState]);

  useEffect(() => {
    elRefs.current = showPart.map((_, i) => elRefs.current[i] || createRef());
  }, [showPart]);

  useEffect(() => {
    if (
      isColorChangeActive &&
      selectedBlock &&
      selectedBlock.armorIndex !== undefined &&
      selectedBlock.partIndex !== undefined &&
      selectedBlock.blockIndex !== undefined &&
      chosenColor
    ) {
      const { armorIndex, partIndex, blockIndex } = selectedBlock;

      // 使用 Immer 深拷贝并更新
      const updatedActionTable = produce(actionTable, (draft) => {
        const timeline = draft[armorIndex][partIndex];
        if (!timeline) return;

        if (timeline[blockIndex]) {
          timeline[blockIndex].color = chosenColor; // 更新 block 的颜色
        }
      });

      // 通过 Redux 更新 actionTable
      dispatch(updateActionTable(updatedActionTable));

      console.log("Updated actionTable with new color:", chosenColor);

      // 重置调色状态
    }
  }, [isColorChangeActive, chosenColor, selectedBlock, actionTable, dispatch]);

  useEffect(() => {
    if (duration > 0) {
      const progress = (currentTime / duration) * 100; // 計算播放進度的百分比
      setProgressWidth(progress);
    }
  }, [currentTime, duration]);

  useEffect(() => {
    if (
      selectedBlock &&
      selectedBlock.armorIndex !== undefined &&
      selectedBlock.partIndex !== undefined &&
      selectedBlock.blockIndex !== undefined
    ) {
      const block =
        actionTable?.[selectedBlock.armorIndex]?.[selectedBlock.partIndex]?.[
          selectedBlock.blockIndex
        ];
      console.log("Selected block:", selectedBlock, block);
      if (block && block.color && block.color.A !== undefined) {
        setBrightness(block.color.A); // 同步選取的區塊的 alpha 值到亮度控制項
      }
    }
  }, [selectedBlock, actionTable]);

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
      event.shiftKey
    );

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (event.key === "ArrowRight") {
        console.log("ArrowRight pressed. Advancing 50ms");
        dispatch(
          updateCurrentTime(
            currentTime + 50 > duration
              ? Math.floor(duration / 50) * 50
              : currentTime + 50
          )
        );
      } else if (event.key === "ArrowLeft") {
        console.log("ArrowLeft pressed. Going back 50ms");
        dispatch(
          updateCurrentTime(currentTime - 50 < 0 ? 0 : currentTime - 50)
        );
      }
    }

    if (event.shiftKey && event.key === "ArrowRight") {
      event.preventDefault();
      console.log("Shift + ArrowRight pressed. Moving right.");
      handleGoRight();
    }
    if (event.shiftKey && event.key === "ArrowLeft") {
      event.preventDefault();
      console.log("Shift + ArrowLeft pressed. Moving left.");
      handleGoLeft();
    }
    if (event.key === "m") {
      event.preventDefault();
      ClickedColorChange();
    }
    if (event.key === "c" && !event.ctrlKey) {
      event.preventDefault();
      handleCut();
    }

    if (["1", "2", "3", "4", "5", "6", "7", "8"].includes(event.key)) {
      console.log("Number key pressed.");
      event.preventDefault();
      handleFavoriteColorChoose(parseInt(event.key) - 1);
    }
    if (event.ctrlKey) {
      // Ctrl+C: 複製
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        handleCopy();
      }
      // Ctrl+V: 貼上
      else if (event.key === "v" || event.key === "V") {
        event.preventDefault();
        handlePaste();
      }
      // Ctrl+數字: 設定透明度
      else if (["1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)) {
        event.preventDefault();
        const alphaValue = parseFloat(event.key) / 10;
        handleAlphaChoose(alphaValue);
      } else if (event.key === "0") {
        // 檢測 Ctrl + 0
        event.preventDefault();
        handleAlphaChoose(1.0);
      }
    }
    if (
      event.shiftKey &&
      ["1", "2", "3", "4", "5", "6", "7", "8"].includes(event.key)
    ) {
      event.preventDefault();
      const colorIndex = parseInt(event.key) - 1;
      handleFavoriteColorInsert(colorIndex);
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      console.log("Delete or Backspace pressed.");
      ClickedDelete();
    }

    if (event.key === " ") {
      // 監聽空白鍵
      event.preventDefault();
      console.log("Space pressed.");
      handlePlayPause();
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedBlock, currentTime]); // 依賴 selectedBlock，確保每次變化時都重新綁定事件處理器

  const handleFavoriteColorInsert = (colorIndex) => {
    const row = Math.floor(colorIndex / favoriteColor[0].length); // 計算第幾列
    const col = colorIndex % favoriteColor[0].length; // 計算第幾行
    insertFavoriteColorArray(favoriteColor[row % favoriteColor.length][col]);
  };

  const insertFavoriteColorArray = (color) => {
    console.log("insertFavoriteColor: ", color);
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined
    ) {
      console.warn("No block selected or invalid block index.");
      return;
    }

    const armorIndex = selectedBlock.armorIndex;
    const partIndex = selectedBlock.partIndex;
    const partData = actionTable[armorIndex]?.[partIndex] || [];

    // 將時間 floor 到最近的 50 毫秒
    const nowTime = Math.floor(currentTime / 50) * 50;
    dispatch(updateCurrentTime(nowTime)); // 更新 Redux

    const updatedActionTable = actionTable.map((player, playerIndex) => {
      if (playerIndex === armorIndex) {
        const updatedPlayer = { ...player };
        let updatedPartData = [...player[partIndex]];

        // 新格式: { startTime, endTime, color, linear }
        // 檢查是否有色塊包含當前時間點
        const existingIndex = updatedPartData.findIndex(
          (block) => block.startTime <= nowTime && nowTime < block.endTime
        );

        if (existingIndex !== -1) {
          // 如果當前時間在某個色塊內部，更新該色塊的顏色
          updatedPartData = updatedPartData.map((block, index) =>
            index === existingIndex
              ? { ...block, color: { ...color } }
              : block
          );
        } else {
          // 否則創建新色塊，默認長度為 5000ms (5秒)
          let newEndTime = Math.min(nowTime + 5000, duration);

          // 檢查是否與下一個色塊重疊
          const nextBlock = updatedPartData.find(
            (block) => block.startTime > nowTime
          );

          if (nextBlock && newEndTime > nextBlock.startTime) {
            // 如果會重疊，調整 endTime 為下一個色塊的 startTime
            newEndTime = nextBlock.startTime;
          }

          // 確保至少有 50ms 寬度
          if (newEndTime - nowTime < 50) {
            console.warn(`[Insert] Not enough space to create new block at ${nowTime}ms`);
            return player;
          }

          const newBlock = {
            startTime: nowTime,
            endTime: newEndTime,
            color: { ...color },
            linear: 0,
          };

          // 找到應該插入的位置（保持時間順序）
          const insertIndex = updatedPartData.findIndex(
            (block) => block.startTime > nowTime
          );

          if (insertIndex === -1) {
            // 如果沒找到比 nowTime 更大的時間，則追加到末尾
            updatedPartData.push(newBlock);
          } else {
            // 否則在找到的位置前插入
            updatedPartData.splice(insertIndex, 0, newBlock);
          }

          console.log(`[Insert] Created new block: ${nowTime}ms - ${newEndTime}ms`);
        }

        updatedPlayer[partIndex] = updatedPartData;
        return updatedPlayer;
      }
      return player;
    });

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
    if (!selectedBlock) return;

    const { armorIndex, partIndex, blockIndex } = selectedBlock;
    if (
      !actionTable?.[armorIndex]?.[partIndex] ||
      !actionTable[armorIndex][partIndex][blockIndex]
    ) {
      return;
    }

    const updatedActionTable = produce(actionTable, (draft) => {
      const timeline = draft[armorIndex][partIndex];
      if (!timeline) return;

      const row = Math.floor(index / favoriteColor[0].length); // 計算第幾列
      const col = index % favoriteColor[0].length; // 計算第幾行

      timeline[blockIndex].color = {
        ...favoriteColor[row % favoriteColor.length][col],
      };
      console.log("color:", favoriteColor[row % favoriteColor.length][col]);
    });

    console.log("color:", favoriteColor);

    dispatch(updateActionTable(updatedActionTable));
  };

  const handleAlphaChoose = (alphaValue) => {
    if (!selectedBlock) return;

    const { armorIndex, partIndex, blockIndex } = selectedBlock;
    if (
      !actionTable?.[armorIndex]?.[partIndex] ||
      !actionTable[armorIndex][partIndex][blockIndex]
    ) {
      return;
    }

    const updatedActionTable = produce(actionTable, (draft) => {
      const timeline = draft[armorIndex][partIndex];
      if (!timeline) return;

      if (timeline[blockIndex]?.color) {
        timeline[blockIndex].color.A = alphaValue; // 設定透明度
        console.log(`Updated alpha to: ${alphaValue}`);
      }
    });

    dispatch(updateActionTable(updatedActionTable));
  };

  const handleZoom = (event) => {
    setZoomLevel(Math.floor(event.target.value));
  };

  const formatTime = (timeInMilliseconds) => {
    const minutes = Math.floor(timeInMilliseconds / 60000);
    const seconds = Math.floor((timeInMilliseconds % 60000) / 1000);
    const milliseconds = Math.floor(timeInMilliseconds % 1000);

    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}:${
      milliseconds < 100 ? "0" : ""
    }${milliseconds < 10 ? "0" : ""}${milliseconds}`;
  };

  const handleminuszoom = () => {
    setZoomLevel((prevZoom) =>
      Math.max((Math.round((prevZoom - 0.05) / 0.05) * 0.05).toFixed(2), 1)
    );
  };

  const handlepluszoom = () => {
    setZoomLevel((prevZoom) =>
      Math.min(
        (Math.round((prevZoom + 0.05) / 0.05) * 0.05).toFixed(2),
        MAXZOOMVALUE
      )
    );
  };

  const handleVolumeChange = (event) => {
    const newVolume = event.target.value;
    if (isPlaying) {
      setIsPlaying(false);
    }
    setVolume(newVolume);
  };

  const ClickedDelete = () => {
    console.log("Delete clicked");
    console.log("selectedBlock:", selectedBlock);

    // 確保選中的 block 有效
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined ||
      selectedBlock.blockIndex === undefined
    ) {
      console.warn("No block selected or invalid block index.");
      return;
    }

    const { armorIndex, partIndex, blockIndex } = selectedBlock;

    // 直接從 actionTable 取得選中的色塊
    const timeline = actionTable?.[armorIndex]?.[partIndex];
    if (!timeline || !Array.isArray(timeline)) {
      console.warn("Timeline not found or invalid.");
      return;
    }

    const blockToDelete = timeline[blockIndex];
    if (!blockToDelete) {
      console.warn("Selected block not found in actionTable.");
      return;
    }

    // **更新 actionTable - 簡單刪除，不移動其他色塊**
    const updatedActionTable = produce(actionTable, (draft) => {
      const draftTimeline = draft[armorIndex][partIndex];
      // 直接刪除選中的色塊，保持其他色塊的 startTime 和 endTime 不變
      draftTimeline.splice(blockIndex, 1);
    });

    console.log("[Delete] Deleted block at index", blockIndex);
    console.log("[Delete] Updated actionTable:", updatedActionTable);
    dispatch(updateActionTable(updatedActionTable));
    dispatch(updateSelectedBlock({})); // 清空選中
  };

  // 手動合併相鄰的相同顏色色塊
  const handleMergeBlocks = () => {
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined ||
      selectedBlock.blockIndex === undefined
    ) {
      console.warn("No valid block selected for merging");
      return;
    }

    const { armorIndex, partIndex, blockIndex } = selectedBlock;
    const timeline = actionTable[armorIndex]?.[partIndex];

    if (!timeline || blockIndex === undefined || blockIndex >= timeline.length - 1) {
      console.warn("Cannot merge: no next block or invalid selection");
      return;
    }

    const currentBlock = timeline[blockIndex];
    const nextBlock = timeline[blockIndex + 1];

    // 檢查兩個色塊之間是否有間隙
    if (currentBlock.endTime !== nextBlock.startTime) {
      console.warn(`Cannot merge: there is a gap between blocks (${currentBlock.endTime}ms to ${nextBlock.startTime}ms)`);
      return;
    }

    // 合併兩個色塊 - 將當前色塊的 endTime 設為下一個色塊的 endTime，並刪除下一個色塊
    const updatedActionTable = produce(actionTable, (draft) => {
      const draftTimeline = draft[armorIndex][partIndex];
      draftTimeline[blockIndex].endTime = draftTimeline[blockIndex + 1].endTime;
      draftTimeline.splice(blockIndex + 1, 1);
    });

    dispatch(updateActionTable(updatedActionTable));
    console.log(`Merged block ${blockIndex} (${currentBlock.startTime}-${currentBlock.endTime}ms) with block ${blockIndex + 1} (${nextBlock.startTime}-${nextBlock.endTime}ms)`);
  };

  const handleSetLinear = () => {
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined ||
      selectedBlock.blockIndex === undefined
    ) {
      console.warn("No block selected or invalid block index.");
      return;
    }

    const { armorIndex, partIndex, blockIndex } = selectedBlock;

    const updatedActionTable = produce(actionTable, (draft) => {
      const block = draft[armorIndex]?.[partIndex]?.[blockIndex];
      if (block) {
        // Toggle the linear property, ensuring it exists first
        block.linear = block.linear === 1 ? 0 : 1;
      }
    });

    dispatch(updateActionTable(updatedActionTable));
  };

  const removeDuplicateBlackBlocks = (actionTable) => {
    if (typeof actionTable !== "object" || actionTable === null)
      return actionTable;

    return Object.entries(actionTable).reduce((newTable, [armorKey, armor]) => {
      if (typeof armor !== "object" || armor === null) {
        newTable[armorKey] = armor;
        return newTable;
      }

      newTable[armorKey] = Object.fromEntries(
        Object.entries(armor).map(([partKey, part]) => {
          if (!Array.isArray(part)) return [partKey, part]; // 如果 `part` 不是陣列，直接返回

          let lastWasBlack = false; // 用來追蹤前一個是否是黑色區塊

          return [
            partKey,
            part.filter((block, index, arr) => {
              const isCurrentBlack =
                block?.color?.R === 0 &&
                block?.color?.G === 0 &&
                block?.color?.B === 0;

              if (isCurrentBlack && lastWasBlack) {
                // 如果前一個是黑色，這個也是黑色 -> 刪除這個
                return false;
              }

              lastWasBlack = isCurrentBlack; // 更新狀態
              return true;
            }),
          ];
        })
      );

      return newTable;
    }, {});
  };

  const ClickedColorChange = () => {
    console.log("Color Change clicked");

    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined ||
      selectedBlock.blockIndex === undefined
    ) {
      console.warn("No block selected or invalid block index.");
      return;
    }

    const block =
      timelineBlocks?.[selectedBlock.armorIndex]?.[selectedBlock.partIndex]?.[
        selectedBlock.blockIndex
      ];

    if (!block || !block.color) {
      console.warn("Selected block has no color information.");
      return;
    }

    // 更新 Redux 的颜色状态
    const blockColor = block.color;
    dispatch(updatePaletteColor(rgbaToHex(blockColor)));
    dispatch(updateChosenColor(blockColor));
    dispatch(updateIsColorChangeActive(true));
    console.log("Updated chosenColor:", blockColor);

    // 打开调色盘并同步颜色
    const palette = document.querySelector("#colorWell");
    if (palette) {
      palette.value = rgbaToHex(blockColor); // 将调色盘颜色更新为当前 block 的颜色
      palette.dispatchEvent(new Event("input")); // 手动触发 input 事件，确保颜色显示正确
      palette.click(); // 打开调色盘
    }
  };

  const rgbaToHex = (rgba) => {
    const r = rgba.R.toString(16).padStart(2, "0");
    const g = rgba.G.toString(16).padStart(2, "0");
    const b = rgba.B.toString(16).padStart(2, "0");

    return `#${r}${g}${b}`;
  };

  const handleSpeedChange = (speed) => {
    const newSpeed = parseFloat(speed); // 转换为数字
    dispatch(updatePlaybackRate(newSpeed));
  };

  const handleGoLeft = () => {
    console.log("go left");
    console.log("selectedBlock:", selectedBlock);
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined
    ) {
      console.warn("No timeline selected or invalid block index.");
      return;
    }

    const { armorIndex, partIndex } = selectedBlock;
    const timeline = actionTable[armorIndex]?.[partIndex];

    if (!timeline || timeline.length === 0) {
      console.warn("No valid timeline found for the selected block.");
      return;
    }

    // 新格式: 获取比 currentTime 小的所有 startTime 並按降序排序
    const filteredTimes = timeline
      .map((block) => block.startTime)
      .filter((startTime) => startTime < currentTime)
      .sort((a, b) => b - a);

    // 取最大 startTime
    const previousTime = filteredTimes[0];

    if (previousTime !== undefined) {
      const selectedTime = Math.round(previousTime / 50) * 50;
      dispatch(updateCurrentTime(selectedTime)); // 更新 Redux 中的 currentTime
    } else {
      console.warn("No previous time point found.");
    }
  };

  const handleGoRight = () => {
    console.log("go right");
    console.log("selectedBlock:", selectedBlock);
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined
    ) {
      console.warn("No timeline selected or invalid block index.");
      return;
    }
    const { armorIndex, partIndex } = selectedBlock;
    const timeline = actionTable[armorIndex]?.[partIndex];
    console.log("timeline:", timeline);

    if (!timeline || timeline.length === 0) {
      console.warn("No valid timeline found for the selected block.");
      return;
    }

    // 新格式: 获取比 currentTime 大的所有 startTime 並按升序排序
    const filteredTimes = timeline
      .map((block) => block.startTime)
      .filter((startTime) => startTime > currentTime)
      .sort((a, b) => a - b);

    if (filteredTimes.length === 0) {
      console.warn("No next time point found.");
      return;
    }

    // 取最小 startTime
    const nextTime = filteredTimes[0];

    if (nextTime !== undefined) {
      const selectedTime = Math.round(nextTime / 50) * 50;
      dispatch(updateCurrentTime(selectedTime)); // 更新 Redux 中的 currentTime
      console.log("currentTime:", currentTime);
    } else {
      console.warn("No next time point found.");
    }
  };

  const handleCut = () => {
    console.log("cut clicked");
    console.log("selectedBlock:", selectedBlock);
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined ||
      selectedBlock.blockIndex === undefined
    ) {
      console.warn("No block selected or invalid block index.");
      return;
    }

    const { armorIndex, partIndex, blockIndex } = selectedBlock;

    const timeline = actionTable?.[armorIndex]?.[partIndex];
    if (!timeline || !Array.isArray(timeline)) {
      console.warn("Timeline not found or invalid.");
      return;
    }

    const block = timeline[blockIndex];
    if (!block) {
      console.warn("Selected block not found in the actionTable.");
      return;
    }

    // 新格式: 使用 startTime 和 endTime
    const blockStartTime = block.startTime;
    const blockEndTime = block.endTime;

    // 將 currentTime 對齊到 50ms（與其他操作保持一致）
    const alignedCutTime = Math.floor(currentTime / 50) * 50;

    console.log(`[Cut] Original time: ${currentTime}ms, Aligned time: ${alignedCutTime}ms`);

    // 檢查對齊後的時間是否在此色塊的時間範圍內
    if (alignedCutTime <= blockStartTime || alignedCutTime >= blockEndTime) {
      console.warn(
        `Aligned cut time ${alignedCutTime}ms is not within block range (${blockStartTime}, ${blockEndTime})`
      );
      return;
    }

    // 檢查切割後左半部分是否足夠寬（至少 50ms）
    if (alignedCutTime - blockStartTime < 50) {
      console.warn(
        `Left block too small: ${alignedCutTime - blockStartTime}ms (minimum 50ms required)`
      );
      return;
    }

    // 檢查切割後右半部分是否足夠寬（至少 50ms）
    if (blockEndTime - alignedCutTime < 50) {
      console.warn(
        `Right block too small: ${blockEndTime - alignedCutTime}ms (minimum 50ms required)`
      );
      return;
    }

    // 新格式: 在對齊後的時間處切割色塊
    const updatedActionTable = produce(actionTable, (draft) => {
      const draftTimeline = draft[armorIndex][partIndex];

      // 修改當前色塊的 endTime
      draftTimeline[blockIndex].endTime = alignedCutTime;

      // 建立新的色塊（切割後的右半部分）
      const rightBlock = {
        ...block,
        startTime: alignedCutTime,
        endTime: blockEndTime,
      };

      // 在原始位置後插入新色塊
      draftTimeline.splice(blockIndex + 1, 0, rightBlock);
    });

    dispatch(updateActionTable(updatedActionTable));
    console.log("Action table after cut:", updatedActionTable);

    // 更新選中的區塊到新插入的右半部分
    dispatch(
      updateSelectedBlock({
        armorIndex,
        partIndex,
        blockIndex: blockIndex + 1, // +1 新色塊
      })
    );
  };

  const handleCopy = () => {
    console.log("Copy clicked");
    console.log("selectedBlock:", selectedBlock);

    // 檢查是否有選中的方塊
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined
    ) {
      console.warn("No block selected. Cannot copy.");
      return;
    }

    const { armorIndex, partIndex } = selectedBlock;

    // 取得整個部位的 timeline
    const timeline = actionTable?.[armorIndex]?.[partIndex];

    if (!timeline || timeline.length === 0) {
      console.warn("No timeline data found for the selected block.");
      return;
    }

    // 深拷貝 timeline 資料
    const copiedData = JSON.parse(JSON.stringify(timeline));

    // 更新 clipboard 狀態
    dispatch(
      updateClipboard({
        data: copiedData,
        sourceArmorIndex: armorIndex,
        sourcePartIndex: partIndex,
        timestamp: Date.now(),
      })
    );

    console.log(
      `Copied timeline for Armor ${armorIndex}, Part ${partIndex}:`,
      copiedData
    );
    console.log(`Total blocks copied: ${copiedData.length}`);
  };

  const handlePaste = () => {
    console.log("Paste clicked");
    console.log("selectedBlock:", selectedBlock);

    // 檢查剪貼簿是否有資料
    if (!clipboard || !clipboard.data || clipboard.data.length === 0) {
      console.warn("Clipboard is empty. Nothing to paste.");
      return;
    }

    // 檢查是否有選中的方塊
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined
    ) {
      console.warn("No block selected. Cannot determine paste target.");
      return;
    }

    const { armorIndex: targetArmorIndex, partIndex: targetPartIndex } =
      selectedBlock;

    console.log(`Pasting to Armor ${targetArmorIndex}, Part ${targetPartIndex}`);
    console.log(
      `Source: Armor ${clipboard.sourceArmorIndex}, Part ${clipboard.sourcePartIndex}`
    );

    // 深拷貝剪貼簿資料
    const pastedData = JSON.parse(JSON.stringify(clipboard.data));

    // 使用 Immer 更新 actionTable
    const updatedActionTable = produce(actionTable, (draft) => {
      // 完全覆蓋目標部位的 timeline
      draft[targetArmorIndex][targetPartIndex] = pastedData;
    });

    // 更新 Redux
    dispatch(updateActionTable(updatedActionTable));

    console.log(
      `Pasted ${pastedData.length} blocks to Armor ${targetArmorIndex}, Part ${targetPartIndex}`
    );

    // 貼上後，選中目標部位的第一個方塊
    dispatch(
      updateSelectedBlock({
        armorIndex: targetArmorIndex,
        partIndex: targetPartIndex,
        blockIndex: 0,
      })
    );
  };

  const handleBrightnessChange = (newBrightness) => {
    if (
      !selectedBlock ||
      selectedBlock.armorIndex === undefined ||
      selectedBlock.partIndex === undefined ||
      selectedBlock.blockIndex === undefined
    ) {
      console.warn("No block selected or invalid block index.");
      return;
    }

    const { armorIndex, partIndex, blockIndex } = selectedBlock;

    const updatedActionTable = produce(actionTable, (draft) => {
      const timeline = draft[armorIndex][partIndex];
      if (!timeline || !timeline[blockIndex]) return;

      // 更新選取區塊的 alpha 值
      timeline[blockIndex].color.A = parseFloat(newBrightness);
    });

    // 更新 Redux 狀態
    dispatch(updateActionTable(updatedActionTable));

    // 更新本地狀態
    setBrightness(newBrightness);
  };

  const handleEffect = () => {
    // 切換最外層選單
    setEffectMenuVisible((vis) => !vis);
    // 如果收起時一併隱藏設定 panel
    if (effectMenuVisible) {
      setGradientSettingsVisible(false);
      setEffectType(null);
    }
  };

  const applyGradientEffect = (startBrightness, interval, endBrightness) => {
    if (
      !selectedBlock ||
      selectedBlock.armorIndex == null ||
      selectedBlock.partIndex == null ||
      selectedBlock.blockIndex == null
    ) {
      console.warn("No block selected or invalid indices.");
      return;
    }

    const { armorIndex, partIndex, blockIndex } = selectedBlock;

    const updated = produce(actionTable, (draft) => {
      const timeline = draft[armorIndex][partIndex];
      if (!Array.isArray(timeline)) return;

      // 判斷方向：end 大於 start 就遞增，否則遞減
      const ascending = endBrightness > startBrightness;
      let current = startBrightness;
      let step = 0;

      // 遍歷後續的所有色塊，應用漸變效果
      while (
        (ascending && current <= endBrightness) ||
        (!ascending && current >= endBrightness)
      ) {
        const idx = blockIndex + step;
        if (idx >= timeline.length) break; // 停止，避免超出範圍
        
        timeline[idx].color.A = current / 100;
        current += ascending ? interval : -interval;
        step += 1;
      }
    });

    dispatch(updateActionTable(updated));
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
    />
  ));

  return (
    <div className="audio-player-container">
      <div className="controls">
        {/*<button className="effect-button" onClick={handleEffect}>
          <FontAwesomeIcon icon={faWandMagicSparkles} size="lg" />
          <span className="tooltip">Effect</span>
        </button>*/}
        <div className="effect-wrapper">
          <button className="effect-button" onClick={handleEffect}>
            <FontAwesomeIcon icon={faWandMagicSparkles} size="lg" />
            <span className="tooltip">Effect</span>
          </button>

          {/* 一級選單：選 gradient / blink */}
          {effectMenuVisible && (
            <div className="effect-menu">
              <div
                className="effect-menu-item"
                onClick={() => {
                  handleSetLinear();
                  setEffectMenuVisible(false);
                }}
              >
                漸變
              </div>
            </div>
          )}

          {/* 二級設定 panel：只在選了 gradient 時顯示 */}
          {gradientSettingsVisible && effectType === "gradient" && (
            <div className="gradient-settings-popup">
              {/* 起始亮度 */}
              <label>起始亮度：</label>
              <select
                className="dropdown-select"
                value={startBrightness}
                onChange={(e) => setStartBrightness(Number(e.target.value))}
              >
                {[...Array(10)].map((_, i) => {
                  const v = (i + 1) * 10;
                  return (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  );
                })}
              </select>

              {/* 間隔 */}
              <label>間隔：</label>
              <select
                className="dropdown-select"
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
              >
                {[10, 20].map((v) => (
                  <option key={v} value={v}>
                    {v} %
                  </option>
                ))}
              </select>

              {/* 結束亮度 */}
              <label>結束亮度：</label>
              <select
                className="dropdown-select"
                value={endBrightness}
                onChange={(e) => setEndBrightness(Number(e.target.value))}
              >
                {[...Array(10)].map((_, i) => {
                  const v = (i + 1) * 10;
                  return (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  );
                })}
              </select>
              <div className="gradient-settings-actions">
                <button
                  onClick={() => {
                    applyGradientEffect(
                      startBrightness,
                      interval,
                      endBrightness
                    );
                    setGradientSettingsVisible(false);
                    setEffectMenuVisible(false);
                  }}
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    // 什麼都不做，只關掉面板
                    setGradientSettingsVisible(false);
                    setEffectMenuVisible(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="timeline-controls">
          <button className="timeline-left" onClick={handleGoLeft}>
            <FontAwesomeIcon icon={faArrowLeft} size="lg" />
            <span className="tooltip">Previous Time Point (Shift + ←)</span>
          </button>
          <button className="timeline-right" onClick={handleGoRight}>
            <FontAwesomeIcon icon={faArrowRight} size="lg" />
            <span className="tooltip">Next Time Point (Shift + →)</span>
          </button>
        </div>
        <button className="cut-button" onClick={handleCut}>
          <FontAwesomeIcon icon={faScissors} size="lg" />
          <span className="tooltip">Cut Selected Block ( C )</span>
        </button>
        <button className="delete-button" onClick={ClickedDelete}>
          <FontAwesomeIcon icon={faTrash} size="lg" /> {/* 垃圾桶图标 */}
          <span className="tooltip">Delete Selected Block ( Del )</span>
        </button>
        <button className="merge-button" onClick={handleMergeBlocks}>
          <FontAwesomeIcon icon={faLink} size="lg" />
          <span className="tooltip">Merge With Next Block (Same Color Only)</span>
        </button>

        <div className="brightness-control">
          <FontAwesomeIcon icon={faCircleHalfStroke} />
          <select
            id="brightness-select"
            className="dropdown-select"
            value={brightness} // 綁定當前亮度
            onChange={(e) => handleBrightnessChange(e.target.value)} // 處理亮度變化
            style={{ marginLeft: "10px" }}
          >
            <option value="0.1">10%</option>
            <option value="0.2">20%</option>
            <option value="0.3">30%</option>
            <option value="0.4">40%</option>
            <option value="0.5">50%</option>
            <option value="0.6">60%</option>
            <option value="0.7">70%</option>
            <option value="0.8">80%</option>
            <option value="0.9">90%</option>
            <option value="1">100%</option>
          </select>
          <span className="tooltip">Brightness</span>
        </div>
        <button className="color-button" onClick={ClickedColorChange}>
          <FontAwesomeIcon icon={faPalette} size="lg" /> {/* 调色板图标 */}
          <span className="tooltip">Color( M )</span>
        </button>
        {/* 下拉式选单 */}
        <div className="dropdown">
          <select
            id="speed-select"
            className="dropdown-select"
            value={playbackRate || 1}
            onChange={(e) => handleSpeedChange(e.target.value)}
            style={{ marginLeft: "10px" }}
          >
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1">1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <span className="tooltip">Playback speed</span>
        </div>
        <div className="play-control">
          <button className="play-button" onClick={handlePlayPause}>
            {isPlaying ? (
              <>
                <FontAwesomeIcon icon={faPause} size="lg" />
                <span className="tooltip">Pause ( Space )</span>
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faPlay} size="lg" />
                <span className="tooltip">Play ( Space )</span>
              </>
            )}
          </button>
          <div className="time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>
        <div className="zoom-controls">
          <button onClick={handleminuszoom} disabled={zoomLevel < 1}>
            -
          </button>
          <input
            type="range"
            min="1"
            max={MAXZOOMVALUE}
            step="0.01"
            value={zoomLevel}
            onChange={handleZoom}
            className="zoom-slider"
          />
          <button onClick={handlepluszoom} disabled={zoomLevel > MAXZOOMVALUE}>
            +
          </button>
        </div>
        <div className="volume-control">
          <div className="volume-icon" style={{ color: "rgb(150, 146, 146)" }}>
            <FontAwesomeIcon icon={faVolumeHigh} size="lg" />
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            className="volume-slider"
            onChange={handleVolumeChange}
            style={{ width: "100px" }}
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
              // audioRef={audioRef}
              scrollRef={scrollRef}
              sourceNode={sourceNode}
              setSourceNode={setSourceNode}
              zoomValue={zoomLevel}
              containerRef={containerRef}
              volume={volume}
            />
          </div>
        </div>
      </div>
      <div
        className="progress-flag"
        style={{
          left: `${progressWidth}%`,
        }}
      ></div>

      {/* 放大/縮小滑桿 */}
    </div>
  );
}

export default AudioPlayer;
