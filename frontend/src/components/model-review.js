import {badge, sectionTitle} from './ledger.js';
import {h, number, strategies, strategyShort, verdicts, when} from '../presentation.js';

function verdictTag(value) {
  return `<span class="verdict-tag" data-verdict="${h(value)}">${h(verdicts[value] || value)}</span>`;
}

function metricPills(evalBlock) {
  return `<span class="metric-pill">误放 <b>${number(evalBlock.false_accept, 0)}</b></span>
    <span class="metric-pill">误留 <b>${number(evalBlock.false_reject, 0)}</b></span>
    <span class="metric-pill">RMSE <b>${number(evalBlock.rmse_pct, 2)} pp</b></span>`;
}

function groupTable(evalBlock) {
  return `<div class="table-scroll"><table class="group-table">
    <thead><tr><th>${evalBlock.strategy === 'lot_groupout' ? '原料批 / 留出冻干批' : '留出冻干批'}</th>
    <th>实测 %</th><th>预测 %</th><th>判窗</th></tr></thead><tbody>
    ${evalBlock.groups.map(group => `<tr>
      <th><span class="mono">${h(group.label)}</span>${
        group.held_out_batches?.length > 1 ? `<br><small class="mono">${h(group.held_out_batches.join('、'))}</small>` : ''
      }</th>
      <td class="mono">${number(group.observed_pct)}</td>
      <td class="mono">${number(group.prediction_pct)}</td>
      <td>${verdictTag(group.verdict)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function strategyCard(key, evalBlock) {
  return `<div class="padded"><div class="model-line"><strong>${h(strategies[key])}</strong>${metricPills(evalBlock)}</div>
    ${groupTable(evalBlock)}</div>`;
}

function reviewActions(review, role) {
  if (role !== 'supervisor' || review.state !== 'draft') return '';
  return `<div class="padded" style="border-top:1px solid var(--line)">
    <form data-action="activateModel" data-review="${review.id}">
      <label class="wide">启用依据<input name="note" minlength="4" placeholder="确认误放更少且误留不增，同意启用" required></label>
      <button class="primary" ${review.eligible ? '' : 'disabled title="候选未满足启用条件"'}>启用候选模型</button></form>
    <form data-action="rejectModel" data-review="${review.id}" style="margin-top:10px">
      <label class="wide">驳回说明<input name="note" minlength="4" placeholder="证据不足，维持现行模型" required></label>
      <button class="text-button">驳回评审</button></form></div>`;
}

function reviewCard(review, role) {
  const candidate = review.evaluation.lot_groupout;
  const incumbent = review.evaluation.batch_loo;
  return `<section class="sheet model-review">
    ${sectionTitle(`模型评审 #${String(review.id).padStart(3, '0')}`,
      `基准 v${review.basis_version} · ${review.n_references} 参考批 / ${review.n_material_lots} 原料批`)}
    <div class="padded"><div class="model-line">
      ${badge(review.state)}
      <strong style="color:${review.eligible ? 'var(--teal)' : 'var(--amber)'}">${
        review.eligible ? '候选满足启用条件' : '候选不满足启用条件'}</strong>
      <small>${when(review.created_at)}</small></div>
      <p class="callout ${review.eligible ? '' : 'warning'}" style="margin-top:10px">${h(review.basis_note)}</p>
      <dl class="ledger-meta"><div><dt>现行判窗</dt><dd>误放 ${incumbent.false_accept} 组 · 误留 ${incumbent.false_reject} 组</dd></div>
      <div><dt>候选判窗</dt><dd>误放 ${candidate.false_accept} 组 · 误留 ${candidate.false_reject} 组</dd></div>
      <div><dt>参考指纹</dt><dd class="mono hash">${h(review.reference_hash.slice(0, 24))}…</dd></div>
      ${review.decision_note ? `<div><dt>主管决策</dt><dd>${h(review.decided_by)} · ${h(review.decision_note)}</dd></div>` : ''}
      </dl></div>
    ${strategyCard('batch_loo', incumbent)}
    ${strategyCard('lot_groupout', candidate)}
    ${reviewActions(review, role)}
  </section>`;
}

export function modelReviewPanel(store) {
  const data = store.modelReviews;
  const role = store.user.role;
  const recipe = data?.recipe;
  if (!recipe) return '';
  const reviews = data.reviews || [];
  return `<section class="sheet model-panel">
    ${sectionTitle('模型策略与评审', h(strategyShort[recipe.model_strategy] || recipe.model_strategy))}
    <div class="padded"><dl class="ledger-meta">
      <div><dt>在用策略</dt><dd>${h(strategies[recipe.model_strategy] || recipe.model_strategy)}</dd></div>
      <div><dt>在用版本</dt><dd class="mono">v${number(recipe.model_version, 0)}</dd></div>
      <div><dt>启用门槛</dt><dd>候选误放更少且误留不增；原料批不足三组沿用现行</dd></div></dl>
    ${role === 'supervisor' ? `<details class="entry-form"><summary>发起原料批整组留出评审</summary>
      <form data-action="requestModelReview"><label class="wide">评审说明<input name="note" minlength="4"
        placeholder="基于当前在用版本与已认证参考批次发起" required></label>
        <button class="primary">生成双策略判窗对比</button></form></details>`
      : '<p class="empty">仅签发主管可发起、启用或驳回模型评审。</p>'}</div>
    ${reviews.length ? reviews.map(review => reviewCard(review, role)).join('')
      : '<p class="empty">该配方暂无模型评审，发起后可在此查看各组判窗与启用依据。</p>'}
  </section>`;
}
