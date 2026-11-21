import {h, number, roles, states} from '../presentation.js';

export const brand = `<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
  <span>北屿果研<small>冻干计量台</small></span>`;

export function shell(active, user, body) {
  const links = [['batches', '批次与曲线'], ['lab', '收缩率试算'], ['release', '放行台账']];
  return `<header class="top"><div class="top-inner"><a href="#batches" class="brand">${brand}</a>
    <nav aria-label="工作台">${links.map(([id, label]) => `<a href="#${id}" ${active === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div class="account"><span><b>${h(roles[user.role])}</b><small>${h(user.username)}</small></span>
    <button data-action="logout" class="text-button">退出</button></div></div></header>
    <main class="workspace" id="main">${body}</main>`;
}

export function badge(value) {
  return `<span class="badge" data-state="${h(value)}"><i></i>${h(states[value] || value)}</span>`;
}

export function sectionTitle(title, meta = '') {
  return `<header class="section-title"><h2>${h(title)}</h2>${meta ? `<span>${h(meta)}</span>` : ''}</header>`;
}

export function pageTitle(title, explanation, extra = '') {
  return `<header class="page-title"><div><h1>${h(title)}</h1><p>${h(explanation)}</p></div>${extra}</header>`;
}

export function windowLabel([low, high]) {
  return `${number(low, 1)}–${number(high, 1)}%`;
}

export function measurementBand(window, prediction, recheck) {
  const [low, high] = window;
  const left = Math.min(low - 3, prediction ?? low, recheck ?? low);
  const right = Math.max(high + 3, prediction ?? high, recheck ?? high);
  const position = value => 100 * (value - left) / (right - left);
  return `<div class="band" aria-label="工艺窗 ${windowLabel(window)}，预测 ${number(prediction)}%，复测 ${number(recheck)}%">
    <div class="band-track"><div class="band-window" style="left:${position(low)}%;width:${position(high) - position(low)}%"></div>
    ${prediction === null ? '' : `<i class="pointer fit-pointer" style="left:${position(prediction)}%"></i>`}
    ${recheck === null ? '' : `<i class="pointer retest-pointer" style="left:${position(recheck)}%"></i>`}</div>
    <div class="band-axis"><span style="left:${position(low)}%">${number(low, 1)}%</span>
    <span style="left:${position(high)}%">${number(high, 1)}%</span></div></div>`;
}
