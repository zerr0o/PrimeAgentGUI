# Install Prime Agent Studio

**English** · [Français](../pwa.md) · [← Back to README](../../README.md)

The PWA opens Studio with an icon and a dedicated window. It uses the same engine on the PC, the same sessions and the same access code as the remote website.

## Prepare the HTTPS address

Connect the PC and phone to the same Tailscale network, with MagicDNS enabled. From the project folder on the PC:

```powershell
npm run pwa:enable
```

The command configures **Tailscale Serve in private mode**, preserves the existing code and displays this PC’s HTTPS address. If no remote access exists, it prepares and displays a code. If Tailscale asks you to enable HTTPS for the account, follow its link, then run the command again. An existing service on HTTPS port 443 is preserved; the script reports the conflict.

**After runs finish**, apply the configuration:

```powershell
npm stop
npm run start:silent
```

Open the displayed `https://pc-name.network-name.ts.net` address. HTTP addresses on a LAN or Tailscale IP still work for the website, but HTTPS is required for full installation on the phone.

## Install on each device

| Device        | Installation                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Android       | Open the HTTPS address in Chrome, then choose **Install Studio** on the access page or in the sidebar. The browser menu also offers **Install app** or **Add to Home screen**. |
| iPhone / iPad | Open the address in Safari, use **Share → Add to Home Screen**, then enable **Open as Web App** if offered.                                                                    |
| PC            | Open Studio in Chrome or Edge, then use **Install Studio** or the browser’s install command. The local `http://127.0.0.1:3088` address also works on the PC.                   |

Once installed, open the Prime Agent icon. The code may be requested again in this window. Install from a normal browser window; private browsing does not support installation.

**Install Studio** opens the native installation dialog when available. Otherwise, it shows device-specific instructions. The button disappears when Studio is running as a standalone application.

## Connection, drafts and updates

The PC must stay on with the server running to send messages or follow agents. Remotely, Tailscale must be connected on both devices. Closing the PWA leaves runs working on the PC.

The reconnection screen becomes available after a first successful visit. If the network or PC becomes unreachable, it prompts you to check connectivity and **Try again**. Conversations, tool results and sent files are not cached by the PWA. Already-saved drafts remain in this device’s storage, just as on the website.

HTTP and HTTPS addresses and different browsers have separate storage: local drafts are not transferred between them automatically. Sessions stored on the PC remain shared.

The interface is read from the server when opened; no automatic reload is imposed during a session. After updating server code, restart once runs finish, then reload the application.

## Gateway and configuration

Tailscale Serve terminates HTTPS and forwards requests to port **3090 on `127.0.0.1`**. This gateway retains access-code and permission checks. It does not expose desktop-only configuration routes. The engine remains on `127.0.0.1:3088`. No public exposure through Funnel is configured.

Configuration is in `.local/lan-access.json`, under `tailscale.https`: `enabled`, `origin` and `port`. Existing LAN and Tailscale HTTP access remain independent. To disable the PWA gateway, set `tailscale.https.enabled` to `false`, then restart after runs finish. If Serve only serves Studio on 443, `tailscale serve --https=443 off` also removes this HTTPS listener.

For troubleshooting, check `.local/logs/server.log` and `tailscale serve status`. The `pwa:enable` command is reusable; it refuses to replace another service or a public Funnel configuration on the same address.

[PWA installation requirements — MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) · [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
