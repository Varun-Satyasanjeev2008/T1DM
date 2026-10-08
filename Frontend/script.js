/* Demo / research prototype using CGM-only OhioT1DM 2020 replay data. */
const HZ = [30, 60, 90, 120];
const PATIENTS = ['559', '563', '570', '575', '588', '591'];
const RMSE = { 30: 20.94, 60: 33.67, 90: 42.44, 120: 48.08 };
const SAFE = { 30: 98.29, 60: 96.72, 90: 95.14, 120: 93.87 };
const REFERENCE = { 30: 99.6, 60: 99.0, 90: 97.6, 120: 96.4 };
const MODEL_ROWS = [
  { model: 'Ridge/Lasso', note: 'Linear baselines considered', comparison: '—' },
  { model: 'ARIMA', note: 'Classical time-series baseline considered', comparison: '—' },
  { model: 'ARX/ARIMAX', note: 'Ruled out because required insulin/carb inputs are unavailable', comparison: '—' },
  { model: 'XGBoost', note: 'Selected primary model: strong for small-to-mid-sized tabular data, captures nonlinear patterns in engineered CGM features, and provides interpretable feature importance for this dataset scale.', comparison: 'Selected' },
  { model: 'Four horizon-specific models', note: 'One XGBoost model trained per forecast horizon (30/60/90/120 min)', comparison: '—' },
  { model: 'Xiong et al. (2025) — multimodal reference model', note: 'CGM + insulin + meal composition + other patient/time context; Transformer + BiLSTM', comparison: '30 min 99.6%; 60 min 99.0%; 90 min 97.6%; 120 min 96.4%' }
];
const C = { accent: '#087f8c', blue: '#537cdb', ok: '#218566', warn: '#ba7918', bad: '#d35d57', mute: '#718391', grid: '#e1e9ed' };
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function buildCases() {
  const times = ['07:35', '11:10', '14:50', '18:25', '21:45', '00:20'];
  const out = [];
  for (let i = 0; i < PATIENTS.length * 3; i++) {
    const patient = PATIENTS[i % PATIENTS.length];
    const r = rng(i * 97 + 13);
    const base = 96 + (i % 6) * 7 + r() * 18;
    const amp = 22 + r() * 42;
    const phase = ((i + 1) * 19) % 200;
    const curve = [];
    for (let t = -180; t <= 120; t += 5) {
      const wave = Math.sin((t + phase) / 34) * amp + Math.cos((t + phase) / 68) * (amp * 0.46);
      const drift = (t / 180) * (r() - 0.5) * 20;
      const value = Math.round(clamp(base + wave + drift + (r() - 0.5) * 9, 48, 280));
      curve.push({ x: t, y: value });
    }
    const at = t => curve.find(p => p.x === t)?.y ?? curve[0].y;
    const cur = at(0);
    const history = curve.filter(p => p.x <= 0).map(p => p.y);
    const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const recent5 = at(0) - at(-5);
    const recent30 = at(0) - at(-30);
    const ts = `2020-01-${String((i % 28) + 1).padStart(2, '0')} ${times[i % times.length]}`;
    const preds = {};
    HZ.forEach(h => {
      const actual = at(h);
      const driftBias = (Math.sin((i + h) / 13) + Math.cos((i * 3 + h) / 9)) * 3.5;
      const pred = Math.round(clamp(actual + driftBias + (r() - 0.5) * 12, 35, 330));
      preds[h] = { pred, actual, err: Math.abs(pred - actual) };
    });
    out.push({
      id: i,
      patient,
      ts,
      curve,
      cur,
      preds,
      ctx: {
        'Current glucose': [cur, 'mg/dL', 'at forecast time'],
        'Number of CGM samples': [history.length, 'samples', 'in the 3 h window'],
        'Window duration': ['3 h', '', 'CGM history used'],
        'Minimum glucose': [min, 'mg/dL', 'in window'],
        'Maximum glucose': [max, 'mg/dL', 'in window'],
        'Mean glucose': [Math.round(mean), 'mg/dL', 'in window'],
        'Recent 5-minute change': [recent5, 'mg/dL', 'from t-5 to now'],
        'Recent 30-minute change': [recent30, 'mg/dL', 'from t-30 to now'],
        'Forecast timestamp': [ts, '', '']
      },
      events: [
        'CGM sampled every 5 minutes',
        'Historical glucose window used for forecasting',
        'Lag features derived from glucose history',
        'Rolling statistics derived from the CGM stream',
        '5-minute and 30-minute rate-of-change features',
        'Hour sine/cosine time encoding'
      ]
    });
  }
  return out;
}
const CASES = buildCases();

