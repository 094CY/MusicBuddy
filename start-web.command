#!/bin/bash
# MusicBuddy Web 版一键启动（macOS 双击即可运行）
# 作用：按需安装依赖与构建 → 启动服务（页面 + API 同一端口）→ 打开浏览器
# 停止：在本窗口按 Ctrl+C

set -u
cd "$(dirname "$0")" || exit 1

PORT="${BACKEND_PORT:-3721}"
URL="http://localhost:${PORT}"

echo "────────────────────────────────────────────"
echo "  MusicBuddy · Web 版"
echo "────────────────────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js 18 或更高版本。"
  read -r -p "按回车键关闭窗口…" _
  exit 1
fi

# 端口被占用时，必须同时确认「页面」也能正常返回，否则不能复用。
# 桌面版旧进程可能只提供 API 而不托管页面，直接复用会导致 Cannot GET /。
page_ok() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:${PORT}/" 2>/dev/null || true)
  [ "$code" = "200" ]
}

if curl -s --max-time 2 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  if page_ok; then
    echo "检测到服务已在运行且页面可用，直接打开。"
    open "$URL" 2>/dev/null || true
    echo "地址：$URL"
    read -r -p "按回车键关闭窗口…" _
    exit 0
  fi
  echo "检测到 ${PORT} 端口上有旧进程，但它不提供页面（可能是不带页面托管的桌面版后端）。"
  echo "请先退出 MusicBuddy 桌面版，或在终端执行："
  echo "  lsof -ti:${PORT} | xargs kill"
  echo "然后重新双击本文件。"
  read -r -p "按回车键关闭窗口…" _
  exit 1
fi

# 依赖检查
NEED_INSTALL=0
for d in node_modules frontend/node_modules backend/node_modules; do
  [ -d "$d" ] || NEED_INSTALL=1
done
if [ "$NEED_INSTALL" -eq 1 ]; then
  echo "首次运行，正在安装依赖（约需 1-3 分钟）…"
  npm install --no-audit --no-fund || { echo "依赖安装失败"; read -r -p "按回车键关闭…" _; exit 1; }
  npm run install:all --no-audit --no-fund || { echo "依赖安装失败"; read -r -p "按回车键关闭…" _; exit 1; }
fi

echo "正在构建页面与服务端…"
npm run build:all || { echo "构建失败，请根据上方错误信息修复后重试"; read -r -p "按回车键关闭…" _; exit 1; }

if [ ! -f "frontend/dist/index.html" ] || [ ! -f "backend/dist/server.js" ]; then
  echo "构建产物缺失，无法启动。"
  read -r -p "按回车键关闭…" _
  exit 1
fi

echo "启动服务…"
node backend/dist/server.js &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

READY=0
for i in $(seq 1 30); do
  if curl -s --max-time 1 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    if page_ok; then READY=1; break; fi
  fi
  sleep 0.5
done

if [ "$READY" -eq 1 ]; then
  echo "服务已就绪：$URL"
  echo "未配置 AI / 语音服务也能正常搜索与播放，相关功能会自动关闭。"
  echo "按 Ctrl+C 停止服务。"
  open "$URL" 2>/dev/null || true
  wait "$SERVER_PID"
else
  echo "服务启动超时或页面不可用，请查看上方日志。"
  read -r -p "按回车键关闭…" _
fi
