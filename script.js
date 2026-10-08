/* T1D Forecast: frontend prototype. All data below is MOCK / DEMO. */
const HZ = [30, 60, 90, 120];
const C = { accent: '#087f8c', blue: '#537cdb', ok: '#218566', warn: '#ba7918', bad: '#d35d57', mute: '#718391', grid: '#e1e9ed' };
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ---------- MOCK DATA (centralized) ----------
   API INTEGRATION POINT: replace buildCases() with
   `await fetch('/api/test-cases')` returning the same shape:
   { id, patient, ts, curve:[{x:minutes_from_now, y:mg/dL}], preds:{30:{pred,actual,err}}, ctx:{...}, events:[...] }
   and call `await fetch('/api/forecast?case_id=..&horizon=..')` inside runForecast(). */
const MAE = { 30: 9.8, 60: 17.6, 90: 24.9, 120: 31.2 }, RMSE = { 30: 13.4, 60: 23.1, 90: 32.0, 120: 40.1 };
const MODELS = [['Random Forest', 18.9, 25.7], ['XGBoost', 18.1, 24.6], ['ARIMA', 23.4, 31.8], ['Kalman / State-Space', 21.0, 28.2], ['Ensemble', 16.2, 22.0]];
function buildCases() {
  const pats = ['559', '563', '570', '588'], times = ['07:35', '13:10', '21:45'], out = [];
  for (let i = 0; i < 12; i++) {
    const r = rng(i * 97 + 13), base = 90 + r() * 110, amp = 25 + r() * 45, ph = r() * 200, slope = (r() - .5) * .35, curve = [];
    for (let t = -180; t <= 120; t += 5) curve.push({ x: t, y: Math.round(clamp(base + amp * Math.sin((t + ph) / 45) + slope * t + (r() - .5) * 5, 45, 380)) });
    const at = t => curve.find(p => p.x === t).y, cur = at(0), preds = {};
    HZ.forEach(h => { const actual = at(h), pred = Math.round(clamp(actual + (r() - .5) * 2 * MAE[h] * 1.3, 40, 400)); preds[h] = { pred, actual, err: Math.abs(pred - actual) }; });
    const meal = r() < .6;
    out.push({ id: i, patient: pats[i % 4], ts: `2020-0${2 + (i >> 2)}-1${i % 4} ${times[i % 3]}`, curve, cur, preds,
      ctx: { Glucose: [cur, 'mg/dL', 0], 'Carbohydrates': [meal ? Math.round(25 + r() * 55) : 0, 'g', meal ? 35 : 180], Protein: [meal ? Math.round(8 + r() * 30) : 0, 'g', meal ? 35 : 180], Fat: [meal ? Math.round(5 + r() * 25) : 0, 'g', meal ? 35 : 180],
        Calories: [meal ? Math.round(250 + r() * 450) : 0, 'kcal', meal ? 35 : 180], 'Bolus insulin': [meal ? +(2 + r() * 6).toFixed(1) : 0, 'U', meal ? 30 : 240], 'Basal rate': [+(0.6 + r() * .6).toFixed(2), 'U/hr', 0],
        'Heart rate': [Math.round(62 + r() * 45), 'bpm', 0], Steps: [Math.round(r() * 900), 'steps/15 min', 0], 'Activity calories': [Math.round(r() * 60), 'kcal', 0] },
      events: [meal ? 'Meal logged 35 min before forecast time' : 'No meal logged in the previous 3 h', meal ? 'Bolus recorded 30 min before forecast time' : 'Basal rate only', 'CGM sampled every 5 min, 36-sample history window'] });
  }
  return out;
}
const CASES = buildCases();

/* ---------- Clarke error grid (demo points + simplified zone logic) ---------- */
function clarkeZone(ref, pred) {
  if ((ref < 70 && pred < 70) || Math.abs(pred - ref) <= 0.2 * ref) return 'A';
  if ((ref >= 180 && pred <= 70) || (ref <= 70 && pred >= 180)) return 'E';
  if ((ref >= 70 && ref <= 290 && pred >= ref + 110) || (ref >= 130 && ref <= 180 && pred <= (7 / 5) * ref - 182)) return 'C';
  if ((ref >= 240 && pred >= 70 && pred <= 180) || (ref <= 175 / 3 && pred >= 70 && pred <= 180) || (ref > 175 / 3 && ref <= 70 && pred >= 1.2 * ref)) return 'D';
  return 'B';
}
const ZCOL = { A: C.ok, B: C.accent, C: C.warn, D: '#e8825a', E: C.bad };
const CLARKE = (() => { const r = rng(4242); return Array.from({ length: 160 }, () => { const ref = Math.round(55 + r() * 300), f = r() < .1 ? 2.8 : 1, pred = Math.round(clamp(ref + (r() - .5) * 2 * (.11 * ref + 6) * f, 40, 400)); return { x: ref, y: pred, z: clarkeZone(ref, pred) }; }); })();

