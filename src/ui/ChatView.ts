import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import AgentPlugin from '../main';
import { ChatMessage, ChatSession, MessageDisplayInfo, ToolCall } from '../types';
import { AIClient } from '../utils/AIClient';
import { computeLineDiff } from '../utils/DiffUtils';
import { NOTE_TOOLS, NoteToolsHandler } from '../utils/NoteTools';

export const CHAT_VIEW_TYPE = 'agent-chat-view';

const MAX_AGENT_ITERATIONS = 10;
const MAX_NOTE_CONTEXT_CHARS = 8000;
const TOOL_RESULT_PREVIEW_CHARS = 300;
const MAX_SESSIONS = 50;

export class ChatView extends ItemView {
private plugin: AgentPlugin;
private messages: ChatMessage[] = [];
private messageDisplayInfos: MessageDisplayInfo[] = [];
private isProcessing = false;
private editingFromIndex: number | null = null;

// Chat screen elements
private chatScreenEl!: HTMLElement;
private messagesEl!: HTMLElement;
private inputEl!: HTMLTextAreaElement;
private sendBtn!: HTMLButtonElement;
private cancelEditBtn!: HTMLButtonElement;
private statusEl!: HTMLElement;
private contextToggle!: HTMLInputElement;
private editingIndicatorEl!: HTMLElement;

// History screen elements
private historyScreenEl!: HTMLElement;
private historyListEl!: HTMLElement;

constructor(leaf: WorkspaceLeaf, plugin: AgentPlugin) {
super(leaf);
this.plugin = plugin;
}

getViewType(): string {
return CHAT_VIEW_TYPE;
}

getDisplayText(): string {
return 'AI agent';
}

getIcon(): string {
return 'bot';
}

async onOpen(): Promise<void> {
this.buildUI();
}

async onClose(): Promise<void> {
// nothing to clean up
}

// ─── UI construction ────────────────────────────────────────────────────────

private buildUI(): void {
const root = this.containerEl.children[1] as HTMLElement;
root.empty();
root.addClass('agent-root');

this.buildChatScreen(root);
this.buildHistoryScreen(root);
this.showChatScreen();
}

private buildChatScreen(root: HTMLElement): void {
this.chatScreenEl = root.createDiv('agent-chat-screen');

// Header
const header = this.chatScreenEl.createDiv('agent-header');
header.createEl('span', { text: 'AI agent', cls: 'agent-header-title' });
const headerBtns = header.createDiv('agent-header-btns');
const historyBtn = headerBtns.createEl('button', { text: 'History', cls: 'agent-header-btn' });
historyBtn.setAttribute('aria-label', 'Browse chat history');
historyBtn.addEventListener('click', () => this.showHistoryScreen());
const clearBtn = headerBtns.createEl('button', { text: 'New chat', cls: 'agent-header-btn' });
clearBtn.addEventListener('click', () => this.clearChat());

// Message list
this.messagesEl = this.chatScreenEl.createDiv('agent-messages');

// Status bar
this.statusEl = this.chatScreenEl.createDiv('agent-status');
this.statusEl.hide();

// Input area
const inputArea = this.chatScreenEl.createDiv('agent-input-area');

// Context row
const ctxRow = inputArea.createDiv('agent-ctx-row');
this.contextToggle = ctxRow.createEl('input');
this.contextToggle.type = 'checkbox';
this.contextToggle.id = 'agent-ctx-toggle';
this.contextToggle.checked = true;
// eslint-disable-next-line obsidianmd/ui/sentence-case
const ctxLabel = ctxRow.createEl('label', { text: '📎 Include current note', cls: 'agent-ctx-label' });
ctxLabel.setAttribute('for', 'agent-ctx-toggle');

// Editing indicator shown when regenerating from an earlier message
this.editingIndicatorEl = inputArea.createDiv('agent-editing-indicator');
this.editingIndicatorEl.hide();

this.inputEl = inputArea.createEl('textarea', {
cls: 'agent-input',
attr: { placeholder: 'Ask anything about your notes… (Enter to send, Shift+Enter for newline)' },
});
this.inputEl.rows = 3;
this.inputEl.addEventListener('keydown', e => {
if (e.key === 'Enter' && !e.shiftKey) {
e.preventDefault();
void this.onSend();
}
if (e.key === 'Escape' && this.editingFromIndex !== null) {
this.cancelEdit();
}
});

const btnRow = inputArea.createDiv('agent-btn-row');
this.cancelEditBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'agent-cancel-edit-btn' });
this.cancelEditBtn.hide();
this.cancelEditBtn.addEventListener('click', () => this.cancelEdit());
this.sendBtn = btnRow.createEl('button', { text: 'Send', cls: 'agent-send-btn' });
this.sendBtn.addEventListener('click', () => void this.onSend());
}

