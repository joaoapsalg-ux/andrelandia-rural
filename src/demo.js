// Demonstração da propriedade: uns 40 s com a câmera girando em volta dela, contando com os dados que o app já tem
// o tamanho, a terra de 1985 a 2025 ano a ano, o relevo, o caminho da água, o sol do inverno, a geada e o acesso
// pela estrada. Ao terminar (ou ao tocar no mapa / Esc / ×) a vista volta como estava e a ficha reabre.
import { CRITERIA, relevoOf } from './car.js';
import { accessText } from './access.js';
import { FEATURED, agroText, bestWindow, zarcStrip, climateChart } from './agro.js';

export class PropertyDemo {
  /**
   * terrain, carLayer, drop, nf, fmtLen, years (YEARS), loadYear(i) → Promise<Texture>, blobOf(i) → Promise<Blob>,
   * muni (hist.json do município), access { route(x), layer }, agro (Agro), el { box, cap, step, title, text, extra, note, prog, badge },
   * onStart(x): esconde os painéis e começa o sobrevoo · onStop(x, ended): devolve a vista e reabre a ficha ·
   * onFrame(latlons): leva a câmera a enquadrar os pontos (cena do acesso)
   */
  constructor(opts) { Object.assign(this, opts); this.run = null; }

  get running() { return !!this.run; }

