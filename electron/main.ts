// origin: 094CY/MusicBuddy
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
import fs from 'fs';

// 用户数据（配置、偏好记忆）统一放在独立目录，不进入应用包
app.setPath('userData', path.join(app.getPath('appData'), 'musicbuddy'));

// 查找系统中可用的 node 路径
function getNodePath(): string {
  try {
    const found = execSync('which node', { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch { /* ignore */ }
  const candidates = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    path.join(process.env.HOME || '', '.nvm', 'current', 'bin', 'node'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'node';
}



let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV === 'development';

// 获取 backend 目录路径
function getBackendPath(): string {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'backend');
  }
  // 生产环境：backend 被 asarUnpack 到 app.asar.unpacked/backend
  return path.join(app.getAppPath(), '..', 'app.asar.unpacked', 'backend');
}

// 把 .env 权限收紧为 0600，避免同机其他用户读取密钥
function secureEnvFile(filePath: string) {
  try { fs.chmodSync(filePath, 0o600); } catch { /* ignore */ }
}

// 确保 userData/.env 存在；返回其绝对路径以传给后端
function ensureUserDataEnv(): string {
  const userEnvPath = path.join(app.getPath('userData'), '.env');
  if (fs.existsSync(userEnvPath)) {
    secureEnvFile(userEnvPath);
    return userEnvPath;
  }

  // 1) 旧版本兼容：如果 backend/.env 存在（开发态或老用户），迁移过来
  const backendPath = getBackendPath();
  const oldBackendEnv = path.join(backendPath, '.env');
  if (fs.existsSync(oldBackendEnv)) {
    try {
      fs.copyFileSync(oldBackendEnv, userEnvPath);
      secureEnvFile(userEnvPath);
      console.log('[Electron] 已迁移 backend/.env → userData/.env');
      // 同时尝试删除 backend/.env（仅当可写时；asar 内的不可写）
      try { fs.unlinkSync(oldBackendEnv); } catch { /* ignore */ }
      return userEnvPath;
    } catch (e) {
      console.warn('[Electron] 迁移 backend/.env 失败:', e);
    }
  }

  // 2) 否则从 .env.example 复制（用户后续手动填 Key）
  const candidates = [
    path.join(__dirname, '..', '..', '.env.example'),
    path.join(app.getAppPath(), '.env.example'),
    path.join(backendPath, '.env.example'),
  ];
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, userEnvPath);
      secureEnvFile(userEnvPath);
      console.log('[Electron] 已创建 userData/.env（来源:', src, '）');
      return userEnvPath;
    }
  }

  // 3) 兜底创建一个空文件
  try { fs.writeFileSync(userEnvPath, '# MusicBuddy backend env\n', { mode: 0o600 }); } catch { /* ignore */ }
  secureEnvFile(userEnvPath);
  console.warn('[Electron] 警告：未找到 .env.example，已创建空白 .env');
  return userEnvPath;
}

// 检测端口是否被占用
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => {
        tester.close();
        resolve(false);
      })
      .listen(port);
  });
}

// 验证端口上的服务是否是我们的后端
async function isOurBackend(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    if (res.ok) {
      const data = await res.json() as { status?: string };
      return data.status === 'ok';
    }
  } catch {
    // 不是我们的后端或无法访问
  }
  return false;
}

// 杀掉占用指定端口的进程（macOS/Linux）
function killPortOccupier(port: number): void {
  try {
    const pid = require('child_process').execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    if (pid) {
      console.log(`[Electron] 杀掉占用端口 ${port} 的进程: ${pid}`);
      process.kill(Number(pid), 'SIGTERM');
      // 等待进程退出
      require('child_process').execSync(`while lsof -ti:${port} > /dev/null 2>&1; do sleep 0.1; done`, { timeout: 5000 });
    }
  } catch {
    // 端口可能已经被释放
  }
}

