// Clima, solo e época de plantio (ZARC) por propriedade, a partir de três arquivos pequenos (carregados na 1ª ficha):
//  - clima.json (Open-Meteo, 1991–2020; tools/build_clima.ps1): 5 pontos pesados pelo inverso da distância; a
//    temperatura é corrigida pela altitude média da propriedade (−0,65 °C a cada 100 m). Reanálise: suaviza as baixadas.
//  - solo.json (SoilGrids 2.0, 250 m, 0–30 cm; tools/dev/build_solo.html): média das células dentro da propriedade.
//  - zarc.json (MAPA; tools/build_zarc.ps1): janelas de plantio por decêndio para o solo estimado pela argila.
// Tudo é estimativa: o card e a folha dizem isso.
export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// classes WRB do SoilGrids (códigos em ordem alfabética) → nome mais próximo no Sistema Brasileiro (SiBCS)
const WRB = {
  0: 'Argissolo', 2: 'Argissolo', 4: 'Neossolo quartzarênico', 6: 'Cambissolo', 10: 'Latossolo', 11: 'Neossolo flúvico',
  12: 'Gleissolo', 14: 'Organossolo', 16: 'Neossolo litólico', 17: 'Argissolo', 18: 'Luvissolo', 19: 'Nitossolo',
  21: 'Planossolo', 22: 'Plintossolo', 24: 'Neossolo regolítico', 28: 'Cambissolo húmico', 29: 'Vertissolo',
};
// culturas que aparecem primeiro na ficha e na demonstração (as que mais se veem na região)
export const FEATURED = ['Milho 1ª Safra', 'Feijão', 'Café Arábica Implantação', 'Forrageira Pecuária', 'Soja', 'Sorgo Granífero', 'Mandioca (aipim, macaxeira)'];
const CICLO_PREF = [21, 20, 22, 13, 19, 24, 25, 26];   // ciclo médio primeiro
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function inRings(rings, lat, lon) {
  return rings.some((ring) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ai, oi] = ring[i], [aj, oj] = ring[j];
      if ((ai > lat) !== (aj > lat) && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) c = !c;
    }
    return c;
  });
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class Agro {
  constructor({ getJSON }) { this.getJSON = getJSON; this.cache = new Map(); }

  load() {
    this.p ??= Promise.all(['clima', 'solo', 'zarc'].map((n) => this.getJSON(`data/muni/layers/${n}.json`))).then(([c, s, z]) => {
      this.clima = c; this.zarc = z;
      this.solo = { ...s, clay: unb64(s.clay), sand: unb64(s.sand), soc: unb64(s.soc), ph: unb64(s.ph), wrb: unb64(s.wrb) };
    }).catch((e) => { this.p = null; throw e; });
    return this.p;
  }

  /** { climate, soil } da propriedade (com load() já resolvido) */
  of(x) {
    if (this.cache.has(x.k)) return this.cache.get(x.k);
    const r = { climate: this.#climate(x), soil: this.#soil(x) };
    this.cache.set(x.k, r);
    return r;
  }

  #center(x) {
    if (x.f.s?.lp) return x.f.s.lp;
    return [(x.s + x.n) / 2, (x.w + x.e) / 2];
  }

  #climate(x) {
    const [lat, lon] = this.#center(x), pts = this.clima.points;
    const w = pts.map((p) => 1 / ((Math.hypot((p.lat - lat) * 111, (p.lon - lon) * 103) + 0.5) ** 2)), W = w.reduce((a, b) => a + b, 0);
    const avg = (f) => MONTHS.map((_, m) => pts.reduce((a, p, i) => a + w[i] * f(p)[m], 0) / W);
    const elev = pts.reduce((a, p, i) => a + w[i] * p.elev, 0) / W, z = x.f.s?.z?.[1] ?? elev, dt = this.clima.lapse * (z - elev);
    const rain = avg((p) => p.rain), tmax = avg((p) => p.tmax).map((v) => v + dt), tmin = avg((p) => p.tmin).map((v) => v + dt);
    const dry = MONTHS.map((_, m) => rain[m] < 50);
    // estação seca: a maior sequência de meses com menos de 50 mm (pode virar o ano)
    let best = null;
    for (let s = 0; s < 12; s++) {
      if (!dry[s] || dry[(s + 11) % 12]) continue;
      let n = 0; while (n < 12 && dry[(s + n) % 12]) n++;
      if (!best || n > best.n) best = { s, n };
    }
    return { rain, tmax, tmin, rainDays: avg((p) => p.rainDays), year: rain.reduce((a, b) => a + b, 0), elev: z, dry: best };
  }

  #soil(x) {
    const S = this.solo, [w0, s0, e0, n0] = S.bbox, cw = (e0 - w0) / S.w, ch = (n0 - s0) / S.h;
    const i0 = Math.max(0, Math.floor((x.w - w0) / cw)), i1 = Math.min(S.w - 1, Math.floor((x.e - w0) / cw));
    const j0 = Math.max(0, Math.floor((n0 - x.n) / ch)), j1 = Math.min(S.h - 1, Math.floor((n0 - x.s) / ch));
    const cells = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (inRings(x.f.rings, n0 - (j + 0.5) * ch, w0 + (i + 0.5) * cw)) cells.push(j * S.w + i);
    }
    if (!cells.length) {   // menor que uma célula de 250 m: a célula do centro
      const [lat, lon] = this.#center(x), i = Math.floor((lon - w0) / cw), j = Math.floor((n0 - lat) / ch);
      if (i >= 0 && j >= 0 && i < S.w && j < S.h) cells.push(j * S.w + i);
    }
    const mean = (a, f = 1) => { let s = 0, n = 0; for (const k of cells) if (a[k]) { s += a[k]; n++; } return n ? (s / n) * f : null; };
    const clay = mean(S.clay);
    if (clay == null) return null;
    const count = {};
    for (const k of cells) if (S.wrb[k] !== 255) count[S.wrb[k]] = (count[S.wrb[k]] ?? 0) + 1;
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    const sand = mean(S.sand), ph = mean(S.ph, 0.1), soc = mean(S.soc);
    // tipo de solo do ZARC pela argila (IN 2/2008) e a classe de água disponível mais cautelosa dessa faixa
    const tipo = clay < 15 ? 1 : clay <= 35 ? 2 : 3;
    return {
      clay, sand, ph, soc, cells: cells.length,
      cls: top ? WRB[top[0]] ?? null : null, clsShare: top ? top[1] / cells.length : 0,
      tipo, tipoName: ['', 'arenoso', 'textura média', 'argiloso'][tipo], ad: [0, 1, 3, 4][tipo],
    };
  }

  /** janela do ZARC de uma cultura para o solo da propriedade (sequeiro, ciclo médio quando houver) */
  zarcFor(cropName, soil) {
    const crop = this.zarc.crops.find((c) => c.n === cropName);
    if (!crop || !soil) return null;
    const rows = crop.r.filter((r) => r[2] === 'Sequeiro').length ? crop.r.filter((r) => r[2] === 'Sequeiro') : crop.r;
    const usesAD = rows.some((r) => r[1] >= 11), want = usesAD ? 10 + soil.ad : soil.tipo;
    const solos = [...new Set(rows.map((r) => r[1]))];
    const solo = solos.includes(want) ? want : solos.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
    let pool = rows.filter((r) => r[1] === solo);
    const ciclo = CICLO_PREF.find((c) => pool.some((r) => r[0] === c)) ?? pool[0][0];
    pool = pool.filter((r) => r[0] === ciclo);
    const row = pool.sort((a, b) => Math.abs((a[5] ?? 1) - 1) - Math.abs((b[5] ?? 1) - 1))[0];   // produtividade mais perto de 1
    return { crop: crop.n, risk: row[4], ciclo: this.zarc.ciclos[ciclo] ?? '', solo: this.zarc.solos[solo] ?? '', manejo: row[2], portaria: crop.portaria };
  }
}

