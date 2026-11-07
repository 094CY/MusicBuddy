<!-- origin: 094CY/MusicBuddy -->
# 参与与二次开发

欢迎为学习、研究与非商业性技术交流而修改本项目。开始前请先阅读
[LICENSE](./LICENSE) 与 [NOTICE.md](./NOTICE.md)：本项目禁止任何商业用途。

## 可以做什么

- 修复缺陷、改进交互、补充文档
- 接入你自己的 AI / 语音服务
- 增加新的公开音源适配器
- 基于源码做非商业性的个人改造与实验

## 提 Issue / PR

- Issue 请说明运行环境、复现步骤与期望行为
- **不要**在 Issue、PR、截图或日志里粘贴任何 API Key、账号、令牌或真实用户数据
- PR 请保持改动聚焦，附上改动目的与验证方式
- 提交前确认没有把 `.env`、`backend/data/`、`node_modules/`、构建产物加入版本控制

## 本地开发环境

```bash
npm install
npm run install:all
npm run dev              # 前端热更新 + 后端
npm run build:all        # 构建校验
```

## 扩展点

| 想改什么 | 从哪里入手 |
|----------|-----------|
| 新增 / 替换音源 | `backend/src/routes/music.ts` |
| 换 AI 服务或模型 | `.env.example` 中的 LLM 变量，无需改代码 |
| 换语音服务 | `.env.example` 中的 TTS 变量；`backend/src/config/services.ts` |
| 推荐逻辑与提示词 | `backend/src/routes/ai.ts` |
| 电台场景预设 | `frontend/src/components/player/AIRadioPanel.tsx` |
| 播放器行为 | `frontend/src/components/AudioPlayer.tsx`、`frontend/src/store/playerStore.ts` |
| 界面与主题 | `frontend/src/index.css`、`frontend/src/pages/PlayerPage.tsx` |

## 约定

- 不引入会锁定特定厂商的硬编码地址、密钥或凭据
- 不提交任何音乐文件、歌词库或专辑封面
- 保持「未配置外部服务也能搜索与播放」这一底线
