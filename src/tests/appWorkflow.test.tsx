// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createBrowserDemoBundles } from '../platform/browserDemo'
import { listBundleSummaries } from '../platform/browserDatabase'
import type { CanonicalMatchBundle, ImportPreview, SimulationComparison, SimulationResult } from '../types'

let constructorFailure = false
let messageFailure = false
const workers: ControlledWorker[] = []

class ControlledWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn(() => { if (messageFailure) throw new Error('无法投递推演请求') })
  terminate = vi.fn()
  constructor() {
    if (constructorFailure) throw new Error('后台 Worker 启动受阻')
    workers.push(this)
  }
  complete(result: SimulationComparison) { this.onmessage?.({ data: { type: 'result', ok: true, result } } as MessageEvent) }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent) }
}

function resultFixture(): SimulationComparison {
  const result: SimulationResult = {
    scenarioId: 'demo-building-from-back', seed: 20260715, createdAt: '2026-10-09T00:00:00.000Z',
    metrics: { possessions: 1200, shotRate: .25, averageXg: .04, boxEntries: .2, retentionRate: .55, averageProgression: 23.4, leftShare: .3, centreShare: .4, rightShare: .3 },
    confidenceInterval: { shotRate: [.22, .28], retentionRate: [.52, .58] },
    representativeSuccess: [], representativeFailure: [], playerHeatmaps: {}, passNetwork: [], qualityNotes: ['固定种子回归测试数据']
  }
  return { baseline: structuredClone(result), modified: structuredClone(result), deltas: { shotRate: 0, averageXg: 0, boxEntries: 0, retentionRate: 0, averageProgression: 0 } }
}

function installApi() {
  const api = {
    getDatabaseSummary: vi.fn().mockResolvedValue({ matches: 0, teams: 0, players: 0, events: 0, frames: 0, scenarios: 0 }),
    listMatches: vi.fn().mockResolvedValue([]),
    getAppInfo: vi.fn().mockResolvedValue({ version: 'test', databasePath: 'IndexedDB', platform: 'Browser' }),
    saveScenario: vi.fn().mockResolvedValue({ ok: true }),
    getRelatedMatchBundles: vi.fn().mockResolvedValue([]),
    previewImport: vi.fn().mockResolvedValue(null)
  }
  Object.defineProperty(window, 'footballApi', { configurable: true, value: api })
  return api
}

async function mountApp() {
  render(<StrictMode><App/></StrictMode>)
  await waitFor(() => expect(window.footballApi.getAppInfo).toHaveBeenCalled())
}

function goTo(name: '战术编辑器' | '推演实验室') {
  fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: new RegExp(`^${name}`) }))
}

