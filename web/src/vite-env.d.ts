/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_EDITION: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
