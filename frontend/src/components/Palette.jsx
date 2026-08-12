import React from "react";
import { useState, useEffect } from "react";
import "./Palette.css";
import TransparentButton from "./TransparentButton";
import { RiSketching } from "react-icons/ri";
import { FaEyeDropper } from "react-icons/fa6";
import { useDispatch, useSelector } from "react-redux";
import {
  updateChosenColor,
  updatePaletteColor,
  updateFavoriteColor,
} from "../redux/actions";

/** 最愛色盤的格數：2 列 × 3 欄 = 6 格 */
const FAVORITE_ROWS = 2;
const FAVORITE_COLS = 3;

/** `#RRGGBB`（大小寫皆可）才算合法，避免半途輸入就去改顏色 */
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

function Palette({ rgba, setRgba }) {
  const dispatch = useDispatch();
  const favoriteColor = useSelector((state) => state.profiles.favoriteColor);
  const chosenColor = useSelector((state) => state.profiles.chosenColor);
  const paletteColor = useSelector((state) => state.profiles.paletteColor);

  // const [inputValue, setInputValue] = useState("#000000");
  const [clickStatus, setClickStatus] = useState(false);
  const [toggleState, setToggleState] = useState(false); //

  /**
   * 最愛色固定 6 格，排成 2 列 × 3 欄。
   *
   * 原本是 4 列 × 2 欄（8 格），但面板只有 170px 寬，後兩列會被捲出可視範圍
   * ——存進去之後就找不到了。改成 6 格剛好一次看得完。
   *
   * 既有使用者的 store 裡是舊形狀，所以這裡不只在空的時候初始化，也把任何
   * 不是 2×3 的形狀攤平重排（保留前 6 個顏色，不足補白）。
   */
  useEffect(() => {
    const rows = FAVORITE_ROWS;
    const cols = FAVORITE_COLS;
    const alreadyRight =
      favoriteColor.length === rows &&
      favoriteColor.every((line) => Array.isArray(line) && line.length === cols);
    if (alreadyRight) return;

    const flat = favoriteColor.flat();
    const filled = Array.from(
      { length: rows * cols },
      (_, i) => flat[i] ?? { R: 255, G: 255, B: 255, A: 1 },
    );
    dispatch(
      updateFavoriteColor(
        Array.from({ length: rows }, (_, r) =>
          filled.slice(r * cols, (r + 1) * cols),
        ),
      ),
    );
  }, [dispatch, favoriteColor]);

  useEffect(() => {
    const sample = document.getElementById("thecolorsample");
    if (sample) {
      sample.addEventListener("click", function (event) {
        if (event.target) {
          document.querySelector("#colorWell").click();
        }
      });
    }

    // 清理事件监听器
    return () => {
      if (sample) {
        sample.removeEventListener("click", function (event) {
          if (event.target) {
            document.querySelector("#colorWell").click();
          }
        });
      }
    };
  }, []);

  /*
   * HEX 欄位需要自己的草稿狀態：使用者一個字一個字打的時候會經過
   * `#F`、`#FF3`… 這些還不合法的中間狀態，不能每次按鍵都去改顏色。
   * 只有輸入完整的 6 位色碼才真的套用，離開欄位時再同步回目前顏色。
   */
  const [hexDraft, setHexDraft] = useState(paletteColor);
  useEffect(() => {
    setHexDraft(paletteColor.toUpperCase());
  }, [paletteColor]);

  const handleHexChange = (event) => {
    const next = event.target.value.toUpperCase();
    setHexDraft(next);
    if (HEX_PATTERN.test(next)) applyHexColor(next);
  };

  /** 套用一個合法的 #RRGGBB，透明度維持不變 */
  const applyHexColor = (hex) => {
    dispatch(updatePaletteColor(hex));
    dispatch(
      updateChosenColor({
        R: parseInt(hex.slice(1, 3), 16),
        G: parseInt(hex.slice(3, 5), 16),
        B: parseInt(hex.slice(5, 7), 16),
        A: chosenColor.A !== undefined ? chosenColor.A : 1,
      }),
    );
  };

  const handleColorChange = (event) => {
    const newColor = event.target.value;
    dispatch(updatePaletteColor(newColor));

    const hexToRgba = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const a = chosenColor.A !== undefined ? chosenColor.A : 1; // 保持透明度不變
      return { R: r, G: g, B: b, A: a };
    };
    const rgbaColor = hexToRgba(newColor);
    dispatch(updateChosenColor(rgbaColor)); // 更新 Redux 狀態中的 chosenColor
  };

  useEffect(() => {
    console.log("顏色已變為:", chosenColor); // 侦测颜色变化
  }, [chosenColor]); // 每次 color 更新时触发

  const handleToggleChange = () => {
    setToggleState(!toggleState); // 切換滑桿狀態
    setClickStatus(!clickStatus); // 同步修改 clickStatus
  };

  const setSampleColor = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    let a = rgba.A !== undefined ? rgba.A : 1;
    setRgba({ R: r, G: g, B: b, A: a });
    dispatch(updateChosenColor({ R: r, G: g, B: b, A: a }));
  };

  function deepClone2DArray(arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
      return arr;
    }
    const clone = [];
    for (let i = 0; i < arr.length; i++) {
      if (Array.isArray(arr[i])) {
        clone.push(deepClone2DArray(arr[i])); // Recursively clone nested arrays
      } else {
        clone.push(arr[i]); // Copy non-array elements
      }
    }
    return clone;
  }

  const handleClick = (lineId, squareId) => {
    if (clickStatus) {
      handleChooseFavoriteColor(lineId, squareId);
    } else {
      handleChangeFavoriteColor(lineId, squareId);
    }
  };

  function handleChooseFavoriteColor(lineId, squareId) {
    var it = favoriteColor[lineId][squareId];
    dispatch(updateChosenColor({ R: it.R, G: it.G, B: it.B, A: it.A }));

    let hexString =
      "#" +
      ((1 << 24) | (it.R << 16) | (it.G << 8) | it.B)
        .toString(16)
        .slice(1)
        .toUpperCase();
    dispatch(updatePaletteColor(hexString));
  }

  function handleChangeFavoriteColor(lineId, squareId) {
    let tmpArray = deepClone2DArray(favoriteColor);
    let alpha = chosenColor.A !== undefined ? chosenColor.A : 1;
    tmpArray[lineId][squareId] = {
      R: chosenColor.R,
      G: chosenColor.G,
      B: chosenColor.B,
      A: alpha,
    };

    // setFavoriteColor(tmpArray);
    dispatch(updateFavoriteColor(tmpArray));
  }


  return (
    <div className="palette">
      <input
        className="palette-color-picker"
        type="color"
        value={paletteColor}
        id="colorWell"
        onChange={handleColorChange}
      />{" "}
      {/*
        原本這個位置顯示的是打包後的 32-bit RGBA 整數（例如 84215140）——
        那是 debug 產物，對使用者沒有意義。位置本來就該回答「目前顏色是什麼」，
        所以換成看得懂、也能貼色碼進去的 HEX 欄位。
      */}
      <div className="hex-field">
        <label htmlFor="hexInput">HEX</label>
        <input
          id="hexInput"
          type="text"
          value={hexDraft}
          spellCheck={false}
          maxLength={7}
          aria-label="目前顏色的 HEX 色碼"
          onChange={handleHexChange}
          onBlur={() => setHexDraft(paletteColor.toUpperCase())}
        />
      </div>
      <TransparentButton rgba={rgba} setRgba={setRgba} />
      <div className="favorite_color_background">
        {favoriteColor.map((colorArray, lineId) => (
          <div key={lineId} className="favorite_color_line">
            {colorArray.map((color, squareId) => (
              <div
                key={squareId}
                className="favorite_color_sample"
                color={color}
                style={{
                  backgroundColor: `rgb(${color.R * color.A}, ${
                    color.G * color.A
                  }, ${color.B * color.A})`,
                  zIndex: "100",
                }}
                onClick={() => handleClick(lineId, squareId)}
              />
            ))}
          </div>
        ))}
      </div>

      {/*
        填色 / 取色 是模式切換，不屬於「最愛顏色」清單。原本被放在
        .favorite_color_background 裡面，色票一多就跟著捲出可視範圍
        （實測整排被推到面板外 130px，完全點不到）。移到清單外面固定住。
      */}
      <div className="color-status">
        <span
          style={{
            color: toggleState ? "#808080" : "#FFFFFF",
            transition: "color 0.5 ease",
          }}
        >
          <RiSketching /> 填色
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="1"
          value={toggleState ? 1 : 0} // 根據 toggleState 控制滑桿位置
          onChange={handleToggleChange}
          className="color-slider" // 使用外部 CSS 樣式
        />
        <span
          style={{
            color: toggleState ? "#FFFFFF" : "#808080", // toggleState=0時，取色變灰色
            transition: "color 0.5 ease",
          }}
        >
          <FaEyeDropper /> 取色
        </span>
      </div>
    </div>
  );
}

export default Palette;
