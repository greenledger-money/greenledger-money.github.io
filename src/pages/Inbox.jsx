// 捷徑與自動記帳：iPhone 捷徑（Siri 說「記一筆」）、Gmail 信用卡消費通知 → 待確認
import { useEffect, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Field, Page, Section, Seg, back, useAction, useUI } from '../ui/kit.jsx';
import { AccountSelect } from '../ui/pickers.jsx';
import { gmailScript } from '../lib/gmailScript.js';

/** 產生一組新的記帳碼：亂數 32 bytes（base64url），資料庫只存 sha256 */
async function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { token, hash };
}

const when = (iso) => (iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '還沒用過');

export default function Inbox() {
  const { data, actions, backend, user } = useLedger();
  const { toast, confirm } = useUI();
  const [run, busy] = useAction();
  const [tokens, setTokens] = useState(null);
  const [fresh, setFresh] = useState(null); // { token, label }：剛產生的，只顯示這一次
  const [tab, setTab] = useState('shortcut');
  const api = backend.inboxTokens;

  useEffect(() => { if (api) api.list().then(setTokens).catch(() => setTokens([])); }, [api]);

  if (user.demo || !api) {
    return <Page title="捷徑與自動記帳" onBack={() => back('more')}><div className="card">試用模式不能用，登入後再設定。</div></Page>;
  }

  async function create(label) {
    await run(async () => {
      const { token, hash } = await newToken();
      const row = await api.add({ token_hash: hash, label });
      setTokens((l) => [...(l ?? []), row]);
      setFresh({ token, label });
    });
  }
  async function remove(t) {
    if (!(await confirm(`停用「${t.label || '記帳碼'}」？用這組碼的捷徑或 Gmail 會失效。`, { ok: '停用', danger: true }))) return;
    await run(async () => { await api.remove(t.id); setTokens((l) => l.filter((x) => x.id !== t.id)); }, '已停用');
  }
  const copy = async (text, what = '已複製') => {
    try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('複製失敗，請手動選取'); }
  };
  const token = fresh?.token ?? '';
  const script = gmailScript({ url: backend.inboxUrl, key: backend.inboxKey, token: fresh?.label === 'Gmail' ? token : '' });
  const body = JSON.stringify({ token: fresh?.label === 'iPhone 捷徑' ? token : '記帳碼', item: { amount: '金額', category: '分類', note: '備註' } });

  return (
    <Page title="捷徑與自動記帳" onBack={() => back('more')}>
      <Seg value={tab} onChange={setTab} options={[{ value: 'shortcut', label: 'iPhone 捷徑' }, { value: 'gmail', label: 'Gmail 刷卡通知' }]} />

      {fresh && fresh.label === (tab === 'gmail' ? 'Gmail' : 'iPhone 捷徑') && (
        <div className="card form token-card">
          <b>你的記帳碼（{fresh.label}）</b>
          <code className="token">{fresh.token}</code>
          <div className="small muted">只會顯示這一次，離開這頁就看不到了。不要給別人，外流的話在下面停用就好。</div>
          <button className="btn primary" onClick={() => copy(fresh.token, '已複製記帳碼')}>複製記帳碼</button>
        </div>
      )}

      {tab === 'shortcut' ? (
        <>
          <Section title="做好之後">
            <div className="card small">
              跟 Siri 說「<b>記一筆</b>」→ 說金額 → 選分類，不用打開 App 就記好了。
              分類、帳戶對得到會直接記；對不到的會進首頁「待確認」，點一下補完。
            </div>
          </Section>
          <Section title="設定步驟">
            <ol className="card steps">
              <li>下面按「產生 iPhone 捷徑用的記帳碼」，複製起來。</li>
              <li>打開「捷徑」App › 右上角 <b>＋</b>，名稱改成「記一筆」。</li>
              <li>加入「<b>要求輸入</b>」：類型選「數字」，提示寫「金額」。</li>
              <li>加入「<b>從清單中選擇</b>」：清單放你常用的分類（例如 早餐、午餐、晚餐、飲料、交通），可以用「飲食-午餐」這樣寫完整路徑。</li>
              <li>加入「<b>取得 URL 內容</b>」：
                <div className="kv"><span>URL</span><code onClick={() => copy(backend.inboxUrl)}>{backend.inboxUrl}</code></div>
                <div className="kv"><span>方法</span><code>POST</code></div>
                <div className="kv"><span>標頭</span><code onClick={() => copy(backend.inboxKey)}>apikey：{backend.inboxKey}</code></div>
                <div className="kv"><span>要求本文</span><code>JSON</code></div>
                <div className="small muted">JSON 裡加：token（文字，貼記帳碼）、item（字典：amount＝「要求輸入」的結果、category＝「從清單中選擇」的結果，想要的話再加 note、account）。</div>
                <button className="btn small" onClick={() => copy(body, '已複製範例')}>複製 JSON 範例</button>
              </li>
              <li>最後加「<b>顯示通知</b>」，內容選「URL 的內容」，記好會顯示 recorded（已記）或 pending（待確認）。</li>
            </ol>
          </Section>
          {fresh?.label !== 'iPhone 捷徑' && <button className="btn primary block" disabled={busy} onClick={() => create('iPhone 捷徑')}>產生 iPhone 捷徑用的記帳碼</button>}
        </>
      ) : (
        <>
          <Section title="會怎麼運作">
            <div className="card small">
              Gmail 收到國泰世華的消費通知信，每 10 分鐘自動送進首頁「待確認」，點一下選分類就記好。同一封信不會重複。
              <div className="notice warn" style={{ marginTop: 8 }}>國泰世華的 Email 通知只有<b>單筆 3,000 元以上</b>才會寄，小額的只在 CUBE App／LINE，還是要自己記。</div>
            </div>
          </Section>
          <Section title="通知信記到哪個帳戶">
            <div className="card form">
              <Field label="信用卡帳戶">
                <AccountSelect value={data.settings.emailAccountId ?? null} onChange={(v) => run(() => actions.updateSettings({ emailAccountId: v }), '已儲存')}
                  filter={(a) => a.type === 'credit_card'} allowEmpty placeholder="確認時再選" />
              </Field>
            </div>
          </Section>
          <Section title="設定步驟（只要做一次）">
            <ol className="card steps">
              <li>下面按「產生 Gmail 用的記帳碼」。</li>
              <li>電腦打開 <b>script.google.com</b>，用收通知信的 Google 帳號登入 › 新專案。</li>
              <li>把裡面的程式全部刪掉，貼上下面複製的程式（記帳碼已經放進去了）。</li>
              <li>上方函式選「<b>setup</b>」按「執行」，照畫面允許讀取 Gmail。完成。</li>
            </ol>
          </Section>
          {fresh?.label === 'Gmail'
            ? <button className="btn primary block" onClick={() => copy(script, '已複製程式')}>複製 Gmail 程式</button>
            : <button className="btn primary block" disabled={busy} onClick={() => create('Gmail')}>產生 Gmail 用的記帳碼</button>}
          <details className="card small"><summary>看程式內容</summary><pre className="code">{script}</pre></details>
        </>
      )}

      <Section title="使用中的記帳碼">
        <div className="list">
          {tokens == null ? <div className="item muted">讀取中…</div>
            : tokens.length === 0 ? <div className="item muted">還沒有</div>
              : tokens.map((t) => (
                <div key={t.id} className="item">
                  <div className="main"><div className="title">{t.label || '記帳碼'}</div><div className="sub">最後使用：{when(t.last_used_at)}</div></div>
                  <button className="btn small danger" disabled={busy} onClick={() => remove(t)}>停用</button>
                </div>
              ))}
        </div>
      </Section>
    </Page>
  );
}
