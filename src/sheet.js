// "Folha da propriedade": uma imagem A4 (1240×1754, 150 dpi) para guardar, imprimir ou mandar ao técnico —
// vista 3D, números da ficha, a terra de 1985 a 2025, vizinhos e o aviso de que tudo é estimativa do app.
import { CRITERIA, GROUP_COLORS, relevoOf } from './car.js';
import { CLASSES } from '../data/muni/landuse.js';

const W = 1240, H = 1754, M = 64, GAP = 40, COL = (W - 2 * M - GAP) / 2;
const C = { paper: '#fbfaf5', ink: '#1d2621', soft: '#56625a', line: '#c9cfc4', accent: '#1e5d86', warm: '#7a4a26' };
const F = {
  disp: (wt, px) => `${wt} ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`,
  body: (wt, px) => `${wt} ${px}px Barlow, system-ui, sans-serif`,
  mono: (wt, px) => `${wt} ${px}px "IBM Plex Mono", ui-monospace, monospace`,
};

/**
 * monta a folha e devolve um Blob PNG
 * x: propriedade escolhida · car: CarLayer · view: canvas com a vista 3D · water: resultado de PropertyWater.show ou null
 */
export async function buildSheet({ x, car, view, water, access, agro, vigor, nf, fmtDate, exag, today = new Date() }) {
  await Promise.all(['700 72px "Barlow Condensed"', '600 20px "Barlow Condensed"', '400 18px Barlow', '600 18px Barlow', '400 18px "IBM Plex Mono"', '500 18px "IBM Plex Mono"']
    .map((f) => document.fonts?.load(f).catch(() => null)));
  const f = x.f, s = f.s;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const spacing = (px) => { if ('letterSpacing' in g) g.letterSpacing = `${px}px`; };
  const text = (t, px, py, font, color = C.ink, align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(t, px, py); return g.measureText(t).width; };
  // texto corrido com quebra de linha; devolve o y da próxima linha
  const wrap = (t, px, py, maxW, font, color = C.ink, lh = 24) => {
    g.font = font; g.fillStyle = color; g.textAlign = 'left';
    let line = '';
    for (const word of t.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxW && line) { g.fillText(line, px, py); py += lh; line = word; } else line = test;
    }
    if (line) { g.fillText(line, px, py); py += lh; }
    return py;
  };
  // rótulo em texto comum + valor em fonte de dados, na mesma linha
  const kv = (label, value, px, py, maxW = COL) => {
    const lw = text(label, px, py, F.body(400, 18), C.soft);
    g.font = F.mono(500, 18);
    let v = value;
    while (g.measureText(v).width > maxW - lw - 8 && v.length > 4) v = v.slice(0, -2) + '…';
    text(v, px + lw + 8, py, F.mono(500, 18), C.ink);
    return py + 28;
  };
  const head = (t, px, py, w = COL) => {
    spacing(2.5); text(t.toUpperCase(), px, py, F.disp(600, 18), C.soft); spacing(0);
    g.fillStyle = C.line; g.fillRect(px, py + 9, w, 1.5);
    return py + 38;
  };

  g.fillStyle = C.paper; g.fillRect(0, 0, W, H);

  // cabeçalho
  let y = M + 14;
  spacing(3); text('ANDRELÂNDIA RURAL · FOLHA DA PROPRIEDADE', M, y, F.disp(600, 20), C.soft); spacing(0);
  const pad = (v) => String(v).padStart(2, '0');   // data local (toISOString seria UTC: à noite já é amanhã)
  text(`${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`, W - M, y, F.mono(400, 18), C.soft, 'right');
  y += 70;
  const size = CRITERIA.tamanho.buckets[CRITERIA.tamanho.of(f)]?.[0].split(' (')[0] ?? '';
  const tw = text(`${nf(f.ha, f.ha < 10 ? 2 : 1)} ha`, M, y, F.disp(700, 72), C.ink);
  text(size === 'Minifúndio' ? 'minifúndio' : size ? `propriedade ${size.toLowerCase()}` : '', M + tw + 16, y, F.disp(600, 34), C.soft);
  y += 38;
  const st = CRITERIA.situacao.buckets[CRITERIA.situacao.of(f)];
  text(`${nf(f.mf, 2)} ${f.mf < 2 ? 'módulo fiscal' : 'módulos fiscais'} · ${f.mun} (MG) · ${st[0]}`, M, y, F.mono(400, 19), C.warm);
  y += 28;
  text(`CAR ${f.cod}`, M, y, F.mono(400, 16), C.soft);
  y += 26;

  // vista 3D (recorte "cover")
  const ih = agro ? 430 : 560, iw = W - 2 * M, sc = Math.max(iw / view.width, ih / view.height);
  const sw = iw / sc, sh = ih / sc;
  g.drawImage(view, (view.width - sw) / 2, (view.height - sh) / 2, sw, sh, M, y, iw, ih);
  g.strokeStyle = C.line; g.lineWidth = 1.5; g.strokeRect(M + 0.75, y + 0.75, iw - 1.5, ih - 1.5);
  y += ih + 26;
  y = wrap(`Vista 3D com o relevo exagerado ${nf(exag, 1)}×. Branco: contorno declarado no CAR · tracejado: vizinhos${water ? ' · azul: área que drena para ela e córregos' : ''}.`, M, y, iw, F.body(400, 16), C.soft, 22);
  if (!s) return new Promise((res) => cv.toBlob(res, 'image/png'));
  y += 18;

  // linha 1: a terra de 1985 a 2025 | uso do solo hoje
  const top = y, xR = M + COL + GAP;
  const hist = car.histOf(x.k);
  y = head('A terra de 1985 a 2025', M, y);
  if (hist) {
    const yrs = car.data.hist_years, grp = car.data.hist_groups, ch = 110, X =(k) => M + (k / (yrs.length - 1)) * COL, Y = (p) => y + ch - (p / 100) * ch;
    const acc = yrs.map(() => 0);
    grp.forEach((name, i) => {
      g.beginPath();
      yrs.forEach((_, k) => g.lineTo(X(k), Y(acc[k] + hist[k][i])));
      for (let k = yrs.length - 1; k >= 0; k--) g.lineTo(X(k), Y(acc[k]));
      g.closePath(); g.fillStyle = GROUP_COLORS[i]; g.fill();
      yrs.forEach((_, k) => { acc[k] += hist[k][i]; });
    });
    [0, 10, 20, 30, 40].forEach((k) => text(String(yrs[k]), X(k), y + ch + 20, F.mono(400, 14), C.soft, k === 0 ? 'left' : k === 40 ? 'right' : 'center'));
    y += ch + 44;
    const rows = grp.map((n, i) => [n, GROUP_COLORS[i], hist[0][i], hist.at(-1)[i]]).filter((r) => r[2] >= 1 || r[3] >= 1);
    rows.forEach(([n, c, p0, p1], i) => {
      const cx = M + (i % 2) * (COL / 2), cy = y + Math.floor(i / 2) * 26;
      g.fillStyle = c; g.fillRect(cx, cy - 12, 12, 12);
      text(n, cx + 18, cy, F.body(400, 16), C.ink);
      text(`${nf(p0)}→${nf(p1)}%`, cx + COL / 2 - 10, cy, F.mono(500, 15), C.ink, 'right');
    });
    y += Math.ceil(rows.length / 2) * 26 + 6;
    y = wrap('MapBiomas Coleção 11, 30 m. Parte da troca de campo nativo por pasto é diferença de método.', M, y, COL, F.body(400, 14), C.soft, 19);
  }
  const yL1 = y;
  y = head('Uso do solo hoje', xR, top);
  const lu = s.lu.map(([c, p]) => [CLASSES[c]?.[0] ?? `classe ${c}`, CLASSES[c]?.[1] ?? '#999', p]);
  let bx = xR;
  for (const [, c, p] of lu) { const bw = (p / 100) * COL; g.fillStyle = c; g.fillRect(bx, y - 6, bw, 18); bx += bw; }
  y += 40;
  for (const [n, c, p] of lu.slice(0, 6)) {
    g.fillStyle = c; g.fillRect(xR, y - 12, 12, 12);
    text(n, xR + 18, y, F.body(400, 17), C.ink);
    text(`${nf(p, p < 10 ? 1 : 0)}%`, xR + COL, y, F.mono(500, 16), C.ink, 'right');
    y += 26;
  }
  if (vigor && vigor.ha >= 1 && vigor.wet != null) {   // vigor do pasto (NDVI da Sentinel-2)
    const LV = ['fraco', 'abaixo da média', 'acima da média', 'forte'];
    y += 8;
    y = kv('Vigor do pasto (águas)', `${vigor.lv != null ? `${LV[vigor.lv]} · ` : ''}NDVI ${nf(vigor.wet / 100, 2)}`, xR, y);
    y = kv('Pasto fraco / forte', `${vigor.weak ?? 0}% / ${vigor.strong ?? 0}% de ${nf(vigor.ha, vigor.ha < 10 ? 1 : 0)} ha`, xR, y);
  }
  y = Math.max(yL1, y) + 22;

  // linha 2: relevo + sol e geada | água e APP + vizinhos
  const top2 = y;
  y = head('Relevo', M, y);
  y = kv('Altitude', `${nf(s.z[0])}–${nf(s.z[2])} m (média ${nf(s.z[1])} m)`, M, y);
  y = kv('Declividade média', `${nf(s.sl)}° · ${relevoOf(s.sl)}`, M, y);
  y = kv('Estradas e caminhos', `${nf(s.rd, 1)} km`, M, y);
  if (s.sol) {
    y += 12;
    y = head('Sol e geada', M, y);
    y = kv('Sol no inverno', `${nf(s.sol[0], 1)} kWh/m² · ${nf(s.sol[2], 1)} h`, M, y);
    y = kv('Sol no verão', `${nf(s.sol[1], 1)} kWh/m² · ${nf(s.sol[3], 1)} h`, M, y);
    y = kv('Baixada fria (geada)', `${nf(s.gea)}% da área`, M, y);
  }
  if (access) {
    const km = (m) => (m >= 1000 ? `${nf(m / 1000, m < 10000 ? 1 : 0)} km` : `${nf(Math.round(m / 10) * 10)} m`);
    y += 12;
    y = head('Acesso pela estrada', M, y);
    if (access.city) y = kv('Centro de Andrelândia', `${km(access.city.m)}${access.city.dirt >= 50 ? ` · ${km(access.city.dirt)} de terra` : ''}`, M, y);
    if (access.asphalt) y = kv('Asfalto', access.asphalt.m < 100 ? 'passa na propriedade' : `${km(access.asphalt.m)}${access.asphalt.urban ? ' (rua calçada)' : access.asphalt.name ? ` (${access.asphalt.name})` : ''}`, M, y);
    if (access.gap) y = kv('Sem estrada até a divisa', km(access.gap), M, y);
  }
  const yL2 = y;
  y = head('Água e APP', xR, top2);
  y = kv('Córregos', `${nf(s.dr, 1)} km · ${s.nas ?? 0} ${s.nas === 1 ? 'nascente' : 'nascentes'} est.`, xR, y);
  const [aha, anat, adef] = s.app, [, mdef, mw] = s.appm;
  if (aha >= 0.1) {
    y = kv('APP estimada', `${nf(aha, 1)} ha · ${nf(anat)}% nativa`, xR, y);
    y = kv('APP com pasto/lavoura', `${nf(adef, 1)} ha`, xR, y);
    y = kv(`Faixa mínima (${mw} m)`, `${nf(mdef, 1)} ha a recompor`, xR, y);
  } else y = kv('APP estimada', 'nenhuma', xR, y);
  if (water) y = kv('Água que vem de fora', water.upHa < 1 ? 'quase nada' : `${water.upHa >= 100 ? `${nf(water.upHa / 100, 1)} km²` : `${nf(water.upHa)} ha`}${water.edge ? ' (+ além do mapa)' : ''}`, xR, y);
  const nb = car.sel === x ? car.nb : car.neighbors(x), side = nb.filter((n) => !n.ov), over = nb.filter((n) => n.ov);
  if (nb.length) {
    y += 12;
    y = head('Vizinhos', xR, y);
    y = kv('Fazem divisa', `${side.length}${over.length ? ` · ${over.length} sobreposta${over.length > 1 ? 's' : ''}` : ''}`, xR, y);
    for (const n of side.slice(0, 3)) y = kv(`${nf(n.x.f.ha, n.x.f.ha < 10 ? 1 : 0)} ha`, `${n.m >= 1000 ? `${nf(n.m / 1000, 1)} km` : `${nf(Math.round(n.m / 10) * 10)} m`} de divisa`, xR + 16, y, COL - 16);
  }
  // linha 3 (largura toda): clima, solo e as melhores épocas de plantio do ZARC
  y = Math.max(yL2, y);
  if (agro) {
    const { climate: c, soil: so, zarc, text: t } = agro;
    y += 12;
    y = head('Clima, solo e quando plantar', M, y, W - 2 * M);
    y = kv('Clima (médias 1991–2020)', `${nf(c.year)} mm/ano · ${t.dry} · ${t.temp}`, M, y, W - 2 * M);
    if (so) y = kv('Solo provável (SoilGrids)', `${t.soil} · argila ${nf(so.clay)}% · pH ${nf(so.ph, 1)}`, M, y, W - 2 * M);
    zarc.slice(0, 4).forEach((z, i) => {
      const cx = M + (i % 2) * (COL + GAP), cy = y + Math.floor(i / 2) * 28;
      kv(`${z.crop}:`, z.best ?? 'não indicado', cx, cy);
    });
    y += Math.ceil(Math.min(4, zarc.length) / 2) * 28;
    y = wrap(`Plantio com risco de 20% no ZARC do MAPA, sem irrigação, solo ${so?.tipoName ?? '—'} (estimado pela argila). Clima por reanálise ERA5 ajustada à altitude.`, M, y, W - 2 * M, F.body(400, 14), C.soft, 19);
  }

  // rodapé (logo abaixo do conteúdo, ou no pé da página)
  const fy = Math.max(y + 16, H - M - 96);
  g.fillStyle = C.line; g.fillRect(M, fy, W - 2 * M, 1.5);
  const ty = wrap('Estimativas calculadas pelo app Andrelândia Rural a partir de dados públicos. APP, sol, geada, nascentes, vizinhos e distâncias pela estrada são aproximações: não substituem laudo técnico nem a análise do órgão ambiental. Contorno autodeclarado no CAR.', M, fy + 30, W - 2 * M, F.body(400, 16), C.ink, 22);
  wrap(`Fontes: SICAR (consulta pública), MapBiomas Col. 11, ANADEM v1.0 (UFRGS/ANA), CBERS-4A (INPE), Sentinel-2 (ESA), OpenStreetMap${agro ? ', Open-Meteo (ERA5), SoilGrids 2.0 (ISRIC), ZARC (MAPA)' : ''}. Cadastro atualizado em ${f.atualizado ? fmtDate(f.atualizado) : '—'}.`, M, ty + 4, W - 2 * M, F.body(400, 14), C.soft, 19);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
