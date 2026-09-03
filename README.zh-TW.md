# Jewel

**新一代輕量化 Git to Docker 部署工具**

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

---

## 簡介

Jewel 是一個輕量級的 Git 到 Docker 整合部署平台，靈感來源於 Dokploy 和 Portainer。它可以幫助你快速將 Git 倉庫中的專案透過 Docker Compose 進行構建和部署。

### 核心功能

- **Git 倉庫整合** — 支援 GitHub / GitLab Token 登入，一鍵選擇倉庫
- **Docker Compose 部署** — 自動複製倉庫、構建容器、部署服務
- **容器管理面板** — 類 Portainer 的容器管理，查看狀態、日誌、資源佔用
- **環境變數管理** — 視覺化編輯專案環境變數
- **自動更新部署** — 可為每個專案啟用定期 Commit 檢查，偵測到新 Commit 後自動拉取並重新部署
- **自我更新** — 偵測到倉庫新版本後提示更新，確認後自動拉取部署
- **多語言支援** — 簡體中文 / 繁體中文 / English / 日本語

### 設計理念

- 黑白灰三色極簡配色
- 零前端構建依賴，原生 HTML/CSS/JS
- 單行程式架構，SQLite 嵌入式資料庫
- 最小化資源佔用

---

## 界面展示

<table>
  <tr>
    <td width="50%"><img src="https://github.com/LYOfficial/Jewel/blob/main/img/1.png?raw=true" alt="screenshot 1"></td>
    <td width="50%"><img src="https://github.com/LYOfficial/Jewel/blob/main/img/2.png?raw=true" alt="screenshot 2"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://github.com/LYOfficial/Jewel/blob/main/img/3.png?raw=true" alt="screenshot 3"></td>
    <td width="50%"><img src="https://github.com/LYOfficial/Jewel/blob/main/img/4.png?raw=true" alt="screenshot 4"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://github.com/LYOfficial/Jewel/blob/main/img/5.png?raw=true" alt="screenshot 5"></td>
    <td width="50%"><img src="https://github.com/LYOfficial/Jewel/blob/main/img/6.png?raw=true" alt="screenshot 6"></td>
  </tr>
</table>

---

## 快速開始

### 標準 Docker 部署（推薦）

宿主機需要 Docker 與 Git。建議先下載並檢查安裝腳本，再執行：

```bash
curl -fsSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh -o install.sh
chmod +x install.sh
sudo ./install.sh
```

自訂宿主機連接埠可執行 `sudo ./install.sh 8080`。安裝器會先建置候選映像，再停止目前服務；升級時會保留 `/data` 掛載、連接埠與 JWT 密鑰。若新容器未能在 30 秒內就緒，會自動還原舊容器。

安裝完成後訪問 `http://localhost:330`，或使用指定的自訂連接埠。

### Docker Compose（進階 / 手動維護）

```bash
git clone https://github.com/LYOfficial/Jewel.git
cd Jewel
export JEWEL_COMMIT="$(git rev-parse HEAD)"
export JWT_SECRET="$(openssl rand -hex 32)"
docker compose up -d --build
```

Compose 部署建議使用 `git pull` 與 `docker compose up -d --build` 手動升級。若觸發 Jewel 內部更新，第一次更新後會交由標準獨立安裝器管理。

### 本地執行

需要 Node.js 20+ 和 Docker。

```bash
git clone https://github.com/LYOfficial/Jewel.git
cd Jewel
npm install
npm start
```

---

## 預設帳戶

| 項目 | 值 |
|------|-----|
| 使用者名稱 | `admin` |
| 密碼 | `adminwithjewel` |

**首次登入必須修改密碼。**

---

## 連接埠

預設連接埠：`330`，可透過環境變數 `PORT` 修改。

---

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `PORT` | `330` | 服務連接埠 |
| `DATA_DIR` | `./data` | 資料儲存目錄 |
| `JWT_SECRET` | 標準安裝器自動產生 | 直接執行 Node.js 時必須自行設定；安裝器升級會沿用既有值 |
| `NODE_ENV` | `development` | 執行環境 |

---

## 自我更新

Jewel 會定期檢查 GitHub 倉庫是否有新的提交。當偵測到新版本時，會在左下角顯示更新提示。點擊確認後，Jewel 將自動拉取最新程式碼、構建新映像並重啟容器。

內部更新會重用標準 `install.sh`：目前服務在線時先拉取程式碼並建置候選映像，建置成功後才切換容器並執行就緒檢查；失敗時會自動回滾，並保留原本的 `/data` 掛載、連接埠與 JWT 密鑰。希望繼續由 Compose 管理生命週期的使用者應採用手動升級。

> 與其他專案不同，Jewel 不會自動更新，需要使用者手動確認。

---

## 技術棧

- **後端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript（無構建步驟）
- **資料庫**: SQLite (better-sqlite3)
- **Docker**: dockerode + docker-cli
- **Git**: simple-git

---

## 授權條款

MIT License

---

<p align="center">Made with ♥ by <a href="https://github.com/LYOfficial">LYOfficial</a></p>
