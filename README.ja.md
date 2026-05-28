# Jewel

**次世代軽量 Git to Docker デプロイツール**

[简体中文](README.md) | [繁體中文](README.zh-TW.md) | [English](README.en.md)

---

## 概要

Jewel は Dokploy と Portainer にインスパイアされた軽量な Git to Docker デプロイプラットフォームです。Git リポジトリのプロジェクトを Docker Compose で素早くビルド・デプロイできます。

### 機能

- **Git 連携** — GitHub / GitLab トークン対応、ワンクリックでリポジトリ選択
- **Docker Compose デプロイ** — 自動クローン、ビルド、コンテナデプロイ
- **コンテナ管理** — Portainer ライクな管理パネル、ステータス・ログ・リソース監視
- **環境変数管理** — ビジュアルエディタで環境変数を編集
- **自動デプロイ** — Webhook で Git Push 時に自動デプロイ
- **自己更新** — 新バージョンを検知して更新プロンプトを表示
- **多言語対応** — 簡体字中国語 / 繁体字中国語 / English / 日本語

### デザイン哲学

- 白黒グレーのミニマルカラースキーム
- フロントエンドビルド不要 — ネイティブ HTML/CSS/JS
- 単一プロセスアーキテクチャ、組み込み SQLite
- 最小リソース消費

---

## クイックスタート

### Docker デプロイ（推奨）

```bash
git clone https://github.com/LYOfficial/Jewel.git
cd Jewel
export JEWEL_COMMIT=$(git rev-parse HEAD)
docker compose up -d --build
```

`http://localhost:330` にアクセスして開始します。

> `JEWEL_COMMIT` はバージョン検出に使用され、Jewel が現在のバージョンを認識し、新しいコミットがプッシュされたときに更新を促すことができます。

### ローカル実行

Node.js 20+ と Docker が必要です。

```bash
git clone https://github.com/LYOfficial/Jewel.git
cd Jewel
npm install
npm start
```

---

## デフォルトアカウント

| 項目 | 値 |
|------|-----|
| ユーザー名 | `admin` |
| パスワード | `adminwithjewel` |

**初回ログイン時にパスワードの変更が必須です。**

---

## ポート

デフォルト：`330`。環境変数 `PORT` で変更可能。

---

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `PORT` | `330` | サービスポート |
| `DATA_DIR` | `./data` | データ保存ディレクトリ |
| `JWT_SECRET` | `jewel-secret-change-in-production` | JWT シークレット（本番環境では変更必須） |
| `NODE_ENV` | `development` | 実行環境 |

---

## 自己更新

Jewel は定期的に GitHub リポジトリの新しいコミットを確認します。新バージョンが検出されると、左下に更新バナーが表示されます。ユーザーが確認すると、Jewel は最新のコードを自動的にプルして再デプロイします。

> 他のツールとは異なり、Jewel は自動更新せず、手動確認が必要です。

---

## 技術スタック

- **バックエンド**: Node.js + Express
- **フロントエンド**: ネイティブ HTML/CSS/JavaScript（ビルド不要）
- **データベース**: SQLite (better-sqlite3)
- **Docker**: dockerode + docker-cli
- **Git**: simple-git

---

## ライセンス

MIT License

---

<p align="center">Made with ♥ by <a href="https://github.com/LYOfficial">LYOfficial</a></p>
