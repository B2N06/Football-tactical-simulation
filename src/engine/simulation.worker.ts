import type { TacticalScenario } from '../types'
import { compareScenarios } from './simulation'

self.onmessage = (event: MessageEvent<{ baseline: TacticalScenario; modified: TacticalScenario }>) => {
  try {
    const result = compareScenarios(event.data.baseline, event.data.modified)
    self.postMessage({ ok: true, result })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : '推演失败' })
  }
}
