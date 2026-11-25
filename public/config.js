// 部署設定。只放「publishable key」（本來就會公開在網頁上），絕對不要放 secret key。
// 改了這裡 push 上去就生效；也可以在 GitHub repo 的 Variables 設定 SUPABASE_URL 等值來覆蓋。
window.APP_CONFIG = {
  appName: '小綠記帳',
  supabaseUrl: 'https://qopkoivdrildkdihnyto.supabase.co',
  supabasePublishableKey: 'sb_publishable_bzSSQ8NQzxxY-oUHMfNYdg_IEhJOANh',
};
