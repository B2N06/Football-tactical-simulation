import { useRef } from 'react'
import type { PlayerTacticalProfile, SimulationAction, TeamSide, Vec2 } from '../types'

interface PitchProps {
  home: PlayerTacticalProfile[]
  away: PlayerTacticalProfile[]
  selectedId?: string
  onSelect?: (id: string) => void
  onMove?: (id: string, point: Vec2) => void
  onMoveStart?: () => void
  onMoveEnd?: () => void
  actions?: SimulationAction[]
  step?: number
  compact?: boolean
}

const toPercent = (point: Vec2) => ({ left: `${point.x / 105 * 100}%`, top: `${point.y / 68 * 100}%` })

export function Pitch({ home, away, selectedId, onSelect, onMove, onMoveStart, onMoveEnd, actions = [], step = actions.length - 1, compact = false }: PitchProps) {
  const dragState = useRef<{ id: string; pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const players = [...home, ...away]
  const visibleActions = actions.slice(0, step + 1)
  const latestPositions = new Map<string, Vec2>()
  for (const action of visibleActions) {
    latestPositions.set(action.playerId, action.start)
    if (action.targetPlayerId && action.success) latestPositions.set(action.targetPlayerId, action.end)
  }
  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (!onMove) return
    dragState.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }
    onMoveStart?.()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    const drag = dragState.current
    if (!onMove || !drag || drag.id !== id || drag.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
    drag.moved = true
    const pitch = event.currentTarget.parentElement!.getBoundingClientRect()
    onMove(id, { x: Math.max(0, Math.min(105, (event.clientX - pitch.left) / pitch.width * 105)), y: Math.max(0, Math.min(68, (event.clientY - pitch.top) / pitch.height * 68)) })
  }
  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    const drag = dragState.current
    dragState.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    onMoveEnd?.()
    if (!onMove || !drag || drag.id !== id || !drag.moved) return
  }
  return <div className={`pitch ${compact ? 'pitch--compact' : ''}`} onDragOver={event => event.preventDefault()}>
    <div className="pitch__stripe pitch__stripe--1"/><div className="pitch__stripe pitch__stripe--2"/><div className="pitch__stripe pitch__stripe--3"/><div className="pitch__stripe pitch__stripe--4"/>
    <div className="pitch__boundary"/><div className="pitch__half"/><div className="pitch__circle"/><div className="pitch__spot"/>
    <div className="pitch__box pitch__box--left"/><div className="pitch__six pitch__six--left"/><div className="pitch__goal pitch__goal--left"/>
    <div className="pitch__box pitch__box--right"/><div className="pitch__six pitch__six--right"/><div className="pitch__goal pitch__goal--right"/>
    <svg className="pitch__trails" viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true">
      {visibleActions.map((action, index) => <g key={`${action.index}-${index}`}>
        <line x1={action.start.x} y1={action.start.y} x2={action.end.x} y2={action.end.y} className={`trail trail--${action.kind} ${action.success ? '' : 'trail--failed'}`} />
        <circle cx={action.end.x} cy={action.end.y} r=".6" className={action.success ? 'trail-dot' : 'trail-dot trail-dot--failed'} />
      </g>)}
    </svg>
    {players.map(player => {
      const point = latestPositions.get(player.playerId) ?? player.anchor
      const side: TeamSide = player.side
      return <button type="button" key={player.playerId} data-player-id={player.playerId} aria-label={`选择 ${player.name}，${player.position}`} aria-pressed={selectedId === player.playerId} onPointerDown={event => handlePointerDown(event, player.playerId)} onPointerMove={event => handlePointerMove(event, player.playerId)} onPointerUp={event => handlePointerUp(event, player.playerId)} onPointerCancel={() => { dragState.current = null; onMoveEnd?.() }} onClick={() => onSelect?.(player.playerId)}
        className={`pitch-player pitch-player--${side} ${selectedId === player.playerId ? 'is-selected' : ''}`} style={toPercent(point)} title={`${player.name} · ${player.role}`}>
        <span>{player.shirtNumber}</span><small>{player.name.split(' ').at(-1)}</small>
      </button>
    })}
    {visibleActions.length > 0 && <div className="pitch-ball" style={toPercent(visibleActions.at(-1)!.end)} />}
  </div>
}
