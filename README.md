# verniy 的个人博客（静态站）

三个主页面 + 若干文章页，纯手写 HTML + 内嵌 CSS/JS，**不依赖任何外部框架、字体或
CDN**。直接双击 `index.html` 就能在浏览器里打开，也可以整个文件夹上传到
GitHub Pages、Netlify、Vercel、对象存储等任何静态托管服务。

## 文件结构

```
blog/
├─ index.html                    主页（文章列表 + 顶部“关于我/联系我”+ 右上角播放/暂停）
├─ about.html                    关于我（圆形头像 + 名字 verniy + 可自由编辑的简介）
├─ contact.html                  联系我（邮箱 3627226346@qq.com）
├─ README.md                     本说明文件
├─ start-publisher.cmd           本地发布器：双击启动，在网页里写文章并一键发布
├─ tools/publisher/              发布器本体（零依赖，只用 Node 内置模块）
├─ posts/
│  └─ 001-static-blog.html       文章页（也是发布器生成新文章时的样式基准）
└─ assets/
   ├─ avatar.jpg                 头像原图（只在圆形区域中显示）
   ├─ bgm.mp3                    背景音乐：KennyMccormite - 歌唱动荡的青春（纯钢琴 F）
   └─ images/                    发布器上传的插图（用到时才会出现）
```

## 写文章：用本地发布器（推荐）

双击 `start-publisher.cmd`，浏览器会自动打开 `http://127.0.0.1:3721`：

1. 填标题、日期、分类、标签、首页摘要，写正文（支持 Markdown 或 HTML）
2. 点 **保存文章** —— 生成文章页 + 自动把卡片插到首页最前 + 文章数量自动同步
3. 点 **发布到线上** —— 自动 `git commit` + `git push`，Cloudflare 约 1 分钟后部署完成

关掉那个黑窗口就是停止服务。发布器不会改动已有文章的内容，只做新增/更新。

**删除文章**：在左侧点开要删的那篇（或先点「写新文章」以外的任意一篇），
底部会出现 **删除这篇** 按钮，点它并确认即可 —— 会同时删掉文章页和首页上的卡片，
文章数量自动同步。删完记得点「发布到线上」才算真正生效。

> 删除只影响本地文件，推送前都能从 git 历史里找回（`git checkout -- posts/xxx.html`）；
> 推送之后就得到 GitHub 的提交历史里恢复了。所以放心删，但确认框别乱点。

> 需要 Node.js。若系统里没装，脚本会自动改用本机已有的 Node；
> 都没有的话按提示 `winget install OpenJS.NodeJS.LTS` 装一个即可。

> **移动文件时请把整个 `blog` 文件夹一起移动**，不要只拿单个 html 文件，
> 否则头像、音乐和页面之间的跳转会失效（文章页在 `posts/` 子目录里，
> 用的是 `../assets/...` 这样的相对路径）。

## 怎么改内容

| 想改什么 | 打开哪个文件 | 找什么 |
| --- | --- | --- |
| 发一篇新文章 | 见下一节 | — |
| 主页顶部那句自我介绍 | `index.html` | `class="hero-sub"` 那一段 |
| 文章总数 / 最后更新时间 | `index.html` | `class="hero-meta"` 里的文字 |
| 头像 | 替换 `assets/avatar.jpg`（建议正方形图片，会自动裁成圆形） | — |
| 名字 | `about.html` | `<h1 class="profile-name">verniy</h1>` |
| 简介文字 | `about.html` | `<div class="bio">…</div>` 里的段落，**随便改、随便加** |
| 资料卡（昵称/邮箱/在做什么） | `about.html` | `<dl class="facts">` 那一块；不想要就整块删掉 |
| 邮箱地址 | `contact.html` | 出现在 3 个地方：`mailto:` 链接、`data-mail` 属性、页面文字，建议一起改 |
| 背景音乐 | 替换 `assets/bgm.mp3` | — |
| 配色 | 每个文件 `<style>` 最上方的 `:root` | `--blue: #4A90D9`、`--bg`、`--text` 等 |

## 怎么发一篇新文章

以现有的 `posts/001-static-blog.html` 为模板，三步：

1. **复制文章页**：把 `posts/001-static-blog.html` 复制一份，
   改名成 `posts/002-color-notes.html`（序号开头，方便排序）。
2. **改文章内容**：在新文件里改 `<title>`、面包屑、`.post-tags`、`.post-title`、
   `.post-meta` 里的日期，然后替换 `<div class="article">…</div>` 之间的正文。
   正文里可以直接用 `<h2>` 小标题、`<pre><code>` 代码块、`<blockquote>` 引用、
   `<ul>/<ol>` 列表，样式都已经写好了。
3. **在主页加入口**：打开 `index.html`，复制任意一个 `<li class="post">…</li>` 整块，
   改日期、标题、摘要、标签，并把**标题链接和「阅读全文」链接**都指向新文件：

```html
<h3 class="post-title"><a href="posts/002-color-notes.html">文章标题</a></h3>
...
<a class="post-more" href="posts/002-color-notes.html">阅读全文 <span class="arrow">&rarr;</span></a>
```

> 两个 `href` 要**一起改**，只改一个的话另一个点进去还是没反应。
> 文章还没写好时，先把它们留成 `href="#"`，页面就不会报 404。

文章页底部的「上一篇 / 下一篇」目前是禁用状态的 `<span>`，
写了对应文章后把它换成 `<a href="002-color-notes.html">…</a>` 即可。

## 背景音乐说明

- **默认关闭**，符合「打开网页不会突然出声」的预期。
- 右上角有 **播放 / 暂停** 两个按钮，三个页面都有。
- **切页面时会从上次的位置接着播**：播放状态和进度存在 `localStorage`
  （键名 `verniy.bgm.state.v1`，另有心跳键 `verniy.bgm.tick.v1`），
  新页面加载后读回来并跳回同一秒。暂停后切页，新页面也停在那一秒。
- 按 **空格键** 也可以播放 / 暂停。
- 说明：静态网页每次跳转都是重新加载，音频本身无法真正"不断"延续，
  所以实现的准确说法是"回到同一首歌的同一秒"。
- 部分浏览器会拦截新页面的自动播放。此时顶部会出现一行提示，
  点一下「播放」即可从上次的位置继续（不会从头开始）。
- 如果不想让音乐跨页面续播，把每个页面 `<script>` 里 `KEY` / `TICK`
  与 `saveState` / `seekTo` 相关的部分删掉即可。

## 兼容性 / 适配

- 手机、平板、电脑均适配，采用 `viewport` + 媒体查询（560px / 760px / 1024px 断点）。
- 已在 Chromium 内核浏览器（Edge / Chrome）360 / 390 / 414 / 504 / 768 / 1024 /
  1440px 七种宽度下实测：无横向溢出，顶栏两侧按钮始终在视口内。
- 使用系统自带字体栈，中文显示不需要联网加载字体。
- 支持键盘 Tab 聚焦（含 `:focus-visible` 焦点样式）和 `prefers-reduced-motion`。
- 若用本地 HTTP 服务预览音频，请确保服务支持 **HTTP Range** 请求，
  否则浏览器无法定位播放进度（`file://` 打开不受此影响）。
