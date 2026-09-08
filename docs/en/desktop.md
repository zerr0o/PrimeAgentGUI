# Windows application

**English** · [Français](../desktop.md) · [← Back to README](../../README.md)

The **Prime Agent Studio** application, built with Tauri 2, opens Studio in a dedicated Windows window. Its shortcut silently starts the server or reuses the running instance. There is no need to launch the VBS manually.

## Installation and first launch

Run `Prime Agent Studio_2.8.0_x64-setup.exe`. Installation is limited to your Windows user and offers Start menu and desktop shortcuts. Node.js is included. The installer installs WebView2 when needed; this component may require an Internet connection.

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

## Data and updates

Data is stored in `%LOCALAPPDATA%\com.primeagent.studio`:

| Location       | Contents                                                            |
| -------------- | ------------------------------------------------------------------- |
| `data`         | Projects, attachments, hashed PIN, network settings and server logs |
| `.local`       | Persistent Python kernels                                           |
| `versions`     | Immutable copies of server files and Node.js                        |
| `webview`      | Window preferences and storage                                      |
| `desktop.json` | Launcher preferences and installation to migrate                    |

An update installs the new application and prepares a new server copy when the next startup is needed. A running server remains in use: the new server version takes effect after you deliberately stop it when your runs have finished. Old copies are not automatically removed, preserving any processes still using them.

Locally built installers are not digitally signed. Publishing a signed installer requires a Windows signing certificate; automatic updates are not configured in this first version.

## Build and verify

On Windows, install Rust/MSVC and the [Tauri 2 development prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```powershell
npm ci
npm run desktop:build
```

The installer is in `src-tauri/target/release/bundle/nsis`. `npm run desktop:dev` prepares resources and starts the development build. `npm run desktop:icons` regenerates icons from the SVG; the 256 px frame must stay first in the ICO used by Tauri.

`npm run test:desktop` tests the previously compiled debug executable: reusing a server with an active simulated agent, starting the bundled server, single instance behavior and server survival when the Tauri process closes. Pass another executable path after `--` to test a different build. `npm run test:desktop-ui` checks presentation changes in Chrome/Edge. Tests make no paid model calls.

For isolated tests, `PRIME_STUDIO_DESKTOP_DATA_ROOT` and `PRIME_STUDIO_DESKTOP_PORT` override the data folder and port. Leave them unset for normal use. VBS remains available for source installations.
