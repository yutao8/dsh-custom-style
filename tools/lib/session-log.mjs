/**
 * session-log.mjs — DSH 会话日志（多帧 zstd JSONL）的解析与头部改写。
 *
 * `tools/session-clone.mjs` 与 `tools/rename-workspace.mjs` 共用这一份实现：
 * 两个工具都要「只改第一帧（头部）里的字段，其余帧逐字节不动」，而 DSH 写出的日志是
 * **多帧拼接**的 zstd 流（Node 的 zstdDecompressSync 只解第一帧），所以帧边界必须自己走。
 *
 * 帧格式（RFC 8878）：magic(4) · Frame_Header_Descriptor(1) · Window_Descriptor(0/1) ·
 * Dictionary_ID(0/1/2/4) · Frame_Content_Size(0/1/2/4/8) · 若干 Block(3 字节块头 + 内容) ·
 * Content_Checksum(0/4)。`encodeSegment` / `projectKey` 与 DSH 的同名函数逐字符等价。
 */
import zlib from "node:zlib";

export const ZSTD_MAGIC = 0xfd2fb528;

/**
 * 读取一个 zstd 帧的总字节长度。
 * @param buffer - 整个日志
 * @param offset - 帧起始偏移
 * @returns 帧长度与帧头标志
 */
export function frameLength(buffer, offset) {
	const start = offset;
	if (buffer.length - offset < 5) throw new Error(`帧头不完整 @${offset}`);
	if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`不是 zstd 帧 @${offset}`);
	offset += 4;
	const descriptor = buffer.readUInt8(offset);
	offset += 1;
	const contentSizeFlag = descriptor >> 6;
	const singleSegment = (descriptor >> 5) & 1;
	const checksumFlag = (descriptor >> 2) & 1;
	const dictionaryIdFlag = descriptor & 3;
	if (!singleSegment) offset += 1; // Window_Descriptor
	offset += [0, 1, 2, 4][dictionaryIdFlag];
	if (contentSizeFlag === 0) {
		if (singleSegment) offset += 1;
	} else {
		offset += [0, 2, 4, 8][contentSizeFlag];
	}
	for (;;) {
		if (buffer.length - offset < 3) throw new Error(`块头不完整 @${offset}`);
		const header = buffer.readUInt8(offset) | (buffer.readUInt8(offset + 1) << 8) | (buffer.readUInt8(offset + 2) << 16);
		offset += 3;
		const lastBlock = header & 1;
		const blockType = (header >> 1) & 3;
		const blockSize = header >> 3;
		if (blockType === 3) throw new Error(`保留块类型 @${offset}`);
		offset += blockType === 1 ? 1 : blockSize; // RLE 块只存 1 字节
		if (lastBlock) break;
	}
	if (checksumFlag) offset += 4;
	if (offset > buffer.length) throw new Error(`帧被截断：需要 ${offset} 字节，只有 ${buffer.length}`);
	return { length: offset - start, checksumFlag, singleSegment };
}

/**
 * 依次切出所有帧。
 * @param buffer - 整个日志
 * @returns 帧列表（含 offset / length / checksumFlag）
 */
export function frames(buffer) {
	const list = [];
	let offset = 0;
	while (offset < buffer.length) {
		const frame = frameLength(buffer, offset);
		list.push({ offset, ...frame });
		offset += frame.length;
	}
	return list;
}

/**
 * 解压一帧。
 * @param buffer - 整个日志
 * @param frame - {@link frames} 的一项
 * @returns 解压后的字节
 */
export const decompressFrame = (buffer, frame) => zlib.zstdDecompressSync(buffer.subarray(frame.offset, frame.offset + frame.length));

/**
 * 读出日志的帧列表与头部。
 * @param buffer - 整个日志
 * @returns 帧列表与解析后的头部 JSON
 */
export function readLog(buffer) {
	const list = frames(buffer);
	if (list.length === 0) throw new Error("日志里没有任何 zstd 帧");
	const header = JSON.parse(decompressFrame(buffer, list[0]).toString("utf8"));
	if (header.type !== "session" || typeof header.id !== "string") throw new Error(`第一帧不是会话头：${JSON.stringify(header).slice(0, 200)}`);
	return { frames: list, header };
}

/**
 * 用新的头部替换第一帧，其余帧逐字节保持。
 * @param buffer - 源日志
 * @param log - {@link readLog} 的结果
 * @param nextHeader - 新的头部对象
 * @returns 新日志（长度可能与源不同）
 */
export function rewriteHeader(buffer, log, nextHeader) {
	// 头部帧的正文是「一行 JSON + 换行」，与 DSH 写出的字节一致
	const json = `${JSON.stringify(nextHeader)}\n`;
	const frame = zlib.zstdCompressSync(Buffer.from(json, "utf8"), {
		params: { [zlib.constants.ZSTD_c_checksumFlag]: log.frames[0].checksumFlag ? 1 : 0 }
	});
	return Buffer.concat([frame, buffer.subarray(log.frames[0].length)]);
}

/**
 * 单个路径段的安全编码，与 DSH `encodeSegment` 一致。
 * @param raw - 非空字符串
 * @returns 可安全用作目录名的片段
 */
export function encodeSegment(raw) {
	if (raw.length === 0) throw new Error("cannot encode an empty path segment");
	if (raw === ".") return "~002E";
	if (raw === "..") return "~002E~002E";
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
		else out += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
	}
	return out;
}

/**
 * cwd → DSH 的项目目录名，与 DSH `projectKey` 一致。
 * @param cwd - 会话记录的绝对目录
 * @returns `--<规范化 cwd>--`
 */
export function projectKey(cwd) {
	if (cwd.length === 0) throw new Error("cannot encode an empty project path");
	let readable = "";
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!separatorRun) readable += "-";
			separatorRun = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/**
 * 归一化一个 cwd：绝对路径，Windows 下统一反斜杠。
 * @param cwd - 用户传入的目录
 * @returns 可写进会话头部的 cwd
 */
export const normalizeCwd = (cwd) => (process.platform === "win32" ? cwd.replace(/\//g, "\\") : cwd);

/**
 * 路径比较用归一化：分隔符统一、去尾斜杠、忽略大小写。
 * @param path - 任意路径
 * @returns 可比较的字符串
 */
export const normalizePath = (path) => path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
