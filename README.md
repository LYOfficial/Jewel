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
- **可复制部署诊断** — 记录克隆、部署、重构与备份操作，失败时一键复制已脱敏的 AI 诊断报告
- **挂载卷备份** — 可选择命名卷和卷内目录，备份期间暂停项目，打包上传后自动恢复
- **多存储目标** — 支持 Cloudflare R2、OneDrive、百度网盘、AnyShare 与本地 / NAS 目录
- **自我更新** — 检测到仓库新版本后提示更新，确认后自动拉取部署
- **多语言支持** — 简体中文 / 繁體中文 / English / 日本語

### 设计理念

- Win11 Fluent / Codex / VSCode 风格的黑白极简工作台
- 零前端构建依赖，原生 HTML/CSS/JS
- 单进程架构，SQLite 嵌入式数据库
- 最小化资源占用

---

## 界面展示

当前界面已统一为 Win11 Fluent / Codex / VSCode 风格工作台，项目、容器、镜像、令牌与备份资源采用一致的卡片、表格和下拉操作菜单。旧版截图已移除，避免与实际界面不一致。

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

运行检查：

```bash
npm test
npm run check
```

---

## 挂载卷备份

在侧栏打开「备份中心」后：

1. 新增一个存储目标；
2. 新建备份计划并选择项目；
3. 选择项目关联的 Docker 命名卷；
4. 每个卷可填写 `/` 备份全部内容，或填写逗号分隔的子目录；
5. 手动执行，或设置按小时周期自动执行。

每个计划还可以设置“本地缓存保留批次”（默认 3 批）。远端上传记录与任务日志会保留，但超出数量的本地暂存归档会自动清理，避免长期运行后填满 Jewel 数据盘；设置为 `0` 可在上传完成后立即清理暂存文件。

默认启用「一致性暂停」：Jewel 只暂停该 Compose 项目中原本处于运行状态的容器，完成打包和上传后再恢复这些容器。原本已停止或已暂停的容器不会被错误启动。暂停记录会逐容器持久化；如果 Jewel 或宿主机在备份中重启，启动后会先恢复被中断的容器和项目状态，Docker 暂时不可用时则每分钟自动重试。

| 存储类型 | 实现方式 | 配置说明 |
|------|------|------|
| Cloudflare R2 | rclone S3 兼容模式 | Endpoint、Bucket、Access Key ID、Secret Access Key |
| OneDrive | rclone | 可使用已有 remote，或填写 rclone Token JSON 与 Drive 信息 |
| 百度网盘 | bypy | 首次授权信息保存在指定配置目录 |
| AnyShare | anyshare-unofficial | 使用允许上传的公开分享链接，可指定已存在的远端目录 |
| 本地 / NAS | 文件复制 | 指向 Jewel 容器内可写目录，NAS 可通过额外挂载接入 |

Docker 镜像已经包含 `rclone`、`bypy` 和 `anyshare-unofficial`。存储目标的「连接检查」会执行只读远端访问，而不只是检查命令是否安装。备份任务、阶段日志、归档大小和失败诊断会保存在 SQLite 与 `DATA_DIR/backups` 中。

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
| `DOCKER_READ_TIMEOUT_MS` | `8000` | 项目资源与日志等只读 Docker 请求的超时时间 |
| `BACKUP_HELPER_IMAGE` | `busybox:1.36` | 挂载卷只读打包所使用的辅助镜像 |

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
