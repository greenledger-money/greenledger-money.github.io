// 異地備份（Supabase Edge Function）。由資料庫排程（pg_cron）每天呼叫一次：
//   1. 拿資料庫裡最新的快照（backup_latest）
//   2. gzip 壓縮；有設 BACKUP_PASSPHRASE 才另外加密（AES-256-GCM）
//   3. 推到「私人」GitHub repo：daily/2026/11/2026-11-28.json.gz（加密的是 .glbk；每天一個檔，git 歷史也會留著）
//   4. 結果記到 backup.log（backup_mark_offsite），app 會顯示上次成功的時間
// 需要的 Edge Function secrets：BACKUP_GITHUB_TOKEN、BACKUP_GITHUB_REPO（owner/repo）；BACKUP_PASSPHRASE 可不設
// 加密程式和解密腳本共用 backup-crypto.mjs（從 scripts/ 複製過來）。
import { packBackup, readBackup, toBase64 } from './backup-crypto.mjs';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PASS = Deno.env.get('BACKUP_PASSPHRASE') ?? '';
const TOKEN = Deno.env.get('BACKUP_GITHUB_TOKEN') ?? '';
const REPO = Deno.env.get('BACKUP_GITHUB_REPO') ?? '';

const rpc = async (fn: string, body: unknown = {}) => {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn}：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com${path}`, {
  ...init,
  headers: {
    Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'greenledger-backup', ...(init.headers ?? {}),
  },
});

/** 台北日期 */
const taipeiDate = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10);

async function run() {
  const missing = [!TOKEN && 'BACKUP_GITHUB_TOKEN', !REPO && 'BACKUP_GITHUB_REPO'].filter(Boolean);
  if (missing.length) throw new Error(`還沒設定：${missing.join('、')}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) throw new Error('BACKUP_GITHUB_REPO 格式要是 owner/repo');

  // 安全檢查：備份只能放在私人 repo
  const info = await gh(`/repos/${REPO}`);
  if (!info.ok) throw new Error(`讀不到 repo ${REPO}（HTTP ${info.status}），請確認 token 權限`);
  if (!(await info.json()).private) throw new Error(`${REPO} 不是私人 repo，拒絕上傳`);

  const snap = await rpc('backup_latest');
  if (!snap) throw new Error('資料庫裡還沒有快照');
  const ageH = (Date.now() - new Date(snap.taken_at).getTime()) / 3600e3;

  const payload = { format: 'greenledger-backup', snapshot_id: snap.id, taken_at: snap.taken_at, checksum: snap.checksum, counts: snap.counts, data: snap.data };
  const { bytes, ext } = await packBackup(payload, PASS);
  // 上傳前先解開一次，確定這個檔真的還原得回來
  const back = await readBackup(bytes, PASS);
  if (JSON.stringify(back) !== JSON.stringify(payload)) throw new Error('備份檔解不回原本的內容，不上傳');

  const day = taipeiDate(snap.taken_at);
  const path = `daily/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.${ext}`;
  const existing = await gh(`/repos/${REPO}/contents/${path}`);
  const sha = existing.ok ? (await existing.json()).sha : undefined;
  const put = await gh(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `備份 ${day}（快照 #${snap.id}）`, content: toBase64(bytes), ...(sha ? { sha } : {}) }),
  });
  if (!put.ok) throw new Error(`上傳失敗：HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);

  const kb = Math.round(bytes.length / 1024);
  return `${path}（${kb} KB，快照 #${snap.id}${ageH > 26 ? `，⚠ 快照已經 ${Math.round(ageH)} 小時沒更新` : ''}）`;
}

Deno.serve(async (req) => {
  const token = req.headers.get('x-cron-secret');
  const ok = token && (await rpc('market_cron_ok', { token }).catch(() => false)) === true;
  if (!ok) return new Response('forbidden', { status: 403 });
  try {
    const detail = await run();
    await rpc('backup_mark_offsite', { p_ok: true, p_detail: detail });
    console.log(`[backup] ${detail}`);
    return Response.json({ ok: true, detail });
  } catch (e) {
    const msg = (e as Error).message;
    await rpc('backup_mark_offsite', { p_ok: false, p_detail: msg }).catch(() => {});
    console.error(`[backup] ${msg}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
