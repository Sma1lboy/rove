"""Build the picker demo — what auto-effort would FEEL like, not how it scores.

The comparison page (auto-effort-try) answers "which model is better". This one
answers the product question the design doc leaves open: when Rove picks the
tier for you, is that pleasant or is it in the way?

So the beat this page is built around is the CONFIDENCE GATE, not the verdict.
The threshold is a slider the hand can move, and the same sentence flips between
"Rove filled this in" and "Rove stayed out of it" as you move it. That is the
decision — a tier picked wrong costs more than a tier not picked, because the
user has to notice it first.

Tokens are lifted from packages/auto-effort/scripts/build_demo_page.py: same
product family, and the tier ramp already means something there.
"""
import json
import urllib.request

API = "https://sma1lboy--rove-auto-effort-demo-web.modal.run"
OUT = "/tmp/picker.html"

# packages/kobe/src/engine/auto-effort.ts — DEFAULT_AUTO_EFFORT
TABLE = {"swift": {"engine": "claude", "model": "sonnet"},
         "standard": {"engine": "claude", "model": "opus"},
         "deep": {"engine": "claude", "model": "fable"}}

EX = ["你是什么模型",
      "深色模式下代码块的背景和正文一个色，改一下",
      "有时候窗口会跑到屏幕外面去，多屏的情况下",
      "参考 vuetify 的同名 prop，给 Button 加一个 loading",
      "看看还有什么可以优化的",
      "paste 的时候会丢字符，是不是哪里 truncate 了",
      "能不能支持一下自定义快捷键"]

