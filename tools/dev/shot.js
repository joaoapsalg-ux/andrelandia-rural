// Captura de tela sem navegador aberto (Playwright + Chromium com SwiftShader).
// Uso: (com o serve.py rodando)  node tools/dev/shot.js saida.png [espera_ms] [script.js]
//   script.js roda na página depois de window.app existir (ex.: abrir uma ficha, mudar a superfície).
// Instalar uma vez: npm i -D playwright && npx playwright install chromium
// SwiftShader é lento (≈1 quadro/s): animações não completam; prefira conferir o estado via script.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out = 'shot.png', wait = '15000', scriptFile] = process.argv.slice(2);
  const vp = process.env.VP;   // ex.: VP=390x844 para celular
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: vp ? { width: +vp.split('x')[0], height: +vp.split('x')[1] } : { width: 1280, height: 820 }, isMobile: !!vp, hasTouch: !!vp });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await page.goto(process.env.URL || 'http://localhost:8000/');
  await page.waitForFunction(() => window.app, null, { timeout: 120000 });
  if (scriptFile) { const r = await page.evaluate(fs.readFileSync(scriptFile, 'utf8')); if (r !== undefined) console.log('resultado:', JSON.stringify(r)); }
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: out, timeout: 240000 });
  await browser.close();
})();
