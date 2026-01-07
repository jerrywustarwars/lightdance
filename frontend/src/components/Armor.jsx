import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import "./Armor.css";
import {
  updateActionTable,
  updateCurrentTime,
} from "../redux/actions";

// 部位名稱常數（對應 Home.jsx 的輸出映射）
const PART_NAMES = [
  "hat",           // 0:帽子
  "face",          // 1:臉部
  "chestL",        // 2:左胸
  "chestR",        // 3:右胸
  "armL",          // 4:左手臂
  "armR",          // 5:右手臂
  "tie",           // 6:領帶
  "belt",          // 7:腰帶
  "gloveL",        // 8:左手套
  "gloveR",        // 9:右手套
  "legL",          // 10:左腿
  "legR",          // 11:右腿
  "shoeL",         // 12:左鞋
  "shoeR",         // 13:右鞋
  "board",         // 14:板子
];

const Armor = (props) => {
  const dispatch = useDispatch();
  const actionTable = useSelector((state) => state.profiles.actionTable);
  const time = useSelector((state) => state.profiles.currentTime);
  const duration = useSelector((state) => state.profiles.duration);
  const chosenColor = useSelector((state) => state.profiles.chosenColor);
  const selectedBlock = useSelector((state) => state.profiles.selectedBlock);
  const myId = props.index;
  const blackthreshold = 10;

  useEffect(() => {
    console.log("actionTable: ", actionTable);
  }, [actionTable]);

  // 使用 useMemo 確保在 time 或 actionTable 變化時重新計算顏色
  const colors = useMemo(() => {
    console.log(`[Armor ${myId}] Recalculating colors, time=${time}`);

    // 根據部位索引和當前時間計算顏色（支援時間漸變）
    const getColorForPart = (part) => {
      const partData = actionTable?.[myId]?.[part] || [];

      // 新格式: 找到包含當前時間的色塊 (startTime <= time < endTime)
      const currentBlock = partData.find(
        (block) => block.startTime <= time && time < block.endTime
      );

      if (!currentBlock) {
        return `rgba(0, 0, 0, 1)`;
      }

      const color = currentBlock.color || { R: 0, G: 0, B: 0, A: 1 };

      // 如果當前光塊沒有啟用漸變，直接回傳顏色
      if (currentBlock.linear !== 1) {
        return `rgba(${color.R}, ${color.G}, ${color.B}, ${color.A})`;
      }

      // 漸變模式：計算隨時間變化的顏色
      // 找到下一個色塊
      const currentIndex = partData.indexOf(currentBlock);
      const nextBlock = partData[currentIndex + 1];

      // 新方案：直接使用下一個塊的顏色，或默認為黑色
      let endColor = { R: 0, G: 0, B: 0, A: 1 };
      if (nextBlock) {
        endColor = nextBlock.color;
      }

      // 計算當前時間在光塊中的進度比例 (0 到 1)
      const startTime = currentBlock.startTime;
      const endTime = currentBlock.endTime;
      const progress = Math.min(Math.max((time - startTime) / (endTime - startTime), 0), 1);

      // 線性插值計算當前時間對應的顏色
      const interpolatedR = Math.round(color.R + (endColor.R - color.R) * progress);
      const interpolatedG = Math.round(color.G + (endColor.G - color.G) * progress);
      const interpolatedB = Math.round(color.B + (endColor.B - color.B) * progress);
      const interpolatedA = color.A + (endColor.A - color.A) * progress;

      // 除錯：顯示漸變資訊
      if (part === 6 && currentBlock.linear === 1) { // 領帶
        console.log(`[Armor ${myId}] 🎨 Part ${part} gradient: progress=${progress.toFixed(2)}, color=(${interpolatedR},${interpolatedG},${interpolatedB})`);
      }

      return `rgba(${interpolatedR}, ${interpolatedG}, ${interpolatedB}, ${interpolatedA})`;
    };

    return Object.fromEntries(
      PART_NAMES.map((name, index) => [name, getColorForPart(index)])
    );
  }, [time, actionTable, myId]);

  function insertArray(part) {
    const partData = actionTable?.[myId]?.[part] || [];
    const nowTime = Math.floor(time / 50) * 50;
    dispatch(updateCurrentTime(nowTime));

    const updatedActionTableEntries = Object.entries(actionTable).map(
      ([playerIndex, player]) => {
        playerIndex = Number(playerIndex);
        if (playerIndex === myId) {
          const updatedPlayer = { ...player };
          let updatedPartData = [...(player[part] || [])];

          // 新格式: { startTime, endTime, color, linear }
          // 檢查是否有色塊包含當前時間點
          const existingIndex = updatedPartData.findIndex(
            (block) => block.startTime <= nowTime && nowTime < block.endTime
          );

          if (existingIndex !== -1) {
            // 如果當前時間在某個色塊內部，更新該色塊的顏色
            updatedPartData = updatedPartData.map((block, index) =>
              index === existingIndex
                ? { ...block, color: { ...chosenColor } }
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
              console.warn(`[Armor] Not enough space to create new block at ${nowTime}ms`);
              return [playerIndex, player];
            }

            const newBlock = {
              startTime: nowTime,
              endTime: newEndTime,
              color: { ...chosenColor },
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

            console.log(`[Armor] Created new block: ${nowTime}ms - ${newEndTime}ms`);
          }

          updatedPlayer[part] = updatedPartData;
          return [playerIndex, updatedPlayer];
        }
        return [playerIndex, player];
      }
    );

    const updatedActionTable = Object.fromEntries(updatedActionTableEntries);
    dispatch(updateActionTable(updatedActionTable));
  }


  const isSelected = (part) => {
    return (
      selectedBlock &&
      selectedBlock.armorIndex === myId &&
      selectedBlock.partIndex === part
    );
  };

  // 處理部位顏色更改
  const handleColorChange = (part) => {
    insertArray(part);
  };

  // 渲染高亮邊框
  const renderHighlight = (
    x,
    y,
    width,
    height,
    shape = "rect",
    options = {}
  ) => {
    const { r = null, cx = null, cy = null } = options;

    if (shape === "rect") {
      return (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="none"
          stroke="white"
          strokeWidth="2"
        />
      );
    }

    if (shape === "circle") {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="white"
          strokeWidth="2"
        />
      );
    }

    return null;
  };

  return (
    <div className="armor-container">
      {/* 舞者編號標籤 */}
      <div className="dancer-label">舞者 {myId + 1}</div>
      <svg width="242" height="480" viewBox="10 0 222 480">
        {/* 將所有 SVG 內容向下移動 35px，為標籤留出空間 */}
        <g transform="translate(0, 35)">
        {/*0:hat*/}
        {isSelected(0) && (
          <path
            d="M 96.8 5 L 145.2 5 L 145.2 23 L 169.4 23 L 169.4 38 L 72.6 38 L 72.6 23 L 96.8 23 Z"
            fill="none"
            stroke="white"
            strokeWidth="2"
          />
        )}
        <path
          d="M 96.8 5 L 145.2 5 L 145.2 23 L 169.4 23 L 169.4 38 L 72.6 38 L 72.6 23 L 96.8 23 Z"
          fill={colors.hat}
          onClick={() => handleColorChange(0)}
        />

        {/*1:face - 臉部*/}
        {isSelected(1) && renderHighlight(null, null, null, null, "circle", {
          r: 30,
          cx: 121,
          cy: 68
        })}
        <circle
          cx="121"
          cy="68"
          r="30"
          fill={colors.face}
          onClick={() => handleColorChange(1)}
        />

        {/*2:chestL - 左胸（螢幕左側）*/}
        {isSelected(2) && renderHighlight(72, 103, 28, 65)}
        <rect
          x="72"
          y="103"
          width="28"
          height="65"
          fill={colors.chestL}
          onClick={() => handleColorChange(2)}
        />

        {/*3:chestR - 右胸（螢幕右側）*/}
        {isSelected(3) && renderHighlight(142, 103, 28, 65)}
        <rect
          x="142"
          y="103"
          width="28"
          height="65"
          fill={colors.chestR}
          onClick={() => handleColorChange(3)}
        />

        {/*4:armL - 左手臂（螢幕左側）*/}
        {isSelected(4) && renderHighlight(35, 103, 32, 65)}
        <rect
          x="35"
          y="103"
          width="32"
          height="65"
          fill={colors.armL}
          onClick={() => handleColorChange(4)}
        />

        {/*5:armR - 右手臂（螢幕右側）*/}
        {isSelected(5) && renderHighlight(175, 103, 32, 65)}
        <rect
          x="175"
          y="103"
          width="32"
          height="65"
          fill={colors.armR}
          onClick={() => handleColorChange(5)}
        />

        {/*6:tie - 領帶*/}
        {isSelected(6) && renderHighlight(105, 103, 32, 50)}
        <rect
          x="105"
          y="103"
          width="32"
          height="50"
          fill={colors.tie}
          onClick={() => handleColorChange(6)}
        />
        {/* 領帶三角形 - 與矩形完美對齊 */}
        {isSelected(6) && (
        <polygon
         points="105,153 137,153 121,173"
         fill="none"
         stroke="white"
         strokeWidth="2"
        />
        )}
        <polygon
          points="105,153 137,153 121,173"
          fill={colors.tie}
          onClick={() => handleColorChange(6)}
        />


        {/*7:belt - 腰帶*/}
        {isSelected(7) && renderHighlight(78, 173, 86, 35)}
        <rect
          x="78"
          y="173"
          width="86"
          height="35"
          fill={colors.belt}
          onClick={() => handleColorChange(7)}
        />

        {/*8:gloveL - 左手套（螢幕左側）*/}
        {isSelected(8) && renderHighlight(35, 173, 32, 35)}
        <rect
          x="35"
          y="173"
          width="32"
          height="35"
          fill={colors.gloveL}
          onClick={() => handleColorChange(8)}
        />

        {/*9:gloveR - 右手套（螢幕右側）*/}
        {isSelected(9) && renderHighlight(175, 173, 32, 35)}
        <rect
          x="175"
          y="173"
          width="32"
          height="35"
          fill={colors.gloveR}
          onClick={() => handleColorChange(9)}
        />

        {/*10:legL - 左腿（螢幕左側）*/}
        {isSelected(10) && renderHighlight(85, 213, 28, 80)}
        <rect
          x="85"
          y="213"
          width="28"
          height="80"
          fill={colors.legL}
          onClick={() => handleColorChange(10)}
        />

        {/*11:legR - 右腿（螢幕右側）*/}
        {isSelected(11) && renderHighlight(129, 213, 28, 80)}
        <rect
          x="129"
          y="213"
          width="28"
          height="80"
          fill={colors.legR}
          onClick={() => handleColorChange(11)}
        />

        {/*12:shoeL - 左鞋（螢幕左側）*/}
        {isSelected(12) && renderHighlight(75, 298, 45, 25)}
        <rect
          x="75"
          y="298"
          width="45"
          height="15"
          fill={colors.shoeL}
          onClick={() => handleColorChange(12)}
        />

        {/*13:shoeR - 右鞋（螢幕右側）*/}
        {isSelected(13) && renderHighlight(122, 298, 45, 25)}
        <rect
          x="122"
          y="298"
          width="45"
          height="15"
          fill={colors.shoeR}
          onClick={() => handleColorChange(13)}
        />
        </g>
      </svg>
    </div>
  );
};

export default Armor;
