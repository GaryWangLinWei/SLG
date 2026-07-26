import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const homeSource = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8')

describe('Home help icons', () => {
  it.each([
    ['账号调度', '账号调度说明'],
    ['组合采集', '组合采集说明'],
  ])('keeps the round help icon beside %s', (_label, ariaLabel) => {
    expect(homeSource).toContain(`aria-label="${ariaLabel}"`)
  })
})
