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
- **自動部署** — 支援設定 Webhook，Git Push 後自動拉取構建
- **自我更新** — 偵測到倉庫新版本後提示更新，確認後自動拉取部署
- **多語言支援** — 簡體中文 / 繁體中文 / English / 日本語

### 設計理念

- 黑白灰三色極簡配色
- 零前端構建依賴，原生 HTML/CSS/JS
- 單行程式架構，SQLite 嵌入式資料庫
- 最小化資源佔用

---

## 快速開始

### Docker 部署（推薦）

```bash
git clone https://github.com/LYOfficial/Jewel.git
cd Jewel
export JEWEL_COMMIT=$(git rev-parse HEAD)
docker compose up -d --build
```

訪問 `http://localhost:330` 即可使用。

> `JEWEL_COMMIT` 用於版本偵測，讓 Jewel 能識別當前版本並在有新提交時提示更新。

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
| `JWT_SECRET` | `jewel-secret-change-in-production` | JWT 密鑰（正式環境務必修改） |
| `NODE_ENV` | `development` | 執行環境 |

---

## 自我更新

Jewel 會定期檢查 GitHub 倉庫是否有新的提交。當偵測到新版本時，會在左下角顯示更新提示。點擊確認後，Jewel 將自動拉取最新程式碼並重新構建部署。

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
