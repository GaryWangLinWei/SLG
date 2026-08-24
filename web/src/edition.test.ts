import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getEditionCapabilities, resolveEdition } from './edition'

describe('resolveEdition', () => {
  it('accepts the main edition', () => {
    expect(resolveEdition('main')).toBe('main')
  })

  it('accepts the agent edition', () => {
    expect(resolveEdition('agent')).toBe('agent')
  })

  it.each([undefined, '', 'enterprise'])('rejects missing or invalid value %s', (value) => {
    expect(() => resolveEdition(value)).toThrow(/VITE_APP_EDITION/)
  })
})

describe('getEditionCapabilities', () => {
  it('enables commercial capabilities for main', () => {
    expect(getEditionCapabilities('main')).toEqual({
      showPurchaseEntry: true,
      showRenewEntry: true,
    })
  })

  it('disables commercial capabilities for agent', () => {
    const capabilities = getEditionCapabilities('agent')

    expect(capabilities).toEqual({
      showPurchaseEntry: false,
      showRenewEntry: false,
    })
    expect(Object.keys(capabilities).sort()).toEqual([
      'showPurchaseEntry',
      'showRenewEntry',
    ])
  })
})

/**
 * capabilities 有两份数据：config/editions.json（构建/Electron 侧读）和
 * edition.ts 里的硬编码表（web 运行时读，App.tsx 靠它决定渲染哪些入口）。
 * 两份曾经漂移过——json 与设计文档都是 agent 不显示续费，硬编码那份却是 true，
 * 导致代理商版实际显示了续费按钮。这条测试锁住两者一致。
 */
describe('capabilities 与 config/editions.json 一致', () => {
  const editions: Record<string, { capabilities: Record<string, boolean> }> =
    JSON.parse(readFileSync(new URL('../../config/editions.json', import.meta.url), 'utf8'))

  it('两份数据覆盖同样的版本', () => {
    expect(Object.keys(editions).sort()).toEqual(['agent', 'main'])
  })

  it.each(['main', 'agent'] as const)('%s 版两份一致', (id) => {
    const fromJson = editions[id]?.capabilities
    expect(fromJson).toBeDefined()
    expect(getEditionCapabilities(id)).toEqual(fromJson)
  })
})