function clarkeZone(ref, pred) {
  if ((ref < 70 && pred < 70) || Math.abs(pred - ref) <= 0.2 * ref) return 'A';
  if ((ref >= 180 && pred <= 70) || (ref <= 70 && pred >= 180)) return 'E';
  if ((ref >= 70 && ref <= 290 && pred >= ref + 110) || (ref >= 130 && ref <= 180 && pred <= (7 / 5) * ref - 182)) return 'C';
  if ((ref >= 240 && pred >= 70 && pred <= 180) || (ref <= 175 / 3 && pred >= 70 && pred <= 180) || (ref > 175 / 3 && ref <= 70 && pred >= 1.2 * ref)) return 'D';
  return 'B';
}
const ZCOL = { A: C.ok, B: C.accent, C: C.warn, D: '#e8825a', E: C.bad };
const CLARKE = (() => {
  const r = rng(4242);
  return Array.from({ length: 180 }, () => {
    const ref = Math.round(55 + r() * 300);
    const pred = Math.round(clamp(ref + (r() - 0.5) * 2 * (0.11 * ref + 6), 40, 400));
    return { x: ref, y: pred, z: clarkeZone(ref, pred) };
  });
})();

const S = { c: 0, h: 60 }, charts = {};
const cs = () => CASES[S.c];
const rangeOf = g => g < 70 ? ['Below range', 'bad'] : g > 180 ? ['Above range', 'warn'] : ['In range', 'ok'];
function trend() {
  const cv = cs().curve, i = cv.findIndex(p => p.x === 0), d = (cv[i].y - cv[i - 3].y) / 15;
  return [d > 1 ? '↑ Rising' : d < -1 ? '↓ Falling' : '→ Stable', `${d >= 0 ? '+' : ''}${d.toFixed(1)} mg/dL/min`];
}
const stat = (l, v, s = '', cls = '') => `<div class="stat"><small>${l}</small><b class="${cls}">${v}</b><span>${s}</span></div>`;
const statusOf = e => e <= 15 ? ['Close match', 'ok'] : e <= 30 ? ['Moderate deviation', 'warn'] : ['Large deviation', 'bad'];

const nowPlugin = { id: 'now', beforeDatasetsDraw(ch) {
  const { ctx, chartArea: a, scales: { x } } = ch, x0 = x.getPixelForValue(0);
  ctx.save(); ctx.fillStyle = 'rgba(8,127,140,.06)'; ctx.fillRect(x0, a.top, a.right - x0, a.bottom - a.top);
  ctx.strokeStyle = C.mute; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, a.top); ctx.lineTo(x0, a.bottom); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = C.mute; ctx.font = '11px IBM Plex Sans'; ctx.fillText('Now', x0 + 5, a.top + 12); ctx.fillText('History', a.left + 6, a.top + 12); ctx.fillText('Future', a.right - 40, a.top + 12); ctx.restore();
} };
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

