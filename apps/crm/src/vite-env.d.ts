/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the stimuliiq API (e.g. http://localhost:4000). See .env.example. */
  readonly VITE_API_URL?: string;
  /** Origin of the public marketing site (apps/web) — used for "View live page" links and
   *  page-builder image-preview `/images/...` resolution. See .env.example. */
  readonly VITE_WEB_APP_URL?: string;
  /** CDN base for minted storage object keys (page-builder image-key preview thumbnails).
   *  Mirrors the API's `PUBLIC_ASSET_BASE_URL` default. See .env.example. */
  readonly VITE_ASSET_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
