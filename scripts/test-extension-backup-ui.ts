import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/*
 * End-to-end exercise of the third-party package-backup UI.
 *
 * The options page is a page-context script with no module system, so it runs
 * here inside a `vm` context that provides just enough DOM, storage, and GitHub
 * transport for the real code paths to execute: rendering the selection list,
 * auto-saving a partial selection, scanning a picked local folder, and uploading
 * the packages it finds. Nothing is mocked at the level of the feature itself.
 */

/* --------------------------------------------------------------------------
 * Minimal DOM.
 * ------------------------------------------------------------------------ */

type Listener = (event?: any) => void;

class FakeNode {
  tagName: string;
  children: FakeNode[] = [];
  listeners = new Map<string, Listener[]>();
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };
  style: Record<string, string> = {};
  hidden = false;
  disabled = false;
  checked = false;
  textContent = "";
  value = "";
  className = "";
  type = "";
  placeholder = "";
  title = "";
  multiple = false;
  files: any[] = [];
  private idValue = "";

  /** Assigning an id registers the node, like a real document does. */
  get id() {
    return this.idValue;
  }
  set id(value: string) {
    this.idValue = value;
    if (value) elementsById.set(value, this);
  }

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...nodes: any[]) {
    for (const node of nodes) if (node) this.children.push(node);
    return undefined as unknown as void;
  }
  appendChild(node: any) {
    this.children.push(node);
    return node;
  }
  remove() {}
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  addEventListener(type: string, listener: Listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
  dispatch(type: string, event: any = { preventDefault() {} }) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  click() {
    this.dispatch("click");
  }
  querySelector(selector: string) {
    const key = `qs:${selector}`;
    let found = this.attrs[key];
    if (!found) {
      found = new FakeNode("div");
      this.attrs[key] = found as unknown as string;
    }
    return found as unknown as FakeNode;
  }
  querySelectorAll() {
    return [];
  }
  closest() {
    return null;
  }
  focus() {}
  private get elementChildren(): FakeNode[] {
    return this.children.filter(
      (child): child is FakeNode => child instanceof FakeNode,
    );
  }
  /** Depth-first search for the first node whose class list contains `name`. */
  findByClass(name: string): FakeNode | null {
    if (this.className.split(/\s+/).includes(name)) return this;
    for (const child of this.elementChildren) {
      const hit = child.findByClass(name);
      if (hit) return hit;
    }
    return null;
  }
  /** Every node whose class list contains `name`. */
  findAllByClass(name: string): FakeNode[] {
    const out: FakeNode[] = [];
    if (this.className.split(/\s+/).includes(name)) out.push(this);
    for (const child of this.elementChildren)
      out.push(...child.findAllByClass(name));
    return out;
  }
  /** Concatenated text of the subtree, like the DOM's textContent. */
  allText(): string {
    return [this.textContent, ...this.elementChildren.map((c) => c.allText())]
      .filter(Boolean)
      .join(" ");
  }
  findAll(predicate: (node: FakeNode) => boolean): FakeNode[] {
    const out: FakeNode[] = [];
    if (predicate(this)) out.push(this);
    for (const child of this.elementChildren)
      out.push(...child.findAll(predicate));
    return out;
  }
}

const elementsById = new Map<string, FakeNode>();
const documentListeners = new Map<string, Listener[]>();
const document = {
  readyState: "loading",
  head: new FakeNode("head"),
  body: new FakeNode("body"),
  documentElement: new FakeNode("html"),
  createElement: (tag: string) => new FakeNode(tag),
  getElementById: (id: string) => elementsById.get(id) ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type: string, listener: Listener) {
    const list = documentListeners.get(type) || [];
    list.push(listener);
    documentListeners.set(type, list);
  },
  dispatch(type: string) {
    for (const listener of documentListeners.get(type) || []) listener({});
  },
};

// Anchors that exist in options.html and are populated by the page script.
for (const id of [
  "extensionStorageHost",
  "extensionStorageNavLabel",
  "extensionStoragePanelTitle",
  "extensionStoragePanelDescription",
]) {
  const node = new FakeNode("div");
  node.id = id;
}

const alerts: string[] = [];
/** Values created inside the vm context need normalizing before comparison. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------------------------------------------------
 * In-memory GitHub repository for the Contents + Git tree APIs.
 * ------------------------------------------------------------------------ */

