# Jewel

**新一代轻量化 Git to Docker 部署工具**

[繁體中文](README.zh-TW.md) | [English](README.en.md) | [日本語](README.ja.md)

---

## 简介

Jewel 是一个轻量级的 Git 到 Docker 集成部署平台，灵感来源于 Dokploy 和 Portainer。它可以帮助你快速将 Git 仓库中的项目通过 Docker Compose 进行构建和部署。

### 核心功能

- **Git 仓库集成** — 支持 GitHub / GitLab Token 登录，一键选择仓库
- **Docker Compose 部署** — 自动克隆仓库、构建容器、部署服务
- **容器管理面板** — 类 Portainer 的容器管理，查看状态、日志、资源占用
- **环境变量管理** — 可视化编辑项目环境变量
- **自动部署** — 支持配置 Webhook，Git Push 后自动拉取构建
- **自我更新** — 检测到仓库新版本后提示更新，确认后自动拉取部署
- **多语言支持** — 简体中文 / 繁體中文 / English / 日本語

### 设计理念

- 黑白灰三色极简配色
- 零前端构建依赖，原生 HTML/CSS/JS
- 单进程架构，SQLite 嵌入式数据库
- 最小化资源占用

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

## 快速开始

### Docker 部署（推荐）

一键安装，无需 docker compose：

```bash
curl -sSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh | sh
```

自定义端口：

```bash
# 先下载脚本
curl -sSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh -o install.sh
chmod +x install.sh
# 指定端口安装
./install.sh 8080
```

访问 `http://localhost:330` 即可使用。

### 本地运行

需要 Node.js 20+ 和 Docker。

```bash
git clone https://github.com/LYOfficial/Jewel.git
cd Jewel
npm install
npm start
```

---

## 默认账户

| 项目 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | `adminwithjewel` |

**首次登录必须修改密码。**

---

## 端口

默认端口：`330`，可通过环境变量 `PORT` 修改。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `330` | 服务端口 |
| `DATA_DIR` | `./data` | 数据存储目录 |
| `JWT_SECRET` | `jewel-secret-change-in-production` | JWT 密钥（生产环境务必修改） |
| `NODE_ENV` | `development` | 运行环境 |

---

## 自我更新

Jewel 会定期检查 GitHub 仓库是否有新的提交。当检测到新版本时，会在左下角显示更新提示。点击确认后，Jewel 将自动拉取最新代码、构建新镜像并重启容器。

更新采用两阶段机制：先构建新镜像，完成后弹窗提示重启，点击重启按钮即可用新镜像替换当前容器。无论使用 `install.sh` 还是 `docker compose` 部署，均可正常自我更新。

> 与其他项目不同，Jewel 不会自动更新，需要用户手动确认。

---

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript（无构建步骤）
- **数据库**: SQLite (better-sqlite3)
- **Docker**: dockerode + docker-cli
- **Git**: simple-git

---

## 许可证

MIT License

---

<p align="center">Made with ♥ by <a href="https://github.com/LYOfficial">LYOfficial</a></p>
