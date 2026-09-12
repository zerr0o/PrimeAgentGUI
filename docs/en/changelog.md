# Release history

**English** · [Français](../changelog.md) · [← Back to README](../../README.md)

Changes by version. See [GitHub releases](https://github.com/zerr0o/prime-agent-studio/releases) for installers and source archives.

## 3.2.5

- **Interactive questions**: native requests remain delivered during engine resynchronization or stream backpressure instead of being discarded with display events.
- **Notification sound**: system sound enabled on Windows; PWA notifications are not silent, subject to phone settings. Existing Windows focus rules and preferences are preserved.
- **Applying the fix**: after installing, restart the Studio server once your agents have finished.

## 3.2.4

- **Quota and context over authenticated remote access**: Codex quota and session context stay available from authenticated mobile access through limited, sanitized endpoints. Manual refresh only, linked Codex account (OAuth) required; context shows an honest state when measurement is unavailable.
- **Optional per-device mobile PWA push**: **Preferences → Notifications → Mobile notifications** enables **Questions** and **Turn ends** alerts on this device, even with the PWA closed. Per-device VAPID Web Push subscription, generic text only, off by default. Requirements: PWA installed from the Tailscale HTTPS address, notifications allowed, PC on with active server, Tailscale connected on both sides. On iPhone/iPad: iOS 16.4+, Safari, Share → Add to Home Screen, then open from the icon. [PWA guide](pwa.md).
- **Remote update through the PC**: from remote access, **Preferences → Updates** shows the published version and can request installation on the PC. The PC downloads, verifies the signature, then installs through its signed native updater; the request is refused while agents are active or when access is read-only. Release notes render as sanitized markdown.
- **Validation limits**: no physical-device push or real remote update end-to-end validated.

## 3.2.3

- **Conversation activity in the Roadmap**: each item shows **In progress · …**, with a **+N** control to expand other conversations. Activity also appears under each task and opens its conversation.
- **Subagent thinking field**: label and dropdown stay aligned and full width with the model picker, without overlap.
- **Optional Codex quota**: for OpenAI/Codex models, a block with short and weekly bars and a **Refresh quota** button. Manual checks only, linked Codex account (OAuth) required; API-key models show a note without quota. Unavailable from remote access.
- **Prime Agent context**: the session shows **X / Y tokens (Z%)** with a bar, from the native current context, never the cumulative total. Hidden when unavailable.

## 3.2.2

- **Windows notifications restored**: fixed an initialization crash that prevented monitoring for questions and completed turns from starting. Notification preferences and silence while Studio has focus are preserved.
- **Visible pending questions**: an amber **?** replaces the green activity dot in the conversation list and on its project, including when collapsed. The project view also shows **Question awaiting an answer**.
- **Drafts after sending**: accepted text is cleared even if you switch conversations before sending finishes, including messages sent to an already active agent. A newer draft typed in the meantime is preserved; a failed send does not clear it.

## 3.2.1

- **Questions allowed by default**: choose the initial value in **Preferences → Models & agents**. The default is shared by devices connected to the PC, while each conversation keeps its saved choice.
- **Windows notifications**: independent switches for pending questions and completed turns in **Preferences → Notifications**. Errors follow the completed-turn setting; manual stops stay silent.
- **Quiet in the foreground**: no notification while any Studio window has focus. Silent events are not replayed when focus changes. Monitoring continues while the window is hidden, as long as the application remains open.
- **Choices preserved**: a delayed response cannot replace an acknowledged default. [Configuration guide](configuration.md#windows-notifications).

## 3.2.0

- **Images in agent responses**: display project images inline and click to enlarge. Studio reads the original file without storing an extra copy; moved or deleted images show an unavailable state. Available on desktop and through authenticated mobile access.
- **Native interactive questions**: enable **Allow questions** per conversation. Select a suggested answer, write your own, or skip. Questions use Prime Agent’s native request/reply mechanism, resume the waiting agent and synchronize across connected devices.
- **Details when you need them**: each choice has a short description, collapsed by default. The **Skip** button has a discreet outline. Image loading and incoming questions preserve your reading position.
- **Illustrated documentation**: French and English README captures show both features in a fictional Lotus Elise conversation. [Configuration guide](configuration.md#interactive-questions-and-conversation-images).

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
