// 这个页面的设计系统。
//
// 取向来自 ui-ux-pro-max 的 "Dark Mode (OLED) · Code dark + run green"：
// 深色底 + 绿色只留给"要跑起来"的那一个动作。这不是审美偏好 ——
// 这是一个会**花真钱**的调试台，绿色在整页里稀缺，才能让人看见它。
//
// # 2026-09-03 重构：把页面收成一个交易台
//
// 从前是五张等宽的卡片竖着排，每张顶着三到五段解释 —— 交易那张（唯一每天
// 都要用的）被推到第二屏，而它上下都是只需要读一次的话。现在：
//
//   · 只读一次的状态（后端自检、身份、JWT、余额）收成顶栏的**状态芯片**，
//     点开才展开抽屉 —— 它们回答"能不能开始"，回答完就该让位；
//   · 只读一次的解释收进 <Info>（`.doc`），摊开的只剩当下要看的那句；
//   · 交易表单 + 结果 + 日志摆成两栏，跑一笔时三者同屏，不用来回滚。
//
// **一个字都没删。** 收进抽屉与折叠块的内容原样还在 —— 这些解释每一段都
// 对应一次真实的误诊，删掉等于把踩过的坑重新埋上。
//
// # 为什么是注入的 <style> 而不是内联 style 对象
//
// 内联对象写不了 hover / focus-visible / media query / prefers-reduced-motion，
// 而这四样恰恰是可访问性清单上的硬要求。用 class 名 + 一份全局 CSS 才够得着，
// 且不引入任何依赖（这个 harness 不值得为样式装一个 CSS-in-JS）。

import {useEffect, useRef, useState, type ReactNode} from 'react';

