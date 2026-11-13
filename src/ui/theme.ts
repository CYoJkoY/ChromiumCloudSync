(function () {
  const STORAGE_KEY = "theme";
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const COLORS = { light: "#F3F1E9", dark: "#121316" };
  const ICONS = {
    light: '<svg aria-hidden="true" class="theme-art theme-art-light" viewBox="0 0 32 22" focusable="false"><circle class="theme-sun" cx="8.2" cy="8" r="3.55"></circle><path class="theme-sun-ray" d="M8.2 1.7v1.45M8.2 12.85v1.45M1.9 8h1.45M13.05 8h1.45M3.75 3.55l1.02 1.02M11.63 11.43l1.02 1.02M12.65 3.55l-1.02 1.02M4.77 11.43l-1.02 1.02"></path><path class="theme-cloud-light" d="M11.2 17.65h13.35a3.25 3.25 0 0 0 .2-6.47 4.95 4.95 0 0 0-8.62-1.23 4.25 4.25 0 0 0-4.93 7.7Z"></path><path class="theme-cloud-highlight" d="M13.1 15.55c.8-1.25 2.25-1.8 3.55-1.55.9-1.42 2.6-2.12 4.25-1.8"></path></svg>',
    dark: '<svg aria-hidden="true" class="theme-art theme-art-dark" viewBox="0 0 32 22" focusable="false"><path class="theme-moon" d="M13.45 3.25a5.65 5.65 0 1 0 4.34 9.27 6.15 6.15 0 0 1-4.34-9.27Z"></path><path class="theme-star" d="M22 3.15l.62 1.32 1.44.2-1.03 1 .24 1.43L22 6.42l-1.27.68.24-1.43-1.03-1 1.44-.2.62-1.32Z"></path></svg>',
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
  document.addEventListener("ccsync:languagechange", normalizeControls);

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
