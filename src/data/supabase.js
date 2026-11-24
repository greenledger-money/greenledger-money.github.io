// 正式模式的後端：Supabase（Postgres＋Auth）。
// supabase-js 在執行時從 CDN 載入，所以專案本身不用安裝它。
// 前端只放 publishable key；所有權限由資料庫的 Row Level Security 保證。

import { TABLES } from './relations.js';

// Passkey 需要 supabase-js 2.105.0 以上
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const PAGE = 1000;
const CHUNK = 500;

const unwrap = ({ data, error }) => { if (error) throw error; return data; };

export async function createSupabaseBackend({ url, key }) {
  const sdk = SDK_URL;
  const { createClient } = await import(/* @vite-ignore */ sdk);
  const sb = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, experimental: { passkey: true } },
  });

  const toUser = (u) => (u ? { id: u.id, email: u.email, demo: false } : null);

  async function selectAll(table, build = (q) => q) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = unwrap(await build(sb.from(table).select('*')).order(table === 'profiles' ? 'user_id' : 'id').range(from, from + PAGE - 1));
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  const redirect = () => `${location.origin}${location.pathname}`;

  return {
    kind: 'supabase',
    client: sb,
    async getUser() {
      const { data } = await sb.auth.getSession();
      return toUser(data.session?.user);
    },
    onAuth(cb) {
      const { data } = sb.auth.onAuthStateChange((event, session) => cb(toUser(session?.user), event));
      return () => data.subscription.unsubscribe();
    },
    async signUp(email, password) {
      return unwrap(await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } }));
    },
    async signIn(email, password) { return unwrap(await sb.auth.signInWithPassword({ email, password })); },
    async resetPassword(email) { return unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() })); },
    async updatePassword(password) { return unwrap(await sb.auth.updateUser({ password })); },
    async signOut() { await sb.auth.signOut(); },
    async deleteAccount() {
      unwrap(await sb.rpc('delete_my_account'));
      await sb.auth.signOut({ scope: 'local' });
    },
    passkey: {
      supported: typeof window !== 'undefined' && !!window.PublicKeyCredential && typeof sb.auth.signInWithPasskey === 'function',
      signIn: async () => unwrap(await sb.auth.signInWithPasskey()),
      register: async () => unwrap(await sb.auth.registerPasskey()),
      list: async () => unwrap(await sb.auth.passkey.list()) ?? [],
      remove: async (passkeyId) => unwrap(await sb.auth.passkey.delete({ passkeyId })),
    },

    async loadAll() {
      const entries = await Promise.all(TABLES.map(async (t) => [t, await selectAll(t)]));
      return Object.fromEntries(entries);
    },

    /** 公開資料：用到的幣別的匯率、持有股票最近 13 個月的收盤價 */
    async loadShared({ currencies = [], symbols = [], since }) {
      const [fx_rates, stock_prices] = await Promise.all([
        currencies.length ? selectAll('fx_rates', (q) => q.in('currency', currencies)) : [],
        symbols.length ? selectAll('stock_prices', (q) => q.in('symbol', symbols).gte('price_date', since)) : [],
      ]);
      return { fx_rates, stock_prices };
    },

    async insert(table, rows, { ignoreDuplicates = false, onConflict } = {}) {
      const out = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const q = sb.from(table);
        const res = ignoreDuplicates || onConflict
          ? await q.upsert(chunk, { onConflict, ignoreDuplicates, defaultToNull: false }).select()
          : await q.insert(chunk, { defaultToNull: false }).select();
        out.push(...unwrap(res));
      }
      return out;
    },

    async update(table, id, patch) {
      const keyCol = table === 'profiles' ? 'user_id' : 'id';
      return unwrap(await sb.from(table).update(patch).eq(keyCol, id).select().single());
    },

    async remove(table, ids) {
      // id 放在網址裡，一次 100 個以免網址太長
      for (let i = 0; i < ids.length; i += 100) {
        unwrap(await sb.from(table).delete().in('id', ids.slice(i, i + 100)));
      }
    },

    /** 刪掉之前從 CW 匯入的交易（重新匯入用） */
    async removeImported() {
      unwrap(await sb.from('transactions').delete().eq('source', 'cw_import'));
    },
  };
}
