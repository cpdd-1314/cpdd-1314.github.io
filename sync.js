/* ============================================================================
 *  sync.js — 数据同步层
 * ----------------------------------------------------------------------------
 *  设计目标：把「数据从哪来、往哪写」和「页面怎么用」彻底分开。
 *
 *  之前数据和同步逻辑是长在 index.html 里的：轮询 GitHub 上的 data.json，
 *  每 15 秒一次。问题是 GitHub Pages 本身有 CDN 缓存，一次改动从写到所有人
 *  看到往往要几十秒到几分钟，而且每写一次就是一次 git commit，仓库只涨不缩。
 *
 *  现在换成三层：
 *      页面逻辑  →  SyncLayer  →  Supabase（实时）/ GitHub（降级与文件存储）
 *
 *  Supabase 负责结构化数据和实时推送（秒级），GitHub 负责媒体文件和整库快照。
 *  —— 前者快但免费额度有限，后者慢但几乎无上限，正好互补。
 *
 *  ⚠️ 一条硬约束：本文件**不能依赖任何外部 CDN**。
 *     站点的用户里有相当一部分在微信内置浏览器里打开，网络环境复杂，
 *     任何第三方域名都可能加载失败。所以 Supabase 的 Realtime 协议是
 *     手写的（约 150 行），而不是引入 supabase-js（压缩后仍有 100KB+）。
 * ========================================================================== */

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 配置
  // ---------------------------------------------------------------------------
  var CFG = {
    url: '',
    anonKey: '',
    writeKey: '',        // 写入密钥，用户在 config.js 里填；与 Supabase 里 app_secrets 一致
    table: 'site_state',
    enabled: false,
    // 降级轮询间隔（毫秒）。只有在实时连接不可用时才按这个频率兜底。
    pollMs: 30000,
    // 实时连接断了之后，多久重连
    reconnectMs: 3000,
    maxReconnectMs: 60000
  };

  var STATE = {
    mode: 'github',      // 'supabase' | 'github'
    version: null,       // 最近一次读到的乐观锁版本
    connected: false,
    lastError: '',
    lastSyncAt: 0,
    reconnectAttempt: 0
  };

  var listeners = [];
  var ws = null;
  var hbTimer = null;
  var pollTimer = null;
  var refSeq = 0;
  var joinRef = null;
  var manualClose = false;

  // ---------------------------------------------------------------------------
  // 小工具
  // ---------------------------------------------------------------------------
  function log() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[sync]');
    try { console.log.apply(console, a); } catch (e) { }
  }

  function warn() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[sync]');
    try { console.warn.apply(console, a); } catch (e) { }
  }

  function baseHeaders() {
    return {
      'apikey': CFG.anonKey,
      'Authorization': 'Bearer ' + CFG.anonKey,
      'Content-Type': 'application/json'
    };
  }

  function nextRef() {
    refSeq += 1;
    return String(refSeq);
  }

  function emit(evt) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](evt); } catch (e) { warn('listener error', e); }
    }
  }

  // ---------------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------------
  function init(opts) {
    opts = opts || {};

    // 配置来源优先级：显式传参 > window.__SITE_CONFIG__ > 内置空
    var c = global.__SITE_CONFIG__ || {};
    CFG.url = (opts.url || c.supabaseUrl || '').replace(/\/+$/, '');
    CFG.anonKey = opts.anonKey || c.supabaseAnonKey || '';
    CFG.writeKey = opts.writeKey || c.supabaseWriteKey || '';
    CFG.pollMs = Number(opts.pollMs || c.syncPollMs || 30000) || 30000;

    // 只有 url 与 anonKey 都像样才启用。少一个就老老实实退回 GitHub 模式，
    // 不然会出现「以为在秒同步、其实一条都没写进去」这种最难查的故障。
    CFG.enabled = !!(/^https?:\/\/.+/.test(CFG.url) && CFG.anonKey && CFG.anonKey.length > 20);

    STATE.mode = CFG.enabled ? 'supabase' : 'github';

    if (CFG.enabled) {
      log('Supabase 模式已启用 →', CFG.url);
    } else {
      log('未配置 Supabase，使用 GitHub 降级模式（15 秒轮询）');
    }
    return STATE.mode;
  }

  // ---------------------------------------------------------------------------
  // 读：整份状态
  // ---------------------------------------------------------------------------
  // 返回 { data, version, source }
  // 读不到就抛错，让调用方决定是降级还是提示。
  function readRemote() {
    if (!CFG.enabled) return Promise.reject(new Error('supabase_disabled'));

    var url = CFG.url + '/rest/v1/' + CFG.table +
      '?id=eq.main&select=data,version,updated_at';

    return fetch(url, { headers: baseHeaders(), cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
          // 表里还没有 main 行 —— 返回空对象，让上层用静态 data.json 兜底
          return { data: null, version: 0, source: 'supabase-empty' };
        }
        var row = rows[0];
        STATE.version = Number(row.version) || 0;
        STATE.lastSyncAt = Date.now();
        return { data: row.data || {}, version: STATE.version, source: 'supabase' };
      })
      .catch(function (e) {
        STATE.lastError = String(e && e.message || e);
        throw e;
      });
  }

  // ---------------------------------------------------------------------------
  // 写：带乐观锁
  // ---------------------------------------------------------------------------
  // data     : 要写入的完整状态对象
  // version  : 读到的版本号；null 表示不校验（首次写入用）
  // 返回新的 version
  function writeRemote(data, version, msg) {
    if (!CFG.enabled) return Promise.reject(new Error('supabase_disabled'));
    if (!CFG.writeKey) return Promise.reject(new Error('写入密钥未配置'));

    var url = CFG.url + '/rest/v1/rpc/put_site_state';
    var body = {
      p_key: CFG.writeKey,
      p_data: data,
      p_version: (version === null || version === undefined) ? null : version
    };

    return fetch(url, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify(body)
    })
      .then(function (r) {
        return r.text().then(function (txt) {
          if (!r.ok) {
            // 版本冲突单独抛，好让上层重读后重试
            if (txt.indexOf('version_conflict') >= 0) {
              var e = new Error('version_conflict');
              e.code = 'VERSION_CONFLICT';
              throw e;
            }
            if (txt.indexOf('unauthorized') >= 0) {
              var e2 = new Error('写入密钥不正确（Supabase app_secrets 里那个和 config.js 里填的要一致）');
              e2.code = 'UNAUTHORIZED';
              throw e2;
            }
            throw new Error('写入失败 HTTP ' + r.status + ' ' + txt.slice(0, 160));
          }
          var v = parseInt(txt, 10);
          STATE.version = isNaN(v) ? (STATE.version || 0) + 1 : v;
          STATE.lastSyncAt = Date.now();
          return STATE.version;
        });
      });
  }

  // ---------------------------------------------------------------------------
  // 实时订阅
  // ---------------------------------------------------------------------------
  // Supabase Realtime 走 Phoenix Channels 协议：
  //   连接 → 发 phx_join → 等服务端回 phx_reply → 之后收 postgres_changes
  // 心跳必须发，否则 60 秒无消息会被服务端断开。
  function connectRealtime() {
    if (!CFG.enabled || typeof WebSocket === 'undefined') return;

    var wsUrl = CFG.url.replace(/^http/, 'ws') +
      '/realtime/v1/websocket?apikey=' + encodeURIComponent(CFG.anonKey) + '&vsn=1.0.0';

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      warn('实时连接创建失败，降级轮询', e);
      startPolling();
      return;
    }

    var topic = 'realtime:site-state-' + Math.random().toString(36).slice(2, 8);
    joinRef = nextRef();

    ws.onopen = function () {
      STATE.connected = true;
      STATE.reconnectAttempt = 0;
      log('实时连接已建立');

      // 加入频道并声明要订阅的 postgres 变更
      ws.send(JSON.stringify({
        topic: topic,
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: '' },
            postgres_changes: [
              { event: '*', schema: 'public', table: CFG.table }
            ]
          },
          access_token: CFG.anonKey
        },
        ref: joinRef,
        join_ref: joinRef
      }));

      // 心跳：20 秒一次，留足余量（服务端 60 秒超时）
      clearInterval(hbTimer);
      hbTimer = setInterval(function () {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef()
          }));
        }
      }, 20000);

      // 实时通了，把兜底轮询拉长（不关掉：订阅偶尔会静默失效）
      startPolling(120000);

      emit({ type: 'connected' });
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (msg.event === 'phx_reply') {
        var st = msg.payload && msg.payload.status;
        if (st === 'ok') {
          log('已订阅 site_state 变更');
          emit({ type: 'subscribed' });
        } else if (st === 'error') {
          warn('订阅被拒绝', msg.payload);
          // 订阅被拒通常是因为没在 Realtime 里启用这张表
          STATE.lastError = '订阅被拒绝（检查 site_state 是否加入 supabase_realtime 发布）';
          emit({ type: 'error', error: STATE.lastError });
        }
        return;
      }

      // 数据变更。不同版本的 payload 结构略有差异，两种都兼容。
      if (msg.event === 'postgres_changes') {
        var p = msg.payload || {};
        var d = p.data || p;
        var rec = d.record || (d.new || {});
        var typ = d.type || d.eventType || 'UPDATE';

        // 自己刚写完也会收到一次回环，version 相同就没必要再拉一遍
        var incomingVer = Number(rec.version);
        if (!isNaN(incomingVer) && STATE.version !== null && incomingVer === STATE.version) {
          return;
        }
        if (incomingVer) STATE.version = incomingVer;

        STATE.lastSyncAt = Date.now();
        emit({ type: 'change', payload: rec, eventType: typ });
        return;
      }

      if (msg.event === 'phx_error') {
        warn('频道错误', msg.payload);
        return;
      }
    };

    ws.onerror = function () {
      STATE.lastError = '实时连接出错';
    };

    ws.onclose = function () {
      STATE.connected = false;
      clearInterval(hbTimer);
      if (manualClose) return;

      STATE.reconnectAttempt += 1;
      // 指数退避，但有上限，避免无限拉长导致彻底失联
      var wait = Math.min(
        CFG.reconnectMs * Math.pow(1.8, STATE.reconnectAttempt - 1),
        CFG.maxReconnectMs
      );
      warn('实时连接断开，' + Math.round(wait / 1000) + ' 秒后重连（第 ' + STATE.reconnectAttempt + ' 次）');
      startPolling();   // 断线期间先靠轮询顶着，别让数据停更
      setTimeout(connectRealtime, wait);
    };
  }

  // ---------------------------------------------------------------------------
  // 兜底轮询
  // ---------------------------------------------------------------------------
  // 有两个作用：① 实时彻底不可用时保证数据仍在更新
  //           ② 实时正常时也保留一个低频检查，防止订阅静默失效而无人察觉
  function startPolling(intervalMs) {
    var iv = intervalMs || CFG.pollMs;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (!CFG.enabled) return;
    pollTimer = setInterval(function () {
      emit({ type: 'poll' });
    }, iv);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ---------------------------------------------------------------------------
  // 订阅入口
  // ---------------------------------------------------------------------------
  function subscribe(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function start() {
    if (!CFG.enabled) return;
    connectRealtime();
    if (!pollTimer) startPolling();
  }

  function destroy() {
    manualClose = true;
    clearInterval(hbTimer);
    stopPolling();
    if (ws) { try { ws.close(); } catch (e) { } }
    ws = null;
    STATE.connected = false;
  }

  // ---------------------------------------------------------------------------
  // 访问记录与统计（走独立表，不跟主状态抢锁）
  // ---------------------------------------------------------------------------
  function addVisit(record) {
    if (!CFG.enabled) return Promise.reject(new Error('supabase_disabled'));
    return fetch(CFG.url + '/rest/v1/rpc/add_visit', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ p_record: record })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return true;
    });
  }

  function bumpStats(pages, daily) {
    if (!CFG.enabled) return Promise.reject(new Error('supabase_disabled'));
    return fetch(CFG.url + '/rest/v1/rpc/bump_stats', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ p_pages: pages, p_daily: daily })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // 文件存储：GitHub 当硬盘
  // ---------------------------------------------------------------------------
  // 数据库存结构化数据（小、要查、要实时），
  // 图片视频存 GitHub（大、几乎不查、走 CDN 直出）。
  // 这样 Supabase 免费额度不会被几十 MB 的媒体吃光。
  function uploadToGitHub(path, base64Content, token, owner, repo, msg) {
    if (!token) return Promise.reject(new Error('缺少 GitHub 令牌'));
    var api = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;
    var headers = {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    };

    // 先查是否已存在（取 sha，覆盖时需要）
    return fetch(api, { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (exist) {
        var body = {
          message: msg || ('upload ' + path),
          content: base64Content
        };
        if (exist && exist.sha) body.sha = exist.sha;
        return fetch(api, {
          method: 'PUT',
          headers: headers,
          body: JSON.stringify(body)
        });
      })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) { throw new Error('上传失败 HTTP ' + r.status + ' ' + t.slice(0, 120)); });
        }
        return r.json();
      })
      .then(function (j) {
        return {
          url: './' + path,
          raw: (j.content && j.content.download_url) || ''
        };
      });
  }

  // ---------------------------------------------------------------------------
  // 状态查询（给面板显示用）
  // ---------------------------------------------------------------------------
  function status() {
    return {
      mode: STATE.mode,
      enabled: CFG.enabled,
      connected: STATE.connected,
      version: STATE.version,
      lastError: STATE.lastError,
      lastSyncAt: STATE.lastSyncAt,
      reconnectAttempt: STATE.reconnectAttempt
    };
  }

  // ---------------------------------------------------------------------------
  global.SyncLayer = {
    init: init,
    readRemote: readRemote,
    writeRemote: writeRemote,
    subscribe: subscribe,
    start: start,
    destroy: destroy,
    addVisit: addVisit,
    bumpStats: bumpStats,
    uploadToGitHub: uploadToGitHub,
    status: status,
    get mode() { return STATE.mode; },
    get enabled() { return CFG.enabled; }
  };

})(window);
