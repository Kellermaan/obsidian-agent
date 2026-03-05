import { ItemView, WorkspaceLeaf } from 'obsidian';
import { ChatMessage } from '../types';
import { Agent, AgentCallbacks } from '../ai/agent';
import AgentPlugin from '../main';

export const CHAT_VIEW_TYPE = 'agent-chat-view';

export class ChatView extends ItemView {
private plugin: AgentPlugin;
private agent: Agent;
private history: ChatMessage[] = [];

// DOM elements
private messagesEl!: HTMLElement;
private inputEl!: HTMLTextAreaElement;
private sendBtn!: HTMLButtonElement;
private stopBtn!: HTMLButtonElement;
private contextEl!: HTMLElement;

// State
private isRunning = false;
private currentStreamEl: HTMLElement | null = null;
private abortFlag = false;

constructor(leaf: WorkspaceLeaf, plugin: AgentPlugin) {
super(leaf);
this.plugin = plugin;
this.agent = new Agent(plugin.app, plugin.settings);
}

getViewType(): string { return CHAT_VIEW_TYPE; }
getDisplayText(): string { return 'Agent chat'; }
getIcon(): string { return 'bot'; }

/** Called from the plugin when settings change. */
updateAgent(): void {
this.agent.updateSettings(this.plugin.settings);
}

async onOpen(): Promise<void> {
const container = this.containerEl.children[1] as HTMLElement;
container.empty();
container.addClass('agent-chat-container');

// ── Header ────────────────────────────────────────────────────────────
const header = container.createDiv({ cls: 'agent-header' });
header.createEl('span', { text: '🤖 agent chat', cls: 'agent-header-title' });
const clearBtn = header.createEl('button', { text: 'Clear', cls: 'agent-btn-clear' });
clearBtn.addEventListener('click', () => this.clearHistory());

// ── Messages ──────────────────────────────────────────────────────────
this.messagesEl = container.createDiv({ cls: 'agent-messages' });
this.addSystemBubble(
"Hello! I'm your Obsidian Agent. I can help you write, edit, search, and organise your notes. " +
"Ask me anything, or say 'edit the current note to add a summary' and I'll do it for you."
);

// ── Context indicator ─────────────────────────────────────────────────
this.contextEl = container.createDiv({ cls: 'agent-context' });
this.refreshContext();
this.registerEvent(
this.app.workspace.on('active-leaf-change', () => this.refreshContext())
);

// ── Input area ────────────────────────────────────────────────────────
const inputWrap = container.createDiv({ cls: 'agent-input-wrap' });

this.inputEl = inputWrap.createEl('textarea', {
placeholder: 'Message the agent\u2026 (Enter to send, Shift+Enter for newline)',
cls: 'agent-input',
});
this.inputEl.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.shiftKey) {
e.preventDefault();
void this.sendMessage();
}
});

const btnRow = inputWrap.createDiv({ cls: 'agent-btn-row' });

this.stopBtn = btnRow.createEl('button', { text: 'Stop', cls: 'agent-btn agent-btn-stop agent-hidden' });
this.stopBtn.addEventListener('click', () => {
this.abortFlag = true;
this.setRunning(false);
});

this.sendBtn = btnRow.createEl('button', { text: 'Send \u23CE', cls: 'agent-btn agent-btn-send mod-cta' });
this.sendBtn.addEventListener('click', () => { void this.sendMessage(); });
}

async onClose(): Promise<void> {
this.abortFlag = true;
}

// ── Private helpers ──────────────────────────────────────────────────────

private refreshContext(): void {
this.contextEl.empty();
const f = this.app.workspace.getActiveFile();
this.contextEl.createEl('span', {
text: f ? `📄 ${f.name}` : 'No active note',
cls: 'agent-context-label',
});
}

private clearHistory(): void {
this.history = [];
this.messagesEl.empty();
this.addSystemBubble('Chat cleared. How can I help?');
}

