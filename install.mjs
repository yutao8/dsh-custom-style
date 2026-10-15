#!/usr/bin/env node
/**
 * dsh-custom-style — 安装 / 卸载脚本。
 *
 *   node install.mjs                                  # 只预览（默认 dry-run）
 *   node install.mjs --apply                          # 安装到 $DSH_HOME/profiles/desktop
 *   node install.mjs --apply --profile web            # 安装到 web profile
 *   node install.mjs --apply --copy                   # 改为复制源码（默认是目录联接）
 *   node install.mjs --uninstall --apply              # 卸载（保留用户 CSS 目录）
 *   node install.mjs --apply --dsh-home D:\some\.dsh  # 指定 DSH_HOME
 *
 * 默认把本目录（插件工程根）作为唯一源码：在 profile 里创建
 *   <profile>/local-plugins/dsh-custom-style   →（目录联接）→ 本目录
 *   <profile>/node_modules/dsh-custom-style    →（目录联接）→ 上面那层
 * 并在 <profile>/package.json 里登记 dependency 与 bundle（改前备份）。
 * 于是改本目录里的代码 = 改实际加载的插件，不再有第二份副本。
 * 幂等：可重复执行；只在该文件缺失时播种用户样式表。
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "dsh-custom-style";
const PACKAGE_FILES = ["package.json", "index.js", "client.js", "starter.css", "cordis.patch.yml", "README.md", "README.en.md"];
const LINK_SPEC = "link:./local-plugins/dsh-custom-style";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const apply = flag("--apply");
const uninstall = flag("--uninstall");
const useCopy = flag("--copy");
const profileName = value("--profile", "desktop");
const dshHome = resolve(value("--dsh-home", process.env.DSH_HOME?.trim() || join(homedir(), ".dsh")));
const sourceDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
const profileDir = join(dshHome, "profiles", profileName);
const profilePackage = join(profileDir, "package.json");
const localPluginsDir = join(profileDir, "local-plugins", PACKAGE_NAME);
const nodeModulesEntry = join(profileDir, "node_modules", PACKAGE_NAME);
const userCssDir = join(dshHome, PACKAGE_NAME);

const report = [];
const log = (line) => report.push(line);

/** realpath，失败时回退原值。 */
const realOr = (path) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

/** 读一个目录里的 package.json 名字（非本包返回 undefined）。 */
const ownerOf = (dir) => {
	const marker = join(dir, "package.json");
	if (!existsSync(marker)) return undefined;
	try {
		return JSON.parse(readFileSync(marker, "utf8")).name;
	} catch {
		return undefined;
	}
};

/** 目录里的条目数（读取失败返回 -1）。 */
const entryCount = (dir) => {
	try {
		return readdirSync(dir).length;
	} catch {
		return -1;
	}
};

/** 目录是否存在且为空。 */
const isEmptyDir = (dir) => existsSync(dir) && lstatSync(dir).isDirectory() && entryCount(dir) === 0;

/** 安全移除一个目录 / 联接：联接只删链接，目标内容不动（Node 递归移除不会跟进 reparse point）。 */
const removeDirOrLink = (path, label) => {
	if (!existsSync(path)) return false;
	const stats = lstatSync(path);
	if (stats.isSymbolicLink()) {
		rmSync(path, { recursive: true, force: true });
		log(`${label}  ${path}（目录联接，目标未改动）`);
		return true;
	}
	const owner = ownerOf(path);
	if (owner !== undefined && owner !== PACKAGE_NAME) {
		console.error(`${path} 已存在且属于其他包（name=${owner}），拒绝删除。`);
		process.exit(3);
	}
	if (owner === undefined && !isEmptyDir(path)) {
		console.error(`${path} 已存在且不是 ${PACKAGE_NAME} 的目录，拒绝删除。`);
		process.exit(3);
	}
	rmSync(path, { recursive: true, force: true });
	log(`${label}  ${path}`);
	return true;
};

/** 读出 profile package.json（缺失即报错退出）。 */
const readProfilePackage = () => {
	if (!existsSync(profilePackage)) {
		console.error(`找不到 profile：${profilePackage}\n用 --profile 指定 desktop / web，或用 --dsh-home 指定 DSH_HOME。`);
		process.exit(2);
	}
	return JSON.parse(readFileSync(profilePackage, "utf8"));
};

console.log(`DSH_HOME      ${dshHome}`);
console.log(`profile       ${profileName}  (${profileDir})`);
console.log(`源码          ${sourceDir}`);
console.log(`模式          ${uninstall ? "卸载" : useCopy ? "安装（复制源码）" : "安装（目录联接 → 单一源码）"}${apply ? "" : " · 预览（加 --apply 才会写入）"}\n`);

