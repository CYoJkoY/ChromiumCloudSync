const { storageGet } = CCSyncRuntime;
const i = CCSyncI18n;
const $ = (id) => document.getElementById(id);
const status = window.CCSyncPopupStatus;
const cloud = window.CCSyncPopupCloudGroups;
const actions = window.CCSyncPopupActions;
const ui = {
  lang: $("language"),
  theme: $("theme"),
};

function setupChoiceSwitch(root, initialValue, onChange) {
  if (!root) return;
  const buttons = [...root.querySelectorAll(".choice-switch-option")];
  const set = (value) => {
    root.dataset.active = value === "en" || value === "dark" ? "right" : "left";
    for (const b of buttons)
      b.setAttribute("aria-pressed", String(b.dataset.value === value));
  };
  set(initialValue);
  for (const b of buttons)
    b.addEventListener("click", async () => {
      const value = b.dataset.value;
      try {
        await onChange(value);
        set(value);
      } catch (error) {
        console.error(error);
      }
    });
}

(async () => {
  try {
    await i.initAndApply();
    actions.mount({ statusRefresh: () => status.refresh() });
    cloud.observe();
    status.refresh();
    bindNavigation();
    const s = await storageGet(["language"]);
    if (ui.lang) {
      const lv =
        s.language && s.language !== "auto" ? s.language : i.currentLanguage();
      setupChoiceSwitch(ui.lang, lv, async (v) => {
        await i.setLanguage(v);
        await refresh();
      });
    }
    await CCSyncTheme.initTheme();
    if (ui.theme) {
      const tm = await CCSyncTheme.getTheme();
      const tv =
        tm === "dark" || tm === "light"
          ? tm
          : document.documentElement.dataset.theme || "light";
      setupChoiceSwitch(ui.theme, tv, async (v) => CCSyncTheme.setTheme(v));
    }
    await refresh();
  } catch (error) {
    status.setError(error);
  }
})();

function bindNavigation() {
  const nav = (id, url) => {
    const button = $(id);
    if (!button) return;
    button.addEventListener("click", () => {
      if (url === "options") chrome.runtime.openOptionsPage();
      else chrome.tabs.create({ url: chrome.runtime.getURL(url) });
    });
  };
  nav("options", "options");
  nav("guide", "guide.html");
  nav("history", "history.html");
  nav("checkExtensions", "extensions.html");
}
