/**
 * buildPlayers — 把編輯器的 actionTable 壓平成韌體吃的 PlayerData 陣列。
 *
 * 這段邏輯原本內嵌在 Home.jsx 的 handleOutput 內（2026-08-08 原樣抽出成純函式，
 * 以便被 golden 測試鎖定）。**輸出是韌體契約**：欄位順序 (hat..acc7)、時間單位
 * (50ms tick)、32-bit 打包格式都不可任意更動，任何修改都必須先通過
 * __tests__/buildPlayers.golden.test.js。
 *
 * 給 C++ 開發者的類比：這相當於把 struct 序列化成 wire format 的函式，
 * 欄位順序等同 ABI，改了另一端（韌體）就會解析錯誤。
 *
 * @param {Array|Object} actionTable - actionTable[armorIndex][partIndex] = [{time, color:{R,G,B,A}, linear}]
 * @returns {Array<Array<Object>>} players[armorIndex] = [{time, hat, face, ..., acc7}]
 */
export function buildPlayers(actionTable) {
  const players = [];
  const armorIndices = Object.keys(actionTable);

  for (let i = 0; i < armorIndices.length; i++) {
    const armorIndex = armorIndices[i];
    const partGroup = actionTable[armorIndex];

    // 收集這位舞者所有部位的關鍵格時間，對齊到 50ms 網格後去重
    let times = new Set();

    for (let key in partGroup) {
      const partArray = partGroup[key];
      if (!Array.isArray(partArray)) continue;

      partArray.forEach((item) => {
        const roundedTime = Math.ceil(item.time / 50) * 50;
        times.add(roundedTime);
      });
    }

    let uniqueTimes = [...times]
      .map((t) => Math.round(t))
      .sort((a, b) => a - b);

    let mergedResults = [];

    for (let j = 0; j < uniqueTimes.length; j++) {
      const time = uniqueTimes[j];

      const mergedItem = {
        time: Math.floor(time / 50),
      };

      for (let key in partGroup) {
        const partTimeline = partGroup[key];
        if (!Array.isArray(partTimeline) || partTimeline.length === 0) continue;

        // 找出時間軸上最後一個 time <= 當前取樣點的關鍵格
        let activeBlock = null;
        let activeIndex = -1;

        for (let k = 0; k < partTimeline.length; k++) {
          if (partTimeline[k].time <= time) {
            activeBlock = partTimeline[k];
            activeIndex = k;
          } else {
            break;
          }
        }

        let R = 0,
          G = 0,
          B = 0,
          A = 1,
          linear = 0;

        if (activeBlock) {
          if (activeBlock.linear === 1) {
            const nextBlock = partTimeline[activeIndex + 1];

            if (nextBlock && nextBlock.time > activeBlock.time) {
              // 線性漸變：分母用關鍵格的原始毫秒時間，不是對齊後的時間
              const f =
                (time - activeBlock.time) / (nextBlock.time - activeBlock.time);

              R = Math.round(
                activeBlock.color.R * (1 - f) + nextBlock.color.R * f,
              );
              G = Math.round(
                activeBlock.color.G * (1 - f) + nextBlock.color.G * f,
              );
              B = Math.round(
                activeBlock.color.B * (1 - f) + nextBlock.color.B * f,
              );
              A = activeBlock.color.A * (1 - f) + nextBlock.color.A * f;
              linear = 1;
            } else {
              R = activeBlock.color.R;
              G = activeBlock.color.G;
              B = activeBlock.color.B;
              A = activeBlock.color.A;
              linear = 1;
            }
          } else {
            R = activeBlock.color.R;
            G = activeBlock.color.G;
            B = activeBlock.color.B;
            A = activeBlock.color.A;
            linear = 0;
          }
        }

        // 32-bit 打包：[R 8][G 8][B 8][亮度 7][漸變 1]
        const alpha7 = Math.min(Math.floor(A * 128), 127);
        const packedByte = (alpha7 << 1) | (linear & 1);

        const color32 =
          ((R & 0xff) << 24) |
          ((G & 0xff) << 16) |
          ((B & 0xff) << 8) |
          (packedByte & 0xff);

        mergedItem[key] = color32 >>> 0;
      }

      // 欄位順序即韌體 ABI，不可調換
      mergedResults.push({
        time: mergedItem.time,
        hat: mergedItem[0] ?? 0,
        face: mergedItem[1] ?? 0,
        chestL: mergedItem[2] ?? 0,
        chestR: mergedItem[3] ?? 0,
        armL: mergedItem[4] ?? 0,
        armR: mergedItem[5] ?? 0,
        tie: mergedItem[6] ?? 0,
        belt: mergedItem[7] ?? 0,
        gloveL: mergedItem[8] ?? 0,
        gloveR: mergedItem[9] ?? 0,
        legL: mergedItem[10] ?? 0,
        legR: mergedItem[11] ?? 0,
        shoeL: mergedItem[12] ?? 0,
        shoeR: mergedItem[13] ?? 0,
        acc0: mergedItem[14] ?? 0,
        acc1: mergedItem[15] ?? 0,
        acc2: mergedItem[16] ?? 0,
        acc3: mergedItem[17] ?? 0,
        acc4: mergedItem[18] ?? 0,
        acc5: mergedItem[19] ?? 0,
        acc6: mergedItem[20] ?? 0,
        acc7: mergedItem[21] ?? 0,
      });
    }

    // 缺漏欄位由前一列補上（forward fill）
    for (let j = 0; j < mergedResults.length; j++) {
      if (j > 0) {
        for (let k in mergedResults[j - 1]) {
          if (
            !(k in mergedResults[j]) ||
            mergedResults[j][k] === undefined ||
            mergedResults[j][k] === null
          ) {
            mergedResults[j][k] = mergedResults[j - 1][k];
          }
        }
      }
    }

    players.push(mergedResults);
  }

  return players;
}

export default buildPlayers;
