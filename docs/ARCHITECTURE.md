# 架构说明

## 桌面边界

Electron 主进程负责文件选择、SQLite 持久化、数据源网络请求、安全存储和报告导出。React 渲染器启用上下文隔离、禁用 Node.js，仅能通过 `preload` 暴露的白名单 IPC 调用主进程。

## 数据流

1. 数据提供商或本地文件进入适配器。
2. 适配器转换为 `CanonicalMatchBundle` 并统一坐标。
3. 预览展示覆盖率、警告和错误；确认后使用 SQLite 事务写入。
4. 球员历史先验与人工战术参数组成 `TacticalScenario`。
5. Web Worker 分别运行基准与修改方案，返回可复现的 `SimulationComparison`。

## 推演边界

引擎是事件序列蒙特卡洛模型，不是连续物理引擎。传球、带球、射门和防守压力的概率由球员属性、职责、距离、空间与球队设置共同决定。没有逐帧坐标时生成的无球跑位必须标记为模型推断。

`AiAnalysisProvider` 只是未来扩展边界；首版只有会拒绝调用的 `DisabledAiProvider`。
