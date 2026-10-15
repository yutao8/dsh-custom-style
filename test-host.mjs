/**
 * dsh-custom-style — 宿主半身的离线自测（不需要 DSH 运行）。
 *
 *   node test-host.mjs
 *
 * 用假的 ctx / req / res 跑通：目录播种、`all.css` 拼接、`status`、设置面板用的
 * `/files`、`/file`、`/file/delete`、`/reveal`（禁开目录），以及 404/405/413 与文件名校验。
 * 测试全程在临时 DSH_HOME 里，不碰真实 ~/.dsh。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const failures = [];
const check = (label, condition, detail = "") => {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures.push(label);
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
};

const home = mkdtempSync(join(tmpdir(), "dsh-custom-style-test-"));
process.env.DSH_HOME = home;
process.env.DSH_CUSTOM_STYLE_NO_REVEAL = "1"; // /reveal 只报告意图，不真的打开资源管理器

const host = await import("./index.js");
const captured = { route: undefined, dispose: undefined };
const ctx = {
	effect: (factory) => {
		captured.dispose = factory();
	},
	webServer: {
		register: (route) => {
			captured.route = route;
			return () => {};
		}
	},
	logger: { info: () => {}, warn: () => {} }
};

/** 最小可用的请求对象：能发出 data / end 事件。 */
const makeRequest = (method, url, body) => {
	const listeners = new Map();
	const req = {
		method,
		url,
		on(type, handler) {
			const list = listeners.get(type) ?? [];
			list.push(handler);
			listeners.set(type, list);
			return req;
		},
		destroy() {},
		emit(type, chunk) {
			for (const handler of listeners.get(type) ?? []) handler(chunk);
		}
	};
	setImmediate(() => {
		if (body !== undefined) req.emit("data", Buffer.from(JSON.stringify(body), "utf8"));
		req.emit("end");
	});
	return req;
};

/** 以假 req/res 调一次路由处理器（处理器的返回值就是响应写完的 promise）。 */
const invoke = async (method, url, body) => {
	const response = { status: 0, headers: {}, body: undefined };
	const res = {
		writeHead: (status, headers) => {
			response.status = status;
			response.headers = headers ?? {};
		},
		end: (value) => {
			response.body = value;
		}
	};
	await captured.route.handler(makeRequest(method, url, body), res);
	return response;
};

const json = (response) => JSON.parse(String(response.body));

console.log("# 导出与注册");
check("name 为 custom-style", host.name === "custom-style", String(host.name));
check("inject 只请求 webServer", JSON.stringify(host.inject) === JSON.stringify(["webServer"]), JSON.stringify(host.inject));
check("apply 是函数", typeof host.apply === "function");
host.apply(ctx);
check("注册了 prefix 路由", captured.route?.kind === "prefix", JSON.stringify(captured.route?.kind));
check("路由前缀正确", captured.route?.path === host.ROUTE_PREFIX, String(captured.route?.path));
check("effect 返回 disposer", typeof captured.dispose === "function");

console.log("# 目录播种");
const dir = join(home, "dsh-custom-style");
check("创建了样式目录", existsSync(dir));
const starter = join(dir, "00-starter.css");
check("播种了 00-starter.css", existsSync(starter));
const starterText = existsSync(starter) ? readFileSync(starter, "utf8") : "";
check("播种内容含设置弹窗宽度规则", starterText.includes('[data-shortcut-modal="settings"]'));
check("包内 starter.css 与播种一致", starterText === readFileSync(new URL("./starter.css", import.meta.url), "utf8"));

console.log("# all.css");
const all = await invoke("GET", `${host.ROUTE_PREFIX}/all.css`);
check("状态 200", all.status === 200, String(all.status));
check("Content-Type 为 text/css", String(all.headers["content-type"]).startsWith("text/css"), String(all.headers["content-type"]));
check("禁止缓存", all.headers["cache-control"] === "no-store", String(all.headers["cache-control"]));
check("正文含播种样式", String(all.body).includes('[data-shortcut-modal="settings"]'));
check("正文带文件横幅", String(all.body).includes("/* ===== 00-starter.css ===== */"));

writeFileSync(join(dir, "10-extra.css"), "body { outline: 0; }\n", "utf8");
const ordered = await invoke("GET", `${host.ROUTE_PREFIX}/all.css`);
const body = String(ordered.body);
check("合并了新文件", body.includes("body { outline: 0; }"));
check("按文件名顺序拼接", body.indexOf("00-starter.css") < body.indexOf("10-extra.css"));
check("标注了文件数", ordered.headers["x-dsh-custom-style-files"] === "2", String(ordered.headers["x-dsh-custom-style-files"]));
check("HEAD 无正文", (await invoke("HEAD", `${host.ROUTE_PREFIX}/all.css`)).body === undefined);

