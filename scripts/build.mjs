// 打包：bun run build
//   dist/        → 部署到 GitHub Pages 的正式版
//   dist-demo/   → 單一 HTML 檔的試用版（不連 Supabase，資料存在瀏覽器）
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const r = (...p) => join(root, ...p);
const version = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

await rm(r('dist'), { recursive: true, force: true });
await rm(r('dist-demo'), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [r('src/main.jsx')],
  outdir: r('dist/assets'),
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
  naming: { entry: '[name]-[hash].[ext]', asset: '[name]-[hash].[ext]', chunk: '[name]-[hash].[ext]' },
  define: { 'process.env.NODE_ENV': '"production"', __APP_VERSION__: JSON.stringify(version) },
});
if (!result.success) {
  for (const m of result.logs) console.error(m);
  process.exit(1);
}
const outs = result.outputs.map((o) => relative(r('dist'), o.path));
const js = outs.find((p) => p.endsWith('.js'));
const css = outs.find((p) => p.endsWith('.css'));

// 正式版
await cp(r('public'), r('dist'), { recursive: true });
const tpl = await readFile(r('index.html'), 'utf8');
const html = tpl
  .replace('<!--APP_CSS-->', css ? `<link rel="stylesheet" href="${css}">` : '')
  .replace('<!--APP_JS-->', `<script type="module" src="${js}"></script>`);
await writeFile(r('dist/index.html'), html);
const files = ['./', './index.html', './manifest.webmanifest', ...outs.map((p) => `./${p}`),
  ...(await readdir(r('public/icons'))).map((f) => `./icons/${f}`)];
const sw = (await readFile(r('public/sw.js'), 'utf8')).replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(files));
await writeFile(r('dist/sw.js'), sw);
await writeFile(r('dist/404.html'), html); // GitHub Pages：任何路徑都回到 app
await writeFile(r('dist/.nojekyll'), '');

// 試用版：把 CSS、JS 都塞進同一個 HTML
await mkdir(r('dist-demo'), { recursive: true });
const jsText = (await readFile(r('dist', js), 'utf8')).replace(/<\/script/gi, '<\\/script');
const cssText = css ? await readFile(r('dist', css), 'utf8') : '';
const demo = tpl
  .replace('<script src="config.js"></script>', '<script>window.APP_CONFIG={appName:"小綠記帳",demoOnly:true}</script>')
  .replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n?\s*/g, '')
  .replace('<title>小綠記帳</title>', '<title>小綠記帳（試用）</title>')
  .replace('<!--APP_CSS-->', `<style>${cssText}</style>`)
  .replace('<!--APP_JS-->', `<script type="module">${jsText}</script>`);
await writeFile(r('dist-demo/index.html'), demo);

const size = (await readFile(r('dist', js))).length;
console.log(`版本 ${version}：${js}（${(size / 1024).toFixed(0)} KB）、${css}`);
