export const store = {
  token: sessionStorage.getItem('freeze-lab-token'), user: null, batches: [], recipes: [],
  batch: null, calibration: null, register: [],
};

export function setToken(token) {
  store.token = token;
  if (token) sessionStorage.setItem('freeze-lab-token', token);
  else sessionStorage.removeItem('freeze-lab-token');
}

async function request(path, method = 'GET', data) {
  const headers = { Accept: 'application/json' };
  if (store.token) headers.Authorization = `Bearer ${store.token}`;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const fields = error.fields?.map(field => `${field.field} · ${field.message}`).join('；');
    const failure = new Error([error.detail || '暂时无法连接实验室服务', fields].filter(Boolean).join(' · '));
    failure.status = response.status;
    throw failure;
  }
  return response.json();
}

const batchPath = code => `/batches/${encodeURIComponent(code)}`;
const fitPath = id => `/calibrations/${encodeURIComponent(id)}`;
const curvePath = (code, id) => `${batchPath(code)}/curves/${id}`;
export const api = {
  login: payload => request('/session', 'POST', payload), session: () => request('/session'),
  batches: () => request('/batches'), recipes: () => request('/recipes'),
  batch: code => request(batchPath(code)), register: () => request('/calibrations'),
  calibration: id => request(fitPath(id)),
  createBatch: data => request('/batches', 'POST', data),
  createRecipe: data => request('/recipes', 'POST', data),
  importCurve: (code, data) => request(`${batchPath(code)}/curves`, 'POST', data),
  freeze: (code, id) => request(`${curvePath(code, id)}/freeze`, 'POST'),
  sample: (code, id, data) => request(`${curvePath(code, id)}/samples`, 'POST', data),
  archive: (code, data) => request(`${batchPath(code)}/archive`, 'POST', data),
  fit: code => request(`${batchPath(code)}/calibration`, 'POST'),
  retry: id => request(`${fitPath(id)}/retry`, 'POST'),
  retest: (id, data) => request(`${fitPath(id)}/retest`, 'POST', data),
  release: (id, data) => request(`${fitPath(id)}/release`, 'POST', data),
};

export async function loadInventory() {
  [store.batches, store.recipes] = await Promise.all([api.batches(), api.recipes()]);
}
