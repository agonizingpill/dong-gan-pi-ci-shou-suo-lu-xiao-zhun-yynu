import {api, loadInventory, setToken, store} from './api.js';
import {chart} from './components/curve.js';
import {shell} from './components/ledger.js';
import {batchesPage} from './pages/batches.js';
import {labPage, releasePage} from './pages/calibration.js';
import {loginPage} from './pages/login.js';
import {h, readCurveCSV} from './presentation.js';

const root = document.getElementById('app');
const notice = document.getElementById('notice');
let stopChart;
let hideNotice;
let renderIndex = 0;

function toast(message, error = false) {
  clearTimeout(hideNotice);
  notice.textContent = message;
  notice.dataset.error = error ? 'true' : 'false';
  notice.hidden = false;
  hideNotice = setTimeout(() => { notice.hidden = true; }, 6000);
}

function logout() {
  setToken(null);
  store.user = null;
  location.hash = 'login';
  draw();
}

function show(body) {
  stopChart?.();
  stopChart = null;
  root.innerHTML = body;
}

async function draw() {
  const index = ++renderIndex;
  if (!store.user) {
    show(loginPage());
    return;
  }
  const [fragment, id] = location.hash.slice(1).split('/');
  const current = ['batches', 'lab', 'release'].includes(fragment) ? fragment : 'batches';
  try {
    if (current === 'release') {
      const [register, entry] = await Promise.all([api.register(), id ? api.calibration(id) : null]);
      if (index !== renderIndex) return;
      store.register = register;
      store.calibration = entry;
    } else {
      await loadInventory();
      const selected = id || store.batch?.batch.code || store.batches.find(batch => batch.code === 'FD-1121A')?.code || store.batches[0]?.code;
      const detail = selected ? await api.batch(selected) : null;
      if (index !== renderIndex) return;
      store.batch = detail;
    }
    const pages = {batches: batchesPage, lab: labPage, release: releasePage};
    show(shell(current, store.user, pages[current]()));
    const canvas = document.getElementById('chamber-chart');
    if (canvas) stopChart = chart(canvas, store.batch.runs[0].points);
  } catch (error) {
    if (index !== renderIndex) return;
    if (error.status === 401) {
      logout();
      toast('会话已失效，请重新登录', true);
      return;
    }
    show(shell(current, store.user, `<p class="callout warning">${h(error.message)} <button class="text-button" data-action="refresh">重试</button></p>`));
  }
}

function open(path) {
  if (`#${path}` === location.hash) return draw();
  location.hash = path;
}

async function enter(credentials) {
  const result = await api.login(credentials);
  setToken(result.token);
  store.user = result;
  store.batch = null;
  open('batches');
}

const commands = {
  logout, refresh: draw,
  login: enter,
  createBatch: async data => {
    const batch = await api.createBatch(data);
    open(`batches/${batch.code}`);
    toast('冻干批次已登记');
  },
  createRecipe: async data => {
    await api.createRecipe(data);
    await draw();
    toast('新配方版本已保存');
  },
  importCurve: async ({source_name, csv}) => {
    await api.importCurve(store.batch.batch.code, {source_name, points:readCurveCSV(csv)});
    await draw();
    toast('待冻结曲线已导入');
  },
  freeze: async () => {
    await api.freeze(store.batch.batch.code, store.batch.runs[0].id);
    await draw();
    toast('设备曲线已冻结，可开始录入试片');
  },
  sample: async data => {
    await api.sample(store.batch.batch.code, store.batch.runs[0].id, data);
    await draw();
    document.querySelector('form[data-action="sample"]')?.closest('details')?.setAttribute('open', '');
    toast('阶段读数已登记');
  },
  archive: async data => {
    await api.archive(store.batch.batch.code, data);
    await draw();
    toast('批次已认证为标定参考');
  },
  fit: async () => {
    const entry = await api.fit(store.batch.batch.code);
    open(`release/${entry.id}`);
    toast('试算已提交给计量 worker');
  },
  retry: async () => {
    await api.retry(store.calibration.entry.id);
    await draw();
    toast('已重新排队');
  },
  retest: async data => {
    await api.retest(store.calibration.entry.id, data);
    await draw();
    toast('独立试片复测已登记');
  },
  release: async data => {
    await api.release(store.calibration.entry.id, data);
    await draw();
    toast('批次放行已签发');
  },
};

async function execute(action, payload, button) {
  if (button) button.disabled = true;
  try {
    await commands[action](payload);
  } catch (error) {
    if (error.status === 401 && action !== 'login') logout();
    toast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

root.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  execute(form.dataset.action, Object.fromEntries(new FormData(form)), event.submitter);
});
root.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.dataset.demo) {
    const form = root.querySelector('form[data-action="login"]');
    form.elements.username.value = button.dataset.demo;
    form.elements.password.value = 'Lab-demo-1062';
    form.elements.username.focus();
  }
  if (button?.dataset.action) execute(button.dataset.action, undefined, button);
});
root.addEventListener('change', async event => {
  const target = event.target;
  if (target.dataset.action === 'chooseBatch') open(`lab/${target.value}`);
  if (target.dataset.action === 'loadCsv' && target.files[0]) {
    const file = target.files[0];
    if (file.size > 256_000) { toast('CSV 文件应小于 256 KB', true); return; }
    try {
      target.form.elements.csv.value = await file.text();
      target.form.elements.source_name.value = file.name;
    } catch (error) { toast(error.message, true); }
  }
});
window.addEventListener('hashchange', draw);
try {
  if (store.token) store.user = await api.session();
} catch (error) {
  setToken(null);
  toast(error.message, true);
}
await draw();
