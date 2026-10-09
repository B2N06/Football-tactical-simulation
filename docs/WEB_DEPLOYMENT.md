# 网页部署与运行边界

正式地址：[football.mossnyx.xyz](https://football.mossnyx.xyz/)。Cloudflare Pages 项目名 `mossnyx-football`，生产分支 `main`，稳定回退入口 `https://mossnyx-football.pages.dev/`。

## 构建与上传

在独立 Football 仓库内执行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:web
npx wrangler@4.147.0 pages deploy dist/web --project-name mossnyx-football --branch main
```

使用有该项目权限的已有 Cloudflare 登录身份；不要在项目文件、提交、命令参数或 README 中填写 Token。首次关联自定义域需要在 Pages 项目登记域名，并添加 `football` CNAME 到 `mossnyx-football.pages.dev`。目前此记录、Pages 域名和 HTTPS 已配置并核验，不需要再次创建，也不要修改主站记录。

本次通过已有 Wrangler OAuth 和 Windows Credential Manager 发布，没有新增 Token 或扩大权限。当前环境的 Wrangler 在相邻 PsychBio-Atlas 依赖中，项目本身不依赖该本地绝对路径，后续可使用上面的官方 CLI 命令。

## 仅上传构建产物

`dist/web/` 包含 HTML、哈希 JS/CSS、用户自有品牌 SVG 和以下 Pages 运行文件：

- `_worker.js`：仅处理 football-data.org 同源 API。
- `_routes.json`：仅让 `/api/*` 调用 Worker，静态文件不进入代理。
- `_headers`：CSP、禁止嵌入、资源类型保护和哈希资源缓存。

仓库源码、数据库、第三方大体积比赛数据、导入样本和凭据不作为线上静态产物上传。GitHub CI 构建网页与 Windows 应用并保留构建产物；当前 Pages 是 Direct Upload，不会因 GitHub 提交自动发布。更新线上时应先测试，再执行构建和上传。

## 功能与数据边界

浏览器核心流程：本地导入/校验 → IndexedDB 原子提交 → 球员与球队分析 → 双方逐人编辑 → Worker 基准/修改推演 → 回放与报告。AI 仍未启用。

仅网页文件获取和在线数据下载使用网络。加载后的分析与推演在本地；当前未实现承诺离线重载的 PWA。需要完全离线启动可使用 Windows 桌面版。

浏览器 API Token 仅存在页面内存。用户主动调用时会通过本站代理传给 football-data.org，不写入数据库或备份。用户未配置合法 Token 时，代理返回 401 且不会发起上游请求。未经实际用户订阅 Token 测试，不承诺特定付费字段或阵容覆盖。

本地导入文件上限 150 MB，ZIP 同时验证路径、文件数量及展开体积，图片验证真实格式和像素数。图片仅作参考，不从图片反推跑位坐标。浏览器备份为 JSON，通过“导入本地数据”恢复；桌面 SQLite 备份不能直接当浏览器 JSON 导入。

## 验收与回退

检查正式域 HTTPS=200；逐项核对入口和哈希资源；无 Token API=401、非法路径=404、非 GET=405、跨源=403。可通过 Pages 历史生产部署回退静态版本，但回退不会清除用户 IndexedDB，也不会自动恢复本地数据。

新版本发布后刷新页面获取入口 HTML；哈希资产长期缓存。若无法打开报告窗口，允许本站弹出窗口后重试“打印 / 保存 PDF”。
