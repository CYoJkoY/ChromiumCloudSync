(() => {
  const i = CCSyncI18n;
  const $ = (id) => document.getElementById(id);

  const ui = {
    icon: $("statusIcon"),
    title: $("statusTitle"),
    meta: $("statusMeta"),
    detail: $("statusDetail"),
    rev: $("revision"),
  };

  function iconFor(state) {
    const map = {
      ok: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
      warn: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3z"/><path d="M12 9v4M12 17h.01"/></svg>',
      bad: '<svg class="icon-xl" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
      idle: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M18 3v5h-5"/></svg>',
    };
    return map[state] || map.idle;
  }

  function setStatus(state, title, meta = "", detail = "") {
    if (!ui.icon || !ui.title) return;
    ui.icon.className = `status-icon ${state}`;
    ui.icon.innerHTML = iconFor(state);
    ui.title.textContent = title;
    if (ui.meta) {
      ui.meta.textContent = meta;
      ui.meta.style.setProperty("white-space", "pre-line", "important");
    }
    if (ui.detail) {
      ui.detail.hidden = !detail;
      ui.detail.textContent = detail || "";
    }
  }

  function setError(error) {
    const message = error?.message || String(error);
    setStatus("bad", i.t("actionFailed"), message, message);
  }

  async function withButton(button, work) {
    if (!button || button.disabled) return;
    const old = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      await work();
    } catch (error) {
      setError(error);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = old;
    }
  }

  async function refresh(onLoaded) {
    try {
      const r = await CCSyncRuntime.request("status");
      const names = {
        gist: i.t("providerGist"),
        gdrive: i.t("providerGdrive"),
        webdav: i.t("providerWebdav"),
      };
      const providerName = names[r.provider] || r.provider || i.t("unknown");
      const state = r.bound ? "ok" : "warn";
      const title = r.bound
        ? i.t("ready")
        : i.t("provider") + ": " + providerName + " · " + i.t("notConfigured");
      const meta = [
        i.t("provider") + ": " + providerName,
        r.lastSyncAt
          ? i.t("lastSync") + " " + new Date(r.lastSyncAt).toLocaleString()
          : "",
        i.t("autoSyncStatus") +
          ": " +
          (r.autoSyncEnabled ? i.t("enabled") : i.t("disabled")),
      ]
        .filter(Boolean)
        .join("\n");
      setStatus(state, title, meta, "");
      if (ui.rev)
        ui.rev.textContent =
          i.t("revision") +
          " " +
          (r.syncRevision ?? 0) +
          " · " +
          i.t("conflictsLabel") +
          " " +
          (r.conflictCount ?? 0);
      if (onLoaded) onLoaded();
    } catch (error) {
      setError(error);
    }
  }

  window.CCSyncPopupStatus = { setStatus, setError, withButton, refresh, ui };
})();