interface StoredFile {
  content: string;
  sha: string;
}
class FakeGithub {
  files = new Map<string, StoredFile>();
  requests: Array<{ url: string; method: string; body: string }> = [];
  private sequence = 0;

  constructor(private readonly owner: string, private readonly repo: string) {}

  private sha() {
    this.sequence += 1;
    return `sha-${this.sequence}`;
  }

  async handle(input: string, init: any = {}): Promise<Response> {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    const body = String(init?.body || "");
    this.requests.push({ url, method, body });
    // The page asks for raw bytes with `Accept: …github.raw+json`; anything else
    // gets the JSON representation, exactly like the real Contents API.
    const wantsRaw = String(init?.headers?.Accept || "").includes("raw");
    const encode = (value: unknown) => {
      if (wantsRaw && typeof value === "string") return value;
      return JSON.stringify(value);
    };
    const respond = (value: unknown, ok = true, status = 200) => {
      const payload = encode(value);
      return {
        ok,
        status,
        text: async () => payload,
        // Copy out of Node's buffer pool: a Buffer's .buffer can be far larger
        // than its view, and the page reads the whole thing.
        arrayBuffer: async () => {
          const bytes = Buffer.from(payload, "utf8");
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      } as unknown as Response;
    };

    if (url === `https://api.github.com/repos/${this.owner}/${this.repo}`)
      return respond({
        private: true,
        default_branch: "main",
        permissions: { push: true },
      });
    const tree = url.match(/\/git\/trees\/([^?]+)\?recursive=1$/);
    if (tree)
      return respond({
        truncated: false,
        tree: [...this.files.keys()].map((path) => ({
          type: "blob",
          path,
          size: this.files.get(path)!.content.length,
        })),
      });
    const contents = url.match(
      /\/repos\/[^/]+\/[^/]+\/contents\/(.+?)(?:\?|$)/,
    );
    if (contents) {
      const path = decodeURIComponent(contents[1]).replace(`${this.repo}/`, "");
      if (method === "GET") {
        const stored = this.files.get(path);
        if (!stored) return respond({ message: "Not Found" }, false, 404);
        if (wantsRaw) return respond(stored.content);
        return respond({
          path,
          sha: stored.sha,
          content: Buffer.from(stored.content).toString("base64"),
          encoding: "base64",
        });
      }
      if (method === "PUT") {
        const payload = JSON.parse(body || "{}");
        const content = Buffer.from(String(payload.content || ""), "base64").toString(
          "utf8",
        );
        this.files.set(path, { content, sha: payload.sha || this.sha() });
        return respond({ content: { sha: this.sha() } });
      }
      if (method === "DELETE") {
        this.files.delete(path);
        return respond({ commit: { sha: this.sha() } });
      }
    }
    return respond({ message: `unexpected ${method} ${url}` }, false, 500);
  }
}

/* --------------------------------------------------------------------------
 * A fake browser profile on disk.
 * ------------------------------------------------------------------------ */

const ID_ALPHA = "abcdefghijklmnopabcdefghijklmnop";
const ID_BETA = "bcdefghijklmnopabcdefghijklmnopa";
const ID_GAMMA = "cdefghijklmnopabcdefghijklmnopab";

const installedExtensions = [
  {
    id: ID_ALPHA,
    name: "Alpha Blocker",
    version: "2.1.0",
    installType: "normal",
    updateUrl: "https://clients2.google.com/service/update2/crx",
    enabled: true,
    type: "extension",
  },
  {
    id: ID_BETA,
    name: "Beta Tool",
    version: "5.0.0",
    installType: "normal",
    updateUrl: "https://clients2.google.com/service/update2/crx",
    enabled: false,
    type: "extension",
  },
];

interface FakeEntry {
  name: string;
  kind: "directory" | "file";
  children?: FakeEntry[];
  body?: string;
}

const profileTree: FakeEntry[] = [
  {
    name: "Default",
    kind: "directory",
    children: [
      {
        name: "Extensions",
        kind: "directory",
        children: [
          {
            name: ID_ALPHA,
            kind: "directory",
            children: [
              {
                name: "2.1.0",
                kind: "directory",
                children: [
                  { name: "manifest.json", kind: "file", body: '{"name":"Alpha Blocker","version":"2.1.0"}' },
                  { name: "block.js", kind: "file", body: "console.log('block');" },
                ],
              },
            ],
          },
          {
            name: ID_BETA,
            kind: "directory",
            children: [
              {
                name: "5.0.0",
                kind: "directory",
                children: [
                  { name: "manifest.json", kind: "file", body: '{"name":"Beta Tool","version":"5.0.0"}' },
                ],
              },
            ],
          },
          {
            name: ID_GAMMA,
            kind: "directory",
            children: [
              {
                name: "0.1.0",
                kind: "directory",
                children: [
                  { name: "manifest.json", kind: "file", body: '{"name":"Gamma (uninstalled)","version":"0.1.0"}' },
                ],
              },
            ],
          },
        ],
      },
      { name: "Preferences", kind: "file", body: "{}" },
    ],
  },
];

function fakeHandle(entry: FakeEntry): any {
  if (entry.kind === "file") {
    const body = entry.body ?? "";
    return {
      name: entry.name,
      kind: "file",
      async getFile() {
        const bytes = new TextEncoder().encode(body);
        return {
          size: bytes.length,
          async arrayBuffer() {
            return bytes.buffer.slice(0);
          },
        };
      },
    };
  }
  return {
    name: entry.name,
    kind: "directory",
    async *entries() {
      for (const child of entry.children || []) yield [child.name, fakeHandle(child)];
    },
  };
}

/* --------------------------------------------------------------------------
 * Load the real page scripts into the sandbox.
 * ------------------------------------------------------------------------ */

const packageIndexWindow: Record<string, unknown> = {};
(globalThis as unknown as Record<string, unknown>).window = packageIndexWindow;
await import("../src/features/package-index.ts");
await import("../src/features/extension-local-source.ts");
const packageIndex = packageIndexWindow.CCSyncPackageIndex;
const localSource = packageIndexWindow.CCSyncExtensionLocalSource;
assert.ok(packageIndex && localSource, "domain modules must publish themselves");

const storage: Record<string, unknown> = {
  extensionBackupBackend: "github",
  extensionBackupGithubRepo: "owner/private-repo",
  extensionBackupGithubBranch: "",
  extensionBackupGithubFolder: "",
  extensionBackupGithubToken: "test-token",
  extensionBackupSelectedIds: [],
};

const github = new FakeGithub("owner", "private-repo");

const sandbox = {
  console: {
    log: (...args: unknown[]) => process.stdout.write(`[page] ${args.join(" ")}\n`),
    warn: (...args: unknown[]) => process.stdout.write(`[page:warn] ${args.join(" ")}\n`),
    error: (...args: unknown[]) => process.stdout.write(`[page:error] ${args.join(" ")}\n`),
  },
  window: {
    CCSyncPackageIndex: packageIndex,
    CCSyncExtensionLocalSource: localSource,
    CCSyncGdrivePackages: {
      createGdrivePackages: () => ({
        session: async () => ({ token: "x" }),
        destination: async () => "root",
        upload: async () => "id",
        download: async () => new Uint8Array(),
        remove: async () => true,
        readJson: async () => null,
        writeJson: async () => "id",
        listPackages: async () => [],
      }),
    },
    addEventListener() {},
    showDirectoryPicker: async () => fakeHandle({ name: "User Data", kind: "directory", children: profileTree }),
  },
  document,
  URL,
  fetch: (input: any, init: any) => github.handle(String(input), init),
  AbortController,
  setTimeout,
  clearTimeout,
  alert: (message: string) => alerts.push(String(message)),
  confirm: () => true,
  crypto,
  TextEncoder,
  TextDecoder,
  Blob,
  btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
  chrome: {
    runtime: { id: "this-extension-id", openOptionsPage() {} },
    management: {
      getAll: async () => installedExtensions,
    },
  },
  CCSyncRuntime: {
    async storageGet(keys: string[]) {
      return Object.fromEntries(
        keys.filter((key) => key in storage).map((key) => [key, storage[key]]),
      );
    },
    async storageSet(values: Record<string, unknown>) {
      Object.assign(storage, values);
    },
    async request() {
      throw Error("unexpected background request");
    },
  },
};
const context = vm.createContext(sandbox);
vm.runInContext(
  readFileSync(
    new URL("../src/features/extension-storage.ts", import.meta.url),
    "utf8",
  ).replace(
    "window.CCSyncExtensionStorage = {",
    "window.CCSyncExtensionStorage = { listBackups, readIndex, readSelection, getCfg, putPackage,",
  ),
  context,
);
const page = (context.window as any).CCSyncExtensionStorage;
assert.ok(page, "extension storage page script must publish itself");

document.dispatch("DOMContentLoaded");
await sleep(50);

/* --------------------------------------------------------------------------
 * 1. The selection list renders with an opt-in default.
 * ------------------------------------------------------------------------ */

const card = elementsById.get("extensionStorageSettings")!;
const selection = card.findByClass("ccsync-ext-selection");
assert.ok(selection, "the selection section must render for an enabled backend");
const rows = selection.findAllByClass("ccsync-ext-row");
assert.equal(rows.length, 2, "both third-party extensions are listed");
const checkboxes = selection.findAll((node) => node.type === "checkbox");
assert.equal(checkboxes.length, 2, "each row has a checkbox");
assert.equal(
  checkboxes.every((box) => box.checked === false),
  true,
  "nothing is selected by default: partial backup is the default, not the exception",
);
assert.equal(
  github.files.has("selection.json"),
  false,
  "opening the page must not write a selection the user never made",
);

/* --------------------------------------------------------------------------
 * 2. A partial selection saves itself, locally and to the cloud.
 * ------------------------------------------------------------------------ */

checkboxes[0].checked = true;
checkboxes[0].dispatch("change");
await sleep(500);
assert.deepEqual(
  plain(storage.extensionBackupSelectedIds),
  [ID_ALPHA],
  "the checked extension is persisted locally",
);
const savedSelection = JSON.parse(github.files.get("selection.json")!.content);
assert.deepEqual(
  plain(savedSelection.selectedIds),
  [ID_ALPHA],
  "only the checked extension is written to the cloud selection",
);
const stateLine = selection.findByClass("ccsync-ext-status");
assert.match(
  stateLine?.textContent || "",
  /Backup selection saved|备份选择已保存/,
  "the selection reports that it saved itself",
);

/* --------------------------------------------------------------------------
 * 3. Backing up from a local folder finds, packages, and uploads.
 * ------------------------------------------------------------------------ */

const localButton = selection
  .findAll((node) => node.className === "primary" && node.type === "button")
  .find((node) => /本地文件夹|local folder/i.test(node.allText()));
assert.ok(localButton, "the local-folder backup button must be present");

// The picker promise resolves on its own; the preview dialog follows.
localButton!.click();
await sleep(150);

const modal = document.body.findByClass("ccsync-ext-modal");
assert.ok(modal, "the folder scan must open a preview dialog");
const modalRows = modal!.findAllByClass("ccsync-ext-local-row");
assert.equal(
  modalRows.length,
  3,
  "the two installed extensions plus the uninstalled leftover are offered",
);
const previewText = modal!.allText();
assert.match(previewText, /Alpha Blocker/, "the installed extension is named");
assert.match(
  previewText,
  /Gamma \(uninstalled\)|Gamma/,
  "the leftover is offered under its own ID",
);
// Alpha is checked because it is in the saved selection; Beta and the leftover
// are not, so a partial backup stays partial.
const modalBoxes = modal!.findAll((node) => node.type === "checkbox");
assert.deepEqual(
  modalBoxes.map((box) => box.checked),
  [true, false, false],
  "preview checkboxes default to the saved selection, with leftovers opt-in",
);

const startButton = modal!
  .findAll((node) => node.type === "button")
  .find((node) => /开始备份|Back up \d/.test(node.allText()));
assert.ok(startButton, "the dialog must offer a start button");
startButton!.click();
await sleep(400);

const uploadedPaths = [...github.files.keys()].filter((path) =>
  /\.zip$/.test(path),
);
assert.deepEqual(
  uploadedPaths,
  [`extensions/${ID_ALPHA}/v2.1.0/Alpha-Blocker-2.1.0.zip`],
  "only the selected extension is uploaded, under its own ID and version",
);
assert.ok(
  github.files.has("index.json"),
  "the backup index is updated",
);
const index = JSON.parse(github.files.get("index.json")!.content);
assert.equal(index.backups.length, 1);
assert.equal(index.backups[0].extensionId, ID_ALPHA);
assert.equal(index.backups[0].version, "2.1.0");
assert.equal(
  index.backups[0].origin,
  "local-unpacked",
  "the record says the bytes came from local unpacked files",
);
assert.equal(index.backups[0].format, "zip");
assert.ok(
  github.files.has(`extensions/${ID_ALPHA}/v2.1.0/metadata.json`),
  "the per-package metadata sidecar is written",
);
const storedZip = github.files.get(
  `extensions/${ID_ALPHA}/v2.1.0/Alpha-Blocker-2.1.0.zip`,
)!;
assert.ok(
  storedZip.content.length > 0,
  "the uploaded package is not empty",
);
assert.deepEqual(
  plain(JSON.parse(github.files.get("selection.json")!.content).selectedIds),
  [ID_ALPHA],
  "backing up from disk keeps the saved selection",
);

// Re-running the same backup must reuse the stored object instead of growing
// the index with an identical copy.
const before = github.files.size;
localButton!.click();
await sleep(150);
const secondModal = document.body.findByClass("ccsync-ext-modal");
assert.ok(secondModal, "a second run opens the preview again");
secondModal!
  .findAll((node) => node.type === "button")
  .find((node) => /开始备份|Back up \d/.test(node.allText()))!
  .click();
await sleep(400);
assert.equal(
  github.files.size,
  before,
  "unchanged content is not uploaded twice",
);
assert.equal(
  JSON.parse(github.files.get("index.json")!.content).backups.length,
  1,
  "the index keeps a single record for unchanged bytes",
);

/* --------------------------------------------------------------------------
 * 4. Closing the dialog restores the list, and the row chips report state.
 * ------------------------------------------------------------------------ */

const closeButton = secondModal!
  .findAll((node) => node.type === "button")
  .find((node) => /关闭|Close/.test(node.allText()));
assert.ok(closeButton, "the finished dialog offers a close button");
closeButton!.click();
await sleep(200);

// querySelectorAll is not implemented in the shim, so re-rendered sections
// accumulate; the newest one is the last.
const refreshed = card.findAllByClass("ccsync-ext-selection").pop();
assert.ok(refreshed, "the list is rendered again after the dialog closes");
const cloudChips = refreshed!.findAll((node) =>
  /backed up v2\.1\.0|已备份 v2\.1\.0/.test(node.allText()),
);
assert.ok(cloudChips.length >= 1, "the backed-up row reports its cloud state");
const localChips = refreshed!.findAll((node) =>
  /found locally|本地可备份/.test(node.allText()),
);
assert.ok(localChips.length >= 1, "rows found on disk are marked as such");

assert.deepEqual(
  alerts.filter((message) => /could not|失败/.test(message)),
  [],
  "no failure alerts were raised",
);

// The provider listing and the index agree, so nothing is reported missing.
const listed = await page.listBackups({
  backend: "github",
  repo: "owner/private-repo",
  branch: "",
  folder: "",
  token: "test-token",
});
assert.deepEqual(
  plain(listed.missing),
  [],
  "the uploaded package is present on the provider",
);
assert.equal(listed.backups[0].present, true);
assert.equal(listed.unindexed.length, 0, "no unindexed leftovers");


/* --------------------------------------------------------------------------
 * 5. A re-render cancels a pending selection write.
 *
 * Otherwise the debounced save would still close over the previous list and
 * write back checkboxes the user has already changed.
 * ------------------------------------------------------------------------ */

const latestRows = card.findAllByClass("ccsync-ext-selection").pop()!;
const alphaBox = latestRows
  .findAll((node) => node.type === "checkbox")
  .find((box) => box.dataset.extensionId === ID_ALPHA);
assert.ok(alphaBox, "the re-rendered list still exposes the Alpha checkbox");
alphaBox!.checked = false;
alphaBox!.dispatch("change");
// Re-render immediately: the debounce has not fired yet.
await page.refresh(await page.getCfg());
await sleep(600);
assert.deepEqual(
  plain(JSON.parse(github.files.get("selection.json")!.content).selectedIds),
  [ID_ALPHA],
  "a pending selection write is dropped when the list is re-rendered",
);
const afterRefresh = card.findAllByClass("ccsync-ext-selection").pop()!;
assert.equal(
  afterRefresh
    .findAll((node) => node.type === "checkbox")
    .find((box) => box.dataset.extensionId === ID_ALPHA)?.checked,
  true,
  "the re-rendered list reflects the saved selection, not the dropped edit",
);

console.log("Extension backup UI tests passed.");
