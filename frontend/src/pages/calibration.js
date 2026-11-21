import {store} from '../api.js';
import {badge, measurementBand, pageTitle, sectionTitle, windowLabel} from '../components/ledger.js';
import {events, h, number, stages, when} from '../presentation.js';

export function labPage() {
  const detail = store.batch;
  const entry = detail?.calibration;
  const recipe = detail?.recipe;
  const staff = store.user.role !== 'viewer';
  return `${pageTitle('收缩率试算', '从同配方的已认证参考批次估计收缩率。试算输入会随校准单冻结。')}
    <div class="lab-grid"><section class="sheet lab-request">${sectionTitle('选定试算批次')}
      <div class="padded"><label>冻干批次<select id="lab-batch" data-action="chooseBatch">${store.batches.map(batch =>
        `<option value="${h(batch.code)}" ${batch.code === detail?.batch.code ? 'selected' : ''}>${h(batch.code)} · ${h(batch.recipe_code)}</option>`).join('')}</select></label>
      ${detail ? `<dl class="ledger-meta"><div><dt>配方</dt><dd>${h(recipe.product)} / <span class="mono">${h(recipe.code)}</span></dd></div>
      <div><dt>设备曲线</dt><dd class="mono">${h(detail.runs[0]?.source_name || '未导入')}</dd></div>
      <div><dt>首测记录</dt><dd>${detail.samples.length} 条阶段测量</dd></div>
      <div><dt>收缩率工艺窗</dt><dd class="mono">${windowLabel([recipe.window_low, recipe.window_high])}</dd></div></dl>
      ${detail.readiness_issue ? `<p class="callout warning">${h(detail.readiness_issue)} <a href="#batches/${h(detail.batch.code)}">处理采集记录 →</a></p>` : ''}
      ${entry ? `<a class="primary button-link" href="#release/${entry.id}">查看校准单</a>` : staff && detail.batch.state === 'collecting' ?
        `<button data-action="fit" class="primary" ${detail.readiness_issue ? 'disabled' : ''}>提交冻结曲线试算</button>` : `<p class="empty">${detail.batch.state === 'reference' ? '该批次已认证为历史参考。' : '当前账户仅可查看采集与试算记录。'}</p>`}
      ` : '<p class="empty">先在批次与曲线登记物料。</p>'}</div></section>
      <section class="sheet fitting"><div>${sectionTitle('参考与拟合')}
      <div class="padded"><strong class="algorithm">Yeo–Johnson<br><span>+ Ridge</span></strong>
      <ol class="method"><li>取同配方通过主管认证的参考批次。</li><li>从冻结曲线提取真空段时长、均压、均温，并结合配方及投料厚度。</li>
      <li>对有变化的特征变换及标准化，拟合 Ridge；逐批留一计算 RMSE。</li></ol></div></div>
      ${entry?.result ? `<div class="fit-summary"><span>预测收缩率</span><strong class="mono">${number(entry.prediction_pct)}%</strong>${badge(entry.state)}</div>` : ''}</section></div>`;
}

function registerTable() {
  if (!store.register.length) return '<p class="empty">提交首个符合条件的批次后，可在此跟踪复测与签发。</p>';
  return `<table><thead><tr><th>冻干批次</th><th>校准状态</th><th>预测收缩率</th><th>冻结曲线</th></tr></thead><tbody>
    ${store.register.map(entry => `<tr><th><a class="mono" href="#release/${entry.id}">${h(entry.batch_code)} / ${String(entry.id).padStart(3, '0')}</a></th>
    <td>${badge(entry.state)}</td><td class="mono">${entry.prediction_pct == null ? '—' : `${number(entry.prediction_pct)}%`}</td><td class="mono">${h(entry.source_name)}</td></tr>`).join('')}</tbody></table>`;
}

