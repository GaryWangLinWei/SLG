export type AppEdition = 'main' | 'agent'

export interface EditionCapabilities {
  readonly showPurchaseEntry: boolean
  readonly showRenewEntry: boolean
}

const EDITION_CAPABILITIES: Readonly<Record<AppEdition, EditionCapabilities>> = Object.freeze({
  main: Object.freeze({
    showPurchaseEntry: true,
    showRenewEntry: true,
  }),
  agent: Object.freeze({
    showPurchaseEntry: false,
    showRenewEntry: true,
  }),
})

export function resolveEdition(value: unknown): AppEdition {
  if (value === 'main' || value === 'agent') {
    return value
  }

  throw new Error('VITE_APP_EDITION must be set to "main" or "agent"')
}

export function getEditionCapabilities(edition: AppEdition): EditionCapabilities {
  return EDITION_CAPABILITIES[edition]
}

export const appEdition = resolveEdition(import.meta.env.VITE_APP_EDITION)
export const editionCapabilities = getEditionCapabilities(appEdition)
