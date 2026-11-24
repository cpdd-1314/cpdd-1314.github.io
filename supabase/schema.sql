-- ============================================================================
--  全球找对象 · Supabase 建库脚本
--  在 Supabase Dashboard → SQL Editor 里整段执行
-- ============================================================================
--  设计取舍说明（为什么不是「一张表存全部」）
--
--  最省事的做法是把整个 data.json 塞进一行 jsonb，前端读写那一行就行。
--  但那样有两个硬伤：
--    1) 每次保存都要重写整行 —— 31 个资料 + 233 个兑换码 + 141 条日志一次全写，
--       并发时会互相覆盖（后写的盖掉先写的）。
--    2) 访问记录是高频追加，跟主数据挤在同一行，会不断和资料审核抢锁。
--
--  所以拆成两类：
--    · 主状态（site_state）—— 低频写、整体读，用 version 做乐观锁
--    · 高频表（visits / site_stats）—— 单独落表，互不干扰
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 主状态表
-- ---------------------------------------------------------------------------
create table if not exists public.site_state (
  id          text        primary key default 'main',
  data        jsonb       not null default '{}'::jsonb,
  version     bigint      not null default 0,
  updated_at  timestamptz not null default now(),
  constraint site_state_single_row check (id = 'main')
);

comment on table  public.site_state is '站点全部结构化数据，单行。data 结构与原 data.json 完全一致，便于回滚。';
comment on column public.site_state.version is '乐观锁版本号，每次写入 +1。客户端写入时带上读到的版本，不匹配则拒绝。';

-- ---------------------------------------------------------------------------
-- 2. 访问记录表（高频追加，不参与主状态锁）
-- ---------------------------------------------------------------------------
create table if not exists public.visits (
  id          text        primary key,
  ts          bigint      not null,                 -- 毫秒时间戳，与原结构 keep 一致
  fp          text,                                 -- 设备指纹（原样保留，站点已有此逻辑）
  ip          text,
  country     text,
  region      text,
  city        text,
  lat         double precision,
  lng         double precision,
  is_admin    boolean     default false,
  payload     jsonb       not null default '{}'::jsonb,   -- 原始记录整条存这儿，字段升级不用改表
  created_at  timestamptz not null default now()
);

create index if not exists visits_ts_idx    on public.visits (ts desc);
create index if not exists visits_fp_idx    on public.visits (fp);
create index if not exists visits_geo_idx   on public.visits (country, region);

comment on column public.visits.payload is '原访问记录完整对象。结构化字段单独存一份便于查询与地图打点，payload 保底不丢信息。';

