#!/usr/bin/env node
/**
 * verniy 博客本地发布器
 * ------------------------------------------------------------------
 * 零依赖，只用 Node 内置模块。跑起来后在浏览器里写文章，
 * 它会自动：生成文章页 → 把卡片插到首页 → git 提交推送。
 *
 *   node tools/publisher/server.js      （或双击 start-publisher.cmd）
 *
 * 设计原则：不改动已有网页的其它内容，只做「新增/更新文章」这件事，
 * 以及同步首页里的文章数量。
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const PORT = 3721;
const HOST = "127.0.0.1";

/* tools/publisher/server.js → 仓库根目录 */
const ROOT = path.resolve(__dirname, "..", "..");
const POSTS_DIR = path.join(ROOT, "posts");
/* 草稿单独放 drafts/，并且整个目录加进 .gitignore ——
   这样草稿永远不会被 push，也就不会被 Cloudflare 部署出去。
   只放在 posts/ 是不够的：那样草稿虽然不在首页列出，
   但任何人访问 /posts/xxx.html 依然能看到。 */
const DRAFTS_DIR = path.join(ROOT, "drafts");
const IMAGES_DIR = path.join(ROOT, "assets", "images");
const INDEX_FILE = path.join(ROOT, "index.html");
const GITIGNORE = path.join(ROOT, ".gitignore");

/* 设计基准：新文章会从这篇文章读取 <head> 里的样式，保证风格一致。
   以后如果你换了主文章，把文件名改这里即可。 */
