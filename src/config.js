// 執行時設定：從 /config.js 讀（部署時由 GitHub Actions 產生，也可以直接改那個檔案，不用重新打包）
/* global __APP_VERSION__ */
const cfg = (typeof window !== 'undefined' && window.APP_CONFIG) || {};

export const APP = {
  name: cfg.appName || '小綠記帳',
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  demoOnly: !!cfg.demoOnly,
};

export const SUPABASE = {
  url: (cfg.supabaseUrl || '').replace(/\/$/, ''),
  key: cfg.supabasePublishableKey || '',
};

export const hasSupabase = !APP.demoOnly && !!(SUPABASE.url && SUPABASE.key);
