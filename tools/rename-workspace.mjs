#!/usr/bin/env node
/**
 * rename-workspace.mjs — 给项目目录改名，并把 DSH 里所有指向旧路径的状态一起搬过去。
 *
 * 为什么需要脚本：DSH 的工作区与会话都按**绝对路径**记录（工作区注册表存 path，会话头部存 cwd），
 * profile 里又用目录联接指向这个目录。直接改文件夹名会让三者全部悬空：插件加载不到、会话掉进
 * Ungrouped。本脚本按顺序修好它们。
 *
 *   node tools/rename-workspace.mjs --to D:\path\to\dsh-custom-style --css-from dsh-custom-css          # 预览
 *   node tools/rename-workspace.mjs --to D:\path\to\dsh-custom-style --css-from dsh-custom-css --apply
 *
 * 前置条件：**完全退出 DSH**（脚本用「目录能否改名」当作退出检测），并且当前 shell 的所在目录
 * 不是本项目目录（Windows 不允许改名任何进程的当前目录——脚本自己会切到临时目录）。
 *
 * 依次做的事（每一步都可单独跳过，见 --skip-* / --no-install）：
 *   1. 重命名项目目录                        --skip-rename
 *   2. 会话日志：cwd 指向旧路径的会话搬到新 slug 目录并重写头部        --skip-sessions
 *   3. workspace.json：工作区 path（与同名 title）更新               --skip-registry
 *   4. 用户样式目录：$DSH_HOME/<--css-from> 的 *.css 并入新目录        --skip-css
 *   5. profile：清掉指向旧路径的目录联接（含上一轮改名留下的悬空条目），
 *      再用 install.mjs 接上新路径                                    --no-install
 *   6. 会话投影缓存：删除带旧 cwd 的记录（DSH 会从日志重新折叠）      --skip-sessions
 *
 * 安全性：默认只预览；每一步都先备份（workspace.json、profile/package.json）、写后回读校验；
 * 目录联接始终按「只删链接」的方式移除，绝不递归删除它的目标。
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { frames, normalizeCwd, normalizePath, projectKey, readLog, rewriteHeader } from "./lib/session-log.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const apply = flag("--apply");
const force = flag("--force");
const projectDir = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const fromDir = resolve(value("--from", projectDir));
const toDirArg = value("--to", undefined);
const dshHome = resolve(value("--dsh-home", process.env.DSH_HOME?.trim() || join(homedir(), ".dsh")));
const sessionsRoot = join(dshHome, "sessions");
const workspaceFile = join(dshHome, "storages", "workspace.json");
const cssFrom = value("--css-from", "").split(",").map((name) => name.trim()).filter(Boolean);
let skipRename = flag("--skip-rename");
const skipSessions = flag("--skip-sessions");
const skipRegistry = flag("--skip-registry");
const skipCss = flag("--skip-css");
const noInstall = flag("--no-install");

if (!toDirArg) {
	console.error("缺少 --to <新目录>；例如 --to D:\\path\\to\\dsh-custom-style");
	process.exit(2);
}
const toDir = resolve(toDirArg);
const problems = [];
const notes = [];
const plan = [];

/**
 * 断点续跑：目录已经改好名（上一轮在后续步骤中断）时，跳过改名、只补做剩下的部分。
 * 没有这段的话，重跑会因为「源目录不存在 / 目标已存在」直接拒绝，把状态卡在半路。
 */
const alreadyRenamed = !existsSync(fromDir) && existsSync(toDir);
if (alreadyRenamed) {
	notes.push("源目录已不存在、目标已存在 → 视为改名已完成，只补做后续步骤");
}
if (alreadyRenamed) skipRename = true;

const packageJson = join(alreadyRenamed ? toDir : fromDir, "package.json");
if (!existsSync(packageJson)) problems.push(`目录里没有 package.json：${dirname(packageJson)}`);
const packageName = existsSync(packageJson) ? JSON.parse(readFileSync(packageJson, "utf8")).name : undefined;
if (toDir === fromDir) problems.push("--to 与源目录相同");
if (existsSync(toDir) && !alreadyRenamed) problems.push(`目标已存在：${toDir}`);

