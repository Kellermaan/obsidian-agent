# Obsidian Agent

Obsidian Agent is an AI assistant plugin for Obsidian.
It supports normal chat workflows and an agent workflow that can perform controlled file operations in your vault.

![Obsidian Agent](https://via.placeholder.com/800x400?text=Obsidian+Agent+Placeholder)

## Features

- Chat sidebar with streaming responses.
- Multi-session conversation management.
- Context attachments from notes and editor selections.
- Provider support:
	- Openai service
	- Anthropic service
	- Custom openai-compatible service
	- Custom anthropic-compatible service
- Agent mode with tool calling for vault operations.
- Optional write confirmation for write-like actions.
- One-click revert for operations created by a completed agent response.
- Copy button and selectable message text for easy reuse.

## What Agent Mode Can Do

When agent mode is enabled in the chat input area, the model can call tools to:

- List files
- Read files
- Write files
- Append to files
- Create folders
- Rename files or folders

Write-like actions can require explicit approval depending on settings.

## Installation

### From Community Plugins (Coming Soon)
1. Open **Settings** > **Community plugins**.
2. Turn off **Restricted mode**.
3. Click **Browse** and search for "Obsidian Agent".
4. Click **Install** and then **Enable**.

### Manual Installation
1. Download the latest release from the [Releases](https://github.com/your-repo/obsidian-agent/releases) page.
2. Extract the main.js, manifest.json, and styles.css files.
3. Move them to your vault's plugin folder: `.obsidian/plugins/obsidian-agent/`.
4. Reload Obsidian and enable the plugin.

## Quick Start

1. Open the chat view with the left ribbon bot icon or the command Open chat.
2. Configure provider, model, and API key in Settings -> Obsidian Agent.
3. Start with normal chat, then enable agent mode when you need file operations.
4. Attach note or selection context before asking vault-specific questions.

## Usage

### 1. Configuration

Open Settings -> Obsidian Agent and configure:

- Provider: Openai service, Anthropic service, Custom openai-compatible service, or Custom anthropic-compatible service.
- API key: Provider key (optional for some local deployments).
- Base URL: Required for custom providers.
- Model: Any provider-supported model identifier.
- System prompt: Global behavior instruction.
- Temperature and max tokens.
- Require confirmation before write actions.

### 2. Chat with Agent

- Click the bot icon in the left ribbon.
- Or run the command Open chat.

### 3. Commands and context entry points

- Explain selection:
	- Select text in editor.
	- Run the command Explain selection.
- Add current note to agent context:
	- Run the command Add current note to agent context.
- File menu:
	- Right click a note and select Add note to agent context.
- Editor menu:
	- Select text, right click, then select Add selection to agent context.

### 4. Conversation workflow

- Create and switch between conversations from the sidebar.
- Attach multiple context items to the active conversation.
- Remove individual context items from chips.
- In agent responses, use Revert to undo all operations recorded for that response.

## Safety Model

- Write confirmation:
	- If enabled, the plugin asks for approval before write_file, append_file, create_folder, and rename_path.
- Revert support:
	- Completed agent messages can store undo operations.
	- Revert applies undo operations in reverse order.
- Vault scope:
	- Operations are intended to target vault paths only.

## Provider Notes

- Openai service and custom openai-compatible service use a chat/completions style API.
- Anthropic service and custom anthropic-compatible service use a messages style API.
- For custom providers, set a base URL such as:
	- Openai-compatible: https://your-host/v1
	- Anthropic-compatible: https://your-host/v1
- The plugin appends endpoint paths automatically.

## Data Storage

- Settings and chat history are persisted using Obsidian plugin data APIs.
- Conversation state includes messages, context attachments, and undo metadata.

## Development

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Run development watch build:

```bash
npm run dev
```

4. Run production build:

```bash
npm run build
```

5. Run lint:

```bash
npm run lint
```

## Release

1. Update plugin version in manifest.json.
2. Update versions.json to map plugin version to minAppVersion.
3. Create a GitHub release tag that exactly matches the plugin version (no v prefix).
4. Upload release assets:
	 - main.js
	 - manifest.json
	 - styles.css

## Known Limitations

- Clipboard APIs may not always be available in every environment.
- Tool-calling quality depends on model capability.
- Custom provider compatibility depends on endpoint behavior.

## Privacy and Security

- This plugin can call external model APIs when configured.
- Review provider privacy policies before sending sensitive content.
- Use write confirmation when testing new models or prompts.

## License

MIT License
