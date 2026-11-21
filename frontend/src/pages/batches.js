import {store} from '../api.js';
import {badge, pageTitle, sectionTitle, windowLabel} from '../components/ledger.js';
import {h, number, phases, stages, when} from '../presentation.js';

function batchForm() {
  return `<details class="entry-form"><summary>登记新批次</summary><form data-action="createBatch">
    <label>批号<input name="code" placeholder="FD-1121D" required></label>
    <label>配方<select name="recipe_code" required>${store.recipes.map(recipe => `<option value="${h(recipe.code)}">${h(recipe.code)} · ${h(recipe.product)}</option>`).join('')}</select></label>
    <label>冻干机<input name="dryer" value="FDX-02" required></label>
    <label>原料批号<input name="material_lot" placeholder="APL-1121D" required></label>
    <label>投料厚度 mm<input type="number" step="0.01" min="0.01" max="200" name="feed_mm" required></label>
    <button class="primary">登记</button></form></details>`;
}

function recipeForm() {
  return `<details class="entry-form"><summary>建档配方版本</summary><form data-action="createRecipe">
    <label>版本号<input name="code" placeholder="AP-26R4" required></label><label>产品<input name="product" required></label>
    <label>固形物 %<input type="number" name="solids_pct" step="0.01" min="0" max="100" required></label>
    <label>标称厚度 mm<input type="number" name="nominal_mm" step="0.01" min="0.01" max="200" required></label>
    <label>工艺窗下限 %<input type="number" name="window_low" step="0.01" min="0" max="100" required></label>
    <label>工艺窗上限 %<input type="number" name="window_high" step="0.01" min="0" max="100" required></label>
    <button class="primary">保存版本</button></form></details>`;
}

function importForm() {
  return `<details class="entry-form"><summary>导入设备曲线</summary><form data-action="importCurve">
    <label>设备导出文件<input type="file" accept=".csv,text/csv" data-action="loadCsv"></label>
    <label>文件名<input name="source_name" placeholder="FD-1121B_chamber_r1.csv" required></label>
    <label class="wide">CSV 内容<textarea name="csv" rows="5" placeholder="minute,phase,shelf_c,pressure_pa" required></textarea>
    <small>阶段字段使用 freeze、vacuum、finish。时间单位 min，板温 °C，压力 Pa。</small></label>
    <button class="primary">保存为待冻结曲线</button></form></details>`;
}

function sampleForm() {
  return `<details class="entry-form"><summary>录入阶段测量</summary><form data-action="sample">
    <label>试片编号<input name="specimen" placeholder="TRAY-D" required></label>
    <label>阶段<select name="stage">${Object.entries(stages).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label>
    <label>厚度 mm<input name="thickness_mm" type="number" step="0.00001" min="0.00001" max="200" required></label>
    <button class="primary">登记读数</button></form></details>`;
}

function samplesTable(samples) {
  const pairs = new Map();
  for (const sample of samples) {
    if (!pairs.has(sample.specimen)) pairs.set(sample.specimen, {});
    pairs.get(sample.specimen)[sample.stage] = sample;
  }
  if (!pairs.size) return '<p class="empty">冻结曲线后，至少为两枚试片登记冻干前、冻干后厚度。</p>';
  return `<table><thead><tr><th>试片编号</th><th>冻干前 mm</th><th>冻干后 mm</th><th>登记人</th></tr></thead><tbody>
    ${[...pairs].map(([specimen, readings]) => `<tr><th class="mono">${h(specimen)}</th><td>${number(readings.pre?.thickness_mm, 3)}</td>
    <td>${number(readings.post?.thickness_mm, 3)}</td><td>${h((readings.post || readings.pre).technician)}</td></tr>`).join('')}</tbody></table>`;
}

