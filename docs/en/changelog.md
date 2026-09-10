# Release history

**English** · [Français](../changelog.md) · [← Back to README](../../README.md)

Changes by version. See [GitHub releases](https://github.com/zerr0o/prime-agent-studio/releases) for installers and source archives.

## 3.1.4

- **Collapse or expand all nested tasks** from inside each Roadmap plan. The plan stays open, with its main tasks and completion counts visible.
- **Model and thinking choices per conversation**: selections are saved with the conversation and restored on reload or another device. Delayed history responses cannot undo a confirmed change.
- **Change thinking while the agent works**: the new level applies to subsequent model calls without interrupting the current tool or changing global defaults. Model selection remains available between runs. [Configuration guide](configuration.md).

## 3.1.3

- **Reliable Windows folder selection**: the native picker is attached to the Tauri window. Selecting or cancelling allows another attempt; closing the browser form cancels its pending selection and preserves newly entered fields.
- **Open the project folder** directly from the workspace’s **Files** tab, beside **Refresh**. Remote access clearly identifies the host PC; read-only access cannot open folders.

## 3.1.2

- **Expanded Roadmap**: open a view across the workspace, then return to the side panel using the reduce button or Escape.
- **Compact lists**: collapse categories and parent tasks while keeping their completed/total count at the end of the row. Descriptions are hidden by default and open with **Show description**.
- **Reading state preserved**: collapsed items stay in place during refreshes. Controls work with keyboards and phones. [Roadmap guide](roadmap.md).

## 3.1.1

- **MCP tests in the Windows app** now find Python in the persistent application data folder, including after an update. If Python has not been prepared yet, Studio sets it up automatically before discovering tools. [MCP guide](mcp.md).

## 3.1.0

- **Project Roadmap**: organize milestones, plans, nested checklists and a backlog in a shared panel on desktop and phone.
- **From planning to conversation**: choose **Work on this** to start or continue work with Prime Agent. Follow declared agent activity and return to the linked conversation, including subagent history.
- **Native agent tools**: six tools use the same project document as the interface. Revision checks protect concurrent edits, and drafts remain recoverable after a conflict. Opening the panel starts no model call.
- **Project knowledge within reach**: consult native memories and refinements from the panel, or export the Roadmap as Markdown. [Roadmap guide](roadmap.md).

## 3.0.1

- **Native Prime Agent 0.9.4 catalog**: Studio uses the installed engine’s available model registry, including thinking levels. Refresh the catalog directly from the model picker.
- **OpenRouter availability**: models removed from the public catalog are marked unavailable. A discontinued free variant remains distinct from its paid equivalent; Studio never switches automatically. Custom endpoint connections are preserved.
- **Choices preserved**: refreshing keeps the selection, favorites, search and draft. If the network fails, the catalog remains readable and can be retried. [Provider guide](providers.md).

## 3.0.0

- **Projects and conversations together**: conversations appear beneath collapsible projects in one sidebar, with pinned projects first and **Show more** for older sessions. Search, archives, unread indicators and project reordering remain within reach. Collapsing a project keeps the active conversation and its draft open. On phones, tapping a project name expands or collapses it while keeping the sidebar open; selecting a conversation closes it. Conversation actions also open with a right-click on desktop. [Navigation guide](navigation.md).
- **Project knowledge**: find past work from **Session** in the right panel, the project overview or its **⋯** menu. Search text, filter results and read the exact native source, with a link to the original conversation when available. Browsing also works on phones and through authenticated read-only access. [Knowledge guide](knowledge.md).
- **Native memories and refinements**: read session memories and recorded before/after changes. Global records are labelled **Global** and remain shared across projects by Prime Agent. Browsing leaves the native records unchanged.
- **History tools for agents**: new Studio runs and their subagents can search and read relevant project sources on demand. Text search needs no model call, and a local cache avoids rereading unchanged conversations. The full history is not automatically added to the agent’s context.

## 2.9

- **2.9.3 updates from Preferences**: **Preferences → Updates** shows application and server versions, release notes and signed installation. Optionally restart the server afterward; active agents require confirmation. The tray’s app settings retain these controls when an older server is still running.
- **2.9.3 Windows fixes**: web links and Codex sign-in open in the default browser; files and images can be dropped into the conversation. Completed empty responses are hidden without changing the native history.
- **2.9.2 version fix**: system settings and health checks read the version from the server’s packaged metadata. Version 2.9.0 incorrectly displayed 2.8.1 even when its new server was running. An older server that is still active continues to report its own version until restarted.
- **Agent messages**: compact, collapsed previews with the sender’s name. Click to read the full message and delivery details. Automatic queued messages are clearly identified and protected from editing or removal.
- **Project order**: drag projects directly in the sidebar with a mouse, or use the handle on touchscreens. The order is saved across devices.
- **Shared unread state**: reading a response on desktop clears its indicator on the phone and vice versa, including read-only remote access.
- **Long Codex sessions**: renew aging idle WebSocket connections between requests and clear transient failure states after a successful native retry. Active requests are preserved.
- **Restrained presentation**: readable text and discreet labels, without colored side borders. Desktop/mobile, French/English and light/dark rendering reviewed.

## 2.8

- **2.8.1 packaging fix**: the Windows installer now includes the workers used by messages, skills, providers and MCP, plus the folder/file helpers. Updating also restores the missing files in the original 2.8.0 server cache without restarting its agents.
- **Tauri 2 Windows application**: per-user installer, desktop and Start menu shortcuts, bundled Node.js and a crisp icon sized for Windows displays.
- **Background work**: the shortcut starts the server or reuses the active instance. Closing or quitting the application lets agents keep working. Start with Windows is optional and disabled by default.
- **Migration and remote access**: reuse projects and settings from an existing installation. LAN, Tailscale, HTTPS, QR codes and the mobile PWA remain available.

[Installation, migration and updates](desktop.md).

## 2.6

- **Project folder**: **Choose folder** in the add-project dialog opens the Windows picker and fills in the path. Your project name is preserved; cancelling leaves the form unchanged.
- **Skills and prompts**: both tabs in **Commands and skills** offer **Global · All projects** or **Selected project**, followed by **Open folder**. A missing folder is created on demand.
- **Desktop and remote access**: the Windows picker is available in local Studio. Resource folders can also be opened from a remote connection with full control, on the host PC.
- **Bilingual documentation**: the README and guides are available in French and English.

## 2.5

- **French and English**: choose **Automatic / Français / English** in preferences or on the mobile sign-in page, with browser language detection.
- **Instant switching**: conversations, drafts, attachments and forms keep their contents, and running responses continue. Tabs at the same address share the language choice.
- **One table**: 1,051 messages keep their translations side by side. Parameters, plurals and references are checked automatically; missing or empty translations fall back to French.
- **Mobile and PWA**: sign-in, errors, sign-out, installation information and the offline screen follow the selected language.
- **More languages can be added**: the [translation guide](translations.md) explains how to extend the table and check the interface.
