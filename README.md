# LightDance

NYCU 電機系的燈光舞蹈編排系統。七位舞者身上各穿一套 LED 光衣，每套 22 個可獨立控制的部位，這個 Web 應用程式就是用來畫出「第幾秒、哪個人、哪個部位、什麼顏色」的那張表，然後把它壓平成韌體吃得下的格式送進 MongoDB。

## 先看這個：怎麼跑起來

需要 Docker，其餘什麼都不用裝。

```bash
git clone <repository-url>
cd lightdance
./start-dev.sh
```

跑起來之後編輯器在 [localhost:3000](http://localhost:3000)，API 文件在 [localhost:8000/docs](http://localhost:8000/docs)，資料庫管理介面在 [localhost:8081](http://localhost:8081)。要停就 Ctrl+C，或另開一個終端機下 `docker compose -f docker-compose.dev.yml down`。

`start-dev.sh` 做的事情就是帶著 `.env.development` 去跑 `docker compose up --build`，所以腳本壞掉時你可以自己下：

```bash
docker compose -f docker-compose.dev.yml --env-file .env.development up --build
```

## 這東西實際上在做什麼

使用者在瀏覽器裡對著七套光衣點顏色，每一次點擊都會在對應部位的時間軸上放一個**色塊**。色塊有起點、終點、起始色與結束色，中間可以線性漸變。表演的完整資料就是一個三層結構：`actionTable[舞者][部位][色塊清單]`。

按下 Output 的時候，前端把這張表壓平成韌體的格式再上傳。壓平的規則是**每 50ms 一格**（`TICK_MS`），每一列包含一個時間格號與 22 個部位的顏色，顏色打包成 32-bit 整數：

$$\text{packed} = (R \ll 24)\ |\ (G \ll 16)\ |\ (B \ll 8)\ |\ ((\alpha_7 \ll 1)\ |\ \text{linear})$$

最低那一個 bit 是漸變旗標，往上七個 bit 是亮度。所以一列就是 `time` 加上 22 個欄位，**欄位順序就是韌體的 ABI**——`constants/parts.js` 裡 `PART_KEYS` 的順序不可以隨便調換，韌體那端是照位置解的。這件事有 golden test 鎖著，改到會直接紅燈。

上傳一次會同時寫兩個 collection：`color` 存壓平後的播放資料給韌體讀，`raw_json` 存編輯器的原始 JSON 供下次載入。後端只負責收下來存進去，不解析內容。

## 資料模型：為什麼是色塊而不是關鍵格

這是整個專案最值得先搞懂的一件事，因為它解釋了程式碼裡大半的設計。

最初的模型是「關鍵格 + 黑色哨兵」：時間軸上存的是一連串 `{time, color}` 的點，燈就從一個點的顏色一路亮到下一個點。問題是這樣沒辦法表達「這塊到這裡結束，不要漸變到下一段」——唯一的辦法是在結束前 10ms 硬塞一個純黑的點當作句號。

那個 10ms 的黑點滲透到所有地方。放色要判斷前後鄰居是不是黑的才知道要補幾個哨兵，那段五分支的邏輯被複製了四份；鍵盤導航要「自動跳過黑色」否則會選到句號；拖曳一個色塊得同步搬移兩到 N 個點加上鄰居的黑點；還得有 `removeDuplicateBlackBlocks` 這種函式定期打掃。根因是**資料形狀沒有把色塊的邊界寫出來**，整份程式碼都在從「點的序列加上鄰居是不是黑色」反推色塊在哪裡。

現在的模型直接把色塊當成一級物件：

```js
actionTable[armor][part] = [
  { id, start, end, colorStart, colorEnd, linear },
  ...
]
```

段與段之間**可以有間隔，間隔就是熄滅**。黑色不再是資料，只是「這裡沒有段」的渲染結果。壓平回韌體格式時，空隙前會在網格整點補一個黑點——所以韌體看到的東西完全沒變，這件事有一整組等價測試在守。

每個色塊有穩定的 `id`。這點很重要：先前用陣列索引當識別，連續踩了三次同一類 bug——索引在鄰居被刪除或色塊被切開時會指向別人，而且不會報錯，只會靜靜地選錯東西。

## 架構

開發與生產的路由方式不一樣，這點常常搞混人。開發時 Vite dev server 跑在 3000，`/api` 由它 proxy 到 8000 的 FastAPI；生產時 Nginx 吃 80，靜態檔案直接由它服務，`/api` 才轉發給後端。

```
開發：瀏覽器 → Vite (3000) ──/api proxy──→ FastAPI (8000) → MongoDB (27017)
生產：瀏覽器 → Nginx (80) ──/api 轉發──→ FastAPI (8000) → MongoDB (27017)
                    └── React build 的靜態檔案
```

`docker-compose.dev.yml` 起四個服務：`frontend-dev`、`backend`、`mongo`、`mongo-express`。前後端都掛了 volume 做熱重載，改程式碼不用重建 image。

前端的狀態放在 Redux，並用 redux-persist 存進 IndexedDB。persist 設了 `serialize: false`——光表資料很大而且含 `Float32Array`，走 JSON 序列化每次編輯要 73ms，關掉之後剩 0.5ms。另外有一份走 localforage 的本地備份，30 天自動清理。

## 目錄裡有什麼

前端的 `src/components/audio/` 是編輯器的主體。`audioplayer.jsx` 現在只是外殼（狀態容器加版面組合），有快捷鍵的功能一律拆成 hook 放邏輯、元件放 UI，這樣按鈕和鍵盤共用同一組函式，不會出現「按鈕修好了但快捷鍵還是舊行為」。`hooks/useKeyboardShortcuts.js` 是全站唯一的 keydown 註冊點。

`src/utils/segments/` 是資料模型的核心。`core.js` 刻意不 import 任何跟顏色有關的東西——長期目標是讓音軌也用同一套段落模型做多軌剪貼，所以核心必須對 payload 無知。`convert.js` 是新舊格式的雙向轉換器，載入舊資料時會用到。

`src/styles/tokens.css` 是全站**唯一**可以出現寫死顏色的地方，其他 CSS 一律 `var()` 引用。有測試掃描所有 CSS 把違規的抓出來，目前是 0 處。這條規則的理由很現實：在收斂之前 14 個 CSS 檔裡有 287 個寫死的顏色值、同一個灰有 25 個副本，想把背景調暗一階要改 25 個地方，漏一個就花掉。

後端只有 `backend/main.py` 一支主程式加 `models.py` 的 Pydantic 模型。`backend/` 底下另外有一組 MongoDB 備份腳本，`BACKUP_README.md` 有完整說明。

## 驗收

單元測試跑 vitest，分成 node 環境的純函式與 jsdom 環境的元件冒煙測試：

```bash
cd frontend
npm test          # 385 項
npm run build
```

但 jsdom 沒有版面也送不出真實的鍵盤事件序列，所以另外有兩支 Playwright 腳本補這一段。它們把 `/api/**` 全部攔截回假資料，**後端不用跑**：

```bash
npm run dev            # 另一個終端機
npm run e2e            # 27 項功能驗收
npm run audit:layout   # 版面稽核
```

這兩支不是裝飾。實測抓到過單元測試全綠但實際完全不能用的東西：Ctrl+數字被防彈跳吃掉（因為 `Control` 自己那一下 keydown 佔掉了名額，所有 Ctrl+數字在瀏覽器上按不動，但 jsdom 測試直接送最終那一下所以全過）、按鈕階層被 Bootstrap 的 `.btn` 蓋掉、17 則工具提示有 12 則被 `overflow` 裁光——被裁掉的提示不會報錯，hover 就是什麼都不出現。

版面稽核問瀏覽器四個問題：每個可互動元素的中心點 `document.elementFromPoint()` 回傳的是不是它自己（不是就代表被蓋住，使用者點不到），有沒有元素溢出容器，有沒有提示被祖先的 `overflow` 裁掉，以及該對齊的成對元素（舞者開關與光衣）中心有沒有對上。1600×950 與 1280×800 各跑一次。

如果跑 e2e 時看到「編輯器一直載入不了」或「一直被彈回首頁」，**先重開 `npm run dev` 再判斷**。連續改一堆 CSS 之後 vite 的 HMR 狀態會累積到 `/home` 載不起來，那是開發伺服器的問題不是程式碼的問題。

## 要改人數或部位清單的話

只需要改 `frontend/src/constants/parts.js`。改人數就是改 `PLAYER_COUNT` 一個數字，初始光表、舞者顯示開關、全選欄位、要渲染幾套光衣全部由它推導；改部位就是在 `PARTS` 增刪一列。

有三件事不會自動跟上，`constants/__tests__/partsConfig.test.js` 會在改壞時指出是哪一項：韌體 ABI（`PART_KEYS` 的順序就是上傳每一列的欄位順序，韌體那端要同步改），光衣 SVG（`Armor.jsx` 的圖形是手繪的，新增身體部位要自己畫），以及飾品索引（`config/accessoryConfig.js` 的 `indices` 會隨身體部位增減而位移）。

## 常用指令

```bash
docker compose -f docker-compose.dev.yml ps            # 服務狀態
docker compose -f docker-compose.dev.yml logs -f       # 即時日誌
docker compose -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.dev.yml exec backend sh
docker volume rm lightdance_frontend_node_modules      # 清前端快取
./run-deploy.sh                                        # 生產環境部署
cd backend && ./mongo-backup.sh                        # 手動備份資料庫
```

## 常見問題

連接埠被占用就用 `lsof -i :3000`（前端）、`:8000`（後端）、`:27017`（資料庫）找出來是誰，或者去 `.env.development` 改掉。前端編譯出怪錯誤通常是 node_modules 的 volume 髒了，停掉之後 `docker volume rm lightdance_frontend_node_modules` 再啟動。

登入拿到 500 的話是 MongoDB 連線問題，`docs/troubleshooting-login-500.md` 有完整的排查 SOP，不要瞎猜。

## 安全性

這是開發版本，正式部署前有四件事一定要修：密碼目前是**明文儲存**，要換成 bcrypt 或 Argon2；token 機制過於簡單，要改用 JWT；使用者輸入的驗證不足；CORS 設定過寬。細節與改進方案在 `docs/technical-analysis.md` 第五章。

## 文件

`docs/` 底下依主題分開放。想了解架構與已知問題看 `technical-analysis.md`，環境變數與部署模式看 `configuration.md`，從編輯器到資料庫的完整資料流看 `data-flow-pipeline.md`，前端效能與渲染細節看 `frontend-rendering-optimization.md`，UI 設計系統的決策與施工回顧看 `ui-design-plan.md`，鍵盤快捷鍵看 `shortcuts.md`（編輯器裡按 Shortcuts 按鈕也看得到），MongoDB 備份與 Docker 操作看 `backend-management.md`。

寫程式碼的時候註解用中文、命名用英文，而且註解要說明**為什麼**這樣做，不要複述程式碼在做什麼。品質的優先順序是可讀性 > 可維護性 > 可擴展性 > 簡潔。