function curveCard(detail, operator) {
  const run = detail.runs[0];
  const collecting = detail.batch.state === 'collecting';
  return `<section class="sheet curve-card">
    ${sectionTitle('设备采集曲线', detail.batch.dryer)}
    ${run ? `<div class="curve-head"><span class="mono">${h(run.source_name)}</span>${badge(run.state)}</div>
      <div class="chart-legend"><span><i></i>搁板温度</span><span><i class="pressure"></i>腔体压力</span></div>
      <canvas id="chamber-chart" aria-label="搁板温度与真空腔压力随时间变化" role="img"></canvas>
      <div class="curve-foot"><span>${run.points.length} 个采集点 · ${run.points.at(-1).minute} min · ${new Set(run.points.map(point => phases[point.phase])).size} 个阶段</span>
      ${run.checksum ? `<span class="mono">SHA-256 ${h(run.checksum.slice(0, 12))}…</span>` : operator && collecting ? '<button class="primary compact" data-action="freeze">冻结曲线</button>' : ''}</div>
      ${detail.runs.length > 1 ? `<details class="versions"><summary>曲线版本记录（${detail.runs.length}）</summary><ul>${detail.runs.map(item => `<li><span class="mono">${h(item.source_name)}</span>${badge(item.state)} <small>${when(item.frozen_at)}</small></li>`).join('')}</ul></details>` : ''}
      ` : '<p class="empty">先从设备导出 CSV，并在本页导入第一条曲线。</p>'}
    ${operator && (collecting || detail.calibration?.state === 'held') ? importForm() : ''}
    </section>`;
}

export function batchesPage() {
  const detail = store.batch;
  const role = store.user.role;
  const operator = role === 'operator';
  const supervisor = role === 'supervisor';
  return `${pageTitle('批次与曲线', '登记冻干周期，冻结设备曲线并核对试片的前后厚度。', '<a class="text-link" href="#lab">打开收缩率试算 →</a>')}
    <div class="bench"><aside class="sheet roster">${sectionTitle('批次索引', `${store.batches.length} 批`)}
      <div class="batch-list">${store.batches.map(batch => `<a href="#batches/${h(batch.code)}" class="batch-link" ${batch.code === detail?.batch.code ? 'aria-current="true"' : ''}>
        <span><b class="mono">${h(batch.code)}</b><small>${h(batch.recipe_code)} / ${h(batch.dryer)}</small></span>${badge(batch.state)}</a>`).join('')}</div>
      ${operator ? batchForm() : ''}
      <details class="entry-form"><summary>配方档案（${store.recipes.length}）</summary><ul class="recipe-list">${store.recipes.map(recipe => `<li><b class="mono">${h(recipe.code)}</b><span>${h(recipe.product)} · ${windowLabel([recipe.window_low, recipe.window_high])}</span></li>`).join('')}</ul></details>
      ${supervisor ? recipeForm() : ''}</aside>
    ${detail ? `<div class="work-detail">
      <header class="batch-heading"><div><span class="overline">${h(detail.recipe.product)} / ${h(detail.batch.material_lot)}</span>
      <h2 class="mono">${h(detail.batch.code)}</h2></div>${badge(detail.batch.state)}</header>
      <dl class="specs"><div><dt>配方版本</dt><dd class="mono">${h(detail.recipe.code)}</dd></div><div><dt>固形物</dt><dd>${number(detail.recipe.solids_pct, 1)}%</dd></div>
      <div><dt>投料 / 标称厚度</dt><dd>${number(detail.batch.feed_mm, 1)} / ${number(detail.recipe.nominal_mm, 1)} mm</dd></div>
      <div><dt>收缩率工艺窗</dt><dd>${windowLabel([detail.recipe.window_low, detail.recipe.window_high])}</dd></div></dl>
      ${detail.readiness_issue ? `<p class="callout warning">${h(detail.readiness_issue)}</p>` : ''}
      ${curveCard(detail, operator)}
      <section class="sheet readings">${sectionTitle('试片厚度测量', '按试片编号配对')}${samplesTable(detail.samples)}
      ${operator && detail.runs[0]?.state === 'frozen' && detail.batch.state === 'collecting' ? sampleForm() : ''}
      ${supervisor && detail.batch.state === 'collecting' && !detail.readiness_issue ? `<details class="entry-form"><summary>认证为历史标定批次</summary>
      <form data-action="archive"><label class="wide">认证依据<input name="note" minlength="4" required></label><button class="primary">认证参考批次</button></form></details>` : ''}</section>
      </div>` : '<p class="empty">登记第一批冻干物料，随后导入曲线。</p>'}</div>`;
}
