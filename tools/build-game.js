/**
 * 把 Godot 的 Web 导出整理成可部署的静态目录（games/<名字>/）。
 *
 * 为什么要改：Godot 4.7 导出的 index.wasm 有 37.7 MB，超过 Cloudflare Pages
 * 单文件 25 MiB 的上限，直接部署会被拒。这里把它压成 gzip（约 10 MB），
 * 并在 index.html 里插一个 fetch 拦截器：浏览器取到 .wasm.gz 后当场解压，
 * 再交给 Godot 的加载器，相当于「下载 10 MB、内存里得到 37 MB」。
 * 如果服务器自己给 .gz 加了 Content-Encoding: gzip，浏览器会先解压，
 * 拦截器也会认得出来（靠 gzip 魔数判断），两种情况都能跑。
 *
 * 用法：
 *   node tools/build-game.js [导出目录] [目标目录]
 *   默认：../godot/life/out  →  ./games/life
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = process.argv[2] || path.resolve(__dirname, "../../godot/life/out");
const DST = process.argv[3] || path.resolve(__dirname, "../games/life");

if (!fs.existsSync(path.join(SRC, "index.wasm"))) {
  console.error("找不到导出产物：" + path.join(SRC, "index.wasm"));
  console.error("先在 Godot 里导出 Web 版，或用 --export-release \"Web\" 命令行导出。");
  process.exit(1);
}

fs.mkdirSync(DST, { recursive: true });

// 1. 原样拷贝（index.html 与 index.wasm 单独处理）
const copy = ["index.js", "index.pck", "index.png", "index.audio.worklet.js", "index.audio.position.worklet.js"];
for (const f of copy) {
  fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
}

// 2. wasm -> gzip
const wasm = fs.readFileSync(path.join(SRC, "index.wasm"));
const gz = zlib.gzipSync(wasm, { level: 9 });
fs.writeFileSync(path.join(DST, "index.wasm.gz"), gz);
const oldWasm = path.join(DST, "index.wasm");
if (fs.existsSync(oldWasm)) fs.unlinkSync(oldWasm);

// 3. index.html：插入拦截器 + 修正 fileSizes
let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");

const interceptor = `		<script>
/* 引擎文件体积超过托管平台的单文件上限，这里改成下载 .wasm.gz 再当场解压。
   静态服务器不会替我们解压，所以由页面自己把 gzip 还原成 WASM 字节流。 */
(function () {
	const GZ = 'index.wasm.gz';
	const orig = window.fetch;
	window.fetch = function (input, init) {
		const url = typeof input === 'string' ? input : (input && input.url) || '';
		if (!/index\\.wasm$/.test(url)) {
			return orig.call(window, input, init);
		}
		return orig.call(window, GZ, { cache: 'no-cache' }).then(function (res) {
			if (!res.ok) {
				throw new Error('无法加载游戏引擎文件（HTTP ' + res.status + '）');
			}
			return res.arrayBuffer();
		}).then(function (buf) {
			const head = new Uint8Array(buf, 0, 2);
			const isGzip = head[0] === 0x1f && head[1] === 0x8b;
			let body;
			if (isGzip) {
				if (typeof DecompressionStream === 'undefined') {
					throw new Error('当前浏览器版本过低，无法解压游戏引擎，请换用新版 Chrome / Edge / Safari 再试。');
				}
				body = new Response(new Blob([buf])).body.pipeThrough(new DecompressionStream('gzip'));
			} else {
				body = new Blob([buf]);
			}
			return new Response(body, { headers: { 'Content-Type': 'application/wasm' }, status: 200 });
		});
	};
})();
		</script>
`;
html = html.replace('\t\t<script src="index.js"></script>', interceptor + '\t\t<script src="index.js"></script>');
html = html.replace(/"index\.wasm":\s*\d+/, `"index.wasm": ${gz.length}`);

fs.writeFileSync(path.join(DST, "index.html"), html);

const mb = (n) => (n / 1048576).toFixed(2) + " MB";
console.log("wasm      ", mb(wasm.length));
console.log("wasm.gz   ", mb(gz.length), "（" + (100 * gz.length / wasm.length).toFixed(1) + "%）");
console.log("index.html", html.length, "字节  fileSizes 已改为 gz 长度:", html.includes(`"index.wasm": ${gz.length}`));
console.log("产物目录  ", DST);
