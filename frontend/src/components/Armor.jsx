import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import "./Armor.css";
import {
  updateActionTable,
  updateCurrentTime,
} from "../redux/actions";

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

  // 新的部位名稱
  const partNames = [
    "hat",           // 0:帽子
    "head",          // 1:頭部
    "arms",          // 2:手臂
    "chest",         // 3:胸部
    "tie",           // 4:領帶
    "glove",         // 5:手套
    "belt",          // 6:腰帶
    "leg",           // 7:腿部
    "shoe",          // 8:鞋子
  ];

  // 根據部位名稱和當前時間計算顏色
  const getColorForPart = (part) => {
    const partData = actionTable?.[myId]?.[part] || [];
    const timeIndex = binarySearchFirstGreater(partData, time);
    const colorData = partData?.[timeIndex - 1]?.color || {
      R: 0,
      G: 0,
      B: 0,
      A: 1,
    };
    
    return `rgba(${colorData.R}, ${colorData.G}, ${colorData.B}, ${colorData.A})`;
  };

  const colors = Object.fromEntries(
    partNames.map((name, index) => [name, getColorForPart(index)])
  );

  function insertArray(part) {
    const partData = actionTable?.[myId]?.[part] || [];
    const indexToCopy = binarySearchFirstGreater(partData, time);
    const nowTime = Math.floor(time / 50) * 50;
    dispatch(updateCurrentTime(nowTime));

    const updatedActionTableEntries = Object.entries(actionTable).map(
      ([playerIndex, player]) => {
        playerIndex = Number(playerIndex);
        if (playerIndex === myId) {
          const updatedPlayer = { ...player };
          let updatedPartData = [...(player[part] || [])];

          const newEntry = {
            time: nowTime,
            color: { ...chosenColor },
          };

          const nextElement = updatedPartData[indexToCopy];
          const previousElement =
            updatedPartData[indexToCopy - 1] || updatedPartData[indexToCopy];

          const isNextBlack =
            !nextElement ||
            (nextElement?.color?.R === 0 &&
              nextElement?.color?.G === 0 &&
              nextElement?.color?.B === 0);

          const isPreviousBlack =
            !previousElement ||
            (previousElement?.color?.R === 0 &&
              previousElement?.color?.G === 0 &&
              previousElement?.color?.B === 0);

          const existingIndex = updatedPartData.findIndex(
            (entry) => entry.time === nowTime
          );

          if (existingIndex !== -1) {
            updatedPartData = updatedPartData.map((entry, index) =>
              index === existingIndex
                ? { ...entry, color: { ...chosenColor } }
                : entry
            );
          } else if (indexToCopy === 0) {
            const blackArray2 = {
              time: duration,
              color: { R: 0, G: 0, B: 0, A: 1 },
            };
            updatedPartData.splice(partData.length, 0, newEntry, blackArray2);
          } else if (!isPreviousBlack && isNextBlack) {
            const blackArray = {
              time: nowTime - blackthreshold,
              color: { R: 0, G: 0, B: 0, A: 1 },
            };
            updatedPartData.splice(indexToCopy + 1, 0, blackArray, newEntry);
          } else if (!isPreviousBlack && !isNextBlack) {
            const blackArray = {
              time: nowTime - blackthreshold,
              color: { R: 0, G: 0, B: 0, A: 1 },
            };
            const blackArray2 = {
              time:
                nextElement?.time - blackthreshold || nowTime + blackthreshold,
              color: { R: 0, G: 0, B: 0, A: 1 },
            };
            updatedPartData.splice(
              indexToCopy + 1,
              0,
              blackArray,
              newEntry,
              blackArray2
            );
          } else if (isPreviousBlack && !isNextBlack) {
            const blackArray2 = {
              time:
                nextElement?.time - blackthreshold || nowTime + blackthreshold,
              color: { R: 0, G: 0, B: 0, A: 1 },
            };
            updatedPartData.splice(indexToCopy + 1, 0, newEntry, blackArray2);
          } else {
            updatedPartData.splice(partData.length, 0, newEntry);
          }

          updatedPartData.sort((a, b) => a.time - b.time);
          updatedPlayer[part] = updatedPartData;
          return [playerIndex, updatedPlayer];
        }
        return [playerIndex, player];
      }
    );

    const updatedActionTable = Object.fromEntries(updatedActionTableEntries);
    dispatch(updateActionTable(updatedActionTable));
  }

  // 二分搜尋找到對應時間
  function binarySearchFirstGreater(arr, target) {
    if (!arr) return;
    let left = 0;
    let right = arr?.length - 1;
    let result = 0;

    while (left <= right) {
      let mid = Math.floor((left + right) / 2);
      if (arr[mid].time > target) {
        result = mid;
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }
    return result;
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

        {/*1:head*/}
        {isSelected(1) && renderHighlight(null, null, null, null, "circle", {
          r: 30,
          cx: 121,
          cy: 68
        })}
        <circle
          cx="121"
          cy="68"
          r="30"
          fill={colors.head}
          onClick={() => handleColorChange(1)}
        />

        {/*2:arm*/}
        {isSelected(2) && renderHighlight(35, 103, 32, 65)}
        <rect
          x="35"
          y="103"
          width="32"
          height="65"
          fill={colors.arms}
          onClick={() => handleColorChange(2)}
        />

        {isSelected(2) && renderHighlight(175, 103, 32, 65)}
        <rect
          x="175"
          y="103"
          width="32"
          height="65"
          fill={colors.arms}
          onClick={() => handleColorChange(2)}
        />

        {/*3:chest*/}
        {isSelected(3) && renderHighlight(72, 103, 28, 65)}
        <rect
          x="72"
          y="103"
          width="28"
          height="65"
          fill={colors.chest}
          onClick={() => handleColorChange(3)}
        />
        
        {isSelected(3) && renderHighlight(142, 103, 28, 65)}
        <rect
          x="142"
          y="103"
          width="28"
          height="65"
          fill={colors.chest}
          onClick={() => handleColorChange(3)}
        />

        {/* 4:tie*/}

        {isSelected(4) && renderHighlight(105, 103, 32, 50)}
        <rect
          x="105"
          y="103"
          width="32"
          height="50"
          fill={colors.tie}
          onClick={() => handleColorChange(4)}
        />
        {/* 領帶三角形 - 與矩形完美對齊 */}
        {isSelected(4) && (
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
          onClick={() => handleColorChange(4)}
        />


        {/*5: glove*/}
        {isSelected(5) && renderHighlight(35, 173, 32, 35)}
        <rect
          x="35"
          y="173"
          width="32"
          height="35"
          fill={colors.glove}
          onClick={() => handleColorChange(5)}
        />

        {isSelected(5) && renderHighlight(175, 173, 32, 35)}
        <rect
          x="175"
          y="173"
          width="32"
          height="35"
          fill={colors.glove}
          onClick={() => handleColorChange(5)}
        />

        {/*6: belt*/}
        {isSelected(6) && renderHighlight(78, 173, 86, 35)}
        <rect
          x="78"
          y="173"
          width="86"
          height="35"
          fill={colors.belt}
          onClick={() => handleColorChange(6)}
        />

        {/*7:leg*/}
        {isSelected(7) && renderHighlight(85, 213, 28, 80)}
        <rect
          x="85"
          y="213"
          width="28"
          height="80"
          fill={colors.leg}
          onClick={() => handleColorChange(7)}
        />
        {isSelected(7) && renderHighlight(129, 213, 28, 80)}
        <rect
          x="129"
          y="213"
          width="28"
          height="80"
          fill={colors.leg}
          onClick={() => handleColorChange(7)}
        />

        {/*8: shoe*/}
        {isSelected(8) && renderHighlight(75, 298, 45, 25)}
        <rect
          x="75"
          y="298"
          width="45"
          height="15"
          fill={colors.shoe}
          onClick={() => handleColorChange(8)}
        />

        {isSelected(8) && renderHighlight(122, 298, 45, 25)}
        <rect
          x="122"
          y="298"
          width="45"
          height="15"
          fill={colors.shoe}
          onClick={() => handleColorChange(8)}
        />
        </g>
      </svg>
    </div>
  );
};

export default Armor;
