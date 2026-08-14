import React, { useEffect, useRef, useState, memo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { API_ENDPOINTS } from "../../config/api.js";
import { localMusicMap } from "./musicData.js";
import { peaksForViewport, peaksFromChannel } from "../../utils/audio/peaks.js";
import { anchorFor, positionAt } from "../../utils/audio/clock.js";
import { TICK_MS } from "../../constants/time.js";

import {
  updateCurrentTime,
  updateDuration,
  updateFullpeaks,
} from "../../redux/actions";

// 輔助函數：載入並解碼音頻
async function loadAudioData(url, audioContext) {
  const response = await fetch(url); // 從指定的 URL 獲取音頻文件
  const arrayBuffer = await response.arrayBuffer(); // 轉換為 ArrayBuffer
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer); // 解碼音頻數據
  return audioBuffer;
}

/**
 * 從解碼後的音檔算出整首歌的峰值。
 *
 * 實際的運算在 `utils/audio/peaks.js`（純函式，邊界條件在那裡窮舉過）——
 * 這裡只負責從 AudioBuffer 拿左聲道出來。
 */
function getPeaks(audioBuffer, buckets = 200000) {
  return peaksFromChannel(audioBuffer.getChannelData(0), buckets);
}

// AudioWaveform 組件
const AudioWaveform = ({
  url,
  isPlaying,
  setIsPlaying,
  zoomValue,
  scrollRef,
  volume,
  sourceNode,
  setSourceNode,
  containerRef,
  onTimeUpdate,
  onSeek,
  pendingSeekRef,
}) => {
  const canvasRef = useRef(null);
  const [audioContext] = useState(
    () => new (window.AudioContext || window.webkitAudioContext)()
  ); // 創建 AudioContext
  const dispatch = useDispatch();
  const duration = useSelector((state) => state.profiles.duration); // 獲取音頻總時長
  const currentTime = useSelector((state) => state.profiles.currentTime); // 用於 playback start offset、紅線暫停同步；rAF 熱路徑使用 playbackTimeRef 而非此值
  const fullPeaks = useSelector((state) => state.profiles.fullPeaks); // 獲取全分辨率的波峰數據
  const playbackRate = useSelector((state) => state.profiles.playbackRate); // 獲取播放速率
  const [canvasWidth, setCanvasWidth] = useState(0); // 設置 canvas 寬度
  const [canvasHeight, setCanvasHeight] = useState(0); // 設置 canvas 高度
  const [hoverTime, setHoverTime] = useState(null); // 懸停顯示的時間
  const [hoverPosition, setHoverPosition] = useState(null); // 懸停的 X 位置
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollPosition, setScrollPosition] = useState(0);
  const animationFrameRef = useRef(null); // 用於 requestAnimationFrame

  // P0 效能優化：播放期間的 ref（不觸發 re-render）
  const redLineRef = useRef(null);       // 紅線 DOM 元素，60fps 直接操作
  const playbackTimeRef = useRef(0);     // 每幀更新的精確播放時間（ms）
  const lastDispatchRef = useRef(0);     // 上次 dispatch 到 Redux 的時間
  const canvasWidthRef = useRef(0);      // canvasWidth 的 ref 版本，rAF 閉包始終讀取最新值
  const DISPATCH_INTERVAL = 40;          // 40ms = 25fps Redux 更新（滿足 ≥20fps）

  // 同步 canvasWidth state 到 ref，確保 rAF 閉包在視窗拉伸後使用正確值
  useEffect(() => {
    canvasWidthRef.current = canvasWidth;
  }, [canvasWidth]);

  const [audioBuffer, setAudioBuffer] = useState(null);
  const gainNodeRef = useRef(null);

  const [startTime, setStartTime] = useState(0);
  const animationRef = useRef(null);
  // 監聽滾動並更新`scrollPosition`
  useEffect(() => {
    const handleScroll = () => {
      if (!scrollRef.current) return;
      setScrollPosition(scrollRef.current.scrollLeft);
    };
    scrollRef.current?.addEventListener("scroll", handleScroll);
    return () => scrollRef.current?.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  // 監聽視窗大小變化，同步更新 canvasWidth（紅線定位依賴此值）
  useEffect(() => {
    const updateDimensions = () => {
      if (scrollRef.current) {
        setViewportWidth(scrollRef.current.clientWidth);
      }
      if (containerRef.current) {
        setCanvasWidth(containerRef.current.clientWidth);
        setCanvasHeight(containerRef.current.clientHeight || 200);
      }
    };

    window.addEventListener("resize", updateDimensions);
    updateDimensions(); // 初始設定

    return () => {
      window.removeEventListener("resize", updateDimensions);
    };
  }, []);

  // 設置 canvas 大小
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight || 200; // 預設高度 200
      setCanvasWidth(containerWidth); // 設置 canvas 寬度
      setCanvasHeight(containerHeight); // 設置 canvas 高度
    }
  }, [containerRef, zoomValue]);

  // Handle playback
  useEffect(() => {
    if (isPlaying && audioBuffer) {
      const newSource = audioContext.createBufferSource();
      const gainNode = audioContext.createGain();
      newSource.buffer = audioBuffer;
      newSource.playbackRate.value = playbackRate || 1;
      gainNode.gain.value = volume;
      gainNodeRef.current = gainNode;

      newSource.connect(gainNode).connect(audioContext.destination);
      const offset = currentTime / 1000; // 將毫秒轉換為秒
      const now = audioContext.currentTime;
      newSource.start(0, offset);
      // 錨點只有一種算法（utils/audio/clock.js）。舊版這裡寫的是 `now - offset`，
      // 少除了一個 rate——從中間某處用非 1 倍速播放時位置會算錯，而下面那個
      // 「改速度」的 effect 用的又是另一種慣例。
      setStartTime(anchorFor({ contextTime: now, positionMs: currentTime, rate: playbackRate }));
      setSourceNode(newSource);

      newSource.onended = () => {
        setIsPlaying(false);
      };
    } else if (!isPlaying && sourceNode) {
      sourceNode.stop();
      const rawTime = positionAt({
        contextTime: audioContext.currentTime,
        anchor: startTime,
        rate: playbackRate,
      });
      const alignedTime = Math.floor(rawTime / TICK_MS) * TICK_MS;
      dispatch(updateCurrentTime(alignedTime));
    }
  }, [isPlaying]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  // 更新播放速度
  useEffect(() => {
    if (sourceNode && isPlaying) {
      sourceNode.playbackRate.value = playbackRate || 1;
      // 換速度的當下位置不變，之後以新速率前進（clock.test.js 有守著連續性）
      setStartTime(
        anchorFor({
          contextTime: audioContext.currentTime,
          positionMs: currentTime,
          rate: playbackRate,
        }),
      );
    }
  }, [playbackRate]);

  useEffect(() => {
    if (scrollRef?.current && duration > 0) {
      const container = scrollRef.current;
      const progress = currentTime / duration; // 當前播放比例
      const newScrollLeft = progress * canvasWidth - container.clientWidth / 2;

      // 最大 scrollLeft：canvas 寬度 - 容器寬度
      const maxScrollLeft = canvasWidth - container.clientWidth;

      // Clamp 範圍 [0, maxScrollLeft]
      container.scrollLeft = Math.max(
        0,
        Math.min(newScrollLeft, maxScrollLeft)
      );
    }
  }, [zoomValue, canvasWidth, duration, scrollRef]);

  useEffect(() => {
    if (!url) return;

  // 1. 當 URL 改變時，先停止目前的播放（如果正在播）
    if (sourceNode) {
      try {
        sourceNode.stop();
      } catch (e) {
        console.warn("停止舊音軌失敗", e);
      }
      setSourceNode(null);
    }
    // if (fullPeaks && fullPeaks.length > 0) return;
    loadAudioData(url, audioContext).then((buffer) => {
      const peaks = getPeaks(buffer);
      setAudioBuffer(buffer);
      dispatch(updateDuration(buffer.duration * 1000));
      // if (fullPeaks && fullPeaks.length > 0) return;
      dispatch(updateFullpeaks(peaks));
      dispatch(updateCurrentTime(0));
    }).catch((error) => {
      console.error("載入api音樂失敗", error);
    });
  }, [url, audioContext, dispatch]);

  // 根據 zoomValue 重繪波形
  // useEffect(() => {
  //   if (fullPeaks && fullPeaks.length > 0) {
  //     const canvas = canvasRef.current;
  //     // const targetBarCount = 3000;
  //     // const displayPeaks = resamplePeaks(fullPeaks, targetBarCount);
  //     // drawWaveforms(canvas); // 然後傳入這個版本
  //   }
  // }, [fullPeaks, zoomValue, scrollPosition, currentTime]);

  // 根據當前播放時間更新波形進度
  useEffect(() => {
    if (fullPeaks && fullPeaks.length > 0) {
      const canvas = canvasRef.current;
      drawWaveforms(canvas);
    }
  }, [fullPeaks, zoomValue, scrollPosition, viewportWidth]);

  // 使用 requestAnimationFrame 更新進度（分層：60fps DOM + 25fps Redux）
  useEffect(() => {
    if (isPlaying) {
      lastDispatchRef.current = 0; // 重置節流計數器
      animationRef.current = requestAnimationFrame(updateProgress);
    } else {
      cancelAnimationFrame(animationRef.current);

      /*
       * 暫停時把最終位置寫回 Redux（供其他元件同步）——但**seek 例外**。
       *
       * 播放中點刻度尺或波形時，`seekTo` 會停掉音源，那會讓 isPlaying 變 false
       * 而跑到這裡；若照舊寫回 `playbackTimeRef`（音樂播到哪），就會蓋掉使用者
       * 剛指定的位置，看起來像「點了沒反應」。實測播放中點 75% 會得到
       * 「暫停當下的位置」而不是 75% 的位置。
       *
       * 所以 seek 的目標優先，並同步更新 playbackTimeRef，
       * 免得下一次暫停又跳回舊位置。
       */
      const pendingSeek = pendingSeekRef?.current;
      if (pendingSeek != null) {
        playbackTimeRef.current = pendingSeek;
        dispatch(updateCurrentTime(pendingSeek));
        pendingSeekRef.current = null;
      } else if (playbackTimeRef.current > 0) {
        const alignedTime = Math.floor(playbackTimeRef.current / TICK_MS) * TICK_MS;
        dispatch(updateCurrentTime(alignedTime));
      }
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, [isPlaying, startTime]);

  const updateProgress = () => {
    if (isPlaying && audioBuffer) {
      const elapsed = positionAt({
        contextTime: audioContext.currentTime,
        anchor: startTime,
        rate: playbackRate,
      });
      playbackTimeRef.current = elapsed;

      // 紅線：每幀直接操作 DOM（60fps，不經過 React；用 ref 確保 resize 後讀取最新寬度）
      if (redLineRef.current && duration > 0) {
        redLineRef.current.style.left = `${(elapsed / duration) * canvasWidthRef.current}px`;
      }

      // 進度條：每幀透過 callback 通知 AudioPlayer 直接操作 DOM（60fps）
      onTimeUpdate?.(elapsed);

      // Redux：每 40ms 才 dispatch 一次（25fps），供 Armor 的部位與道具顏色更新
      if (elapsed - lastDispatchRef.current >= DISPATCH_INTERVAL) {
        dispatch(updateCurrentTime(elapsed));
        lastDispatchRef.current = elapsed;
      }

      animationRef.current = requestAnimationFrame(updateProgress);
    }
  };

  // 暫停或手動 seek 時，將 Redux currentTime 同步到紅線 DOM（不依賴 rAF）
  useEffect(() => {
    if (!isPlaying && redLineRef.current && duration > 0 && canvasWidth > 0) {
      redLineRef.current.style.left = `${(currentTime / duration) * canvasWidth}px`;
    }
  }, [currentTime, isPlaying, duration, canvasWidth]);

  // 當播放狀態改變時，啟動或停止進度更新
  // useEffect(() => {
  //   if (isPlaying) {
  //     animationFrameRef.current = requestAnimationFrame(updateProgress);
  //   } else {
  //     cancelAnimationFrame(animationFrameRef.current);
  //   }

  //   return () => cancelAnimationFrame(animationFrameRef.current); // 清理動畫
  // }, [isPlaying, zoomValue]);

  /**
   * 把目前看得到的那一段波形畫出來。
   *
   * 「要畫哪些柱子」全部交給 `peaksForViewport`（純函式，見 utils/audio/peaks.js），
   * 這裡只剩「拿數字畫方塊」。抽出去之前這個函式同時在做三件事：從 ref 讀捲動
   * 位置與寬度、算可視範圍與降取樣、然後才畫——中間任何一個分母是 0 都會安靜地
   * 產生 NaN，而 NaN 傳進 `fillRect` 不會報錯，只是什麼都不畫。
   */
  function drawWaveforms(canvas) {
    const scroller = scrollRef.current;
    const container = containerRef.current;
    if (!canvas || !scroller || !container) return;

    const context = canvas.getContext("2d");
    const height = canvas.height;
    context.clearRect(0, 0, canvas.width, height);

    const bars = peaksForViewport(fullPeaks, {
      scrollLeft: scroller.scrollLeft,
      viewportWidth: scroller.offsetWidth,
      contentWidth: container.offsetWidth,
    });
    if (bars.length === 0) return;

    // 波形顏色從 token 讀，不寫死——原本是淺綠，跟燈光的綠色色塊搶注意力。
    // canvas 沒辦法直接吃 CSS 變數，所以在這裡解析一次。
    context.fillStyle =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--wave-fill")
        .trim() || "#6f6f6f";

    const barWidth = scroller.offsetWidth / bars.length;
    const middle = height / 2;

    for (let i = 0; i < bars.length; i++) {
      const barHeight = (bars[i] * height) / 2;
      // 上下對稱各畫一次
      context.fillRect(i * barWidth, middle - barHeight, barWidth, barHeight);
      context.fillRect(i * barWidth, middle, barWidth, barHeight);
    }
  }

  // 處理波形點擊，更新播放時間
  const handleWaveformClick = (e) => {
    if (!audioBuffer) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    // 對齊網格與「先停音源」都交給外層的 seekTo，避免兩份實作各自漂移
    onSeek(progress * duration);
  };

  // 處理滑鼠移動，顯示懸停時間
  const handleMouseMove = (event) => {
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const hoverX = event.clientX - rect.left;
    const progress = hoverX / container.offsetWidth;
    const hoverTimeInMs = progress * duration; // 懸停時間
    setHoverTime(hoverTimeInMs); // 設置懸停時間
    setHoverPosition(hoverX); // 設置懸停位置
  };

  // 處理滑鼠離開
  const handleMouseLeave = () => {
    setHoverTime(null);
    setHoverPosition(null);
  };

  // 格式化時間
  const formatTime = (timeInSeconds) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}:${
      milliseconds < 100 ? "0" : ""
    }${milliseconds < 10 ? "0" : ""}${milliseconds}`;
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={scrollRef.current?.clientWidth}
        style={{
          position: "absolute", // 或 "absolute" / "sticky" 根據你的佈局
          left: scrollRef.current?.scrollLeft || 0,
        }}
        height={canvasHeight}
        onClick={handleWaveformClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      <div
        ref={redLineRef}
        style={{
          position: "absolute",
          left: "0px", // 初始位置，播放時由 rAF 直接操作 DOM（60fps）
          top: 0,
          height: `${scrollRef.current?.offsetHeight || 0}px`,
          width: "2px",
          backgroundColor: "red",
          pointerEvents: "none",
          zIndex: 10,
        }}
      ></div>
      {hoverPosition !== null && (
        <div
          className="hover-line"
          style={{
            position: "absolute",
            left: `${hoverPosition}px`,
            top: 0,
            height: `${scrollRef.current?.offsetHeight || 0}px`,
            width: "1px",
            backgroundColor: "red",
            pointerEvents: "none",
            zIndex: 20,
          }}
        ></div>
      )}
      {hoverTime !== null && (
        <div>
          <div
            style={{
              position: "absolute",
              left: `${hoverPosition}px`,
              bottom: "40px",
              background: "rgba(255, 255, 255, 0.7)",
              padding: "2px 5px",
              borderRadius: "3px",
              pointerEvents: "none", // 不干擾滑鼠事件
            }}
          >
            {formatTime(hoverTime / 1000)}
          </div>
        </div>
      )}
    </div>
  );
};

function Wave({
  isPlaying,
  setIsPlaying,
  zoomValue,
  scrollRef,
  containerRef,
  sourceNode,
  setSourceNode,
  volume,
  onTimeUpdate,
  onSeek,
  pendingSeekRef,
}) {
  // const musicIndex = useSelector((state) => state.profiles.data?.music_index ?? 2);
  const musicFilename = useSelector((state) => state.profiles.data?.music_filename || "2026_funding.mp3");
  const userName = useSelector((state) => state.profiles.user);
  const dynamicUrl = `${API_ENDPOINTS.BASE}/get_music/${userName}/${musicFilename}`;
  // 優先用本地打包檔，不需後端；否則從後端 API 取得
  const resolvedUrl = localMusicMap[musicFilename] ?? dynamicUrl;

  return (
    <div>
      <AudioWaveform
        url={resolvedUrl}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        sourceNode={sourceNode}
        setSourceNode={setSourceNode}
        scrollRef={scrollRef}
        containerRef={containerRef}
        zoomValue={zoomValue}
        volume={volume}
        onTimeUpdate={onTimeUpdate}
        onSeek={onSeek}
        pendingSeekRef={pendingSeekRef}
      />
    </div>
  );
}

export default memo(Wave);
