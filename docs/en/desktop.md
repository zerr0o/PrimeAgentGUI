# Windows application

**English** · [Français](../desktop.md) · [← Back to README](../../README.md)

The **Prime Agent Studio** application, built with Tauri 2, opens Studio in a dedicated Windows window. Its shortcut silently starts the server or reuses the running instance. There is no need to launch the VBS manually.

## Installation and first launch

Run [Prime-Agent-Studio_3.1.2_x64-setup.exe](https://github.com/zerr0o/prime-agent-studio/releases/download/v3.1.2/Prime-Agent-Studio_3.1.2_x64-setup.exe). Installation is limited to your Windows user and offers Start menu and desktop shortcuts. Node.js is included. The installer installs WebView2 when needed; this component may require an Internet connection.

**Prime Agent and uv are still required on the PC**, with a configured provider. The installer does not reinstall or replace the Prime Agent engine, accounts or sessions. Studio prepares the Python kernel when needed for runs, as the browser version does.

On first launch, choose **Open Studio**. If you previously used the checkout with the VBS launcher, first select **Use an existing installation** and choose its folder containing `server.mjs` and `.local`.

Migration copies projects, subagent defaults, attachments and remote access settings, including the PIN. The original installation remains intact. If its server is running, the application connects immediately and postpones copying until the first launch when that server is stopped. It interrupts no runs. Prime Agent sessions remain in their usual location. After migration, use the application to open Studio; the old launcher retains its own copy of the settings.

Browser appearance preferences and drafts are not copied: the Tauri window has its own persistent storage.

## Window and background work

- **Closing the window** hides it and keeps the icon near the clock. Agents, the server and mobile access continue.
- Clicking this icon or launching the shortcut again brings back the same window.
- The icon’s menu offers **Open Studio**, **App settings** and **Quit application**. Quitting closes Tauri but leaves the server and agents working.
- In **App settings**, **Start with Windows** is disabled by default. Enabling it starts Studio in the background when you sign in, without opening its window. A startup error shows the window so you can retry.
- External links open in your usual browser. LAN, Tailscale, HTTPS and the mobile PWA still use the same server.

To reconnect to a stopped server, open **App settings → Open Studio**. This button reuses an existing instance and never stops agents.

A Windows shortcut can use the `--settings` argument to open application settings directly, including when the app is already running in the background.

## Data and updates

Data is stored in `%LOCALAPPDATA%\com.primeagent.studio`:

| Location       | Contents                                                            |
| -------------- | ------------------------------------------------------------------- |
| `data`         | Projects, attachments, hashed PIN, network settings and server logs |
| `.local`       | Persistent Python kernels                                           |
| `versions`     | Immutable copies of server files and Node.js                        |
| `webview`      | Window preferences and storage                                      |
| `desktop.json` | Launcher preferences and installation to migrate                    |

An update installs the new application and prepares a new server copy. **Preferences → Updates** distinguishes the installed application version from the running server version. Old copies are not automatically removed, preserving any processes still using them.

**Upgrading to 3.0.0:** if the previous server stays running after installation, Studio still shows that server’s version and features. Wait for agents to finish, then use **Preferences → Updates → Restart server** in the Windows application to load V3. [Collapsible project navigation](navigation.md) and [project knowledge](knowledge.md) then become available; new runs and their subagents receive the history search and reading tools.

The **2.8.1** fix adds a one-time startup repair: the ten helpers omitted from release 2.8.0 are added to its original cache, even while its server is running. Existing files are preserved. This restores messages, skill discovery and providers without stopping agents.

In Studio, open **Preferences → Updates → Check for updates**. When a newer stable version is published on GitHub, its release notes and an **Install and relaunch** button appear. Download progress is displayed, then Tauri verifies the signature before starting installation. Installation requires this explicit click.

The **Restart the server after installation** option applies the new version when the server is idle. If agents are still working, the server stays running and settings open after relaunch. **Restart server** then displays a confirmation: restarting may interrupt runs and will temporarily disconnect devices. Projects and saved history are preserved. Activity is checked again before stopping; a server started by another installation is not stopped.

These controls also remain available in **App settings** through the tray icon, even when the older server does not yet have the new category. In a browser or on a phone, the page directs you to the Windows application to install or restart.

Web links, including Codex sign-in, open in the default browser. File drops use the HTML composer directly, without another file bridge. Only update and restart commands are allowed from the local Studio window; other native settings remain restricted to the launcher.

A network error, missing catalog or invalid signature is never reported as “up to date”. You can retry; technical details are in `desktop-update-error.log` in the data folder. The catalog becomes available with the first release containing `latest.json`. Checking is manual, with no periodic background polling.

Updates carry a Tauri cryptographic signature. Installers do not yet carry a Windows Authenticode signature, which requires a separate Windows certificate.

## Build and verify

On Windows, install Rust/MSVC and the [Tauri 2 development prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```powershell
npm ci
npm run desktop:build
```

The installer is in `src-tauri/target/release/bundle/nsis`. `npm run desktop:dev` prepares resources and starts the development build. `npm run desktop:icons` regenerates icons from the SVG; the 256 px frame must stay first in the ICO used by Tauri.

The build validates module, worker and native helper references before creating the installer. `npm run test:desktop-runtime` exercises the resources prepared in `.desktop-build` using real Prime Agent workers and an isolated project and account storage: Python skills, prompts and providers.

`npm run test:desktop` tests the previously compiled debug executable: resources extracted by the executable, messages and the Python kernel using a simulated local HTTP model, provider and command APIs, reusing a server with an active simulated agent, starting the bundled server, single instance behavior and server survival when the Tauri process closes. Prime Agent and uv must be available. Pass another executable path after `--` to test a different build. `npm run test:desktop-ui` checks presentation changes in Chrome/Edge. Tests make no paid model calls.

For isolated tests, `PRIME_STUDIO_DESKTOP_DATA_ROOT` and `PRIME_STUDIO_DESKTOP_PORT` override the data folder and port. Leave them unset for normal use. VBS remains available for source installations.

`npm run test:desktop-folder-picker` checks the real Windows folder dialog, its Tauri owner, selection and cancellation. First build with `node scripts/build-desktop.mjs --debug --no-bundle --config test/fixtures/desktop-picker/tauri.conf.json`, then set `PRIME_STUDIO_TEST_EXE` to the resulting executable’s absolute path. The test refuses the production identity, uses temporary directories and a port, and closes only its own process.

`npm run test:desktop-updates` and `npm run test:settings-updates` check both panels in French and English. `npm run test:desktop-lifecycle` validates a real Tauri restart with a busy server, confirmation, preserved data and activation of the installed version. `cargo test --manifest-path src-tauri/Cargo.toml --locked` tests the actual updater client against a local server: valid signature, tampered file, equal/older versions and invalid catalog. Tests never execute an installer.

For native tests alongside your application, compile a separate test identity: `$env:TAURI_CONFIG = '{"identifier":"com.primeagent.studio.interaction-test"}'`, then `cargo build --manifest-path src-tauri/Cargo.toml --locked`. Remove the variable afterward (`Remove-Item Env:TAURI_CONFIG`) before a distribution build. `npm run test:desktop-interactions` tests web and synthetic OAuth links, attachments, clipboard, export and permissions in actual WebView2. It opens test tabs in the default browser without signing into an account.

## Prepare an update release

The private signing key stays outside the repository, in `%USERPROFILE%\.tauri\prime-agent-studio.key` on the release machine. Back it up securely: installed applications trust its embedded public key, and an incompatible replacement key would prevent updates. `desktop:build` uses this local key or `TAURI_SIGNING_PRIVATE_KEY` (path or content) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Without a key, `npm run desktop:build -- --no-bundle` builds only the executable.

After a signed build, run `npm run desktop:manifest -- path/notes.md` (notes are optional). `.local/desktop-release/v<version>` contains the three files to attach together to stable release `v<version>`: the installer with a space-free name, its `.sig` signature and `latest.json`. Do not rename the installer afterward: the catalog contains its exact URL.

The GitHub **Windows desktop release** workflow runs manually with an existing stable tag matching `package.json`. It tests, builds, signs and prepares a **draft release** containing these three files. Configure repository secrets `TAURI_SIGNING_PRIVATE_KEY` and, for an encrypted key, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. It refuses to overwrite a published release. Review the draft, then publish it as the latest stable release to make the update available. Do not subsequently publish a stable release without its catalog and installer.
