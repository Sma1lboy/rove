const commands = {
  npm: "npm install -g @sma1lboy/rove",
  bun: "bun install -g @sma1lboy/rove",
  npx: "npx @sma1lboy/rove",
  shell: "curl -fsSL https://rove.run/install.sh | sh",
};
let language = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
const requestedLanguage = new URLSearchParams(location.search).get("lang");
try {
  const stored = localStorage.getItem("kobe_lang");
  if (stored === "zh" || stored === "en") language = stored;
} catch {}
if (requestedLanguage === "zh" || requestedLanguage === "en") language = requestedLanguage;

const toggle = document.getElementById("langToggle");
const status = document.getElementById("copyStatus");
const command = document.getElementById("installCommand");
let copyAttempt = 0;
function applyLanguage() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-en]").forEach((element) => {
    element.textContent = element.dataset[language];
  });
  document.querySelectorAll("[data-label-en]").forEach((element) => {
    element.setAttribute("aria-label", element.dataset[language === "zh" ? "labelZh" : "labelEn"]);
  });
  document.title = language === "zh" ? "Rove：多个编码助手，一个工作区" : "Rove: your coding agents, in one workspace";
  document.querySelector('meta[name="description"]').content = language === "zh"
    ? "在一个终端工作区并行运行 AI 编码任务，查看哪些任务需要你，检查并合入改动。本地优先，开源免费。"
    : "Run AI coding agents in parallel, see which tasks need you, and review their changes in one terminal workspace. Local-first and open source.";
  toggle.textContent = language === "zh" ? "EN" : "中文";
  toggle.lang = language === "zh" ? "en" : "zh-CN";
  toggle.setAttribute("aria-label", language === "zh" ? "Switch to English" : "切换到中文");
  status.textContent = "";
  copyAttempt++;
}
toggle.addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  try { localStorage.setItem("kobe_lang", language); } catch {}
  applyLanguage();
});
document.querySelectorAll("[data-method]").forEach((button) => {
  button.addEventListener("click", () => {
    command.textContent = commands[button.dataset.method];
    document.querySelectorAll("[data-method]").forEach((option) => {
      option.setAttribute("aria-pressed", String(option === button));
    });
    status.textContent = "";
    copyAttempt++;
  });
});
document.getElementById("copyBtn").addEventListener("click", async () => {
  const attempt = ++copyAttempt;
  try {
    await navigator.clipboard.writeText(command.textContent);
    if (attempt === copyAttempt) status.textContent = language === "zh" ? "已复制到剪贴板。" : "Copied to clipboard.";
  } catch {
    if (attempt === copyAttempt) status.textContent = language === "zh" ? "无法访问剪贴板，请选择并复制上方命令。" : "Clipboard unavailable. Select and copy the command above.";
  }
});
applyLanguage();