-- ---------------------------------------------------------------------------
-- 3. 站点统计表（按页面聚合，用 upsert 累加）
-- ---------------------------------------------------------------------------
create table if not exists public.site_stats (
  page        text        primary key,
  pv          bigint      not null default 0,
  dwell_sum   bigint      not null default 0,
  dwell_n     bigint      not null default 0,
  scroll_sum  bigint      not null default 0,
  scroll_n    bigint      not null default 0,
  zones       jsonb       not null default '[0,0,0,0,0,0,0,0,0]'::jsonb,
  clicks      jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.site_stats_daily (
  day         date        primary key,
  pv          bigint      not null default 0,
  dwell_sum   bigint      not null default 0,
  dwell_n     bigint      not null default 0
);

-- ---------------------------------------------------------------------------
-- 4. 密钥表（anon 完全不可读，只给 RPC 内部用）
-- ---------------------------------------------------------------------------
create table if not exists public.app_secrets (
  name   text primary key,
  value  text not null
);
-- 这一行不写进任何前端代码。执行完本脚本后，用下面这条换成你自己的长随机串：
--   insert into public.app_secrets(name, value) values ('write_key', '这里换成你的密钥')
--   on conflict (name) do update set value = excluded.value;
insert into public.app_secrets(name, value)
values ('write_key', 'CHANGE_ME_BEFORE_USE')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 4b. 管理员账号
-- ---------------------------------------------------------------------------
-- 后台登录用。密码不存明文，存 sha256(盐:用户名:密码)。
--
-- 预置账号：admin / admin123。上线后请立刻换掉 ——
-- 把你自己算出来的哈希写进去（任意 Linux / macOS 终端）：
--
--     printf 'cpdd-admin-v1:%s:%s' 你的用户名 你的密码 | sha256sum
--
-- 或者直接在 Supabase 的 SQL Editor 里：
--
--     update public.app_admins
--        set pass_hash = encode(sha256(convert_to('cpdd-admin-v1:admin:你的新密码', 'UTF8')), 'hex'),
--            updated_at = now()
--      where username = 'admin';
--
-- 要求 pgcrypto。Supabase 项目自带，这里仍显式声明一次，重复执行不会报错。
-- 先建 schema，是为了兼容自己装的 Postgres —— Supabase 里它本来就有。
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_admins (
  username    text        primary key,
  pass_hash   text        not null,
  note        text,
  updated_at  timestamptz not null default now()
);

-- 这张表不给任何前端角色读写权限。只有下面的 security definer 函数能碰它。
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

insert into public.app_admins(username, pass_hash, note)
values ('admin',
        'eaebd81c8c8d3e71c8fd6fcf1b78a8b271a174a922858fe30dd0ac820286b852',
        '默认账号，密码 admin123，请尽快修改')
on conflict (username) do nothing;

-- ---------------------------------------------------------------------------
-- 5. 整库快照（GitHub 当硬盘的落点：每天一份，出事了能整库回滚）
-- ---------------------------------------------------------------------------
create table if not exists public.snapshots (
  id          bigserial   primary key,
  taken_at    timestamptz not null default now(),
  bytes       integer     not null default 0,
  digest      text,                                  -- sha256，用于校验
  data        jsonb       not null
);

create index if not exists snapshots_taken_idx on public.snapshots (taken_at desc);

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
alter table public.site_state       enable row level security;
alter table public.visits           enable row level security;
alter table public.site_stats       enable row level security;
alter table public.site_stats_daily enable row level security;
alter table public.app_secrets      enable row level security;
alter table public.snapshots        enable row level security;

-- 主状态：任何人都能读（访客要看资料列表），但写只能走 RPC
drop policy if exists site_state_read on public.site_state;
create policy site_state_read on public.site_state
  for select using (true);

-- 访问记录：允许匿名插入（访客上报），但**不允许任何人直接读**
-- —— 读接口在后台，走 security definer 函数并校验密钥
drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits
  for insert with check (true);

-- 统计：允许读（面板要用），写入走 RPC 累加
drop policy if exists stats_read on public.site_stats;
create policy stats_read on public.site_stats for select using (true);

drop policy if exists stats_daily_read on public.site_stats_daily;
create policy stats_daily_read on public.site_stats_daily for select using (true);

-- app_secrets 与 snapshots 不开任何策略 = anon 既读不到也写不了

-- ---------------------------------------------------------------------------
-- 7. 写入函数：带密钥校验 + 版本乐观锁
-- ---------------------------------------------------------------------------
create or replace function public.put_site_state(
  p_key     text,
  p_data    jsonb,
  p_version bigint default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_ver  bigint;
  new_ver  bigint;
begin
  if p_key is null or p_key <> (select value from public.app_secrets where name = 'write_key') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select version into cur_ver from public.site_state where id = 'main' for update;
  if cur_ver is null then
    insert into public.site_state(id, data, version) values ('main', p_data, 1);
    return 1;
  end if;

  -- 传了版本就必须对得上，防止后写覆盖先写
  if p_version is not null and p_version <> cur_ver then
    raise exception 'version_conflict: current=%', cur_ver using errcode = '40001';
  end if;

  new_ver := cur_ver + 1;
  update public.site_state
     set data = p_data, version = new_ver, updated_at = now()
   where id = 'main';

  return new_ver;
end;
$$;

-- 访客上报访问记录：无需密钥（与现有行为一致），但做去重
create or replace function public.add_visit(p_record jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.visits (id, ts, fp, ip, country, region, city, lat, lng, is_admin, payload)
  values (
    coalesce(p_record->>'id', extract(epoch from now())::text || '-' || floor(random()*100000)::text),
    coalesce((p_record->>'time')::bigint, (extract(epoch from now())*1000)::bigint),
    p_record->>'fp',
    p_record->>'ip',
    p_record->>'country',
    p_record->>'region',
    p_record->>'city',
    nullif(p_record->>'lat','')::double precision,
    nullif(p_record->>'lng','')::double precision,
    coalesce((p_record->>'admin')::boolean, false),
    p_record
  )
  on conflict (id) do update
    set payload = public.visits.payload || excluded.payload;
end;
$$;

-- 站点统计累加：所有计数相加，绝不覆盖
create or replace function public.bump_stats(p_pages jsonb, p_daily jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pk text;
  pv jsonb;
  dk text;
  dv jsonb;
  z  jsonb;
  c  jsonb;
begin
  if p_pages is not null then
    for pk, pv in select * from jsonb_each(p_pages) loop
      insert into public.site_stats as s (page, pv, dwell_sum, dwell_n, scroll_sum, scroll_n, zones, clicks, updated_at)
      values (
        pk,
        coalesce((pv->>'pv')::bigint, 0),
        coalesce((pv->>'dwellSum')::bigint, 0),
        coalesce((pv->>'dwellN')::bigint, 0),
        coalesce((pv->>'scrollSum')::bigint, 0),
        coalesce((pv->>'scrollN')::bigint, 0),
        coalesce(pv->'zones', '[0,0,0,0,0,0,0,0,0]'::jsonb),
        coalesce(pv->'clicks', '{}'::jsonb),
        now()
      )
      on conflict (page) do update set
        pv         = s.pv         + excluded.pv,
        dwell_sum  = s.dwell_sum  + excluded.dwell_sum,
        dwell_n    = s.dwell_n    + excluded.dwell_n,
        scroll_sum = s.scroll_sum + excluded.scroll_sum,
        scroll_n   = s.scroll_n   + excluded.scroll_n,
        -- 九宫格逐格相加
        zones = (
          select coalesce(jsonb_agg(to_jsonb(
                   coalesce((s.zones->>i)::bigint,0) + coalesce((excluded.zones->>i)::bigint,0)
                 ) order by i), '[]'::jsonb)
          from generate_series(0, 8) as i
        ),
        -- 点击元素逐键相加
        clicks = (
          select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
            select k, sum(v)::bigint as v from (
              select key as k, (value)::text::bigint as v from jsonb_each_text(s.clicks)
              union all
              select key as k, (value)::text::bigint as v from jsonb_each_text(excluded.clicks)
            ) t group by k
          ) u
        ),
        updated_at = now();
    end loop;
  end if;

  if p_daily is not null then
    for dk, dv in select * from jsonb_each(p_daily) loop
      insert into public.site_stats_daily as d (day, pv, dwell_sum, dwell_n)
      values (
        dk::date,
        coalesce((dv->>'pv')::bigint, 0),
        coalesce((dv->>'dwellSum')::bigint, 0),
        coalesce((dv->>'dwellN')::bigint, 0)
      )
      on conflict (day) do update set
        pv        = d.pv        + excluded.pv,
        dwell_sum = d.dwell_sum + excluded.dwell_sum,
        dwell_n   = d.dwell_n   + excluded.dwell_n;
    end loop;

    -- 只保留最近 30 天
    delete from public.site_stats_daily
     where day < (current_date - interval '30 days');
  end if;
end;
$$;

-- 后台登录：校验用户名密码，通过则下发写入密钥
--
-- 为什么让 RPC 下发密钥，而不是把密钥写进 config.js：
-- config.js 是公开可下载的。密钥放在那里，等于后台的门只是块布帘。
-- 放在这里，前端拿不到，只有密码对了才临时发一把。
create or replace function public.admin_login(p_user text, p_pass text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  want_hash text;
  got_hash  text;
  wk        text;
begin
  p_user := coalesce(p_user, '');
  p_pass := coalesce(p_pass, '');

  select a.pass_hash into want_hash from public.app_admins a where a.username = p_user;

  -- 用户名不存在时也照算一次哈希。否则「不存在」立刻返回、「密码错」要多算一次，
  -- 这个时间差足够把站长的用户名试出来。
  --
  -- 用 convert_to 而不是 ::bytea：text 到 bytea 没有直接转换，
  -- 而且 ::bytea 会把反斜杠当转义符，密码里有 \ 就会算错。
  got_hash := encode(
    sha256(convert_to('cpdd-admin-v1:' || p_user || ':' || p_pass, 'UTF8')),
    'hex');

  if want_hash is null or got_hash <> want_hash then
    return jsonb_build_object('ok', false);
  end if;

  select s.value into wk from public.app_secrets s where s.name = 'write_key';

  -- 密钥还是占位值就拒掉。否则脚本跑完没改密钥，等于门没锁。
  if wk is null or wk = '' or wk = 'CHANGE_ME_BEFORE_USE' then
    return jsonb_build_object('ok', false, 'reason', 'write_key_not_set');
  end if;

  return jsonb_build_object('ok', true, 'write_key', wk);
end;
$$;

grant execute on function public.admin_login(text, text) to anon, authenticated;

-- 读访问记录（需密钥，供后台用）
create or replace function public.list_visits(p_key text, p_limit int default 500)
returns setof public.visits
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or p_key <> (select value from public.app_secrets where name = 'write_key') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query select * from public.visits order by ts desc limit greatest(1, least(p_limit, 5000));
end;
$$;

-- 打快照
create or replace function public.take_snapshot(p_key text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
  payload jsonb;
begin
  if p_key is null or p_key <> (select value from public.app_secrets where name = 'write_key') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select data into payload from public.site_state where id = 'main';
  insert into public.snapshots(bytes, data) values (length(payload::text), payload) returning id into new_id;
  -- 只留最近 14 份
  delete from public.snapshots where id not in (
    select id from public.snapshots order by taken_at desc limit 14
  );
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 实时订阅
-- ---------------------------------------------------------------------------
-- site_state 需要开启 Realtime，前端才能「秒同步」。
-- 在 Dashboard → Database → Replication → supabase_realtime 里把 site_state 勾上，
-- 或直接执行下面这行（已存在会报错，可忽略）：
alter publication supabase_realtime add table public.site_state;

-- ---------------------------------------------------------------------------
-- 9. 初始化那一行
-- ---------------------------------------------------------------------------
insert into public.site_state (id, data, version)
values ('main', '{}'::jsonb, 0)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 10. 让 PostgREST 立刻认识新函数
-- ---------------------------------------------------------------------------
-- 不执行这句，刚建好的 admin_login 可能要等几十秒才能通过 /rest/v1/rpc 调到，
-- 表现出来就是「明明建了函数，登录却提示密码错误」。
notify pgrst, 'reload schema';
