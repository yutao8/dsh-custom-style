/**
 * dsh-custom-style — Host half.
 *
 * 把 `$DSH_HOME/dsh-custom-style/*.css` 按文件名顺序拼成一份样式表，通过
 * `GET /dsh-custom-style/all.css` 交给浏览器半侧（client.js）。目录不存在时自动创建，
 * 并从包内 `starter.css` 播种一个 `00-starter.css`，用户只改 CSS、不碰插件代码。
 *
 * 除只读的样式表路由外，还给设置面板（浏览器半侧）提供读写接口：
 *   GET  /dsh-custom-style/files        列出目录里的 *.css 及其内容
 *   POST /dsh-custom-style/file         写入一个 *.css（原子替换）
 *   POST /dsh-custom-style/file/delete  删除一个 *.css
 *   POST /dsh-custom-style/reveal       用系统文件管理器打开样式目录
 *
 * 设计约束：
 *   - 只认「目录里的一个 *.css 文件名」，不接受任何路径片段（无路径穿越面）。
 *   - 写入前校验文件名与体积，先写临时文件再 rename，避免半截文件被注入。
 *   - `all.css` 一律 `no-store`，浏览器半侧轮询即可实现「保存即生效」。
 *   - 除 node: 内置模块外无任何依赖，宿主升级不会影响本插件。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

/** Loader 条目名（cordis.patch.yml 的 insert 用它绑定浏览器半身）。 */
export const name = "custom-style";

/** 需要宿主提供的服务。 */
export const inject = ["webServer"];

/** 路由前缀；浏览器半侧按 `/dsh-custom-style/all.css` 取样式。 */
export const ROUTE_PREFIX = "/dsh-custom-style";

/** 播种文件名（只在该文件缺失时写入，绝不覆盖用户内容）。 */
const STARTER_FILE = "00-starter.css";

/** 包内播种样式表：与 index.js 同目录，随包发布。 */
const STARTER_SOURCE = new URL("./starter.css", import.meta.url);

/** 单个样式文件的体积上限（写入与拼接都用它兜底）。 */
const MAX_FILE_BYTES = 256 * 1024;

/** 请求体上限（设置面板一次最多提交一个样式文件）。 */
const MAX_BODY_BYTES = 512 * 1024;

/** `$DSH_HOME`，回退 `~/.dsh`（与 dsh-pet 等插件同口径）。 */
function resolveDshHome() {
	const fromEnv = process.env.DSH_HOME;
	return fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : join(homedir(), ".dsh");
}

/** 用户自定义样式目录：`$DSH_HOME/dsh-custom-style`，可用 `DSH_CUSTOM_STYLE_DIR` 覆盖。 */
export function customStyleDir() {
	const override = process.env.DSH_CUSTOM_STYLE_DIR?.trim();
	if (override) return override;
	return join(resolveDshHome(), "dsh-custom-style");
}

/**
 * 确保目录与播种文件存在。
 * @returns 目录绝对路径
 */
function ensureDir() {
	const dir = customStyleDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const starter = join(dir, STARTER_FILE);
	if (!existsSync(starter)) {
		let text = "";
		try {
			text = readFileSync(STARTER_SOURCE, "utf8");
		} catch {
			text = "/* dsh-custom-style: 在这里写自定义 CSS。 */\n";
		}
		writeFileSync(starter, text, "utf8");
	}
	return dir;
}

/**
 * 目录里的 `*.css`，按文件名（英文序）排序。
 * @param dir - 样式目录
 */
function listCssFiles(dir) {
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".css"))
		.map((entry) => entry.name)
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 校验一个样式文件名：只允许「字母数字开头的 1-64 字符 + .css」，不含路径分隔符。
 * @param value - 调用方给的名字
 * @returns 是否可用
 */
function isSafeCssName(value) {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.css$/.test(value) && !value.includes("..");
}

/**
 * 拼接样式表：每个文件前加一条注释横幅，便于在 DevTools 里对号入座。
 * @param dir - 样式目录
 */
function composeStylesheet(dir) {
	const files = listCssFiles(dir);
	const parts = files.map((file) => {
		let text = "";
		try {
			const full = join(dir, file);
			text =
				statSync(full).size > MAX_FILE_BYTES
					? `/* dsh-custom-style: ${file} 超过 ${Math.round(MAX_FILE_BYTES / 1024)} KiB，已跳过 */`
					: readFileSync(full, "utf8");
		} catch (error) {
			text = `/* dsh-custom-style: 读取 ${file} 失败：${error instanceof Error ? error.message : String(error)} */`;
		}
		return `/* ===== ${file} ===== */\n${text.replace(/^\uFEFF/, "")}`;
	});
	return { files, css: parts.join("\n\n") };
}

/**
 * 读出一个样式文件的内容（供设置面板编辑）。
 * @param dir - 样式目录
 * @param file - 已校验过的文件名
 */
function readCssFile(dir, file) {
	const text = readFileSync(join(dir, file), "utf8");
	return { name: file, bytes: Buffer.byteLength(text), text };
}

/**
 * 原子写入一个样式文件：先写同目录临时文件，再 rename 覆盖。
 * @param dir - 样式目录
 * @param file - 已校验过的文件名
 * @param text - 新内容
 */
function writeCssFile(dir, file, text) {
	const target = join(dir, file);
	const temp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
	writeFileSync(temp, text, "utf8");
	renameSync(temp, target);
	return { name: file, bytes: Buffer.byteLength(text) };
}

/**
 * 用系统文件管理器打开目录（Windows: explorer，macOS: open，Linux: xdg-open）。
 * @param dir - 样式目录
 */
