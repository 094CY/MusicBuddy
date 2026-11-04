# MusicBuddy

一个可以自己部署、自己接入 AI 服务的音乐播放与推荐应用。代码开放，供下载学习与研究，也欢迎在此基础上做二次开发。

**用途限制**：本项目仅供个人学习、研究与非商业性技术交流，**禁止任何商业用途**。项目不提供、不托管、不分发任何音乐文件；所有音乐内容与第三方服务均由使用者自行准备并自行承担合规责任。

---

## 它能做什么

- **聚合搜索**：一次检索多个公开音源，结果跨平台去重，优先展示可播放版本
- **AI 电台**：按场景预设或自由描述生成推荐，播放到队列末尾自动续流，跨会话记住已推荐过的歌
- **AI 助手**：多轮对话聊音乐，回复里可直接点按钮播放或重新推荐
- **偏好记忆**：从收藏、跳过、对话中自动整理音乐偏好，用于后续推荐
- **DJ 语音播报**：切歌时生成一段解说并合成语音，可随时关闭
- **播放器基础能力**：播放队列、三种循环模式、歌词与双语译文、收藏、历史、深浅主题、横竖双布局、桌面后台播放
- **桌面快捷键与命令面板**：空格播放/暂停、`←→` 快进退、`L` 收藏、`⌘K` 打开命令面板、`⌘Z` 撤销清空

AI 与语音能力都是**可选**的。不配置任何外部服务时，搜索与播放仍可正常使用，AI 相关功能会自动关闭。

---

## 快速开始

### Web 版（推荐，最简单）

macOS 直接双击项目根目录的 `start-web.command`。脚本会自动检查依赖、构建、启动服务并打开浏览器，地址是 `http://localhost:3721`。按 `Ctrl+C` 停止。

其他系统或命令行：

```bash
npm install
npm run install:all      # 安装前后端依赖，首次执行
npm run web              # 构建前后端并启动，浏览器打开 http://localhost:3721
```

已经构建过、只想再次启动：

```bash
npm run web:quick
```

桌面版正在运行时会占用同一端口，脚本会检测到并直接打开页面，不会重复启动。

### 桌面版

```bash
npm install
npm run install:all
npm run electron:pack    # 产物在 release/mac-arm64/MusicBuddy.app
```

开发调试可用 `npm run dev`（前端热更新 + 后端）或 `npm run electron:dev`。

---

## 配置

配置**不绑定任何 AI 或语音服务商**。只要接口兼容 OpenAI 的 `/chat/completions` 与 `/audio/speech` 约定，自建服务、本地模型或其他兼容服务都可以接入。

### 可视化设置（推荐）

界面右上角齿轮，或按 `⌘,` / 在 `⌘K` 命令面板里选「打开设置」。可直接在界面里修改并即时生效，不需要改代码或重新打包：

- AI 服务地址、模型名、密钥；语音接入方式、地址、模型、音色、密钥
- 主题（深色 / 浅色 / 跟随系统）、启用的音源、每平台搜索条数
- DJ 播报、翻译歌词、歌词区显隐
- 个人数据导出 / 导入、恢复默认偏好
- 快捷键一览

服务端配置写入本机用户数据目录（权限 `600`），密钥不会回显、不会上传、不进代码仓库；前端偏好保存在本机浏览器存储。

### 环境变量（可选）

也可以用配置文件，复制模板后按需填写：

```bash
cp .env.example .env
```

| 变量 | 说明 | 必需 |
|------|------|------|
| `LLM_API_KEY` | 大语言模型接口密钥 | 使用 AI 功能时必需 |
| `LLM_BASE_URL` | 大语言模型接口地址 | 使用 AI 功能时必需 |
| `LLM_MODEL` | 模型名；留空会自动从 `/models` 探测 | 否 |
| `TTS_PROVIDER` | `openai-compatible`（默认）/ `sdk` / `none` | 否 |
| `TTS_API_KEY` / `TTS_BASE_URL` | 语音接口凭据与地址 | 使用 DJ 播报时必需 |
| `TTS_MODEL` / `TTS_VOICE` | 语音模型与音色 | 否 |
| `BACKEND_PORT` | 服务端口，默认 `3721` | 否 |
| `ACCESS_PASSWORD` | 公网部署时的访问密码；留空不启用 | 否 |
| `ALLOWED_ORIGINS` / `TRUSTED_PROXY` | CORS 白名单、可信反代 | 否 |

按任务使用不同模型可设 `LLM_MODEL_RECOMMEND`、`LLM_MODEL_CHAT`、`LLM_MODEL_DJ`、`LLM_MODEL_EXTRACT`。完整说明与可选变量见 `.env.example`。

**密钥安全**：`.env` 与运行时数据均被 `.gitignore` 排除，不进入构建产物。桌面版会把配置放在用户数据目录（权限 `600`）而不是应用包内。任何时候都不要把真实密钥写进代码或提交到仓库。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React、TypeScript、Vite、Tailwind CSS、Zustand、Lucide Icons |
| 后端 | Express、TypeScript |
| 桌面 | Electron、electron-builder |
| 外部服务 | 任意兼容 OpenAI 接口约定的 LLM 与 TTS（可选） |

---

## 目录结构

```
musicbuddy/
├── frontend/          前端源码（React）
│   ├── src/           页面、组件、状态、类型、配置
│   └── public/        图标、PWA 清单、Service Worker
├── backend/           后端源码（Express）
│   ├── src/routes/    音源、AI、语音接口
│   └── src/config/    外部服务配置
├── electron/          桌面壳主进程与预加载脚本
├── start-web.command  Web 版一键启动
├── .env.example       配置模板
└── package.json       构建入口
```

`node_modules/`、`*/dist/`、`release/` 为构建产物或依赖，不纳入版本管理。

---

## 常用命令

| 入口 | 作用 |
|------|------|
| 界面右上角齿轮 / `⌘,` | 打开设置面板 |
| `⌘K` | 命令面板（检索本地库、全网搜索、数据导入导出） |

| 命令 | 作用 |
|------|------|
| `npm run install:all` | 安装前后端依赖 |
| `npm run dev` | 开发模式（前端热更新 + 后端） |
| `npm run build:all` | 构建前端与后端 |
| `npm run web` | 构建并启动 Web 版 |
| `npm run web:quick` | 直接启动已构建的 Web 版 |
| `npm run electron:dev` | Electron 开发模式 |
| `npm run electron:pack` | 打包 macOS 桌面应用 |

---

## 说明与限制

- 音源来自第三方公开接口，可用性不由本项目保证；单个音源不可用时会自动降级并提示
- 部分歌曲受平台付费限制，可能无法取得播放链接
- 桌面版目前仅构建 macOS arm64
- 项目不提供音乐内容，不含任何密钥，也不含用户数据

---

## 许可

仅供学习、研究与非商业性使用，禁止商用。详见仓库根目录的 `LICENSE` 与 `NOTICE`。