/** 设计 tokens。改配色只改这一处 —— 组件里不写字面色值。 */
//
// **迁移改造（原仓库是 `:root`）**：这份 CSS 从前挂在 `:root` 与 `body` 上，
// 而宿主 `app/src/app/globals.css` 在 `:root` 上定义**同名**的 `--accent` /
// `--bg` / `--border` / `--muted`，且 Tailwind 的 `@theme inline` 是在**使用处**
// 解 `var(--border)` 的 —— 两份 token 撞在同一个 `:root` 上时，产品页的
// 紫色强调色会被 harness 的绿色顶掉（而绿色在这里是**语义**：全站只有
// 「花真钱」那一个动作是绿的，见本文件头）。
//
// 所以作用域收到 `.harness-root`（挂在 `(harness)/layout.tsx` 的容器上）。
// 一起收的还有另外四条本来是全局的选择器：`*`、`body`、`code, pre, …`、
// `:focus-visible`，以及 prefers-reduced-motion 那条里的 `*`。
// 其余全部是 class 选择器，原样未动。
const CSS = `
.harness-root {
  /* 底色比从前更沉（#0F172A → #080C18）：多出来的那一档明度差是给顶栏用的
     —— 一个半透明的吸顶条要浮在内容之上，底与卡片同色时它看起来像塌进去了。 */
  --bg: #080C18;
  --bg-2: #0B1120;
  --card: #10162A;
  --card-2: #161E33;
  --muted: #1B2338;
  --muted-fg: #93A2BC;
  --dim: #6B7A94;
  --fg: #F1F5F9;
  --border: #232C44;
  --border-2: #35415E;
  --accent: #22C55E;
  --accent-2: #16A34A;
  --on-accent: #06210F;
  --danger: #F05252;
  --warn: #F59E0B;
  --info: #38BDF8;

  /* density 9/10：dashboard 尺度，4–32px */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
  --r: 10px; --r-s: 6px;
  --topbar-h: 52px;
  --w: 1400px;

  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --sans: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.harness-root, .harness-root * { box-sizing: border-box; }

.harness-root {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  /* 正文 15px。低于 12px 是清单上的红线，这里连次要文字都停在 12。 */
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.harness-root code, .harness-root pre, .harness-root .mono, .harness-root input, .harness-root textarea, .harness-root select { font-family: var(--mono); }

/* 焦点环**绝不移除**：键盘用户全靠它。用 :focus-visible 让鼠标点击不显示，
   键盘 Tab 才显示 —— 既满足可访问性，又不打扰鼠标操作。 */
.harness-root :focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

/* ---------- 顶栏 ---------- */
/* 吸顶。**它是"能不能开始"的唯一答案位**：后端通不通、登没登、JWT 还剩多久、
   钱包里有多少 USDC —— 这四件事从前各占一整张卡片，而它们每天只读一次。
   收成芯片之后，它们仍然一直在场（滚到页面底部也看得见），却不再占版面。 */
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap;
  min-height: var(--topbar-h);
  padding: var(--s2) var(--s4);
  background: rgba(8, 12, 24, 0.88);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: var(--s2); font-size: 14px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.brand .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px rgba(34,197,94,0.7); flex: none; }
.chips { display: flex; align-items: center; gap: var(--s1); flex-wrap: wrap; }
.push { margin-left: auto; }

/* 状态芯片。**可点的那些是抽屉的开关**，不是装饰徽章 —— 所以给足 hover 与
   cursor，并且用 aria-expanded 把"点开会展开一块东西"讲给读屏听。 */
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 30px; padding: 0 10px;
  border: 1px solid var(--border-2); border-radius: 999px;
  background: var(--card); color: var(--muted-fg);
  font-family: var(--sans); font-size: 12px; font-weight: 500;
  white-space: nowrap;
}
button.chip { cursor: pointer; transition: background 160ms ease, border-color 160ms ease, color 160ms ease; }
button.chip:hover:not(:disabled) { background: var(--card-2); border-color: var(--border-2); color: var(--fg); }
button.chip:disabled { opacity: 0.5; cursor: not-allowed; }
/* 展开态：只换底与描边，**不换颜色** —— 描边取 currentColor（也就是这枚芯片
   自己的语气色）。从前这里写死了绿色，于是一枚"未登录"的芯片被点开后镶上
   绿边，看起来像"已登录"。 */
button.chip[aria-expanded="true"] { background: var(--card-2); border-color: currentColor; }
.chip .led { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.chip .v { color: var(--fg); font-family: var(--mono); }
.chip.ok { color: var(--accent); }
.chip.err { color: var(--danger); }
.chip.warn { color: var(--warn); }
.chip.live { color: var(--info); }
.chip.off { color: var(--muted-fg); }
/* 触摸设备上补到 44：桌面上 30px 的芯片够用，手指不够。 */
@media (pointer: coarse) { .chip { min-height: 44px; padding: 0 14px; } }

/* 分段控件。tab 与 buy/sell 共用一套 —— 两者都是"在几个互斥项里选一个"。 */
.seg { display: inline-flex; gap: 2px; padding: 3px; background: var(--muted); border: 1px solid var(--border); border-radius: 8px; }
.seg button {
  min-height: 32px; padding: 0 14px;
  border: 0; border-radius: var(--r-s); background: transparent;
  color: var(--muted-fg); font-family: var(--sans); font-size: 13px; font-weight: 500;
  cursor: pointer; transition: background 160ms ease, color 160ms ease;
  white-space: nowrap;
}
.seg button:hover:not([aria-selected="true"]) { color: var(--fg); }
/* 配不全的那一档**禁用而不是隐藏**：消失了的开关与"这个版本没这功能"分不开，
   而禁用 + title 里写着缺哪个变量，是能直接照着做的。 */
.seg button:disabled { opacity: 0.42; cursor: not-allowed; }
.seg button:disabled:hover { color: var(--muted-fg); }
.seg button[aria-selected="true"] { background: var(--card-2); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
/* 买卖两档**各自上色**：这是整页唯一一处"选错了会亏钱"的开关，而它在
   静默签名之后没有第二次确认。绿=买、红=卖，和下面「将要执行」那条同色。 */
.seg button[aria-selected="true"][data-k="buy"] { background: rgba(34,197,94,0.16); color: var(--accent); }
.seg button[aria-selected="true"][data-k="sell"] { background: rgba(240,82,82,0.16); color: var(--danger); }
/* 环境开关。**非默认档选中时是橙的**（和"注意"同色）—— 这一页会花真钱，
   而"我现在打的是哪个后端"必须在下单之前一眼看得到，不能靠去读一行小字。
   默认档不上色：常态不该一直在报警，否则真正该警觉的那一档就不显眼了。 */
.envsw { display: inline-flex; align-items: center; gap: var(--s2); }
.envsw .k { color: var(--muted-fg); font-size: 12px; white-space: nowrap; }
.envsw .seg button { min-height: 28px; padding: 0 10px; font-size: 12px; }
.seg button[aria-selected="true"][data-k="env-test"] { background: rgba(245,158,11,0.18); color: var(--warn); }
@media (pointer: coarse) { .envsw .seg button { min-height: 44px; } }

.seg.grow { display: flex; }
.seg.grow button { flex: 1; }
@media (pointer: coarse) { .seg button { min-height: 44px; } }

/* ---------- 浮层（登录 / 个人信息）---------- */
/* 从顶栏那枚芯片底下掉下来的一块面板，**不是横贯整宽的抽屉**。
   抽屉那版把下面的整页往下推了半屏 —— 而登录和看一眼自己的地址都是
   "办完就走"的事，页面不该为它们改变布局。浮层办完就收，底下一动不动。

   带一层压暗的背景：这两件事都要人**读一眼再动手**（验证码、地址），
   而一块不压暗的浮层会和底下的表单糊在一起。点背景即关闭。 */
.pop-back {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(4, 7, 16, 0.62);
  animation: fade 160ms ease;
}
.pop {
  position: fixed; z-index: 61;
  top: calc(var(--topbar-h) + 6px); right: var(--s4);
  width: min(440px, calc(100vw - var(--s5)));
  max-height: calc(100dvh - var(--topbar-h) - var(--s5));
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--border-2); border-radius: var(--r);
  box-shadow: 0 28px 64px -24px rgba(0, 0, 0, 0.85);
  padding: var(--s4);
  animation: drop 160ms ease;
}
/* 窄屏上贴着两边铺开：440px 的浮层在 375 的屏上会被切掉一角。 */
@media (max-width: 520px) {
  .pop { left: var(--s2); right: var(--s2); width: auto; }
}
/* 打开时焦点落在面板本身（好让 Escape 与 Tab 从这里开始）。它不是一个可操作
   的控件，那圈绿框只会被当成"这块面板被选中了"，所以**只压掉容器自己的**——
   里面每一个按钮、输入框的焦点环一个都没动。 */
.pop:focus { outline: none; }
.pop-hd { display: flex; align-items: center; gap: var(--s2); margin: 0 0 var(--s3); }
.pop-hd h2 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
.pop-hd .x { margin-left: auto; }
.pop h3 {
  margin: var(--s4) 0 var(--s2);
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.09em; color: var(--dim);
}
.pop h3:first-of-type { margin-top: 0; }
.pop .kv { align-items: flex-start; }
.pop .kv > .k { min-width: 74px; padding-top: 3px; }
/* 分隔"或"：两条登录路子之间。 */
.or { display: flex; align-items: center; gap: var(--s3); margin: var(--s3) 0; color: var(--dim); font-size: 11px; }
.or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--border); }
@keyframes drop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }

/* ---------- 版心与两栏 ---------- */
.page { max-width: var(--w); margin: 0 auto; padding: var(--s4); }
.cols { display: grid; gap: var(--s4); grid-template-columns: minmax(0, 1fr); align-items: start; }
/* 1024 起分两栏（清单点名的四档之一）：左边是**做事**的（下单、持仓），右边是**看结果**的
   （回包、日志）。跑一笔时三者同屏 —— 从前它们竖着排，广播之后要往下滚
   两屏才看得到日志，而那正是最需要盯着它的十几秒。 */
@media (min-width: 1024px) {
  .cols { grid-template-columns: minmax(0, 1fr) minmax(340px, 380px); }
  .rail { position: sticky; top: calc(var(--topbar-h) + var(--s4)); max-height: calc(100dvh - var(--topbar-h) - var(--s5)); overflow-y: auto; }
}
.rail > .card:last-child { margin-bottom: 0; }
/* 单栏的那一页（X 绑定）收窄。整幅 1400px 摊开时一行文字有一百多个字符，
   而人眼一行读到七八十个就开始丢行 —— 两栏那边靠栏宽自然挡住了，这里没有
   第二栏，只能自己收。 */
.narrow { max-width: 980px; }

/* ---------- 卡片 ---------- */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: var(--s4);
  margin-bottom: var(--s4);
}
.card > h2 {
  /* 换行：标题右侧那格在窄屏上放不下时要掉到第二行，而不是把标题挤没。 */
  display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap;
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.09em; color: var(--muted-fg);
  margin: 0 0 var(--s3);
}
.card > h2 .n {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 4px;
  background: var(--muted); color: var(--fg);
  font-family: var(--mono); font-size: 11px; letter-spacing: 0;
}
/* 标题右侧的位置：这一块的动作与计数摆这里，而不是另起一行 ——
   另起一行的按钮会和内容里的按钮混成一片，分不清哪个作用于整块。 */
.card > h2 .right { margin-left: auto; display: flex; align-items: center; gap: var(--s2); text-transform: none; letter-spacing: 0; font-weight: 400; }
/* 强调卡：下单那张。绿色只在这里镶一道边 —— 整页别处不用。 */
.card.hero {
  border-color: rgba(34, 197, 94, 0.30);
  box-shadow: 0 0 0 1px rgba(34,197,94,0.05), 0 16px 40px -28px rgba(34,197,94,0.65);
}

/* 花真钱那条警告：整页唯一的琥珀色，用左边框而不是整块填充 ——
   填充色块看久了会被当成装饰，边框+底色更像"标注"。 */
.alert {
  display: flex; gap: var(--s3); align-items: flex-start;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-left: 3px solid var(--warn);
  border-radius: var(--r-s);
  padding: var(--s2) var(--s3);
  margin-bottom: var(--s4);
  font-size: 13px;
}
.alert svg { flex: none; margin-top: 2px; color: var(--warn); }
/* 同一块"标注"的另外三种语气。**颜色是唯一的区分手段时不够** ——
   每一块里都写着它是什么（"没到信封层" / "通过" / …），颜色只是加速。 */
.alert.err { background: rgba(240, 82, 82, 0.08); border-color: rgba(240, 82, 82, 0.35); border-left-color: var(--danger); }
.alert.err svg { color: var(--danger); }
.alert.ok { background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.35); border-left-color: var(--accent); }
.alert.ok svg { color: var(--accent); }
.alert.info { background: rgba(56, 189, 248, 0.08); border-color: rgba(56, 189, 248, 0.35); border-left-color: var(--info); }
.alert.info svg { color: var(--info); }
.alert.tight { margin: var(--s2) 0; }

.row { display: flex; gap: var(--s2); align-items: center; flex-wrap: wrap; margin: var(--s2) 0; }
.row.tight { margin: 0; }
.hint { color: var(--muted-fg); font-size: 13px; margin: 0 0 var(--s3); }
.hint.tight { margin: 0; }
.bad { color: var(--danger); font-size: 13px; }
.sep { height: 1px; background: var(--border); margin: var(--s4) 0; border: 0; }

/* ---------- 折叠的说明 ---------- */
/* **摊开的字越少，剩下的那句越有人读。** 这个 harness 的每一段解释都对应
   一次真实的误诊，所以一个字都不删 —— 但也不能全摊在版面上：从前一张卡
   顶着五段字，人的实际做法是整块跳过，于是那五段等于没写。
   收进这里之后，它们变成"撞上了再点开"的东西，而那正是它们被需要的时刻。 */
.doc { margin-top: var(--s3); }
.doc > summary {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 28px; list-style: none; cursor: pointer;
  font-size: 12px; color: var(--dim);
  transition: color 160ms ease;
}
.doc > summary::-webkit-details-marker { display: none; }
.doc > summary::before { content: '▸'; display: inline-block; transition: transform 160ms ease; }
.doc[open] > summary::before { transform: rotate(90deg); }
.doc > summary:hover { color: var(--muted-fg); }
.doc[open] > summary { color: var(--muted-fg); margin-bottom: var(--s2); }
.doc .body { border-left: 2px solid var(--border); padding-left: var(--s3); }
.doc .body > *:last-child { margin-bottom: 0; }

/* ---------- 按钮 ---------- */
/* 最小 44×44 触摸目标是清单上的硬要求（Touch & Interaction，CRITICAL）。
   桌面上视觉高度可以小一些，指针是 coarse 时一律补到 44。 */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--s2);
  min-height: 36px; padding: 0 var(--s3);
  font-family: var(--sans); font-size: 13px; font-weight: 500;
  color: var(--fg); background: var(--muted);
  border: 1px solid var(--border-2); border-radius: var(--r-s);
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, transform 120ms ease;
}
.btn:hover:not(:disabled) { background: var(--card-2); border-color: #4A5878; }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.primary {
  min-height: 48px; padding: 0 var(--s5);
  font-size: 15px; font-weight: 600;
  background: var(--accent); color: var(--on-accent);
  border-color: var(--accent);
}
.btn.primary:hover:not(:disabled) { background: var(--accent-2); border-color: var(--accent-2); }
/* 卖出那一笔的主按钮换成红的：颜色跟着**这一次要做的事**走，不跟着
   "这是主按钮"走 —— 一个绿色的卖出按钮和一个绿色的买入按钮长得一样。 */
.btn.primary.sell { background: var(--danger); border-color: var(--danger); color: #1A0505; }
.btn.primary.sell:hover:not(:disabled) { background: #DC2626; border-color: #DC2626; }
.btn.ghost { background: transparent; }
.btn.sm { min-height: 30px; padding: 0 10px; font-size: 12px; }
.btn.wide { width: 100%; }
/* 主按钮 + 副按钮同处一行时的分宽：副按钮（预估）占 1 份，主按钮占 2 份。
   主按钮不要再挂 .wide —— width:100% 在 flex 行里会让它自己占满一整行、
   把副按钮挤到上一行去，比例就无从谈起。宽度交给 flex 比例，高度一起对齐
   到主按钮的 48，否则一行里两颗按钮一高一低。
   basis 是下限：栏子窄到放不下两颗时各自换行铺满，而不是挤成两条竖条。 */
.row.actions > .btn { flex: 1 1 120px; min-height: 48px; }
.row.actions > .btn.primary { flex: 2 1 200px; }
@media (pointer: coarse) { .btn { min-height: 44px; } .btn.sm { min-height: 40px; } }

/* ---------- 输入 ---------- */
.inp {
  flex: 1; min-width: 0; min-height: 38px;
  padding: 0 var(--s3);
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border-2); border-radius: var(--r-s);
  font-size: 13px;
  transition: border-color 180ms ease;
}
.inp:hover { border-color: #4A5878; }
.inp:focus { border-color: var(--accent); }
textarea.inp { padding: var(--s2) var(--s3); min-height: 64px; line-height: 1.5; resize: vertical; }
select.inp { cursor: pointer; }
/* 占位符也要够对比：默认的浅灰在深色底上常低于 4.5:1。 */
.harness-root ::placeholder { color: var(--dim); opacity: 1; }

/* 表单：标签在控件**上面**，不在左边。左标签那版要给标签留 190px 的固定列，
   于是在 400px 宽的栏里输入框只剩一半；而这些值（合约地址、20 位的整数）
   恰恰是最需要宽度的东西。 */
.form { display: grid; gap: var(--s3); }
.f { display: grid; gap: 5px; min-width: 0; }
.f > label { font-size: 12px; color: var(--muted-fg); display: flex; align-items: baseline; gap: var(--s2); }
.f > label .u { color: var(--dim); font-size: 11px; font-family: var(--mono); }
.f .with { display: flex; gap: var(--s2); align-items: center; }
.f2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
.f3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: var(--s3); }
@media (max-width: 560px) { .f2, .f3 { grid-template-columns: 1fr; } }

/* 旧的左标签行（XBindPage 与错误面板还在用）。 */
.field { display: flex; gap: var(--s3); align-items: center; margin: var(--s2) 0; flex-wrap: wrap; }
.field > label { min-width: 170px; font-size: 13px; color: var(--muted-fg); font-family: var(--sans); }
@media (max-width: 640px) {
  .field { flex-direction: column; align-items: stretch; gap: var(--s1); }
  .field > label { min-width: 0; }
}

/* ---------- 将要执行 ---------- */
/* 点下去之前唯一一次"你在做什么" —— 静默签名把 Privy 那个会把金额摆到眼前的
   确认界面拿掉了，而不可逆操作按准则必须让人在点之前知道自己在做什么。
   所以它紧贴主按钮，中间不放任何别的东西。 */
.review {
  display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap;
  padding: var(--s3);
  border: 1px solid rgba(34,197,94,0.25); border-radius: var(--r-s);
  background: linear-gradient(90deg, rgba(34,197,94,0.10), rgba(34,197,94,0.02));
  font-size: 13px;
}
.review.sell { border-color: rgba(240,82,82,0.25); background: linear-gradient(90deg, rgba(240,82,82,0.10), rgba(240,82,82,0.02)); }
.review .lead { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted-fg); }
.review .dir { font-weight: 700; color: var(--accent); }
.review.sell .dir { color: var(--danger); }
.review .amt { font-family: var(--mono); font-size: 14px; font-weight: 600; }

/* ---------- 小组件 ---------- */
.code {
  font-size: 12px; padding: 2px 6px; border-radius: 4px;
  background: var(--muted); color: var(--fg);
  word-break: break-all;
}
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  padding: 3px 8px; border-radius: 999px;
  border: 1px solid currentColor;
}
.badge.ok { color: var(--accent); }
.badge.off { color: var(--muted-fg); }
.badge.err { color: var(--danger); }
.badge.warn { color: var(--warn); }
.badge.live { color: var(--info); }
.badge.run { color: var(--warn); }

.kv { display: flex; gap: var(--s2); align-items: center; margin: var(--s2) 0; font-size: 13px; flex-wrap: wrap; }
.kv > .k { color: var(--muted-fg); min-width: 92px; }

/* ---------- 表格 ---------- */
/* 仓位用表格而不是一行一张卡：**同一列的数才比得起来**。摊成卡片时
   「哪个币亏得最多」要靠人一张张读，而那正是这一屏唯一要回答的问题。
   代价是列多了会横向溢出，所以表格各自横滚，**绝不让整页横滚**。 */
.tblwrap { overflow-x: auto; margin: var(--s2) 0; border: 1px solid var(--border); border-radius: var(--r-s); }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.5; }
.tbl th, .tbl td {
  text-align: left; vertical-align: top;
  padding: var(--s2) var(--s3);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tbl tbody tr:last-child td { border-bottom: 0; }
.tbl thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--card-2);
  font-weight: 600; font-size: 11px; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--muted-fg);
}
/* 表头第二行小字写单位。**单位不能只写在注释里**：份额与计价资产两组数
   在页面上长得一模一样，混着看会得到一个没有单位的数，而那个数会被当成钱。 */
.tbl thead .u { display: block; font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--dim); }
.tbl tbody tr:hover { background: rgba(148, 163, 184, 0.05); }
.tbl .sub { display: block; color: var(--muted-fg); }
.tbl .sub b { color: var(--dim); font-weight: 600; }
/* 清过仓的那几行压暗：它们是历史记录，不是这一屏要操作的东西。 */
.tbl tr.dim td { opacity: 0.55; }
.tbl td.num { font-family: var(--mono); }
.tbl .neg { color: var(--danger); }
.tbl .pos { color: var(--accent); }

/* ---------- 日志 ---------- */
.log {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-s);
  padding: var(--s2) var(--s3); max-height: 420px; overflow-y: auto;
  font-family: var(--mono); font-size: 12px; line-height: 1.7;
}
.log .ln { display: flex; gap: var(--s3); padding: 2px 0; }
.log .at { color: var(--dim); flex: none; }
.log .tx { white-space: pre-wrap; word-break: break-word; }
.log .ln.bad .tx { color: var(--danger); }
.log .empty { color: var(--muted-fg); font-style: italic; }

pre.block {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-s);
  padding: var(--s3); overflow-x: auto;
  font-size: 12px; line-height: 1.6; margin: var(--s2) 0 0;
  white-space: pre-wrap; word-break: break-all;
}

/* ---------- 响应式 ---------- */
/* 375 / 768 / 1024 / 1440 是清单点名的四档。窄屏下按钮撑满，输入不缩 ——
   挤扁的输入框看得见却填不进东西。 */
@media (max-width: 640px) {
  .page { padding: var(--s3); }
  .topbar { padding: var(--s2) var(--s3); }
  .drawer-in { padding: var(--s3); }
  .push { margin-left: 0; }
  .steps { flex-wrap: wrap; }
  .step { flex-basis: calc(50% - var(--s1)); }
}

/* 动效一律可关。这条不是锦上添花：前庭功能障碍的用户会因动画而眩晕。 */
@media (prefers-reduced-motion: reduce) {
  .harness-root *, .harness-root *::before, .harness-root *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

export function GlobalStyles() {
  return <style>{CSS}</style>;
}

// ---------------------------------------------------------------------------
// 图标
// ---------------------------------------------------------------------------
//
// **内联 SVG，不用 emoji。** emoji 当图标有三个问题：跨平台字形不一致
// （同一个 ⚡ 在 Windows 和 mac 上不是一个东西）、尺寸与基线不受控、
// 且读屏软件会把它念成一长串描述。SVG 三样都不占。
//
// 不装图标库：这个 harness 只用得到几个图标，为它加一个依赖不划算。

type IconProps = {size?: number};

const svg = (path: ReactNode, size: number, extra?: Record<string, string>) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    // 图标都是装饰性的（旁边一律有文字），对读屏隐藏才不会念出无意义的内容。
    aria-hidden="true"
    {...extra}
  >
    {path}
  </svg>
);

export const IconBolt = ({size = 16}: IconProps) =>
  svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />, size);

export const IconWarn = ({size = 16}: IconProps) =>
  svg(
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
    size,
  );

export const IconCheck = ({size = 16}: IconProps) =>
  svg(<polyline points="20 6 9 17 4 12" />, size);

export const IconCopy = ({size = 16}: IconProps) =>
  svg(
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
    size,
  );

export const IconClose = ({size = 16}: IconProps) =>
  svg(
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
    size,
  );

export const IconUser = ({size = 16}: IconProps) =>
  svg(
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>,
    size,
  );

export const IconPlug = ({size = 16}: IconProps) =>
  svg(
    <>
      <path d="M12 22v-5" />
      <path d="M9 8V2M15 8V2" />
      <path d="M18 8v3a6 6 0 0 1-12 0V8z" />
    </>,
    size,
  );

/** 转圈。只在真的在等的时候出现 —— 近乎瞬时的操作闪一下 spinner 比不闪更糟。 */
export const IconSpin = ({size = 16}: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="0.8s"
        repeatCount="indefinite"
      />
    </path>
  </svg>
);

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 一块内容。`n` 从前是必填的步骤号（0…4），现在**可选** —— 页面不再是
 * 一条编号的流水线，编号只留给还需要顺序感的地方（X 那一页）。
 */
export function Card({
  n,
  title,
  hero,
  right,
  children,
}: {
  n?: string;
  title: string;
  hero?: boolean;
  /** 标题右侧那一格：作用于整块的动作与计数。 */
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={hero ? 'card hero' : 'card'}>
      <h2>
        {n && <span className="n">{n}</span>}
        {title}
        {right && <span className="right">{right}</span>}
      </h2>
      {children}
    </section>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = 'default',
  size,
  busy,
  title,
  wide,
  danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'sm';
  busy?: boolean;
  title?: string;
  wide?: boolean;
  /** primary 专用：这一次的动作是卖出（红），不是买入（绿）。 */
  danger?: boolean;
}) {
  const cls = [
    'btn',
    variant !== 'default' ? variant : '',
    size ?? '',
    wide ? 'wide' : '',
    danger ? 'sell' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title}
      // aria-busy 让读屏用户知道这次点击还在进行中 —— 视觉上的 spinner
      // 对他们不存在。
      aria-busy={busy || undefined}
    >
      {busy && <IconSpin size={15} />}
      {children}
    </button>
  );
}

/**
 * 顶栏的一枚状态芯片。给了 `onClick` 就是按钮（点开抽屉），否则是只读状态。
 *
 * **一枚芯片只答一个问题**，而且答案要能一眼扫到 —— 所以左边那个圆点承担
 * 「好 / 不好」，文字承担「是什么、多少」。颜色不是唯一的区分手段：
 * 每一枚里都写着它是什么。
 */
export function Chip({
  tone = 'off',
  onClick,
  title,
  expanded,
  disabled,
  children,
}: {
  tone?: 'ok' | 'err' | 'warn' | 'live' | 'off';
  onClick?: () => void;
  title?: string;
  expanded?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const cls = `chip ${tone}`;
  if (!onClick) {
    return (
      <span className={cls} title={title}>
        <span className="led" />
        {children}
      </span>
    );
  }
  return (
    <button
      className={cls}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-expanded={expanded}
    >
      <span className="led" />
      {children}
    </button>
  );
}

/**
 * 折叠起来的说明。
 *
 * **它不是"次要信息"的垃圾桶** —— 收进来的每一段都对应一次真实的误诊。
 * 它解决的是另一件事：摊在版面上的字一多，人的实际做法是整块跳过，
 * 于是那些字等于没写。收起来之后它们变成"撞上了再点开"的东西。
 */
export function Info({label = '说明', children}: {label?: string; children: ReactNode}) {
  return (
    <details className="doc">
      <summary>{label}</summary>
      <div className="body">{children}</div>
    </details>
  );
}

/**
 * 顶栏芯片底下掉出来的一块面板。登录与个人信息共用它。
 *
 * # 为什么不是横贯整宽的抽屉
 *
 * 抽屉那版把下面的整页往下推了半屏 —— 而"登一次录"和"看一眼自己的地址"
 * 都是办完就走的事，页面不该为它们改变布局：人点开它的时候，往往正在填
 * 下面那张下单表单，而表单跟着往下跳会让人丢掉自己看到哪儿了。
 *
 * # 三件不能省的事
 *
 *   · **Escape 关闭** —— 一块浮在所有内容之上的面板，如果只能靠鼠标点掉，
 *     键盘用户就被关在里面了；
 *   · **打开时把焦点挪进来** —— 否则 Tab 从页面最顶上重新走一遍，人在看不
 *     见的地方点来点去；
 *   · **点背景关闭** —— 这是浮层的默认预期，不给的话人会去找关闭按钮，
 *     而那颗按钮只有 30px 见方。
 */
export function Popover({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // **这个 effect 只能跑一次（依赖是空数组），所以 onClose 要走 ref。**
  //
  // 写成 `[onClose]` 的那一版有个当场能撞上的 bug：调用方传的是一个内联箭头
  // 函数，每次渲染都是新的 —— 而在邮箱框里敲一个字就会触发一次渲染。于是
  // effect 重跑、`panel.focus()` 再执行一次，焦点被从输入框抢回面板本身：
  // 表现是**每敲一个字符输入框就失焦**，一个字都填不进去。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      {/* 背景只负责"点一下关掉"，读屏不该念到它。 */}
      <div className="pop-back" onClick={onClose} aria-hidden="true" />
      <div className="pop" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <div className="pop-hd">
          <h2>{title}</h2>
          <span className="x">
            <button className="btn sm ghost" onClick={onClose} aria-label="关闭">
              <IconClose size={14} />
            </button>
          </span>
        </div>
        {children}
      </div>
    </>
  );
}

export function Field({
  label,
  unit,
  value,
  onChange,
  placeholder,
  type,
  after,
  disabled,
}: {
  label: string;
  /** 标签后面那半格灰字：单位、格式。**不要塞进 placeholder** —— 一开始打字它就消失了。 */
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  /** 输入框右边跟着的东西（按钮之类）。 */
  after?: ReactNode;
  disabled?: boolean;
}) {
  const id = `f-${label.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div className="f">
      {/* label 用 htmlFor 绑到 input：点标签能聚焦，读屏也能把两者关联起来。
          只靠 placeholder 当标签是清单上点名的反模式。 */}
      <label htmlFor={id}>
        {label}
        {unit && <span className="u">{unit}</span>}
      </label>
      <div className="with">
        <input
          id={id}
          className="inp"
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {after}
      </div>
    </div>
  );
}

