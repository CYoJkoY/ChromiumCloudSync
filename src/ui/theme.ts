(function () {
  const STORAGE_KEY = "theme";
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const COLORS = { light: "#F3F1E9", dark: "#121316" };
  const ICONS = {
    light:
      '<svg aria-hidden="true" class="theme-art theme-art-light" viewBox="0 0 24 24" focusable="false"><circle class="theme-sun-core" cx="12" cy="12" r="4.15"></circle><path class="theme-sun-rays" d="M12 2.35v2.1M12 19.55v2.1M2.35 12h2.1M19.55 12h2.1M5.18 5.18l1.48 1.48M17.34 17.34l1.48 1.48M18.82 5.18l-1.48 1.48M6.66 17.34l-1.48 1.48"></path></svg>',
    dark: '<svg aria-hidden="true" class="theme-art theme-art-dark" viewBox="0 0 24 24" focusable="false"><path class="theme-moon-shape" d="M19.7 14.65a7.85 7.85 0 1 1-10.35-10.35 7.95 7.95 0 0 0 10.35 10.35Z"></path></svg>',
  };

  function normalize(v) {
    return ["light", "dark", "system"].includes(v) ? v : "system";
  }
  function resolved(v) {
    const mode = normalize(v);
    return mode === "system" ? (media?.matches ? "dark" : "light") : mode;
  }

  function normalizeControls() {
    const root = document.getElementById("theme");
    if (!root) return;
    root.classList.add("theme-switch");
    const light = root.querySelector('[data-value="light"]');
    const dark = root.querySelector('[data-value="dark"]');
    if (light) {
      light.classList.add("theme-option");
      light.innerHTML = ICONS.light;
      const label =
        window.CCSyncI18n?.currentLanguage?.() === "zh-CN" ? "浅色" : "Light";
      light.setAttribute("aria-label", label);
      light.setAttribute("title", label);
    }
    if (dark) {
      dark.classList.add("theme-option");
      dark.innerHTML = ICONS.dark;
      const label =
        window.CCSyncI18n?.currentLanguage?.() === "zh-CN" ? "深色" : "Dark";
      dark.setAttribute("aria-label", label);
      dark.setAttribute("title", label);
    }
  }

  function applyTheme(mode) {
    const m = normalize(mode),
      r = resolved(m);
    document.documentElement.dataset.theme = r;
    document.documentElement.dataset.themeMode = m;
    document.documentElement.style.colorScheme = r;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = COLORS[r];
    normalizeControls();
    return r;
  }

  async function getTheme() {
    const s = await chrome.storage.local.get(STORAGE_KEY);
    return normalize(s[STORAGE_KEY]);
  }
  async function initTheme() {
    normalizeControls();
    const mode = await getTheme();
    applyTheme(mode);
    return mode;
  }
  async function setTheme(mode) {
    const m = normalize(mode);
    await chrome.storage.local.set({ [STORAGE_KEY]: m });
    applyTheme(m);
    return m;
  }

  media?.addEventListener?.("change", async () => {
    if ((await getTheme()) === "system") applyTheme("system");
  });

  window.CCSyncTheme = {
    getTheme,
    initTheme,
    setTheme,
    applyTheme,
    normalizeControls,
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => {
      normalizeControls();
      void initTheme();
    });
  else {
    normalizeControls();
    void initTheme();
  }
})();
