#!/usr/bin/env node
/**
 * session-clone.mjs — 把一个 DSH 会话"搬"到另一个工作区。
 *
 * 背景：DSH 没有官方的会话迁移 API。`workspace` 注册表按**会话头部记录的 cwd** 决定归属
 * （"来自其他目录的会话无法移入"），`session/fork` 也显式继承源会话的 cwd。所以要让一段对话
 * 出现在另一个工作区，只能在日志层做：重写会话日志第一帧（头部）里的 `id` 与 `cwd`，
 * 把文件放进目标工作区对应的项目目录，并在 workspace.json 里登记。
 *
 *   node tools/session-clone.mjs --cwd D:\path\to\dsh-custom-style              # 预览
 *   node tools/session-clone.mjs --cwd D:\path\to\dsh-custom-style --apply
 *   node tools/session-clone.mjs --from session-XXXXXXXX-... --cwd ... --apply
 *   node tools/session-clone.mjs --cwd ... --new-id session-xxxx --force --apply  # 覆盖同名克隆
 *   node tools/session-clone.mjs --from ... --export-jsonl D:\tmp\chat.jsonl      # 附带导出全文
 *
 * 安全性：
 *   - 只读源会话，原文件一字不改（源可能是正在写入的活动会话）。
 *   - 除第一帧外，克隆与其后的所有帧逐字节相同；写入前校验 JSON、写入后回读校验。
 *   - workspace.json 改前备份，且只用 JSON 往返校验过的内容覆写。
 *   - 默认预览，写盘需要 --apply；目标文件已存在时拒绝覆盖，除非 --force。
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { decompressFrame, encodeSegment, frames, normalizeCwd, normalizePath, projectKey, readLog, rewriteHeader } from "./lib/session-log.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const apply = flag("--apply");
const force = flag("--force");
const dshHome = resolve(value("--dsh-home", process.env.DSH_HOME?.trim() || join(homedir(), ".dsh")));
const sessionsRoot = resolve(value("--sessions-root", join(dshHome, "sessions")));
const workspaceFile = resolve(value("--workspace-file", join(dshHome, "storages", "workspace.json")));
const targetCwd = value("--cwd", undefined);
const fromId = value("--from", undefined);
const newIdArg = value("--new-id", undefined);
const exportPath = value("--export-jsonl", undefined);

/** 所有会话日志，按修改时间从新到旧。 */
const listSessionFiles = () => {
	const found = [];
	for (const project of readdirSync(sessionsRoot, { withFileTypes: true })) {
		if (!project.isDirectory()) continue;
		for (const session of readdirSync(join(sessionsRoot, project.name), { withFileTypes: true })) {
			if (!session.isDirectory() || session.name.startsWith(".")) continue;
			const file = join(sessionsRoot, project.name, session.name, "session.v4.jsonl.zstd");
			if (!existsSync(file)) continue;
			const stats = lstatSync(file);
			found.push({ id: session.name, file, project: project.name, size: stats.size, mtime: stats.mtimeMs });
		}
	}
	return found.sort((a, b) => b.mtime - a.mtime);
};

if (!targetCwd) {
	console.error("缺少 --cwd <目标工作区目录>；例如 --cwd D:\\path\\to\\dsh-custom-style");
	process.exit(2);
}
const candidates = listSessionFiles();
if (candidates.length === 0) {
	console.error(`没有在 ${sessionsRoot} 找到任何会话。`);
	process.exit(3);
}
const source = fromId === undefined ? candidates[0] : candidates.find((entry) => entry.id === fromId);
if (source === undefined) {
	console.error(`找不到会话 ${fromId}`);
	process.exit(3);
}

/* ─────────────── 读取 + 重写头部 ─────────────── */

const original = readFileSync(source.file);
const log = readLog(original);
const header = log.header;

const newId = newIdArg ?? `session-${randomUUID()}`;
const cwdValue = normalizeCwd(resolve(targetCwd));
const newHeader = { ...header, id: newId, cwd: cwdValue };
const clone = rewriteHeader(original, log, newHeader);
const tail = original.subarray(log.frames[0].length);

const cloneDir = join(sessionsRoot, projectKey(cwdValue), encodeSegment(newId));
const cloneFile = join(cloneDir, "session.v4.jsonl.zstd");

