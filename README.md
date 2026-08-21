# 🌍 全球找对象 — 发布到 GitHub 图文教程（小白版）

> 全程**网页点击、不需要装任何软件、不需要敲命令**。照做即可上线。

你需要准备的只有 3 个文件（都在 `global-dating-deploy.zip` 里）：
- `index.html` —— 网站本体
- `data.json` —— 数据（微信号 + 嘉宾档案）
- `README.md` —— 本说明

---

## 第 1 步：下载 zip 并解压

1. 把 `global-dating-deploy.zip` 下载到电脑。
2. 解压，得到 `index.html`、`data.json`、`README.md` 三个文件。

## 第 2 步：新建一个空仓库

1. 登录 [github.com](https://github.com)。
2. 右上角点 **「+」→ New repository**（新建仓库）。
3. **Repository name（仓库名）**：填 `global-dating`（用英文，只能字母/数字/横杠）。
4. **Visibility（可见性）**：选 **Public**（公开）。
5. ⚠️ 下面三个勾选框 **一个都别勾**（不勾 Add a README、.gitignore、license）——要的是**空仓库**。
6. 点 **Create repository**。

## 第 3 步：把文件拖进去

1. 创建后会进入仓库页面，点绿色按钮 **「Add file」→ Upload files**。
2. 把解压出来的 **3 个文件**（`index.html`、`data.json`、`README.md`）**直接拖进页面虚线框**。
3. 拉到底部点 **Commit changes**（提交）。
   - 上传页面出现"提交成功"提示即可。

## 第 4 步：补建一个隐藏文件 `.nojekyll`

> 为什么：网页拖拽**不会上传以 `.` 开头的隐藏文件**，但这个文件很关键，能让 GitHub 原样托管你的网站（不搞 Jekyll 处理）。需要手动创建一次，10 秒搞定。

1. 回到仓库首页，点 **「Add file」→ Create new file**。
2. 在文件名输入框里**完整输入**：`.nojekyll`
3. 下面的大文本框**留空**，不用写任何内容。
4. 拉到底点 **Commit new file**。

## 第 5 步：打开 GitHub Pages

1. 进入仓库 **Settings（设置）**。
2. 左侧菜单点 **Pages**。
3. **Source（来源）** 选 **Deploy from a branch**。
4. **Branch（分支）** 选 `main`，**目录**选 `/(root)`，点 **Save**。
5. 等约 **1 分钟**。

## 第 6 步：验证上线

- 浏览器打开：`https://你的用户名.github.io/global-dating/`
  （把"你的用户名"换成你的 GitHub 用户名）
- 能看到 3 条示例嘉宾、搜索/筛选/详情弹窗都能用、手机打开也正常 → **上线成功 🎉**

---

## 日常管理（你改资料，所有人秒看到）

1. 打开网站，在标题「🌍 全球找对象」上**连点 5 次**（或按 `Ctrl/Cmd + Shift + A`）弹出登录框。
2. 输入：
   - **管理员口令**：`admin123`
   - **GitHub 令牌**：见下方「令牌怎么生成」
3. 解锁后就能：
   - **➕ 添加新嘉宾**：填表 + 上传照片/视频 → 点保存，所有人刷新页面就能看到（约 1 分钟）。
   - **⚙️ 修改微信名片**：更新微信号 / 上传二维码。
   - 点开任意档案可 **📌 置顶 / 🗑️ 删除**，同样即时同步。

### 令牌怎么生成（GitHub 网页）
1. 右上角头像 → **Settings → Developer settings → Fine-grained tokens**。
2. **Generate new token** → 名称随便写（如 `dating`）→ 有效期选 **7 days**。
3. **Repository access**：选 **Only select repositories** → 勾选 `global-dating`。
4. **Permissions → Contents** 设为 **Read and write**（读写），其他不动。
5. 点 **Generate token**，复制那串 `github_pat_...`，粘贴到网站登录框。
   - ⚠️ 这串令牌离开页面就看不到了，用完可在设置里删掉、需要时再生成。

---

## 常见问题

| 问题 | 解决办法 |
|------|---------|
| 打开网址是 404 | 等 1 分钟再刷新；确认仓库名和路径一致；确认 Pages 里已选 main / (root) |
| 网址打开是空列表 | `data.json` 没传上去？回仓库检查文件列表里有没有它 |
| 上传时找不到隐藏文件 | 第 4 步不用上传，按教程用「Create new file」手动建即可 |
| 改完资料别人看不到 | 等约 1 分钟（Pages 重新构建），然后让对方**刷新**页面 |
| 想在手机/电脑上看不到破图 | 站点无外链图片，全部用内置占位图，不会破 |
| 数据被别人乱改怎么办 | 只有知道口令 + 有你的 GitHub 令牌才能改；令牌只在你自己的浏览器会话里 |

## 安全提醒

- **数据公开**：Public 仓库下资料和图片任何人可读——公开相亲板正合适；要保密就把仓库改成 **Private**（免费也支持 Pages）。
- **口令仅是门槛**：`admin123` 写在前端，只防普通人误入，不是绝对安全；正式运营建议后续加后端权限。
- **回滚**：每次改动都是一次"存档"。仓库里点 `data.json` → **History** → 找到要回的版本 → **Revert**，网站自动回到那一版。