export const phName = (ph) => (ph < 5 ? 'muito ácido' : ph < 5.5 ? 'ácido' : ph < 6.5 ? 'pouco ácido' : 'neutro');
const argmax = (a) => a.indexOf(Math.max(...a)), argmin = (a) => a.indexOf(Math.min(...a));
/** frases curtas de clima e solo (ficha, demonstração e folha) */
export function agroText(c, s, nf) {
  return {
    rain: `${nf(c.year)} mm de chuva por ano`,
    dry: c.dry ? `seca de ${MONTHS[c.dry.s]} a ${MONTHS[(c.dry.s + c.dry.n - 1) % 12]}` : 'sem mês com menos de 50 mm',
    temp: `máxima de ${nf(Math.max(...c.tmax))} °C em ${MONTHS[argmax(c.tmax)]}, mínima de ${nf(Math.min(...c.tmin))} °C em ${MONTHS[argmin(c.tmin)]}`,
    soil: s ? `${s.cls ?? 'Solo'} provável, ${s.tipoName}` : 'Sem dado de solo',
    soilNums: s ? `Argila ${nf(s.clay)}% · areia ${nf(s.sand)}% · pH ${nf(s.ph, 1)} (${phName(s.ph)}) · carbono ${nf(s.soc)} g/kg` : '',
  };
}

