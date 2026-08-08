# 重構 Roadmap：keyframe → segment（2026-08-08 修訂版）

> **本文件取代 4 月版 todo.md。** 4 月版在 `jerry` 分支上制定並執行到 Phase 0.5 中段後捨棄；
> 本版基於 upstream (NYCUECE-Lightdance) 最新 main（`refract` 分支）重新稽核全部假設後修訂。
> 設計動機與已拍板決策見 CLAUDE.md「色塊資料模型重構計畫」章節。
>
> 基準狀態：audioplayer.jsx 1971 行、Timeline.jsx 1217 行、22 個部位、零測試設施。

---

## 🎯 使用者已拍板的決策（2026-08-08）

| 項目 | 決策 |
|---|---|
| 硬體 tick | 可調常數 `TICK_MS = 50`，集中於 `constants/time.js`，不寫死 |
| 點光衣放色預設長度 | **1 秒**（`DEFAULT_SEGMENT_MS = 1000`） |
| raw_data 格式 | **可以改** — 前端黑盒子，直接存 segment JSON + `schemaVersion: 2` |
| 黑色哨兵 | **徹底消滅** — 不保留 -10ms 相容規則，`blackthreshold` 從專案完全消失；f9489cf 的「黑點豁免 50ms 對齊」特例隨 v1→v2 遷移作廢 |
| 輸出等價標準 | 從 byte-equal 放寬為**結構化 diff**：所有列的 time 必須完全相同；差異只允許出現在「線性漸變內部取樣點」；幅度依漸變長度而定（見 D2 實測），預設容許最大通道差 16；其他任何差異視為 bug |
| 優先順序 | 可維護性 → DAW 風燈光編輯 → 多軌音訊 |

---

## 📌 對 4 月版規劃的 16 項更正

> upstream 在 4 月版寫作後前進了 39 個 commit，以下逐項更正過時假設（2026-08-08 已逐項對照 HEAD 驗證）。

1. **tempActionTable 現在真的是死代碼** — Timeline.jsx 的 tempActionTable 拖曳整段被註解停用（L775-984），現行拖曳 = Move Mode（M 鍵、redux `moveMode`、拖曳期間 direct-DOM transform）+ 邊緣 resize。4 月版的自我修正（「列為 dead 是錯的」）需反轉：**可刪**。
2. **快捷鍵已變**：`M` = toggleMoveMode、`P` = 改色（原本 M）；`B` 會 prompt 50ms 倍數週期；`handleAlphaChoose` 已刪除（Ctrl+數字 直接走 `handleBrightnessChange`）。
3. **Q3 已解**：韌體時間單位確為 50ms tick（上傳 `time = floor(ms/50)`）；黑點 -10ms 曾被 f9489cf 制度化為刻意設計，但**使用者已拍板消滅它**（見上表）。
4. **Q4 已解**：放色預設 1 秒。
5. **Q5 已解**：raw_data 可改存 v2 segment 格式。
6. **上傳路徑已變**：前端只走 `POST /api/upload_full`（Home.jsx:411，一次寫 color+raw 兩個 collection）。`upload_items` / `upload_raw` 是死路徑。輸出等價的比對目標 = `handleOutput` 產生的 `players` 陣列。
7. **死檔清單修正**：**新增 `components/Item.jsx`**（415 行全死，含一份 insertArray 與過時 7 部位名稱）；**移除 WaveSurferplayer.jsx**（EditActionTable.jsx:5 引用、`/edit` 路由活著）；musicsrc/ 仍被 musicData.js 引用（Home.jsx:23、waveform.jsx:4），不可用 4 月版理由刪。
8. **寫入者清單過時**：audioplayer.jsx 1761→1971 行，新增 `handleUniformSameColorAlphaChange`（L1502）；`blackthreshold=10` 聲明在 **5 個檔案**（audioplayer:104、Timeline:58、Armor:19、Item:19、AccessoryPanel:64）；insertArray 黑點邏輯重複 **4 份**（Armor:100、audioplayer:578、Item:53、AccessoryPanel:64）。
9. **部位模型過時**：14 → **22**（14 身體 + 8 飾品 acc0-7）。新增 AccessoryPanel.jsx + `config/accessoryConfig.js`（`isPartAllowed` 閘門）。部位名稱重複 **6 處聲明 / 5 個檔案**；`PART_COUNT=22`（Home.jsx:33）、`TOTAL_PARTS=22`（LoadData.jsx:11）。
10. **undo 機制已變**：歷史在 `UPDATEACTIONTABLE` reducer case 內自動 push（profiles.js:100-115，cap 50，`skipHistory` 逃生口）。剩餘問題只有 EditActionTable.jsx 的獨立 local `useState` history。
11. **持久化現況**：redux-persist 走 localforage/IndexedDB、2s debounce、StripEphemeralTransform + PeaksTransform，**無 version/migrate hook**。且存在 4 月版未提及的**第三條載入路徑**：`utils/indexedDB.js` 本地備份（原樣存 keyframe actionTable、無版本欄位）。
12. **新增約束**：`docs/frontend-rendering-optimization.md` 記載的零 re-render 拖曳路徑（rAF 三層分離、direct-DOM、React.memo）必須保留（見 Phase 5 驗收）。
13. **新發現問題**：actionTable 容器型別不一致 — Home.jsx normalize 產 **array**、LoadData.jsx / sanitizeActionTable.js / Armor.jsx / AccessoryPanel.jsx 寫 **object**（key "0".."21"）、audioplayer 用 `.map`。Phase 1 統一為 array。
14. **舊 Phase 0.5 廢除** — 「先寫 8 個 keyframe-native utils + 測試、segment 化後重寫」是雙重工。改為：元件拆分只做純搬移，新邏輯一律 segment-native（見 Phase 3 / Phase 5）。
15. **Q2（linear 統計）不再是 blocker** — 轉換器逐格保語意 + golden fixtures 覆蓋真實資料，無需先統計 mongo。
16. **後端不動**，但註記已知 bug：`GET /api/raw/{u}/LATEST` 查錯 collection（main.py:243，查 color 而非 raw）→ **golden fixture 擷取須用明確 timestamp 或本地備份，勿用 LATEST**。retention「保留 5 筆」邏輯是 no-op（delete 被註解），upload_full 完全無 retention — 維持現狀不處理。

