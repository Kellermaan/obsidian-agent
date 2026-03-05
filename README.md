# Obsidian Agent

An agent plugin for [Obsidian](https://obsidian.md).

## Features

- Adds a ribbon icon that shows a notice when clicked.
- Adds commands accessible via the Command Palette:
  - **Open modal (simple)** – opens a sample modal dialog.
  - **Open modal (complex)** – opens a modal when a Markdown file is active.
  - **Replace selected content** – replaces the current editor selection with sample text.
- Adds a settings tab where you can configure the plugin.

## Installation

### From the Obsidian Community Plugin Browser (recommended)

1. Open Obsidian and go to **Settings → Community plugins**.
2. Make sure **Safe mode** is off.
3. Click **Browse** and search for **Obsidian Agent**.
4. Click **Install**, then **Enable**.

### Manual installation

1. Download the latest release from the [Releases page](https://github.com/Kellermaan/obsidian-agent/releases).
2. Extract (or copy) `main.js`, `manifest.json`, and `styles.css` into your vault at:
   ```
   <YourVault>/.obsidian/plugins/obsidian-agent/
   ```
3. Reload Obsidian (Ctrl/Cmd + R, or close and reopen).
4. Go to **Settings → Community plugins**, find **Obsidian Agent**, and enable it.

## Usage

1. After enabling the plugin, click the **dice** icon in the left ribbon to trigger a notice.
2. Open the Command Palette (`Ctrl/Cmd + P`) and search for **Obsidian Agent** to see available commands.
3. Configure the plugin under **Settings → Obsidian Agent**.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (bundled with Node.js)

### Setup

```bash
# Clone the repository into your vault's plugins folder for live testing
git clone https://github.com/Kellermaan/obsidian-agent.git \
  <YourVault>/.obsidian/plugins/obsidian-agent

cd obsidian-agent
npm install
```

### Development build (watch mode)

```bash
npm run dev
```

Obsidian will pick up changes automatically. Use the **Reload app without saving** command or restart Obsidian to apply them.

### Production build

```bash
npm run build
```

Output: `main.js` in the repository root.

### Lint

```bash
npm run lint
```

## Releasing a new version

1. Update `minAppVersion` in `manifest.json` if the plugin requires a newer Obsidian API.
2. Run one of the following to bump the version and update `manifest.json` / `versions.json`:
   ```bash
   npm version patch   # 1.0.0 → 1.0.1
   npm version minor   # 1.0.0 → 1.1.0
   npm version major   # 1.0.0 → 2.0.0
   ```
3. Push the commit **and** the generated version tag:
   ```bash
   git push && git push --tags
   ```
4. The [Release CI workflow](.github/workflows/release.yml) will automatically:
   - Build the plugin.
   - Create a GitHub Release for the tag.
   - Attach `main.js`, `manifest.json`, and `styles.css` as release assets.

## Contributing

Pull requests are welcome. Please open an issue first to discuss significant changes.

## License

[0-BSD](LICENSE)