/** maior sequência de decêndios com 20 % de risco: "11/out a 31/dez" (ou null) */
export function bestWindow(risk) {
  let best = null;
  for (let s = 0; s < 36; s++) {
    if (risk[s] !== '1' || risk[(s + 35) % 36] === '1') continue;
    let n = 0; while (n < 36 && risk[(s + n) % 36] === '1') n++;
    if (!best || n > best.n) best = { s, n };
  }
  if (!best && risk.includes('1')) best = { s: risk.indexOf('1'), n: 36 };   // o ano todo
  if (!best) return null;
  if (best.n >= 36) return 'o ano todo';
  const e = (best.s + best.n - 1) % 36, d = (k) => [1, 11, 21][k % 3], m = (k) => Math.floor(k / 3);
  const end = e % 3 === 2 ? DAYS[m(e)] : d(e) + 9;
  return `${d(best.s)}/${MONTHS[m(best.s)]} a ${end}/${MONTHS[m(e)]}`;
}

/** faixa de 36 decêndios (verde 20 %, âmbar 30 %, laranja 40 %) em SVG */
export function zarcStrip(risk, { w = 300, h = 12, labels = false } = {}) {
  const cw = w / 36, col = ['transparent', '#3f9d5a', '#e0b13a', '#e0702f'];
  let s = `<svg class="zarc-strip" viewBox="0 0 ${w} ${h + (labels ? 13 : 0)}" role="img" aria-label="Risco por decêndio">`;
  s += `<rect x="0" y="0" width="${w}" height="${h}" fill="currentColor" fill-opacity=".08"/>`;
  for (let k = 0; k < 36; k++) if (risk[k] !== '0') s += `<rect x="${(k * cw + 0.4).toFixed(1)}" y="0" width="${(cw - 0.8).toFixed(1)}" height="${h}" fill="${col[+risk[k]]}"/>`;
  for (let m = 1; m < 12; m++) s += `<line x1="${m * 3 * cw}" x2="${m * 3 * cw}" y1="0" y2="${h}" stroke="currentColor" stroke-opacity=".25"/>`;
  if (labels) MONTHS.forEach((mn, m) => { s += `<text x="${(m * 3 + 1.5) * cw}" y="${h + 11}" text-anchor="middle">${mn}</text>`; });
  return s + '</svg>';
}

/** gráfico do ano: chuva em barras, máximas e mínimas em linhas */
export function climateChart(c, { w = 300, h = 110 } = {}) {
  const pad = 16, bw = (w - 2 * pad) / 12, maxR = Math.max(250, ...c.rain), tMin = Math.floor(Math.min(...c.tmin) / 5) * 5, tMax = Math.ceil(Math.max(...c.tmax) / 5) * 5;
  const Y = (v) => 4 + (1 - v / maxR) * (h - 22), T = (v) => 4 + (1 - (v - tMin) / (tMax - tMin)) * (h - 22), X = (m) => pad + (m + 0.5) * bw;
  let s = `<svg class="clima-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Chuva e temperatura mês a mês">`;
  c.rain.forEach((r, m) => { s += `<rect x="${(pad + m * bw + 2).toFixed(1)}" y="${Y(r).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(h - 18 - Y(r)).toFixed(1)}" fill="#4f93cf" fill-opacity=".75"><title>${MONTHS[m]}: ${Math.round(r)} mm</title></rect>`; });
  const line = (a, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${a.map((v, m) => `${X(m).toFixed(1)},${T(v).toFixed(1)}`).join(' ')}"/>`;
  s += line(c.tmax, '#d9544a') + line(c.tmin, '#3a7fc0');
  MONTHS.forEach((mn, m) => { s += `<text x="${X(m).toFixed(1)}" y="${h - 4}" text-anchor="middle">${mn[0].toUpperCase()}</text>`; });
  return s + '</svg>';
}