---

## 🔑 四個關鍵設計決策

### D1. Golden fixture 測試安全網（動資料模型的前提）

專案目前**零測試**（無 vitest/jest/pytest，CI 唯一硬門檻是 build）。改 shape 前必須先有安全網：

- 把 Home.jsx:246-390 的 players 建構迴圈**原樣**抽成純函式 `utils/export/buildPlayers.js`（這是測試存在前唯一允許的程式碼變動；merge 前在瀏覽器 console 對真實專案做一次前後 `JSON.stringify` diff 確認）。
- Fixture 三來源，全部要：
  1. **真實本地備份**（最佳）：從隊員機器的 IndexedDB（`LightDanceBackupDB/backups`）匯出 `local_backup_*`，commit 成 `{input, expected}` 對放 `utils/export/__fixtures__/`。
  2. **mongo raw_json**：用明確 timestamp 撈（避開 LATEST bug），每位 production 使用者至少 1 筆。
  3. **合成邊界案例**：空表、鏈式 `linear===1`、漸變中途接離網格黑點、連續黑點、同時間重複 keyframe、最後 keyframe == duration、object-keyed vs array 容器、僅飾品有資料的舞者。
- Expected 輸出由抽出的 `buildPlayers` 跑一次產生後 commit；之後每個 Phase 都重跑全部 fixture。

### D2. 黑色哨兵徹底消滅 + 結構化 diff（2026-08-08 使用者拍板）

黑色色塊目前只承擔三個功能，segment 世界各有更乾淨的替代：LED 熄滅 = segment 空隙；視覺縫隙 = 真實空隙；漸變不流血 = 段內漸變語意。因此：

- `keyframesToSegments`：色 keyframe @t1 + 黑 keyframe @b → segment `{start: t1, end: ceil(b/TICK_MS)*TICK_MS}`；**所有黑點正規化上網格後丟棄**——黑色不再是資料。
- `segmentsToKeyframes`（僅供匯出壓平與過渡期 adapter 使用）：segment 後有空隙時，在**網格點 `end` 整點**輸出熄滅。不保留任何 -10ms 相容規則，**`BLACK_SENTINEL_MS` 不存在**。
- 已知且被接受的輸出差異：黑點從 `g−10` 移到 `g` 後**時間格完全不變**（`ceil((g−10)/50)*50 = g`）；唯一差異是**線性漸變**的插值分母微調（如 990→1000），只影響漸變**內部**取樣點（端點不受影響，端點在兩種算法下都是黑）。
- **誤差幅度（2026-08-08 實測，非估計）**：理論上界約 `255 × 10 / (漸變長度ms − 10)`，漸變越短誤差越大。合成 fixture 實測：1000ms 漸變最大通道差 **2**、100ms 漸變最大通道差 **15**。對應上界：L=1000→3、L=500→6、L=200→14、L=100→29。
  > ⚠️ 修正紀錄：本計畫初稿曾寫「最多 ±1」，那是錯的（未考慮分母比例效應）。Phase 0 建立比對器時實測後更正。
