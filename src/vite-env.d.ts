/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_BUBBLE_API_URL: string
  readonly VITE_BACKEND_URL: string
  readonly VITE_DEMO_MODE?: string
  readonly VITE_DEV_AUTH_BYPASS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