private buildHistoryScreen(root: HTMLElement): void {
this.historyScreenEl = root.createDiv('agent-history-screen');

// Header
const header = this.historyScreenEl.createDiv('agent-header');
header.createEl('span', { text: 'Chat history', cls: 'agent-header-title' });
// eslint-disable-next-line obsidianmd/ui/sentence-case
const backBtn = header.createEl('button', { text: '← Back', cls: 'agent-header-btn' });
backBtn.addEventListener('click', () => this.showChatScreen());

// Dedicated scrollable container for history items
this.historyListEl = this.historyScreenEl.createDiv('agent-history-list');
}

private showChatScreen(): void {
	this.chatScreenEl.show();
	this.historyScreenEl.hide();
}

private showHistoryScreen(): void {
	this.chatScreenEl.hide();
	this.historyScreenEl.show();
	this.renderHistoryList();
}

private renderHistoryList(): void {
this.historyListEl.empty();

const sessions = this.plugin.settings.chatSessions;
if (sessions.length === 0) {
this.historyListEl.createEl('p', { text: 'No chat history yet.', cls: 'agent-history-empty' });
return;
}

for (const session of sessions) {
const item = this.historyListEl.createDiv('agent-history-item');
item.createEl('div', { text: session.title, cls: 'agent-history-title' });
item.createEl('div', {
text: new Date(session.timestamp).toLocaleString(),
cls: 'agent-history-date',
});
item.addEventListener('click', () => this.loadSession(session));
}
}

private loadSession(session: ChatSession): void {
this.messages = [...session.messages];
this.messageDisplayInfos = [...(session.displayInfos ?? [])];
this.editingFromIndex = null;
this.cancelEdit();
this.reRenderMessages();
this.showChatScreen();
this.scrollToBottom();
}

/**
 * Rebuild the messages DOM from the current this.messages array.
 * Only user and assistant messages are rendered as bubbles; tool and
 * system messages are kept in the array for the API thread only.
 */
private reRenderMessages(): void {
this.messagesEl.empty();
for (let i = 0; i < this.messages.length; i++) {
const msg = this.messages[i]!;
const info = this.messageDisplayInfos[i] ?? {};
if (msg.role === 'user') {
this.appendUserBubble(info.displayText ?? msg.content ?? '', i, info.notePath);
} else if (msg.role === 'assistant' && msg.content) {
const { textEl } = this.appendAssistantBubble();
void MarkdownRenderer.render(this.app, msg.content, textEl, '', this);
}
}
}

// ─── Session saving ──────────────────────────────────────────────────────

private saveCurrentSession(): void {
const nonSystemMsgs = this.messages.filter(m => m.role !== 'system');
if (nonSystemMsgs.length === 0) return;

const firstUserIdx = this.messages.findIndex(m => m.role === 'user');
const firstInfo = firstUserIdx >= 0 ? (this.messageDisplayInfos[firstUserIdx] ?? {}) : {};
const rawTitle =
firstInfo.displayText ?? (firstUserIdx >= 0 ? (this.messages[firstUserIdx]!.content ?? '') : '');
const title = rawTitle.length > 60 ? rawTitle.slice(0, 60) + '…' : rawTitle || 'Untitled chat';

const session: ChatSession = {
id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
title,
timestamp: Date.now(),
messages: [...this.messages],
displayInfos: [...this.messageDisplayInfos],
};

this.plugin.settings.chatSessions = [session, ...this.plugin.settings.chatSessions].slice(
0,
MAX_SESSIONS,
);
void this.plugin.saveSettings();
}

