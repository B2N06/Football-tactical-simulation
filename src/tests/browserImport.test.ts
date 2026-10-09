import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { BrowserImportService, MAX_IMPORT_BYTES, parseBrowserJson, PREVIEW_TTL_MS, validateZipEntries, type BrowserImportFile } from '../platform/browserImport'
import { createBrowserDemoBundles } from '../platform/browserDemo'
import { createDemoScenario } from '../engine/demo'

function file(name: string, value: string | ArrayBuffer): BrowserImportFile {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value).buffer : value
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes, text: async () => new TextDecoder().decode(bytes) }
}

describe('浏览器导入预览', () => {
  it('导入前只生成预览，预览仅可取用一次并在15分钟后失效', async () => {
    let now = 1000
    const service = new BrowserImportService(() => now)
    const source = file('match.json', JSON.stringify(createBrowserDemoBundles()[0]))
    const first = await service.preview(source)
    expect(first).toMatchObject({ valid: true, matchCount: 1, playerCount: 22, format: 'canonical-json' })
    expect(service.take(first.token).bundles[0].match.id).toBe('demo-team-1')
    expect(() => service.take(first.token)).toThrow('已提交')
    const superseded = await service.preview(source)
    const expired = await service.preview(source)
    expect(() => service.take(superseded.token)).toThrow('已过期')
    now += PREVIEW_TTL_MS
    expect(() => service.take(expired.token)).toThrow('已过期')
  })

  it('拒绝过大、损坏、伪装图片及缺失必需字段的文件', async () => {
    const service = new BrowserImportService()
    await expect(service.preview({ ...file('large.json', '{}'), size: MAX_IMPORT_BYTES + 1 })).rejects.toThrow('150 MB')
    await expect(service.preview(file('broken.json', '{'))).rejects.toThrow('JSON 文件格式错误')
    await expect(service.preview(file('invalid.png', 'not a png'))).rejects.toThrow('图片内容')
    await expect(service.preview(file('invalid.json', '{}'))).rejects.toThrow('标准数据格式无效')
  })

  it('读取并标准化追踪CSV，损坏数据拒绝生成有效预览', async () => {
    const service = new BrowserImportService()
    const preview = await service.preview(file('tracking.csv', 'second,player_id,teammate,x,y,pitch_width,pitch_height\n0,a,true,50,25,100,50\n0,b,false,10,10,100,50'))
    const data = service.take(preview.token)
    expect(data.bundles[0].frames[0].players[0].position).toEqual({ x: 52.5, y: 34 })
    await expect(service.preview(file('bad.csv', 'second,player_id,teammate,x,y\n0,a,true,106,0'))).rejects.toThrow('超出')
  })

  it('浏览器JSON备份同时恢复比赛和战术方案，任一损坏条目拒绝整个备份', () => {
    const backup = { format: 'football-tactics-browser-backup', version: 1, matches: createBrowserDemoBundles(), scenarios: [createDemoScenario()] }
    expect(parseBrowserJson(backup, 'backup.json')).toMatchObject({ bundles: expect.arrayContaining([expect.objectContaining({ match: expect.objectContaining({ id: 'demo-team-1' }) })]), scenarios: [expect.objectContaining({ id: 'demo-building-from-back' })] })
    backup.scenarios[0].iterations = -1
    expect(() => parseBrowserJson(backup, 'backup.json')).toThrow('推演次数')
  })

  it('ZIP读取标准比赛并拒绝路径穿越和过多文件', async () => {
    const service = new BrowserImportService()
    const zip = new JSZip().file('canonical-match.json', JSON.stringify(createBrowserDemoBundles()[0]))
    const preview = await service.preview(file('match.zip', await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })))
    expect(preview).toMatchObject({ format: 'zip', matchCount: 1, playerCount: 22 })
    const unsafe = new JSZip().file('../canonical.json', JSON.stringify(createBrowserDemoBundles()[0]))
    await expect(service.preview(file('unsafe.zip', await unsafe.generateAsync({ type: 'arraybuffer' })))).rejects.toThrow('不安全路径')
    expect(() => validateZipEntries(Array.from({ length: 251 }, (_, index) => ({ name: `${index}.txt`, size: 1 })))).toThrow('250')
    expect(() => validateZipEntries([{ name: 'one.json', size: MAX_IMPORT_BYTES }, { name: 'two.json', size: 1 }])).toThrow('解压后')
  })

  it('旧文件晚完成不会清除更新文件的预览token', async () => {
    const service = new BrowserImportService()
    let finishOld!: (text: string) => void
    const oldText = new Promise<string>(resolve => { finishOld = resolve })
    const oldFile = file('old.json', '{}')
    oldFile.text = () => oldText
    const oldRequest = service.preview(oldFile)
    const newer = await service.preview(file('newer.json', JSON.stringify(createBrowserDemoBundles()[1])))
    const oldRejected = expect(oldRequest).rejects.toThrow('较新的文件选择替代')
    finishOld(JSON.stringify(createBrowserDemoBundles()[0]))
    await oldRejected
    expect(service.take(newer.token).bundles[0].match.id).toBe('demo-team-2')
  })
})