/* ─────────────── 校验 ─────────────── */
const problems = [];
if (!existsSync(targetCwd)) problems.push(`目标工作区目录不存在：${targetCwd}`);
if (clone.length < tail.length + 20) problems.push("克隆体过短");
const cloneFrames = frames(clone);
const clonedHeader = JSON.parse(decompressFrame(clone, cloneFrames[0]).toString("utf8"));
if (clonedHeader.id !== newId) problems.push("克隆头部 id 不匹配");
if (clonedHeader.cwd !== newHeader.cwd) problems.push("克隆头部 cwd 不匹配");
if (!clone.subarray(cloneFrames[0].length).equals(tail)) problems.push("克隆尾部与源不一致");
if (JSON.stringify({ ...clonedHeader, id: header.id, cwd: header.cwd }) !== JSON.stringify(header)) problems.push("除 id/cwd 外头部字段发生变化");
if (existsSync(cloneFile) && !force) problems.push(`目标已存在（加 --force 覆盖）：${cloneFile}`);

/* ─────────────── workspace.json 登记 ─────────────── */
let registry;
let registryChanged = false;
if (existsSync(workspaceFile)) {
	registry = JSON.parse(readFileSync(workspaceFile, "utf8"));
	const workspaces = registry?.tables?.workspaces ?? {};
	const match = Object.entries(workspaces).find(([, entry]) => normalizePath(entry.path) === normalizePath(targetCwd));
	if (match === undefined) {
		problems.push(`workspace.json 里没有路径为 ${targetCwd} 的工作区（先在 GUI 里创建它）`);
	} else {
		const [workspaceId, entry] = match;
		entry.sessionIds = Array.isArray(entry.sessionIds) ? entry.sessionIds : [];
		if (!entry.sessionIds.includes(newId)) {
			entry.sessionIds.unshift(newId);
			entry.updatedAt = new Date().toISOString();
			registryChanged = true;
		}
		console.log(`目标工作区    ${workspaceId}  (${entry.title})`);
	}
} else {
	problems.push(`找不到 ${workspaceFile}`);
}

/* ─────────────── 报告 ─────────────── */
console.log(`DSH_HOME      ${dshHome}`);
console.log(`源会话        ${source.id}  (${source.project}, ${(source.size / 1024).toFixed(0)} KiB, ${log.frames.length} 帧)`);
console.log(`源 cwd        ${header.cwd}`);
console.log(`新会话 id     ${newId}`);
console.log(`新 cwd        ${newHeader.cwd}`);
console.log(`克隆文件      ${cloneFile}`);
console.log(
	`帧            ${cloneFrames.length} 帧，${(clone.length / 1024).toFixed(0)} KiB（头部帧 ${log.frames[0].length} → ${cloneFrames[0].length} 字节）`
);
console.log(`workspace.json ${registryChanged ? "将新增一条会话登记" : "无需改动"}`);

if (problems.length > 0) {
	console.error(`\n校验未通过，未写入：\n${problems.map((line) => `  ✗ ${line}`).join("\n")}`);
	process.exit(5);
}

if (!apply) {
	console.log("\n以上为预览。确认后加 --apply 写入。");
	process.exit(0);
}

/* ─────────────── 写入 ─────────────── */
mkdirSync(cloneDir, { recursive: true });
writeFileSync(cloneFile, clone);
const readBack = readFileSync(cloneFile);
if (!readBack.equals(clone)) {
	console.error("写入后回读不一致，已中止（克隆文件可能不完整）。");
	process.exit(6);
}

if (registryChanged) {
	copyFileSync(workspaceFile, `${workspaceFile}.session-clone.bak`);
	const serialized = `${JSON.stringify(registry, null, 2)}\n`;
	JSON.parse(serialized); // 往返校验
	writeFileSync(workspaceFile, serialized, "utf8");
}

if (exportPath !== undefined) {
	const lines = cloneFrames.map((frame) => decompressFrame(clone, frame).toString("utf8")).join("");
	writeFileSync(resolve(exportPath), lines, "utf8");
	console.log(`导出全文      ${resolve(exportPath)}  (${(Buffer.byteLength(lines) / 1024).toFixed(0)} KiB)`);
}

console.log(`\n完成。回读校验通过（${cloneFrames.length} 帧）。`);
console.log("下一步：完全退出并重启 DSH —— 目标工作区里就会出现这段对话（克隆体，历史完整）。");
console.log(`原会话 ${source.id} 保持原样（它可能仍在写入）。确认克隆可用后，可在旧工作区归档或删除它。`);
