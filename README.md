# Obsidian Agent

An AI assistant plugin for Obsidian, designed to integrate seamlessly into your workflow. Similar to GitHub Copilot but for your personal knowledge base, it supports real-time chat, context-aware explanations, and customizable LLM providers.

![Obsidian Agent](https://via.placeholder.com/800x400?text=Obsidian+Agent+Placeholder)

## Features

- **💬 Chat Interface**: A dedicated sidebar view for interacting with the AI.
- **🤖 Multiple Providers**: Support for **OpenAI** and **Custom** providers (compatible with LocalAI, Ollama, etc.).
- **⚡ Real-time Streaming**: Experience fast, typewriter-style responses.
- **📝 Editor Integration**: Select text and ask the AI to explain, summarize, or rewrite it using the "Explain Selection" command.
- **🔄 Multi-Session Support**: Manage multiple conversation histories.
- **⚙️ Highly Configurable**: Customize models, temperature, system prompts, and more.

## Installation

### From Community Plugins (Coming Soon)
1. Open **Settings** > **Community plugins**.
2. Turn off **Restricted mode**.
3. Click **Browse** and search for "Obsidian Agent".
4. Click **Install** and then **Enable**.

### Manual Installation
1. Download the latest release from the [Releases](https://github.com/your-repo/obsidian-agent/releases) page.
2. Extract the `main.js`, `manifest.json`, and `styles.css` files.
3. Move them to your vault's plugin folder: `.obsidian/plugins/obsidian-agent/`.
4. Reload Obsidian and enable the plugin.

## Usage

### 1. Configuration
Go to **Settings** > **Obsidian Agent** to configure your LLM provider:
- **Provider**: Choose `OpenAI` or `Custom`.
- **API Key**: Enter your OpenAI API key (or leave empty for some local providers).
- **Model**: Enter the model name (e.g., `gpt-4`, `gpt-3.5-turbo`, `llama2`).
- **System Prompt**: Customize how the AI behaves.

### 2. Chat with Agent
- Click the **Bot Icon** in the left ribbon to open the chat view.
- Or use the command palette (`Cmd/Ctrl + P`) and search for **"Obsidian Agent: Open Chat"**.

### 3. Editor Commands
- Select any text in your editor.
- Run the command **"Obsidian Agent: Explain Selection"**.
- The AI will analyze the selected text and provide insights in the chat window.

## Development

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Run `npm run dev` to start the development server in watch mode.

## License

MIT License