/**
 * 一枚状态徽章。六种语气的**含义是固定的**：
 *
 *   off  灰 —— 还没发生（未上报、未见、待入账）
 *   run  黄 —— 正在进行（已上报、已观察、Relay 处理中）
 *   ok   绿 —— 这一档走完了（出口已接受、已确认、已成交、已入账）
 *   err  红 —— 出事了（拒绝、重组、退款、需人工核实）
 *   warn 黄 —— 有异常但当前流程允许继续（例如预热失败后回落到正常签名）
 *   live 蓝 —— 页面自己在忙（重查中之类），与链上进度无关
 *
 * 颜色从不是唯一的区分手段：每一枚里都写着它是什么。
 */
export function Badge({kind, children}: {kind: 'ok' | 'off' | 'err' | 'warn' | 'live' | 'run'; children: ReactNode}) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

/**
 * 一块带语气的标注。四种语气共用同一个形状（左边框 + 淡底），
 * 靠 `tone` 换颜色 —— 但**颜色从不是唯一的区分手段**：每一块里都写着
 * 它是什么，颜色只负责让人更快找到它。
 */
export function Note({
  tone = 'warn',
  children,
}: {
  tone?: 'warn' | 'err' | 'ok' | 'info';
  children: ReactNode;
}) {
  const icon =
    tone === 'ok' ? <IconCheck size={16} /> : tone === 'info' ? <IconBolt size={16} /> : <IconWarn size={16} />;
  return (
    <div className={`alert tight ${tone === 'warn' ? '' : tone}`} role="note">
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function KV({k, children}: {k: string; children: ReactNode}) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      {children}
    </div>
  );
}

