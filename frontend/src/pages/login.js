import {brand} from '../components/ledger.js';

export function loginPage() {
  return `<main class="login-wrap"><div class="login-brand brand">${brand}</div>
    <div class="login-sheet"><div class="login-intro"><span class="overline">NORTH ISLE / MATERIAL LAB</span><h1>冻干批次<br>收缩率校准</h1>
      <p>从设备采集到复测签发，<br>把每个冻干周期的工艺证据留在同一本台账。</p>
      <div class="login-phases"><span>预冻</span><i></i><span>抽真空</span><i></i><span>解析干燥</span></div></div>
      <div class="login-form"><h2>登录实验室</h2><form data-action="login">
        <label>账号<input name="username" autocomplete="username" required></label>
        <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="primary">进入计量台</button></form>
        <p>演示账号</p><div class="quick-accounts"><button data-demo="operator">实验员</button><button data-demo="supervisor">签发主管</button><button data-demo="viewer">只读观察员</button></div></div></div>
    <footer>北屿果研 · 食品工艺实验室</footer></main>`;
}