console.log("# status / 错误分支");
const status = await invoke("GET", `${host.ROUTE_PREFIX}/status`);
check("status 列出文件", json(status).files.join(",") === "00-starter.css,10-extra.css", json(status).files.join(","));
check("status 报告字节数", typeof json(status).bytes === "number" && json(status).bytes > 0, String(json(status).bytes));
check("status 报告目录", json(status).dir === dir, String(json(status).dir));
check("未知路径 404", (await invoke("GET", `${host.ROUTE_PREFIX}/nope`)).status === 404);
check("非 GET/HEAD 405（all.css）", (await invoke("POST", `${host.ROUTE_PREFIX}/all.css`, {})).status === 405);

console.log("# 设置面板接口：读文件");
const filesResponse = await invoke("GET", `${host.ROUTE_PREFIX}/files`);
const filesJson = json(filesResponse);
check("files 状态 200", filesResponse.status === 200, String(filesResponse.status));
check("files 带内容", filesJson.files.every((item) => typeof item.text === "string" && typeof item.bytes === "number"));
check("files 含两个文件", filesJson.files.length === 2, String(filesJson.files.length));
check("files 报告体积上限", filesJson.maxFileBytes > 0, String(filesJson.maxFileBytes));

console.log("# 设置面板接口：写 / 删");
const created = await invoke("POST", `${host.ROUTE_PREFIX}/file`, { name: "30-panel.css", text: "body { letter-spacing: 0; }\n" });
check("写入状态 200", created.status === 200, `${created.status}: ${String(created.body)}`);
check("写入后出现在 all.css", String((await invoke("GET", `${host.ROUTE_PREFIX}/all.css`)).body).includes("letter-spacing"));
const rewritten = await invoke("POST", `${host.ROUTE_PREFIX}/file`, { name: "30-panel.css", text: "body { letter-spacing: 1px; }\n" });
check("重复写入同一文件成功（原子替换）", rewritten.status === 200, String(rewritten.status));
check("重复写入内容生效", String((await invoke("GET", `${host.ROUTE_PREFIX}/all.css`)).body).includes("letter-spacing: 1px"));

const removed = await invoke("POST", `${host.ROUTE_PREFIX}/file/delete`, { name: "30-panel.css" });
check("删除状态 200", removed.status === 200, String(removed.status));
check("删除后文件消失", !existsSync(join(dir, "30-panel.css")));
check("删除不存在的文件 404", (await invoke("POST", `${host.ROUTE_PREFIX}/file/delete`, { name: "nope.css" })).status === 404);

console.log("# 文件名与体积校验");
const badNames = ["../escape.css", "sub/x.css", "x.txt", ".hidden.css", "no-extension", "a/b.css", "x.css/.."];
let rejected = 0;
for (const name of badNames) {
	const response = await invoke("POST", `${host.ROUTE_PREFIX}/file`, { name, text: "body{}" });
	if (response.status === 400) rejected += 1;
	else check(`拒绝非法文件名 ${name}`, false, `status=${response.status}`);
}
check(`拒绝全部 ${badNames.length} 个非法文件名`, rejected === badNames.length, `${rejected}/${badNames.length}`);
check("非法写入未落地", !existsSync(join(home, "escape.css")) && !existsSync(join(dir, "..", "escape.css")));
check("缺少 text 字段 400", (await invoke("POST", `${host.ROUTE_PREFIX}/file`, { name: "ok.css" })).status === 400);
const tooBig = await invoke("POST", `${host.ROUTE_PREFIX}/file`, { name: "big.css", text: "a".repeat(300 * 1024) });
check("超过单文件上限 413", tooBig.status === 413, String(tooBig.status));
check("超大文件未落地", !existsSync(join(dir, "big.css")));
const invalid = await invoke("POST", `${host.ROUTE_PREFIX}/file`, "not-json-at-all");
check("非法请求体被拒绝", invalid.status !== 200, String(invalid.status));

console.log("# 打开目录接口");
const reveal = await invoke("POST", `${host.ROUTE_PREFIX}/reveal`, {});
check("reveal 状态 200", reveal.status === 200, String(reveal.status));
check("reveal 报告目录", json(reveal).dir === dir, String(json(reveal).dir));
check("reveal 在禁开时不启动进程", json(reveal).opened === false, JSON.stringify(json(reveal)));

rmSync(home, { recursive: true, force: true });
console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 项失败：${failures.join(", ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