const pkg = readProfilePackage();
const bundles = pkg?.dsh?.profile?.bundles;

if (uninstall) {
	if (apply) {
		removeDirOrLink(nodeModulesEntry, "移除入口");
		removeDirOrLink(localPluginsDir, "移除源码位置");
	}
	if (pkg.dependencies?.[PACKAGE_NAME]) delete pkg.dependencies[PACKAGE_NAME];
	if (Array.isArray(bundles)) {
		const index = bundles.indexOf(PACKAGE_NAME);
		if (index >= 0) bundles.splice(index, 1);
	}
	log(`package.json  移除 dependencies.${PACKAGE_NAME} 与 bundles 条目`);
	if (apply) {
		copyFileSync(profilePackage, `${profilePackage}.dsh-custom-style.bak`);
		writeFileSync(profilePackage, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
		log(`已写入        ${profilePackage}（备份 ${profilePackage}.dsh-custom-style.bak）`);
	}
	log(`保留用户样式  ${userCssDir}`);
} else {
	// 1) 源码位置：默认目录联接指向插件工程根；--copy 时复制文件快照
	const sameAsSource = existsSync(localPluginsDir) && realOr(localPluginsDir) === sourceDir;
	const isLink = existsSync(localPluginsDir) && lstatSync(localPluginsDir).isSymbolicLink();
	if (apply) {
		if (useCopy) {
			mkdirSync(localPluginsDir, { recursive: true });
			for (const file of PACKAGE_FILES) {
				const from = join(sourceDir, file);
				if (!existsSync(from)) {
					console.error(`缺少源文件：${from}`);
					process.exit(4);
				}
				cpSync(from, join(localPluginsDir, file));
			}
		} else {
			if (sameAsSource && isLink) {
				log(`源码位置已是本目录的联接，无需重建`);
			} else {
				if (existsSync(localPluginsDir)) removeDirOrLink(localPluginsDir, "替换源码位置");
				mkdirSync(join(profileDir, "local-plugins"), { recursive: true });
				symlinkSync(sourceDir, localPluginsDir, "junction");
			}
		}
	}
	log(
		useCopy
			? `复制源码      ${sourceDir} → ${localPluginsDir}  (${PACKAGE_FILES.length} 个文件)`
			: `目录联接      ${localPluginsDir} → ${sourceDir}`
	);

	// 2) node_modules 入口（始终指向 local-plugins 那一层）
	if (apply) {
		removeDirOrLink(nodeModulesEntry, "重建入口");
		mkdirSync(join(profileDir, "node_modules"), { recursive: true });
		symlinkSync(localPluginsDir, nodeModulesEntry, "junction");
	}
	log(`目录联接      ${nodeModulesEntry} → local-plugins/${PACKAGE_NAME}`);

	// 3) profile package.json
	pkg.dependencies = pkg.dependencies ?? {};
	pkg.dependencies[PACKAGE_NAME] = LINK_SPEC;
	pkg.dsh = pkg.dsh ?? {};
	pkg.dsh.profile = pkg.dsh.profile ?? {};
	pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
	if (!pkg.dsh.profile.bundles.includes(PACKAGE_NAME)) pkg.dsh.profile.bundles.push(PACKAGE_NAME);
	if (apply) {
		copyFileSync(profilePackage, `${profilePackage}.dsh-custom-style.bak`);
		writeFileSync(profilePackage, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
	}
	log(`登记依赖      dependencies["${PACKAGE_NAME}"] = "${LINK_SPEC}"`);
	log(`登记 bundle   dsh.profile.bundles += "${PACKAGE_NAME}"`);
	log(`已写入        ${profilePackage}（备份 ${profilePackage}.dsh-custom-style.bak）`);

	// 4) 用户样式目录（缺失才播种）
	const starterTarget = join(userCssDir, "00-starter.css");
	if (!existsSync(starterTarget)) {
		if (apply) {
			mkdirSync(userCssDir, { recursive: true });
			copyFileSync(join(sourceDir, "starter.css"), starterTarget);
		}
		log(`播种样式      ${starterTarget}`);
	} else {
		log(`样式已存在    ${starterTarget}（未改动）`);
	}
}

console.log(report.map((line) => `• ${line}`).join("\n"));
console.log(
	apply
		? `\n${uninstall ? "卸载" : "安装"}完成。\n下一步：完全退出并重启 DSH（Host 半身在启动时注册 /dsh-custom-style 路由）。\n之后编辑 ${userCssDir}\\*.css 保存即生效，无需重启。`
		: `\n以上为预览。确认后执行：node install.mjs${uninstall ? " --uninstall" : ""}${useCopy ? " --copy" : ""} --apply${profileName === "desktop" ? "" : ` --profile ${profileName}`}`
);
