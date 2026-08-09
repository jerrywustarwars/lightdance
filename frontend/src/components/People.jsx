import React, { useEffect } from "react";
import Armor from "./Armor.jsx";
import AccessoryPanel from "./AccessoryPanel.jsx";
import { useDispatch, useSelector } from "react-redux";
import { updateActionTable } from "../redux/actions.js";
import { PLAYER_COUNT, PART_COUNT } from "../constants/parts.js";

function People() {
  const components = Array(7).fill(null);
  const actionTable = useSelector(
    (state) => state.profiles.data?.actionTable || [],
  );
  const dancerVisibility = useSelector(
    (state) => state.profiles.dancerVisibility,
  );
  const dispatch = useDispatch();

  // 初始化 actionTable。segment 模型的「全部熄滅」就是每個部位一個空陣列——
  // 沒有段就是沒有光，不需要放一個 time 0 的黑點。
  useEffect(() => {
    if (!actionTable || actionTable.length === 0) {
      const initialData = Array.from({ length: PLAYER_COUNT }, () =>
        Array.from({ length: PART_COUNT }, () => []),
      );

      console.log("Initializing actionTable:", initialData);
      // skipHistory：這是初始化不是編輯，不該佔用一格 undo。
      // （Phase 4 前是靠 reducer 裡「第一個部位只有 1 個元素」的形狀猜測達成，
      //   那條判斷在 segment 世界會誤判正常編輯，已改為由呼叫端明示。）
      dispatch(updateActionTable(initialData, { skipHistory: true }));
    }
  }, [dispatch, actionTable]);

  return (
    <>
      {components.map((_, index) => {
        if (!dancerVisibility[index]) {
          return null;
        }
        return (
          <div className="personBackGround" key={index}>
            <Armor index={index} />
          </div>
        );
      })}
      <AccessoryPanel />
    </>
  );
}

export default People;