const BASE_ARTICLE = path.join(POSTS_DIR, "001-static-blog.html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/* ============================================================
 * 小工具
 * ============================================================ */

function read(file) {
  return fs.readFileSync(file, "utf-8");
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 2026-10-09 → 2026 年 10 月 9 日 */
function formatCnDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return String(iso || "");
  return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
}

/** 去掉 HTML 标签，用来估算阅读时长 */
function stripTags(html) {
  return String(html || "")
    .replace(/<pre[\s\S]*?<\/pre>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ");
}

/** 按中文习惯估算阅读时长：约 400 字/分钟 */
function readingTime(html) {
  const text = stripTags(html).replace(/\s+/g, "");
  return Math.max(1, Math.round(text.length / 400));
}

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 40 * 1024 * 1024) {
        reject(new Error("请求体过大（超过 40MB）"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* ============================================================
 * 文章模板
 * ============================================================ */

/** 从设计基准文章里取出 <head>…</head>（含全部样式），作为新文章的骨架 */
function baseHead() {
  if (!fs.existsSync(BASE_ARTICLE)) {
    throw new Error(
      "找不到设计基准文章：" + path.relative(ROOT, BASE_ARTICLE) +
      "\n请在 server.js 里把 BASE_ARTICLE 改成你想作为模板的文章。"
    );
  }
  const t = read(BASE_ARTICLE);
  const m = /([\s\S]*?<\/head>)/.exec(t);
  if (!m) throw new Error("基准文章里找不到 </head>");
  return m[1];
}

function renderArticle(meta, bodyHtml) {
  const head = baseHead();
  const tags = (meta.tags || []).filter(Boolean);

  const tagSpans = (tags.length ? tags : ["随笔"])
    .map((t) => `          <span class="tag">${escapeHtml(t)}</span>`)
    .join("\n");

  return `${head.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)} · verniy</title>`)}
<body>
<div class="shell">

  <!-- ================= 顶栏：左上角回到主页，右上角 BGM 控制 ================= -->
  <header class="topbar">
    <div class="topbar-inner">
      <nav class="nav-group" aria-label="页面导航">
        <a class="btn btn-compact" href="../index.html">
          <span aria-hidden="true">&larr;</span> 回到主页
        </a>
      </nav>

      <div class="audio-group">
        <button id="playBtn" class="btn btn-compact" type="button" aria-pressed="false" title="播放背景音乐">
          <span aria-hidden="true">&#9654;</span><span class="label">播放</span>
        </button>
        <button id="pauseBtn" class="btn btn-compact" type="button" title="暂停背景音乐">
          <span aria-hidden="true">&#10073;&#10073;</span><span class="label">暂停</span>
        </button>
      </div>
    </div>
    <p id="audioNote" class="audio-note" role="status" aria-live="polite"></p>
  </header>

  <!-- ================= 主体 ================= -->
  <main class="main">

    <nav class="crumbs" aria-label="面包屑">
      <a href="../index.html">主页</a>
      <span aria-hidden="true">/</span>
      <span>${escapeHtml(meta.category || "随笔")}</span>
    </nav>

    <article>
      <header class="post-header">
        <div class="post-tags">
${tagSpans}
        </div>
        <h1 class="post-title">${escapeHtml(meta.title)}</h1>
        <div class="post-meta">
          <time datetime="${escapeHtml(meta.date)}">${formatCnDate(meta.date)}</time>
          <span class="dot" aria-hidden="true"></span>
          <span>约 ${readingTime(bodyHtml)} 分钟阅读</span>
        </div>
      </header>

      <!-- ★ 正文从这里开始，改内容只需要动这一段 ★ -->
      <div class="article">
${bodyHtml}
      </div>
      <!-- ★ 正文结束 ★ -->

      <footer class="post-footer">
        <div class="post-tags">
${tagSpans}
        </div>
        <span>最后更新于 ${formatCnDate(meta.date)}</span>
      </footer>
    </article>

    <nav class="post-nav" aria-label="文章导航">
      <span class="is-disabled">上一篇 / 下一篇待补充</span>
    </nav>

  </main>

  <!-- ================= 页脚 ================= -->
  <footer class="site-footer">
    <div class="footer-inner">
      <span>&copy; <span id="year">2025</span> verniy &middot; 保留所有权利</span>
      <nav class="footer-links" aria-label="页脚导航">
        <a href="../index.html">主页</a>
        <a href="../about.html">关于我</a>
        <a href="../contact.html">联系我</a>
      </nav>
    </div>
  </footer>

</div>

<!-- 背景音乐：与其它页面共用播放状态，从文章页回主页时音乐不会断 -->
<audio id="bgm" src="../assets/bgm.mp3" loop preload="auto"></audio>

<script>
(function () {
  'use strict';

  /* 跨页面续播：把「是否在播」和「播到第几秒」写进 localStorage，
     新页面加载后读回来，从上次的位置接着播。 */
  var KEY  = 'verniy.bgm.state.v1';
  var TICK = 'verniy.bgm.tick.v1';
  var audio = document.getElementById('bgm');
  var playBtn = document.getElementById('playBtn');
  var pauseBtn = document.getElementById('pauseBtn');
  var note = document.getElementById('audioNote');
  var noteTimer = null;
  var resumeAt = 0;
  var wantPlaying = false;

  var yearEl = document.getElementById('year');
  if (yearEl) { yearEl.textContent = new Date().getFullYear(); }

  function showNote(msg, ms) {
    if (!note) return;
    note.textContent = msg;
    note.classList.add('is-visible');
    if (noteTimer) clearTimeout(noteTimer);
    if (ms) noteTimer = setTimeout(hideNote, ms);
  }
  function hideNote() { if (note) note.classList.remove('is-visible'); }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJSON(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  function syncUI(playing) {
    if (playBtn) {
      playBtn.classList.toggle('is-active', playing);
      playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      playBtn.title = playing ? '背景音乐播放中' : '播放背景音乐';
    }
    if (pauseBtn) { pauseBtn.title = playing ? '暂停背景音乐' : '播放背景音乐'; }
  }

  function saveState(playing) {
    var t = 0;
    try { t = audio.currentTime || 0; } catch (e) { t = 0; }
    var atEnd = audio.duration && isFinite(audio.duration) && t >= audio.duration - 0.35;
    if (atEnd) { t = 0; }
    writeJSON(KEY, { playing: !!playing, time: Math.round(t * 1000) / 1000 });
    if (playing) { writeJSON(TICK, Date.now()); }
  }

  function play(opts) {
    opts = opts || {};
    if (typeof opts.from === 'number' && isFinite(opts.from) && opts.from > 0.05) {
      try {
        if (Math.abs(audio.currentTime - opts.from) > 0.2) { audio.currentTime = opts.from; }
      } catch (e) {}
    }
    if (opts.note) { showNote(opts.note, 3600); }
    var p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(function () {
        wantPlaying = true;
        saveState(true);
        syncUI(true);
      }).catch(function () {
        syncUI(false);
        if (opts.silentBlock) {
          showNote('浏览器要求先点一下页面才能出声 —— 点右上角「播放」即可从上次的位置继续。', 6000);
        } else {
          showNote('浏览器阻止了自动播放，请再点一次「播放」按钮，会从上次的位置继续。', 5200);
        }
      });
    }
  }

  function pause() {
    audio.pause();
    saveState(false);
    wantPlaying = false;
    syncUI(false);
    showNote('背景音乐已暂停（切页后会停在这里，点「播放」从这一秒继续）', 3200);
  }

  if (playBtn)  { playBtn.addEventListener('click', function () { play({ from: resumeAt }); }); }
  if (pauseBtn) { pauseBtn.addEventListener('click', pause); }

  audio.addEventListener('play',  function () { wantPlaying = true; syncUI(true); });
  audio.addEventListener('pause', function () { syncUI(false); });
  audio.addEventListener('timeupdate', function () {
    if (!audio.paused) { saveState(true); }
  });
  audio.addEventListener('loadedmetadata', function () {
    if (wantPlaying && resumeAt > 0.05) {
      try {
        if (Math.abs(audio.currentTime - resumeAt) > 0.2 && resumeAt < audio.duration - 0.5) {
          audio.currentTime = resumeAt;
        }
      } catch (e) {}
    }
  });

  window.addEventListener('pagehide', function () { saveState(!audio.paused); });
  window.addEventListener('beforeunload', function () { saveState(!audio.paused); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { saveState(!audio.paused); }
  });

  function seekTo(t) {
    if (!(t > 0.05)) return;
    try { audio.currentTime = t; } catch (e) {}
    var once = function () {
      try {
        if (audio.duration && isFinite(audio.duration) && t < audio.duration - 0.5 &&
            Math.abs(audio.currentTime - t) > 0.2) { audio.currentTime = t; }
      } catch (e) {}
      audio.removeEventListener('loadedmetadata', once);
    };
    audio.addEventListener('loadedmetadata', once);
  }

  syncUI(false);
  var savedState = readJSON(KEY);
  var savedTick  = readJSON(TICK);
  var stillFresh = typeof savedTick === 'number' && (Date.now() - savedTick) < 30000;

  if (savedState && typeof savedState.time === 'number' && isFinite(savedState.time)) {
    resumeAt = savedState.time;
  }

  if (savedState && savedState.playing === true && stillFresh) {
    wantPlaying = true;
    seekTo(resumeAt);
    showNote(resumeAt > 0.05
      ? '接着上次的位置继续播放（已到 ' + Math.floor(resumeAt / 60) + ':' + ('0' + Math.floor(resumeAt % 60)).slice(-2) + '）'
      : '正在继续播放背景音乐', 4000);
    play({ from: resumeAt, silentBlock: true });
  } else if (savedState && savedState.playing === false) {
    seekTo(resumeAt);
  }

  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (t && t.closest && t.closest('button, a')) return;
    e.preventDefault();
    if (audio.paused) { play({ from: resumeAt }); } else { pause(); }
  });

})();
</script>
</body>
</html>
`;
}

/* ============================================================
 * 首页卡片
 * ============================================================ */

/** 统计真正的文章卡片数量。
 *  index.html 里有一行注释含有 <li class="post"> 字样，
 *  直接全局匹配会把注释也算进去，导致数量多 1。先剥掉注释再数。 */
function countCards(html) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
  return (noComments.match(/<li class="post">/g) || []).length;
}

/** 同步首页两处文章数量 */
function syncCount(html) {
  const total = countCards(html);
  return html
    .replace(/共\s*\d+\s*篇文章/, `共 ${total} 篇文章`)
    .replace(/(<span class="section-count">)\s*\d+\s*篇(\s*<\/span>)/, `$1${total} 篇$2`);
}

/** 读取某个目录下的文章/草稿清单 */
function listDir(dir, kind) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((f) => {
      const raw = read(path.join(dir, f));
      const title = (/<h1 class="post-title">([\s\S]*?)<\/h1>/.exec(raw) || [, ""])[1].trim();
      const date = (/<time datetime="([^"]+)"/.exec(raw) || [, ""])[1];
      const catNav = (/<nav class="crumbs"[\s\S]*?<\/nav>/.exec(raw) || [""])[0];
      const category = (catNav.match(/<span>([\s\S]*?)<\/span>\s*<\/nav>/) || [, ""])[1].trim();
      const bodyRaw = (/<div class="article">([\s\S]*?)<!-- ★ 正文结束 ★ -->/.exec(raw) || [, ""])[1];
      const excerpt = (/<p>\s*([\s\S]*?)\s*<\/p>/.exec(bodyRaw) || [, ""])[1].replace(/<[^>]+>/g, "").trim();
      return { file: f, title, date, category, excerpt, kind };
    });
}

/** 已发布 + 草稿，一起返回给编辑器 */
function listAll() {
  const posts = listDir(POSTS_DIR, "post");
  const drafts = listDir(DRAFTS_DIR, "draft");
  return { posts, drafts, totalPosts: posts.length, totalDrafts: drafts.length };
}

function postCardHtml(meta) {
  const tags = (meta.tags || []).filter(Boolean);
  const tagHtml = (tags.length ? tags : ["随笔"])
    .map((t) => `          <span class="tag">${escapeHtml(t)}</span>`)
    .join("\n");

  const excerpt = (meta.excerpt || "").trim() || "（暂无摘要）";

  return `      <li class="post">
        <div class="post-head">
          <time datetime="${escapeHtml(meta.date)}">${formatCnDate(meta.date)}</time>
          <span class="dot" aria-hidden="true"></span>
          <span>约 ${readingTime(meta.body || "")} 分钟阅读</span>
        </div>
        <h3 class="post-title"><a href="posts/${escapeHtml(meta.file)}">${escapeHtml(meta.title)}</a></h3>
        <p class="post-excerpt">
          ${escapeHtml(excerpt)}
        </p>
        <div class="post-tags">
${tagHtml}
        </div>
        <a class="post-more" href="posts/${escapeHtml(meta.file)}">阅读全文 <span class="arrow" aria-hidden="true">&rarr;</span></a>
      </li>`;
}

/** 把卡片插到文章列表最前面，并同步两处文章数量 */
function insertCard(meta) {
  let html = read(INDEX_FILE);

  const UL = '<ul class="post-list">';
  const at = html.indexOf(UL);
  if (at < 0) throw new Error("index.html 里找不到 " + UL);
  const insertAt = at + UL.length;
  // 锚定在真正的列表标签上，不用 indexOf，避免落到注释里的同名文字上
  const after = html.slice(insertAt);
  const lead = after.startsWith("\r\n") ? "\r\n" : "\n";
  html = html.slice(0, insertAt) + lead + postCardHtml(meta) + lead + after.replace(/^(\r?\n)+/, "");

  html = syncCount(html);
  fs.writeFileSync(INDEX_FILE, html, "utf-8");
  return countCards(html);
}

/** 用最新内容替换首页上已有的那张卡片（保持位置不变）。
 *  没有这张卡片时返回 false。 */
function updateCard(meta) {
  const html = read(INDEX_FILE);
  const marked = `posts/${meta.file}`;
  let hit = null;
  for (const [s, e] of findCards(html)) {
    if (html.slice(s, e).includes(marked)) { hit = [s, e]; break; }
  }
  if (!hit) return false;
  const out = html.slice(0, hit[0]) + postCardHtml(meta).trim() + html.slice(hit[1]);
  fs.writeFileSync(INDEX_FILE, syncCount(out), "utf-8");
  return true;
}

/** 首页卡片与文章状态对齐：
 *  - 已发布：卡片不存在就插入，存在就按最新标题/日期/摘要更新（修掉「改了文章首页不更新」）
 *  - 草稿：把卡片摘掉 */
function syncCard(meta, shouldBeListed) {
  const listed = updateCard(meta);
  if (shouldBeListed) {
    if (!listed) return insertCard(meta);
    return countCards(read(INDEX_FILE));
  }
  if (listed) removeCard(meta.file);
  return countCards(read(INDEX_FILE));
}

/** 找出首页里所有文章卡片的边界（只认真正的卡片，跳过注释里的示例文字）。
 *  必须跳过注释，否则正则可能从注释里的 <li class="post"> 开始匹配，
 *  一路吃掉后面的 <ul class="post-list"> 和开头标签。 */
function findCards(html) {
  const ranges = [];
  const re = /<li class="post">/g;
  let m;
  while ((m = re.exec(html))) {
    const start = m.index;
    // 落在注释内部的匹配要忽略
    const before = html.slice(0, start);
    if (before.lastIndexOf("<!--") > before.lastIndexOf("-->")) continue;
    const end = html.indexOf("</li>", start + m[0].length);
    if (end !== -1) ranges.push([start, end + "</li>".length]);
  }
  return ranges;
}

/** 从 index.html 里摘掉指定文章的卡片（用于删除文章 / 把文章改成草稿） */
function removeCard(file) {
  const html = read(INDEX_FILE);
  const marked = `posts/${file}`;
  let hit = -1;
  for (const [s, e] of findCards(html)) {
    if (html.slice(s, e).includes(marked)) { hit = s; break; }
  }
  if (hit === -1) return false;                 // 草稿本来就不在首页
  const ranges = findCards(html);
  const [s, e] = ranges[ranges.findIndex(([a]) => a === hit)];
  // 连同卡片前面那一小段空白一起去掉，避免留一堆空行
  const from = html.slice(0, s).replace(/\s+$/, "").length;
  const out = html.slice(0, from) + html.slice(e);
  fs.writeFileSync(INDEX_FILE, syncCount(out), "utf-8");
  return true;
}

/** 下一个可用编号：同时看 posts/ 和 drafts/，保证两边不撞号 */
function nextFileNumber() {
  const nums = [];
  for (const dir of [POSTS_DIR, DRAFTS_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = /^(\d+)-/.exec(f);
      if (m) nums.push(Number(m[1]));
    }
  }
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0");
}

/** 确保 drafts/ 被 git 忽略，草稿才不会跟着 push 出去 */
function ensureDraftsIgnored() {
  let text = "";
  try { text = fs.readFileSync(GITIGNORE, "utf-8"); } catch (e) { text = ""; }
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes("drafts/") || lines.includes("/drafts/")) return false;
  const add = (text && !text.endsWith("\n") ? "\n" : "") +
    (text ? "\n" : "") +
    "# 本地草稿：只存在你自己电脑上，不 push、不部署\n" +
    "drafts/\n";
  fs.writeFileSync(GITIGNORE, text + add, "utf-8");
  return true;
}

function slugify(s) {
  const ascii = String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii.slice(0, 40);
  // 中文标题没法直接做文件名：取标题的短哈希，得到 002-a1b2c3.html 这样的稳定名字
  let h = 0;
  const t = String(s || "");
  for (let i = 0; i < t.length; i++) {
    h = (h * 31 + t.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).slice(0, 6);
}

/* ============================================================
 * git
 * ============================================================ */

function git(args, cwd) {
  return execSync("git " + args, {
    cwd: cwd || ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitStatus() {
  try {
    const branch = git("rev-parse --abbrev-ref HEAD").trim();
    const dirty = git("status --porcelain").trim();
    let ahead = "0";
    try {
      ahead = git("rev-list --count @{u}..HEAD").trim();
    } catch (e) {
      ahead = "?";
    }
    return { ok: true, branch, dirty: dirty ? dirty.split(/\r?\n/).length : 0, ahead };
  } catch (e) {
    return { ok: false, error: String((e.stderr || e.message || "").trim()) };
  }
}

/* ============================================================
 * 路由
 * ============================================================ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    /* ---------- 编辑器页面 ---------- */
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      const buf = Buffer.from(read(path.join(__dirname, "index.html")), "utf-8");
      res.writeHead(200, { "Content-Type": MIME[".html"], "Content-Length": buf.length, "Cache-Control": "no-store" });
      return res.end(buf);
    }

    /* ---------- 站点信息 ---------- */
    if (req.method === "GET" && p === "/api/info") {
      return json(res, 200, {
        root: ROOT,
        baseArticle: path.relative(ROOT, BASE_ARTICLE),
        baseExists: fs.existsSync(BASE_ARTICLE),
        draftsIgnored: !ensureDraftsIgnored(),
        git: gitStatus(),
        ...listAll(),
      });
    }

    /* ---------- 文章列表（已发布 + 草稿） ---------- */
    if (req.method === "GET" && p === "/api/posts") {
      return json(res, 200, listAll());
    }

    /* ---------- 图片列表 ---------- */
    if (req.method === "GET" && p === "/api/images") {
      const files = fs.existsSync(IMAGES_DIR)
        ? fs.readdirSync(IMAGES_DIR).filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f)).sort()
        : [];
      return json(res, 200, { images: files });
    }

    /* ---------- 上传图片（base64 JSON，避免引入 multipart 依赖） ---------- */
    if (req.method === "POST" && p === "/api/upload") {
      const body = JSON.parse((await readBody(req)).toString("utf-8"));
      const name = String(body.name || "").replace(/[^\w.\-]+/g, "_");
      const data = String(body.data || "");
      const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(data);
      if (!name || !m) return json(res, 400, { error: "缺少文件名或图片数据" });
      if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) {
        return json(res, 400, { error: "只支持 png / jpg / gif / webp / svg" });
      }
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
      const buf = Buffer.from(m[2], "base64");
      fs.writeFileSync(path.join(IMAGES_DIR, name), buf);
      return json(res, 200, {
        ok: true,
        file: name,
        webPath: "../assets/images/" + name,
        bytes: buf.length,
      });
    }

    /* ---------- 保存文章 ---------- */
    if (req.method === "POST" && p === "/api/save") {
      const b = JSON.parse((await readBody(req)).toString("utf-8"));
      const title = String(b.title || "").trim();
      const date = String(b.date || "").trim();
      const bodyHtml = String(b.body || "").trim();

      if (!title) return json(res, 400, { error: "标题不能为空" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: "日期格式应为 YYYY-MM-DD" });
      if (!bodyHtml) return json(res, 400, { error: "正文不能为空" });

      const tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(/[,，\s]+/))
        .map((s) => String(s).trim())
        .filter(Boolean);

      const existing = String(b.file || "").trim();
      const isNew = !existing;

      // target: "draft" 存草稿箱 / "post" 存为正式文章（默认 post）
      // 兼容旧的布尔字段 draft
      const asDraft = b.target ? b.target === "draft" : !!b.draft;

      const file = isNew
        ? `${nextFileNumber()}-${slugify(b.slug || title)}.html`
        : path.basename(existing);

      const meta = {
        title, date, tags,
        category: String(b.category || "").trim() || "随笔",
        excerpt: String(b.excerpt || "").trim(),
        file, body: bodyHtml,
      };

      // 允许改名（草稿转正式时保留原文件名，这里只做安全校验）
      if (!/^[\w.\-]+\.html$/i.test(file)) return json(res, 400, { error: "文件名不合法" });

      const targetDir = asDraft ? DRAFTS_DIR : POSTS_DIR;
      const otherDir = asDraft ? POSTS_DIR : DRAFTS_DIR;
      fs.mkdirSync(targetDir, { recursive: true });

      const target = path.join(targetDir, file);
      const other = path.join(otherDir, file);
      if (isNew && fs.existsSync(target)) return json(res, 409, { error: "文件已存在：" + file });

      // 写入目标位置，并在另一个目录里删掉同名文件（草稿↔正式 的“搬家”）
      fs.writeFileSync(target, renderArticle(meta, bodyHtml), "utf-8");
      if (fs.existsSync(other)) fs.unlinkSync(other);

      // 首页卡片与状态对齐：正式文章要有卡片（没有就插、有就更新），草稿则摘掉卡片
      const total = syncCard(meta, !asDraft);

      return json(res, 200, {
        ok: true, file, isNew,
        where: asDraft ? "drafts" : "posts",
        path: (asDraft ? "drafts/" : "posts/") + file,
        draft: asDraft,
        totalPosts: total,
      });
    }

    /* ---------- 读取单篇（文章或草稿，用于编辑） ---------- */
    if (req.method === "GET" && p === "/api/read") {
      const raw = String(url.searchParams.get("file") || "").trim();
      if (!raw || raw !== path.basename(raw) || /[\\/]/.test(raw) || raw.includes("..")) {
        return json(res, 400, { error: "文件名不合法（不允许路径）" });
      }
      const where = url.searchParams.get("where") === "drafts" ? "drafts" : "posts";
      const dir = where === "drafts" ? DRAFTS_DIR : POSTS_DIR;
      const target = path.join(dir, raw);
      if (!fs.existsSync(target)) return json(res, 404, { error: "找不到文件：" + raw });
      const t = read(target);
      const title = (/<h1 class="post-title">([\s\S]*?)<\/h1>/.exec(t) || [, ""])[1].trim();
      const date = (/<time datetime="([^"]+)"/.exec(t) || [, ""])[1];
      const tags = [...t.matchAll(/<span class="tag">([\s\S]*?)<\/span>/g)].map((m) => m[1].trim());
      const body = (/<div class="article">([\s\S]*?)<!-- ★ 正文结束 ★ -->/.exec(t) || [, ""])[1].trim();
      const catNav = (/<nav class="crumbs"[\s\S]*?<\/nav>/.exec(t) || [""])[0];
      const category = (catNav.match(/<span>([\s\S]*?)<\/span>\s*<\/nav>/) || [, "随笔"])[1].trim();
      return json(res, 200, {
        file: raw, where,
        isDraft: where === "drafts",
        title, date,
        tags: [...new Set(tags)].slice(0, 6),
        category: category || "随笔",
        body,
      });
    }

    /* ---------- 删除文章 / 草稿 ---------- */
    if (req.method === "POST" && p === "/api/delete") {
      const b = JSON.parse((await readBody(req)).toString("utf-8"));
      const raw = String(b.file || "").trim();
      // 关键：含分隔符或 .. 的输入一律拒绝。
      // 不能只靠 path.basename —— 它会把 "../../posts/001-static-blog.html"
      // 悄悄变成 "001-static-blog.html"，等于放行了穿越请求。
      if (!raw || raw !== path.basename(raw) || /[\\/]/.test(raw) || raw.includes("..")) {
        return json(res, 400, { error: "文件名不合法（不允许路径）" });
      }
      if (!/^[\w.\-]+\.html$/i.test(raw)) {
        return json(res, 400, { error: "文件名不合法" });
      }
      const file = raw;
      const where = b.where === "drafts" ? "drafts" : "posts";
      const dir = where === "drafts" ? DRAFTS_DIR : POSTS_DIR;
      const target = path.join(dir, file);
      if (!fs.existsSync(target)) {
        return json(res, 404, { error: (where === "drafts" ? "草稿" : "文章") + "不存在：" + file });
      }

      const removedTitle = (/<h1 class="post-title">([\s\S]*?)<\/h1>/.exec(read(target)) || [, ""])[1].trim();

      // 只有已发布的文章才需要摘首页卡片
      const hadCard = where === "posts" ? removeCard(file) : false;
      fs.unlinkSync(target);
      const total = countCards(read(INDEX_FILE));

      return json(res, 200, {
        ok: true,
        file, where,
        title: removedTitle,
        cardRemoved: hadCard,   // 草稿本来就不在首页，这里是 false 属正常
        totalPosts: total,
      });
    }

    /* ---------- 发布（git add / commit / push） ---------- */
    if (req.method === "POST" && p === "/api/publish") {
      const b = JSON.parse((await readBody(req)).toString("utf-8"));
      const msg = String(b.message || "").trim() || "update: 发布新文章";
      const out = [];
      try {
        out.push(git("add -A"));
        let committed = false;
        try {
          out.push(git(`commit -m "${msg.replace(/"/g, '\\"')}"`));
          committed = true;
        } catch (e) {
          const txt = String((e.stdout || "") + (e.stderr || ""));
          if (/nothing to commit|无文件要提交|无更改/.test(txt)) out.push("（没有需要提交的改动）");
          else throw e;
        }
        out.push(git("push"));
        return json(res, 200, {
          ok: true, committed,
          output: out.filter(Boolean).join("\n"),
          git: gitStatus(),
        });
      } catch (e) {
        return json(res, 500, {
          error: "发布失败",
          output: [out.filter(Boolean).join("\n"), String((e.stdout || "") + (e.stderr || e.message || ""))]
            .filter(Boolean).join("\n"),
        });
      }
    }

    /* ---------- 静态资源（编辑器里预览图片用） ---------- */
    if (req.method === "GET" && p.startsWith("/assets/")) {
      const target = path.join(ROOT, decodeURIComponent(p.replace(/^\/+/, "")));
      if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        return res.end("not found");
      }
      const buf = fs.readFileSync(target);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Content-Length": buf.length,
      });
      return res.end(buf);
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404");
  } catch (err) {
    json(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, HOST, () => {
  const line = "=".repeat(58);
  // 启动就确保 drafts/ 被 git 忽略，避免草稿被误 push
  let addedIgnore = false;
  try { addedIgnore = ensureDraftsIgnored(); } catch (e) {}
  try { fs.mkdirSync(DRAFTS_DIR, { recursive: true }); } catch (e) {}

  console.log(line);
  console.log("  verniy 博客本地发布器已启动");
  console.log(line);
  console.log("  编辑器地址 : http://" + HOST + ":" + PORT);
  console.log("  站点根目录 : " + ROOT);
  console.log("  已发布目录 : posts/");
  console.log("  草稿箱目录 : drafts/   (已在 .gitignore 中，不会被推送部署)");
  console.log("  样式来源   : " + path.relative(ROOT, BASE_ARTICLE) +
    (fs.existsSync(BASE_ARTICLE) ? "" : "   ← 文件不存在！"));
  if (addedIgnore) console.log("  注意：刚刚把 drafts/ 写进了 .gitignore，记得提交这个改动");
  console.log(line);
  console.log("  按 Ctrl+C 停止");
  console.log("");
});