const oldCwd = normalizeCwd(fromDir);
const newCwd = normalizeCwd(toDir);
const oldSlug = projectKey(oldCwd);
const newSlug = projectKey(newCwd);
const oldSlugDir = join(sessionsRoot, oldSlug);
const newSlugDir = join(sessionsRoot, newSlug);

/* ─────────────── 1) 目录改名 ─────────────── */
if (!skipRename) plan.push(`重命名目录   ${fromDir}  →  ${toDir}`);

/* ─────────────── 2) 会话日志 ─────────────── */
const sessionMoves = [];
if (!skipSessions && existsSync(oldSlugDir)) {
	for (const entry of readdirSync(oldSlugDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const file = join(oldSlugDir, entry.name, "session.v4.jsonl.zstd");
		if (!existsSync(file)) continue;
		let log;
		try {
			log = readLog(readFileSync(file));
		} catch (error) {
			notes.push(`跳过 ${entry.name}：${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		if (normalizePath(log.header.cwd) !== normalizePath(oldCwd)) {
			notes.push(`跳过 ${entry.name}：头部 cwd 是 ${log.header.cwd}，不属于本工作区`);
			continue;
		}
		const target = join(newSlugDir, entry.name, "session.v4.jsonl.zstd");
		if (existsSync(target) && !force) {
			problems.push(`新位置已有同名会话（加 --force 覆盖）：${target}`);
			continue;
		}
		sessionMoves.push({ id: entry.name, file, target, log });
	}
	plan.push(`迁移会话     ${sessionMoves.length} 个：${sessionMoves.map((move) => move.id).join(", ") || "(无)"}`);
	plan.push(`会话目录     ${oldSlug}  →  ${newSlug}`);
} else if (!skipSessions) {
	notes.push(`旧会话目录不存在，跳过会话迁移：${oldSlugDir}`);
}

/* ─────────────── 3) workspace.json ─────────────── */
let registry;
let registryTouched = 0;
if (!skipRegistry) {
	if (!existsSync(workspaceFile)) {
		problems.push(`找不到 ${workspaceFile}`);
	} else {
		registry = JSON.parse(readFileSync(workspaceFile, "utf8"));
		for (const [id, entry] of Object.entries(registry?.tables?.workspaces ?? {})) {
			if (normalizePath(entry.path) !== normalizePath(oldCwd)) continue;
			const titleNote = entry.title === basename(fromDir) ? `（title 同步改为 ${basename(toDir)}）` : `（title 保留：${entry.title}）`;
			plan.push(`工作区登记   ${id}: path → ${toDir} ${titleNote}`);
			registryTouched += 1;
		}
		if (registryTouched === 0) notes.push(`workspace.json 里没有路径为 ${fromDir} 的工作区，跳过登记更新`);
	}
}

/* ─────────────── 4) 用户样式目录 ─────────────── */
const cssMigrations = [];
if (!skipCss && packageName !== undefined) {
	const newCssDir = join(dshHome, packageName);
	for (const name of cssFrom) {
		const oldCssDir = join(dshHome, name);
		if (!existsSync(oldCssDir)) {
			notes.push(`样式目录不存在，跳过：${oldCssDir}`);
			continue;
		}
		for (const file of readdirSync(oldCssDir)) {
			if (!file.toLowerCase().endsWith(".css")) continue;
			const target = join(newCssDir, file);
			const source = join(oldCssDir, file);
			const same = existsSync(target) && readFileSync(target).equals(readFileSync(source));
			cssMigrations.push({ file, source, target, same, conflict: existsSync(target) && !same });
		}
		plan.push(`样式目录     ${oldCssDir}  →  ${newCssDir}（${cssMigrations.length} 个 *.css）`);
	}
	for (const entry of cssMigrations.filter((item) => item.conflict)) {
		notes.push(`两边都有且内容不同，保留新目录那份：${entry.file}`);
	}
}

/* ─────────────── 5) profile 接线 ─────────────── */
/** 旧包名候选：--css-from 给的名字，外加源目录名（本例两者都是 dsh-custom-css）。 */
const legacyNames = new Set([...cssFrom, basename(fromDir)].filter(Boolean));
const profiles = [];
/** 任何指向旧目录、或以旧包名命名且已悬空的联接（上一轮改名的残留）。 */
const staleLinks = [];
/** 联接是否真实存在（悬空联接 existsSync 为 false，必须用 lstatSync 判断）。 */
const linkExists = (path) => {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
};
if (packageName !== undefined) {
	const profilesRoot = join(dshHome, "profiles");
	if (existsSync(profilesRoot)) {
		for (const profile of readdirSync(profilesRoot, { withFileTypes: true })) {
			if (!profile.isDirectory()) continue;
			const profileDir = join(profilesRoot, profile.name);
			const entries = [join(profileDir, "local-plugins", packageName), join(profileDir, "node_modules", packageName)];
			const present = entries.filter((entry) => linkExists(entry));
			if (present.length > 0) {
				profiles.push({ name: profile.name, dir: profileDir, entries: present });
				plan.push(`profile      ${profile.name}：重建 ${present.length} 个目录联接并重跑 install.mjs`);
			}
			// 扫描该 profile 的联接：目标引用旧目录，或名字是旧包名且已悬空（上一轮改名留下的）
			for (const sub of ["local-plugins", "node_modules"]) {
				const dir = join(profileDir, sub);
				if (!existsSync(dir)) continue;
				for (const child of readdirSync(dir, { withFileTypes: true })) {
					const full = join(dir, child.name);
					let target;
					try {
						if (!lstatSync(full).isSymbolicLink()) continue;
						target = readlinkSync(full);
					} catch {
						continue; // 读不到 reparse 数据：不是联接
					}
					const dangling = !existsSync(full); // existsSync 跟随链接：悬空时为 false
					const byTarget = normalizePath(target).includes(normalizePath(fromDir));
					const byLegacyName = legacyNames.has(child.name) && dangling;
					if (byTarget || byLegacyName) staleLinks.push(full);
				}
			}
		}
	}
	if (staleLinks.length > 0) {
		plan.push(`清理残留     ${staleLinks.length} 个旧联接（指向旧目录或已悬空的旧包名条目）`);
	}
}

/* ─────────────── 6) 会话投影缓存 ─────────────── */
/**
 * 缓存记录的身份里带会话 cwd，改名后会失配。DSH 的行为是「陈旧记录读作不存在」并从日志重新折叠
 * （见 dsh-session-projection-cache 文档），所以删不删都不影响正确性；这里删掉是为了不留垃圾。
 * 覆盖两类会话：本轮待迁移的，以及上一轮已迁到新目录、但缓存仍写着旧 cwd 的（断点续跑场景）。
 */
const projcacheDir = join(dshHome, "storages", "session_projcache", "sessions");
const projcacheHits = [];
if (!skipSessions && existsSync(projcacheDir)) {
	const candidateIds = new Set(sessionMoves.map((move) => move.id));
	for (const slugDir of [newSlugDir, oldSlugDir]) {
		if (!existsSync(slugDir)) continue;
		for (const entry of readdirSync(slugDir, { withFileTypes: true })) {
			if (entry.isDirectory()) candidateIds.add(entry.name);
		}
	}
	// 记录里旧路径可能以转义（`D:\\a`）或未转义形式出现，两种都认
	const needles = [oldCwd, oldCwd.replace(/\\/g, "\\\\"), fromDir, fromDir.replace(/\\/g, "\\\\")].map((n) => n.toLowerCase());
	for (const id of candidateIds) {
		const record = join(projcacheDir, `${id}.json`);
		if (!existsSync(record)) continue;
		let raw = "";
		try {
			raw = readFileSync(record, "utf8").toLowerCase();
		} catch {
			continue;
		}
		if (needles.some((needle) => raw.includes(needle))) projcacheHits.push(record);
	}
	if (projcacheHits.length > 0) {
		plan.push(`投影缓存     删除 ${projcacheHits.length} 条（记录里带旧 cwd，删后由日志重新折叠）`);
	}
}

/* ─────────────── 报告 ─────────────── */
console.log(`DSH_HOME     ${dshHome}`);
console.log(`源目录       ${fromDir}`);
console.log(`目标目录     ${toDir}`);
console.log(`包名         ${packageName ?? "(未知)"}`);
console.log(`会话 slug    ${oldSlug}  →  ${newSlug}\n`);
for (const line of plan) console.log(`  • ${line}`);
for (const line of notes) console.log(`  · ${line}`);

if (problems.length > 0) {
	console.error(`\n无法继续：\n${problems.map((line) => `  ✗ ${line}`).join("\n")}`);
	process.exit(5);
}
if (plan.length === 0) {
	console.log("\n没有需要改的东西。");
	process.exit(0);
}

if (!apply) {
	console.log("\n以上为预览。确认后加 --apply 写入（记得先完全退出 DSH）。");
	process.exit(0);
}

/* ─────────────── 执行 ─────────────── */
// 1) 改名：脚本自己先离开这个目录，否则 Windows 会拒绝改名「任何进程的当前目录」
if (!skipRename) {
	process.chdir(tmpdir());
	try {
		renameSync(fromDir, toDir);
		console.log(`\n[1/6] 目录已改名 → ${toDir}`);
	} catch (error) {
		console.error(`\n[1/6] 改名失败：${error instanceof Error ? error.message : String(error)}`);
		console.error("       Windows 不允许改名「任何进程的工作目录或被打开的文件夹」。请逐项确认：");
		console.error("       1) 完全退出 DeepSeek Harness（托盘图标也要退出）；");
		console.error("       2) 关掉所有显示该目录或其子目录的资源管理器窗口（本插件的「打开目录」会开一个）；");
		console.error("       3) 关掉停在该项目目录里的终端；");
		console.error("       4) 在本目录之外的终端里运行本脚本（例如默认的 C:\\）。");
		console.error("       什么都没改，处理后可直接重跑。");
		process.exit(6);
	}
} else {
	console.log("\n[1/6] 跳过改名（--skip-rename）");
}

// 2) 会话日志
if (!skipSessions && sessionMoves.length > 0) {
	let moved = 0;
	for (const move of sessionMoves) {
		const buffer = readFileSync(move.file);
		const log = readLog(buffer);
		const next = rewriteHeader(buffer, log, { ...log.header, cwd: newCwd });
		mkdirSync(dirname(move.target), { recursive: true });
		writeFileSync(move.target, next);
		const check = readFileSync(move.target);
		const checkLog = readLog(check);
		const framesOk = frames(check).length === log.frames.length;
		const tailOk = check.subarray(frames(check)[0].length).equals(buffer.subarray(log.frames[0].length));
		if (!check.equals(next) || checkLog.header.cwd !== newCwd || !framesOk || !tailOk) {
			console.error(`[2/6] 会话 ${move.id} 回读校验失败，已保留原文件，停止后续步骤。`);
			process.exit(7);
		}
		rmSync(dirname(move.file), { recursive: true, force: true });
		moved += 1;
	}
	console.log(`[2/6] 已迁移并重写 ${moved} 个会话的 cwd → ${newCwd}`);
	if (existsSync(oldSlugDir) && readdirSync(oldSlugDir).length === 0) rmSync(oldSlugDir, { recursive: true, force: true });
} else {
	console.log("[2/6] 跳过会话迁移");
}

// 3) workspace.json
if (!skipRegistry && registryTouched > 0) {
	for (const entry of Object.values(registry.tables.workspaces)) {
		if (normalizePath(entry.path) !== normalizePath(oldCwd)) continue;
		if (entry.title === basename(fromDir)) entry.title = basename(toDir);
		entry.path = toDir;
		entry.updatedAt = new Date().toISOString();
	}
	copyFileSync(workspaceFile, `${workspaceFile}.rename-workspace.bak`);
	const serialized = `${JSON.stringify(registry, null, 2)}\n`;
	JSON.parse(serialized);
	writeFileSync(workspaceFile, serialized, "utf8");
	console.log(`[3/6] workspace.json 已更新（备份 ${workspaceFile}.rename-workspace.bak）`);
} else {
	console.log("[3/6] 跳过工作区登记");
}

// 4) 样式目录
if (!skipCss && cssMigrations.length > 0 && packageName !== undefined) {
	const newCssDir = join(dshHome, packageName);
	mkdirSync(newCssDir, { recursive: true });
	let copied = 0;
	for (const entry of cssMigrations) {
		if (entry.same || entry.conflict) continue;
		copyFileSync(entry.source, entry.target);
		copied += 1;
	}
	console.log(`[4/6] 样式目录已并入 ${newCssDir}（新增 ${copied} 个文件）`);
	for (const name of cssFrom) {
		const oldCssDir = join(dshHome, name);
		if (existsSync(oldCssDir) && packageName !== name) {
			rmSync(oldCssDir, { recursive: true, force: true });
			console.log(`      已移除旧样式目录 ${oldCssDir}`);
		}
	}
} else {
	console.log("[4/6] 跳过样式目录");
}

// 5) profile 接线：先解掉指向旧路径的联接（它们此刻已经悬空），再让 install.mjs 按新路径重建
if (profiles.length > 0 || staleLinks.length > 0) {
	const removed = new Set();
	for (const profile of profiles) {
		for (const entry of profile.entries) {
			if (removed.has(entry) || !linkExists(entry)) continue;
			const wasLink = lstatSync(entry).isSymbolicLink();
			rmSync(entry, { recursive: true, force: true });
			removed.add(entry);
			console.log(`[5/6] ${wasLink ? "已解链" : "已移除"} ${entry}`);
		}
	}
	for (const link of staleLinks) {
		if (removed.has(link) || !linkExists(link)) continue;
		rmSync(link, { recursive: true, force: true });
		removed.add(link);
		console.log(`[5/6] 清理残留联接 ${link}`);
	}
	for (const profile of profiles) {
		if (noInstall) {
			console.log(`[5/6] 跳过重建（--no-install）；请手动重跑：`);
			console.log(`      node "${join(toDir, "install.mjs")}" --apply --profile ${profile.name}`);
			continue;
		}
		const result = spawnSync(process.execPath, [join(toDir, "install.mjs"), "--apply", "--dsh-home", dshHome, "--profile", profile.name], {
			stdio: "inherit"
		});
		if (result.status !== 0) {
			console.error(`[5/6] install.mjs 在 profile ${profile.name} 上退出码 ${result.status}；请手动重跑：`);
			console.error(`      node "${join(toDir, "install.mjs")}" --apply --profile ${profile.name}`);
		}
	}
} else {
	console.log("[5/6] 没有需要重建的 profile 接线");
}

// 6) 会话投影缓存：记录里带旧 cwd，删掉后由会话日志重新折叠（DSH 文档：陈旧记录读作不存在）
if (projcacheHits.length > 0) {
	for (const record of projcacheHits) {
		rmSync(record, { force: true });
	}
	console.log(`[6/6] 已删除 ${projcacheHits.length} 条投影缓存记录（下次读取时从日志重新折叠）`);
} else {
	console.log("[6/6] 没有需要清理的投影缓存");
}

console.log(`\n完成。检查一遍：`);
console.log(`  • 目录：${toDir}`);
console.log(`  • 重开 DSH，工作区 "${basename(toDir)}" 应指向新路径，本会话也应在该工作区下`);
console.log(`  • 需要回滚：把目录改回 ${fromDir}，再跑一次 node "${join(fromDir, "install.mjs")}" --apply`);
