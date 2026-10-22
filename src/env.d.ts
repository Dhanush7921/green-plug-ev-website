interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_LEADS_ENDPOINT?: string;
  readonly VITE_PLAY_STORE_URL?: string;
  readonly VITE_APP_STORE_URL?: string;
  readonly VITE_CONTACT_EMAIL?: string;
  readonly VITE_BRAND_NAME?: string;
  readonly VITE_ROUTER?: 'hash' | 'history';
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.woff' {
  const src: string;
  export default src;
}
declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.css';

interface Document {
  startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void>; ready: Promise<void> };
}
