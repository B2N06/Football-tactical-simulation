# Football Tactical Simulation

面向教练、分析师和足球爱好者的桌面与浏览器战术推演工具。它把比赛事件、空间快照、球员属性与人工战术指令组合成可复现的概率实验，核心功能完全不依赖 AI。

在线使用：[football.mossnyx.xyz](https://football.mossnyx.xyz/) · [Mossnyx 主站](https://mossnyx.xyz/)

v0.7.0 沿用主站的纸白、黑字、红色强调、网格和克制动效；比赛分析使用实际导入的数据覆盖，明确区分观测坐标与模型推断。

## 功能

- 贯穿“准备数据 → 调整战术 → 解读结果”的三步工作流，每一步显示完成状态并可直接跳转。
- 战术编辑默认只展示当前球员最常用的职责参数，专业参数按位置分类折叠；门将与场上球员使用不同指令集。
- 自动汇总相对基准的球员与球队改动，推演前明确说明本轮实验究竟改变了什么。
- 结果页优先给出专业但易读的结论摘要，区分正向、负向、取舍和无明显变化，并保留回放、置信区间与模型说明供下钻核查。
- 指标同时展示修改值、基准值、带单位的差值与中性阈值，避免把零差异误标为提升。
- 更易读的简约桌面界面：正文和操作字号整体提高，减少发光与渐变，支持键盘焦点及系统“减少动态效果”偏好。
- 战术编辑支持撤销、重做、恢复基准和显式保存，球员拖动过程实时反馈并在一次拖动结束后形成单个历史记录。
- 球队战术分析中心：按稳定球队 ID 汇总同一数据源中的最多 30 场比赛，形成长期球队档案。
- 球队与实际对手基准对照：传球稳定性、推进、进攻三区/禁区进入、场地倾斜、失误、压迫与阶段分布。
- 逐场趋势、阵型使用、12 区域占比、球员战术贡献、高频传球连接和数据质量说明。
- 基于确定性规则生成可核查的优势、风险和训练建议，全程不调用 AI。
- 双方 22 名球员的站位、职责、跑位、传球、带球、射门、压迫和盯人设置。
- 固定随机种子的蒙特卡洛进攻回合，对比基准与修改战术。
- 代表性回合轨迹、传球网络、进攻通道、射门率、xG、禁区进入和控球延续分析。
- StatsBomb Open Data 在线导入、football-data.org v4 比赛元数据导入。
- StatsBomb/标准 JSON、追踪 CSV、ZIP、PNG/JPG 热点参考图导入。
- 从本地比赛库一键生成双方 11 人历史校准方案，按球员样本平滑传球、跑位、射门、带球和防守倾向。
- 自动汇总同一数据源中包含相关球员的最多 20 场比赛，减少单场偶然性并显示实际校准场次。
- 流式聚合最多 50,000 次蒙特卡洛回合，避免把全部中间轨迹长期保存在内存中。
- 双方 22 人在每个动作步连续移动；防守球员根据压迫、盯人、防线和皮球位置响应，并输出双方热点图。
- 后台推演显示基准/修改方案的真实完成进度，仍可随时取消。
- 正确支持主队向右、客队向左的双向进攻坐标、禁区进入和推进距离。
- 本地 SQLite 持久化、数据库备份、JSON/CSV/PDF 结果导出。
- 预留 `AiAnalysisProvider`，但首版不接入 AI、不收集 AI Key。

> 推演输出是概率分析，不是对真实比赛结果的预测。缺少逐帧追踪数据时，无球跑位会明确标记为“模型推断”。

## 快速开始

### 浏览器版

打开 [football.mossnyx.xyz](https://football.mossnyx.xyz/)，在数据中心点击“载入合成示例”，为一场比赛“生成校准方案”，修改球员职责后运行对比推演。

浏览器版无需安装 Node.js 或 Python。比赛库与战术方案保存在当前浏览器的 IndexedDB，不跨设备同步；清除站点数据会删除本地库，请在设置中下载 JSON 备份。支持 JSON/CSV/ZIP 和热点参考图片导入、StatsBomb 在线导入、JSON/CSV 结果导出及打印/保存 PDF。football-data.org Token 仅保存在当前页面内存中，刷新后需重新输入。

首次打开网页及在线下载需要网络；页面已载入后，本地分析与后台推演不访问网络。当前未提供保证离线重载的 PWA 缓存，完整离线启动请使用桌面版。

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

网页开发与构建：

```powershell
pnpm dev:web
pnpm build:web
pnpm preview:web
```

静态产物与 Pages Worker 位于 `dist/web/`。网页的 football-data.org 连接需部署到配置了同源代理的 Cloudflare Pages；普通本地 Vite 服务器只支持公开 StatsBomb 数据源。部署方法见 [网页部署说明](docs/WEB_DEPLOYMENT.md)。

### 可导入示例

- 数据中心的“载入合成示例”会一次写入同一支球队的 3 场合成比赛，可直接验证球队分析中心的趋势和对手比较。
- `examples/demo-match-canonical.json`：完整标准 JSON，包含双方 22 人、首发阵容、30 个比赛事件和 4 个带球员 ID 的空间帧。
- `examples/tracking-sample.csv`：最小追踪 CSV，用于测试坐标、速度和球权字段。

启动桌面程序后，在“数据中心”选择“导入本地数据”，选中示例文件并确认导入，再在“本地比赛库”中点击“生成校准方案”。

## 数据源

- [StatsBomb Open Data](https://github.com/statsbomb/open-data)：事件、阵容和部分比赛的 360 空间快照。发布相关研究或分析时请保留来源声明和 StatsBomb 标识。
- [football-data.org v4](https://www.football-data.org/documentation/quickstart)：赛事、球队、比分和订阅允许的阵容元数据。
- [Sportmonks API v3](https://docs.sportmonks.com/v3)：只预留适配器边界，首版未连接。

项目不附带大体积第三方比赛数据。`examples/` 仅含合成比赛与追踪样例。

## 安全与隐私

Electron 渲染器启用上下文隔离并禁用 Node.js。桌面版 API Token 通过系统安全存储加密；比赛数据库默认位于 Electron 用户数据目录。网页版数据在设备本地，Token 仅使用页面内存，数据源代理只接受固定路径。详情见 [PRIVACY.md](PRIVACY.md)。

## 文档

- [架构与推演边界](docs/ARCHITECTURE.md)
- [标准数据格式](docs/DATA_FORMAT.md)
- [优化路线与实现可行性](docs/ROADMAP.md)
- [网页部署与运行边界](docs/WEB_DEPLOYMENT.md)
- [本轮视觉与交互验收](design-qa.md)
- [贡献指南](CONTRIBUTING.md)

## 许可证

[MIT](LICENSE)
