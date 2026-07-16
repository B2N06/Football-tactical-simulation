import type { TacticalScenario } from '../types'
import { compareScenarios } from './simulation'

self.onmessage = (event: MessageEvent<{ baseline: TacticalScenario; modified: TacticalScenario }>) => {
  try {
    const result = compareScenarios(event.data.baseline, event.data.modified, (progress, phase) => {
      self.postMessage({ type: 'progress', progress, phase })
    })
    self.postMessage({ type: 'result', ok: true, result })
  } catch (error) {
    self.postMessage({ type: 'result', ok: false, error: error instanceof Error ? error.message : '推演失败' })
  }
}
