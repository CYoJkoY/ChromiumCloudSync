<div align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="Chromium Cloud Sync icon">
  <h1>Chromium Cloud Sync</h1>
  <p>使用你自己的 GitHub Gist，在 Chromium 浏览器之间同步浏览器状态。</p>

  <a href="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml"><img src="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml/badge.svg?branch=main" alt="Release workflow"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/CYoJkoY/ChromiumCloudSync" alt="License"></a>
  <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync" alt="Latest release"></a>
  <a href="https://github.com/CYoJkoY/ChromiumCloudSync"><img src="https://img.shields.io/github/stars/CYoJkoY/ChromiumCloudSync?style=flat" alt="GitHub stars"></a>
</div>

> **中文** · [English](#english)

Chromium Cloud Sync 是一个轻量、透明、以用户控制为核心的 Chromium 浏览器同步扩展。

它不搭建自己的同步服务器，而是直接使用你选择的 **GitHub Gist** 作为云端同步存储。不同浏览器读取同一份 Gist 状态，在本地合并后写入新的 revision；GitHub Gist 自带的 Revision 历史则用于查看和回滚同步版本。

## 为什么做它

浏览器同步通常意味着绑定某个厂商账号或依赖额外的同步服务。Chromium Cloud Sync 选择了另一条路径：**云端存储由用户自己掌握，同步链路尽可能短，项目本身不保存你的同步数据。**

核心原则很简单：

- **你的 Gist，你的同步空间**：插件直接访问你自己的 GitHub Gist。
- **没有自建同步后端**：同步数据不会经过项目作者的服务器。
- **一个共享状态**：不再维护复杂的“设备注册表”或设备身份体系。
- **GitHub Revision 即历史**：插件不创建额外的历史文件。
- **默认尊重用户控制**：自动同步默认关闭，默认间隔为 5 分钟。
- **当前数据格式透明**：同步状态以普通 JSON 存储，不添加应用层加密。

## 功能

| 功能 | 说明 |
| --- | --- |
| 标签页同步 | 同步 URL、标题、固定状态、窗口状态等信息 |
| 标签组同步 | 同步标签组标题、颜色、折叠状态 |
| 书签同步 | 同步书签结构、标题、URL 与顺序，并支持合并本地书签树 |
| 扩展清单同步 | 记录已安装扩展，用于检查另一台浏览器缺少哪些扩展 |
| 扩展设置同步 | 同步浏览器允许读取的部分扩展本地设置 |
| 冲突处理 | 使用本地基准快照与云端状态进行合并 |
| Revision 历史 | 直接使用 GitHub Gist 原生 Revision |
| 历史回滚 | 选择历史 Revision，并将其作为新的当前版本 |
| 自动同步 | 可选；默认关闭；默认间隔 5 分钟 |
| 中英文 UI | 简体中文 / English |
| 主题 | 浅色 / 深色 |

## 同步模型

同步模型刻意保持简单：

```text
                 GitHub Gist
                      │
             current.json + manifest.json
                      │
          ┌───────────┴───────────┐
          │                       │
      Browser A               Browser B
          │                       │
     local snapshot         local snapshot
          │                       │
          └─────── merge ─────────┘
                    │
              new revision
                    │
                    ▼
                 GitHub Gist
```

每次同步都会读取当前 Gist 状态，并以本地保存的基准快照参与合并，然后生成新的 revision。这样可以避免维护设备列表、设备名称和设备级云端状态所带来的额外复杂度。

## Gist 中保存什么

当前版本使用两个主要文件：

```text
manifest.json
current.json
```

`manifest.json` 保存同步格式和 revision 元数据，`current.json` 保存实际同步状态。

历史版本不由扩展额外创建文件，而是来自 GitHub Gist 的原生 Revision 历史。

### 当前同步状态包含

- 标签页与窗口状态
- 标签组元数据
- 书签树
- 已安装扩展清单
- 可读取的部分扩展设置
- 删除标记（tombstones）
- 冲突记录
- 同步版本与时间等元数据

## 隐私与安全

### 没有自己的同步服务器

扩展直接向 GitHub API / Gist 发起请求。项目本身没有一个接收同步数据的中转服务器。

### Gist 默认私有

插件创建新 Gist 时会请求私有 Gist。使用已有 Gist 时，则以你已有的 Gist 权限和可见性设置为准。

### 当前版本不加密同步内容

同步状态以普通 JSON 存储在 Gist 中。这样可以让数据结构透明、调试方便，并避免额外的密钥管理复杂度。

因此，请将 **拥有该 Gist 的访问权限视为拥有同步数据的访问权限**。

项目仍保留兼容旧版本加密 Gist 的读取/迁移代码，但新版本的正常同步、创建和回滚流程均使用普通 JSON。

### GitHub Token

GitHub Token 仅用于访问 GitHub API/Gist，并保存在浏览器扩展本地存储中。请不要把 Token 提交到 Git 仓库或分享给他人。

## 权限说明

Manifest V3 当前声明的主要浏览器权限：

| 权限 | 用途 |
| --- | --- |
| `tabs` | 读取和恢复标签页状态 |
| `management` | 读取已安装扩展清单 |
| `storage` | 保存本地同步配置和同步基准 |
| `alarms` | 在用户开启自动同步后执行定时同步 |
| `bookmarks` | 读取、合并和恢复书签 |
| `tabGroups` | 读取和恢复标签组信息 |

主机权限：

- `https://api.github.com/*` — GitHub API / Gist 操作
- `https://gist.githubusercontent.com/*` — 兼容读取 Gist raw 内容

这些权限对应当前 `manifest.json` 的实际声明；发布新版时请以最终版本为准。

## 安装

### 从 GitHub Releases 安装

打开：

<https://github.com/CYoJkoY/ChromiumCloudSync/releases>

Release 会提供：

```text
chromium-cloud-sync-vX.Y.Z.zip
chromium-cloud-sync-vX.Y.Z.crx
SHA256SUMS.txt
```

**ZIP** 适合通过 Chromium 的“加载已解压的扩展程序”进行开发/测试，也适合作为 Chrome Web Store 上传包。

**CRX** 用于直接分发或支持 CRX 的第三方平台。浏览器的安装策略可能因 Chromium 发行版、企业策略或浏览器版本而不同。

### 开发者模式加载

1. 打开 `chrome://extensions/`（或对应 Chromium 浏览器的扩展管理页面）。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择项目根目录。

## 配置 GitHub Gist

1. 创建一个具有合适访问权限的 GitHub Token。
2. 在扩展设置中填写 Token。
3. 验证 Token。
4. 可以创建新的同步 Gist，也可以绑定已有的 Chromium Cloud Sync Gist。
5. 使用“立即同步”测试读写是否正常。
6. 如需后台同步，再主动开启自动同步。

> 建议为本扩展使用权限尽可能收敛的 GitHub Token，并定期轮换。

## 自动同步

自动同步是**可选功能**，默认关闭。

默认设置为：

```text
自动同步：关闭
同步间隔：5 分钟
```

关闭时不会触发后台自动同步；保存的间隔值仍然保留，之后重新开启即可继续使用。

## 历史与回滚

GitHub Gist 会保存 revision 历史，因此扩展不会再创建 `history/*` 或其它独立历史文件。

在“同步历史”页面可以：

- 查看 Gist Revision
- 查看当前版本
- 查看提交时间与用户
- 检查未解决冲突
- 将历史 Revision 回滚为新的当前版本

回滚不是删除 GitHub 历史，而是把选中的旧状态写回为一个新的 revision。

## 已知限制

- 浏览器受限制的页面（例如部分 `chrome://` 页面）不会被读取或恢复。
- 不同 Chromium 发行版对扩展管理、受限制 URL、标签组能力可能存在差异。
- 扩展设置同步只覆盖浏览器允许读取的部分本地扩展存储，并不保证所有扩展都支持完整设置同步。
- 扩展安装本身仍由用户和浏览器决定；本项目只提供缺失扩展检查和安装页面入口。
- GitHub Gist 是第三方服务，Gist 的可用性、权限和保留策略受 GitHub 自身服务规则影响。

## 开发

项目使用原生 JavaScript + Manifest V3，不依赖大型前端框架。

要求：

- Node.js 24+
- Chromium / Chrome / Edge 等支持 Manifest V3 的浏览器

验证项目：

```bash
npm run validate
```

构建发布 ZIP：

```bash
npm run build:zip
```

## 自动发布

项目支持基于 Git Tag 的 GitHub Actions 发布流程。

例如：

```bash
git tag v1.5.15
git push origin v1.5.15
```

Actions 会依次：

1. 校验 Tag 与 `manifest.json` 版本一致。
2. 运行项目验证。
3. 构建 ZIP。
4. 校验 ZIP 内容。
5. 使用仓库 Secret 中的固定 CRX3 私钥生成 CRX。
6. 生成 SHA-256 校验文件。
7. 创建 GitHub Release 并上传 ZIP、CRX 和校验文件。

CRX 签名私钥**绝不能**提交到仓库。推荐存入 GitHub Actions Secret，例如：

```text
CRX_PRIVATE_KEY_B64
```

## 项目结构

```text
ChromiumCloudSync/
├── .github/workflows/release.yml
├── _locales/
├── icons/
├── background.js       # GitHub Gist、同步与恢复核心逻辑
├── sync-core.js        # 状态合并、删除标记与冲突处理
├── popup.html/js       # 弹出窗口
├── options.html/js     # 设置页面
├── history.html/js     # Gist Revision 历史
├── guide.html/js       # 内置用户指南
├── i18n.js             # 国际化
├── theme.js            # 主题
├── runtime.js          # Runtime 请求封装
├── ui.css              # UI 样式
├── manifest.json       # Manifest V3
└── scripts/
    ├── build.mjs
    └── validate.mjs
```

## 贡献

欢迎通过 Issue 和 Pull Request 提交问题、建议和改进。

提交代码时请尽量：

- 保持同步模型简单、可解释。
- 避免重新引入设备注册、设备级云端状态等高复杂度机制，除非有明确的设计依据。
- 不提交 Token、私钥、PEM 文件或个人 Gist 数据。
- 修改权限时同步更新 README 和隐私政策。
- 修改数据格式时考虑旧版本 Gist 的兼容迁移。

## 许可证

本项目采用 **MIT License**。详见 [LICENSE](LICENSE)。

## English

### Overview

Chromium Cloud Sync is a lightweight Chromium browser sync extension that uses **your own GitHub Gist** as the synchronization store.

It does not operate a separate sync backend. Browsers read the same Gist state, merge it with their local base snapshot, and write a new Gist revision.

### Features

- Sync tabs and tab groups
- Sync bookmarks
- Sync installed extension inventory
- Sync selected readable extension settings
- Three-way style state merging with conflict records
- GitHub Gist revisions for history
- Roll back a previous revision as a new current revision
- Optional automatic sync, disabled by default
- Chinese / English UI
- Light / dark themes
- Create a private Gist or bind an existing one

### Data model

The current cloud state uses:

```text
manifest.json
current.json
```

GitHub Gist's native revision history is used instead of extension-managed history files.

There is no device registry in the current synchronization model.

### Privacy

Sync data is sent directly to GitHub's API/Gist selected by the user. The project does not operate a separate application server that receives synchronized browser data.

New Gists created by the extension are private by default. Existing Gists follow their own visibility and access settings.

The current sync payload is stored as normal JSON and is not encrypted by the extension. Treat access to the Gist as access to the synced data.

GitHub Token is stored locally by the extension and is used to authenticate GitHub requests. Never commit a Token or signing key to the repository.

### Development

```bash
npm run validate
npm run build:zip
```

The project uses Manifest V3 and a small native JavaScript codebase.

### Release

Push a semantic version tag to trigger the release workflow:

```bash
git tag v1.5.15
git push origin v1.5.15
```

The workflow validates the version, builds the ZIP, signs a CRX3 package with the repository's signing secret, generates SHA-256 checksums, and publishes a GitHub Release.

## License

MIT License. See [LICENSE](LICENSE).
