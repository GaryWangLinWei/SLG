import { describe, expect, it } from 'vitest'
import { createViteConfig } from './vite.config'

describe('createViteConfig', () => {
  it('defaults the dev server to the main edition', () => {
    expect(createViteConfig('serve').define).toEqual({
      'import.meta.env.VITE_APP_EDITION': JSON.stringify('main'),
    })
  })

  it('rejects production builds without an explicit edition', () => {
    expect(() => createViteConfig('build', '')).toThrow(/VITE_APP_EDITION/)
  })
})
