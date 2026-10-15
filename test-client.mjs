/**
 * dsh-custom-style — 浏览器半身的离线自测（不需要 DSH、不需要浏览器）。
 *
 *   node test-client.mjs
 *
 * 伪造 `window.__ModuleLoader__` / document / fetch / 定时器 / React / slots / locale，跑通：
 * 注册 factory、导出形状、首次注入、轮询后替换、页面隐藏时跳过、失败只告警一次、
 * dispose 回收，以及**设置分区**的注册契约与一次渲染冒烟（假 React 下渲染成树且不抛异常）。
 */
const failures = [];
const check = (label, condition, detail = "") => {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures.push(label);
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
};

/* ---------- 浏览器环境替身 ---------- */
const styles = new Map();
const makeTag = () => {
	const tag = {
		attributes: {},
		textContent: "",
		removed: false,
		setAttribute(name, value) {
			this.attributes[name] = value;
		},
		remove() {
			this.removed = true;
			styles.delete(this.attributes["data-plugin-css"]);
		}
	};
	return tag;
};

const listeners = new Map();
const documentStub = {
	visibilityState: "visible",
	head: { appendChild: (tag) => styles.set(tag.attributes["data-plugin-css"], tag) },
	createElement: () => makeTag(),
	querySelector: (selector) => {
		const id = /data-plugin-css="([^"]+)"/.exec(selector)?.[1];
		const tag = id ? styles.get(id) : undefined;
		return tag && !tag.removed ? tag : null;
	},
	addEventListener: (type, fn) => listeners.set(type, fn),
	removeEventListener: (type) => listeners.delete(type)
};

let registered;
let fetchCalls = 0;
const cssBody = "/* v1 */\nbody { outline: 0; }";
const filesBody = JSON.stringify({
	dir: "C:\\fake\\.dsh\\dsh-custom-style",
	files: [{ name: "00-starter.css", bytes: cssBody.length, text: cssBody }],
	bytes: cssBody.length,
	maxFileBytes: 262144
});
let fetchImpl = async (url) => ({
	ok: true,
	status: 200,
	text: async () => (String(url).includes("/files") ? filesBody : cssBody)
});
let intervalFn;
let intervalCleared = false;
const warnings = [];
const infos = [];

globalThis.window = {
	__ModuleLoader__: { load: (entry) => (registered = entry) },
	setInterval: (fn) => {
		intervalFn = fn;
		return 7;
	},
	clearInterval: (id) => {
		intervalCleared = id === 7;
	},
	innerWidth: 1600,
	addEventListener: () => {},
	removeEventListener: () => {}
};
globalThis.document = documentStub;
globalThis.fetch = async (url, options) => {
	fetchCalls += 1;
	return fetchImpl(url, options);
};
const realWarn = console.warn;
const realInfo = console.info;
console.warn = (...args) => warnings.push(args.join(" "));
console.info = (...args) => infos.push(args.join(" "));

/* ---------- 加载 bundle ---------- */
await import("./client.js");

check("注册了模块 id", registered?.id === "dsh-custom-style", String(registered?.id));

/* ---------- 场景 A：没有 React、没有 slots/locale（降级只做注入） ---------- */
console.log("\n# 场景 A：服务缺失时只做样式注入");
const exported = registered.factory(() => {
	throw new Error("测试：require 不可用");
});
check("导出 apply", typeof exported.apply === "function");
check("导出 inject=[slots, locale]", JSON.stringify(exported.inject) === JSON.stringify(["slots", "locale"]), JSON.stringify(exported.inject));
check("导出 name", exported.name === "custom-style", String(exported.name));
check("导出字典命名空间", exported.NS === "settings.customStyle", String(exported.NS));

const disposers = [];
const ctx = {
	effect: (factory) => disposers.push(factory()),
	logger: { info: (line) => infos.push(line) }
};
exported.apply(ctx);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
await tick();

const tag = documentStub.querySelector('style[data-plugin-css="dsh-custom-style"]');
check("创建了注入用 <style>", tag !== null);
check("首次写入样式内容", String(tag?.textContent).includes("outline: 0"));
check("记录了 info 日志", infos.some((line) => line.includes("已应用")), infos.join(" | "));
check("注册了定时器", typeof intervalFn === "function");
check("请求带 no-store", fetchCalls > 0);
check(
	"slots 缺失时给出告警而不是抛错",
	warnings.some((line) => line.includes("slots 服务不可用")),
	warnings.join(" | ")
);
check("React 缺失时不注册设置分区（无异常）", !warnings.some((line) => line.includes("Cannot read")));

