// 把資料庫／網路錯誤翻成看得懂的中文

export function friendlyError(e) {
  const msg = String(e?.message ?? e ?? '');
  const code = e?.code;
  if (/[一-鿿]/.test(msg) && !/violates/.test(msg)) return msg; // 本來就是中文（資料庫觸發器或前端檢查）
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return '連不上網路，請稍後再試';
  if (code === '23503' || /foreign key/i.test(msg)) {
    if (/accounts/.test(msg)) return '這個帳戶已經有交易，不能刪除，只能隱藏';
    if (/categories/.test(msg)) return '這個分類已經有交易或子分類，不能刪除，只能封存';
    return '還有其他資料用到它，不能刪除';
  }
  if (code === '23505' || /duplicate key/i.test(msg)) {
    if (/accounts_user_id_name/.test(msg)) return '已經有同名的帳戶';
    if (/categories_user_id_parent_id_kind_name/.test(msg)) return '同一層已經有這個名稱';
    if (/pending_item_id/.test(msg)) return '這筆待確認項目已經處理過了';
    if (/order_no/.test(msg)) return '這個委託書號已經記過了';
    return '資料重複了';
  }
  if (/Invalid login credentials/i.test(msg)) return 'Email 或密碼不對';
  if (/Email not confirmed|email_not_confirmed/i.test(msg)) return '還沒完成 Email 驗證，請先點信裡的連結';
  if (/User already registered/i.test(msg)) return '這個 Email 已經註冊過了，請直接登入';
  if (/Password should be at least/i.test(msg)) return '密碼至少要 6 個字元';
  if (/rate limit/i.test(msg)) return '操作太頻繁，請稍等一下再試';
  if (/JWT expired|refresh_token/i.test(msg)) return '登入已過期，請重新登入';
  if (/NotAllowedError|The operation either timed out or was not allowed/i.test(msg)) return '已取消';
  return msg || '發生錯誤';
}
