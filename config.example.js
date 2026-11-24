/* ============================================================================
 *  站点配置
 * ----------------------------------------------------------------------------
 *  用法：
 *      cp config.example.js config.js
 *      填入下面的值
 *      和 index.html、admin.html、sync.js 一起上传到站点根目录
 *
 *  ⚠️ 先看清楚一件事
 *  本仓库是公开的，GitHub Pages 只能托管仓库里的文件。所以只要这个文件能被
 *  网站加载，它就能被任何人下载。下面这些值都按「可以公开」来选：
 *
 *    · supabaseAnonKey  —— anon key 本来就是给浏览器用的，公开是设计如此，
 *                          它受行级权限（RLS）约束，只能做允许它做的事。
 *
 *    · supabaseWriteKey —— 这个**不要**写在这里。它是写数据的钥匙，
 *                          登录 admin.html 时手工输入，只存在你自己的浏览器里。
 *                          写在文件里等于把它交出去。
 *
 *    · 更不要把 Supabase 的 service_role key 放到任何前端文件里。
 *      那把钥匙绕过所有权限检查，泄露等于整个数据库被人接管。
 * ========================================================================== */

window.__SITE_CONFIG__ = {

  /* ── Supabase ──────────────────────────────────────────────────────────
   * 在 https://supabase.com 建项目后，Dashboard → Settings → API 里能拿到这两个：
   *
   *   Project URL   → 形如 https://abcdefghijk.supabase.co
   *   anon public   → 一长串 JWT，以 eyJ 开头
   *
   * 两个都填了才会启用实时同步。少填任何一个会自动退回旧版行为：
   * 每 15 秒轮询 data.json，能用，只是慢。
   */
  supabaseUrl: '',
  supabaseAnonKey: '',

  /* ── 关于写入降级 ──────────────────────────────────────────────────────
   * 默认 false：Supabase 写不进去时直接报错，让你重试。
   *
   * 为什么默认不开：如果它失败时偷偷改写到 GitHub，就会出现两份数据 ——
   * Supabase 那边有 A 的内容，GitHub 这边只有 B 的内容。等 Supabase
   * 恢复后，谁也说不清该以谁为准。这种不一致往往要好几天后才被发现，
   * 那时已经无法追溯了。宁可明确失败一次。
   */
  allowGithubWriteFallback: false,

  /* ── 旧版配置（仍可用） ────────────────────────────────────────────────
   * 没有 Supabase 时的兜底：直接用 GitHub API 写 data.json。
   *
   * guestToken：写入令牌。用 fine-grained token，权限只勾：
   *   Repository access → Only select repositories → 你的仓库
   *   Permissions       → Contents: Read and write
   * 千万别用 classic token 的 repo 全作用域 —— 那能读写你账号下所有仓库。
   *
   * 注意：填了 supabaseUrl 之后，日常读写就不会再走这里了。
   */
  guestToken: '',

  /* 浏览记录中转地址（Cloudflare Worker）。填了之后访客记录走中转，
   * 前端不需要持有任何令牌。部署方法见 ../visit-relay/README.md */
  visitRelayUrl: '',
  visitRelayKey: ''
};