- **等價測試 = 結構化 diff**（`utils/export/structuredDiff.js`）：斷言 (a) 舞者數/列數/所有 `time` 完全相同；(b) 有差異的欄位必須**兩邊 linear bit 都是 1**（即確實位於漸變內部）；(c) 最大通道差不超過容許值（預設 16，實測最大 15）；(d) 其他任何差異 = 測試失敗。round-trip 冪等（轉過去再轉回來達到不動點）為必要測試。
- 若真實資料量測出超過 16 的差異，代表現場存在比 100ms 更短的漸變——屆時再決定調高容許值或對短漸變特別處理，**用資料決定，不要臆測**。

### D3. Adapter 橋一次切換（取代 4 月版的長混合期）

4 月版「讀走 segment、寫走 keyframe」的混合期會讓資料同時活在兩種語意下數週，極難除錯。改為：

1. Phase 2 先證明轉換**冪等 + 結構化 diff 全綠**（閘門）。
2. Phase 4 **單一原子 PR**：store 換成 segments；舊寫入者各包 `withKeyframeAdapter(fn) = segs => toSegments(fn(toKeyframes(segs)))`，舊渲染改讀 memoized `selectKeyframes` selector——**既有程式碼零改動**，行為不變。
3. Phase 5 逐個把寫入者/讀取者改寫成 segment 原生並拆掉它的 adapter；全拆完刪橋。

代價：過渡期每次編輯 commit 多兩次 O(n) 轉換（拖曳過程不受影響，照走 direct-DOM）。回滾：見 D4 的 persist key bump。

### D4. schemaVersion + 三條載入路徑統一遷移

單一入口 `utils/migration/loadProjectData.js`：偵測形狀（v1 = `{time, color, linear}` 條目；v2 = `{schemaVersion: 2, actionTable: segments}`）回傳標準 v2。

- **路徑 1 redux-persist**：persist key `root` → `root_v2`，自訂 getStoredState fallback 讀舊 `root` key 並遷移。選 key bump 而非 createMigrate 是為了回滾安全：deploy revert 後舊 build 讀原封不動的舊 key。
- **路徑 2 遠端 raw_data**（LoadData.jsx fetchRawPlayerData）：parse → loadProjectData，v1 mongo 舊文件**永久**保留 lazy migrate。
- **路徑 3 本地備份**（utils/indexedDB.js）：讀取時遷移；新寫入帶 `schemaVersion: 2`；v1 讀取相容永久保留。
- 新上傳：`raw_data = JSON.stringify({schemaVersion: 2, actionTable: <segments>, ...})`，後端不解析、不改動。

---

## 🗺️ 分期 Roadmap

### Phase 0 測試安全網（S / 低風險 / **最先做，block 一切**）✅ 大致完成 2026-08-08

- [x] `npm i -D vitest`（v4.1.10）+ `vitest.config.js`；`package.json` 加 `test` / `test:watch` / `test:update-golden`；接進 `.github/workflows/pr-checks.yml`（**硬性門檻**，無 continue-on-error）
- [x] 抽出 `frontend/src/utils/export/buildPlayers.js`（Home.jsx:246-390 原樣搬），Home.jsx 改呼叫
  - 驗證方式**優於原訂的「console 手動 diff」**：直接從 git HEAD 取出舊的內嵌迴圈包成函式，與新 `buildPlayers` 在全部 fixture 上跑 `JSON.stringify` 比對 → **13/13 byte-equal**，證明抽出零行為變更
- [x] 合成邊界 fixtures（13 筆）於 `src/utils/export/__tests__/fixtures/synthetic.js`：空表、離網格黑點漸變、短漸變、鏈式漸變、連續黑點、同時間重複、網格邊界、頻閃配對、alpha 變化、僅飾品、object 容器、多舞者混合
- [x] Golden 測試 + 韌體 ABI 鎖定（欄位順序、uint32 範圍、時間遞增）：`buildPlayers.golden.test.js`
- [x] 結構化 diff 比對器 `utils/export/structuredDiff.js` + 測試（含 Phase 2 情境預演）
- [ ] **待隊員協助**：加入真實 production fixtures（每位使用者至少 1 筆）→ 步驟見 `src/utils/export/__tests__/fixtures/real/README.md`，放進 `real/` 目錄會自動載入，然後跑 `npm run test:update-golden`
  - 加入後**重新量測**漸變差異的實際最大值，據以確認 `maxChannelDelta` 預設值 16 是否合適
