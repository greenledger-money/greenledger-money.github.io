# 記帳 App

免費、多人可用的記帳網頁 app（PWA），功能對標 CWMoney，另外補上 CW 做不到的部分。iPhone 用 Safari 打開網址、按「加入主畫面」就能當 app 用，不上 App Store。

- **前端**：React 19，用 Bun 打包，部署在 GitHub Pages
- **資料庫與登入**：Supabase（Postgres＋Auth），Email 註冊，可以綁定 Passkey（Face ID）
- **每日資料**：GitHub Actions 每天抓台股收盤價、台銀匯率

## 補上 CW 的缺點

| CW 的問題 | 這個 app 的做法 | 程式在哪 |
|---|---|---|
| 分類只有兩層 | 每個分類可以 1–3 層，資料庫觸發器保證規則 | `check_category_tree()`、`src/lib/categories.js` |
| 沒有外幣 | 外幣帳戶，記帳時自動帶當天（或最近一天）匯率，可以手動改 | `src/lib/fx.js`、`EntrySheet.jsx` |
| 分帳一定有一邊錯 | 「朋友欠我」帳戶：自己的部分記支出，其餘轉進朋友欠我 | `buildSplit()` in `src/lib/ledger.js` |
| 股票只能手動記損益 | 成交、FIFO 成本、交割日自動扣款、每日股價 | `src/lib/stocks.js`、`scripts/update-market-data.mjs` |
| 對帳有說不出原因的差額 | 餘額不存，每次從「期初＋所有交易」重算 | `computeBalances()` |

---

## 部署步驟（第一次，約 20 分鐘）

### 1. Supabase

