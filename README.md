# 小说转短剧工作台（Novel to Short-Drama Studio）

把小说一键流水线化成 AI 短剧的单文件 Web 工作台：**小说原文 → AI 拆镜 → 角色/场景设定图 → 分镜图 → 分镜视频 → TTS 配音 → 字幕/整轨配音/FFmpeg 一键合成成片**。

单文件 HTML，全内联零外部依赖，PC / 移动端自适应；数据云端同步（WorkBuddy 资料库）+ 本地 localStorage 双通道，离线自动降级。

## 功能总览

| 模块 | 能力 |
|---|---|
| ① 剧本拆镜 | 粘贴小说 / 导入 txt，AI 拆出画面描述、英文提示词、运镜、景别、说话角色、情绪、台词、时长；自动创建设定卡 |
| ② 角色与场景 | 角色卡（定妆照 + 面部特写 + 常服 + 性格 + TTS 音色）、场景卡（空景图 + 反打机位）；一致性体检面板（0–100 分） |
| ③ 生成图 / 视频 | 多视图参考图 + 文字锚点出图；图生视频；满意基准帧锁定、失败重试、批量生成 |
| ④ 成片与导出 | 时间线总览、字幕 .srt、整轨配音 .wav、FFmpeg 一键合成包（render.sh / render.bat / 合成清单.json） |

核心特性：

- **五层一致性方案**：多视图设定图（副视图以主图为参考生成）、参考图优先级与上限、满意基准帧机制、服装/景别/情绪三重文字锁定、一致性体检
- **长篇流水线**：整本小说按「第 X 章」自动切分，勾选后一键跑完 拆镜 → 设定卡 → 设定图 → 分镜图 → 配音 → 视频；跨章全局词表锁定人名；支持断点续跑
- **章节 AI 剧本化**：正文改写成对白化、强钩子的短剧剧本后再拆镜，可一键还原
- **音画同步**：配音返回后镜头时长自动对齐语音长度；字幕与整轨配音共用同一时间轴
- **口型处理**：口型风险判定（景别 × 说话人）→ AI 规避改写（过肩/侧脸/背身）→ 可选第三方唇形服务
- **BGM 轨**：配置 URL / 音量 / 淡入淡出，WebAudio 混入整轨配音，合成脚本同步支持
- **用量与成本追踪**：生图张数 / 视频秒数 / 配音条数 / 口型次数自动计数，可填单价，所有批量操作前弹窗预估费用

## 快速开始

1. 下载 `novel-to-drama-studio.html`，浏览器直接打开（或使用在线部署链接）
2. 启动本地 CORS 代理（零依赖，仅 Node）：

   ```bash
   node agnes-proxy.js --text https://api.deepseek.com --tts https://api.xiaomimimo.com
   ```

3. 页面「设置」里填四组配置（只存本机浏览器）：

   | 配置项 | 值 |
   |---|---|
   | Agnes Base URL | `http://127.0.0.1:8787/v1` |
   | 任务查询根地址 | `http://127.0.0.1:8787` |
   | 文本模型 Base URL | `http://127.0.0.1:8787/text/v1` |
   | 小米 TTS Base URL | `http://127.0.0.1:8787/tts/v1` |

   再填入 Agnes API Key、文本模型 Key、小米 TTS Key（platform.xiaomimimo.com 申请，与推理 Key 不通用），用三个「测试」按钮逐个验证。

4. 按顺序使用：**① 拆镜 → ② 设定图 → ③ 分镜图/视频 → ④ 配音 → ⑤ 成片导出**

## 一键合成成片

「成片与导出」点「一键合成包」，得到 `render.sh`（macOS/Linux）、`render.bat`（Windows）与 `合成清单.json`；配合「导出字幕 .srt」「导出整轨配音 .wav」（改名为 `subs.srt` / `voice.wav` 放同目录），安装 [ffmpeg](https://ffmpeg.org) 后运行脚本即可产出 **成片.mp4**（视频段拼接 + 缺视频镜头图片垫段 + 人声/BGM 混音 + 字幕烧录）。

## 技术说明

- **生图**：`agnes-image-2.5-flash`（`response_format` 须放 `extra_body`；多参考图经 `extra_body.image[]`）
- **生视频**：`agnes-video-2.5-flash`（keyframe 模式，`seconds` 4–12 秒，异步轮询）
- **配音**：小米 MiMo TTS（OpenAI 兼容接口，待合成文本须置于 `assistant` 角色）
- **数据**：分镜与设定卡存 WorkBuddy 资料库数据表（多设备同步）；API Key、小说原文、音频本体只存本机 localStorage。配音音频仅存在于生成它的设备，换机请重新生成或导出整轨
- **代理**：只监听 127.0.0.1，纯 Node 内置模块实现，无任何 npm 依赖

## 文档

- 详细的版本演进与设计说明见 [overview.md](overview.md)
- 版本变更记录见 [CHANGELOG.md](CHANGELOG.md)

## License

见 [LICENSE](LICENSE)。