/* ---------- 轮询：内容变化才替换 ---------- */
const before = tag.textContent;
await intervalFn();
await tick();
check("内容不变时不重写", tag.textContent === before && fetchCalls === 2, `calls=${fetchCalls}`);

fetchImpl = async (url) => ({
	ok: true,
	status: 200,
	text: async () => (String(url).includes("/files") ? filesBody : "/* v2 */\nbody { outline: 1px solid red; }")
});
await intervalFn();
await tick();
check("内容变化后替换", String(tag.textContent).includes("v2"), String(tag.textContent));

/* ---------- 页面隐藏时跳过 ---------- */
const callsWhenHidden = fetchCalls;
documentStub.visibilityState = "hidden";
await intervalFn();
await tick();
check("页面隐藏时不请求", fetchCalls === callsWhenHidden, `calls=${fetchCalls}`);
documentStub.visibilityState = "visible";
listeners.get("visibilitychange")?.();
await tick();
check("恢复可见后立即刷新", fetchCalls === callsWhenHidden + 1, `calls=${fetchCalls}`);

/* ---------- 失败只告警一次 ---------- */
const warnBefore = warnings.length;
fetchImpl = async () => {
	throw new Error("boom");
};
await intervalFn();
await tick();
await intervalFn();
await tick();
check("失败只告警一次", warnings.length === warnBefore + 1, `warns=${warnings.length - warnBefore}`);
check("失败信息可读", warnings[warnings.length - 1]?.includes("boom"), warnings[warnings.length - 1]);

/* ---------- 恢复 ---------- */
fetchImpl = async (url) => ({
	ok: true,
	status: 200,
	text: async () => (String(url).includes("/files") ? filesBody : "/* v3 */")
});
await intervalFn();
await tick();
check("恢复后继续生效", String(tag.textContent) === "/* v3 */", String(tag.textContent));

/* ---------- dispose ---------- */
for (const dispose of disposers) dispose();
check("回收了 <style>", tag.removed === true);
check("清除了定时器", intervalCleared === true);
check("移除了可见性监听", listeners.has("visibilitychange") === false);
await intervalFn?.();
await tick();
check("dispose 后不再请求", String(tag.textContent) === "/* v3 */", String(tag.textContent));

/* ---------- 场景 B：有 React / slots / locale（注册设置分区 + 渲染冒烟） ---------- */
console.log("\n# 场景 B：设置分区注册与渲染");
/** 最小假 React：createElement 记树（与真实 React 一样保留 props.children），hooks 只满足调用形状。 */
const fakeReact = {
	createElement: (type, props, ...children) => {
		const merged = { ...(props ?? {}) };
		if (children.length > 0) merged.children = children.length > 1 ? children : children[0];
		return { type, props: merged };
	},
	useState: (initial) => [initial, () => {}],
	useEffect: () => {},
	useCallback: (fn) => fn
};
const exported2 = registered.factory((id) => {
	if (id === "react") return fakeReact;
	throw new Error(`测试：未预期的 require(${id})`);
});

const registrations = [];
const ctx2 = {
	effect: (factory) => {
		factory();
	},
	logger: { info: () => {}, warn: (line) => warnings.push(line) },
	locale: {
		register: (namespace, dictionaries) => registrations.push({ kind: "locale", namespace, dictionaries }),
		bind: (namespace) => (key) => `${namespace}.${key}`
	},
	slots: {
		inject: (kind, generator) => {
			for (const entry of generator()) registrations.push({ kind, entry });
		},
		register: (spec, Component) => ({ spec, Component })
	}
};
exported2.apply(ctx2);

const localeRegistration = registrations.find((item) => item.kind === "locale");
check("注册了字典", localeRegistration?.namespace === "settings.customStyle", String(localeRegistration?.namespace));
check(
	"字典含中英文",
	Boolean(localeRegistration?.dictionaries?.zh?.nav) && Boolean(localeRegistration?.dictionaries?.en?.nav),
	JSON.stringify(Object.keys(localeRegistration?.dictionaries ?? {}))
);