  async start(x) {
    this.stop();
    if (!x?.f.s) return;
    const run = this.run = { x, t: 0, k: -1, ready: false, stall: false, tex: new Map(), cap: '' };
    this.onStart(x);
    // o dia passa durante a demonstração: começa no lusco-fusco do amanhecer (neblina nas baixadas) e termina de noite
    run.T = this.clock?.times() ?? null;
    if (run.T) {
      this.fade?.();
      this.clock.mist(true);
      run.tod0 = run.T.dawn - 20;
      this.#setClock(run.tod0);
    }
    // abertura: o tamanho da propriedade grande no centro; a legenda entra depois (ver update)
    const intro = document.getElementById('demo-intro');
    document.getElementById('demo-intro-k').textContent = 'Andrelândia Rural · demonstração';
    document.getElementById('demo-intro-t').textContent = `${this.nf(x.f.ha, x.f.ha < 10 ? 1 : 0)} hectares`;
    document.getElementById('demo-intro-s').textContent = `${x.f.mun} · CAR ${x.f.cod.slice(0, 16)}…`;
    intro.hidden = false; requestAnimationFrame(() => intro.classList.add('is-on'));
    this.el.box.hidden = true;
    this.el.step.textContent = 'Demonstração';
    this.el.prog.style.width = '0%';
    this.#caption('Preparando…', 'Carregando os mapas de 1985 a 2025.');
    // os primeiros anos, o mapa de escoamento e o histórico antes de o relógio andar; os outros anos (~16 MB no
    // total, ficam no cache) chegam durante a primeira cena — se faltar algum, a cena dos anos espera
    this.years.forEach((_, i) => this.blobOf(i));
    const got = await Promise.all([...[0, 1, 2, 3, 4, 5].map((i) => this.blobOf(i)), this.drop.load(), this.carLayer.loadHist(), this.agro?.load().catch(() => null),
      this.vigor?.ensure().catch(() => null), this.clock?.prepare()]);
    if (this.run !== run) return;
    run.vig = !!got.at(-2);   // mapa de vigor carregado: entra a cena do pasto
    await Promise.all([this.#want(0), this.#want(1)]);
    if (this.run !== run) return;
    run.scenes = this.#scenes(x);
    // horas sempre para a frente (cenas que faltam não fazem o relógio voltar)
    let last = run.tod0 ?? 0;
    for (const s of run.scenes) if (s.tod != null) { s.tod = Math.max(s.tod, last + 5); last = s.tod; }
    run.total = run.scenes.reduce((a, s) => a + s.d, 0);
    run.ready = true;
  }

  stop({ ended = false } = {}) {
    const run = this.run;
    if (!run) return;
    this.run = null;
    this.el.box.hidden = true; this.el.badge.hidden = true;
    const intro = document.getElementById('demo-intro'); intro.classList.remove('is-on'); intro.hidden = true;
    this.clock?.mist(false);
    this.drop.stop(); this.carLayer.hidePeak(); this.access?.layer.hide();
    const c = this.carLayer;
    this.terrain.setCarState({ on: c.on, fill: c.fill ? 0.3 : 0, overlap: c.overlap, app: c.app });
    this.onStop(run.x, ended);
  }

  update(dt) {
    const run = this.run;
    if (!run?.ready) return;
    if (!run.stall) run.t += dt;   // uma cena esperando dados segura o relógio
    run.stall = false;
    if (run.t > 2.4 && this.el.box.hidden) {   // fim da abertura: o título some e a legenda entra
      document.getElementById('demo-intro').classList.remove('is-on');
      this.el.box.hidden = false;
    }
    let t = run.t, k = 0;
    while (k < run.scenes.length && t >= run.scenes[k].d) { t -= run.scenes[k].d; k++; }
    if (k >= run.scenes.length) { this.stop({ ended: true }); return; }
    const sc = run.scenes[k];
    if (k !== run.k) { run.k = k; this.el.step.textContent = `${k + 1} de ${run.scenes.length} · ${sc.label}`; sc.enter(); }
    if (run.T && sc.tod != null) {   // a hora anda suave da cena anterior até a desta
      const prev = k === 0 ? run.tod0 : run.scenes[k - 1].tod ?? run.tod0, u = Math.min(1, t / sc.d);
      this.#setClock(prev + (sc.tod - prev) * u * u * (3 - 2 * u));
    }
    sc.update?.(t);
    this.el.prog.style.width = `${Math.min(100, (100 * run.t) / run.total).toFixed(1)}%`;
  }

  // hora da cena + relógio na legenda (☀ de dia, ☾ de noite)
  #setClock(min) {
    const r = this.clock.set(min), m = Math.floor(((min % 1440) + 1440) % 1440);
    const txt = `${r?.el > -3 ? '☀' : '☾'} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (this.el.clock && txt !== this.run.clockTxt) { this.run.clockTxt = txt; this.el.clock.textContent = txt; }
  }

  // legenda: só refaz quando o texto muda; anima a entrada, a não ser nas trocas rápidas (quiet)
  #caption(title, text, note = '', { quiet = false, extra = '' } = {}) {
    const key = title + text + note + extra;
    if (this.run.cap === key) return;
    this.run.cap = key;
    const e = this.el;
    e.title.textContent = title; e.text.textContent = text; e.note.textContent = note; e.note.hidden = !note;
    e.extra.innerHTML = extra; e.extra.hidden = !extra;   // gráfico/faixas gerados aqui mesmo (agro.js), não vêm de fora
    if (!quiet) { e.cap.classList.remove('demo-in'); void e.cap.offsetWidth; e.cap.classList.add('demo-in'); }
  }

  // texturas dos anos: pede adiantado e usa quando chegar (o LRU de loadYear guarda as mais recentes)
  #want(i) {
    const run = this.run;
    if (i < 0 || i >= this.years.length) return null;
    if (!run.tex.has(i)) { const e = { t: null }; e.p = this.loadYear(i).then((t) => { e.t = t; }); run.tex.set(i, e); }
    return run.tex.get(i).p;
  }
  #texOf(i) { return this.run.tex.get(i)?.t ?? null; }

  #scenes(x) {
    const f = x.f, s = f.s, nf = this.nf, T = this.terrain, c = this.carLayer, el = this.el, Y = this.years;
    const rel = s.z[2] - s.z[0];
    // cada cena monta a vista inteira (não depende da anterior): chão, ano, curvas, APP, marcador, gota
    // shot: tomada da câmera (open aberta · top de cima · low rasante · close perto · wide longe), só quando muda
    const view = ({ surface = 'satellite', badge = false, contours = false, app = false, peak = false, shot = null } = {}) => {
      if (surface !== this.run.surface) { if (this.run.surface) this.fade?.(); this.run.surface = surface; }
      if (shot && shot !== this.run.shot) { this.run.shot = shot; this.onShot?.(x, shot); }
      T.setStyle({ surface, contours, interval: rel > 200 ? 20 : rel > 60 ? 10 : 5 });
      el.badge.hidden = !badge;
      T.setCarState(app ? { on: true, fill: 0, overlap: false, app: true } : { on: false });
      if (peak) c.showPeak({ fly: false }); else c.hidePeak();
      this.drop.stop(); this.access?.layer.hide();
    };
    const pct = (v) => `${nf(v)}%`;
    const scenes = [];
    // hora no fim de cada cena (minutos do dia): amanhecer → manhã nos anos → meio-dia na água → tarde →
    // hora mágica no acesso → noite no fim. Sem relógio (D nulo), a luz fica como a pessoa deixou.
    const D = this.run.T, hr = (v) => (D ? v : null);

    // 1. a propriedade
    const size = CRITERIA.tamanho.buckets[CRITERIA.tamanho.of(f)]?.[0].split(' (')[0] ?? '';
    const kind = size === 'Minifúndio' ? 'Minifúndio' : size ? `Propriedade ${size.toLowerCase()}` : 'Propriedade';
    scenes.push({ d: 5, label: 'A propriedade', tod: hr(D?.dawn + 15), enter: () => {
      view();   // durante a abertura a câmera segue alta e longe
      this.#caption(`${nf(f.ha, f.ha < 10 ? 1 : 0)} hectares`, `${kind} · ${nf(f.mf, f.mf < 1 ? 2 : 1)} ${f.mf < 2 ? 'módulo fiscal' : 'módulos fiscais'} · ${f.mun}`,
        s.a / f.ha < 0.9 ? `Os números a seguir valem para a parte dentro do mapa (${nf(s.a)} ha).` : '');
    }, update: (t) => { if (t > 2.2 && this.run.shot !== 'open') { this.run.shot = 'open'; this.onShot?.(x, 'open'); } } });

    // 2. a terra de 1985 a 2025, ano a ano (~⅓ s por ano, em fusão contínua), com os números de cada ano na legenda
    const hist = c.histOf(x.k), groups = c.data.hist_groups;
    if (hist) {
      const a = hist[0], z = hist.at(-1);
      const top85 = groups.map((g, i) => [g, a[i]]).filter((r) => r[1] >= 3).sort((p, q) => q[1] - p[1]).slice(0, 3);
      const moved = groups.map((g, i) => [g, a[i], z[i]]).filter((r) => Math.abs(r[2] - r[1]) >= 3).sort((p, q) => Math.abs(q[2] - q[1]) - Math.abs(p[2] - p[1])).slice(0, 2);
      const top25 = groups.map((g, i) => [g, z[i]]).sort((p, q) => q[1] - p[1])[0];
      // os 3 grupos que mais pesaram em algum ano: são eles que a legenda acompanha
      const watch = groups.map((g, i) => [i, Math.max(...hist.map((row) => row[i]))]).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([i]) => i).sort((p, q) => p - q);
      const gi = (n) => groups.indexOf(n);
      const metodo = gi('Campo nativo') >= 0 && gi('Pastagem') >= 0 && a[gi('Campo nativo')] - z[gi('Campo nativo')] >= 10 && z[gi('Pastagem')] - a[gi('Pastagem')] >= 10;
      const n = Y.length - 1, A = 1.5, B = A + n * 0.32;
      scenes.push({ d: B + 1.5, label: 'A terra de 1985 a 2025', tod: hr(D?.dawn + 150), enter: () => {
        view({ surface: 'landuse', badge: true, shot: 'top' });
        this.#caption(`Em ${Y[0]}`, top85.map(([g, p]) => `${pct(p)} ${g.toLowerCase()}`).join(' · '));
      }, update: (t) => {
        const u = Math.min(n, Math.max(0, ((t - A) / (B - A)) * n));
        const seg = Math.min(n - 1, Math.floor(u)), fr = u - seg;
        // fusão contínua de um ano no outro: com troca rápida e pausa, os pixels que alternam de classe ano a ano
        // (ruído do MapBiomas) piscavam como estroboscópio
        const e = fr;
        for (let i = seg; i <= seg + 3; i++) this.#want(i);
        const ta = this.#texOf(seg), tb = this.#texOf(seg + 1);
        if (!ta || !tb) { if (t > A) this.run.stall = true; return; }   // ano ainda chegando: segura o relógio
        T.setLanduseBlend(ta, tb, e);
        const yi = e < 0.5 ? seg : seg + 1;
        el.badge.textContent = Y[yi];
        if (t >= A && t < B) this.#caption(`De ${Y[0]} a ${Y.at(-1)}`, `${Y[yi]}: ${watch.map((i) => `${groups[i]} ${pct(hist[yi][i])}`).join(' · ')}`, '', { quiet: true });
        if (t >= B) {
          this.#caption(`Em ${Y.at(-1)}`, moved.length ? moved.map(([g, p0, p1]) => `${g} ${pct(p0)} → ${pct(p1)}`).join(' · ') : `Quase não mudou: ${pct(top25[1])} ${top25[0].toLowerCase()}`,
            metodo ? 'Parte da troca de campo nativo por pasto é diferença de método do MapBiomas.' : '');
        }
      } });
    }

    // 3. o pasto: o verde nas águas de 2026 (Sentinel-2), comparado com o pasto do município
    const V = this.run.vig ? this.vigor.of(x) : null;
    if (V && V.ha >= 1 && V.wet != null) {
      const LV = ['fraco', 'abaixo da média', 'acima da média', 'forte'];
      scenes.push({ d: 4.5, label: 'O pasto', tod: hr(9 * 60 + 30), enter: () => {
        view({ surface: 'vigor', shot: 'top' });
        this.#caption(V.lv != null ? `Pasto ${LV[V.lv]} nas águas` : 'O verde do pasto nas águas',
          `${nf(V.ha, V.ha < 10 ? 1 : 0)} ha de pasto · NDVI ${nf(V.wet / 100, 2)} nas águas${V.dry != null ? ` e ${nf(V.dry / 100, 2)} na seca` : ''} · ${V.weak ?? 0}% dele fraco`,
          'Verde-escuro: muito verde · marrom: pouco verde (Sentinel-2, 2026). "Fraco" e "forte" comparam com o pasto do município.');
      } });
    }

    // 4. o relevo: curvas de nível e o ponto mais alto
    scenes.push({ d: 4, label: 'O relevo', tod: hr(10 * 60 + 30), enter: () => {
      view({ contours: true, peak: true, shot: 'low' });
      this.#caption(`De ${nf(s.z[0])} a ${nf(s.z[2])} m de altitude`, `Declividade média de ${nf(s.sl)}°, relevo ${relevoOf(s.sl)}` + (s.rd >= 0.05 ? ` · ${nf(s.rd, 1)} km de estradas e caminhos` : ''),
        'O marcador branco mostra o ponto mais alto.');
    } });

    // 4. a água: uma gota sai do ponto mais alto; APP estimada no mapa
    const [aha, anat] = s.app;
    scenes.push({ d: 4.5, label: 'A água', tod: hr(12 * 60), enter: () => {
      view({ app: true, peak: true, shot: 'close' });
      const p = this.drop.trace(s.zp[0], s.zp[1]);
      const lim = Math.min(4000, Math.max(1200, (p.channelDist ?? 0) + 800));
      const end = p.dist.findIndex((d) => d > lim);
      const pts = end > 0 ? p.pts.slice(0, end + 1) : p.pts;
      if (pts.length > 1) this.drop.start({ pts }, { dur: 4.2 });
      this.#caption(p.channelDist != null ? `A chuva do ponto mais alto chega a um córrego em ${this.fmtLen(p.channelDist)}` : `A chuva do ponto mais alto desce ${nf(Math.max(0, p.z0 - p.zEnd))} m`,
        (s.dr >= 0.05 || s.nas ? `${nf(s.dr, 1)} km de córregos · ${s.nas ?? 0} ${s.nas === 1 ? 'nascente estimada' : 'nascentes estimadas'}` : 'Nenhum córrego calculado dentro dela') + (aha >= 0.1 ? ` · APP estimada de ${nf(aha, 1)} ha, ${pct(anat)} com mata ou campo` : ' · sem APP estimada'),
        aha >= 0.1 ? 'APP em azul: com mata ou campo; em vermelho: com pasto ou lavoura. Estimativa do app.' : '');
    } });

    // 5. sol no inverno
    if (s.sol) {
      const ref = this.muni?.sol?.[0], v = s.sol[0];
      const cmp = !ref ? '' : v > ref * 1.03 ? ' · mais que a média do município' : v < ref * 0.97 ? ' · menos que a média do município' : ' · na média do município';
      scenes.push({ d: 3.5, label: 'Sol no inverno', tod: hr(13 * 60), enter: () => {
        view({ surface: 'sol-inverno', shot: 'open' });
        this.#caption(`${nf(v, 1)} kWh/m² de sol por dia no inverno`, `${nf(s.sol[2], 1)} h de sol em 21 de junho${cmp}`, 'Céu limpo, com a sombra dos morros: amarelo recebe mais, roxo recebe menos.');
      } });
    }

    // 6. geada
    if (s.gea != null) {
      const g = s.gea;
      scenes.push({ d: 3.5, label: 'Geada', tod: hr(14 * 60), enter: () => {
        view({ surface: 'geada', shot: 'wide' });
        this.#caption(`${nf(g)}% da área em baixada fria`, g >= 30 ? 'Muita área onde a geada pega primeiro' : g >= 15 ? 'Parte da área onde a geada pega primeiro' : g >= 5 ? 'Pouca área onde a geada pega primeiro' : 'Quase nada em baixada fria',
          'Em branco-azulado, onde o ar frio para nas noites sem vento. Mapa ilustrativo.');
      } });
    }

    // 7–9. clima, solo e quando plantar (se os arquivos carregaram)
    if (this.agro?.clima) {
      const { climate: cl, soil: so } = this.agro.of(x), at = agroText(cl, so, nf);
      scenes.push({ d: 5.5, label: 'O clima', tod: hr(15 * 60), enter: () => {
        view({ shot: 'low' });
        this.#caption(at.rain[0].toUpperCase() + at.rain.slice(1), `${at.dry[0].toUpperCase() + at.dry.slice(1)} · ${at.temp}`,
          `Médias de 1991 a 2020 (reanálise ERA5), temperatura ajustada à altitude dela (${nf(cl.elev)} m). Barras: chuva · linhas: máxima e mínima.`,
          { extra: climateChart(cl, { w: 420, h: 88 }) });
      } });
      if (so) {
        scenes.push({ d: 4.5, label: 'O solo', tod: hr(15 * 60 + 45), enter: () => {
          view({ shot: 'close' });
          this.#caption(at.soil, at.soilNums, 'SoilGrids 250 m, de 0 a 30 cm: estimativa global, não substitui análise de solo.');
        } });
        const zs = FEATURED.map((n) => this.agro.zarcFor(n, so)).filter(Boolean).slice(0, 4);
        if (zs.length) {
          const rows = zs.map((z) => `<div class="zarc-row"><span class="zarc-name">${z.crop}</span>${zarcStrip(z.risk, { w: 300, h: 10 })}<span class="zarc-best">${bestWindow(z.risk) ?? 'não indicado'}</span></div>`).join('');
          scenes.push({ d: 6.5, label: 'Quando plantar', tod: hr(D?.gold - 25), enter: () => {
            view({ shot: 'top' });
            this.#caption('Quando plantar com menos risco', `ZARC do Ministério da Agricultura, sem irrigação, solo ${so.tipoName}`,
              'Verde: risco de 20% · âmbar: 30% · laranja: 40% · em branco: não indicado. Tipo de solo estimado pela argila.',
              { extra: `<div class="zarc-row zarc-head"><span></span>${zarcStrip('0'.repeat(36), { w: 300, h: 0, labels: true })}<span></span></div>${rows}` });
          } });
        }
      }
    }

    // 10. acesso pela estrada: a câmera se afasta para mostrar o caminho até o asfalto e até a cidade
    const r = this.access?.route(x);
    if (r) {
      const t = accessText(r, nf), pts = [...f.rings.flat(), ...[r.city, r.asphalt].filter(Boolean).flatMap((p) => [...p.lines.dirt, ...p.lines.paved].flat())];
      scenes.push({ d: 5.5, label: 'O acesso', tod: hr(D?.sunset + 5), enter: () => {
        view();
        this.access.layer.show(r); this.access.layer.setOpacity(0);
        this.onFrame(pts);
        this.#caption(t.city, [t.asphalt, t.dirt].filter(Boolean).join(' · '),
          `${t.gap ? `${t.gap} ` : ''}Âmbar: estrada de terra · cinza-claro: asfalto. Pelas estradas do OpenStreetMap; aproximado.`);
      }, update: (tt) => this.access.layer.setOpacity(Math.min(1, tt / 0.8)) });
    }

    // fim: anoitece — as luzes da cidade e dos povoados acendem e entra o "até amanhã"
    if (D) {
      scenes.push({ d: 7, label: 'Anoitece', tod: D.sunset + 85, enter: () => {
        // depois do acesso a câmera fica onde está (o caminho até a cidade); sem ele, enquadra a propriedade e a cidade
        const keep = !!r;
        if (keep) { this.drop.stop(); this.carLayer.hidePeak(); this.access.layer.setOpacity(0.5); }
        else { view(); if (this.town) this.onFrame([...f.rings.flat(), this.town]); }
        this.#caption('Anoitece', `${nf(f.ha, f.ha < 10 ? 1 : 0)} hectares em ${f.mun}, do amanhecer à noite`,
          'As luzes da cidade e dos povoados acendem (mancha urbana do MapBiomas e ruas do OpenStreetMap).');
      }, update: (tt) => {
        if (tt > 3.6 && !this.run.endCard) {   // cartão final por cima da paisagem noturna
          this.run.endCard = true;
          const intro = document.getElementById('demo-intro');
          document.getElementById('demo-intro-k').textContent = 'Andrelândia Rural';
          document.getElementById('demo-intro-t').textContent = 'Até amanhã';
          document.getElementById('demo-intro-s').textContent = 'a terra, a água e o sol da sua propriedade num lugar só';
          this.el.box.hidden = true;
          intro.hidden = false; requestAnimationFrame(() => intro.classList.add('is-on'));
        }
      } });
    }
    return scenes;
  }
}
