# 🌍 全球找对象

快速找到心目中的伴侣 — 一个基于 **GitHub Pages + GitHub API** 的相亲资料展示网站。

## 功能特性

- 💑 嘉宾卡片展示（性别筛选 / 关键词搜索 / 多种排序）
- 📷 照片与视频相册（弹窗大图预览）
- 💬 微信名片一键复制
- 🔒 隐藏管理员入口（标题连点 5 次 或 `Ctrl+Shift+A`），输入口令 + GitHub Token 解锁
- ⚡ **上传前自动压缩**：图片转 JPEG、视频转码缩小（20MB 视频可压到 2~5MB），再多文件也不怕

## 发布方式

1. 创建 GitHub 仓库（public），把本目录所有文件推上去（建议放 `main` 分支根目录）
2. 仓库 Settings → Pages → Deploy from branch → 选择 `main` / root
3. 访问 `https://<用户名>.github.io/<仓库名>/`

> 若用 `<用户名>.github.io` 这种用户主页仓库，请在 `index.html` 中把 `GITHUB_REPO` 设为该仓库名。

## 管理员使用

- **口令**：默认 `admin123`（建议修改 `index.html` 中 `ADMIN_PASSWORD`）
- **Token**：GitHub → Settings → Developer settings → **Fine-grained personal access tokens**，勾选本仓库 **Contents 读写** 权限
- 令牌仅存于当前浏览器 `sessionStorage`，关闭标签页即清除

## 文件结构

```
├── index.html   # 单页应用（含全部样式与逻辑）
├── data.json    # 嘉宾数据 + 微信名片
└── media/       # 上传的照片/视频存储目录
```