// ─── Send / agent loop ──────────────────────────────────────────────────────

private async onSend(): Promise<void> {
const text = this.inputEl.value.trim();
if (!text || this.isProcessing) return;

if (!this.plugin.settings.apiKey && !this.plugin.settings.apiUrl.includes('localhost')) {
new Notice('API key not set. Open settings to configure the AI agent.');
return;
}

this.inputEl.value = '';

// If editing from a previous point, truncate and re-render up to that point
if (this.editingFromIndex !== null) {
const editIdx = this.editingFromIndex;
this.messages = this.messages.slice(0, editIdx);
this.messageDisplayInfos = this.messageDisplayInfos.slice(0, editIdx);
this.editingFromIndex = null;
this.cancelEdit();
this.reRenderMessages();
}

this.isProcessing = true;
this.sendBtn.disabled = true;

// Build user content — optionally include the active note
let userContent = text;
const activeFile = this.app.workspace.getActiveFile();
if (this.contextToggle.checked && activeFile instanceof TFile) {
const noteContent = await this.app.vault.read(activeFile);
const preview =
noteContent.length > MAX_NOTE_CONTEXT_CHARS
? noteContent.slice(0, MAX_NOTE_CONTEXT_CHARS) + '\n\n[…note truncated…]'
: noteContent;
userContent =
`[Context — current note: ${activeFile.path}]\n` +
'```\n' +
preview +
'\n```\n\n' +
text;
}

const msgIndex = this.messages.length;
this.appendUserBubble(text, msgIndex, activeFile?.path);
this.messages.push({ role: 'user', content: userContent });
this.messageDisplayInfos.push({ displayText: text, notePath: activeFile?.path });

try {
await this.runAgentLoop();
} catch (err) {
this.appendError(String(err));
} finally {
this.isProcessing = false;
this.sendBtn.disabled = false;
this.statusEl.hide();
}
}

private async runAgentLoop(): Promise<void> {
const client = new AIClient(this.plugin.settings);
const tools = new NoteToolsHandler(this.app);

const systemMsg: ChatMessage = {
role: 'system',
content: this.plugin.settings.systemPrompt,
};
const thread: ChatMessage[] = [systemMsg, ...this.messages];

// Up to MAX_AGENT_ITERATIONS agent iterations (guard against runaway loops)
for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
this.showStatus(iter === 0 ? 'Thinking…' : 'Continuing…');

// ── Stream the assistant reply ──────────────────────────────────────
const { msgEl, textEl } = this.appendAssistantBubble();
let streamedText = '';

let result;
try {
result = await client.streamChat(thread, NOTE_TOOLS, chunk => {
streamedText += chunk;
textEl.textContent = streamedText;
this.scrollToBottom();
});
} catch (err) {
msgEl.remove();
throw err;
}

// Finalize: render markdown once streaming is complete
textEl.empty();
if (result.content) {
await MarkdownRenderer.render(this.app, result.content, textEl, '', this);
} else if (result.toolCalls.length === 0) {
textEl.setText('(no response)');
}
this.scrollToBottom();

// Persist assistant turn
const assistantMsg: ChatMessage = {
role: 'assistant',
content: result.content || null,
tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
};
thread.push(assistantMsg);
this.messages.push(assistantMsg);
this.messageDisplayInfos.push({});

if (result.toolCalls.length === 0) break; // No more actions → done

// ── Execute tool calls ─────────────────────────────────────────────
this.showStatus(`Running ${result.toolCalls.length} action(s)…`);

for (const tc of result.toolCalls) {
let args: Record<string, string> = {};
try {
args = JSON.parse(tc.function.arguments) as Record<string, string>;
} catch {
args = {};
}

let toolResult: string;

if (tc.function.name === 'write_note' && !this.plugin.settings.autoApplyEdits) {
// Show inline diff + approve/reject UI
this.appendToolCall(tc.function.name, args);
toolResult = await this.approveEdit(tc, args, tools);
} else {
this.appendToolCall(tc.function.name, args);
toolResult = await tools.handleToolCall(tc.function.name, args);
this.appendToolResult(tc.function.name, toolResult);
}

const toolMsg: ChatMessage = {
role: 'tool',
content: toolResult,
tool_call_id: tc.id,
};
thread.push(toolMsg);
this.messages.push(toolMsg);
this.messageDisplayInfos.push({});
}
}

