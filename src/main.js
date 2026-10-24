import './ui/styles.css';
import { App } from './ui/app.js';

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.app = new App();
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `<pre style="color:#f87171;padding:20px;font:13px monospace">Başlatma hatası:\n${e.stack || e}</pre>`;
  }
});
