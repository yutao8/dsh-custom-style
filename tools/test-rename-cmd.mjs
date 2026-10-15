// rename-now.cmd 的沙箱回归测试。
// 在临时目录里真实执行「自重启 → 等待进程退出 → 改名」，验证三件难以静态推理的事：
//   1) 自重启到独立运行目录后，父 cmd 的脚本句柄不再阻止改名
//   2) start /D 使子进程工作目录脱离被改名目录（实测 CWD 会阻止改名）
//   3) 成功与失败分支的退出码、日志、目录状态
// 对日志内容的断言只用 ASCII 子串（[stub]、数字），中文行受代码页影响不作为判据。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const sleep = (seconds) => spawnSync("ping", ["-n", String(seconds + 1), "127.0.0.1"], { stdio: "ignore" });

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : "   → " + detail}`);
	if (!ok) failures += 1;
};

/**
 * 生成沙箱副本：只改沙箱必需项（自重启判定目录、日志/副本位置、进程名、收尾命令、新目录名），
 * 其余原样保留（含 CRLF、注释）。包装脚本自身从 %~dp0 推导项目目录，所以不需要注入绝对路径。
 * options.renamedAlready —— 模拟「目录已改名、后续步骤中断」：proj 不存在，工具本体只在 target 下。
 *   此时 %~dp0 推导不出旧路径，正好用来验证「显式传两端」的续跑入口；桩不改名，只写 marker 表示
 *   「补做了后续步骤」——只有 PROJ_DIR 回退生效时 marker 才会出现。
 */
function buildSandbox(sourceCmd, sandbox, options = {}) {
	const runDir = join(sandbox, "run");
	const proj = join(sandbox, "proj");
	const target = join(sandbox, "proj-new");
	const marker = join(sandbox, "followup-done.txt");
	let text = readFileSync(sourceCmd, "utf8");
	text = text.replaceAll("%TEMP%", runDir); // 自重启判定 + 副本/日志位置（沙箱内）
	text = text.replaceAll("DeepSeek Harness.exe", "NonexistentProbe.exe"); // 等待循环立即通过
	text = text.replaceAll('notepad "%LOG%"', "echo LOGSHOWN");
	text = text.replace('set "TO_NAME=dsh-custom-style"', 'set "TO_NAME=proj-new"'); // 新目录 = sandbox\proj-new

	// 参与执行的行不得残留真实机器上的路径。禁止字面量从当前环境**动态取**（本机用户名、
	// 项目根），而不是写死——否则测试文件自己就成泄漏点。沙箱根建在 %TEMP% 下（同样含本机
	// 用户名），所以先把沙箱前缀抹掉再检查：检查的是源脚本里写死的真实路径，不是注入的沙箱路径。
	const forbidden = [userInfo().username, dirname(toolsDir)].filter((s) => s && s.length > 3);
	const stripped = (line) => line.split(sandbox).join("<sandbox>");
	for (const line of text.split(/\r?\n/)) {
		if (!/^\s*(set "(TO_NAME|NODE|LOG|RELAUNCH|ARGFILE)=|if \/I not|copy \/Y|start ")/.test(line)) continue;
		const clean = stripped(line);
		const leaked = forbidden.filter((token) => clean.includes(token));
		if (leaked.length > 0) throw new Error("执行行残留真实路径: " + clean.trim());
	}

	mkdirSync(runDir, { recursive: true });
	const toolDir = options.renamedAlready ? join(target, "tools") : join(proj, "tools");
	mkdirSync(toolDir, { recursive: true });
	writeFileSync(join(options.renamedAlready ? target : proj, "README.md"), "marker\n", "utf8");
	// 桩工具：STUB_RC 非 0 时在改名**之前**失败（模拟真实改名失败不留半成品）。
	// STUB_FAIL_TIMES：前 N 次以 STUB_RC 退出（模拟「目录被占用 → 自动重试成功」）。
	// 注意 .mjs 恒为 ESM，必须用 import 而不是 require。
	writeFileSync(join(toolDir, "rename-now.cmd"), text);
	writeFileSync(
		join(toolDir, "rename-workspace.mjs"),
		[
			'import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";',
			"const a = process.argv;",
			'const from = a[a.indexOf("--from") + 1], to = a[a.indexOf("--to")+1];',
			'if (!from || !to) { console.log("[stub] missing args"); process.exit(2); }',
			'console.log("[stub] " + from + " -> " + to);',
			"const rc = Number(process.env.STUB_RC || 0);",
			// STUB_FAIL_TIMES：前 N 次以 rc 退出（模拟「改名被占用 → 重试成功」）
			'const failFile = process.env.STUB_FAIL_FILE;',
			'const wanted = Number(process.env.STUB_FAIL_TIMES || 0);',
			'if (wanted > 0 && failFile) {',
			'  let done = 0;',
			'  try { done = Number(readFileSync(failFile, "utf8")); } catch {}',
			'  if (done < wanted) { writeFileSync(failFile, String(done + 1)); console.log("[stub] busy " + (done + 1) + "/" + wanted); process.exit(rc); }',
			'}',
			'if (rc !== 0 && wanted === 0) { console.log("[stub] simulated failure"); process.exit(rc); }',
			options.renamedAlready
				? `if (!existsSync(to)) { console.log("[stub] target missing"); process.exit(4); } writeFileSync(${JSON.stringify(marker)}, "followup done\\n"); console.log("[stub] OK");`
				: "renameSync(from, to); console.log(\"[stub] OK\");",
			""
		].join("")
	);
	return {
		proj,
		target,
		runDir,
		// 沙箱里 %TEMP% 已整体换成 runDir，所以日志/副本都落在 runDir 下
		log: join(runDir, "dsh-rename-workspace.log"),
		relaunch: join(runDir, "dsh-rename-workspace.cmd"),
		cmd: join(toolDir, "rename-now.cmd"),
		marker
	};
}

/** 轮询等待条件成立（分离子进程需要时间），返回是否等到。 */
function waitFor(condition, seconds) {
	for (let i = 0; i < seconds; i += 1) {
		if (condition()) return true;
		sleep(1);
	}
	return condition();
}

const sourceCmd = join(toolsDir, "rename-now.cmd");
const sandboxRoot = mkdtempSync(join(tmpdir(), "dsh-rename-cmd-"));

try {
	/* ── 1) 成功路径 ── */
	console.log("# 成功路径（自重启 → 真实改名）");
	const s = buildSandbox(sourceCmd, sandboxRoot);
	const launched = spawnSync("cmd.exe", ["/c", s.cmd], { encoding: "utf8" });
	check("外层调用立即返回 0（分离启动，不阻塞）", launched.status === 0, `status=${launched.status} ${(launched.stderr || "").trim().slice(0, 160)}`);

	const renamed = waitFor(() => existsSync(s.target) && !existsSync(s.proj), 25);
	check("目录已改名（父 cmd 句柄未阻止）", renamed, `proj=${existsSync(s.proj)} target=${existsSync(s.target)}`);
	check("改名后目录内容完好", existsSync(join(s.target, "README.md")) && existsSync(join(s.target, "tools", "rename-workspace.mjs")));
	check("重启副本落在守卫目录（第二段不再重启）", existsSync(s.relaunch));

	const logSeen = waitFor(() => existsSync(s.log) && readFileSync(s.log, "utf8").includes("[stub]"), 15);
	const logText = logSeen ? readFileSync(s.log, "utf8") : "";
	check("桩被以沙箱路径调用并成功", logText.includes("[stub] OK"), logText.trim().split(/\r?\n/).slice(-3).join(" | "));
	const lastLine = logText.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "";
	check("日志尾行退出码为 0", /0\s*$/.test(lastLine), lastLine);
	check("日志不含真实项目路径", !logText.includes("dsh-custom-css") && !logText.includes("dsh-custom-style"));

	/* ── 2) 失败分支：桩在改名前退出 3 ── */
	console.log("\n# 失败分支（改名前应保持原样）");
	const s2 = buildSandbox(sourceCmd, join(sandboxRoot, "second"));
	const launched2 = spawnSync("cmd.exe", ["/c", s2.cmd], { encoding: "utf8", env: { ...process.env, STUB_RC: "3" } });
	check("外层仍返回 0（失败详情在日志里）", launched2.status === 0, `status=${launched2.status}`);
	const failLog = waitFor(() => existsSync(s2.log) && /3\s*$/.test(readFileSync(s2.log, "utf8").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ""), 20);
	const log2 = failLog ? readFileSync(s2.log, "utf8") : "";
	check("日志尾行退出码为 3", failLog, log2.trim().split(/\r?\n/).slice(-2).join(" | "));
	check("失败时目录未被改名", existsSync(s2.proj) && !existsSync(s2.target), `proj=${existsSync(s2.proj)} target=${existsSync(s2.target)}`);
	check("桩确实拒绝了改名", log2.includes("simulated failure") && !log2.includes("[stub] OK"));

	/* ── 3) 断点续跑：目录已改名、.cmd 随目录到了新位置 ── */
	console.log("\n# 断点续跑（proj 不存在，工具在 target 下，显式传两端）");
	const s3 = buildSandbox(sourceCmd, join(sandboxRoot, "third"), { renamedAlready: true });
	check("前置：proj 不存在、target 存在", !existsSync(s3.proj) && existsSync(s3.target));
	// 此时 %~dp0 推导不出旧路径（推出来两端相同），必须用文档里的续跑入口显式传两端
	const launched3 = spawnSync("cmd.exe", ["/c", s3.cmd, s3.proj, s3.target], { encoding: "utf8" });
	check("外层返回 0", launched3.status === 0, `status=${launched3.status}`);
	// PROJ_DIR 回退若不生效，node 会因找不到 .mjs 而失败，marker 不会出现
	const resumed = waitFor(() => existsSync(s3.marker), 20);
	const log3 = existsSync(s3.log) ? readFileSync(s3.log, "utf8") : "";
	check("包装脚本从 target 侧找到工具并补做后续步骤", resumed, log3.trim().split(/\r?\n/).slice(-3).join(" | "));
	check("续跑日志退出码为 0", /0\s*$/.test(log3.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ""), log3.trim().split(/\r?\n/).slice(-1).join(" | "));

	/* ── 4) 占用重试：前 2 次退出 6，包装脚本应自动重试并最终改名 ── */
	console.log("\n# 占用重试（前 2 次退出码 6）");
	const s4sandbox = join(sandboxRoot, "fourth");
	const s4 = buildSandbox(sourceCmd, s4sandbox);
	const failCounter = join(s4sandbox, "busy-count.txt");
	const launched4 = spawnSync("cmd.exe", ["/c", s4.cmd], {
		encoding: "utf8",
		env: { ...process.env, STUB_RC: "6", STUB_FAIL_TIMES: "2", STUB_FAIL_FILE: failCounter }
	});
	check("外层返回 0", launched4.status === 0, `status=${launched4.status}`);
	const afterRetry = waitFor(() => existsSync(s4.target), 40); // 每次重试间隔 5 秒
	const log4 = existsSync(s4.log) ? readFileSync(s4.log, "utf8") : "";
	check("第 3 次重试成功改名", afterRetry, log4.trim().split(/\r?\n/).slice(-4).join(" | "));
	check("确实调用了 3 次（busy 2 次 + OK 1 次）", /\[stub\] busy 1\/2/.test(log4) && /\[stub\] busy 2\/2/.test(log4) && /\[stub\] OK/.test(log4), log4.trim().split(/\r?\n/).slice(-3).join(" | "));
	check("重试提示写进日志（含退出码 6 的说明）", log4.includes("exit 6"));
	check("重试次数计数器为 2", existsSync(failCounter) && readFileSync(failCounter, "utf8") === "2", existsSync(failCounter) ? readFileSync(failCounter, "utf8") : "(无)");

	console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
	process.exitCode = failures === 0 ? 0 : 1;
} finally {
	sleep(4); // 等分离子进程收尾，避免删沙箱时被占用
	try {
		rmSync(sandboxRoot, { recursive: true, force: true });
	} catch {
		console.log("（沙箱目录清理留有残留，可忽略：", sandboxRoot, "）");
	}
}
