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

  it('hides purchase but keeps renewal available for agent', () => {
    const capabilities = getEditionCapabilities('agent')

    expect(capabilities).toEqual({
      showPurchaseEntry: false,
      showRenewEntry: true,
    })
    expect(Object.keys(capabilities).sort()).toEqual([
      'showPurchaseEntry',
      'showRenewEntry',
    ])
  })
})
