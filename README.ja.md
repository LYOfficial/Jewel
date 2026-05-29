# Jewel

**次世代軽量 Git to Docker デプロイツール**

[简体中文](README.md) | [繁體中文](README.zh-TW.md) | [English](README.en.md)

---

## スクリーンショット

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

ワンコマンドインストール、docker-compose 不要：

```bash
curl -sSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh | sh
```

カスタムポート：

```bash
# スクリプトをダウンロード
curl -sSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh -o install.sh
chmod +x install.sh
# ポートを指定してインストール
./install.sh 8080
```

`http://localhost:330` にアクセスして開始します。

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

Jewel は定期的に GitHub リポジトリの新しいコミットを確認します。新バージョンが検出されると、左下に更新バナーが表示されます。ユーザーが確認すると、Jewel は最新のコードをプルし、新しいイメージをビルドしてコンテナを再起動します。

更新は2段階の仕組みを採用しています：まず新しいイメージをビルドし、完了すると再起動ボタンが表示されます。ボタンをクリックすると、現在のコンテナが新しいイメージに置き換えられます。`install.sh` でも `docker compose` でもデプロイした場合でも、自己更新が正常に機能します。

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
