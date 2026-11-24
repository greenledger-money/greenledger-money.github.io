// 本機開發：bun run dev → 打包並在 http://localhost:5173 開啟，改檔案會自動重新打包（重新整理頁面即可）
import { watch } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const build = () => Bun.spawnSync(['bun', join(root, 'scripts/build.mjs')], { stdout: 'inherit', stderr: 'inherit' });
build();
let timer;
watch(join(root, 'src'), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(build, 200); });

Bun.serve({
  port: Number(process.env.PORT) || 5173,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(join(root, 'dist', path.endsWith('/') ? `${path}index.html` : path));
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(root, 'dist/index.html')));
  },
});
console.log('開發伺服器：http://localhost:5173');