- **Ship**：單一 PR。回滾：revert。

### Phase 1 清理與常數統一（M / 低風險 / 4 個獨立 PR，可與 Phase 2 平行）

- [ ] **死 redux**：刪 `UPDATETIMELINEBLOCK`（單數）、`UPDATEHISTORY`、`UPDATE_IS_DIRTY`、`UPDATEMAGNETACTIVE`/`magnetActive`、**`tempActionTable`**（更正 #1）。保留：`timelineBlocks`、`isColorChangeActive`、`playbackRate`、`fullPeaks`、`moveMode`、`selectedDancerId`
- [ ] **死檔**：`src/Block.js`、`src/pages/ex.js`、`components/audio/audioUploadBtm.jsx`、**`components/Item.jsx`**；一併刪 Timeline.jsx 已註解的 L775-984 拖曳塊。**不刪** WaveSurferplayer.jsx 與 musicsrc/（更正 #7）
- [ ] **`constants/time.js`**：`TICK_MS = 50`（可調）、`DEFAULT_SEGMENT_MS = 1000`。現有字面 `50` 與 5 處 `blackthreshold` 宣告改 import（宣告本體在 Phase 5 隨黑點邏輯死亡，先單一來源防 drift）
- [ ] **`constants/parts.js`**：22 條 `{key, label, type: 'body'|'accessory'}` + `PART_COUNT = 22`；取代 6 處重複宣告（Armor、AccessoryPanel、ControlPanel、EditActionTable ×2、Home/LoadData 的計數常數）；buildPlayers 的輸出欄位順序（hat..acc7）是**韌體 ABI，加測試鎖定**；accessoryConfig.js / isPartAllowed 保留但改 import
- [ ] **容器統一**：canonical = 7 armor × 22 part 的**巢狀 array**；三條載入邊界 + sanitize 後套 normalize；修正 object 寫入者（LoadData.jsx、sanitizeActionTable.js、Armor.jsx、AccessoryPanel.jsx）。golden 測試保護（buildPlayers 用 for-in 兩者皆可，輸出不變）
- [ ] **insertArray 四合一**：Armor:100 + audioplayer:578 + AccessoryPanel:64 → 暫時性 `utils/keyframe/insertColorKeyframes.js`（Phase 5 死亡），附 2-3 個黑點分支單元測試
- **Ship**：各子 PR 獨立。驗收：golden 全綠 + 手動 checklist。

### Phase 2 Segment 規格 + 轉換器（M / 概念中風險 / 可與 Phase 1、3 平行）

- [ ] Schema 文件（CLAUDE.md + docs/）：`segment = {id, start, end, colorStart, colorEnd, linear, effect?}`；`effect` 欄位**現在預留**（blink metadata 於 Phase 6 落地）；核心型別 generic `Segment<T> = {id, start, end, ...T}`（多軌鋪路）。不變式：排序、不重疊、`start/end % TICK_MS === 0`、`end > start`、空隙 = 熄滅。`id = crypto.randomUUID()`
- [ ] `utils/segments/convert.js`：`keyframesToSegments` / `segmentsToKeyframes`，實作 D2（黑點上網格後丟棄；壓平在網格點熄滅）
- [ ] `utils/segments/core.js`（payload-agnostic，不 import 色彩）：不變式檢查、trim 碰撞、quantize、binary search、範圍查詢
- [ ] 測試：round-trip 冪等；全 fixture 跑 `buildPlayers(toKeyframes(toSegments(k)))` vs `buildPlayers(k)` **結構化 diff 全綠**（time 全同、僅漸變內部 ±1）
- **閘門**：全綠才准進 Phase 4。Ship：可（未接線的程式碼）。

### Phase 3 audioplayer 拆件 + 鍵盤統一（L / 中風險 / 可與 Phase 2 平行，內部逐元件 PR）

純搬移拆分（handler **原樣搬**，不改寫——Phase 5 才 segment 化）：