function completeCurrentRun() {
  const worker = workers.at(-1)!
  act(() => worker.complete(resultFixture()))
  return worker
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function setupHistoricalRequests() {
  const api = installApi()
  const bundles = createBrowserDemoBundles().slice(0, 2)
  const earlier = deferred<CanonicalMatchBundle[]>(), latest = deferred<CanonicalMatchBundle[]>()
  api.listMatches.mockResolvedValue(bundles.map(bundle => listBundleSummaries([bundle])[0]))
  api.getRelatedMatchBundles.mockImplementation(id => id === bundles[0].match.id ? earlier.promise : latest.promise)
  await mountApp()
  const buttons = await screen.findAllByRole('button', { name: '生成校准方案' })
  return { api, bundles, earlier, latest, buttons }
}

describe('应用工作流回归', () => {
  beforeEach(() => {
    constructorFailure = false; messageFailure = false; workers.length = 0
    installApi()
    vi.stubGlobal('Worker', ControlledWorker)
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('StrictMode 下单次职责修改只产生一次撤销记录，并可重做', async () => {
    await mountApp(); goTo('战术编辑器')
    const inspector = within(screen.getByTestId('player-inspector'))
    const duty = inspector.getByRole('combobox', { name: '职责' }) as HTMLSelectElement
    expect(duty.value).toBe('进攻')
    fireEvent.change(duty, { target: { value: '支援' } })
    expect(duty.value).toBe('支援')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(duty.value).toBe('进攻')
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(duty.value).toBe('支援')
    expect((screen.getByRole('button', { name: '重做' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('一次滑杆手势中的连续数值修改合并为一次撤销', async () => {
    await mountApp(); goTo('战术编辑器')
    const slider = within(screen.getByTestId('player-inspector')).getByRole('slider', { name: /^向前传球/ }) as HTMLInputElement
    const original = slider.value
    fireEvent.pointerDown(slider, { pointerId: 1 })
    fireEvent.change(slider, { target: { value: '75' } })
    fireEvent.change(slider, { target: { value: '90' } })
    fireEvent.pointerUp(slider, { pointerId: 1 })
    expect(slider.value).toBe('90')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(slider.value).toBe(original)
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('方案名称的连续键入在失焦后可一次恢复', async () => {
    await mountApp(); goTo('战术编辑器')
    const name = screen.getByRole('textbox', { name: '方案名称' }) as HTMLInputElement
    const original = name.value
    fireEvent.focus(name)
    fireEvent.change(name, { target: { value: '边路' } })
    fireEvent.change(name, { target: { value: '边路超载试验' } })
    fireEvent.blur(name)
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(name.value).toBe(original)
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('完成推演后修改战术会提示旧结果，并锁定本次比较的改动摘要', async () => {
    await mountApp(); goTo('推演实验室')
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    completeCurrentRun()
    expect(screen.getByRole('heading', { name: '战术调整对比结果' })).toBeTruthy()
    goTo('战术编辑器')
    fireEvent.change(within(screen.getByTestId('player-inspector')).getByRole('combobox', { name: '职责' }), { target: { value: '支援' } })
    goTo('推演实验室')
    expect(screen.getByText('当前设置已在本次结果生成后发生变化')).toBeTruthy()
    expect(screen.getByRole('button', { name: '按当前设置重新推演' })).toBeTruthy()
    expect(screen.getByText('基准与修改方案没有参数差异，本次结果仅用于验证计算一致性。')).toBeTruthy()
  })

  it('取消下一轮推演会终止其 Worker，并保留上一轮可导出的结果', async () => {
    await mountApp(); goTo('推演实验室')
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    completeCurrentRun()
    const previousMetric = screen.getByRole('article', { name: /^射门回合率：/ }).getAttribute('aria-label')
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    const cancelled = workers.at(-1)!
    fireEvent.click(screen.getByRole('button', { name: '取消推演' }))
    expect(cancelled.terminate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('推演已取消，上一轮结果仍然保留。')).toBeTruthy()
    expect(screen.getByRole('article', { name: /^射门回合率：/ }).getAttribute('aria-label')).toBe(previousMetric)
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeTruthy()
  })

  it('Worker 构造或后台运行失败后仍可重新启动推演', async () => {
    await mountApp(); goTo('推演实验室')
    constructorFailure = true
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    expect(screen.getByRole('alert').textContent).toContain('启动受阻')
    constructorFailure = false
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    const failed = workers.at(-1)!
    act(() => failed.fail('后台计算中断'))
    expect(screen.getByRole('alert').textContent).toContain('后台计算中断')
    expect(failed.terminate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    completeCurrentRun()
    expect(screen.getByRole('heading', { name: '战术调整对比结果' })).toBeTruthy()
    expect(workers).toHaveLength(2)
  })

  it('postMessage 抛错时清理 Worker 引用，后续点击可重试', async () => {
    await mountApp(); goTo('推演实验室')
    messageFailure = true
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    expect(screen.getByRole('alert').textContent).toContain('无法投递')
    expect(workers[0].terminate).toHaveBeenCalledTimes(1)
    messageFailure = false
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    completeCurrentRun()
    expect(screen.getByRole('heading', { name: '战术调整对比结果' })).toBeTruthy()
  })

  it('手动保存和推演后自动保存的异步失败被处理，分析结果仍可使用', async () => {
    const api = installApi()
    api.saveScenario.mockRejectedValue(new Error('本地存储空间不足'))
    await mountApp(); goTo('战术编辑器')
    fireEvent.click(screen.getByRole('button', { name: '保存方案' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('本地存储空间不足'))
    goTo('推演实验室')
    fireEvent.click(screen.getByRole('button', { name: '运行对比推演' }))
    completeCurrentRun()
    await waitFor(() => expect(screen.getByText('推演已完成，但方案保存失败；结果仍可导出。')).toBeTruthy())
    expect(screen.getByRole('heading', { name: '战术调整对比结果' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeTruthy()
    expect(api.saveScenario).toHaveBeenCalledTimes(2)
  })

  it('较早比赛请求晚返回时不会覆盖最新方案或清空其编辑', async () => {
    const { bundles, earlier, latest, buttons } = await setupHistoricalRequests()
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1])
    await act(async () => latest.resolve([bundles[1]]))
    const name = screen.getByRole('textbox', { name: '方案名称' }) as HTMLInputElement
    fireEvent.focus(name); fireEvent.change(name, { target: { value: '最新方案的保留编辑' } }); fireEvent.blur(name)
    await act(async () => earlier.resolve([bundles[0]]))
    expect(name.value).toBe('最新方案的保留编辑')
    fireEvent.click(screen.getByRole('button', { name: '保存方案' }))
    expect(window.footballApi.saveScenario).toHaveBeenCalledWith(expect.objectContaining({ sourceMatchId: bundles[1].match.id, name: '最新方案的保留编辑' }))
  })

  it('较早比赛请求晚失败不会覆盖最新方案的成功状态', async () => {
    const { bundles, earlier, latest, buttons } = await setupHistoricalRequests()
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1])
    await act(async () => latest.resolve([bundles[1]]))
    const name = (screen.getByRole('textbox', { name: '方案名称' }) as HTMLInputElement).value
    await act(async () => earlier.reject(new Error('较早请求已断开')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('textbox', { name: '方案名称' }) as HTMLInputElement).value).toBe(name)
  })

  it('等待比赛加载时对当前方案的编辑使待处理回包失效', async () => {
    const { bundles, earlier, buttons } = await setupHistoricalRequests()
    fireEvent.click(buttons[0])
    expect(screen.getByRole('button', { name: '取消方案加载' })).toBeTruthy()
    goTo('战术编辑器')
    const name = screen.getByRole('textbox', { name: '方案名称' }) as HTMLInputElement
    fireEvent.focus(name); fireEvent.change(name, { target: { value: '继续编辑当前方案' } }); fireEvent.blur(name)
    expect(screen.queryByRole('button', { name: '取消方案加载' })).toBeNull()
    await act(async () => earlier.resolve([bundles[0]]))
    expect(name.value).toBe('继续编辑当前方案')
    fireEvent.click(screen.getByRole('button', { name: '保存方案' }))
    expect(window.footballApi.saveScenario).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-building-from-back' }))
  })

  it('取消方案加载后旧回包不能切换页面或替换当前战术', async () => {
    const { bundles, earlier, buttons } = await setupHistoricalRequests()
    fireEvent.click(buttons[0])
    fireEvent.click(screen.getByRole('button', { name: '取消方案加载' }))
    await act(async () => earlier.resolve([bundles[0]]))
    expect(screen.getByRole('heading', { name: '数据中心' })).toBeTruthy()
    expect(screen.getByText('已取消方案加载，当前战术和结果保持不变。')).toBeTruthy()
    goTo('战术编辑器')
    expect((screen.getByRole('textbox', { name: '方案名称' }) as HTMLInputElement).value).toContain('后场组织')
  })

  it('本地文件选择/校验期间禁用重复打开和旧预览确认', async () => {
    const api = installApi()
    const preview: ImportPreview = { fileName: 'old.json', format: 'canonical-json', valid: true, matchCount: 1, playerCount: 22, eventCount: 20, frameCount: 0, warnings: [], errors: [], token: 'old-token' }
    const pending = deferred<ImportPreview>()
    api.previewImport.mockResolvedValueOnce(preview).mockImplementationOnce(() => pending.promise)
    await mountApp()
    fireEvent.click(screen.getByRole('button', { name: /导入本地数据/ }))
    await screen.findByRole('heading', { name: 'old.json' })
    fireEvent.click(screen.getByRole('button', { name: /导入本地数据/ }))
    const importButton = screen.getByRole('button', { name: '正在选择 / 校验数据…' }) as HTMLButtonElement
    expect(importButton.disabled).toBe(true)
    expect((screen.getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(importButton)
    expect(api.previewImport).toHaveBeenCalledTimes(2)
    await act(async () => pending.resolve({ ...preview, fileName: 'new.json', token: 'new-token' }))
    expect(screen.getByRole('heading', { name: 'new.json' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'old.json' })).toBeNull()
    expect((screen.getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
