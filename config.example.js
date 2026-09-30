/* ============================================================================
 * 站点密钥配置（可选）
 * ----------------------------------------------------------------------------
 * 当前 index.html 里已经内置了一个（混淆过的）写入令牌，所以**这个文件不是必须的**。
 * 它存在的意义是：让你可以在不改源码的情况下覆盖内置配置。
 *
 * 优先级：这个文件里的值 > index.html 里的内置值
 *
 * ── 什么时候你会需要它 ──
 * 1) 你想换成自己的令牌（比如内置的失效了）
 * 2) 你部署了 Cloudflare 中转（推荐，见 ../visit-relay/README.md），
 *    想彻底不用前端令牌 —— 那就把 guestToken 留空，只填 visitRelayUrl
 *
 * ── ⚠️ 重要提醒 ──
 * 本仓库是公开的，GitHub Pages 只能托管仓库里的文件。
 * 所以：**只要这个文件能被网站加载，它就能被任何人下载。**
 * 往这里填真实令牌，安全性等同于写进 index.html。
 * 真要安全，用中转方案，别在前端放令牌。
 *
 * ── 用法 ──
 * cp config.example.js config.js   # 复制
 * 编辑 config.js 填值
 * 上传到 index.html 同级目录
 * ========================================================================== */
window.__SITE_CONFIG__ = {
  /* 写入令牌。留空或不填这个文件 → 使用 index.html 里的内置值。
   *
   * 如果确实要填，请用 fine-grained token，权限只勾：
   *   · Repository access → Only select repositories → cpdd-1314.github.io
   *   · Permissions       → Contents: Read and write
   * 千万别再用 classic token 的 repo 全作用域 —— 那能读写你账号下所有仓库。
   */
  guestToken: '',

  /* 浏览记录中转地址（推荐方案）
   * 部署了 Cloudflare Worker 后填这里，形如：
   *   'https://cpdd-visit-relay.你的子域.workers.dev'
   * 填了之后访客记录走中转，前端完全不需要令牌。 */
  visitRelayUrl: '',

  /* 中转密钥。Worker 那边没配 RELAY_KEY 的话，这里也留空。 */
  visitRelayKey: ''
};
