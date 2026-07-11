/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REGISTRATION_PUBLIC_ORIGIN?: string;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
