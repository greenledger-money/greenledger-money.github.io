// 分類樹：把扁平的分類列表組成樹，提供路徑名稱（飲食-早餐）、深度、子孫等查詢。
// 檢查規則跟資料庫觸發器一致（前端先擋，資料庫再保證一次）。

export const MAX_DEPTH = 3;

export function buildTree(categories) {
  const byId = new Map();
  for (const c of categories) byId.set(c.id, { ...c, children: [] });
  const roots = { expense: [], income: [] };
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots[node.kind]?.push(node);
  }
  const sorter = (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'zh-Hant');
  for (const node of byId.values()) node.children.sort(sorter);
  roots.expense.sort(sorter);
  roots.income.sort(sorter);

  /** 由上到下的祖先鏈（含自己）：['飲食', '早餐'] 的節點 */
  function chain(id) {
    const out = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 10) { out.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
    return out;
  }
  const path = (id, sep = '-') => chain(id).map((n) => n.name).join(sep) || '（已刪除的分類）';
  const depth = (id) => chain(id).length;
  function height(id) {
    const n = byId.get(id);
    if (!n || n.children.length === 0) return 1;
    return 1 + Math.max(...n.children.map((c) => height(c.id)));
  }
  function descendants(id) {
    const set = new Set();
    const walk = (n) => { set.add(n.id); n.children.forEach(walk); };
    const n = byId.get(id);
    if (n) walk(n);
    return set;
  }
  const bySystemKey = (key) => categories.find((c) => c.system_key === key) ?? null;
  return { byId, roots, chain, path, depth, height, descendants, bySystemKey };
}

/**
 * 檢查新增／修改分類是否合法；合法回傳 null，否則回傳錯誤訊息。
 * draft: { id?, parent_id, kind, name }
 */
/** 這個分類（或它的上層）有沒有設成「一律算例外」。回傳設定的那一層，沒有就 null */
export function exceptionSource(tree, id, list = []) {
  if (!id || !list?.length) return null;
  return tree.chain(id).find((n) => list.includes(n.id)) ?? null;
}

export function validateCategory(tree, draft) {
  const name = (draft.name ?? '').trim();
  if (!name) return '請輸入分類名稱';
  if (name.length > 30) return '分類名稱最多 30 個字';
  const siblings = draft.parent_id ? tree.byId.get(draft.parent_id)?.children ?? [] : tree.roots[draft.kind] ?? [];
  if (siblings.some((s) => s.id !== draft.id && s.name === name)) return '同一層已經有這個名稱';

  let parentDepth = 0;
  if (draft.parent_id) {
    const parent = tree.byId.get(draft.parent_id);
    if (!parent) return '找不到上層分類';
    if (parent.kind !== draft.kind) return '子分類的收支類型要跟上層一樣';
    if (draft.id && tree.chain(parent.id).some((n) => n.id === draft.id)) return '不能把分類搬到自己的子分類底下';
    parentDepth = tree.depth(parent.id);
  }
  const subtree = draft.id ? tree.height(draft.id) : 1;
  if (parentDepth + subtree > MAX_DEPTH) return draft.id ? '分類最多三層（搬移時連子分類一起算）' : '分類最多三層';
  return null;
}

/** 可以當作「上層」的分類（給新增/搬移的選單用） */
export function parentOptions(tree, kind, movingId = null) {
  const out = [];
  const moving = movingId ? tree.byId.get(movingId) : null;
  const need = moving ? tree.height(movingId) : 1;
  const walk = (n, d) => {
    if (moving && tree.descendants(movingId).has(n.id)) return;
    if (d + need <= MAX_DEPTH) out.push({ id: n.id, label: tree.path(n.id, ' › '), depth: d });
    n.children.forEach((c) => walk(c, d + 1));
  };
  tree.roots[kind].forEach((r) => walk(r, 1));
  return out;
}