/* ---------- State and helpers ---------- */
const S = { c: 0, h: 60 }, charts = {};
const cs = () => CASES[S.c];
const rangeOf = g => g < 70 ? ['Below range', 'bad'] : g > 180 ? ['Above range', 'warn'] : ['In range', 'ok'];
function trend() { const cv = cs().curve, i = cv.findIndex(p => p.x === 0), d = (cv[i].y - cv[i - 3].y) / 15; return [d > 1 ? '↑ Rising' : d < -1 ? '↓ Falling' : '→ Stable', `${d >= 0 ? '+' : ''}${d.toFixed(1)} mg/dL/min`]; }
const stat = (l, v, s = '', cls = '') => `<div class="stat"><small>${l}</small><b class="${cls}">${v}</b><span>${s}</span></div>`;
const statusOf = e => e <= 15 ? ['Close match', 'ok'] : e <= 30 ? ['Moderate deviation', 'warn'] : ['Large deviation', 'bad'];

/* ---------- Charts ---------- */
const nowPlugin = { id: 'now', beforeDatasetsDraw(ch) {
  const { ctx, chartArea: a, scales: { x } } = ch, x0 = x.getPixelForValue(0);
  ctx.save(); ctx.fillStyle = 'rgba(8,127,140,.06)'; ctx.fillRect(x0, a.top, a.right - x0, a.bottom - a.top);
  ctx.strokeStyle = C.mute; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, a.top); ctx.lineTo(x0, a.bottom); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = C.mute; ctx.font = '11px IBM Plex Sans'; ctx.fillText('Now', x0 + 5, a.top + 12); ctx.fillText('History', a.left + 6, a.top + 12); ctx.fillText('Future', a.right - 40, a.top + 12); ctx.restore(); } };
