# Chromium Cloud Sync Privacy Policy

**Effective date: October 8, 2026**

Chromium Cloud Sync is a browser extension for synchronizing and restoring selected Chromium browser state across devices through a cloud provider selected and configured by the user.

## 1. What Chromium Cloud Sync processes

Depending on the features enabled by the user, the extension processes the following data:

### Browser state

- HTTP(S) tab URLs and titles.
- Tab order, pinned state, active state, and window state.
- Tab-group titles, colors, collapsed state, and membership.
- Bookmark titles, URLs, hierarchy, and order.

This information is required to synchronize and restore the browser state selected by the user.

### Installed extension metadata

The extension can read metadata for installed third-party extensions, including:

- Extension ID.
- Name and version.
- Enabled state.
- Installation type.
- Homepage and update information.
- Store links.

This metadata is used for extension inventory, missing-extension detection, recovery assistance, and user-requested package backup.

The extension does not read another extension's private storage or private settings.

### Authentication information

The extension may process credentials or tokens that the user explicitly provides or authorizes for the selected synchronization provider, including:

- GitHub access tokens.
- WebDAV usernames and passwords.
- Google OAuth access and refresh tokens.
- OAuth client configuration used by the manual Google Drive authorization flow.

Provider authentication state is stored in the local browser profile and is not intentionally included in the synchronized browser-state payload.

### Google Drive account information

When Google Drive is connected, the extension may read the authorized account email address, display name, and profile image URL so the settings interface can identify the connected account.

### User-selected extension package data

When the optional package-backup feature is used, the extension can read CRX/ZIP files or files from a directory explicitly selected by the user and upload the selected package to the backup provider configured by the user.

## 2. Why this data is processed

Chromium Cloud Sync processes the data above only to provide its disclosed functionality:

- Browser-state synchronization.
- Browser-state restoration.
- Tab-group and bookmark synchronization.
- Installed-extension inventory and recovery.
- User-requested extension package backup.
- Authentication with the cloud provider selected by the user.

The extension does not use this data for advertising, behavioral profiling, credit assessment, loan decisions, data brokerage, or other purposes unrelated to these functions.

## 3. Where data is sent

Chromium Cloud Sync does not operate a separate Yoko/CYoJkoY analytics or user-data collection server.

When synchronization or backup is enabled, data is transmitted to the provider explicitly selected and configured by the user:

### GitHub

GitHub API and Gist services are used for synchronization and optional extension-package backup. New synchronization Gists created by the extension are private by default.

### Google Drive

Google Drive is used for synchronization and optional extension-package backup after the user authorizes access. The extension requests the drive.file scope for application-managed files.

### WebDAV

The extension can send synchronization or package-backup data to the WebDAV server URL and folder configured by the user. WebDAV access credentials are provided and controlled by the user.

### GitHub repository package backup

When selected by the user, extension packages can be uploaded to the GitHub repository configured for package backup.

## 4. Local storage

The extension stores configuration and synchronization state locally in the browser, including provider configuration, synchronization revisions, stable synchronization identifiers, conflict state, diagnostics, and authentication state.

Disconnecting a provider removes the corresponding local authorization state where supported. Google Drive disconnection also attempts to revoke the active authorization token.

## 5. Data not included in browser-state synchronization

The synchronization model intentionally excludes:

- Browser passwords.
- Provider authentication credentials and tokens.
- Third-party extension private storage and private settings.
- Unrelated extension-private data.

## 6. Analytics and tracking

Chromium Cloud Sync does not include Google Analytics or another analytics system.

The extension does not collect browsing activity for advertising, tracking, profiling, or unrelated telemetry. URLs and related browser state are processed because they are necessary for the extension's synchronization and restoration features.

## 7. User control

The user decides whether to enable synchronization, which provider to use, whether to enable automatic synchronization, and whether to use extension-package backup.

Users can disconnect configured providers and can delete provider-side synchronization or backup data using the controls provided by the selected provider.

Data stored with a third-party provider is also subject to that provider's own terms, security practices, and retention policies.

## 8. Security

Built-in GitHub and Google endpoints are accessed over HTTPS. Authentication uses the mechanisms supplied by the selected provider.

The current synchronization payload is not end-to-end encrypted. Users should therefore treat access to their configured synchronization backend as access to their synchronized browser-state data.

## 9. Policy changes

This Privacy Policy may be updated when Chromium Cloud Sync's supported features or data-handling practices change. The effective date at the top of this page identifies the current version.

Material changes will be reflected here before the corresponding functionality is published.

## 10. Contact

For privacy questions or requests concerning Chromium Cloud Sync, please use the project's public issue tracker:

<https://github.com/CYoJkoY/ChromiumCloudSync/issues>

Do not post passwords, access tokens, private Gist contents, or other sensitive information in a public issue.

---

Project repository: <https://github.com/CYoJkoY/ChromiumCloudSync>
