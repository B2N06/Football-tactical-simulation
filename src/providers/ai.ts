import type { AiAnalysisProvider, SimulationResult, TacticalScenario } from '../types'

export class DisabledAiProvider implements AiAnalysisProvider {
  readonly enabled = false as const
  readonly name = 'AI 扩展（未启用）'
  async analyse(_scenario: TacticalScenario, _result: SimulationResult): Promise<never> {
    throw new Error('AI 扩展尚未启用；核心推演不依赖 AI。')
  }
}