- [ ] `MusicSelector.jsx`、`PlayerControls.jsx`、`EffectMenu.jsx`、`ShiftTool.jsx`、`TrackToolbar.jsx`（吸收亮度 + `handleUniformSameColorAlphaChange`）、`CopyPasteManager`（Context，`isCopying` 不進 redux）、外殼 `AudioPlayer.jsx` — 狀態歸屬沿用 4 月版的表格（仍有效）
- [ ] **單一 `KeyboardManager`**：合併 **3 個** document keydown listener（audioplayer L385-556、ControlPanel L104 W/S/A/D、ControlPanel L430 Ctrl+Z/Y）為宣告式 keymap；動手前先做鍵位對照表（含更正 #2 的 M/P/B）；更新 `docs/shortcuts.md`
- [ ] Timeline.jsx 與 waveform.jsx 內部不動（留 Phase 5）
- **每 PR 驗收**：golden 測試 + 完整手動 checklist（見文末）。

### Phase 4 資料模型切換（M 規模 / **高風險** / 單一原子 PR，凍結其他合併）

- [ ] Redux `data.actionTable` 改存 segments；`UPDATEACTIONTABLE` + history 機制形狀不變（cap 50、skipHistory 保留）
- [ ] `withKeyframeAdapter` 包所有舊寫入者（audioplayer 各操作、Armor/AccessoryPanel 經 insertColorKeyframes、Timeline move/resize commit、EditActionTable）；memoized `selectKeyframes` 供舊渲染（Timeline 色塊、Armor 顯色、播放取樣）
- [ ] 三條載入路徑接 `utils/migration/loadProjectData.js`；persist key `root`→`root_v2` + 舊 key fallback（D4）；本地備份寫入帶 `schemaVersion: 2`
- [ ] 匯出：`handleOutput = buildPlayers(segmentsToKeyframes(segments))`；raw_data 存 v2。`sanitizeActionTableTimes` 從上傳路徑退役（量化改為寫入時不變式），只活在 v1 遷移內
- **驗收**：fixture 以 v1 載入 → 匯出 → 結構化 diff 全綠；完整手動 checklist；測舊瀏覽器情境（殘留舊 persist key）。**回滾**：revert deploy——舊 build 讀原 key；伺服器 v1 raw_data 永遠可載（lazy migrate）。

### Phase 5 逐項 segment 原生化（L / 中風險 / **Phase 4 後高度平行**，每項獨立 PR）

每項：改寫成 `utils/segments/*` 原生 → 拆該項 adapter → golden + checklist → ship。建議順序（讀取路徑與 DAW 核心優先）：

- [ ] **Timeline.jsx**：色塊直接由 segments 渲染（key = `seg.id`）；Move Mode commit（L109-283）與 resize commit（L649-760）改為單 segment 操作（`moveSegment`/`resizeSegment` + trim 碰撞）——「動一塊要同步改 2-N 個 keyframe + 鄰居黑點」邏輯死亡。**零 re-render 驗收**（見下方約束）
- [ ] **Armor.jsx / AccessoryPanel.jsx**：點擊 → `insertSegment(…, {duration: DEFAULT_SEGMENT_MS, collision: 'trim'})`；isPartAllowed 不動；顯色走 `getColorAt(segments, t)`
- [ ] **audioplayer 寫入者逐個**（現行行號）：colorChange L211、executeAdvancedPaste L312、insertFavoriteColorArray L578、handleFavoriteColorChoose L734、handleMultiDelete L805（`removeDuplicateBlackBlocks` L949 **直接刪除**，segment 世界無意義）、handleSetLinear L866、applyBlinkEffect L881（暫維持展開成 N 個 segment，metadata 化在 Phase 6）、handleCut L1104（單 segment split，漸變中點插值進 segment util）、handleWholePaste L1215、handleBrightnessChange L1279、**applyGradientEffect L1326**（「每隔 2 格 = 色+黑」寫死假設死亡，改為 per-segment 色/alpha ramp）、executeTimeShift L1387、handleUniformSameColorAlphaChange L1502
- [ ] **EditActionTable.jsx**：改編輯 segment 欄位；local useState history 併入 redux history（更正 #10 的殘餘項在此落地）
- [ ] **ControlPanel** W/S 導航 → 最近 segment；audioplayer handleGoLeft/Right 的 skip-black hack 死亡
- [ ] **最終清掃**：刪 `withKeyframeAdapter`、`selectKeyframes`、`utils/keyframe/insertColorKeyframes.js`、全部 5 處 `blackthreshold`、`ensureBlackBefore`。**`blackthreshold` / -10ms 自此在專案中不存在**

#### 零 re-render 拖曳路徑約束（Phase 5 Timeline PR 的硬性驗收）