private async sendMessage(): Promise<void> {
const text = this.inputEl.value.trim();
if (!text || this.isRunning) return;

this.inputEl.value = '';
this.addUserBubble(text);
this.history.push({ role: 'user', content: text });

this.abortFlag = false;
this.setRunning(true);

const callbacks: AgentCallbacks = {
onAssistantStart: () => {
if (this.abortFlag) return;
this.currentStreamEl = this.createAssistantBubble();
},
onAssistantToken: (token) => {
if (this.abortFlag || !this.currentStreamEl) return;
this.currentStreamEl.textContent = (this.currentStreamEl.textContent ?? '') + token;
this.scrollToBottom();
},
onAssistantComplete: (content) => {
if (!this.currentStreamEl) return;
// For non-streaming path, set content now
if (content && !this.currentStreamEl.textContent) {
this.currentStreamEl.textContent = content;
}
// Remove empty assistant bubbles (tool-only turns)
if (!this.currentStreamEl.textContent?.trim()) {
this.currentStreamEl.closest('.agent-bubble-assistant')?.remove();
} else {
this.currentStreamEl.classList.remove('agent-bubble-streaming');
}
this.currentStreamEl = null;
this.scrollToBottom();
},
onToolCall: (toolName, args) => {
if (this.abortFlag) return;
this.addToolCallBubble(toolName, args);
},
onToolResult: (toolName, result, success) => {
if (this.abortFlag) return;
this.addToolResultBubble(toolName, result, success);
},
onError: (error) => {
this.addErrorBubble(error);
},
};

try {
const updated = await this.agent.run(this.history, callbacks);
if (!this.abortFlag) this.history = updated;
} catch (err) {
this.currentStreamEl?.closest('.agent-bubble-assistant')?.remove();
this.currentStreamEl = null;
this.addErrorBubble(err instanceof Error ? err.message : String(err));
} finally {
this.setRunning(false);
}
}

private setRunning(running: boolean): void {
this.isRunning = running;
this.sendBtn.disabled = running;
this.inputEl.disabled = running;
this.stopBtn.classList.toggle('agent-hidden', !running);
this.sendBtn.textContent = running ? '\u2026' : 'Send \u23CE';
}

// ── Bubble factories ─────────────────────────────────────────────────────

private addSystemBubble(text: string): void {
const wrap = this.messagesEl.createDiv({ cls: 'agent-bubble agent-bubble-system' });
wrap.createEl('p', { text, cls: 'agent-bubble-body' });
this.scrollToBottom();
}

private addUserBubble(text: string): void {
const wrap = this.messagesEl.createDiv({ cls: 'agent-bubble agent-bubble-user' });
wrap.createEl('span', { text: 'You', cls: 'agent-bubble-role' });
wrap.createEl('p', { text, cls: 'agent-bubble-body' });
this.scrollToBottom();
}

/** Creates the assistant bubble and returns the body element for streaming. */
private createAssistantBubble(): HTMLElement {
const wrap = this.messagesEl.createDiv({ cls: 'agent-bubble agent-bubble-assistant' });
wrap.createEl('span', { text: 'Agent', cls: 'agent-bubble-role' });
const body = wrap.createEl('p', { cls: 'agent-bubble-body agent-bubble-streaming' });
this.scrollToBottom();
return body;
}

private addToolCallBubble(toolName: string, argsJson: string): void {
let argsStr = argsJson;
try {
const parsed = JSON.parse(argsJson) as Record<string, unknown>;
argsStr = Object.entries(parsed)
.map(([k, v]) => `${k}: ${String(v).substring(0, 120)}`)
.join(', ');
} catch { /* keep raw */ }

const wrap = this.messagesEl.createDiv({ cls: 'agent-bubble agent-bubble-tool' });
wrap.createEl('span', { text: `🔧 ${toolName}`, cls: 'agent-bubble-role' });
wrap.createEl('code', { text: argsStr, cls: 'agent-bubble-body' });
this.scrollToBottom();
}

private addToolResultBubble(toolName: string, result: string, success: boolean): void {
const cls = success ? 'agent-bubble-result-ok' : 'agent-bubble-result-err';
const wrap = this.messagesEl.createDiv({ cls: `agent-bubble ${cls}` });
wrap.createEl('span', {
text: success ? '✅ result' : '❌ error',
cls: 'agent-bubble-role',
});
const preview = result.length > 300 ? result.substring(0, 300) + '…' : result;
wrap.createEl('code', { text: preview, cls: 'agent-bubble-body' });
this.scrollToBottom();
}

private addErrorBubble(error: string): void {
const wrap = this.messagesEl.createDiv({ cls: 'agent-bubble agent-bubble-error' });
wrap.createEl('span', { text: 'Error', cls: 'agent-bubble-role' });
wrap.createEl('p', { text: error, cls: 'agent-bubble-body' });
this.scrollToBottom();
}

private scrollToBottom(): void {
this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
}
}