page = """<title>auto-effort picker</title>
<style>
:root{
  color-scheme: light dark;
  --bg:#f4f3ee; --panel:#fffefb; --sunk:#edece5; --fg:#1b1c1e; --muted:#6d6e73; --faint:#9a9b9f;
  --rule:#e2e1d9; --rule-soft:#eceae2;
  --t0:#7096bb; --t1:#3f688e; --t2:#243a55;
  --accent:#a8571f; --accent-soft:#a8571f1f;
  --ok:#3f7a56;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, "DejaVu Sans Mono", monospace;
  --sans: ui-sans-serif, -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif;
  --r-lg:14px; --r-sm:8px; --r-pill:999px;
  --shadow:0 1px 2px rgba(20,20,24,.04), 0 6px 20px -12px rgba(20,20,24,.18);
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --bg:#111215; --panel:#191a1e; --sunk:#141519; --fg:#eae9e5; --muted:#95969c; --faint:#6b6c72;
  --rule:#292a30; --rule-soft:#212229;
  --t0:#83a9ce; --t1:#5e8ab6; --t2:#a6bdd8;
  --accent:#dd8b4c; --accent-soft:#dd8b4c22; --ok:#69ab84;
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 8px 24px -14px rgba(0,0,0,.7);
}}
:root[data-theme="dark"]{
  --bg:#111215; --panel:#191a1e; --sunk:#141519; --fg:#eae9e5; --muted:#95969c; --faint:#6b6c72;
  --rule:#292a30; --rule-soft:#212229;
  --t0:#83a9ce; --t1:#5e8ab6; --t2:#a6bdd8;
  --accent:#dd8b4c; --accent-soft:#dd8b4c22; --ok:#69ab84;
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 8px 24px -14px rgba(0,0,0,.7);
}
*{box-sizing:border-box}
html{background:var(--bg);color:var(--fg);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
body{margin:0;padding:1.5rem 16px 4rem;max-width:44rem;margin-inline:auto}
h1{font:600 17px/1.3 var(--sans);margin:0}
h2{font:600 13px/1 var(--sans);color:var(--muted);margin:2rem 0 .7rem;
   text-transform:uppercase;letter-spacing:.07em}
.bar{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;padding:.6rem .95rem;margin-bottom:1.5rem;
  border-radius:var(--r-pill);background:var(--panel);border:1px solid var(--rule);box-shadow:var(--shadow)}
.bar .sub{color:var(--muted);font-size:13px;margin-left:auto}

/* 新建 task 对话框：这是产品里那个框的样子，不是一个通用输入区 */
.dialog{border:1px solid var(--rule);border-radius:var(--r-lg);background:var(--panel);
  box-shadow:var(--shadow);overflow:hidden}
.dialog .hd{padding:.55rem .95rem;border-bottom:1px solid var(--rule-soft);background:var(--sunk);
  font:11px var(--mono);color:var(--muted);letter-spacing:.04em}
textarea{width:100%;min-height:5.5rem;padding:.85rem .95rem;font:14px/1.65 var(--mono);
  background:transparent;color:var(--fg);border:0;resize:vertical;display:block}
textarea:focus{outline:none}
.row{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;
  padding:.6rem .95rem;border-top:1px solid var(--rule-soft);background:var(--sunk)}
button{font:13px/1 var(--sans);padding:.5rem .95rem;border:1px solid var(--rule);background:var(--panel);
  color:var(--fg);border-radius:var(--r-sm);cursor:pointer}
button:disabled{opacity:.5;cursor:default}
button.go{border-color:var(--accent);color:var(--accent);margin-left:auto}
button.go:hover:not(:disabled){background:var(--accent-soft)}
.chips{display:flex;gap:.4rem;flex-wrap:wrap;margin:.8rem 0 0}
.chips button{font:12px var(--sans);padding:.3rem .6rem;color:var(--muted);
  border-color:var(--rule-soft);background:transparent;max-width:100%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chips button:hover{color:var(--fg);background:var(--panel)}

/* 判定结果：填进去的那一格长什么样 */
.slot{margin-top:1rem;border:1px solid var(--rule);border-radius:var(--r-lg);background:var(--panel);
  box-shadow:var(--shadow);overflow:hidden;animation:rise .22s ease-out}
@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.slot .hd{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;
  padding:.7rem .95rem;border-bottom:1px solid var(--rule-soft)}
.tier{font:600 13px var(--mono);padding:.2rem .6rem;border-radius:var(--r-sm);color:#fff}
.tier.swift{background:var(--t0)} .tier.standard{background:var(--t1)} .tier.deep{background:var(--t2)}
.tier.none{background:transparent;color:var(--muted);border:1px dashed var(--rule)}
.tier.notask{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.slot .note{color:var(--muted);font-size:13px}
.fields{display:grid;grid-template-columns:auto 1fr;gap:.35rem .9rem;padding:.8rem .95rem;
  font:13px var(--mono)}
.fields .k{color:var(--faint)}
.fields .v.dim{color:var(--muted)}
.gate{padding:.7rem .95rem;border-top:1px solid var(--rule-soft);background:var(--sunk);
  display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.gate input[type=range]{flex:1;min-width:8rem;accent-color:var(--accent)}
.gate b{color:var(--fg);font:13px var(--mono)}
.st{font:12px var(--mono);color:var(--muted);min-height:1.2em;margin-top:.6rem}
p{color:var(--muted);font-size:13.5px}
p b{color:var(--fg)}
code{font:12.5px var(--mono);background:var(--sunk);padding:.1rem .35rem;border-radius:4px}
</style>

<div class=bar>
  <h1>auto-effort · picker</h1>
  <span class=sub>写一句话，看 Rove 替你填了什么</span>
</div>

<div class=dialog>
  <div class=hd>新建 task · 第一句话</div>
  <textarea id=inp placeholder="要做什么？"></textarea>
  <div class=row>
    <span class=st id=st></span>
    <button class=go id=go>⌘↵ 判定</button>
  </div>
</div>
<div class=chips id=chips></div>
<div id=out></div>

<h2>这一页在问什么</h2>
<p>档位判定今天是<b>人选的</b>。接上分类器之后，它会在你写完第一句话时替你填好——
所以真正要试的不是它准不准，是<b>它猜错的时候有多碍事</b>。</p>
<p>拖上面那根<b>置信度门</b>。同一句话会在「Rove 帮你填了」和「Rove 没插手」之间翻。
这就是那个决定：<b>填错一档比不填更贵</b>，因为你得先发现它错了，才能去改。</p>
<p><b>用户写的任何一句话都是任务</b>，包括 <code>你是什么模型</code> 这种。
它该是 <b>swift</b>——话已经完整，答它不需要先想清楚做成什么样，没有流程要推。
「没有要做的事」和「目标要模型自己找」是两回事，判据只认后者。
短和开放也不改变这一点：<code>看看还有什么可以优化的</code> 又短又开放，是实打实的 deep。</p>
<p>判定的模型零训练，请求时现读那份标注规范，94 条真人标注上 73.0%；
<code>conf ≥ 0.7</code> 时覆盖 44%、那部分 85% 对。档位对应的
engine/model 取自 <code>DEFAULT_AUTO_EFFORT</code>，Settings 里可改。</p>

<script>
const API = "__API__", TABLE = __TABLE__, EX = __EX__;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let last = null, thresh = 0.7;

$("chips").innerHTML = EX.map(t => `<button data-t="${esc(t)}">${esc(t)}</button>`).join("");
$("chips").onclick = e => { const b = e.target.closest("button"); if (!b) return;
  $("inp").value = b.dataset.t; go(); };

function paint(){
  if (!last) return;
  const { label, confidence, ms } = last;
  const passes = confidence >= thresh;
  const t = passes ? label : null;
  const f = t ? TABLE[t] : null;
  $("out").innerHTML =
    `<div class=slot>
       <div class=hd>
         <span class="tier ${t || "none"}">${t || "未预选"}</span>
         <span class=note>${passes
            ? `Rove 填好了这一档 · ${(confidence*100).toFixed(0)}% 置信 · ${ms} ms`
            : `置信 ${(confidence*100).toFixed(0)}% 低于门限，留给你选（它本来想说 ${label}）`}</span>
       </div>
       <div class=fields>
         <span class=k>tier</span><span class="v ${t?"":"dim"}">${t || "— 保持默认"}</span>
         <span class=k>engine</span><span class="v ${f?"":"dim"}">${f ? f.engine : "—"}</span>
         <span class=k>model</span><span class="v ${f?"":"dim"}">${f ? f.model : "—"}</span>
       </div>
       <div class=gate>
         <span>置信度门</span>
         <input type=range id=th min=0 max=100 value="${Math.round(thresh*100)}">
         <b id=thv>${thresh.toFixed(2)}</b>
       </div>
     </div>`;
  $("th").oninput = e => { thresh = e.target.value / 100; paint(); };
}

async function go(){
  const text = $("inp").value.trim();
  if (!text) return;
  const b = $("go"), st = $("st");
  b.disabled = true;
  const t0 = Date.now(); let i = 0;
  const frames = ["·", "∶", "⁝", "∷"];
  const timer = setInterval(() => {
    const s = Math.round((Date.now()-t0)/1000);
    st.textContent = frames[++i % 4] + " 判定中 " + s + "s" + (s > 12 ? " · 冷启动" : "");
  }, 90);
  try {
    // /tier answers with the one model this page uses. /classify would also
    // spin up the three checkpoints this page never shows, and their latency
    // would land in the number the reader is here to judge.
    const r = await fetch(API + "/tier", {method:"POST",
      headers:{"content-type":"application/json"}, body: JSON.stringify({text})});
    const j = await r.json();
    if (!j || j.error) throw new Error(j.error || "no answer");
    last = j; st.textContent = ""; paint();
  } catch (e) { st.textContent = "失败：" + e.message; }
  clearInterval(timer); b.disabled = false;
}
$("go").onclick = go;
$("inp").addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") go(); });
</script>"""

page = (page.replace("__API__", API)
            .replace("__TABLE__", json.dumps(TABLE))
            .replace("__EX__", json.dumps(EX, ensure_ascii=False)))
open(OUT, "w").write(page)
print(len(page), "bytes ->", OUT)