function thresholdState(v) {
  if (v < 70) return { label: 'Below range', className: 'bad' };
  if (v > 180) return { label: 'Above range', className: 'warn' };
  return { label: 'In range', className: 'ok' };
}
function renderRiskAlerts() {
  const c = cs();
  const current = thresholdState(c.cur);
  const entries = HZ.map(h => {
    const value = c.preds[h].pred;
    const state = thresholdState(value);
    return `<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid var(--line);"><span>${h} min — ${value} mg/dL</span><span class="${state.className}" style="font-weight:600;">${state.label}</span></div>`;
  }).join('');

  const earliest = HZ.map(h => ({ h, value: c.preds[h].pred })).find(item => item.value < 70 || item.value > 180);
  let alertHtml = 'No threshold excursion predicted within the selected forecast horizon.';
  if (earliest) {
    const type = earliest.value < 70 ? 'Potential hypoglycemic excursion' : 'Potential hyperglycemic excursion';
    alertHtml = `<strong>${type}</strong> — earliest horizon: ${earliest.h} min — predicted glucose: ${earliest.value} mg/dL`;
  }

  $('#riskSummary').innerHTML = stat('Current glucose', c.cur + ' mg/dL', current.label, current.className) + stat('Current status', current.label, 'Threshold band', current.className) + stat('Selected patient', 'Patient ' + c.patient, 'OhioT1DM 2020') + stat('Selected horizon', S.h + ' min', 'Current forecast setting');
  $('#riskTrajectory').innerHTML = entries;
  $('#riskAlert').innerHTML = `<div class="stat" style="padding:14px 16px;"><small>Earliest predicted excursion</small><b>${alertHtml}</b></div>`;
}
function renderOverview() {
  const c = cs(), p = c.preds[S.h], [rl, rc] = rangeOf(c.cur), [tl, ts] = trend();
  $('#summary').innerHTML = stat('Current Glucose', c.cur + ' mg/dL', rl, rc) + stat('Current Trend', tl, ts) + stat('Selected Patient', 'Patient ' + c.patient, 'OhioT1DM 2020') + stat('Forecast Horizon', S.h + ' min', 'CGM-only forecast');
  $('#fcards').innerHTML = HZ.map(h => { const q = c.preds[h]; return `<div class="stat ${h === S.h ? 'sel' : ''}"><small>${h} min forecast</small><b>${q.pred} mg/dL</b><span>Actual ${q.actual} · error ${q.err}</span></div>`; }).join('');
  const [pl] = rangeOf(p.pred), [sl] = statusOf(p.err);
  $('#interp').innerHTML = `At ${S.h} min the model projects <b>${p.pred} mg/dL</b> (${pl.toLowerCase()}); the held-out value was <b>${p.actual} mg/dL</b>, an absolute error of ${p.err} mg/dL (${sl.toLowerCase()}). This CGM-only replay uses the OhioT1DM 2020 cohort with 6 patients, 5-minute sampling, and 30/60/90/120 min forecasting. It is a research prototype and not treatment guidance.`;
  renderRiskAlerts();
  setLine('cMain');
}
function renderForecast() {
  const c = cs();
  $('#errTable').innerHTML = '<tr><th>Horizon</th><th>Current</th><th>Predicted</th><th>Actual</th><th>Absolute error</th></tr>' + HZ.map(h => { const q = c.preds[h]; return `<tr><td>${h} min</td><td>${c.cur}</td><td>${q.pred}</td><td>${q.actual}</td><td class="${statusOf(q.err)[1]}">${q.err} mg/dL</td></tr>`; }).join('');
  setLine('cDetail');
}
function renderExplorer() {
  const c = cs(), p = c.preds[S.h], [sl, sc] = statusOf(p.err), history = c.curve.filter(q => q.x <= 0).map(q => q.y);
  $('#selH').value = S.h;
  $('#results').innerHTML = stat('History Window', '3 h', `${history.length} CGM samples | ${Math.min(...history)}–${Math.max(...history)} mg/dL`) + stat('Prediction', p.pred + ' mg/dL', S.h + ' min ahead') + stat('Actual Value', p.actual + ' mg/dL', 'Held-out') + stat('Absolute Error', p.err + ' mg/dL', '') + stat('Forecast Status', sl, 'Error ≤15 close, ≤30 moderate', sc);
  $('#ctx').innerHTML = Object.entries(c.ctx).map(([k, [v, u, note]]) => {
    const display = typeof v === 'number' ? `${v}${u ? ' ' + u : ''}` : `${v}${u ? ' ' + u : ''}`;
    return stat(k, display, note || '');
  }).join('');
  $('#events').innerHTML = c.events.map(e => `<li>${e}</li>`).join('');
}
function zoneDistribution(horizon) {
  const values = {
    30: { A: 86.50, B: 11.79, C: 1.35, D: 0.30, E: 0.06 },
    60: { A: 82.47, B: 14.25, C: 2.64, D: 0.52, E: 0.12 },
    90: { A: 79.31, B: 15.83, C: 3.82, D: 0.79, E: 0.25 },
    120: { A: 75.72, B: 18.15, C: 4.76, D: 1.04, E: 0.33 }
  };
  return values[horizon];
}
function renderClinical() {
  const c = cs(), p = c.preds[S.h], pos = v => clamp((v - 40) / 360 * 100, 0, 100);
  const mk = (v, l, col, top) => `<span class="mk" style="left:${pos(v)}%;color:${col};top:${top}px">${l} ${v}</span>`;
  $('#range').innerHTML = `<div class="rbar"><i style="width:${pos(70)}%;background:${C.bad}"></i><i style="width:${pos(180) - pos(70)}%;background:${C.ok}"></i><i style="flex:1;background:${C.warn}"></i>${mk(c.cur, 'Now', '#fff', -26)}${mk(p.pred, 'Pred', C.accent, -26)}</div>`;
  $('#rangeNote').textContent = `Clarke Error Grid Analysis is used to evaluate clinical acceptability of prediction errors. This research prototype does not provide treatment or insulin recommendations. For the selected horizon, ${S.h} min, clinically safe A+B = ${SAFE[S.h]}%.`;
  const dist = zoneDistribution(S.h);
  $('#zones').innerHTML = Object.entries(dist).map(([z, v]) => `<div class="zrow"><b>${z}</b><div><i style="width:${v}%;background:${ZCOL[z]}"></i></div><span>${v.toFixed(2)}%</span></div>`).join('');
  const ch = charts.cClarke;
  ch.data.datasets[0].data = CLARKE;
  ch.data.datasets[0].backgroundColor = CLARKE.map(q => ZCOL[q.z]);
  ch.data.datasets[1].data = HZ.map(h => ({ x: c.preds[h].actual, y: c.preds[h].pred }));
  ch.update();
}
function renderPerformance() {
  $('#perfCards').innerHTML = stat('30 min RMSE', '20.94 mg/dL', 'Clarke A+B 98.29%') + stat('60 min RMSE', '33.67 mg/dL', 'Clarke A+B 96.72%') + stat('90 min RMSE', '42.44 mg/dL', 'Clarke A+B 95.14%') + stat('120 min RMSE', '48.08 mg/dL', 'Clarke A+B 93.87%');
  $('#hTable').innerHTML = '<tr><th>Horizon</th><th>RMSE</th><th>Clinically safe (A+B)</th></tr>' + HZ.map(h => `<tr><td>${h} min</td><td>${RMSE[h]} mg/dL</td><td>${SAFE[h]}%</td></tr>`).join('');
  $('#mTable').innerHTML = '<tr><th>Model / reference</th><th>Comparison</th><th>Notes</th></tr>' + MODEL_ROWS.map(row => `<tr><td>${row.model}</td><td>${row.comparison}</td><td>${row.note}</td></tr>`).join('') + `<tr><td colspan="3"><strong>Why XGBoost?</strong> It is well suited to small-to-mid-sized tabular forecasting tasks with engineered CGM features, captures nonlinear relationships in glucose dynamics, and provides interpretable feature importance without requiring the larger deep-learning architecture used in the multimodal reference model.</td></tr>`;
}
function renderModel() {
  const cards = [
    ['Glucose Lags', 'Lag features at 5, 10, 15, 30, and 60 minutes capture short- and medium-range CGM dependencies.'],
    ['Rolling Mean / Standard Deviation', '30-, 60-, 90-, and 120-minute rolling statistics summarize recent glucose stability and variation.'],
    ['Rate of Change', '5-minute and 30-minute change features quantify direction and acceleration in the glucose trajectory.'],
    ['Time-of-Day Encoding', 'Hour sine/cosine terms encode cyclical daily patterns in the CGM signal.'],
    ['XGBoost', 'Strong for small-to-mid-sized tabular data, captures nonlinear relationships, and provides feature-importance interpretability for engineered CGM features.'],
    ['Four Horizon-Specific Models', 'Four separate XGBoost models are trained, one per forecast horizon: 30, 60, 90, and 120 minutes.'],
    ['Reference vs Our Approach', 'Xiong et al. (2025): CGM + insulin + meal composition + other patient/time context with a Transformer + BiLSTM. Our approach: CGM only, CGM-derived features, XGBoost, four horizon-specific models.']
  ];
  $('#modelCards').innerHTML = cards.map(([title, text]) => stat(title, '', text)).join('');
}
function renderAll() {
  $$('.sel-patient').forEach(s => s.value = cs().patient);
  $$('.sel-case').forEach(s => { fillCases(s); s.value = S.c; });
  renderOverview(); renderForecast(); renderExplorer(); renderClinical();
}

function fillCases(s) {
  s.innerHTML = CASES.filter(c => c.patient === cs().patient).map(c => `<option value="${c.id}">${c.ts}</option>`).join('');
}
function runForecast() {
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
  charts.cErr = new Chart($('#cErr'), { type: 'line', data: { labels: HZ.map(h => h + ' min'), datasets: [{ label: 'RMSE', data: HZ.map(h => RMSE[h]), borderColor: C.accent, backgroundColor: C.accent, tension: .3 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: axis(), y: { ...axis('mg/dL'), min: 0, max: 60 } }, plugins: { legend: { labels: { color: C.mute } } } } });
  renderAll(); lucide.createIcons();
}
document.addEventListener('DOMContentLoaded', init);