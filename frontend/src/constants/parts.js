/**
 * 舞者與部位定義 — 單一來源。
 *
 * 原本這份清單在 5 個檔案裡有 6 份複本（英文 key 兩份、中文 label 三份、
 * 外加一份過時的 7 部位版本），任何增減部位都得同步改好幾處，很容易漏。
 *
 * ⚠️ `PART_KEYS` 的順序就是**韌體 ABI**：上傳的每一列都依這個順序帶 22 個欄位，
 *    調換順序或改名會讓韌體解析錯誤。已由 buildPlayers.golden.test.js 的
 *    「韌體 ABI」測試鎖定。
 *
 * 部位配置：0-13 為身體部位，14-21 為飾品燈（acc0-acc7）。
 * 飾品燈哪些舞者可用由 config/accessoryConfig.js 的 isPartAllowed 決定。
 */

export const PARTS = [
  { key: "hat", label: "帽子", type: "body" },
  { key: "face", label: "臉", type: "body" },
  { key: "chestL", label: "左胸", type: "body" },
  { key: "chestR", label: "右胸", type: "body" },
  { key: "armL", label: "左手臂", type: "body" },
  { key: "armR", label: "右手臂", type: "body" },
  { key: "tie", label: "領帶", type: "body" },
  { key: "belt", label: "腰帶", type: "body" },
  { key: "gloveL", label: "左手套", type: "body" },
  { key: "gloveR", label: "右手套", type: "body" },
  { key: "legL", label: "左腿", type: "body" },
  { key: "legR", label: "右腿", type: "body" },
  { key: "shoeL", label: "左鞋", type: "body" },
  { key: "shoeR", label: "右鞋", type: "body" },
  { key: "acc0", label: "配件1", type: "accessory" },
  { key: "acc1", label: "配件2", type: "accessory" },
  { key: "acc2", label: "配件3", type: "accessory" },
  { key: "acc3", label: "配件4", type: "accessory" },
  { key: "acc4", label: "配件5", type: "accessory" },
  { key: "acc5", label: "配件6", type: "accessory" },
  { key: "acc6", label: "配件7", type: "accessory" },
  { key: "acc7", label: "配件8", type: "accessory" },
];

/** 韌體欄位名稱，順序即 ABI */
export const PART_KEYS = PARTS.map((part) => part.key);

/** UI 顯示用的中文名稱 */
export const PART_LABELS = PARTS.map((part) => part.label);

/** 每位舞者的部位數（22 = 14 身體 + 8 飾品） */
export const PART_COUNT = PARTS.length;

/** 身體部位的數量，索引 >= 此值即為飾品燈 */
export const BODY_PART_COUNT = PARTS.filter(
  (part) => part.type === "body",
).length;

/** 舞者人數 */
export const PLAYER_COUNT = 7;
