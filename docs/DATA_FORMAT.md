# 标准数据格式

应用内部统一使用 105 × 68 米球场，坐标原点位于左上角，默认进攻方向从左向右。导入器会保留来源与原始事件，以便审计。

## 本地导入

- `canonical JSON`：完整的 `CanonicalMatchBundle`，`schemaVersion` 必须为 `1`。
- `StatsBomb JSON`：原始事件数组；ZIP 内可同时包含 `events.json`、`lineups.json` 与 `three-sixty.json`。
- `tracking CSV`：至少包含 `second, player_id, teammate, x, y`。可选字段为 `speed, ball_x, ball_y, pitch_width, pitch_height, possession_team_id`。
- `PNG/JPG`：仅作为热点图参考图存储，不进入数值计算。

## 核心对象

```ts
interface CanonicalMatchBundle {
  schemaVersion: 1
  source: { provider: string; sourceId: string; importedAt: string; attribution?: string }
  match: MatchInfo
  teams: Team[]
  players: Player[]
  lineups: LineupEntry[]
  events: MatchEvent[]
  frames: TrackingFrame[]
}
```

任何校验失败都会中止整个导入事务；重复比赛 ID 会由新的、完整校验通过的数据替换。
