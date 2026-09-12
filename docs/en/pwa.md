# Install Prime Agent Studio

**English** · [Français](../pwa.md) · [← Back to README](../../README.md)

The PWA opens Studio with an icon and a dedicated window. It uses the same engine on the PC, the same sessions and the same access code as the remote website.

## Prepare the HTTPS address

Connect the PC and phone to the same Tailscale network. On the PC, open **Preferences → Remote access** and enable **Tailscale HTTPS**.

The panel configures **Tailscale Serve in private mode**, preserves the existing code and displays the HTTPS address and its QR. If no remote access exists, it creates a code shown once without enabling LAN or HTTP Tailscale access. Activation applies immediately, without restarting or interrupting agents.

If MagicDNS or HTTPS needs account approval, use **Open Tailscale**, follow Tailscale’s instructions, then return and click **Try again**. Another service on HTTPS port 443 or a public Funnel configuration is preserved; the panel reports the conflict.

Open the displayed `https://pc-name.network-name.ts.net` address or scan its QR with Tailscale connected on the phone. HTTP addresses on a LAN or Tailscale IP still work for the website, but HTTPS is required for full installation on the phone.

### Command-line alternative

From the project folder on the PC:

```powershell
npm run pwa:enable
```

The command preserves the existing code or creates one. If Tailscale requests account approval, follow its link, then run the command again. It also refuses to replace another service.

Unlike the panel, this command requires a restart. **After runs finish**, apply the configuration:

```powershell
npm stop
npm run start:silent
```

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

Configuration is in `.local/lan-access.json`, under `tailscale.https`: `enabled`, `origin` and `port`. Existing LAN and Tailscale HTTP access remain independent. **Connection options** lets you change the gateway’s local port, 3090 by default, without changing the HTTPS address visible within your Tailscale network.

Disabling the **Tailscale HTTPS** switch immediately closes the local gateway without interrupting agents. The private Serve forwarding remains configured for reactivation; it no longer grants access to Studio while the gateway is closed. If Serve only serves Studio on 443, `tailscale serve --https=443 off` also removes this HTTPS listener.

For troubleshooting, check `.local/logs/server.log` and `tailscale serve status`. The `pwa:enable` command is reusable; it refuses to replace another service or a public Funnel configuration on the same address.

## Mobile notifications (closed PWA)

**Preferences → Notifications → Mobile notifications** enables **Questions** and **Turn ends** alerts on this device. Subscription is per device and off by default.

How it works: the PWA subscribes via Web Push VAPID, the server sends a generic encrypted notification (no project, no prompt, no question content), the service worker always displays it and a click reopens the relevant session. If the PWA is in the foreground, sending is skipped on a best-effort basis via a short presence lease; a notification already received stays displayed (`userVisibleOnly` browser constraint).

Requirements: PWA installed from the Tailscale HTTPS address, notifications allowed, PC on with active server, Tailscale connected on both sides. On iPhone/iPad: iOS 16.4+, Safari, Share → Add to Home Screen, then open from the icon and allow. Read-only devices may subscribe without gaining answer rights.

Privacy and security: generic text only, browser-vendor relay (Google/Apple/Mozilla) required, only recognized push hosts accepted (no redirects, no local/private/custom hosts), bounded subscription count, per-device ownership token, no enumeration or endpoint/key logging. Subscription persists after sign-out until explicitly disabled; expired subscriptions (404/410) are purged.

If the device lost its token (cleared storage): the server refuses proofless re-registration and never transfers the old registration. To recover, disable then re-enable alerts: this revokes the browser registration (the old endpoint dies with it) and creates a fresh one. Never bypass this proof server-side.

[PWA installation requirements — MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) · [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)

## Optional passkey sign-in

On the mobile Tailscale HTTPS address, sign in with your Studio code, then open **Preferences → Remote access → Create a passkey**. Name the key, confirm the current eight-digit access code, and approve the device prompt. Depending on the device, this uses Face ID, a fingerprint or its unlock PIN. Your password manager may synchronize the key.

Next time, choose **Sign in with a passkey** on the sign-in page. The access code remains available as a fallback. From the PC, the same preferences section lets you revoke keys and disconnect sessions authenticated with them. Changing the Studio access code invalidates existing keys; register again afterward. Passkeys are tied to the exact HTTPS address and are unavailable over LAN HTTP.
