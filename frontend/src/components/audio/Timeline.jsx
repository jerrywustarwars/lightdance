import React, { useRef, useState, useEffect, forwardRef, memo } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  updateTimelineBlocks,
  updateIsColorChangeActive,
  updateMultiSelectedBlocks,
  updateMoveMode,
  updateCurrentTime,
} from "../../redux/actions";
import { useKeyframePartTimeline } from "../../hooks/useKeyframeActionTable.js";
import { useSegmentPartTimeline } from "../../hooks/useSegmentActionTable.js";
import { buildTimelineBlocks } from "../../utils/segments/blocks.js";
import {
  moveSegment,
  resizeSegment,
  MIN_BLOCK_GAP_MS,
  MIN_SEGMENT_MS,
} from "../../utils/segments/gestures.js";
import {
  keyframeIndexOfSegment,
  makeSelection,
  selectedIdsOnPart,
} from "../../utils/selection.js";

// cloneDeep 已移除：tempActionTable cascade 已合併，drag 復原時再加回
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";

const colorDistance = (color1, color2) => {
  return Math.sqrt(
    Math.pow((color1.R || 0) - (color2.R || 0), 2) +
    Math.pow((color1.G || 0) - (color2.G || 0), 2) +
    Math.pow((color1.B || 0) - (color2.B || 0), 2)
  );
};
// Timeline 組件
const Timeline = forwardRef(
  ({ zoomValue, height, armorIndex, partIndex, hidden, isCopying }, timelineRef) => {
    const dispatch = useDispatch();

    // **狀態變數**

    // 方塊相關狀態
    // [Drag 已停用] 以下 state 供舊版 drag 功能使用，保留以備日後復原
    // const [hoveredBlock, setHoveredBlock] = useState({
    //   leftedge: false,  // 是否在左邊緣
    //   rightedge: false, // 是否在右邊緣
    //   leftindex: null,  // 左邊緣的方塊索引
    //   rightindex: null, // 右邊緣的方塊索引
    // });
    // const [dragging, setDragging] = useState(false);         // 是否正在拖動方塊
    // const [draggedBlockIndex, setDraggedBlockIndex] = useState(null); // 被拖動的方塊索引
    // const [dragStartpoint, setDragStartpoint] = useState(null);       // 拖動的起始點

    // 畫布相關狀態
    const canvasRef = useRef(null); // timeline 的畫布引用
    const [canvasWidth, setCanvasWidth] = useState(1600); // 預設畫布寬度
    const [canvasHeight, setCanvasHeight] = useState(100); // 固定畫布高度

    // Redux 狀態
    const timelineBlocks = useSelector(
      (state) => state.profiles.timelineBlocks?.[armorIndex]?.[partIndex] || [] // 當前時間軸的方塊數據
    );
    // 只訂閱**自己這一個部位**。訂閱整張表的話，任何地方的編輯都會換掉
    // reference，154 條 Timeline 全部重算 blocks 並各自 dispatch 一次——
    // 現在只有真的被改到的那條會動。
    //
    // 兩份視圖並存是**遷移期的暫時狀態**（見 utils/selection.js）：
    //   - segments：渲染、選取、拖曳與 resize 都走這一份
    //   - partTimeline：只剩 selection 的 `blockIndex` 相容欄位要用（Phase 5g 會刪）
    // 兩者來自同一個 store slice，keyframe 那份是逐部位快取的，成本可忽略。
    const { segments, commitPart: commitSegments } = useSegmentPartTimeline(
      armorIndex,
      partIndex,
    );
    const { timeline: partTimeline, commitPart } = useKeyframePartTimeline(
      armorIndex,
      partIndex,
    );
    const duration = useSelector((state) => state.profiles.duration); // 總時長
    const multiSelectedBlocks = useSelector((state) => state.profiles.multiSelectedBlocks); // 全局多選中方塊
    const clipboard = useSelector((state) => state.profiles.clipboard);
    // 兩個手勢常數的唯一定義在 utils/segments/gestures.js——那裡的純函式與
    // 這裡的像素預覽必須用同一組數字，否則拖到底的位置會跟放開後的位置對不上
    const STRETCH_MIN_MS = MIN_SEGMENT_MS;

    // Move Mode 相關 ref（零延遲拖曳，不觸發 React 重繪）
    const moveMode = useSelector((state) => state.profiles.moveMode);
    const moveDragStartRef = useRef(null);   // 拖曳起始 clientX
    const moveDraggedIdRef = useRef(null);   // 被拖曳的 segmentId（不是索引——索引會位移）
    const moveDraggedDomRef = useRef(null);  // 被拖曳的 DOM 元素
    const minDragPxRef = useRef(0);          // 最小可拖曳像素（向左）
    const maxDragPxRef = useRef(0);          // 最大可拖曳像素（向右）
    const moveDragPixelsRef = useRef(0);     // 目前拖曳偏移像素
    const blockDomRefs = useRef({});         // index → DOM element
    // 用 ref 保持最新值供 useEffect 閉包使用
    const partTimelineRef = useRef(partTimeline);
    const segmentsRef = useRef(segments);
    const durationRef = useRef(duration);
    useEffect(() => { partTimelineRef.current = partTimeline; }, [partTimeline]);
    useEffect(() => { segmentsRef.current = segments; }, [segments]);
    useEffect(() => { durationRef.current = duration; }, [duration]);

    // Resize 相關 ref（零延遲邊緣拖曳，不觸發 React 重繪）
    const [hoverEdge, setHoverEdge] = useState(null); // { index, edge: 'left'|'right' } | null
    const resizeEdgeRef = useRef(null);        // 'left' | 'right'（正在 resize 的邊）
    const resizeDragStartRef = useRef(null);   // 拖曳起始 clientX
    const resizedIdRef = useRef(null);         // 被 resize 的 segmentId
    const resizedDomRef = useRef(null);        // 被 resize 的 DOM 元素
    const resizeOrigPctRef = useRef(0);        // 原始寬度（% of timeline width）
    const minResizePxRef = useRef(0);          // 拖曳最小值（px，負數為向左）
    const maxResizePxRef = useRef(0);          // 拖曳最大值（px，正數為向右）
    const resizeDragPixelsRef = useRef(0);     // 目前拖曳偏移量（px）
    const resizeRightBoundRef = useRef(0);     // 右邊界時間（ms）：下一個有色 block 起點
    const resizeLeftBoundRef = useRef(0);      // 左邊界時間（ms）：上一個有色 block 終點
    const resizeBlockStartRef = useRef(0);     // 被 resize block 的起始時間（ms）
    const resizeBlockEndRef = useRef(0);       // 被 resize block 的結束時間（ms）

    // Move Mode：進入時掛載全域滑鼠事件，離開時清除
    // 操作邏輯：點 block → 開始跟蹤滑鼠移動（不需按住）→ 再點任意位置 → 提交並退出
    useEffect(() => {
      if (!moveMode) {
        // M 鍵直接退出 move mode 時，若有正在追蹤的 block，先提交位置
        const segmentId = moveDraggedIdRef.current;
        if (segmentId !== null && moveDragPixelsRef.current !== 0 && timelineRef?.current) {
          const dragPx = moveDragPixelsRef.current;
          const rect = timelineRef.current.getBoundingClientRect();
          const pixelsPerMs = rect.width / durationRef.current;
          const dt = Math.round((dragPx / pixelsPerMs) / 50) * 50;
          if (dt !== 0) {
            // 邊界夾緊、網格對齊、與鄰居的最小間距全部在 moveSegment 裡，
            // 那是純函式所以測得到（gestures.test.js）。這裡只負責把像素換算
            // 成毫秒。沒有實際位移時它會回傳原陣列，commitPart 就不會佔一格 undo。
            commitSegments(
              moveSegment(segmentsRef.current, segmentId, dt, {
                duration: durationRef.current,
              }),
            );
          }
        }
        // move mode 結束時確保 DOM 樣式清除
        if (moveDraggedDomRef.current) {
          moveDraggedDomRef.current.style.transform = '';
          moveDraggedDomRef.current.style.zIndex = '';
          moveDraggedDomRef.current.style.overflow = '';
        }
        moveDragStartRef.current = null;
        moveDraggedIdRef.current = null;
        moveDraggedDomRef.current = null;
        moveDragPixelsRef.current = 0;
        return;
      }

      // 滑鼠移動時更新 block 的 DOM 位置（零延遲，不走 React）
      const handleGlobalMouseMove = (e) => {
        if (moveDragStartRef.current === null || !moveDraggedDomRef.current) return;
        const rawDelta = e.clientX - moveDragStartRef.current;
        const clamped = Math.max(minDragPxRef.current, Math.min(maxDragPxRef.current, rawDelta));
        moveDragPixelsRef.current = clamped;
        moveDraggedDomRef.current.style.transform = `translateX(${clamped}px)`;
      };

      // 任意點擊（mousedown）→ 提交目前位置並退出 move mode
      // 注意：點 block 本身的 mousedown 若是「選取新 block」會 stopPropagation，
      //       所以此 handler 只有在「已有追蹤中的 block」或「點空白處」時才觸發提交。
      const handleGlobalMouseDown = () => {
        const segmentId = moveDraggedIdRef.current;
        if (segmentId !== null && timelineRef?.current) {
          const dragPx = moveDragPixelsRef.current;
          const rect = timelineRef.current.getBoundingClientRect();
          const pixelsPerMs = rect.width / durationRef.current;
          const dt = Math.round((dragPx / pixelsPerMs) / 50) * 50;

          if (dt !== 0) {
            // 邊界夾緊、網格對齊、與鄰居的最小間距全部在 moveSegment 裡，
            // 那是純函式所以測得到（gestures.test.js）。這裡只負責把像素換算
            // 成毫秒。沒有實際位移時它會回傳原陣列，commitPart 就不會佔一格 undo。
            commitSegments(
              moveSegment(segmentsRef.current, segmentId, dt, {
                duration: durationRef.current,
              }),
            );
          }

          if (moveDraggedDomRef.current) {
            moveDraggedDomRef.current.style.transform = '';
            moveDraggedDomRef.current.style.zIndex = '';
            moveDraggedDomRef.current.style.overflow = '';
          }
        }

        moveDragStartRef.current = null;
        moveDraggedIdRef.current = null;
        moveDraggedDomRef.current = null;
        moveDragPixelsRef.current = 0;
        dispatch(updateMoveMode(false));
      };

      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mousedown', handleGlobalMouseDown);
      return () => {
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mousedown', handleGlobalMouseDown);
      };
    }, [moveMode, armorIndex, partIndex, dispatch]);

    // 左、右箭頭的樣式
    const leftarrowStyle = {
      position: "absolute",
      top: "50%",
      left: "2px",
      transform: "translateY(-40%) scaleX(-1)",
      fontSize: "22px",
      color: "white",
      pointerEvents: "none", // 禁用滑鼠事件
    };

    const rightarrowStyle = {
      position: "absolute",
      top: "50%",
      right: "2px",
      transform: "translateY(-50%)",
      fontSize: "22px",
      color: "white",
      pointerEvents: "none", // 禁用滑鼠事件
    };

    // 偵測點擊事件，點擊非 timeline-block 區域時取消選中
    useEffect(() => {
      const handleOutsideClick = (e) => {
        // 檢查是否為鼠標事件
        if (e.type !== "click") {
          console.warn(
            "handleOutsideClick should only be used for click events"
          );
          return;
        }
        // 检查点击是否发生在 .timeline-block 或 .palette-color-picker 区域内
        if (
          !e.target.closest(".timeline-block") &&
          !e.target.closest(".palette-color-picker") &&
          !e.target.closest(".color-button") &&
          !e.target.closest(".delete-button") &&
          !e.target.closest(".timeline-controls") &&
          !e.target.closest(".waveform-container") &&
          !e.target.closest(".brightness-control") &&
          !e.target.closest(".cut-button") &&
          !e.target.closest(".effect-wrapper") &&
          !e.target.closest(".uniform-alpha-wrapper")
        ) {
          console.log("click outside");
          dispatch(updateMultiSelectedBlocks([])); // 清除多選
          dispatch(updateIsColorChangeActive(false)); // 更新 Redux
        }
      };

      document.addEventListener("click", handleOutsideClick);
      return () => {
        document.removeEventListener("click", handleOutsideClick);
      };
    }, []);

    // 當 zoomValue 或 timelineRef 改變時更新畫布尺寸
    useEffect(() => {
      if (timelineRef?.current) {
        const timelineWidth = timelineRef.current.clientWidth;
        const timelineHeight = timelineRef.current.clientHeight || 200; // 預設高度 200
        setCanvasWidth(timelineWidth * zoomValue); // 設定畫布寬度
        setCanvasHeight(timelineHeight); // 設定畫布高度
      } else {
        setCanvasWidth(1600);
        setCanvasHeight(100);
      }
    }, [timelineRef, zoomValue]);

    // 當畫布寬度改變時更新 canvas 的寬度
    useEffect(() => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvasWidth; // 設定 canvas 寬度
      }
    }, [canvasWidth]);

    // 由這個部位的 segments 算出畫面上的色塊。
    // 依賴只有 segments —— 別的部位被編輯時這裡完全不會重跑。
    //
    // 排版規則（首尾相接、涵蓋 [0, duration)、空隙也是 block）都在
    // `buildTimelineBlocks` 裡，那是純函式所以測得到；這裡只負責寫進 store。
    useEffect(() => {
      dispatch(
        updateTimelineBlocks({
          armorIndex,
          partIndex,
          value: buildTimelineBlocks(segments, duration),
        })
      );
    }, [segments, duration, armorIndex, partIndex, dispatch]);

    /**
     * 由視覺 block 取得對應的 segment。空隙（`segmentId === null`）回傳 null。
     *
     * 舊版是拿 `block.startTime` 回頭去 keyframe 陣列 findIndex，還要排除
     * 同時間的黑點；那段反查在這個檔案裡有 5 份複本。block 現在自己帶著 id。
     */
    const segmentOfBlock = (block) =>
      block?.segmentId
        ? (segments.find((s) => s.id === block.segmentId) ?? null)
        : null;

    /**
     * 把一個 block 包成選取項目。
     *
     * `blockIndex` 是遷移期欄位，給還沒原生化的消費者用（TrackToolbar、
     * EffectMenu、CopyPasteManager…）。等它們都改讀 `segmentId` 之後，
     * 這裡連同 `keyframeIndexOfSegment` 一起刪掉。
     */
    const selectionForBlock = (block) => {
      const segment = segmentOfBlock(block);
      if (!segment) return null;

      return makeSelection({
        armorIndex,
        partIndex,
        segment,
        blockIndex: keyframeIndexOfSegment(partTimeline, segment),
      });
    };

    /** 目前這條時間軸上被選中的 segmentId（渲染時逐 block 判斷用） */
    const selectedIds = selectedIdsOnPart(
      multiSelectedBlocks,
      armorIndex,
      partIndex,
    );

    // 處理鼠標按下事件
    const handleMouseDown = (e, index) => {
      // ⚠️ stopPropagation 不可在此提前呼叫：
      // Move Mode 時必須根據情況決定是否攔截，讓全域 mousedown 能夠觸發提交/退出。

      const block = timelineBlocks[index];
      // 「這個 block 是不是空隙」以前是問「顏色是不是純黑」——但使用者本來
      // 就可以放一個很暗的色塊。現在直接看有沒有 segmentId。
      const isGapBlock = !block?.segmentId;

      // Move Mode 邏輯：
      // - 若已在追蹤中 或 點到空隙：不攔截 → 全域 mousedown 提交/退出
      // - 若尚未追蹤且點到色塊：stopPropagation 開始追蹤（本次點擊是「選取」，不是「提交」）
      if (moveMode) {
        if (moveDraggedIdRef.current !== null) return; // 已追蹤 → 讓全域 handler 提交
        if (isGapBlock) return;                          // 空隙 → 讓全域 handler 退出

        // 本次點擊是「選取 block 開始追蹤」，攔截讓全域 handler 無法立刻觸發提交
        e.stopPropagation();
        e.preventDefault();

        const selection = selectionForBlock(block);
        if (!selection?.segmentId) return;

        dispatch(updateMultiSelectedBlocks([selection]));

        const rect = timelineRef.current?.getBoundingClientRect();
        if (!rect) return;

        const pixelsPerMs = rect.width / duration;

        /*
         * 拖曳範圍（像素）—— 只給拖曳過程的即時預覽用，放開時的最終位置由
         * `moveSegment` 重算一次。兩邊用同一組常數（MIN_BLOCK_GAP_MS），
         * 否則會出現「拖到底了但放開後又跳一點」的錯位。
         *
         * 邊界直接看前後一段就好。舊版要往前往後跳過連續的黑色 entry 才找得到
         * 真正的鄰居，因為被刪掉的色塊會留下孤立黑點。
         */
        const index = segments.findIndex((s) => s.id === selection.segmentId);
        if (index === -1) return;

        const target = segments[index];
        const leftBoundTime = index > 0 ? segments[index - 1].end : 0;
        const rightBoundTime =
          index < segments.length - 1 ? segments[index + 1].start : duration;

        minDragPxRef.current = Math.min(
          0,
          (leftBoundTime - target.start + MIN_BLOCK_GAP_MS) * pixelsPerMs,
        );
        maxDragPxRef.current = Math.max(
          0,
          (rightBoundTime - target.end - MIN_BLOCK_GAP_MS) * pixelsPerMs,
        );
        moveDragStartRef.current = e.clientX;
        moveDraggedIdRef.current = selection.segmentId;
        moveDraggedDomRef.current = e.currentTarget; // 直接用事件的 target，不依賴 blockDomRefs（避免 null-cycle）
        moveDragPixelsRef.current = 0;

        // 拖曳時提高 z-index，確保移動中的 block 顯示在所有相鄰 block 上方
        if (moveDraggedDomRef.current) {
          moveDraggedDomRef.current.style.zIndex = '100';
          moveDraggedDomRef.current.style.overflow = 'visible';
        }
        return;
      }

      // 非 Move Mode：維持原本行為，攔截事件
      e.stopPropagation();

      // 邊緣 resize 邏輯：已選中的色塊在邊緣按下時啟動 resize，不進入普通選取流程
      if (
        !isGapBlock &&
        selectedIds.has(block.segmentId) &&
        hoverEdge?.index === index
      ) {
        e.preventDefault();
        startBlockResize(e, index, hoverEdge.edge);
        return;
      }

      if (isCopying) {
        // 關鍵：在尋找貼上目標時，僅更新單選(綠框目標)
        const selection = selectionForBlock(block);
        if (selection) {
          dispatch(updateMultiSelectedBlocks([selection]));
        }
        return;
      }

      // 點到空隙 = 取消所有選取
      if (isGapBlock) {
        dispatch(updateMultiSelectedBlocks([]));
        return;
      }

      const selection = selectionForBlock(block);
      if (!selection) return;

      // 點擊區塊時同步更新 currentTime，確保後續操作（如 Cut）能正確定位
      // 使用區塊自身的 bounding rect 計算區塊內點擊位置對應的時間，
      // 避免依賴 timeline 容器寬度（flex 百分比寬度像素捨入會累積誤差）
      // const blockRect = e.currentTarget?.getBoundingClientRect();
      // if (blockRect && blockRect.width > 0) {
      //   const clickFraction = (e.clientX - blockRect.left) / blockRect.width;
      //   const rawTime = block.startTime + clickFraction * block.durationTime;
      //   const clickTime = Math.round(rawTime / 50) * 50;
      //   dispatch(updateCurrentTime(Math.max(0, Math.min(clickTime, duration))));
      // }

      // Shift-click 多選：選取錨點與這次點擊之間的所有色塊。
      //
      // 舊版是走 keyframe 索引區間、跳過黑點；現在直接走 segment 陣列，
      // 「中間有幾個色塊」就是幾個，不必再判斷誰是哨兵。
      const anchorBlock = multiSelectedBlocks[0];
      const anchorSegmentIndex =
        e.shiftKey && anchorBlock
          ? segments.findIndex((s) => s.id === anchorBlock.segmentId)
          : -1;

      if (anchorSegmentIndex !== -1) {
        const clickedIndex = segments.findIndex(
          (s) => s.id === block.segmentId,
        );
        const from = Math.min(anchorSegmentIndex, clickedIndex);
        const to = Math.max(anchorSegmentIndex, clickedIndex);

        dispatch(
          updateMultiSelectedBlocks(
            segments.slice(from, to + 1).map((segment) =>
              makeSelection({
                armorIndex,
                partIndex,
                segment,
                blockIndex: keyframeIndexOfSegment(partTimeline, segment),
              }),
            ),
          ),
        );
      } else {
        // Single-select logic
        // [Drag 已停用] 啟用 drag 時需恢復以下三行，並同步恢復 state 宣告、handleMouseMove、handleMouseUp
        // setDragging(true);
        // setDraggedBlockIndex(index);
        // setDragStartpoint(e.clientX);
        dispatch(updateMultiSelectedBlocks([selection]));
      }
    };


    // [Drag 已停用] handleMouseUp：drag 提交用，啟用 drag 時需一併恢復 onMouseUp={handleMouseUp} 在 timeline div
    // const handleMouseUp = () => {
    //   // Move Mode 的 commit 用 mousedown 完成，mouseup 不應干預（否則會覆蓋剛提交的位置）
    //   if (dragging && !moveMode) {
    //     setDragging(false);
    //     setDraggedBlockIndex(null);
    //     dispatch(updateActionTable(tempActionTable));
    //   }
    // };
    // stretch mode
    // 開始邊緣 resize：掛載全域 mousemove/mouseup，透過 DOM 直接更新寬度（零延遲）
    // edge: 'left' | 'right'，tlIdx: timelineBlocks index
    const startBlockResize = (e, tlIdx, edge) => {
      const block = timelineBlocks[tlIdx];
      if (!block?.segmentId) return;
      const index = segments.findIndex((s) => s.id === block.segmentId);
      if (index === -1) return;
      const target = segments[index];

      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pixelsPerMs = rect.width / duration;

      const blockStartTime = target.start;
      const blockEndTime = target.end;

      const domEl = blockDomRefs.current[tlIdx];
      if (!domEl) return;

      // 右拖：同步縮小下一個空隙；左拖：同步縮小上一個空隙（避免 flex 重分配）
      const nextBlackDom     = edge === 'right' ? (blockDomRefs.current[tlIdx + 1] ?? null) : null;
      const nextBlackBlock   = edge === 'right' ? (timelineBlocks[tlIdx + 1] ?? null) : null;
      const nextBlackOrigPct = nextBlackBlock ? (nextBlackBlock.durationTime / duration) * 100 : 0;
      const prevBlackDom     = edge === 'left'  ? (blockDomRefs.current[tlIdx - 1] ?? null) : null;
      const prevBlackBlock   = edge === 'left'  ? (timelineBlocks[tlIdx - 1] ?? null) : null;
      const prevBlackOrigPct = prevBlackBlock ? (prevBlackBlock.durationTime / duration) * 100 : 0;

      resizeEdgeRef.current      = edge;
      resizeDragStartRef.current = e.clientX;
      resizedIdRef.current       = block.segmentId;
      resizedDomRef.current      = domEl;
      resizeDragPixelsRef.current = 0;
      resizeOrigPctRef.current   = (block.durationTime / duration) * 100;
      domEl.style.zIndex = '100';

      resizeBlockStartRef.current = blockStartTime;
      resizeBlockEndRef.current   = blockEndTime;

      /*
       * 可拖曳範圍（像素）—— 只給拖曳過程的即時預覽用，放開時由 `resizeSegment`
       * 重算一次最終值。兩邊必須用同一組常數，否則拖到底之後放開會再跳一下。
       *
       * 鄰居直接看陣列的前後一格。舊版要往前往後跳過連續的黑色 entry：
       * 被刪掉的色塊會留下孤立黑點，只看相鄰一格會找到錯的邊界。
       */
      // 鄰居的實際邊界（不含間距）——放開後要用它算相鄰空隙的新寬度
      resizeRightBoundRef.current =
        index < segments.length - 1 ? segments[index + 1].start : duration;
      resizeLeftBoundRef.current = index > 0 ? segments[index - 1].end : 0;

      if (edge === 'right') {
        const maxEnd = Math.min(
          resizeRightBoundRef.current - MIN_BLOCK_GAP_MS,
          duration,
        );
        maxResizePxRef.current = Math.max(0, (maxEnd - blockEndTime) * pixelsPerMs);
        minResizePxRef.current = -(blockEndTime - blockStartTime - STRETCH_MIN_MS) * pixelsPerMs;
      } else {
        const minStart = Math.max(resizeLeftBoundRef.current + MIN_BLOCK_GAP_MS, 0);
        minResizePxRef.current = Math.min(0, (minStart - blockStartTime) * pixelsPerMs);
        maxResizePxRef.current = (blockEndTime - STRETCH_MIN_MS - blockStartTime) * pixelsPerMs;
      }

      const handleResizeMouseMove = (ev) => {
        const rawDelta = ev.clientX - resizeDragStartRef.current;
        const clamped  = Math.max(minResizePxRef.current, Math.min(maxResizePxRef.current, rawDelta));
        resizeDragPixelsRef.current = clamped;
        const origPct = resizeOrigPctRef.current;
        if (resizeEdgeRef.current === 'right') {
          // 右拖：擴大此 block 同時縮小緊鄰的下一個 black block，
          // 使 flex 總寬不變，避免後面的 block 跟著位移
          resizedDomRef.current.style.width = `calc(${origPct}% + ${clamped}px)`;
          if (nextBlackDom) {
            nextBlackDom.style.width = `calc(${nextBlackOrigPct}% - ${clamped}px)`;
          }
        } else {
          // 左拖：縮小上一個 black block 同時調整此 block 寬度（對稱於右拖邏輯）
          // prevBlack(+clamped) + colored(-clamped) = 常數，flex 總寬不變
          resizedDomRef.current.style.width = `calc(${origPct}% - ${clamped}px)`;
          if (prevBlackDom) {
            prevBlackDom.style.width = `calc(${prevBlackOrigPct}% + ${clamped}px)`;
          }
        }
      };

      const handleResizeMouseUp = () => {
        const dragPx    = resizeDragPixelsRef.current;
        const savedId = resizedIdRef.current;
        const savedEdge = resizeEdgeRef.current;

        // 將最終計算結果提升到 produce 外，供 DOM 直接更新使用
        let committedEnd   = null; // right edge 時設定
        let committedStart = null; // left  edge 時設定

        if (savedId !== null && timelineRef?.current) {
          const r = timelineRef.current.getBoundingClientRect();
          if (r.width > 0) {
            const pxPerMs = r.width / durationRef.current;
            const rawDeltaMs = dragPx / pxPerMs;
            const dur = durationRef.current;

            /*
             * 邊界夾緊與網格對齊都在 resizeSegment 裡（純函式，測得到）。
             * 舊版除了算這些，還要把「因為位移而順序錯亂的孤立黑色 entry」
             * 一個個夾回去——那些黑點是熄滅的表示法，segment 模型裡不存在。
             */
            const nextSegments = resizeSegment(
              segmentsRef.current,
              savedId,
              savedEdge,
              rawDeltaMs,
              { duration: dur },
            );
            commitSegments(nextSegments);

            // DOM 要用最終值把寬度寫死（理由見下方註解），所以把結果讀回來
            const committed = nextSegments.find((seg) => seg.id === savedId);
            if (committed) {
              if (savedEdge === 'right') committedEnd = committed.end;
              else committedStart = committed.start;
            }
          }
        }

        // DOM 直接設為最終正確寬度，而非清空為 ''。
        // 原因：dispatch 後 timelineBlocks 需經兩步 effect 鏈才更新（actionTable → tempActionTable → timelineBlocks）。
        // 若先清空，React reconciler 在 timelineBlocks 尚未更新時因 virtual DOM width 前後相同而不更新真實 DOM，
        // 導致 block 以 width:'' 顯示（寬度 0，視覺消失）直到 timelineBlocks 終於更新為止。
        const dur = durationRef.current;

        if (resizedDomRef.current) {
          if (committedEnd !== null) {
            // 右邊拉伸：新寬度 = (newEnd - blockStart) / dur
            resizedDomRef.current.style.width = `${((committedEnd - resizeBlockStartRef.current) / dur) * 100}%`;
          } else if (committedStart !== null) {
            // 左邊拉伸：新寬度 = (blockEnd - newStart) / dur
            resizedDomRef.current.style.width = `${((resizeBlockEndRef.current - committedStart) / dur) * 100}%`;
          } else {
            resizedDomRef.current.style.width = '';
          }
          resizedDomRef.current.style.marginLeft = '';
          resizedDomRef.current.style.zIndex     = '';
        }

        if (nextBlackDom) {
          if (committedEnd !== null) {
            // 右拉：相鄰黑色 block 新寬度 = (nextColoredStart - newEnd) / dur
            const nextColoredStart = resizeRightBoundRef.current;
            nextBlackDom.style.width = `${((nextColoredStart - committedEnd) / dur) * 100}%`;
          } else {
            nextBlackDom.style.width = '';
          }
        }

        if (prevBlackDom) {
          if (committedStart !== null) {
            // 左拉：相鄰黑色 block 新寬度 = (newStart - prevColoredEnd) / dur
            const prevColoredEnd = resizeLeftBoundRef.current;
            prevBlackDom.style.width = `${((committedStart - prevColoredEnd) / dur) * 100}%`;
          } else {
            prevBlackDom.style.width = '';
          }
        }

        resizeEdgeRef.current       = null;
        resizeDragStartRef.current  = null;
        resizedIdRef.current     = null;
        resizedDomRef.current       = null;
        resizeDragPixelsRef.current = 0;
        setHoverEdge(null);

        document.removeEventListener('mousemove', handleResizeMouseMove);
        document.removeEventListener('mouseup',   handleResizeMouseUp);
      };

      document.addEventListener('mousemove', handleResizeMouseMove);
      document.addEventListener('mouseup',   handleResizeMouseUp);
    };


    return (
      <div
        className="timeline"
        ref={timelineRef} // 設置 ref
        style={{
          flex: `0 0 ${height}%`,
          width: "100%",
          display: "flex",
          alignItems: "center",
          overflow: moveMode ? "visible" : "hidden", // move mode 時允許 block 超出容器邊界顯示
          border: "1px solid rgb(63, 63, 63)",
          boxSizing: "border-box",
          padding: "0px",
          opacity: hidden ? 0 : 1, // 如果 hidden 为 true，則隱藏內容
          pointerEvents: hidden ? "none" : "auto", // 禁用鼠标事件
        }}
        // [Drag 已停用] 啟用 drag 時需恢復以下兩行
        // onMouseMove={handleMouseMove}
        // onMouseUp={handleMouseUp}
      >
      {timelineBlocks.map((block, index) => {
        // --- 1. 定義狀態變數 ---
        // block 自己帶著 segmentId，不必再回頭去 keyframe 陣列反查索引
        const isCurrentlyInMultiSelect =
          !!block.segmentId && selectedIds.has(block.segmentId);

        // A. 判斷是否為「貼上目標」(綠色)：在複製模式下且被點擊選中
        const isPasteTarget = isCopying && isCurrentlyInMultiSelect;

        // B. 判斷是否為「複製來源」（白色虛線 ring）：從剪貼簿讀取當初 Ctrl+C 的位置
        const isCopySource = isCopying && !!block.segmentId && clipboard?.sourceBlocks?.some(b =>
          b.armorIndex === armorIndex &&
          b.partIndex === partIndex &&
          b.segmentId === block.segmentId
        );

        // C. 判斷是否為「普通選取」（白色實線 ring）：非複製模式下的正常選取
        const isNormalSelected = !isCopying && isCurrentlyInMultiSelect;

        // --- 2. 顏色與樣式邏輯 ---
        const color = block.color || { R: 0, G: 0, B: 0, A: 1 };
        const isFade = block.linear === 1;

        // 定義背景。漸變的終點色記在 segment 自己身上（`colorEnd`），
        // 舊版要去看後面一個、再後面一個關鍵格並判斷誰是黑哨兵才推得出來。
        let backgroundStyle;
        if (isFade) {
          const endColor = block.colorEnd || { R: 0, G: 0, B: 0, A: 1 };
          backgroundStyle = `linear-gradient(to right, rgba(${color.R},${color.G},${color.B},${color.A}), rgba(${endColor.R},${endColor.G},${endColor.B},${endColor.A}))`;
        } else {
          backgroundStyle = `rgba(${color.R}, ${color.G}, ${color.B}, ${color.A})`;
        }

          // 空隙不能被選取、拖曳、resize（以前是用「顏色是不是純黑」判斷）
          const isGapBlock = !block.segmentId;

          /*
           * 選取框：一律白色雙層 ring，靠**線型**而不是顏色區分三種狀態。
           *
           * 舊版是橘色，撞到橘色色塊時改判青色——只擋得住一種顏色，選一塊青色
           * 色塊時邊框直接消失。而且「複製來源」與「普通選取」長得一模一樣，
           * 使用者只能靠記得自己剛才按了什麼。
           *
           * 白色在飽和色上對比最高，外圈的深色則保證在白色/淺色色塊上也看得見
           * ——這樣任何底色都讀得出來，不需要任何依顏色分支的判斷。
           */
          /*
           * ring 必須畫在**框內**（`inset`）。
           *
           * `.timeline` 在非 move mode 時是 `overflow: hidden`，畫在框外的
           * box-shadow 會被裁掉——第一塊色塊的左側 ring 永遠不見，軌道多的
           * 時候（7 軌時每軌只有約 40px 高）連上下兩邊也一起被切。
           *
           * inset 同時保證 ring 不會改變色塊的佔位，跟舊版用 border 一樣。
           */
          const ring = (width, color) =>
            `inset 0 0 0 ${width}px ${color}, inset 0 0 0 ${width + 2}px var(--ring-outer)`;

          const boxShadow = isPasteTarget
            ? ring(3, "var(--ring-selected)") // 貼上目標：最粗
            : isCopySource || isNormalSelected
              ? ring(2, "var(--ring-selected)")
              : "none";

          // 設定 blockStyle
          const blockStyle = {
            display: "inline-block",
            background: backgroundStyle,
            width: `${(block.durationTime / duration) * 100}%`,
            height: "90%",
            position: "relative",
            borderRadius: "var(--radius-sm)",
            zIndex: isPasteTarget ? 12 : isCopySource || isNormalSelected ? 10 : 1,
            boxShadow,
            // 複製來源用虛線區分——它和普通選取都是「被選中」，差在接下來會發生什麼
            outline: isCopySource ? "2px dashed var(--ring-selected)" : "none",
            outlineOffset: "-1px",
            boxSizing: "border-box",
            cursor: "default",
          };

          // [Drag 已停用] 以下三個 handler 供舊版 drag 邊緣偵測使用，啟用 drag 時需一併恢復 hoveredBlock state
          // const handleMouseLeave2 = (edge) => {
          //   setHoveredBlock((prev) => {
          //     const updatedBlock = { ...prev, [edge]: false };
          //     if (edge === "leftedge") updatedBlock.leftindex = null;
          //     if (edge === "rightedge") updatedBlock.rightindex = null;
          //     return updatedBlock;
          //   });
          // };
          // const handleMouseMoveLeft = (index) => {
          //   setHoveredBlock((prev) => ({ ...prev, leftedge: true, leftindex: index }));
          // };
          // const handleMouseMoveRight = (index) => {
          //   setHoveredBlock((prev) => ({ ...prev, rightedge: true, rightindex: index }));
          // };
          // 邊緣偵測：僅對已選中的有色 block 偵測游標位置以顯示 ew-resize 游標
          // （isNormalSelected 已在上方宣告）
          const EDGE_THRESHOLD = 8; // px

          const handleBlockMouseMove = (ev) => {
            // resizeDragStartRef 不為 null 代表正在 resize，跳過 state 更新避免觸發 React 重繪覆蓋直接設定的 DOM style
            if (moveMode || isGapBlock || !isNormalSelected || resizeDragStartRef.current !== null) return;
            const r = ev.currentTarget.getBoundingClientRect();
            const offsetX = ev.clientX - r.left;
            if (offsetX <= EDGE_THRESHOLD) {
              setHoverEdge({ index, edge: 'left' });
            } else if (offsetX >= r.width - EDGE_THRESHOLD) {
              setHoverEdge({ index, edge: 'right' });
            } else if (hoverEdge?.index === index) {
              setHoverEdge(null);
            }
          };

          const handleBlockMouseLeave = () => {
            // move mode 或 resize 進行中，不觸發 state 更新（避免 React re-render 覆蓋直接設定的 DOM style）
            if (moveMode || resizeDragStartRef.current !== null) return;
            if (hoverEdge?.index === index) setHoverEdge(null);
          };

          // 游標優先序：resize 邊緣 > move mode > 預設
          const blockCursor = (!moveMode && hoverEdge?.index === index)
            ? 'ew-resize'
            : (moveMode && !isGapBlock ? 'grab' : 'default');

          return (
            <div
              key={index}
              ref={(el) => { blockDomRefs.current[index] = el; }}
              style={{
                ...blockStyle,
                cursor: blockCursor,
                // [Drag 已停用] hoveredBlock 懸停透明度，啟用 drag 時恢復：
                // ...(hoveredBlock?.index === index ? { opacity: 0.85 } : { opacity: 1 }),
              }}
              className={`timeline-block${isPasteTarget ? " is-paste-target" : ""}`}
              onMouseMove={moveMode ? undefined : handleBlockMouseMove}
              onMouseLeave={moveMode ? undefined : handleBlockMouseLeave}
              onMouseDown={(e) => handleMouseDown(e, index)}
            >
              {block.linear === 1 && (
                <FontAwesomeIcon
                  icon={faWandMagicSparkles}
                  size="xl"
                  style={{
                    position: "absolute",
                    top: "5px",
                    right: "5px",
                    color: "var(--ring-selected)",
                    zIndex: 2,
                  }}
                />
              )}
              {/*
                亮度未滿的記號。
                「100% 亮度的鮮紅、alpha 設 30%」與「30% 亮度的暗紅、alpha 設 100%」
                合成後**像素完全相同**——這是數學不是 bug，用眼睛永遠分不出來。
                所以在右上角補一個不佔色相的三角角標，只表達「這塊沒有全亮」。
                漸變段已經有魔杖圖示佔著右上角，就不再疊一個。
              */}
              {!isGapBlock && block.linear !== 1 && (block.color?.A ?? 1) < 1 && (
                <span
                  className="block-dim-mark"
                  title={`亮度 ${Math.round((block.color?.A ?? 1) * 100)}%`}
                />
              )}
              {" "}
              {/*
              {/* 如果不是黑色方块，渲染左右虛擬檢測塊
              {!(
                block.color.R === 0 &&
                block.color.G === 0 &&
                block.color.B === 0 &&
                block.color.A === 1
              ) && (
                <>
                  {/* 左側虛擬檢測方塊 
                  <div
                    style={{
                      position: "absolute",
                      left: "-5px",
                      width: "50px",
                      height: "80%",
                      backgroundColor: "transparent", // 透明
                      cursor: "pointer", // 改變鼠標樣式
                      zIndex: 5,
                    }}
                    onMouseMove={() => handleMouseMoveLeft(index)}
                    onMouseLeave={() => handleMouseLeave2("leftedge")}
                  />
                  {/* 右側虛擬檢測方塊  
                  <div
                    style={{
                      position: "absolute",
                      right: "-5px",
                      width: "50px",
                      height: "80%",
                      backgroundColor: "transparent", // 透明
                      cursor: "pointer", // 改變鼠標樣式
                      zIndex: 5,
                    }}
                    onMouseMove={() => handleMouseMoveRight(index)}
                    onMouseLeave={() => handleMouseLeave2("rightedge")}
                  />{" "}
                  {hoveredBlock?.leftindex === index &&
                    hoveredBlock.leftedge && (
                      <FontAwesomeIcon
                        style={leftarrowStyle}
                        icon={faRightToBracket}
                        size="lg"
                      />
                    )}
                  {hoveredBlock?.rightindex === index &&
                    hoveredBlock.rightedge && (
                      <FontAwesomeIcon
                        style={rightarrowStyle}
                        icon={faRightToBracket}
                        size="lg"
                      />
                    )}
                </>
              )}
              */}
            </div>
          );
        })}
      </div>
    );
  }
);

export default memo(Timeline);