1. 到 [supabase.com](https://supabase.com) 建一個專案（免費方案即可，區域選東京或新加坡）。
2. 左邊 **SQL Editor** → New query → 把 `supabase/migrations/20261124000000_init.sql` 整個貼上 → **Run**。
3. **Authentication › URL Configuration**
   - Site URL：`https://你的帳號.github.io/repo名稱/`
   - Redirect URLs：加上同一個網址
4. **Authentication › Passkeys**（beta）：打開
   - Relying Party ID：`你的帳號.github.io`（不要加 https 或路徑；之後改了舊的 passkey 會失效）
   - Origins：`https://你的帳號.github.io`
5. **Project Settings › API Keys**：記下
   - `publishable key`（`sb_publishable_…`）→ 前端用，可以公開
   - `secret key`（`sb_secret_…`）→ **只放 GitHub Secrets**，它能略過所有權限

### 2. GitHub

1. 建一個 repo，把這個資料夾的檔案放上去（`node_modules/`、`dist/` 不用）。
2. **Settings › Secrets and variables › Actions**
   - **Variables**：`SUPABASE_URL`（例如 `https://abcd1234.supabase.co`）、`SUPABASE_PUBLISHABLE_KEY`、`APP_NAME`（選填，app 名稱還沒決定前預設「記帳」）
   - **Secrets**：`SUPABASE_SECRET_KEY`
3. **Settings › Pages** › Source 選 **GitHub Actions**。
4. push 到 `main`，**Actions** 會跑「部署到 GitHub Pages」：先跑測試、打包、產生 `config.js`，然後部署。完成後網址會顯示在 Actions 的結果裡。
5. **Actions › 每日更新股價與匯率 › Run workflow**：第一次手動跑；要從 CW 搬外幣帳戶的話，`fx_from` 填 `2023-10-29` 補抓歷史匯率。

### 3. iPhone

1. Safari 打開網址 → 註冊 → 點 Email 裡的驗證連結 → 回來登入。
2. 分享 › **加入主畫面**。從主畫面打開後要再登入一次（iOS 的主畫面 app 和 Safari 是分開的）。
3. **設定 › 綁定 Passkey**，之後用 Face ID 登入。

### 4. 從 CW 搬家

1. CW 重新匯出最新的 CSV。
2. app 裡 **更多 › 從 CWMoney 匯入**：選檔 → 填每個帳戶在 CW 的目前餘額、類型、幣別 → 選代墊類分類（借錢 → 朋友欠我）→ 主分類改名（「繳費（公」會自動改成「繳費/訂閱」）→ 匯入。
3. **股票 › 期初持股**：輸入目前股數＋均價（CW 只有損益，沒有買賣明細）。

> 用真實的 CW 匯出檔測過，可以完整匯入、沒有警告。CW 裡如果有預先記的未來帳，也會一起匯入，匯入後記得確認有沒有真的發生。CW 舊的股票損益分類會照原樣匯入當歷史紀錄。

> 沒設定 Supabase 的網址會自動變成「試用模式」：資料存在瀏覽器，附一年份範例資料，可以先玩。

---

## 看懂程式：從這裡開始讀

```
supabase/
  migrations/20261124000000_init.sql   ← 資料表、規則、權限（先讀這個）
  tests/db_test.sql                    ← 54 項資料庫測試，每項都是一條規則的例子
src/
  lib/          ← 純計算，不碰畫面也不碰網路（最好懂，也都有測試）
    ledger.js     餘額、月收支、分類占比、淨資產、分帳
    categories.js 分類樹（路徑名稱、三層規則）
    recurring.js  固定收支的第 k 次日期（月底不漂移）
    stocks.js     FIFO、持股市值、已實現損益、手續費估算
    cwimport.js   CW CSV 解析、三行一組轉帳還原
    fx.js / dates.js / money.js / calc.js / csv.js / defaults.js
  data/
    supabase.js   正式模式：所有讀寫都經過這裡
    local.js      試用模式：模擬同樣的資料庫規則，存在 localStorage
    relations.js  刪除時誰會被擋住、誰會一起刪（跟資料庫外鍵一致）
    sample.js     試用模式的範例資料
  store.jsx     ← 資料中心：載入、算出餘額與持股、所有「寫入」動作
  ui/           共用元件：記帳表單（EntrySheet）、圖表、清單、選分類
  pages/        每個畫面一個檔案
  App.jsx       選後端、登入狀態、頁面切換
tests/          bun test：核心邏輯 35 項＋股價匯率解析 3 項
scripts/        build.mjs（打包）、dev.mjs（本機開發）、update-market-data.mjs（每日更新）
```

**資料怎麼流動**：畫面呼叫 `useLedger()` 拿到 `data`（已經算好的餘額、持股…）和 `actions`（saveTxn、saveTrade…）。`actions` 呼叫後端寫入，成功後更新畫面上的資料，`data` 會自動重算。

**建議閱讀順序**：`init.sql` → `tests/logic.test.js`（看每條規則的例子）→ `src/lib/ledger.js` → `src/store.jsx` → `src/ui/EntrySheet.jsx`。

### 幾個重要的設計

- **權限在資料庫**：每張個人資料表開 Row Level Security，只能讀寫 `user_id = 自己`；外鍵用 `(id, user_id)` 兩欄一起對，所以交易只能掛在自己的帳戶、分類底下。前端被改掉也偷不到別人的資料。
- **餘額不存**：`opening_balance` ＋ 所有交易即時加總。改了三年前的帳，今天的餘額自動正確。
- **同一筆不能確認兩次**：交易表的 `pending_item_id` 是 unique，而且觸發器只會把「待確認」狀態的項目改成「已確認」。
- **轉帳手續費**：拆成一筆「其他支出-手續費」，`parent_id` 指向轉帳，刪轉帳時資料庫一起刪。
- **股票交割**：成交後產生一筆「交割戶 → 證券戶」的轉帳，日期是交割日，所以不算月收支；淨資產在成交日就把待交割款算進去，不會重複計算。
- **股票損益算進月收支（CW 記法，自動算）**：賣出後在交割日記兩筆：轉帳「證券戶 → 交割戶」＝FIFO 成本，另一筆記在交割戶，賺的記收入「投資收入-股票獲利」、賠的記支出「其他支出-股票虧損」。兩筆加起來＝實際拿回的錢。每次開 app 或改成交都會重算，改了以前的買進價，兩筆金額一起更新（`realizedTxnPlan()`）。股票頁只顯示還持有的股票；已賣出的獲益到報表或明細查。
- **設定**：外觀、記帳預設（帳戶、分類、要不要自動跳計算機）、首頁顯示項目、報表預設、股票估算參數（手續費折扣與最低、交割天數、美股預扣稅率、預設交割戶）。存在 `profiles.settings`，換裝置也會跟著。
- **台幣顯示**：合計、換算後的台幣一律顯示整數；單筆交易有角分才顯示小數。

---

## 本機開發

需要 [Bun](https://bun.sh)。

```bash
bun install
bun run dev        # http://localhost:5173，改檔案會自動重新打包
bun test           # 核心邏輯測試
bun run build      # 打包到 dist/（正式版）和 dist-demo/（單一 HTML 試用版）
```

資料庫測試需要 Postgres 15 以上（會模擬 Supabase 的 auth）：

```bash
PGHOST=localhost PGUSER=postgres bun run test:db
```

本機要連 Supabase：改 `public/config.js` 的 `supabaseUrl`、`supabasePublishableKey`（也要把 `http://localhost:5173` 加進 Supabase 的 Redirect URLs）。

---

## 目前狀態

**完成**：資料庫結構（54 項測試通過）、全部畫面（首頁、帳戶、記帳、明細、報表、股票、範本、固定收支、待確認、分類、CW 匯入、匯出 CSV、設定、隱私權政策、刪除帳號）、PWA、部署與每日更新的 GitHub Actions。

**還沒在真的環境跑過**（開發環境連不到外部網路）：
- 連真正的 Supabase 專案（`src/data/supabase.js`）與 Passkey
- `update-market-data.mjs` 呼叫 TWSE／TPEx／台銀（解析器有用樣本測過）
- 兩個 GitHub Actions workflow

**沒做（規格寫第二階段或待決定）**：
- Gmail 查帳機器人寫入 Supabase、複委託對帳單解析（缺 PDF 樣本）。資料庫已預留：機器人用 secret key 寫 `pending_items`，`source='broker'`、`dedupe_key=委託書號`，`payload` 放成交欄位（`brokerage_account_id, market, symbol, name, kind, side, trade_date, settle_date, shares, price, fee, tax, currency, settlement_account_id, order_no`），使用者在 app 裡確認。
- 美股股價自動來源（先在股票頁手動輸入）
- 離線記帳（第一版沒網路只能看快取）

**已決定**：賣股已實現損益算進月收支，記在交割戶；股票頁不顯示已實現獲益（2026/11/25）。

**待決定**：美股股價來源、app 名稱、超過 100 人時是否做 Google 驗證。