- 手勢期間維持 direct-DOM（transform + rAF），**拖曳中零 React render**（React DevTools profiler 驗證）
- Commit = mouseup 時**恰好一次** dispatch；history 合併為一筆 undo（中間 dispatch 用 skipHistory）
- 穩定 `seg.id` key + 逐色塊 React.memo；segment 操作只對被改動的 (armor, part) 回傳新陣列，其餘結構共享，維持 memoized selector 有效

### Phase 6 新功能（M / 低中風險 / 逐功能平行）

- [ ] **Blink 改 metadata**（回應 4 月驗收回饋）：`seg.effect = {type:'blink', period}`（period 為 TICK_MS 倍數）；只在 `segmentsToKeyframes` 壓平與 `getColorAt` 預覽時展開；UI 維持單一可拖曳/選取色塊；B 鍵改為對選取設定 effect
- [ ] DAW 加強：框選（marquee）多選、多 segment 一起拖曳、snap/對齊節拍（core.js quantize）
- [ ] UI 小修（4 月版遺留）：timeline-settings-block 與 timeline 對齊/高度、lefttool-container 與 controls 按鈕縮小
- **Ship/回滾**：逐功能。

### Phase 7 多軌音訊（遠期，只記介面決策，不 block 燈光重構）

前面 Phase 已埋好的可能性，實作時不得反悔：

- `Segment<T>` generic core（Phase 2）；`utils/segments/core.js` 永不 import 色彩程式碼
- Timeline 手勢邏輯（Phase 5）做成可複用 hook
- raw_data 的 `schemaVersion` envelope 可長出 `tracks` 陣列，後端零改動
- Phase 3 拆件不得把單一 `sourceNode` 假設更深綁進新元件；多軌時 waveform 改寫為一個 AudioContext + N 個 AudioBufferSourceNode + 每軌 gain node

---

## ⚠️ 風險總覽

| Phase | 規模 | 風險 | Ship/回滾 | 平行性 |
|---|---|---|---|---|
| 0 測試 | S | 低 | 單 PR，trivial revert | —（block 一切） |
| 1 清理 | M | 低 | 4 個獨立 PR | ∥ P2 |
| 2 轉換器 | M | 中（概念） | 可 ship（未接線） | ∥ P1、P3 |
| 3 拆件 | L | 中（搬移期行為漂移） | 逐元件 | ∥ P2 |
| 4 切換 | M | **高**（持久化 + 全寫入者一次過橋） | 單一原子 PR；key bump 回滾 | **否**，凍結其他合併 |
| 5 原生化 | L | 中 | 逐寫入者 | 高 ∥ |
| 6 新功能 | M | 低中 | 逐功能 | 高 ∥ |

前三大風險與對策：
1. **漸變輸出差異的範圍失控**（短漸變誤差可達 ~15/255） → Phase 0 的結構化 diff 比對器把允許差異**類別**寫成硬斷言（非漸變欄位差異一律紅燈），幅度則用可設定閾值 + 實測統計，加入真實 fixture 後重新量測
2. **Phase 4 遷移吃掉某人未上傳的本地作品** → key bump + lazy migrate + IndexedDB 備份維持 v1 可讀
3. **Phase 3 純搬移期間行為漂移** → 每拆一個元件跑 golden + 手動 checklist

---

## ✅ 手動驗收 checklist（每個 Phase 的每個 PR 都跑）

- [ ] 點光衣放色 → 時間軸顯示色塊（Phase 5 起：預設 1 秒）
- [ ] M 鍵 Move Mode 拖曳移動色塊；拖曳邊緣 resize
- [ ] click 選色塊、shift+click 多選
- [ ] Ctrl+C / Ctrl+V 區間複製貼上；Ctrl+Shift+V 固定時間貼上
- [ ] Shift+C / Shift+V 整條複製貼上
- [ ] L 鍵切漸變，預覽看到漸變
- [ ] B 鍵頻閃（輸入 50ms 倍數週期）
- [ ] P 鍵改色；1-8 最愛色；Shift+1-8 插入最愛色；Ctrl+數字 改亮度
- [ ] Shift 工具三步驟平移
- [ ] C 鍵 Cut / Del 刪除
- [ ] W/S/A/D 跨軌跳格
- [ ] Ctrl+Z / Ctrl+Y
- [ ] 飾品（雨傘/武器）部位可編輯、isPartAllowed 閘門正常
- [ ] Output 上傳成功；golden 測試全綠（Phase 2 起：結構化 diff 全綠）
- [ ] 重新整理後 redux-persist 復原正常；本地備份可載入