this.scrollToBottom();
}

// ─── Pending-edit approval (inline line diff) ────────────────────────────

private approveEdit(tc: ToolCall, args: Record<string, string>, tools: NoteToolsHandler): Promise<string> {
const rawPath = args['path'] ?? '';
const content = args['content'] ?? '';
const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;

return new Promise(resolve => {
const existing = this.app.vault.getAbstractFileByPath(path);
const getOriginal =
existing instanceof TFile ? this.app.vault.read(existing) : Promise.resolve(undefined);

void getOriginal.then(original => {
const el = this.messagesEl.createDiv('agent-msg agent-msg-edit');
el.createEl('div', { text: `✏️ Proposed edit: ${path}`, cls: 'agent-msg-role' });

if (original !== undefined) {
// Inline unified diff (VSCode-style)
const diffLines = computeLineDiff(original, content);
const diffEl = el.createEl('div', { cls: 'agent-diff-inline' });
if (diffLines.length === 0) {
diffEl.createEl('div', { text: '(no changes)', cls: 'agent-diff-line agent-diff-line-equal' });
}
for (const line of diffLines) {
const lineEl = diffEl.createEl('div', {
cls: `agent-diff-line agent-diff-line-${line.type}`,
});
const prefix = line.type === 'add' ? '+ ' : line.type === 'delete' ? '- ' : '  ';
lineEl.createEl('span', { text: prefix, cls: 'agent-diff-line-prefix' });
lineEl.createEl('span', { text: line.content, cls: 'agent-diff-line-content' });
}
} else {
// New file — show full proposed content
// eslint-disable-next-line obsidianmd/ui/sentence-case
el.createEl('div', { text: '(New file)', cls: 'agent-diff-label agent-diff-label-new' });
el.createEl('pre', { text: content, cls: 'agent-diff-pre agent-diff-pre-new' });
}

// Buttons
const btnRow = el.createDiv('agent-diff-btns');
// eslint-disable-next-line obsidianmd/ui/sentence-case
const applyBtn = btnRow.createEl('button', { text: '✅ Apply', cls: 'agent-diff-apply' });
// eslint-disable-next-line obsidianmd/ui/sentence-case
const rejectBtn = btnRow.createEl('button', { text: '❌ Reject', cls: 'agent-diff-reject' });

applyBtn.addEventListener('click', () => {
applyBtn.disabled = true;
rejectBtn.disabled = true;
// eslint-disable-next-line obsidianmd/ui/sentence-case
applyBtn.setText('✅ Applying…');
void tools.handleToolCall('write_note', args).then(result => {
// eslint-disable-next-line obsidianmd/ui/sentence-case
applyBtn.setText('✅ Applied');
this.appendToolResult('write_note', result);
resolve(result);
});
});

rejectBtn.addEventListener('click', () => {
applyBtn.disabled = true;
rejectBtn.disabled = true;
// eslint-disable-next-line obsidianmd/ui/sentence-case
rejectBtn.setText('❌ Rejected');
resolve('The user rejected this edit. Please reconsider or ask for clarification.');
});

this.scrollToBottom();
});
});
}

// ─── Message rendering helpers ───────────────────────────────────────────

private appendUserBubble(text: string, msgIndex: number, notePath?: string): void {
const el = this.messagesEl.createDiv('agent-msg agent-msg-user');

const topRow = el.createDiv('agent-msg-user-top');
if (notePath) {
topRow.createEl('div', { text: `📄 ${notePath}`, cls: 'agent-msg-context' });
}
const editBtn = topRow.createEl('button', {
cls: 'agent-msg-edit-btn',
attr: { title: 'Edit and resend', 'aria-label': 'Edit and resend' },
});
editBtn.createEl('span', { text: '✏️' });
editBtn.addEventListener('click', () => this.startEdit(msgIndex, text));

el.createEl('div', { text, cls: 'agent-msg-text' });
this.scrollToBottom();
}

