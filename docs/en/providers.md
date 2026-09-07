# Model providers

**English** · [Français](../providers.md) · [← Back to README](../../README.md)

On the PC running Studio, open **http://127.0.0.1:3088 → Preferences → Providers → Manage connections**. This panel is restricted to local PC access: it is unavailable over LAN, Tailscale or the remote PWA, even with full control.

## Accounts and API keys

The list uses the installed Prime Agent catalog, with search by name or ID. It shows known models and the configuration source. **Configured** means an authentication method was found; opening this panel sends no generation request to verify a subscription, quota or key.

- **Connect an account** starts the provider’s native flow. Open the official page with the supplied button, authorize the connection and return to Studio. Depending on the provider, a code, domain or selection may be requested. Manual entry of the code or callback URL is offered when the engine supports it.
- **Add an API key** saves a key in Prime Agent’s native storage. An already-saved key is never prefilled or returned to the browser.
- **Environment variable** stores the name of an existing variable in the server’s environment. The variable must already be defined and nonempty. This panel does not change system variables.

With Prime Agent 0.9.2, available account flows are OpenAI Codex, Anthropic and GitHub Copilot. Access and billing rules remain those of the provider; see the [native provider documentation](https://github.com/PrimeIntellect-ai/prime-agent/blob/v0.9.2/packages/coding-agent/docs/providers.md).

Azure and Cloudflare require additional environment settings. Bedrock and Vertex use their existing cloud settings; guidance in each card explains where to configure them. Custom providers must first be defined in **Models and defaults**.

## Disconnecting and active sessions

**Disconnect** asks for confirmation, then removes only that provider’s saved credentials from `auth.json`. Conversations, custom models, MCP connections and other providers remain in place. Environment variables, `models.json` settings and the Prime CLI connection are not removed, so they may continue to provide access.

For Prime Inference, `PRIME_API_KEY` and Prime CLI configuration take priority over the key saved in `auth.json`.

Adding a provider remains possible while agents are working. Replacing or removing existing credentials waits for Studio’s runs to finish. Agents launched in another terminal share these credentials: wait for their work to finish too before replacing or removing them. The panel stops no sessions and reloads no active workers.

After a successful save, Studio refreshes its model catalog. Prime Agent remains responsible for using and renewing credentials. Closing the sign-in window preserves the ongoing OAuth flow; reopen **Providers** to return to it. **Cancel sign-in** closes only the sign-in process. An unfinished flow expires after five minutes.

## Storage and access

Keys and tokens stay on the PC in the native `~/.prime/agent/auth.json` file. Writes use Prime Agent’s native lock and verify that the provider’s credentials have not changed in the meantime. Concurrent changes to another provider or an MCP are preserved.

Operations run in a hidden Windows process, independently of agents. Entered keys and codes are not put in launch arguments, logs or browser storage. The remote gateway rejects management routes; hiding the button is not the only restriction.

Automated tests use temporary files and fake keys. Native storage and access restrictions are tested directly; OAuth authorizations are simulated so no personal accounts are connected or disconnected.
