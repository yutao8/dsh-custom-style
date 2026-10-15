# 提交到 awesome-dsh-plugin

列表仓库只接受**一个文件**：`data/plugins/<owner>__<repo>.yml`。
本目录里的 [yutao8__dsh-custom-style.yml](yutao8__dsh-custom-style.yml) 已经按此填好（owner = `yutao8`），
直接复制过去即可；若换了 GitHub 账号，文件名与文件里的 `url` / `name` 要一起改。

```powershell
# 在 awesome-dsh-plugin 的 fork 里（仓库名保持 dsh-custom-style）
Copy-Item yutao8__dsh-custom-style.yml ..\awesome-dsh-plugin\data\plugins\yutao8__dsh-custom-style.yml
```

## 提交前检查（CI 会按顺序跑）

| # | 检查 | 本项目状态 |
|---|---|---|
| 1 | 一个 PR 最多 3 条 | ✅ 1 条 |
| 2 | 仓库 `package.json` 声明 `dsh.bundle`（只声明 `dsh.client` 会被拒） | ✅ `dsh.bundle.patch = ./cordis.patch.yml`，根目录有同名 patch 文件 |
| 3 | 仓库创建满 1 天 | ⏳ **仓库建好后第二天再提 PR** |
| 4 | `awesome-lint` 与站点构建（双语一致性、分隔符、日期、截图） | 描述只有 `en` + `zh` 两个字段，无 `: ` 裸冒号 |

## 还需要做的两件事（都在 GitHub 上，不在本仓库）

1. 给仓库加 `dsh-plugin` topic（<https://github.com/topics/dsh-plugin>）。
2. 手动评审前，维护者会读源码核对描述里的每一句话——本条目只声明了「注入 `$DSH_HOME/dsh-custom-style` 下的 CSS、
   约每两秒重新应用、可改弹窗宽度与字号配色」，与 `index.js` / `client.js` 的实际行为一致。

## 可选：发布 npm 包

- 发布了才能显示下载量；**不发布不影响收录**。发布时 `package.json` 的 `repository` 字段必须指回本仓库，否则两者不会关联。
- 条目里**不要**手写 `npm:` 字段，映射由 registry 自动采集，手写会被校验拒绝。
- 只有在「仓库无法从源码安装」时才需要 `tarball:` 字段指向 GitHub Release 上的 `.tgz`；本项目无需构建步骤，可直接从源码安装。

## 为什么分类是 `ui` 而不是 `theme`

`theme`（主题与外观）的条目会被 dsh-market 当作**互斥主题**管理：激活其中一个会把其它主题写进禁用集合
（见 `dshmarket/src/themes.ts`：「keeping exactly one theme active」）。本插件是 CSS 注入层，不是可切换的主题，
若归到 `theme`，用户一旦启用真正的主题就会被连带禁用。因此按 guide 的「选贴合实际做的事的分类」归入 `ui`。
