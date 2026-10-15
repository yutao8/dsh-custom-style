# dsh-custom-style

[English](./README.en.md) | 中文

把你自己写的 CSS 注入 **DeepSeek Harness** 界面——设置弹窗宽度、字号、配色、间距，想改什么就改什么。
只需编辑 `$DSH_HOME/dsh-custom-style/` 下的 `*.css` 文件，**保存约 2 秒后自动生效**：不改应用本体、不重新打包、不重启。

它还会在 **DSH 设置界面里加一栏「自定义样式」**：列出/编辑/新建/删除这些 CSS 文件，用几个数字设置弹窗宽度、
导航宽度、正文字号等九项常用值，一键打开样式目录——不用离开应用就能调界面。

- **宿主半身**（`index.js`）：把 `$DSH_HOME/dsh-custom-style/*.css` 按文件名顺序拼成一张样式表，经
  `GET /dsh-custom-style/all.css` 提供；首次运行自动创建目录并播种起始样式表，**绝不覆盖已有文件**。
  另外为设置面板提供文件接口（`/files`、`/file`、`/file/delete`、`/reveal`）。
- **浏览器半身**（`client.js`）：把样式表注入自己持有的 `<style data-plugin-css="dsh-custom-style">`，
  每 2 秒重新拉取一次（页面隐藏时暂停），所以改完保存就会生效，无需刷新；设置分区通过客户端 slot API 注册。
- **零第三方运行时依赖**：宿主半身只用 `node:` 内置模块，浏览器半身只用 DOM、`fetch` 和平台提供的 React。
  因此 harness 升级不会破坏它；用户 CSS 存在包外，重装插件也不会丢样式。

## 目录

- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [稳定选择器](#稳定选择器)
- [工作原理](#工作原理)
- [排查](#排查)
- [开发](#开发)
- [兼容性](#兼容性)
- [许可证](#许可证)

## 环境要求

- 带 web/桌面客户端的 DeepSeek Harness（`dsh` 0.2.x），已在 `0.2.0-rc.2` 上验证。
- Node.js `^22.19.0 || >=24.0.0`（只有可选的本地安装器与测试套件需要）。

## 安装

**A. 从插件目录 / npm 安装**（本仓库被收录之后）：

```sh
dsh plugin add dsh-custom-style
```

没有构建步骤——`client.js` 是手写的、不是打包产物——所以直接从本仓库源码安装也可以。

**B. 从本仓库安装到当前这台机器**（仓库自带安装器做的事）：

```powershell
node install.mjs            # 只预览（dry run）
node install.mjs --apply    # 安装到 $DSH_HOME/profiles/desktop
```

它会幂等地把插件登记进 DSH profile：

| 位置 | 变成什么 |
|---|---|
| `<profile>/local-plugins/dsh-custom-style` | 目录联接 → 本仓库（单一源码）；`--copy` 则改为复制文件 |
| `<profile>/node_modules/dsh-custom-style` | 目录联接 → 上面那一层 |
| `<profile>/package.json` | `dependencies["dsh-custom-style"] = "link:./local-plugins/dsh-custom-style"` 加一条 `dsh.profile.bundles` 登记（改前备份） |
| `$DSH_HOME/dsh-custom-style/00-starter.css` | 你的样式表——**仅在缺失时**写入 |

浏览器版 DSH 用 `--profile web`；非默认 `DSH_HOME` 用 `--dsh-home <路径>`。
安装后**完全退出并重开 DSH 一次**（宿主半身在启动时注册路由）；之后改 CSS 再也不需要重启。

## 使用

打开 **设置 → 自定义样式**。面板里有：

| 面板区域 | 能做什么 |
|---|---|
| 样式目录 | 显示当前目录；「打开目录」用系统文件管理器打开（Windows 为 `explorer`） |
| 样式文件 | 列出每个 `*.css` 及其大小；新建一个，或删除选中的 |
| 编辑器 | 把选中文件读进文本框——点「保存」立即写盘并当场重新注入样式 |
| 常用调节 | 九个数字——弹窗宽/高/两侧留白、导航宽、正文字号、代码字号、圆角、滚动条宽、内容居中宽度——外加「宽视野 / 紧凑 / 恢复原厂」三组预设；点「应用」写入 `20-quick-settings.css`，重新打开面板时会自动读回这些值 |
| 选择器速查 | 13 条经过核实的稳定选择器，每条注明它控制什么，点「插入」把现成片段写进当前文件 |
| 重新载入 | 立即拉取并重新注入样式，不用等轮询 |

习惯直接改文件也行：编辑 `%DSH_HOME%\dsh-custom-style\`（默认 `C:\Users\<你>\.dsh\dsh-custom-style\`）
下的任意 `*.css`——两条路操作的是同一个目录：

```css
/* 01-my-tweaks.css —— 保存后约 2 秒生效 */
[data-shortcut-modal="settings"] { width: 1200px !important; }    /* 设置弹窗宽度（原厂 800px） */
[data-shortcut-modal="settings"] nav { width: 220px !important; } /* 左侧导航宽度（原厂 188px） */
body { --dsh-content-font-size: 15px !important; }                /* 会话正文字号 */
```

- 文件名决定拼接顺序（`00-` 在前、`99-` 在后），同特异性下后者胜出。
- 只有在与官方规则**特异性相同**时才需要 `!important`（弹窗宽度就是这种情况）。
- 新建、改名、删除文件都会在下一轮询（≤2 秒）自动反映。
- 想把样式放在别处：设 `DSH_CUSTOM_STYLE_DIR` 为绝对路径，宿主半身会改读那个目录。

## 稳定选择器

官方类名是构建期哈希（今天是 `.wCInkW_panel`，升级后就变），所以优先用能活下来的钩子。
设置面板里的「选择器速查」就是下面这张表，点「插入」可直接把片段写进你正在编辑的文件。

| 目标 | 稳定选择器 | 示例 |
|---|---|---|
| 设置弹窗（尺寸、圆角、背景） | `[data-shortcut-modal="settings"]` | `width: 1200px !important;` |
| 它的左侧导航 | `[data-shortcut-modal="settings"] nav` | `width: 220px !important;` |
| 导航里的单个条目 | `[data-shortcut-modal="settings"] nav button` | `height: 44px !important;` |
| 任意模态（兜底） | `div[role="dialog"][aria-modal="true"]` | `border-radius: 14px !important;` |
| 正文字号 | `body` 上的令牌 | `--dsh-content-font-size: 15px !important;` |
| 颜色、圆角、描边 | `body` 上的 `--dsw-*` 令牌 | `--dsw-radius-panel: 14px !important;` |
| 深色模式画布 | `body[data-ds-dark-theme]` | `background: #0f1114 !important;` |
| 滚动条 | `::-webkit-scrollbar` | `width: 10px;` |
| 代码块与行内代码 | `pre, code` | `font-size: 12.5px !important;` |
| 其它带该标记的浮层 | `[data-shortcut-modal="dialog"]`、`…="shortcut-edit"` | `border-radius: 12px !important;` |
| 本插件注入的样式表 | `style[data-plugin-css="dsh-custom-style"]` | 在 DevTools 里定位自己的规则 |

要找别的元素：DevTools 里选中它 → *Copy selector*，优先挑由 `data-*`、`aria-*`、`role` 组成的写法，
而不是由哈希类名组成的。

弹窗自带 `max-width: calc(100vw - 48px)`，所以设得再宽也不会溢出窄窗口。反过来说：窗口比
*你的设定值 + 48px* 更窄时，弹窗其实已经顶到上限——要么把 DSH 窗口拉大，要么自己缩小这条留白
（面板里的「弹窗两侧留白」就是干这个的）：

```css
[data-shortcut-modal="settings"] { max-width: calc(100vw - 16px) !important; }
```

### 为什么有些页面右侧还是留白

弹窗宽度只是一半原因。外壳的内容列本身不限宽（`.…_content{flex:1;min-width:0}`），
但**各个页面会限制自己内容的宽度**，留白正是这个上限造成的。来自出厂 bundle 的统计
（十个 `@deepseek-ai/dsh-client-ui-settings-*` 包里共 15 条 `max-width` 规则）：

| 页面 | 被限宽的元素 | 上限 |
|---|---|---|
| 内置插件 | `.amjGKq_section` | 760px |
| 插件市场 tab | `.RotMhW_section` | 760px |
| 模型 | `._3nPmjq_section` | 720px |
| Our Free Model（第三方） | `.ofm_root` / `.ofm_shell` | 1080px / 1120px |
| 桌宠配置（第三方） | 内联 style | 720px |

两个事实决定了修法。第一，外壳结构（来自出厂的 `ui-settings-general` 源码）：

```
div[data-shortcut-modal="settings"]
├─ nav
└─ div.content                 display:flex; flex-direction:column
   ├─ div.header               （动作按钮 + 关闭）
   └─ div.options              flex:1; overflow-y:auto; padding:0 24px 24px   ← 普通块级盒子
      └─ …                     slot 渲染层，然后才是页面自己的容器
```

`.options` 是普通块级盒子，所以给被限宽的容器加 `margin-inline: auto` 就能把剩余空间均分——
内容居中而不是贴左——而且对没有限宽的元素这是空操作。第二，被限宽的元素**不是** `.options` 的
直接子节点（中间隔着 slot 层），而且它的类名是构建期哈希，所以要按稳定的**后缀**匹配：官方页是
`_section`，第三方页常见 `_root` / `_shell` / `_wrap`。面板里的「内容居中宽度」写的就是这个：
`0` 表示保留各页自己的宽度、只做居中；填数字表示把它们统一成该宽度并居中。

```css
[data-shortcut-modal="settings"] [class*="_options"] > *,
[data-shortcut-modal="settings"] [class*="_section"],
[data-shortcut-modal="settings"] [class*="_root"],
[data-shortcut-modal="settings"] [class*="_shell"],
[data-shortcut-modal="settings"] [class*="_wrap"],
[data-shortcut-modal="settings"] [style*="max-width"] { margin-inline: auto !important; }
```

如果你希望内容**铺满**而不是居中，面板速查里有第二条可选片段：对同一组选择器再加 `max-width: none`。
它会把按窄列设计的页面拉伸（卡片网格摊开、文字行长变大），所以不作为默认。

## 工作原理

```
$DSH_HOME/dsh-custom-style/*.css
        │  按文件名顺序拼接，每个文件前加一条 "/* ===== 名字 ===== */" 横幅
        ▼
index.js（宿主半身）──GET /dsh-custom-style/all.css──▶  client.js（浏览器半身）
        │                                                    │
        └─ 自动创建目录、播种 00-starter.css                   └─ <style data-plugin-css="dsh-custom-style">，每 2 秒轮询
```

- 路由面：`GET /dsh-custom-style/all.css`（拼接后的 CSS，`Cache-Control: no-store`）、
  `GET /dsh-custom-style/status` 与 `/files`（JSON：目录、文件列表、字节数）、
  `POST /dsh-custom-style/file` 与 `/file/delete`（写入/删除一个 `*.css`）、
  `POST /dsh-custom-style/reveal`（打开目录）；支持 `HEAD`，其余返回 `404`/`405`/`413`。
- 只读写那个目录**直接**内部的 `*.css`；文件名必须匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.css`——
  不接受调用方传入的路径，因此没有路径穿越面。写入是原子的（临时文件 + rename），单文件上限 256 KiB。
- 插件被卸载时，浏览器半身会移除自己的 `<style>` 并清掉定时器；设置分区来自客户端 slot API
  （`settings.section`），所以它的边框、导航与生命周期都由 harness 掌管。

## 排查

- 看拼接结果：打开 `/dsh-custom-style/all.css`；文件清单与大小：`/dsh-custom-style/status`。
- `Ctrl+Shift+I` → 搜 `data-plugin-css="dsh-custom-style"` 就是注入的完整样式表；
  Console 里 `[dsh-custom-style]` 前缀的日志会报告应用了什么、或拉取为何失败。
- 规则没生效：先确认选择器命中的是哪个元素（DevTools → 检查），再确认是否需要 `!important`。
- 路由 404：宿主半身没加载——检查 `<profile>/package.json` 的 `dsh.profile.bundles` 里是否有
  `dsh-custom-style`，然后重启 DSH。

## 开发

```powershell
node test-host.mjs                        # 宿主半身：44 项断言（假 ctx / req / res，临时 DSH_HOME）
node test-client.mjs                      # 浏览器半身：59 项断言（假 ModuleLoader / DOM / fetch / React / slots）
npm test                                  # 依次跑完以上两组
node tools/local-preview.mjs              # 本地预览服务（不需要 DSH），见下
```

### 不重启 DSH 就预览样式

```powershell
node tools/local-preview.mjs                                            # 临时样式目录，弹窗从 1200px 开始
node tools/local-preview.mjs --css-dir "$env:USERPROFILE\.dsh\dsh-custom-style"   # 预览你真实的样式
node tools/local-preview.mjs --width 1400 --port 7799
```

它在 `http://127.0.0.1:7788/` 起一个仿真设置弹窗页，驱动的是**真实的两个半身**：宿主半身拼接样式并
提供 `/dsh-custom-style/all.css`，页面加载真实的 `client.js` 完成注入与轮询。
`GET /__set?w=1400` 会改写预览样式，让你看着两秒重载发生。全程不联网，也不涉及 DSH 本体。

预览页没有 DSH 服务，所以只验证样式注入这一条链路：设置分区需要真实 harness（那里 Console 会打
`slots 服务不可用`，这是预期的优雅降级）。

### 开发工具

- `tools/asar/` —— 读取并就地修改出厂 `app.asar`，用于那些确实无法用 CSS 完成的改动；
  `patch_panel_width.py` 以等长改写调整设置弹窗宽度，并可 `--revert` 还原。
  `scan-all-maxwidth.py` 列出出厂设置 bundle 里所有 `max-width` 规则（每条独立 seek——
  把过滤后的条目连着读会产生假阴性）。需要设 `ASAR_PATH` 指向你的 `app.asar`。

这些工具只是开发辅助，不属于安装的插件（`files` 字段已把它们排除在 npm 包之外）。

## 兼容性

| DSH 版本 | 状态 |
|---|---|
| `0.2.0-rc.2` | 兼容 —— 本插件的开发与验证版本 |

在 `package.json` 的 `dsh.compatibility.dshReleases` 中声明。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