/**
 * 一串机器键（地址 / DID / wallet id / JWT）：**显示截断，复制全量。**
 *
 * 个人信息那一屏上全是这种串，原样铺开会把每一行撑到换行，一屏里塞不下三条，
 * 而它们真正的用途是"复制出去贴给别人"——看清中间那 30 个字符没有任何价值。
 *
 * 截的是中间不是尾巴：地址的首尾各几位是人核对时唯一会看的部分（"0xAD81…CE36"），
 * 只留头部的那种截法会把两只只有尾号不同的钱包显示成一模一样。
 *
 * 全量在三个地方都拿得到：`title`（悬停）、读屏的 aria-label、以及复制按钮。
 */
export function Mono({
  value,
  head = 8,
  tail = 6,
  label,
}: {
  value: string;
  head?: number;
  tail?: number;
  /** 复制按钮上的字。默认只有图标那一档的「复制」。 */
  label?: string;
}) {
  const short = value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
  return (
    <>
      <code className="code" title={value}>
        {short}
      </code>
      <Copy text={value} label={label} />
    </>
  );
}

export type Step = {at: string; text: string; bad?: boolean};

export function Log({items}: {items: Step[]}) {
  return (
    // aria-live：新日志行会被读屏播报，而不是安静地追加。
    <div className="log" aria-live="polite">
      {items.length === 0 && <div className="empty">还没有动作。</div>}
      {items.map((l, i) => (
        <div key={i} className={l.bad ? 'ln bad' : 'ln'}>
          <span className="at">{l.at}</span>
          <span className="tx">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 复制一段文本到剪贴板。
 *
 * **失败必须看得见。** `navigator.clipboard` 在非安全上下文里根本不存在
 * （http 且非 localhost），而权限被拒时 writeText 会 reject —— 两种情况下
 * 静默失败的症状都是"我明明点了复制，粘出来却是上一次的东西"，
 * 而人会去怪粘贴的那一端。
 */
export function Copy({text, label = '复制'}: {text: string; label?: string}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const run = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      setState('fail');
    }
    setTimeout(() => setState('idle'), 1600);
  };
  return (
    <button
      className="btn sm ghost"
      onClick={run}
      title={text}
      // 按钮上只有一个图标时读屏念不出用途，必须给它一个名字。
      aria-label={`${label}：${text}`}
    >
      {state === 'ok' ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败，请手动选中' : label}
    </button>
  );
}

/**
 * 一组互斥项。**分段控件，不是一排按钮** —— 一排按钮里"当前在哪一档"只能
 * 靠颜色说，而分段控件的凹槽本身就在说这件事。
 *
 * 语义标记（`role="tablist"` / `role="tab"` / `aria-selected`）不能省：
 * 少了它们，读屏用户听到的是几个普通按钮。
 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  grow,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: readonly {k: T; label: string}[];
  /** 撑满可用宽度（买/卖那种非此即彼的开关用它）。 */
  grow?: boolean;
  label?: string;
}) {
  return (
    <div className={grow ? 'seg grow' : 'seg'} role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.k}
          type="button"
          role="tab"
          data-k={it.k}
          aria-selected={value === it.k}
          onClick={() => onChange(it.k)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