const axis = t => ({ grid: { color: C.grid }, ticks: { color: C.mute }, title: { display: !!t, text: t, color: C.mute } });
function lineChart(id) {
  const ds = (label, color, extra = {}) => ({ label, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: .3, data: [], ...extra });
  charts[id] = new Chart($('#' + id), { type: 'line', plugins: [nowPlugin], data: { datasets: [ds('Historical glucose', C.blue), ds('Actual future (test case)', C.ok), ds('Forecast', C.accent, { borderDash: [6, 4], pointRadius: 5, pointHoverRadius: 7 })] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, interaction: { mode: 'nearest', intersect: false },
      scales: { x: { type: 'linear', min: -180, max: 120, ...axis('Minutes from forecast time'), ticks: { color: C.mute, stepSize: 30 } }, y: { min: 40, max: 360, ...axis('Glucose (mg/dL)') } },
      plugins: { legend: { labels: { color: C.mute, boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y} mg/dL (t ${c.parsed.x >= 0 ? '+' : ''}${c.parsed.x} min)` } } } } });
}
function setLine(id) {
  const c = cs(), ch = charts[id];
  ch.data.datasets[0].data = c.curve.filter(p => p.x <= 0);
  ch.data.datasets[1].data = c.curve.filter(p => p.x >= 0);
  ch.data.datasets[2].data = [{ x: 0, y: c.cur }, ...HZ.map(h => ({ x: h, y: c.preds[h].pred }))];
  ch.data.datasets[2].pointRadius = ctx => ctx.dataIndex && HZ[ctx.dataIndex - 1] === S.h ? 8 : ctx.dataIndex ? 4 : 0;
  ch.update();
}

/* ---------- Renderers ---------- */
function renderOverview() {
  const c = cs(), p = c.preds[S.h], [rl, rc] = rangeOf(c.cur), [tl, ts] = trend();
  $('#summary').innerHTML = stat('Current glucose', c.cur + ' mg/dL', rl, rc) + stat('Current trend', tl, ts) + stat('Selected patient', 'Patient ' + c.patient, c.ts + ' (demo)') + stat('Forecast horizon', S.h + ' min', 'Predicted ' + p.pred + ' mg/dL');
  $('#fcards').innerHTML = HZ.map(h => { const q = c.preds[h]; return `<div class="stat ${h === S.h ? 'sel' : ''}"><small>${h} min forecast</small><b>${q.pred} mg/dL</b><span>Actual ${q.actual} · error ${q.err}</span></div>`; }).join('');
  const [pl] = rangeOf(p.pred), [sl] = statusOf(p.err);
  $('#interp').innerHTML = `At ${S.h} min the model projects <b>${p.pred} mg/dL</b> (${pl.toLowerCase()}); the held-out value was <b>${p.actual} mg/dL</b>, an absolute error of ${p.err} mg/dL (${sl.toLowerCase()}). This is a research replay of a test sample, not advice about food, activity or insulin.`;
  setLine('cMain');
}
function renderForecast() {
  const c = cs();
  $('#errTable').innerHTML = '<tr><th>Horizon</th><th>Current</th><th>Predicted</th><th>Actual</th><th>Absolute error</th></tr>' + HZ.map(h => { const q = c.preds[h]; return `<tr><td>${h} min</td><td>${c.cur}</td><td>${q.pred}</td><td>${q.actual}</td><td class="${statusOf(q.err)[1]}">${q.err} mg/dL</td></tr>`; }).join('');
  setLine('cDetail');
}
function renderExplorer() {
  const c = cs(), p = c.preds[S.h], [sl, sc] = statusOf(p.err), h = c.curve.filter(q => q.x <= 0).map(q => q.y);
  $('#selH').value = S.h;
  $('#results').innerHTML = stat('History window', '3 h', `${h.length} CGM samples, ${Math.min(...h)}–${Math.max(...h)} mg/dL`) + stat('Prediction', p.pred + ' mg/dL', S.h + ' min ahead') + stat('Actual value', p.actual + ' mg/dL', 'Held-out') + stat('Absolute error', p.err + ' mg/dL', '') + stat('Forecast status', sl, 'Error ≤15 close, ≤30 moderate', sc);
  $('#ctx').innerHTML = Object.entries(c.ctx).map(([k, [v, u, ago]]) => stat(k, v + ' <small>' + u + '</small>', ago ? ago + ' min before forecast time' : 'At forecast time')).join('');
  $('#events').innerHTML = c.events.map(e => `<li>${e}</li>`).join('');
}
function renderClinical() {
  const c = cs(), p = c.preds[S.h], pos = v => clamp((v - 40) / 360 * 100, 0, 100);
  const mk = (v, l, col, top) => `<span class="mk" style="left:${pos(v)}%;color:${col};top:${top}px">${l} ${v}</span>`;
  $('#range').innerHTML = `<div class="rbar"><i style="width:${pos(70)}%;background:${C.bad}"></i><i style="width:${pos(180) - pos(70)}%;background:${C.ok}"></i><i style="flex:1;background:${C.warn}"></i>${mk(c.cur, 'Now', '#fff', -26)}${mk(p.pred, 'Pred', C.accent, -26)}</div>`;
  $('#rangeNote').textContent = `Bands: below 70, 70–180 (target range), above 180 mg/dL. ${S.h}-min predicted value is ${rangeOf(p.pred)[0].toLowerCase()}; actual was ${rangeOf(p.actual)[0].toLowerCase()}.`;
  const cnt = { A: 0, B: 0, C: 0, D: 0, E: 0 }; CLARKE.forEach(q => cnt[q.z]++);
  $('#zones').innerHTML = Object.entries(cnt).map(([z, n]) => { const pc = (n / CLARKE.length * 100).toFixed(1); return `<div class="zrow"><b>${z}</b><div><i style="width:${pc}%;background:${ZCOL[z]}"></i></div><span>${pc}%</span></div>`; }).join('');
  const ch = charts.cClarke; ch.data.datasets[0].data = CLARKE; ch.data.datasets[0].backgroundColor = CLARKE.map(q => ZCOL[q.z]);
  ch.data.datasets[1].data = HZ.map(h => ({ x: c.preds[h].actual, y: c.preds[h].pred })); ch.update();
}
function renderPerformance() {
  $('#perfCards').innerHTML = stat('MAE @ 60 min', MAE[60] + ' mg/dL', 'Placeholder') + stat('RMSE @ 60 min', RMSE[60] + ' mg/dL', 'Placeholder') + stat('MAE @ 120 min', MAE[120] + ' mg/dL', 'Placeholder') + stat('RMSE @ 120 min', RMSE[120] + ' mg/dL', 'Placeholder');
  $('#hTable').innerHTML = '<tr><th>Horizon</th><th>MAE</th><th>RMSE</th></tr>' + HZ.map(h => `<tr><td>${h} min</td><td>${MAE[h]}</td><td>${RMSE[h]}</td></tr>`).join('');
  $('#mTable').innerHTML = '<tr><th>Model</th><th>MAE (demo)</th><th>RMSE (demo)</th></tr>' + MODELS.map(m => `<tr><td>${m[0]}</td><td>${m[1]}</td><td>${m[2]}</td></tr>`).join('');
}
function renderModel() {
  const d = [['Random Forest', 'Tree-based component learning from engineered history features.'], ['XGBoost', 'Gradient-boosted tree component on the same feature set.'], ['ARIMA', 'Statistical time-series component using glucose history.'], ['Kalman / State-Space', 'State-estimation component that tracks glucose dynamics.'], ['Ensemble', 'Combines component outputs into the final forecast. Method to be defined.']];
  $('#modelCards').innerHTML = d.map(([t, s]) => stat(t, '', s).replace('<b class=""></b>', '')).join('');
}
function renderAll() { $$('.sel-patient').forEach(s => s.value = cs().patient); $$('.sel-case').forEach(s => { fillCases(s); s.value = S.c; }); renderOverview(); renderForecast(); renderExplorer(); renderClinical(); }

/* ---------- Controls ---------- */
function fillCases(s) { s.innerHTML = CASES.filter(c => c.patient === cs().patient).map(c => `<option value="${c.id}">${c.ts}</option>`).join(''); }
function runForecast() {
  /* API INTEGRATION POINT: const r = await fetch(`/api/forecast?case_id=${S.c}&horizon=${S.h}`); then map r.json() into CASES[S.c].preds[S.h] */
  const box = $('#results'); box.classList.add('loading'); setTimeout(() => { box.classList.remove('loading'); renderAll(); }, 450);
}
function init() {
  const pats = [...new Set(CASES.map(c => c.patient))];
  $$('.sel-patient').forEach(s => { s.innerHTML = pats.map(p => `<option value="${p}">Patient ${p}</option>`).join(''); s.onchange = () => { S.c = CASES.find(c => c.patient === s.value).id; renderAll(); }; });
  $$('.sel-case').forEach(s => s.onchange = () => { S.c = +s.value; renderAll(); });
  $('#selH').onchange = e => { S.h = +e.target.value; renderAll(); };
  $('#run').onclick = runForecast;
  $('#rand').onclick = () => { let n; do n = Math.floor(Math.random() * CASES.length); while (n === S.c); S.c = n; runForecast(); };
  $('#nav').onclick = e => { const b = e.target.closest('button'); if (!b) return; $$('#nav button').forEach(x => x.classList.toggle('active', x === b)); $$('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + b.dataset.view)); Object.values(charts).forEach(c => c.resize()); };
  lineChart('cMain'); lineChart('cDetail');
  const line = (a, b, col = C.grid) => ({ type: 'line', data: [a, b], borderColor: col, borderWidth: 1, pointRadius: 0, borderDash: [4, 4] });
  charts.cClarke = new Chart($('#cClarke'), { type: 'scatter', data: { datasets: [
    { label: 'Demo points', data: [], pointRadius: 3.5 }, { label: 'Selected case', data: [], pointRadius: 7, pointStyle: 'rectRot', borderColor: C.accent, backgroundColor: 'transparent', borderWidth: 2 },
    { ...line({ x: 0, y: 0 }, { x: 400, y: 400 }, C.mute) }, line({ x: 0, y: 0 }, { x: 400, y: 320 }), line({ x: 0, y: 0 }, { x: 333, y: 400 }), line({ x: 0, y: 70 }, { x: 400, y: 70 }), line({ x: 0, y: 180 }, { x: 400, y: 180 }), line({ x: 70, y: 0 }, { x: 70, y: 400 }), line({ x: 180, y: 0 }, { x: 180, y: 400 })] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, scales: { x: { min: 0, max: 400, ...axis('Reference glucose (mg/dL)') }, y: { min: 0, max: 400, ...axis('Predicted glucose (mg/dL)') } },
      plugins: { legend: { display: false }, tooltip: { filter: i => i.datasetIndex < 2, callbacks: { label: c => `Ref ${c.parsed.x}, pred ${c.parsed.y}` } } } } });
  renderPerformance(); renderModel();
  charts.cErr = new Chart($('#cErr'), { type: 'line', data: { labels: HZ.map(h => h + ' min'), datasets: [{ label: 'MAE', data: HZ.map(h => MAE[h]), borderColor: C.accent, backgroundColor: C.accent, tension: .3 }, { label: 'RMSE', data: HZ.map(h => RMSE[h]), borderColor: C.blue, backgroundColor: C.blue, tension: .3 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: axis(), y: axis('mg/dL') }, plugins: { legend: { labels: { color: C.mute } } } } });
  renderAll(); lucide.createIcons();
}
document.addEventListener('DOMContentLoaded', init);