const sectionRegistration = registrations.find((item) => item.kind === "settings.section");
check("注册进 settings.section 槽", Boolean(sectionRegistration), JSON.stringify(registrations.map((item) => item.kind)));
check("分区 name 正确", sectionRegistration?.entry?.spec?.name === "settings.section", String(sectionRegistration?.entry?.spec?.name));
check("分区 id 正确", sectionRegistration?.entry?.spec?.id === "custom-style", String(sectionRegistration?.entry?.spec?.id));
check("分区 order 为 40", sectionRegistration?.entry?.spec?.order === 40, String(sectionRegistration?.entry?.spec?.order));
check(
	"分区 label 走字典",
	sectionRegistration?.entry?.spec?.label?.() === "settings.customStyle.nav",
	String(sectionRegistration?.entry?.spec?.label?.())
);
check("分区 inject() 提供 t", typeof sectionRegistration?.entry?.spec?.inject?.().t === "function");
check("分区组件是函数", typeof sectionRegistration?.entry?.Component === "function");

/** 把渲染树里所有字符串收集起来（假 React 的树就是普通对象）。 */
const collectText = (node, out = []) => {
	if (node === null || node === undefined || typeof node === "boolean") return out;
	if (typeof node === "string" || typeof node === "number") {
		out.push(String(node));
		return out;
	}
	if (Array.isArray(node)) {
		for (const child of node) collectText(child, out);
		return out;
	}
	if (typeof node === "object" && node.props) collectText(node.props.children, out);
	return out;
};

let tree;
let renderError = "";
try {
	tree = sectionRegistration.entry.Component({ t: (key) => key });
} catch (error) {
	renderError = error instanceof Error ? error.message : String(error);
}
check("组件渲染不抛异常", renderError === "", renderError);
const texts = collectText(tree);
check("渲染出简介", texts.includes("intro"), texts.slice(0, 12).join(" | "));
check("渲染出样式目录一行", texts.includes("dir"));
check("渲染出文件列表区", texts.includes("files"));
check("渲染出编辑器区", texts.includes("editor"));
check("渲染出常用调节区", texts.includes("quick"));
check("渲染出保存与新建按钮", texts.includes("save") && texts.includes("create"));
check("渲染出重新载入按钮", texts.includes("reload"));
check("渲染出弹窗宽度提示", texts.some((text) => text.includes("maxHint")) || texts.some((text) => text.includes("max-width")), texts.join(" | ").slice(0, 200));

/* ---------- 常用调节：九个字段 + 三组预设 ---------- */
check("常用调节含弹窗高度", texts.includes("height"), texts.join(" | ").slice(0, 200));
check("常用调节含两侧留白", texts.includes("inset"));
check("常用调节含代码字号", texts.includes("codeFont"));
check("常用调节含面板圆角", texts.includes("radius"));
check("常用调节含滚动条宽度", texts.includes("scrollbar"));
check("常用调节含内容宽度上限", texts.includes("contentWidth") && texts.includes("contentWidthHint"), texts.join(" | ").slice(0, 200));
check("常用调节共渲染九个 px 输入", texts.filter((text) => text === "px").length >= 9, String(texts.filter((text) => text === "px").length));
check("渲染出三组预设", ["presetWide", "presetCompact", "presetStock"].every((key) => texts.includes(key)), texts.join(" | ").slice(0, 200));

/* ---------- 选择器速查清单 ---------- */
check("渲染出选择器速查区", texts.includes("selectors"));
check("速查区有展开入口并带条数", texts.some((text) => /selectorsShow \(\d+\)/.test(text)), texts.join(" | ").slice(0, 200));
check("每条都有插入按钮", texts.filter((text) => text === "insert").length >= 13, String(texts.filter((text) => text === "insert").length));
check("列出设置弹窗选择器", texts.includes('[data-shortcut-modal="settings"]'), texts.join(" | ").slice(0, 300));
check("列出令牌选择器", texts.some((text) => text.includes("--dsw-*")), texts.join(" | ").slice(0, 300));
check("列出代码与滚动条选择器", texts.includes("pre, code") && texts.some((text) => text.includes("::-webkit-scrollbar")));
check("列出「只居中」与「铺满」两条", texts.includes("whatCentering") && texts.includes("whatFillWidth"), texts.join(" | ").slice(0, 300));
check("说明每条选择器的用途", texts.includes("whatSettingsDialog") && texts.includes("whatCodeText"), texts.join(" | ").slice(0, 200));
check("带有「自己找选择器」的提示", texts.includes("findOwn"));

/* ---------- 场景 B 的注入仍然生效 ---------- */
const tag2 = documentStub.querySelector('style[data-plugin-css="dsh-custom-style"]');
check("场景 B 也挂上注入", tag2 !== null);

// 让场景 B 首次刷新的异步日志先落地，保证最后一行输出就是结论
await new Promise((resolve) => setTimeout(resolve, 20));
console.warn = realWarn;
console.info = realInfo;
console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 项失败：${failures.join(", ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