function revealDirectory(dir) {
	if (process.env.DSH_CUSTOM_STYLE_NO_REVEAL === "1") return { opened: false, reason: "disabled by DSH_CUSTOM_STYLE_NO_REVEAL" };
	const [command, args] =
		process.platform === "win32"
			? ["explorer.exe", [dir]]
			: process.platform === "darwin"
				? ["open", [dir]]
				: ["xdg-open", [dir]];
	try {
		spawn(command, args, { detached: true, stdio: "ignore" }).unref();
		return { opened: true, command };
	} catch (error) {
		return { opened: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * 读一个 JSON 请求体，带体积上限。
 * @param req - node 请求对象
 * @returns 解析后的对象
 */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(Object.assign(new Error("body too large"), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			const text = Buffer.concat(chunks).toString("utf8");
			if (text.trim().length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(text));
			} catch {
				reject(Object.assign(new Error("invalid JSON body"), { status: 400 }));
			}
		});
		req.on("error", reject);
	});
}

/**
 * 发送一个 UTF-8 文本响应。
 * @param res - node 响应对象
 */
function sendText(res, status, body, contentType) {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(body)
	});
	res.end(body);
}

/** 发送 JSON。 */
function sendJson(res, status, value) {
	sendText(res, status, `${JSON.stringify(value)}\n`, "application/json; charset=utf-8");
}

/** 处理一个请求；返回 true 表示已响应。 */
async function handleRequest(req, res, pathname) {
	const method = req.method ?? "GET";
	const dir = ensureDir();

	if (pathname === `${ROUTE_PREFIX}/all.css`) {
		if (method !== "GET" && method !== "HEAD") {
			sendText(res, 405, "dsh-custom-style: only GET/HEAD\n", "text/plain; charset=utf-8");
			return;
		}
		const { files, css } = composeStylesheet(dir);
		res.writeHead(200, {
			"content-type": "text/css; charset=utf-8",
			"cache-control": "no-store",
			"content-length": Buffer.byteLength(css),
			"x-dsh-custom-style-files": String(files.length)
		});
		res.end(method === "HEAD" ? undefined : css);
		return;
	}

	if (method === "GET" && (pathname === ROUTE_PREFIX || pathname === `${ROUTE_PREFIX}/` || pathname === `${ROUTE_PREFIX}/status`)) {
		const { files, css } = composeStylesheet(dir);
		sendJson(res, 200, { dir, files, bytes: Buffer.byteLength(css), maxFileBytes: MAX_FILE_BYTES });
		return;
	}

	// 设置面板用：列出文件（含内容）
	if (method === "GET" && pathname === `${ROUTE_PREFIX}/files`) {
		const files = listCssFiles(dir).map((file) => {
			try {
				return readCssFile(dir, file);
			} catch (error) {
				return { name: file, bytes: 0, text: `/* 读取失败：${error instanceof Error ? error.message : String(error)} */` };
			}
		});
		const { css } = composeStylesheet(dir);
		sendJson(res, 200, { dir, files, bytes: Buffer.byteLength(css), maxFileBytes: MAX_FILE_BYTES });
		return;
	}

	// 设置面板用：写入 / 删除 / 打开目录
	if (method === "POST" && (pathname === `${ROUTE_PREFIX}/file` || pathname === `${ROUTE_PREFIX}/file/delete` || pathname === `${ROUTE_PREFIX}/reveal`)) {
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			sendJson(res, error?.status ?? 400, { error: error instanceof Error ? error.message : String(error) });
			return;
		}

		if (pathname === `${ROUTE_PREFIX}/reveal`) {
			sendJson(res, 200, { dir, ...revealDirectory(dir) });
			return;
		}

		const file = body?.name;
		if (!isSafeCssName(file)) {
			sendJson(res, 400, { error: "只允许目录内的 *.css 文件名（字母数字开头，1-64 字符，不含路径）" });
			return;
		}

		if (pathname === `${ROUTE_PREFIX}/file/delete`) {
			const target = join(dir, file);
			if (!existsSync(target)) {
				sendJson(res, 404, { error: `没有这个文件：${file}` });
				return;
			}
			rmSync(target, { force: true });
			sendJson(res, 200, { deleted: file, dir });
			return;
		}

		const text = typeof body?.text === "string" ? body.text : undefined;
		if (text === undefined) {
			sendJson(res, 400, { error: "缺少 text 字段" });
			return;
		}
		if (Buffer.byteLength(text) > MAX_FILE_BYTES) {
			sendJson(res, 413, { error: `单个样式文件上限 ${Math.round(MAX_FILE_BYTES / 1024)} KiB` });
			return;
		}
		const written = writeCssFile(dir, file, text);
		const { files, css } = composeStylesheet(dir);
		sendJson(res, 200, { ...written, dir, files, bytes: Buffer.byteLength(css) });
		return;
	}

	sendText(res, 404, "dsh-custom-style: not found\n", "text/plain; charset=utf-8");
}

/**
 * 挂载宿主半身：注册样式路由与设置面板接口。
 * @param ctx - 宿主插件上下文
 */
export function apply(ctx) {
	try {
		const dir = ensureDir();
		ctx.logger?.info?.(`[dsh-custom-style] 样式目录：${dir}`);
	} catch (error) {
		ctx.logger?.warn?.(
			`[dsh-custom-style] 无法创建样式目录：${error instanceof Error ? error.message : String(error)}`
		);
	}

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "prefix",
				path: ROUTE_PREFIX,
				handler: (req, res) => {
					const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
					// 返回 promise：宿主忽略它，但离屏测试可以 await 到响应写完
					return handleRequest(req, res, pathname).catch((error) => {
						sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
					});
				}
			}),
		"dsh-custom-style: stylesheet route"
	);
}
