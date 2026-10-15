#!/usr/bin/env node
/**
 * local-preview.mjs — 不启动 DSH 也能预览与调试自定义样式。
 *
 *   node tools/local-preview.mjs                     # 临时样式目录，宽度从 1200px 开始
 *   node tools/local-preview.mjs --css-dir "C:\Users\你\.dsh\dsh-custom-style"   # 直接预览你真实的样式
 *   node tools/local-preview.mjs --width 1400 --port 7799
 *
 * 起一个只监听 127.0.0.1 的本地服务：
 *   GET /                     仿真设置弹窗的演示页（含真的 client.js 与状态条）
 *   GET /client.js            插件的浏览器半身（真文件，未改动）
 *   GET /dsh-custom-style/*   由插件**真实的 Host 半身**处理（假 ctx + 真路由处理器）
 *   GET /__set?w=1400         把宽度写进样式目录，用来验证「保存即生效」
 *   GET /__status             当前拼接结果与文件列表
 *
 * 演示页加载的是同一个 `client.js`，走的是同一个 `/dsh-custom-style/all.css`，
 * 所以它验证的是真链路：宿主拼接 → 浏览器注入 → 2 秒轮询。样式改动无需重启 DSH 就能看效果。
 */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROUTE_PREFIX, apply, customStyleDir } from "../index.js";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const port = Number(value("--port", "7788"));
const initialWidth = Number(value("--width", "1200"));
const cssDirArg = value("--css-dir", undefined);

// 样式目录：--css-dir 原样使用，否则用临时目录（$DSH_HOME 决定默认位置）
if (cssDirArg === undefined) {
	process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "dsh-local-preview-"));
} else {
	process.env.DSH_CUSTOM_STYLE_DIR = cssDirArg;
}

/** 捕获 Host 半身注册的路由处理器（真实代码，只把 ctx 换成假的）。 */
const captured = { route: undefined };
apply({
	effect: (factory) => {
		factory();
	},
	webServer: {
		register: (route) => {
			captured.route = route;
			return () => {};
		}
	},
	logger: { info: (line) => console.log(line), warn: (line) => console.warn(line) }
});

const cssDir = customStyleDir();
const previewFile = join(cssDir, "99-preview.css");
const writeWidth = (width) => {
	writeFileSync(previewFile, `/* local-preview：宽度 ${width}px */\n[data-shortcut-modal="settings"] { width: ${width}px !important; }\n`, "utf8");
};
writeWidth(initialWidth);

const demoPage = (width) => `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>dsh-custom-style · 本地预览</title>
<style>
  /* 这里只抄了原厂设置弹窗与它相关的几条规则（真实 DSH 里类名是构建期哈希） */
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; background: #0f1114; color: #e8eaed; height: 100vh; overflow: hidden; }
  .mask { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); backdrop-filter: blur(2px); }
  .overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  [data-shortcut-modal="settings"] { z-index: 1; width: 800px; height: min(700px, calc(100vh - 48px)); max-width: calc(100vw - 48px);
    border-radius: 12px; background: #1b1e24; box-shadow: 0 12px 48px rgba(0, 0, 0, .55); display: flex; position: relative; overflow: hidden; }
  [data-shortcut-modal="settings"] nav { width: 188px; padding: 22px 12px 0; display: flex; flex-direction: column; gap: 4px; background: #16181d; }
  [data-shortcut-modal="settings"] nav .title { font-size: 16px; font-weight: 500; padding: 0 12px 14px; }
  [data-shortcut-modal="settings"] nav button { height: 40px; border: 0; border-radius: 8px; background: transparent; color: #e8eaed; text-align: left; padding: 0 12px; font: inherit; cursor: pointer; }
  [data-shortcut-modal="settings"] nav button:hover { background: rgba(255, 255, 255, .06); }
  [data-shortcut-modal="settings"] nav button[aria-current] { background: rgba(255, 255, 255, .1); }
  [data-shortcut-modal="settings"] .content { flex: 1; min-width: 0; padding: 20px 24px; overflow: auto; }
  .card { border: 1px solid rgba(255, 255, 255, .1); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  .row { display: flex; justify-content: space-between; padding: 10px 0; border-top: 1px solid rgba(255, 255, 255, .07); }
  .row:first-of-type { border-top: 0; }
  .status { position: fixed; left: 12px; bottom: 12px; z-index: 9; font-size: 12px; padding: 6px 10px; border-radius: 8px;
    background: rgba(0, 0, 0, .6); border: 1px solid rgba(255, 255, 255, .12); }
  .status b { color: #7aaaFF; }
</style>
</head>
<body>
<div class="overlay">
  <div class="mask"></div>
  <div data-shortcut-modal="settings" role="dialog" aria-modal="true" aria-label="设置">
    <nav>
      <div class="title">设置</div>
      <button aria-current="true">账号与余额</button>
      <button>通用设置</button>
      <button>模型</button>
      <button>内置插件</button>
      <button>Agent 预设</button>
      <button>插件市场</button>
    </nav>
    <div class="content">
      <div class="card">
        <div class="row"><span>演示账号</span><span style="opacity:.7">local-preview</span></div>
        <div class="row"><span>示例余额</span><span>¥ 0.00</span></div>
      </div>
      <div class="card" style="opacity:.75">
        这是本地预览页：样式来自 <code>/dsh-custom-style/all.css</code>，由插件真实的 Host 半身拼接；
        注入与轮询走的是同一个 <code>client.js</code>。改样式保存后，这里约 2 秒内自动变化。
      </div>
    </div>
  </div>
</div>
<div class="status">设置弹窗宽度：<b id="w">…</b>（原厂 800px，本次预览起点 ${width}px）</div>

<script>window.__ModuleLoader__ = { load: (entry) => { window.__entry = entry; } };</script>
<script src="/client.js"></script>
<script>
  // 像 DSH 一样把一个 stub ctx 交给插件的浏览器半身
  (function () {
    const mod = window.__entry.factory(function () { throw new Error("本地预览：本插件不 require 任何模块"); });
    mod.apply({ effect: (fn) => { fn(); }, logger: { info: (m) => console.log(m) } });
  })();
  setInterval(() => {
    const el = document.querySelector('[data-shortcut-modal="settings"]');
    const injected = document.querySelector('style[data-plugin-css]');
    document.getElementById("w").textContent =
      getComputedStyle(el).width + (injected ? "（注入 " + injected.textContent.length + " 字符）" : "（尚未注入）");
  }, 250);
</script>
</body>
</html>`;

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	if (url.pathname === "/") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
		res.end(demoPage(initialWidth));
		return;
	}
	if (url.pathname === "/client.js") {
		const body = readFileSync(new URL("../client.js", import.meta.url));
		res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
		res.end(body);
		return;
	}
	if (url.pathname === "/__set") {
		const width = Number(url.searchParams.get("w") ?? initialWidth);
		writeWidth(width);
		res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: true, width, file: previewFile }));
		return;
	}
	if (url.pathname === "/__status") {
		res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ cssDir }));
		return;
	}
	if (url.pathname.startsWith(ROUTE_PREFIX)) {
		captured.route.handler(req, res);
		return;
	}
	res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	res.end("not found\n");
});

server.listen(port, "127.0.0.1", () => {
	console.log(`dsh-custom-style 本地预览  http://127.0.0.1:${port}/`);
	console.log(`样式目录                    ${cssDir}`);
	console.log(`初始宽度                    ${initialWidth}px（改样式或访问 /__set?w=1400 可即时看到变化）`);
});