// 启动后端服务
async function startBackend(): Promise<void> {
  const backendPath = getBackendPath();
  const port = 3721;

  // 如果端口已被占用，验证是否真的是我们的后端
  if (await isPortInUse(port)) {
    if (await isOurBackend(port)) {
      console.log(`[Electron] 端口 ${port} 已有 MusicBuddy 后端在运行，直接复用`);
      return;
    }
    console.log(`[Electron] 端口 ${port} 被占用且不是我们的后端，尝试清理...`);
    killPortOccupier(port);
  }

  const dotenvPath = ensureUserDataEnv();

  let command: string;
  let args: string[];

  const nodePath = getNodePath();
  if (isDev) {
    command = nodePath;
    args = [path.join(backendPath, 'node_modules', 'ts-node', 'dist', 'bin.js'), 'src/server.ts'];
  } else {
    command = nodePath;
    args = ['dist/server.js'];
  }

  console.log(`[Electron] 启动后端: ${command} ${args.join(' ')}`);
  console.log(`[Electron] 工作目录: ${backendPath}`);
  console.log(`[Electron] DOTENV_PATH: ${dotenvPath}`);

  // 创建后端日志文件（使用 /tmp 确保绝对可写）
  const logPath = '/tmp/musicbuddy-backend.log';
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n[${new Date().toISOString()}] ===== 后端启动 =====\n`);
  console.log('[Electron] 后端日志路径:', logPath);

  return new Promise<void>((resolve, reject) => {
    function doSpawn() {
      backendProcess = spawn(command, args, {
        cwd: backendPath,
        stdio: 'pipe',
        env: { ...process.env, DOTENV_PATH: dotenvPath },
      });

      let hasResolved = false;

      backendProcess.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        const line = `[Backend] ${msg}`;
        console.log(line);
        logStream.write(`[${new Date().toISOString()}] ${line}\n`);
        if (!hasResolved && msg.includes('MusicBuddy backend running')) {
          hasResolved = true;
          resolve();
        }
      });

      backendProcess.stderr?.on('data', (data: Buffer) => {
        const line = `[Backend Error] ${data.toString().trim()}`;
        console.error(line);
        logStream.write(`[${new Date().toISOString()}] ${line}\n`);
      });

      backendProcess.on('error', (err) => {
        console.error('[Electron] 后端启动失败:', err);
        logStream.write(`[${new Date().toISOString()}] [Electron] 后端启动失败: ${err.message}\n`);
        if (!hasResolved) {
          hasResolved = true;
          reject(err);
        }
      });

      backendProcess.on('exit', (code) => {
        const line = `[Electron] 后端进程退出，退出码: ${code}`;
        console.error(line);
        logStream.write(`[${new Date().toISOString()}] ${line}\n`);
        // 异常退出时自动重启（最多重试3次）
        if (code !== 0 && code !== null) {
          console.error('[Electron] 后端异常退出，3秒后自动重启...');
          logStream.write(`[${new Date().toISOString()}] [Electron] 后端异常退出，3秒后自动重启...\n`);
          setTimeout(() => doSpawn(), 3000);
        }
      });

      // 兜底：5秒后无论是否检测到启动信息都继续
      setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          resolve();
        }
      }, 5000);
    }

    doSpawn();
  });
}

// 结束后端服务
function stopBackend() {
  if (backendProcess) {
    console.log('[Electron] 结束后端服务...');
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 390,
    height: 720,
    x: width - 420,
    y: 60,
    frame: false,
    backgroundColor: '#050505',
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // 注：当前依赖音频跨域加载，需保留 webSecurity:false。后续应通过后端代理音频流移除此项。
      webSecurity: false,
      // 关键：禁用后台节流，确保最小化到 Dock 后音频继续播放
      backgroundThrottling: false,
    },
  });

  // 加载前端
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  }

  // 开发时打开开发者工具；生产环境按 F12 打开
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && !input.alt && !input.control && !input.meta && !input.shift) {
      mainWindow!.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 监听全屏状态变化（macOS 绿色按钮等原生操作）
  mainWindow.on('enter-full-screen', () => {
    isLandscapeMode = true;
    mainWindow?.webContents.send('fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    isLandscapeMode = false;
    mainWindow?.webContents.send('fullscreen-changed', false);
  });

  // 转发 renderer 控制台日志到主进程
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelStr = ['debug', 'log', 'warn', 'error'][level] || 'log';
    console.log(`[Renderer ${levelStr}] ${message}`);
  });

  // 渲染进程日志由 console-message 转发，此处不做额外 DOM 探针

}

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    console.error('[Electron] 后端启动异常:', err);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', () => {
  stopBackend();
});

// IPC: 窗口控制
ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-close', () => {
  mainWindow?.close();
});

ipcMain.handle('window-set-always-on-top', (_e, flag: boolean) => {
  mainWindow?.setAlwaysOnTop(flag);
});

// 横版/竖版切换（不强制 macOS 全屏，用大窗口模式）
let isLandscapeMode = false;
ipcMain.handle('window-toggle-fullscreen', () => {
  if (!mainWindow) return false;
  isLandscapeMode = !isLandscapeMode;
  console.log('[Electron] toggle landscape mode:', isLandscapeMode);
  if (isLandscapeMode) {
    // 进入横版大窗口模式
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(900, 500);
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    const w = Math.min(screenW - 100, 1400);
    const h = Math.min(screenH - 100, 850);
    mainWindow.setBounds({ width: w, height: h, x: Math.floor((screenW - w) / 2), y: Math.floor((screenH - h) / 2) });
  } else {
    // 恢复竖版
    const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setMinimumSize(350, 600);
    mainWindow.setBounds({ width: 390, height: 720, x: screenW - 420, y: 60 });
    // 不再默认置顶；置顶需用户主动通过 IPC window-set-always-on-top 控制
  }
  // 主动通知前端状态变化
  mainWindow.webContents.send('fullscreen-changed', isLandscapeMode);
  return isLandscapeMode;
});

ipcMain.handle('window-is-fullscreen', () => {
  return isLandscapeMode;
});
