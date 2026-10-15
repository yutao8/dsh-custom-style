/**
 * test-session-tools.mjs — 离线验证 tools/session-clone.mjs 与 tools/rename-workspace.mjs。
 *
 *   node tools/test-session-tools.mjs
 *
 * 全程在系统临时目录里造一个假的 DSH_HOME（sessions / storages / profiles）与假项目目录，
 * 不碰真实的 ~/.dsh，也不碰本项目。断言：克隆的头部改写与尾部一致性、改名后会话迁移、
 * workspace.json 更新、样式目录合并、profile 目录联接按新路径重建（用一个假的 install.mjs 断言）。
 */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { frames, projectKey, readLog } from "./lib/session-log.mjs";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const failures = [];
const check = (label, condition, detail = "") => {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures.push(label);
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
};

/** 造一个会话日志：头部 + 两个事件帧（每帧一行 JSON + 换行，checksum 打开，与 DSH 一致）。 */
const makeLog = (id, cwd) => {
	const frame = (obj) =>
		zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(obj)}\n`, "utf8"), {
			params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 }
		});
	return Buffer.concat([
		frame({ type: "session", version: 4, id, createdAt: 1792025793038, cwd, isSeeded: false, delegationDepth: 0, agentPreset: "standard" }),
		frame({ type: "user/message", seq: 0, text: "hello" }),
		frame({ type: "assistant/message", seq: 1, text: "world" })
	]);
};

const run = (script, args) => {
	const result = spawnSync(process.execPath, [join(toolsDir, script), ...args], { encoding: "utf8" });
	return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

/** 路径是否真实存在（悬空联接 existsSync 为 false，lstatSync 仍成功）。 */
const linkExists = (path) => {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
};

const root = mkdtempSync(join(tmpdir(), "dsh-session-tools-"));
const home = join(root, ".dsh");
const oldProject = join(root, "proj", "dsh-custom-css");
const newProject = join(root, "proj", "dsh-custom-style");
const cloneTarget = join(root, "other-workspace");
const pkg = "dsh-custom-style";

/* ── 假项目：package.json + 一个只会重接目录联接的 install.mjs ── */
mkdirSync(oldProject, { recursive: true });
writeFileSync(join(oldProject, "package.json"), `${JSON.stringify({ name: pkg, version: "1.0.0" }, null, 2)}\n`);
writeFileSync(
	join(oldProject, "install.mjs"),
	[
		'import { mkdirSync, rmSync, symlinkSync } from "node:fs";',
		'import { join } from "node:path";',
		'import { fileURLToPath } from "node:url";',
		'import { dirname } from "node:path";',
		"const self = dirname(fileURLToPath(import.meta.url));",
		"const argv = process.argv.slice(2);",
		'const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };',
		'const home = val("--dsh-home"); const profile = val("--profile", "desktop");',
		'const profileDir = join(home, "profiles", profile);',
		'const local = join(profileDir, "local-plugins", ' + JSON.stringify(pkg) + ");",
		'const entry = join(profileDir, "node_modules", ' + JSON.stringify(pkg) + ");",
		"rmSync(local, { recursive: true, force: true });",
		"rmSync(entry, { recursive: true, force: true });",
		'mkdirSync(join(profileDir, "local-plugins"), { recursive: true });',
		'mkdirSync(join(profileDir, "node_modules"), { recursive: true });',
		'symlinkSync(self, local, "junction");',
		'symlinkSync(local, entry, "junction");',
		'console.log("[fake install] re-linked " + entry + " -> " + self);'
	].join("\n") + "\n"
);
mkdirSync(cloneTarget, { recursive: true });

/* ── 假 DSH_HOME ── */
const oldSlugDir = join(home, "sessions", projectKey(oldProject));
const sessionId = "session-22222222-2222-2222-2222-222222222222";
mkdirSync(join(oldSlugDir, sessionId), { recursive: true });
writeFileSync(join(oldSlugDir, sessionId, "session.v4.jsonl.zstd"), makeLog(sessionId, oldProject));
const sourceLog = readFileSync(join(oldSlugDir, sessionId, "session.v4.jsonl.zstd"));
const sourceTail = sourceLog.subarray(frames(sourceLog)[0].length);

mkdirSync(join(home, "storages"), { recursive: true });
writeFileSync(
	join(home, "storages", "workspace.json"),
	`${JSON.stringify(
		{
			unit: { name: "workspace", version: 2 },
			global: { initialized: true, workspaceIds: ["ws-rename", "ws-clone"], archivedSessionIds: [], pinnedSessionIds: [] },
			tables: {
				workspaces: {
					"ws-rename": {
						path: oldProject,
						title: basename(oldProject),
						sessionIds: [sessionId],
						createdAt: "2026-10-15T00:00:00.000Z",
						updatedAt: "2026-10-15T00:00:00.000Z"
					},
					"ws-clone": { path: cloneTarget, title: "other-workspace", sessionIds: [], createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" }
				}
			}
		},
		null,
		2
	)}\n`
);

const profileDir = join(home, "profiles", "desktop");
mkdirSync(join(profileDir, "local-plugins"), { recursive: true });
mkdirSync(join(profileDir, "node_modules"), { recursive: true });
writeFileSync(join(profileDir, "package.json"), `${JSON.stringify({ name: "fake-profile", dependencies: { [pkg]: "link:./local-plugins/" + pkg }, dsh: { profile: { bundles: [pkg] } } }, null, 2)}\n`);
symlinkSync(oldProject, join(profileDir, "local-plugins", pkg), "junction");
symlinkSync(join(profileDir, "local-plugins", pkg), join(profileDir, "node_modules", pkg), "junction");
// 上一轮改名留下的悬空联接：名字是旧包名、目标不存在
symlinkSync(join(profileDir, "local-plugins", "dsh-custom-css"), join(profileDir, "node_modules", "dsh-custom-css"), "junction");

// 会话投影缓存：记录里带旧 cwd，改名后必须删除（DSH 会从日志重新折叠）
const projcacheDir = join(home, "storages", "session_projcache", "sessions");
mkdirSync(projcacheDir, { recursive: true });
const projcacheFile = join(projcacheDir, `${sessionId}.json`);
writeFileSync(projcacheFile, JSON.stringify({ cwd: oldProject, formatVersion: 4 }), "utf8");

mkdirSync(join(home, "dsh-custom-css"), { recursive: true });
mkdirSync(join(home, pkg), { recursive: true });
writeFileSync(join(home, "dsh-custom-css", "00-starter.css"), "/* edited by user */\n[data-shortcut-modal=\"settings\"]{width:1400px}\n");
writeFileSync(join(home, "dsh-custom-css", "10-mine.css"), "body{outline:0}\n");
writeFileSync(join(home, pkg, "00-starter.css"), "/* fresh seed */\n");

/* ── 1) session-clone（重构后应与重构前行为一致） ── */
console.log("# session-clone");
const cloneId = "session-33333333-3333-3333-3333-333333333333";
const clone = run("session-clone.mjs", ["--dsh-home", home, "--cwd", cloneTarget, "--from", sessionId, "--new-id", cloneId, "--apply"]);
check("退出码 0", clone.status === 0, clone.out.trim().split("\n").slice(-3).join(" | "));
const cloneFile = join(home, "sessions", projectKey(cloneTarget), cloneId, "session.v4.jsonl.zstd");
check("克隆文件已写入", existsSync(cloneFile));
if (existsSync(cloneFile)) {
	const buffer = readFileSync(cloneFile);
	const log = readLog(buffer);
	check("克隆头部 cwd 已改写", log.header.cwd === cloneTarget, log.header.cwd);
	check("克隆头部 id 已改写", log.header.id === cloneId, log.header.id);
	check("克隆尾部逐字节相同", buffer.subarray(frames(buffer)[0].length).equals(sourceTail));
	check("源会话未被改动", readFileSync(join(oldSlugDir, sessionId, "session.v4.jsonl.zstd")).equals(sourceLog));
}
const cloneRegistry = JSON.parse(readFileSync(join(home, "storages", "workspace.json"), "utf8"));
check("克隆已登记到目标工作区", cloneRegistry.tables.workspaces["ws-clone"].sessionIds.includes(cloneId));

/* ── 2) rename-workspace 预览（必须什么都不改） ── */
console.log("\n# rename-workspace 预览");
const dry = run("rename-workspace.mjs", ["--dsh-home", home, "--from", oldProject, "--to", newProject, "--css-from", "dsh-custom-css"]);
check("预览退出码 0", dry.status === 0, dry.out.trim().split("\n").slice(-2).join(" | "));
check("预览未改目录", existsSync(oldProject) && !existsSync(newProject));
check("预览未动会话", existsSync(join(oldSlugDir, sessionId, "session.v4.jsonl.zstd")));
check("预览提示先退出 DSH/加 --apply", dry.out.includes("--apply"));

/* ── 3) rename-workspace 执行 ── */
console.log("\n# rename-workspace 执行");
const moved = run("rename-workspace.mjs", ["--dsh-home", home, "--from", oldProject, "--to", newProject, "--css-from", "dsh-custom-css", "--apply"]);
check("执行退出码 0", moved.status === 0, moved.out.trim().split("\n").slice(-4).join(" | "));
check("目录已改名", existsSync(newProject) && !existsSync(oldProject));
check("假 install.mjs 已被调用并重接目录联接", moved.out.includes("[fake install] re-linked"), "");

const newSlugDir = join(home, "sessions", projectKey(newProject));
const movedFile = join(newSlugDir, sessionId, "session.v4.jsonl.zstd");
check("会话已迁到新 slug 目录", existsSync(movedFile));
check("旧会话已移除", !existsSync(join(oldSlugDir, sessionId)));
if (existsSync(movedFile)) {
	const buffer = readFileSync(movedFile);
	const log = readLog(buffer);
	check("会话头部 cwd 已改成新路径", log.header.cwd === newProject, log.header.cwd);
	check("会话 id 未变", log.header.id === sessionId, log.header.id);
	check("会话帧数未变", frames(buffer).length === frames(sourceLog).length);
	check("会话尾部逐字节相同", buffer.subarray(frames(buffer)[0].length).equals(sourceTail));
}

const registry = JSON.parse(readFileSync(join(home, "storages", "workspace.json"), "utf8"));
check("workspace.json path 已更新", registry.tables.workspaces["ws-rename"].path === newProject, registry.tables.workspaces["ws-rename"].path);
check("workspace.json title 同步更新", registry.tables.workspaces["ws-rename"].title === basename(newProject), registry.tables.workspaces["ws-rename"].title);
check("workspace.json 备份已写", existsSync(join(home, "storages", "workspace.json.rename-workspace.bak")));

check("旧样式目录已移除", !existsSync(join(home, "dsh-custom-css")));
check("独有样式文件已并入", existsSync(join(home, pkg, "10-mine.css")));
check("冲突时保留新目录那份", readFileSync(join(home, pkg, "00-starter.css"), "utf8").includes("fresh seed"));

const localLink = join(profileDir, "local-plugins", pkg);
const entryLink = join(profileDir, "node_modules", pkg);
check("local-plugins 联接已重建", existsSync(localLink) && lstatSync(localLink).isSymbolicLink());
check("node_modules 联接已重建", existsSync(entryLink) && lstatSync(entryLink).isSymbolicLink());
check("联接指向新路径", existsSync(join(localLink, "package.json")) && readFileSync(join(localLink, "package.json"), "utf8").includes("dsh-custom-style"));
check("联接目标仍是项目本体（未被删）", existsSync(join(newProject, "package.json")));

/* ---------- 新增：悬空残留联接与投影缓存清理 ---------- */
const legacyLink = join(profileDir, "node_modules", "dsh-custom-css");
check("预览列出清理残留联接", dry.out.includes("清理残留"), dry.out.trim().split("\n").slice(-8).join(" | "));
check("预览列出投影缓存清理", dry.out.includes("投影缓存"));
check("悬空旧联接已被清除", !linkExists(legacyLink));
check("新包名联接未被误删", linkExists(entryLink));
check("投影缓存记录已删除", !existsSync(projcacheFile));
check("执行日志报告清理数量", /清理残留联接/.test(moved.out) && /\[6\/6\] 已删除 1 条投影缓存/.test(moved.out), moved.out.trim().split("\n").slice(-10).join(" | "));

/* ── 4) 用独立校验器复核会话改写 ── */
console.log("\n# verify-clone 独立复核");
const verify = run("verify-clone.mjs", [
	"--source", join(newSlugDir, sessionId, "session.v4.jsonl.zstd"),
	"--clone", movedFile,
	"--id", sessionId,
	"--cwd", newProject,
	"--registry", join(home, "storages", "workspace.json")
]);
check("verify-clone 退出码 0", verify.status === 0, verify.out.trim().split("\n").slice(-2).join(" | "));

/* ── 5) 断点续跑：目录已改名、后续步骤中断后重跑 ── */
console.log("\n# 断点续跑（源目录已不存在）");
// 制造半完成状态：把 workspace.json 的 path 改回旧路径，模拟第 3 步没跑完
const halfRegistry = JSON.parse(readFileSync(join(home, "storages", "workspace.json"), "utf8"));
halfRegistry.tables.workspaces["ws-rename"].path = oldProject;
halfRegistry.tables.workspaces["ws-rename"].title = basename(oldProject);
writeFileSync(join(home, "storages", "workspace.json"), `${JSON.stringify(halfRegistry, null, 2)}\n`, "utf8");
// 再放一条带旧 cwd 的投影缓存记录
writeFileSync(projcacheFile, JSON.stringify({ cwd: oldProject }), "utf8");

const resumeDry = run("rename-workspace.mjs", ["--dsh-home", home, "--from", oldProject, "--to", newProject, "--css-from", "dsh-custom-css"]);
check("续跑预览退出码 0（不再因目标已存在而拒绝）", resumeDry.status === 0, resumeDry.out.trim().split("\n").slice(-4).join(" | "));
check("续跑预览识别为改名已完成", resumeDry.out.includes("改名已完成"), resumeDry.out.split("\n").slice(0, 12).join(" | "));
const resumeRun = run("rename-workspace.mjs", ["--dsh-home", home, "--from", oldProject, "--to", newProject, "--css-from", "dsh-custom-css", "--apply"]);
check("续跑执行退出码 0", resumeRun.status === 0, resumeRun.out.trim().split("\n").slice(-4).join(" | "));
check("续跑跳过改名", resumeRun.out.includes("跳过改名"));
const resumed = JSON.parse(readFileSync(join(home, "storages", "workspace.json"), "utf8"));
check("续跑补做了 workspace.json 更新", resumed.tables.workspaces["ws-rename"].path === newProject, resumed.tables.workspaces["ws-rename"].path);
check("续跑补做了 title 更新", resumed.tables.workspaces["ws-rename"].title === basename(newProject), resumed.tables.workspaces["ws-rename"].title);
check("续跑清掉了新出现的投影缓存", !existsSync(projcacheFile));

rmSync(root, { recursive: true, force: true });
console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 项失败：${failures.join(", ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
