export const roles = {operator: '实验员', supervisor: '签发主管', viewer: '只读观察员'};
export const stages = {pre: '冻干前', post: '冻干后'};
export const phases = {freeze: '预冻', vacuum: '抽真空', finish: '解析干燥'};
export const states = {
  collecting: '采集中', reference: '标定参考', calibrating: '试算中', review: '待复核', released: '已放行',
  draft: '待决策', frozen: '已冻结', queued: '已排队', running: '计算中', failed: '计算失败',
  awaiting_verification: '待复测确认', retest_required: '超窗待复测', verified: '待签发', held: '留置',
  rejected: '已驳回', active: '已启用', superseded: '已作废',
};
export const strategies = {
  batch_loo: '逐批留一 / 批次等权（现行）',
  lot_groupout: '原料批整组留出 / 原料批等权（候选）',
};
export const strategyShort = {batch_loo: '逐批留一', lot_groupout: '原料批整组留出'};
export const verdicts = {
  correct_in: '窗内判窗内', correct_out: '超窗判超窗',
  false_accept: '误放（超窗却判窗内）', false_reject: '误留（窗内却判超窗）',
};
export const events = {
  'batch.register': '登记批次', 'curve.import': '采集曲线', 'curve.freeze': '冻结曲线', 'sample.record': '登记测量',
  'fit.queue': '提交试算', 'fit.retry': '重试试算', 'fit.failed': '计算失败', 'fit.completed': '试算完成',
  'retest.opened': '创建超窗复测单', 'retest.verified': '复测确认', 'retest.held': '复测留置',
  'release.sign': '主管签发', 'reference.archive': '认证参考批次',
  'model.review.request': '发起模型评审', 'model.review.activate': '启用候选模型',
  'model.review.reject': '驳回模型评审',
};

export function h(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}

export function number(value, digits = 2) {
  return value == null ? '—' : Number(value).toFixed(digits);
}

export function when(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}).format(new Date(value));
}

export function readCurveCSV(source) {
  const lines = source.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0]?.toLowerCase() === 'minute,phase,shelf_c,pressure_pa') lines.shift();
  return lines.map((line, index) => {
    const fields = line.split(',').map(value => value.trim());
    const [minute, phase, shelf, pressure] = fields;
    if (fields.length !== 4 || ![minute, shelf, pressure].every(value => value && Number.isFinite(Number(value)))) {
      throw new Error(`第 ${index + 1} 条采集记录应包含分钟、阶段、板温、压力四列`);
    }
    return {minute: Number(minute), phase, shelf_c: Number(shelf), pressure_pa: Number(pressure)};
  });
}