private appendAssistantBubble(): { msgEl: HTMLElement; textEl: HTMLElement } {
const msgEl = this.messagesEl.createDiv('agent-msg agent-msg-assistant');
// eslint-disable-next-line obsidianmd/ui/sentence-case
msgEl.createEl('div', { text: '🤖 Agent', cls: 'agent-msg-role' });
const textEl = msgEl.createEl('div', { cls: 'agent-msg-text' });
// Blinking cursor while streaming
textEl.createEl('span', { cls: 'agent-cursor', text: '▋' });
this.scrollToBottom();
return { msgEl, textEl };
}

private appendToolCall(name: string, args: Record<string, string>): void {
const el = this.messagesEl.createDiv('agent-msg agent-msg-tool');
el.createEl('div', { text: `🔧 ${name}`, cls: 'agent-msg-role' });
if (name !== 'write_note') {
el.createEl('pre', { text: JSON.stringify(args, null, 2), cls: 'agent-tool-pre' });
}
this.scrollToBottom();
}

private appendToolResult(name: string, result: string): void {
const el = this.messagesEl.createDiv('agent-msg agent-msg-tool-result');
const preview =
result.length > TOOL_RESULT_PREVIEW_CHARS ? `${result.slice(0, TOOL_RESULT_PREVIEW_CHARS)}…` : result;
el.createEl('div', { text: `✅ ${name}: ${preview}`, cls: 'agent-msg-text' });
this.scrollToBottom();
}

private appendError(message: string): void {
const el = this.messagesEl.createDiv('agent-msg agent-msg-error');
el.createEl('div', { text: `❌ Error: ${message}`, cls: 'agent-msg-text' });
this.scrollToBottom();
}

// ─── Edit from previous message ─────────────────────────────────────────

private startEdit(msgIndex: number, text: string): void {
	if (this.isProcessing) return;
	this.editingFromIndex = msgIndex;
	this.inputEl.value = text;
	// eslint-disable-next-line obsidianmd/ui/sentence-case
	this.editingIndicatorEl.setText('✏️ Editing — will regenerate the conversation from this point');
	this.editingIndicatorEl.show();
	this.sendBtn.setText('Resend');
	this.cancelEditBtn.show();
	this.inputEl.focus();
	this.scrollToBottom();
}

private cancelEdit(): void {
this.editingFromIndex = null;
this.editingIndicatorEl.hide();
this.sendBtn.setText('Send');
this.cancelEditBtn.hide();
}

// ─── Selection context (called from the command registered in main.ts) ───

/**
 * Prepend selected editor text as quoted context in the input box.
 * Called by the "Add selected text to chat context" command.
 */
addSelectionToContext(selectedText: string, sourcePath: string): void {
const fenced = ChatView.fenceText(selectedText);
const prefix = sourcePath ? `[Selected from: ${sourcePath}]\n${fenced}\n\n` : `${fenced}\n\n`;
this.inputEl.value = prefix + this.inputEl.value;
this.inputEl.focus();
void this.app.workspace.revealLeaf(this.leaf);
}

/**
 * Wrap text in a Markdown code fence, using a fence length that is guaranteed
 * not to appear inside the text (handles text that itself contains backticks).
 */
private static fenceText(text: string): string {
let maxRun = 0;
let run = 0;
for (const ch of text) {
run = ch === '`' ? run + 1 : 0;
if (run > maxRun) maxRun = run;
}
const fence = '`'.repeat(Math.max(3, maxRun + 1));
return `${fence}\n${text}\n${fence}`;
}

// ─── Utilities ──────────────────────────────────────────────────────────

private showStatus(text: string): void {
this.statusEl.setText(text);
this.statusEl.show();
}

private scrollToBottom(): void {
this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
}

private clearChat(): void {
this.saveCurrentSession();
this.messages = [];
this.messageDisplayInfos = [];
this.editingFromIndex = null;
this.cancelEdit();
this.messagesEl.empty();
}
}
