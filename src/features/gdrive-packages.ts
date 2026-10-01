(() => {
  /* --------------------------------------------------------------------------
   * Google Drive transport for third-party package backup.
   *
   * Packages live in their own app-managed Drive folder, separate from the
   * browser-state synchronization files, and reuse the Drive session the user
   * already authorized in sync settings rather than adding a second
   * authentication mechanism.
   *
   * This runs in a page context, so it cannot import runtime modules. The page
   * performs Drive requests itself — large CRX/ZIP bodies never travel through
   * extension messaging — and the worker supplies only a short-lived access
   * token and error classification.
   *
   * Dependencies are injected so the transport can be exercised without a DOM,
   * a browser, or a network.
   * ------------------------------------------------------------------------ */

  const GDRIVE_API = "https://www.googleapis.com/drive/v3";
  const GDRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const GDRIVE_PACKAGES_ROOT = "Chromium Cloud Sync Packages";
  const GDRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
  /** extensions/<id>/v<version>/<file> plus the destination root. */
  const GDRIVE_LIST_DEPTH = 5;
  const CONTROL_FILE_RE = /(^|\/)(index|selection|metadata)\.json$/;

  const DRIVE_ERROR_MESSAGE_KEYS = {
    quota: "driveQuota",
    "rate-limit": "driveRateLimit",
    auth: "driveAuth",
    permission: "drivePermission",
    "not-found": "driveNotFound",
    "too-large": "driveTooLarge",
    server: "driveServer",
  };

  const escapeQuery = (value) =>
    String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const stripSlashes = (value) =>
    String(value || "")
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\+/g, "/");

  function randomBoundary() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return `ccsync-package-${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("")}`;
  }

  /**
   * Create a Drive package transport.
   *
   * @param deps.request        send a message to the background worker
   * @param deps.storageGet     read local cache values
   * @param deps.storageSet     write local cache values
   * @param deps.fetch          network access (injectable for tests)
   * @param deps.t              localization lookup
   * @param deps.cacheKeys      local storage keys for resolved folder/file ids
   * @param deps.rootName       app-managed destination folder name
   */
  function createGdrivePackages(deps) {
    const {
      request,
      storageGet,
      storageSet,
      fetch: doFetch,
      t,
      cacheKeys,
      rootName = GDRIVE_PACKAGES_ROOT,
    } = deps;
    let sessionCache = null;

    /* ------------------------------ session ------------------------------ */

    /**
     * Reuse the sync provider's Drive session.
     *
     * Package backup deliberately has no authorization flow of its own: the
     * worker resolves the token from whichever mode the user authorized
     * (browser-managed or the manual fallback).
     */
    async function session() {
      if (sessionCache?.token) return sessionCache;
      let next = null;
      try {
        next = await request("gdrivePackageSession");
      } catch (error) {
        // The worker reports a disconnected Drive in its own wording; the
        // package-backup UI needs the localized guidance, with the worker's
        // detail preserved so the cause is still visible.
        const detail = error instanceof Error ? error.message : String(error);
        throw Error(`${t("gdriveNotConnected")} (${detail})`);
      }
      if (!next?.token) throw Error(t("gdriveNotConnected"));
      sessionCache = next;
      return next;
    }

    function resetSession() {
      sessionCache = null;
    }

    async function safeJson(response) {
      const text = await response.text?.().catch?.(() => "");
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }

    /**
     * Turn a Drive failure into something the user can act on.
     *
     * Quota, rate-limit, authorization, permission, missing-file, size-limit,
     * and outage cases each need a different response, so the worker classifies
     * the failure and this layer maps the kind onto localized package-backup
     * text. An expired session is dropped so the next call re-resolves it.
     */
    async function fail(status, body, context) {
      let described = null;
      try {
        described = await request("describeDriveError", {
          status,
          body,
          context,
        });
      } catch {
        described = null;
      }
      const kind = String(described?.kind || "");
      const key = DRIVE_ERROR_MESSAGE_KEYS[kind];
      const detail = String(described?.message || `Google Drive HTTP ${status}`);
      const error = Error(key ? `${t(key)} (${detail})` : detail);
      error.status = status;
      error.kind = kind || "unknown";
      if (kind === "auth") resetSession();
      return error;
    }

    async function send(url, init, context) {
      const active = await session();
      const response = await doFetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${active.token}`,
          ...((init && init.headers) || {}),
        },
      });
      if (!response.ok)
        throw await fail(response.status, await safeJson(response), context);
      return response;
    }

    /* ------------------------------ queries ------------------------------ */

    async function query(
      expression,
      fields = "files(id,name,mimeType,size,modifiedTime)",
    ) {
      const url =
        `${GDRIVE_API}/files?q=${encodeURIComponent(expression)}` +
        `&spaces=drive&pageSize=500&fields=${encodeURIComponent(fields)}`;
      const response = await send(url, {}, t("gdrive"));
      const data = await response.json?.().catch?.(() => ({}));
      return Array.isArray(data?.files) ? data.files : [];
    }

    /* --------------------------- id cache -------------------------------- */

    async function readCache() {
      const state = await storageGet([cacheKeys.rootId, cacheKeys.folderIds]);
      const ids = state?.[cacheKeys.folderIds];
      return {
        rootId: String(state?.[cacheKeys.rootId] || ""),
        ids: ids && typeof ids === "object" && !Array.isArray(ids) ? ids : {},
      };
    }

    async function writeCache(cache) {
      await storageSet({
        [cacheKeys.rootId]: cache.rootId,
        [cacheKeys.folderIds]: cache.ids,
      });
    }

    /* ----------------------------- folders ------------------------------- */

    async function ensureFolder(name, parentId) {
      const parentClause = parentId
        ? ` and '${escapeQuery(parentId)}' in parents`
        : " and 'root' in parents";
      const found = await query(
        `name='${escapeQuery(name)}' and mimeType='${GDRIVE_FOLDER_MIME}'${parentClause} and trashed=false`,
        "files(id,name)",
      );
      if (found[0]?.id) return String(found[0].id);

      const boundary = randomBoundary();
      const metadata = parentId
        ? { name, mimeType: GDRIVE_FOLDER_MIME, parents: [parentId] }
        : { name, mimeType: GDRIVE_FOLDER_MIME };
      const active = await session();
      const response = await doFetch(`${GDRIVE_API}/files?fields=id`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${active.token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: new TextEncoder().encode(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
            metadata,
          )}\r\n--${boundary}--`,
        ),
      });
      if (!response.ok)
        throw await fail(response.status, await safeJson(response), t("gdrive"));
      const data = await response.json?.().catch?.(() => ({}));
      if (!data?.id) throw Error("Google Drive folder creation returned no id");
      return String(data.id);
    }

    /**
     * Resolve the app-managed package destination.
     *
     * The root folder is created by this extension and is deliberately not the
     * synchronization folder, so package data can never be mixed into the
     * browser-state payload. An optional subfolder organizes backups further.
     */
    async function destination(cfg) {
      const cache = await readCache();
      if (!cache.rootId) {
        cache.rootId = await ensureFolder(rootName, "");
        cache.ids = {};
        await writeCache(cache);
      }
      const sub = stripSlashes(cfg?.gdriveFolder);
      if (!sub) return { rootId: cache.rootId, cache };
      let parentId = cache.rootId;
      for (const part of sub.split("/").filter(Boolean)) {
        const key = `folder:${parentId}/${part}`;
        let id = String(cache.ids[key] || "");
        if (!id) {
          id = await ensureFolder(part, parentId);
          cache.ids[key] = id;
          await writeCache(cache);
        }
        parentId = id;
      }
      return { rootId: parentId, cache };
    }

    /**
     * Walk a relative package path to its Drive location.
     *
     * With `create` the intermediate folders are created and the final segment is
     * returned as an upload target carrying any cached file id, so a repeat write
     * patches the existing file instead of creating a duplicate. Without `create`
     * a missing file resolves to null, which lets callers distinguish "not backed
     * up" from a transport failure.
     */
    async function resolveTarget(cfg, relative, create) {
      const { rootId, cache } = await destination(cfg);
      const parts = String(relative || "").split("/").filter(Boolean);
      if (!parts.length) return null;
      let parentId = rootId;
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        const last = index === parts.length - 1;
        const key = `${last ? "file" : "folder"}:${parentId}/${part}`;
        const cached = String(cache.ids[key] || "");
        if (last) {
          if (create) return { parentId, name: part, cache, key, existing: cached };
          if (cached) return { id: cached, cache, key };
          const found = await query(
            `name='${escapeQuery(part)}' and '${escapeQuery(parentId)}' in parents and trashed=false`,
            "files(id,name)",
          );
          const id = found[0]?.id ? String(found[0].id) : "";
          if (id) {
            cache.ids[key] = id;
            await writeCache(cache);
            return { id, cache, key };
          }
          return null;
        }
        if (cached) {
          parentId = cached;
          continue;
        }
        const id = await ensureFolder(part, parentId);
        cache.ids[key] = id;
        await writeCache(cache);
        parentId = id;
      }
      return null;
    }

    /** Forget one cached id so the next lookup resolves it from Drive again. */
    async function dropCacheEntry(target) {
      if (!target?.key || !target?.cache) return;
      delete target.cache.ids[target.key];
      await writeCache(target.cache);
    }

    /** Fetch file bytes, or null when Drive reports the file is gone. */
    async function readBytes(fileId, context) {
      const active = await session();
      const response = await doFetch(
        `${GDRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${active.token}` } },
      );
      if (response.status === 404) return null;
      if (!response.ok)
        throw await fail(response.status, await safeJson(response), context);
      return new Uint8Array(await response.arrayBuffer());
    }

    /* ------------------------------ transfer ----------------------------- */

    /**
     * Resumable upload.
     *
     * Packages can be tens of megabytes, far past the multipart limit, so the
     * resumable protocol is used for every write. Declaring the content length up
     * front is also what makes quota exhaustion reportable before the bytes move.
     */
    async function upload(cfg, relative, bytes, mimeType) {
      const target = await resolveTarget(cfg, relative, true);
      if (!target)
        throw Error(`Google Drive path resolution failed: ${relative}`);
      const { parentId, name, cache, key } = target;
      const active = await session();
      const existing = String(target.existing || cache.ids[key] || "");
      const startUrl = existing
        ? `${GDRIVE_UPLOAD}/files/${encodeURIComponent(existing)}?uploadType=resumable&fields=id`
        : `${GDRIVE_UPLOAD}/files?uploadType=resumable&fields=id`;
      const metadata = existing
        ? { name }
        : { name, mimeType, parents: [parentId] };
      const start = await doFetch(startUrl, {
        method: existing ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${active.token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(bytes.length),
        },
        body: JSON.stringify(metadata),
      });
      if (start.status === 404 && existing) {
        // Cached id points at a deleted file: drop it and create a fresh one.
        await dropCacheEntry(target);
        return upload(cfg, relative, bytes, mimeType);
      }
      if (!start.ok)
        throw await fail(start.status, await safeJson(start), t("uploading"));
      const location = start.headers?.get?.("Location");
      if (!location) throw Error("Google Drive did not return an upload session");
      const put = await doFetch(location, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: bytes,
      });
      if (!put.ok) throw await fail(put.status, await safeJson(put), t("uploading"));
      const data = await put.json?.().catch?.(() => ({}));
      const id = String(data?.id || existing || "");
      if (id) {
        cache.ids[key] = id;
        await writeCache(cache);
      }
      return id;
    }

    async function download(cfg, relative) {
      const target = await resolveTarget(cfg, relative, false);
      if (!target?.id) throw Error(t("driveNotFound"));
      const bytes = await readBytes(target.id, t("download"));
      if (bytes) return bytes;
      // A cached id can outlive the file; resolve by name once before giving up.
      await dropCacheEntry(target);
      const retry = await resolveTarget(cfg, relative, false);
      if (!retry?.id) throw Error(t("driveNotFound"));
      const recovered = await readBytes(retry.id, t("download"));
      if (!recovered) throw Error(t("driveNotFound"));
      return recovered;
    }

    async function readJson(cfg, relative, fallback) {
      const parse = (bytes) => {
        if (!bytes || !bytes.length) return fallback;
        try {
          return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return fallback;
        }
      };
      const target = await resolveTarget(cfg, relative, false);
      if (!target?.id) return fallback;
      const bytes = await readBytes(target.id, relative);
      if (bytes) return parse(bytes);
      await dropCacheEntry(target);
      const retry = await resolveTarget(cfg, relative, false);
      if (!retry?.id) return fallback;
      return parse(await readBytes(retry.id, relative));
    }

    async function writeJson(cfg, relative, value) {
      const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
      return upload(cfg, relative, bytes, "application/json");
    }

    /**
     * List every package file under the destination.
     *
     * Drive has no recursive listing, so the known package tree is walked level by
     * level with a bounded depth. This is what allows backups uploaded from
     * another profile — or left behind by an interrupted index write — to still be
     * listed, and control files are excluded so they are never offered as
     * restorable packages.
     */
    async function listPackages(cfg) {
      const { rootId } = await destination(cfg);
      const out = [];
      let level = [{ id: rootId, path: "" }];
      for (let depth = 0; depth < GDRIVE_LIST_DEPTH && level.length; depth += 1) {
        const next = [];
        for (const entry of level) {
          const children = await query(
            `'${escapeQuery(entry.id)}' in parents and trashed=false`,
          );
          for (const child of children) {
            const path = entry.path
              ? `${entry.path}/${child.name}`
              : String(child.name || "");
            if (child.mimeType === GDRIVE_FOLDER_MIME) {
              next.push({ id: String(child.id), path });
              continue;
            }
            if (CONTROL_FILE_RE.test(path)) continue;
            out.push({
              path,
              name: String(child.name || ""),
              id: String(child.id || ""),
              size: Number(child.size || 0),
              modifiedTime: String(child.modifiedTime || ""),
            });
          }
        }
        level = next;
      }
      return out;
    }

    /** Verify the destination is reachable with the current session. */
    async function testConnection(cfg) {
      const active = await session();
      if (!active?.token) throw Error(t("gdriveNotConnected"));
      const resolved = await destination(cfg);
      await readJson(cfg, "index.json", null);
      return {
        ok: true,
        rootId: resolved.rootId,
        rootName,
        email: String(active.email || ""),
        mode: String(active.mode || ""),
      };
    }

    /** Drop resolved ids (account change, deleted destination folder). */
    async function invalidateCache() {
      await storageSet({ [cacheKeys.rootId]: "", [cacheKeys.folderIds]: {} });
      resetSession();
    }

    return {
      session,
      resetSession,
      destination,
      resolveTarget,
      ensureFolder,
      query,
      upload,
      download,
      readJson,
      writeJson,
      listPackages,
      testConnection,
      invalidateCache,
      fail,
    };
  }

  window.CCSyncGdrivePackages = {
    createGdrivePackages,
    GDRIVE_API,
    GDRIVE_UPLOAD,
    GDRIVE_PACKAGES_ROOT,
    GDRIVE_FOLDER_MIME,
    GDRIVE_LIST_DEPTH,
    DRIVE_ERROR_MESSAGE_KEYS,
  };
})();
