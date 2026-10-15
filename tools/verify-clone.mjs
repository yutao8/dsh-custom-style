/**
 * verify-clone.mjs — 校验 session-clone 的产物（自带帧解析，独立于克隆工具）。
 *
 * 源会话可能仍在写入（它是活动会话），所以正确的不变量不是"尾部逐字节相同"，而是：
 *   - 克隆整份日志结构有效：每一帧都能解压、每一行都是合法 JSON；
 *   - 克隆头部与源头部除 id / cwd 外完全一致；
 *   - 克隆的事件行是源事件行的**前缀**（克隆 = 制作那一刻的完整历史）。
 * 报告里会给出源比克隆多出的行数（即制作之后新增的部分）。
 *
 *   node tools/verify-clone.mjs --source <源日志> --clone <克隆日志> \
 *        [--id <新会话 id>] [--cwd <新 cwd>] [--registry <workspace.json>]
 */
import { existsSync, readFileSync } from "node:fs";
import zlib from "node:zlib";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

/** 单个 zstd 帧的字节长度（帧头 + 全部块 + 可选校验和）。 */
function frameLength(buffer, offset) {
	if (buffer.readUInt32LE(offset) !== 0xfd2fb528) throw new Error(`magic mismatch @${offset}`);
	let at = offset + 4;
	const descriptor = buffer[at++];
	const fcsFlag = descriptor >> 6;
	const single = (descriptor >> 5) & 1;
	const checksum = (descriptor >> 2) & 1;
	const dictFlag = descriptor & 3;
	if (!single) at += 1;
	at += [0, 1, 2, 4][dictFlag];
	if (fcsFlag !== 0) at += [0, 2, 4, 8][fcsFlag];
	else if (single) at += 1;
	for (;;) {
		const header = buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16);
		at += 3;
		const last = header & 1;
		const type = (header >> 1) & 3;
		const size = header >> 3;
		at += type === 1 ? 1 : size;
		if (last) break;
	}
	if (checksum) at += 4;
	if (at > buffer.length) throw new Error(`帧被截断：需要 ${at}，只有 ${buffer.length}`);
	return at - offset;
}

/** 逐帧解压，返回 { frames, lines, broken }。 */
function decodeLog(buffer) {
	const frames = [];
	const lines = [];
	const broken = [];
	let offset = 0;
	while (offset < buffer.length) {
		let length;
		try {
			length = frameLength(buffer, offset);
		} catch (error) {
			broken.push(`帧边界解析失败 @${offset}: ${error.message}`);
			break;
		}
		try {
			const text = zlib.zstdDecompressSync(buffer.subarray(offset, offset + length)).toString("utf8");
			for (const line of text.split("\n")) if (line.trim() !== "") lines.push(line);
		} catch (error) {
			broken.push(`第 ${frames.length + 1} 帧解压失败 @${offset}: ${error.message}`);
		}
		frames.push({ offset, length });
		offset += length;
	}
	return { frames, lines, broken };
}

const failures = [];
const check = (label, condition, detail = "") => {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures.push(label);
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
};

const normalizePath = (path) => path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
const safeJson = (line) => {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
};

const sourcePath = value("--source");
const clonePath = value("--clone");
const expectId = value("--id");
const expectCwd = value("--cwd");
const registryPath = value("--registry");

check("源文件存在", existsSync(sourcePath), sourcePath);
check("克隆文件存在", existsSync(clonePath), clonePath);
if (failures.length > 0) process.exit(1);

const source = decodeLog(readFileSync(sourcePath));
const clone = decodeLog(readFileSync(clonePath));

console.log(`  源：${source.frames.length} 帧 / ${source.lines.length} 行`);
console.log(`  克隆：${clone.frames.length} 帧 / ${clone.lines.length} 行`);

check("克隆每一帧都可解压", clone.broken.length === 0, clone.broken.join("; "));
check("源每一帧都可解压", source.broken.length === 0, source.broken.join("; "));
check("克隆每行都是合法 JSON", clone.lines.every((line) => safeJson(line) !== undefined));

const sourceHeader = safeJson(source.lines[0]);
const cloneHeader = safeJson(clone.lines[0]);
console.log(`  克隆头部：id=${cloneHeader?.id} cwd=${cloneHeader?.cwd}`);

check("第一行是会话头", cloneHeader?.type === "session" && sourceHeader?.type === "session");
check("克隆 id 已改写", expectId === undefined || cloneHeader?.id === expectId, String(cloneHeader?.id));
check("克隆 cwd 已改写", expectCwd === undefined || normalizePath(String(cloneHeader?.cwd)) === normalizePath(expectCwd), String(cloneHeader?.cwd));
check(
	"头部除 id / cwd 外完全一致",
	JSON.stringify({ ...cloneHeader, id: sourceHeader?.id, cwd: sourceHeader?.cwd }) === JSON.stringify(sourceHeader)
);

const cloneEvents = clone.lines.slice(1);
const sourceEvents = source.lines.slice(1);
let prefixMismatch = -1;
for (let i = 0; i < cloneEvents.length; i++) {
	if (cloneEvents[i] !== sourceEvents[i]) {
		prefixMismatch = i;
		break;
	}
}
check(
	`克隆事件是源事件的前缀（${cloneEvents.length} 行）`,
	prefixMismatch === -1,
	prefixMismatch === -1 ? "" : `第 ${prefixMismatch} 行起不同`
);

const newer = sourceEvents.length - cloneEvents.length;
if (newer > 0) console.log(`  提示：源在克隆之后新增了 ${newer} 行（克隆不含这部分）`);
const lastEvent = safeJson(cloneEvents[cloneEvents.length - 1] ?? "{}");
console.log(`  克隆最后一条事件：${lastEvent?.type ?? "?"}（seq=${lastEvent?.seq ?? "?"}）`);

if (registryPath !== undefined) {
	const registry = JSON.parse(readFileSync(registryPath, "utf8"));
	const entries = Object.entries(registry?.tables?.workspaces ?? {});
	const owner = entries.find(([, entry]) => (entry.sessionIds ?? []).includes(cloneHeader?.id));
	check("workspace.json 已登记克隆会话", owner !== undefined);
	if (owner !== undefined) {
		check("登记在 cwd 对应的工作区", normalizePath(owner[1].path) === normalizePath(String(cloneHeader?.cwd)), owner[1].path);
		check("登记为列表首项（新到旧）", owner[1].sessionIds[0] === cloneHeader?.id, owner[1].sessionIds[0]);
	}
}

console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 项失败：${failures.join(", ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
