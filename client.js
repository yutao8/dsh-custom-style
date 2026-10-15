/**
 * dsh-custom-style — Browser half.
 *
 * 两件事：
 *   1. 把宿主半身拼好的样式表注入 `<style data-plugin-css="dsh-custom-style">`，每 2 秒轮询一次
 *      （页面隐藏时暂停），所以改完 CSS 保存后界面自动生效，不需要刷新或重启。
 *   2. 在**设置界面**注册一个「自定义样式」分区：列出/编辑/新建/删除样式文件、八个常用数值一键写盘、
 *      常用选择器速查（点「插入」把片段写进编辑器）、打开样式目录、手动重新载入。
 *
 * 面板通过插件自己的路由与宿主通信（`/dsh-custom-style/files|file|file/delete|reveal`），
 * 因此不需要 import 任何官方客户端包；React 来自平台冻结的模块表（`require("react")`）。
 * 若某个服务缺失（例如离线预览时没有 slots/locale），样式注入照常工作，只是不注册设置页。
 */
window.__ModuleLoader__.load({
	id: "dsh-custom-style",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		/** React 来自平台基座；取不到时只做样式注入。 */
		let react;
		try {
			react = require("react");
		} catch {
			react = undefined;
		}

		/** 注入的 <style> 标记（与官方插件同一套 data-plugin-css 约定）。 */
		const STYLE_ATTRIBUTE = "data-plugin-css";
		const STYLE_ID = "dsh-custom-style";
		const ROUTE = "/dsh-custom-style";
		const CSS_URL = `${ROUTE}/all.css`;
		/** 轮询间隔（毫秒）：本地回环请求，代价可忽略。 */
		const POLL_MS = 2000;
		/** 「常用调节」写进的文件名。 */
		const QUICK_FILE = "20-quick-settings.css";
		/** 字典命名空间。 */
		const NS = "settings.customStyle";

		const zh = {
			nav: "自定义样式",
			intro: "这里的 CSS 会注入界面（按文件名顺序拼接），保存后约 2 秒自动生效，不需要重启。",
			dir: "样式目录",
			reveal: "打开目录",
			revealOk: "已用系统文件管理器打开目录",
			files: "样式文件",
			empty: "目录里还没有 *.css 文件",
			newPlaceholder: "新文件名，例如 30-mine.css",
			create: "新建",
			remove: "删除",
			editor: "编辑",
			save: "保存",
			saving: "保存中…",
			saved: "已保存（{n} 字符）",
			reload: "重新载入",
			reloaded: "已重新载入（注入 {n} 字符）",
			quick: "常用调节",
			quickHint: "不用写 CSS：填数字 → 点「应用」，会写入 {file}（打开面板时自动读回该文件里的值）。",
			width: "设置弹窗宽度",
			height: "设置弹窗高度",
			inset: "弹窗两侧留白",
			navWidth: "设置导航宽度",
			fontSize: "会话正文字号",
			codeFont: "代码字号",
			radius: "面板圆角",
			scrollbar: "滚动条宽度",
			contentWidth: "内容居中宽度",
			contentWidthHint:
				"0 = 保留各页自己的宽度、只把内容**居中**（最安全，官方页不受影响）；填数字 = 把各页统一成该宽度并居中。想彻底铺满（会拉伸内容）用下面速查里那条「解除宽度上限」。",
			presets: "预设",
			presetWide: "宽视野",
			presetCompact: "紧凑",
			presetStock: "恢复原厂",
			presetApplied: "已填入输入框，点「应用」写入 {file}",
			apply: "应用",
			applied: "已写入 {file}",
			maxHint: "弹窗宽度受官方 max-width 限制：窗口宽度 − 留白。当前窗口 {win}px、留白 {inset}px → 最多约 {max}px。",
			selectors: "选择器速查",
			selectorsHint:
				"官方类名是构建期哈希（升级就变），下面这些 data-* / 角色 / 令牌选择器是稳定的。点「插入」把片段写进当前文件，再点「保存」。",
			selectorsShow: "展开清单",
			insert: "插入",
			inserted: "已插入到编辑器，记得点「保存」",
			findOwn: "要找别的元素：DevTools 里选中它 → 右键 Copy selector，优先挑带 data-* / aria-* / role 的那种写法。",
			whatSettingsDialog: "设置弹窗本体（尺寸、圆角、背景都在它上面）",
			whatSettingsNav: "设置弹窗左侧导航栏",
			whatSettingsNavItem: "设置导航里的单个条目",
			whatAnyModal: "任意模态浮层的兜底选择器（role=dialog）",
			whatBodyFontToken: "会话正文字号令牌",
			whatDesignTokens: "设计令牌：颜色、圆角、描边等（--dsw-*）",
			whatDarkTheme: "深色模式下的画布（body 上的主题标记）",
			whatScrollbarArea: "滚动条本体",
			whatCodeText: "代码块与行内代码的字号",
			whatOtherModals: "其它带 data-shortcut-modal 标记的浮层（当前构建为 dialog / shortcut-edit）",
			whatCentering: "各页自带的宽度上限（第三方设置页常用它把内容卡窄）——只居中，不改宽度",
			whatFillWidth: "同上，但把上限也解除（内容铺满，可能被拉伸）",
			whatOwnStyleTag: "本插件注入的样式表（用来在 DevTools 里定位自己的规则）",
			loading: "读取中…",
			needName: "文件名只能包含字母、数字、点、下划线、连字符，并以 .css 结尾。",
			failed: "出错了：{message}"
		};
		const en = {
			nav: "Custom CSS",
			intro: "CSS here is injected into the UI (concatenated in filename order) and re-applied about two seconds after saving — no restart.",
			dir: "Style directory",
			reveal: "Open folder",
			revealOk: "Opened the folder in your file manager",
			files: "Style files",
			empty: "No *.css files in the directory yet",
			newPlaceholder: "New file name, e.g. 30-mine.css",
			create: "Create",
			remove: "Delete",
			editor: "Edit",
			save: "Save",
			saving: "Saving…",
			saved: "Saved ({n} characters)",
			reload: "Reload",
			reloaded: "Reloaded ({n} characters injected)",
			quick: "Quick settings",
			quickHint: "No CSS needed: fill in numbers → Apply, which writes {file} (reopening the panel reads those values back).",
			width: "Settings dialog width",
			height: "Settings dialog height",
			inset: "Dialog side margin",
			navWidth: "Settings nav width",
			fontSize: "Conversation body size",
			codeFont: "Code size",
			radius: "Panel corner radius",
			scrollbar: "Scrollbar width",
			contentWidth: "Center content (width)",
			contentWidthHint:
				"0 = keep each page's own width and just center it (safest; official pages are unaffected); a number sets them all to that width and centers them. To stretch everything instead, use the “remove width caps” snippet in the reference below.",
			presets: "Presets",
			presetWide: "Roomy",
			presetCompact: "Compact",
			presetStock: "Stock",
			presetApplied: "Filled the inputs — press Apply to write {file}",
			apply: "Apply",
			applied: "Wrote {file}",
			maxHint: "Width is capped by the stock max-width: window width − margin. Current window {win}px, margin {inset}px → at most about {max}px.",
			selectors: "Selector reference",
			selectorsHint:
				"Stock class names are build-time hashes (they change on update); these data-*, role and token selectors are stable. Press Insert to drop a snippet into the current file, then Save.",
			selectorsShow: "Show the list",
			insert: "Insert",
			inserted: "Inserted into the editor — remember to press Save",
			findOwn: "For anything else: pick the element in DevTools → Copy selector, and prefer the variant that uses data-*, aria-* or role.",
			whatSettingsDialog: "The settings dialog itself (size, radius and background live here)",
			whatSettingsNav: "The settings dialog's left navigation",
			whatSettingsNavItem: "One navigation row inside the settings dialog",
			whatAnyModal: "Fallback selector for any modal overlay (role=dialog)",
			whatBodyFontToken: "Conversation body text size token",
			whatDesignTokens: "Design tokens: colors, radii, strokes (--dsw-*)",
			whatDarkTheme: "The canvas in dark mode (theme marker on body)",
			whatScrollbarArea: "The scrollbar itself",
			whatCodeText: "Code blocks and inline code size",
			whatOtherModals: "Other overlays carrying a data-shortcut-modal marker (dialog / shortcut-edit in this build)",
			whatCentering: "A page's own width cap (third-party settings pages often squeeze content with one) — center only, width untouched",
			whatFillWidth: "Same, but the cap is lifted too (content fills and may stretch)",
			whatOwnStyleTag: "The stylesheet this plugin injects (to locate your own rules in DevTools)",
			loading: "Loading…",
			needName: "A file name may only contain letters, digits, dot, underscore and hyphen, and must end with .css.",
			failed: "Failed: {message}"
		};

		/** `{key}` 插值。 */
		const fmt = (text, vars) => String(text).replace(/\{(\w+)\}/g, (match, key) => (vars && key in vars ? String(vars[key]) : match));

		/* ─────────────── 常用调节的字段定义 ─────────────── */

		/**
		 * 「内容居中」用的选择器集合。依据（已核对出厂 bundle）：
		 *   - 外壳 `.options` 是普通块级盒子，内容限宽时右侧留白；`margin-inline:auto` 把留白均分。
		 *   - 官方页的限宽元素统一叫 `*_section`（内置插件 760px、插件市场 760px、模型 720px），
		 *     且它**不是** `.options` 的直接子节点（中间隔着 slot 渲染层），所以必须按类名后缀命中。
		 *   - 第三方页常用 `_root`/`_shell`/`_wrap`（如 Our Free Model 的 .ofm_root 1080px）。
		 * 对没有限宽的元素，auto 外边距是空操作，所以官方页里未限宽的部分不受影响。
		 */
		const CENTER_SELECTORS = [
			'[data-shortcut-modal="settings"] [class*="_options"] > *',
			'[data-shortcut-modal="settings"] [class*="_section"]',
			'[data-shortcut-modal="settings"] [class*="_root"]',
			'[data-shortcut-modal="settings"] [class*="_shell"]',
			'[data-shortcut-modal="settings"] [class*="_wrap"]',
			'[data-shortcut-modal="settings"] [style*="max-width"]'
		].join(", ");

		/**
		 * 每项 = 面板里一个数字输入 + 写进 `20-quick-settings.css` 的一行规则 + 从文件读回的取值正则。
		 * 这些都是「官方有同名同特异性的规则、所以需要 !important」的场景；`read` 让面板重新打开时读回上次写入的值。
		 */
		const QUICK_FIELDS = [
			{
				key: "dialogWidth",
				label: "width",
				fallback: "1200",
				write: (value) => `[data-shortcut-modal="settings"] { width: ${value}px !important; }`,
				read: /\[data-shortcut-modal="settings"\]\s*\{\s*width:\s*([\d.]+)px/
			},
			{
				key: "dialogHeight",
				label: "height",
				fallback: "800",
				write: (value) => `[data-shortcut-modal="settings"] { height: min(${value}px, calc(100vh - 48px)) !important; }`,
				read: /\[data-shortcut-modal="settings"\]\s*\{\s*height:\s*min\(([\d.]+)px/
			},
			{
				key: "dialogInset",
				label: "inset",
				fallback: "48",
				write: (value) => `[data-shortcut-modal="settings"] { max-width: calc(100vw - ${value}px) !important; }`,
				read: /max-width:\s*calc\(100vw\s*-\s*([\d.]+)px\)/
			},
			{
				key: "navWidth",
				label: "navWidth",
				fallback: "188",
				write: (value) => `[data-shortcut-modal="settings"] nav { width: ${value}px !important; }`,
				read: /\[data-shortcut-modal="settings"\]\s*nav\s*\{\s*width:\s*([\d.]+)px/
			},
			{
				key: "bodyFont",
				label: "fontSize",
				fallback: "14",
				write: (value) => `body { --dsh-content-font-size: ${value}px !important; }`,
				read: /--dsh-content-font-size:\s*([\d.]+)px/
			},
			{
				key: "codeFont",
				label: "codeFont",
				fallback: "12.5",
				write: (value) => `pre, code, kbd, samp { font-size: ${value}px !important; }`,
				read: /pre,\s*code[^{]*\{\s*font-size:\s*([\d.]+)px/
			},
			{
				key: "radius",
				label: "radius",
				fallback: "12",
				write: (value) => `[data-shortcut-modal="settings"] { border-radius: ${value}px !important; }`,
				read: /\[data-shortcut-modal="settings"\]\s*\{\s*border-radius:\s*([\d.]+)px/
			},
			{
				key: "scrollbar",
				label: "scrollbar",
				fallback: "10",
				write: (value) => `::-webkit-scrollbar { width: ${value}px; height: ${value}px; }`,
				read: /::-webkit-scrollbar\s*\{\s*width:\s*([\d.]+)px/
			},
			{
				// 官方设置页本身不限宽（已核对 10 个官方 bundle），但第三方页会用类名/内联把内容卡窄，
				// 于是右侧留白。这里**只做居中**：margin-inline:auto 对没有上限的元素是空操作，
				// 只把"自己限了宽"的容器摆正，不拉伸内容、不动缩略图。
				// 0 = 保留各页自己的宽度、仅居中；数字 = 统一成该宽度并居中。
				// 选择器依据外壳源码：.content 里是 .header + .options，页面根是 .options 的子节点，
				// 所以 [class*="_options"] > * 能精准命中任意页面的根，不必猜它的类名；
				// 其余几个是第三方页常见的布局容器名（root/shell/wrap），以及内联限宽的元素自身。
				key: "contentWidth",
				label: "contentWidth",
				fallback: "0",
				write: (value) => {
					const width = Number(value);
					const cap = width > 0 ? `max-width: ${width}px !important; ` : "";
					return `${CENTER_SELECTORS} { ${cap}margin-inline: auto !important; }`;
				},
				read: /\[class\*="_options"\][^{]*\{([^}]*)\}/,
				fromMatch: (match) => {
					const cap = /max-width:\s*([\d.]+)px/.exec(match[1]);
					return cap === null ? "0" : cap[1];
				}
			}
		];

		/** 一键预设：只填输入框，点「应用」才写盘。 */
		const QUICK_PRESETS = [
			{
				key: "presetWide",
				values: {
					dialogWidth: "1500",
					dialogHeight: "900",
					dialogInset: "16",
					navWidth: "220",
					bodyFont: "15",
					codeFont: "13",
					radius: "14",
					scrollbar: "10"
				}
			},
			{
				key: "presetCompact",
				values: { dialogWidth: "1000", dialogHeight: "700", dialogInset: "24", navWidth: "160", bodyFont: "13", codeFont: "12", radius: "10", scrollbar: "8" }
			},
			{
				key: "presetStock",
				values: { dialogWidth: "800", dialogHeight: "800", dialogInset: "48", navWidth: "188", bodyFont: "14", codeFont: "12.5", radius: "12", scrollbar: "10" }
			}
		];

		/**
		 * 选择器速查：只收 harness 写死在源码里、或设计令牌文档承诺过的钩子（data-* / role / 令牌），
		 * 不含构建期哈希类名。`snippet` 是点「插入」时写进编辑器的片段。
		 */
		const SELECTOR_ROWS = [
			{
				selector: '[data-shortcut-modal="settings"]',
				what: "whatSettingsDialog",
				snippet:
					'[data-shortcut-modal="settings"] {\n  width: 1200px !important;\n  height: min(900px, calc(100vh - 48px)) !important;\n  max-width: calc(100vw - 32px) !important;\n  border-radius: 14px !important;\n}'
			},
			{
				selector: '[data-shortcut-modal="settings"] nav',
				what: "whatSettingsNav",
				snippet: '[data-shortcut-modal="settings"] nav {\n  width: 220px !important;\n}'
			},
			{
				selector: '[data-shortcut-modal="settings"] nav button',
				what: "whatSettingsNavItem",
				snippet: '[data-shortcut-modal="settings"] nav button {\n  height: 44px !important;\n  font-size: 13px !important;\n}'
			},
			{
				selector: 'div[role="dialog"][aria-modal="true"]',
				what: "whatAnyModal",
				snippet: 'div[role="dialog"][aria-modal="true"] {\n  border-radius: 14px !important;\n}'
			},
			{
				selector: "body（令牌 --dsh-content-font-size）",
				what: "whatBodyFontToken",
				snippet: "body {\n  --dsh-content-font-size: 15px !important;\n}"
			},
			{
				selector: "body（令牌 --dsw-*）",
				what: "whatDesignTokens",
				snippet:
					"body {\n  --dsw-radius-panel: 14px !important;\n  --dsw-alias-bg-layer-2: #1b1e24 !important;\n  --dsw-alias-border-l2: rgba(255, 255, 255, 0.14) !important;\n}"
			},
			{
				selector: "body[data-ds-dark-theme]",
				what: "whatDarkTheme",
				snippet: "body[data-ds-dark-theme] {\n  background: #0f1114 !important;\n}"
			},
			{
				selector: "::-webkit-scrollbar",
				what: "whatScrollbarArea",
				snippet: "::-webkit-scrollbar {\n  width: 10px;\n  height: 10px;\n}\n::-webkit-scrollbar-thumb {\n  border-radius: 6px;\n}"
			},
			{
				selector: "pre, code",
				what: "whatCodeText",
				snippet: "pre, code {\n  font-size: 12.5px !important;\n  line-height: 1.5 !important;\n}"
			},
			{
				selector: '[data-shortcut-modal="dialog"], [data-shortcut-modal="shortcut-edit"]',
				what: "whatOtherModals",
				snippet: '[data-shortcut-modal="dialog"],\n[data-shortcut-modal="shortcut-edit"] {\n  border-radius: 12px !important;\n}'
			},
			{
				selector: '设置面板里的页面容器： [class*="_section"]（官方页）/ [class*="_root"]、[class*="_shell"]、[class*="_wrap"]（第三方页）',
				what: "whatCentering",
				snippet:
					'/* 只居中：保留各页自己的宽度，把右侧留白对称化（对没有宽度上限的元素是空操作）。\n   官方页限宽元素统一是 *_section（内置插件/插件市场 760px、模型 720px），且它不是 .options 的直接子节点，\n   中间隔着 slot 渲染层，所以必须按类名后缀命中。 */\n' + CENTER_SELECTORS + " {\n  margin-inline: auto !important;\n}"
			},
			{
				selector: '同上，但把上限一起解除（内容铺满，可能被拉伸）',
				what: "whatFillWidth",
				snippet:
					'/* 铺满：解除各页宽度上限（含内联），内容会被拉伸；缩略图/省略号可能受影响 */\n' + CENTER_SELECTORS + " {\n  max-width: none !important;\n  margin-inline: auto !important;\n}"
			},
			{
				selector: 'style[data-plugin-css="dsh-custom-style"]',
				what: "whatOwnStyleTag",
				snippet: "/* 本插件的样式表：在 DevTools 里搜这个属性就能看到合并后的全部自定义 CSS */"
			}
		];

		/* ─────────────── 样式注入（插件主职责） ─────────────── */

		/** 面板的「重新载入」按钮会调用它；返回本次注入的字符数。 */
		let refreshStylesheet = async () => 0;

		/** 取得（必要时创建）本插件持有的样式标签。 */
		function ensureStyleTag() {
			const existing = document.querySelector(`style[${STYLE_ATTRIBUTE}="${STYLE_ID}"]`);
			if (existing !== null) return existing;
			const tag = document.createElement("style");
			tag.setAttribute(STYLE_ATTRIBUTE, STYLE_ID);
			document.head.appendChild(tag);
			return tag;
		}

		/**
		 * 挂载样式注入：首次拉取 + 定时轮询。
		 * @param ctx - 浏览器插件上下文
		 */
		function installInjector(ctx) {
			const tag = ensureStyleTag();
			let applied = null;
			let stopped = false;
			let reportedFailure = false;

			/** 取一次样式表；内容变化时替换 <style> 文本，返回当前字符数。 */
			const refresh = async () => {
				if (stopped) return applied === null ? 0 : applied.length;
				if (typeof document !== "undefined" && document.visibilityState === "hidden") {
					return applied === null ? 0 : applied.length;
				}
				try {
					const response = await fetch(`${CSS_URL}?t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const css = await response.text();
					if (stopped) return css.length;
					if (css !== applied) {
						applied = css;
						tag.textContent = css;
						console.info(`[dsh-custom-style] 已应用 ${css.length} 字符自定义 CSS（${CSS_URL}）`);
					}
					reportedFailure = false;
					return css.length;
				} catch (error) {
					if (!reportedFailure) {
						reportedFailure = true;
						console.warn(
							"[dsh-custom-style] 取用自定义 CSS 失败（将自动重试）：",
							error instanceof Error ? error.message : error
						);
					}
					return applied === null ? 0 : applied.length;
				}
			};
			refreshStylesheet = refresh;

			ctx.effect(() => {
				void refresh();
				const timer = window.setInterval(() => void refresh(), POLL_MS);
				const onVisibilityChange = () => {
					if (document.visibilityState === "visible") void refresh();
				};
				document.addEventListener("visibilitychange", onVisibilityChange);
				return () => {
					stopped = true;
					window.clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisibilityChange);
					tag.remove();
				};
			}, "dsh-custom-style: stylesheet");

			ctx.logger?.info?.(`[dsh-custom-style] 自定义样式已挂载：${CSS_URL}`);
		}

		/* ─────────────── 与宿主通信 ─────────────── */

		/**
		 * 调插件自己的宿主路由。
		 * @param path - 路由后缀，如 `/files`
		 * @param body - 有 body 时用 POST + JSON
		 */
		async function call(path, body) {
			const response = await fetch(`${ROUTE}${path}`, {
				cache: "no-store",
				credentials: "same-origin",
				method: body === undefined ? "GET" : "POST",
				...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
			});
			const text = await response.text();
			let value;
			try {
				value = text.trim().length === 0 ? {} : JSON.parse(text);
			} catch {
				value = { error: text.slice(0, 200) };
			}
			if (!response.ok) throw new Error(value?.error ?? `HTTP ${response.status}`);
			return value;
		}

		/* ─────────────── 设置面板 ─────────────── */

		/** 面板内联样式：只用设计令牌 + 兜底色，不依赖任何构建期哈希类名。 */
		const S = {
			wrap: {
				display: "flex",
				flexDirection: "column",
				gap: "14px",
				padding: "2px 2px 26px",
				// 不设 maxWidth：设置面板的内容列本身不限宽（已核对官方壳层），
				// 这里跟着弹窗一起变宽，才不会在右侧留下空白。
				width: "100%",
				minWidth: 0,
				boxSizing: "border-box",
				fontSize: "13px",
				color: "var(--dsw-alias-label-primary, inherit)"
			},
			muted: { color: "var(--dsw-alias-label-secondary, #9aa0a6)", fontSize: "12px", lineHeight: 1.65 },
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				padding: "12px 14px",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))",
				borderRadius: "10px"
			},
			row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
			grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(19rem, 1fr))", gap: "6px 18px" },
			title: { fontSize: "13px", fontWeight: 600 },
			button: {
				height: "26px",
				padding: "0 10px",
				borderRadius: "6px",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))",
				background: "transparent",
				color: "inherit",
				cursor: "pointer",
				fontSize: "12px",
				fontFamily: "inherit"
			},
			primary: {
				height: "26px",
				padding: "0 12px",
				borderRadius: "6px",
				border: "1px solid transparent",
				background: "var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4c8dff)",
				color: "#fff",
				cursor: "pointer",
				fontSize: "12px",
				fontFamily: "inherit"
			},
			input: {
				height: "26px",
				padding: "0 8px",
				borderRadius: "6px",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))",
				background: "rgba(128,128,128,.10)",
				color: "inherit",
				fontSize: "12px",
				fontFamily: "inherit"
			},
			number: {
				height: "26px",
				width: "5rem",
				padding: "0 8px",
				borderRadius: "6px",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))",
				background: "rgba(128,128,128,.10)",
				color: "inherit",
				fontSize: "12px",
				fontFamily: "inherit"
			},
			path: { flex: 1, minWidth: "16rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" },
			list: { display: "flex", flexDirection: "column", gap: "2px", maxHeight: "9rem", overflow: "auto" },
			mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" },
			textarea: {
				width: "100%",
				minHeight: "15rem",
				padding: "10px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))",
				background: "rgba(128,128,128,.10)",
				color: "inherit",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				fontSize: "12px",
				lineHeight: 1.55,
				resize: "vertical",
				boxSizing: "border-box"
			},
			item: (active) => ({
				textAlign: "left",
				padding: "5px 8px",
				borderRadius: "6px",
				border: "1px solid transparent",
				background: active ? "var(--chrome-action-hover, rgba(128,128,128,.20))" : "transparent",
				color: "inherit",
				cursor: "pointer",
				fontSize: "12px",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
			})
		};

		/** 构造面板组件（只有 React 可用时才调用）。 */
		function makePanel() {
			const e = react.createElement;
			const { useCallback, useEffect, useState } = react;

			/** 八个数字输入的初始值。 */
			const initialQuick = () => {
				const state = {};
				for (const field of QUICK_FIELDS) state[field.key] = field.fallback;
				return state;
			};

			/** 一个数字输入（受控）。 */
			const numberField = (label, value, onChange) =>
				e(
					"label",
					{ style: { display: "flex", alignItems: "center", gap: "6px" }, key: label },
					e("span", { style: { flex: 1, minWidth: "7rem" }, children: label }),
					e("input", { style: S.number, value, onChange: (event) => onChange(event.target.value), inputMode: "decimal" }),
					e("span", { style: { ...S.muted, width: "1.5rem" }, children: "px" })
				);

			/** 「自定义样式」设置分区。 */
			return function CustomStyleSection(props) {
				const t = props?.t ?? ((key) => (key in zh ? zh[key] : key));
				const [dir, setDir] = useState("");
				const [files, setFiles] = useState([]);
				const [selected, setSelected] = useState("");
				const [draft, setDraft] = useState("");
				const [note, setNote] = useState("");
				const [error, setError] = useState("");
				const [busy, setBusy] = useState(false);
				const [loading, setLoading] = useState(true);
				const [newName, setNewName] = useState("");
				const [quick, setQuick] = useState(initialQuick);
				const [windowWidth, setWindowWidth] = useState(typeof window === "undefined" ? 0 : window.innerWidth);

				/** 读出文件列表；顺带把选中项与「常用调节」的当前值同步回来。 */
				const load = useCallback(
					async (preferName) => {
						const data = await call("/files");
						const list = Array.isArray(data.files) ? data.files : [];
						setDir(String(data.dir ?? ""));
						setFiles(list);
						const wanted = preferName ?? selected;
						const pick = list.find((item) => item.name === wanted) ?? list[0];
						setSelected(pick ? pick.name : "");
						setDraft(pick ? pick.text : "");
						const managed = list.find((item) => item.name === QUICK_FILE);
						if (managed !== undefined) {
							setQuick((current) => {
								const next = { ...current };
								for (const field of QUICK_FIELDS) {
									const match = String(managed.text).match(field.read);
									if (match !== null) next[field.key] = field.fromMatch ? field.fromMatch(match) : match[1];
								}
								return next;
							});
						}
						return list;
					},
					[selected]
				);

				// 首次进入时读一次；窗口尺寸变化时刷新提示里的数字
				useEffect(() => {
					let alive = true;
					void (async () => {
						try {
							await load();
						} catch (failure) {
							if (alive) setError(fmt(t("failed"), { message: failure instanceof Error ? failure.message : String(failure) }));
						} finally {
							if (alive) setLoading(false);
						}
					})();
					const onResize = () => setWindowWidth(window.innerWidth);
					window.addEventListener("resize", onResize);
					return () => {
						alive = false;
						window.removeEventListener("resize", onResize);
					};
					// 只在挂载时跑一次
					// eslint-disable-next-line react-hooks/exhaustive-deps
				}, []);

				/** 统一包一层：置忙、清提示、捕获错误。 */
				const guard = async (action) => {
					setBusy(true);
					setError("");
					setNote("");
					try {
						await action();
					} catch (failure) {
						setError(fmt(t("failed"), { message: failure instanceof Error ? failure.message : String(failure) }));
					} finally {
						setBusy(false);
					}
				};

				const pickFile = (file) => {
					setSelected(file.name);
					setDraft(file.text);
					setNote("");
					setError("");
				};

				/** 把速查清单里的一条片段插到编辑器末尾。 */
				const insertSnippet = (row) => {
					const snippet = `/* ${row.selector} —— ${t(row.what)} */\n${row.snippet}\n`;
					setDraft((current) => (String(current).trim().length === 0 ? snippet : `${String(current).replace(/\s*$/, "")}\n\n${snippet}`));
					setNote(t("inserted"));
					setError("");
				};

				const setQuickField = (key, value) => setQuick((current) => ({ ...current, [key]: value }));

				const applyPreset = (preset) => {
					setQuick((current) => ({ ...current, ...preset.values }));
					setNote(fmt(t("presetApplied"), { file: QUICK_FILE }));
					setError("");
				};

				const save = () =>
					guard(async () => {
						if (selected === "") return;
						await call("/file", { name: selected, text: draft });
						await load(selected);
						await refreshStylesheet();
						setNote(fmt(t("saved"), { n: draft.length }));
					});

				const create = () =>
					guard(async () => {
						const name = newName.trim();
						if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.css$/.test(name)) {
							setError(t("needName"));
							return;
						}
						await call("/file", { name, text: `/* ${name} */\n` });
						setNewName("");
						await load(name);
						await refreshStylesheet();
						setNote(fmt(t("saved"), { n: 0 }));
					});

				const remove = () =>
					guard(async () => {
						if (selected === "") return;
						await call("/file/delete", { name: selected });
						setSelected("");
						setDraft("");
						await load("");
						await refreshStylesheet();
					});

				const reload = () =>
					guard(async () => {
						const injected = await refreshStylesheet();
						setNote(fmt(t("reloaded"), { n: injected }));
					});

				const reveal = () =>
					guard(async () => {
						const result = await call("/reveal", {});
						setNote(result?.opened === false ? `${t("reveal")}: ${result.reason ?? ""}` : t("revealOk"));
					});

				const applyQuick = () =>
					guard(async () => {
						const number = (value, fallback) => {
							const parsed = Number.parseFloat(String(value));
							return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
						};
						const text = [
							"/* 由设置面板「常用调节」写入；改这里或用面板重新应用都可以 */",
							...QUICK_FIELDS.map((field) => field.write(number(quick[field.key], Number.parseFloat(field.fallback)))),
							""
						].join("\n");
						await call("/file", { name: QUICK_FILE, text });
						await load(QUICK_FILE);
						await refreshStylesheet();
						setNote(fmt(t("applied"), { file: QUICK_FILE }));
					});

				const children = [
					e("div", { style: S.muted, key: "intro", children: t("intro") }),
					e(
						"div",
						{ style: S.card, key: "dir" },
						e(
							"div",
							{ style: S.row },
							e("span", { style: { minWidth: "5.5rem" }, children: t("dir") }),
							e("input", { style: { ...S.input, ...S.path }, readOnly: true, value: dir, onFocus: (event) => event.target.select() }),
							e("button", { style: S.button, onClick: reveal, disabled: busy, children: t("reveal") })
						)
					),
					e(
						"div",
						{ style: S.card, key: "files" },
						e("div", { style: S.title, children: t("files") }),
						files.length === 0
							? e("div", { style: S.muted, children: loading ? t("loading") : t("empty") })
							: e("div", {
									style: S.list,
									children: files.map((file) =>
										e("button", {
											key: file.name,
											style: S.item(file.name === selected),
											onClick: () => pickFile(file),
											children: `${file.name}  ·  ${file.bytes} B`
										})
									)
								}),
						e(
							"div",
							{ style: S.row },
							e("input", {
								style: S.input,
								placeholder: t("newPlaceholder"),
								value: newName,
								onChange: (event) => setNewName(event.target.value)
							}),
							e("button", { style: S.button, onClick: create, disabled: busy, children: t("create") }),
							e("button", { style: S.button, onClick: remove, disabled: busy || selected === "", children: t("remove") })
						)
					),
					e(
						"div",
						{ style: S.card, key: "editor" },
						e(
							"div",
							{ style: S.row },
							e("span", { style: S.title, children: selected === "" ? t("editor") : `${t("editor")} · ${selected}` }),
							e("span", { style: { flex: 1 } }),
							e("button", { style: S.primary, onClick: save, disabled: busy || selected === "", children: busy ? t("saving") : t("save") }),
							e("button", { style: S.button, onClick: reload, disabled: busy, children: t("reload") })
						),
						e("textarea", {
							style: S.textarea,
							value: draft,
							spellCheck: false,
							onChange: (event) => setDraft(event.target.value)
						})
					),
					e(
						"div",
						{ style: S.card, key: "quick" },
						e("div", { style: S.title, children: t("quick") }),
						e("div", { style: S.muted, children: fmt(t("quickHint"), { file: QUICK_FILE }) }),
						e("div", {
							style: S.grid,
							children: QUICK_FIELDS.map((field) => numberField(t(field.label), quick[field.key], (value) => setQuickField(field.key, value)))
						}),
						e("div", { style: S.muted, children: t("contentWidthHint") }),
						e(
							"div",
							{ style: S.row },
							e("span", { style: S.muted, children: t("presets") }),
							...QUICK_PRESETS.map((preset) => e("button", { key: preset.key, style: S.button, onClick: () => applyPreset(preset), children: t(preset.key) }))
						),
						e(
							"div",
							{ style: S.row },
							e("button", { style: S.primary, onClick: applyQuick, disabled: busy, children: t("apply") }),
							e("div", {
								style: S.muted,
								children: fmt(t("maxHint"), {
									win: windowWidth,
									inset: quick.dialogInset,
									max: Math.max(0, windowWidth - Number.parseFloat(quick.dialogInset || "48"))
								})
							})
						)
					),
					e(
						"div",
						{ style: S.card, key: "selectors" },
						e("div", { style: S.title, children: t("selectors") }),
						e("div", { style: S.muted, children: t("selectorsHint") }),
						e(
							"details",
							{ style: { marginTop: "2px" } },
							e("summary", {
								style: {
									cursor: "pointer",
									...S.mono,
									color: "var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4c8dff)"
								},
								children: `${t("selectorsShow")} (${SELECTOR_ROWS.length})`
							}),
							e(
								"div",
								{ style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" } },
								...SELECTOR_ROWS.map((row) =>
									e(
										"div",
										{ key: row.selector, style: { display: "flex", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" } },
										e("code", { style: { ...S.mono, minWidth: "17rem" }, children: row.selector }),
										e("span", { style: { ...S.muted, flex: 1, minWidth: "11rem" }, children: t(row.what) }),
										e("button", { style: S.button, onClick: () => insertSnippet(row), children: t("insert") })
									)
								),
								e("div", { style: S.muted, children: t("findOwn") })
							)
						)
					)
				];

				if (note !== "") {
					children.push(e("div", { style: { ...S.muted, color: "var(--dsw-alias-state-success-primary, #3fb950)" }, key: "note", children: note }));
				}
				if (error !== "") {
					children.push(e("div", { style: { ...S.muted, color: "var(--dsw-alias-state-error-primary, #f85149)" }, key: "error", children: error }));
				}

				return e("div", { style: S.wrap }, ...children);
			};
		}

		/** React 不可用时给外壳一个空组件，保证不会因为缺 React 而崩。 */
		const Panel =
			react === undefined
				? function EmptySection() {
						return null;
					}
				: makePanel();

		/* ─────────────── Cordis 客户端插件 ─────────────── */

		/** 需要的客户端服务：slots（注册设置分区）与 locale（界面文案）。 */
		const inject = ["slots", "locale"];

		/**
		 * 挂载浏览器半身。
		 * @param ctx - 浏览器插件上下文
		 */
		function apply(ctx) {
			// 1) 样式注入照常挂载（即使下面两个服务缺失）
			installInjector(ctx);

			// 2) 文案：有 locale 服务就注册字典并跟随界面语言，否则直接用中文兜底
			let t = (key) => (key in zh ? zh[key] : key);
			if (typeof ctx.locale?.register === "function" && typeof ctx.locale?.bind === "function") {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-custom-style: dictionaries");
				t = ctx.locale.bind(NS);
			}

			// 3) 设置分区：设置界面里多一栏「自定义样式」
			if (typeof ctx.slots?.inject === "function" && typeof ctx.slots?.register === "function") {
				ctx.slots.inject("settings.section", function* registerSection() {
					yield ctx.slots.register(
						{
							name: "settings.section",
							id: "custom-style",
							order: 40,
							label: () => t("nav"),
							inject: () => ({ t })
						},
						Panel
					);
				});
			} else {
				console.warn("[dsh-custom-style] slots 服务不可用：只做样式注入，不显示设置分区");
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = "custom-style";
		exports.NS = NS;
		return module.exports;
	}
});
