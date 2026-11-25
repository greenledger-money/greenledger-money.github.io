// 股價與匯率更新（Supabase Edge Function）。由資料庫排程（pg_cron）定時呼叫：
//   盤中：開盤時間每 10 分鐘 { mode: 'intraday' }；每日：收盤後 { mode: 'daily' }
//   補歷史（手動）：{ mode: 'history' } → 從第一筆股票交易開始的每日收盤價與美元匯率
// 實際邏輯跟 GitHub Actions 共用 update-market-data.mjs（部署時從 scripts/ 複製過來）。
import { runHistory, runUpdate } from './update-market-data.mjs';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** 只接受資料庫排程呼叫：比對 vault 裡的暗號 */
async function allowed(token: string | null) {
  if (!token) return false;
  const res = await fetch(`${URL_}/rest/v1/rpc/market_cron_ok`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return res.ok && (await res.json()) === true;
}

Deno.serve(async (req) => {
  if (!(await allowed(req.headers.get('x-cron-secret')))) return new Response('forbidden', { status: 403 });
  const { mode } = await req.json().catch(() => ({}));
  const lines: string[] = [];
  const log = {
    log: (...a: unknown[]) => lines.push(a.join(' ')),
    warn: (...a: unknown[]) => lines.push(`⚠ ${a.join(' ')}`),
    error: (...a: unknown[]) => lines.push(`✗ ${a.join(' ')}`),
  };
  try {
    const { failures } = mode === 'history'
      ? await runHistory({ base: URL_, key: KEY, log })
      : await runUpdate({ base: URL_, key: KEY, intraday: mode === 'intraday', log });
    console.log(`[${mode}] ${lines.join(' | ')}`);
    return Response.json({ ok: failures === 0, failures, lines });
  } catch (e) {
    console.error(`[${mode}] ${(e as Error).message}`);
    return Response.json({ ok: false, error: (e as Error).message, lines }, { status: 500 });
  }
});