function workflow(data) {
  const {entry, batch, retest} = data;
  const role = store.user.role;
  const eligibility = {
    queued: '等候计量 worker 接单。', running: '正在对已冻结的输入拟合参考批次。',
    failed: '计算失败，可按原始快照重试。', awaiting_verification: '预测处于工艺窗。签发前需要另一枚试片的复测。',
    retest_required: '预测超出工艺窗。完成独立试片复测后留置本次校准，重新采集周期再试算。',
    verified: '试片复测处于工艺窗，等候主管签发。', held: '本次校准已留置。创建新的设备周期并重新测量。',
    released: '主管签发完成，冻干批次已放行。',
  };
  return `<section class="sheet workflow">${sectionTitle('复测与签发')}
    <div class="padded"><p class="callout ${['held','retest_required','failed'].includes(entry.state) ? 'warning' : ''}">${h(eligibility[entry.state])}</p>
    ${retest.length ? `<dl class="ledger-meta"><div><dt>复测试片</dt><dd class="mono">${h(retest[0].specimen)}</dd></div>
      ${retest.map(sample => `<div><dt>${h(stages[sample.stage])}厚度</dt><dd class="mono">${number(sample.thickness_mm, 3)} mm</dd></div>`).join('')}
      <div><dt>复测记录</dt><dd>${h(entry.recheck_note)}</dd></div></dl>` : ''}
    ${entry.signed_by ? `<dl class="ledger-meta"><div><dt>签发人</dt><dd>${h(entry.signed_by)}</dd></div>
      <div><dt>签发时间</dt><dd>${when(entry.signed_at)}</dd></div><div><dt>签发意见</dt><dd>${h(entry.release_note)}</dd></div></dl>` : ''}
    ${entry.error ? `<p class="callout warning">${h(entry.error)}</p>` : ''}
    ${entry.state === 'failed' && role !== 'viewer' ? '<button class="primary" data-action="retry">按原输入重试</button>' : ''}
    ${['queued','running'].includes(entry.state) ? '<button class="text-button" data-action="refresh">刷新计算状态</button>' : ''}
    ${entry.state === 'held' ? `<a class="text-link" href="#batches/${h(batch.code)}">返回批次曲线 →</a>` : ''}
    ${['awaiting_verification','retest_required'].includes(entry.state) && role === 'operator' ? `<form class="retest-form" data-action="retest">
      <label class="wide">独立试片编号<input name="specimen" placeholder="TRAY-R1" required></label>
      <label>冻干前 mm<input name="before_mm" type="number" min="0.00001" max="200" step="0.00001" required></label>
      <label>冻干后 mm<input name="after_mm" type="number" min="0.00001" max="200" step="0.00001" required></label>
      <label class="wide">复测说明<textarea name="note" rows="2" minlength="4" required></textarea></label>
      <button class="primary">登记复测</button></form>` : ''}
    ${entry.state === 'verified' && role === 'supervisor' ? `<form data-action="release"><label class="wide">签发意见<textarea name="note" rows="2" minlength="4" required></textarea></label>
      <button class="primary">签发批次放行</button></form>` : ''}</div></section>`;
}

export function releasePage() {
  const data = store.calibration;
  if (!data) return `${pageTitle('放行台账', '按校准单核对预测、复测与最终签发。')}
    <section class="sheet stand-alone-register">${sectionTitle('校准记录', `${store.register.length} 单`)}${registerTable()}</section>`;
  const {entry, batch, curve} = data;
  return `${pageTitle('放行详情', `${batch.code} / ${curve.source_name}`, '<a class="text-link" href="#release">← 放行台账</a>')}
    <div class="release-grid"><div>
      <section class="sheet result-panel">${sectionTitle(`校准单 #${String(entry.id).padStart(3, '0')}`, entry.snapshot.recipe)}<div class="padded">
      <div class="results"><div><span>预测收缩率</span><strong class="mono">${entry.prediction_pct == null ? '—' : `${number(entry.prediction_pct)}%`}</strong></div>
      <div><span>实测复核</span><strong class="mono">${entry.recheck_pct == null ? '—' : `${number(entry.recheck_pct)}%`}</strong></div>${badge(entry.state)}</div>
      ${measurementBand(entry.snapshot.window, entry.prediction_pct, entry.recheck_pct)}
      <div class="fit-metrics"><span><i class="dot prediction"></i>预测</span><span><i class="dot recheck"></i>复测</span><span><i class="dot window"></i>工艺窗</span></div></div></section>
      <section class="sheet evidence">${sectionTitle('拟合证据', `${entry.snapshot.training.length} 个参考批次`)}<div class="padded">
      <dl class="evidence-grid"><div><dt>模型</dt><dd>Yeo–Johnson / Ridge</dd></div><div><dt>逐批留一 RMSE</dt><dd class="mono">${number(entry.result?.loo_rmse, 3)} pp</dd></div>
      <div><dt>Ridge α / 求解器</dt><dd class="mono">${number(entry.result?.alpha, 2)} / ${h(entry.result?.solver || '—')}</dd></div><div><dt>复现种子</dt><dd class="mono">${h(entry.result?.seed || '—')}</dd></div></dl>
      <details class="entry-form evidence-details"><summary>参考批次与快照指纹</summary><ul>${entry.snapshot.training.map(reference => `<li><span class="mono">${h(reference.batch)}</span> <span>${number(reference.observed)}%</span></li>`).join('')}</ul>
      <p class="hash mono">${h(entry.input_hash)}</p></details></div></section>
    </div><div>${workflow(data)}<section class="sheet history">${sectionTitle('批次审计记录')}
      <ol>${data.events.map(event => `<li><b>${h(events[event.action] || (event.action.endsWith('.blocked') ? '操作拒绝' : event.action))}</b><time>${when(event.happened_at)}</time>
      <p>${h(event.actor)} · ${h(event.detail)}</p></li>`).join('')}</ol></section></div></div>`;
}
