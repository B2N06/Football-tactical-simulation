# Football Tactical Simulation

面向教练、分析师和足球爱好者的 Windows 桌面战术推演工具。它把比赛事件、空间快照、球员属性与人工战术指令组合成可复现的概率实验，核心功能完全不依赖 AI。

## 功能

- 双方 22 名球员的站位、职责、跑位、传球、带球、射门、压迫和盯人设置。
- 固定随机种子的蒙特卡洛进攻回合，对比基准与修改战术。
- 代表性回合轨迹、传球网络、进攻通道、射门率、xG、禁区进入和控球延续分析。
- StatsBomb Open Data 在线导入、football-data.org v4 比赛元数据导入。
- StatsBomb/标准 JSON、追踪 CSV、ZIP、PNG/JPG 热点参考图导入。
- 从本地比赛库一键生成双方 11 人历史校准方案，按球员样本平滑传球、跑位、射门、带球和防守倾向。
- 流式聚合最多 50,000 次蒙特卡洛回合，避免把全部中间轨迹长期保存在内存中。
- 正确支持主队向右、客队向左的双向进攻坐标、禁区进入和推进距离。
- 本地 SQLite 持久化、数据库备份、JSON/CSV/PDF 结果导出。
- 预留 `AiAnalysisProvider`，但首版不接入 AI、不收集 AI Key。

> 推演输出是概率分析，不是对真实比赛结果的预测。缺少逐帧追踪数据时，无球跑位会明确标记为“模型推断”。

## 快速开始

### 安装版

从 GitHub Releases 下载最新的 `Football-Tactical-Simulation-Setup-*-x64.exe`，或下载 Portable 版本直接运行。当前版本没有商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”。

### 开发

需要 Node.js 20+ 和 pnpm：

```powershell
pnpm install
pnpm dev
```

验证和打包：

```powershell
pnpm typecheck
pnpm test
pnpm pack:win
```

构建结果位于 `release/`。

## 数据源

- [StatsBomb Open Data](https://github.com/statsbomb/open-data)：事件、阵容和部分比赛的 360 空间快照。发布相关研究或分析时请保留来源声明和 StatsBomb 标识。
- [football-data.org v4](https://www.football-data.org/documentation/quickstart)：赛事、球队、比分和订阅允许的阵容元数据。
- [Sportmonks API v3](https://docs.sportmonks.com/v3)：只预留适配器边界，首版未连接。

项目不附带大体积第三方比赛数据。`examples/` 仅含合成追踪样例。

## 安全与隐私

Electron 渲染器启用上下文隔离并禁用 Node.js。API Token 通过系统安全存储加密；比赛数据库默认位于 Electron 用户数据目录。详情见 [PRIVACY.md](PRIVACY.md)。

## 文档

- [架构与推演边界](docs/ARCHITECTURE.md)
- [标准数据格式](docs/DATA_FORMAT.md)
- [优化路线与实现可行性](docs/ROADMAP.md)
- [贡献指南](CONTRIBUTING.md)

## 许可证

[MIT](LICENSE)
