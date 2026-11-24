// 入口：掛上 React，註冊 Service Worker（讓 app 可以加入主畫面、離線也能打開看快取）
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 預覽環境不支援就算了 */ });
  });
}
