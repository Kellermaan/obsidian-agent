import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import AgentPlugin from '../main';
import { ChatMessage, ToolCall } from '../types';
import { AIClient } from '../utils/AIClient';
import { NOTE_TOOLS, NoteToolsHandler } from '../utils/NoteTools';

export const CHAT_VIEW_TYPE = 'agent-chat-view';

const MAX_AGENT_ITERATIONS = 10;
const MAX_NOTE_CONTEXT_CHARS = 8000;
const DIFF_PREVIEW_CHARS = 600;
const TOOL_RESULT_PREVIEW_CHARS = 300;

export class ChatView extends ItemView {
	private plugin: AgentPlugin;
	private messages: ChatMessage[] = [];
	private isProcessing = false;

	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private statusEl!: HTMLElement;
	private contextToggle!: HTMLInputElement;

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

		// Header
		const header = root.createDiv('agent-header');
		header.createEl('span', { text: 'AI agent', cls: 'agent-header-title' });
		const clearBtn = header.createEl('button', { text: 'New chat', cls: 'agent-header-btn' });
		clearBtn.addEventListener('click', () => this.clearChat());

		// Message list
		this.messagesEl = root.createDiv('agent-messages');

		// Status bar
		this.statusEl = root.createDiv('agent-status');
		this.statusEl.hide();

		// Input area
		const inputArea = root.createDiv('agent-input-area');

		// Context row
		const ctxRow = inputArea.createDiv('agent-ctx-row');
		this.contextToggle = ctxRow.createEl('input');
		this.contextToggle.type = 'checkbox';
		this.contextToggle.id = 'agent-ctx-toggle';
		this.contextToggle.checked = true;
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		const ctxLabel = ctxRow.createEl('label', { text: '📎 Include current note', cls: 'agent-ctx-label' });
		ctxLabel.setAttribute('for', 'agent-ctx-toggle');

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
		});

		const btnRow = inputArea.createDiv('agent-btn-row');
		this.sendBtn = btnRow.createEl('button', { text: 'Send', cls: 'agent-send-btn' });
		this.sendBtn.addEventListener('click', () => void this.onSend());
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

		this.appendUserBubble(text, activeFile?.path);
		this.messages.push({ role: 'user', content: userContent });

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
					// Show diff + approve/reject UI
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
			}
		}

		this.scrollToBottom();
	}

	// ─── Pending-edit approval ───────────────────────────────────────────────

	private approveEdit(tc: ToolCall, args: Record<string, string>, tools: NoteToolsHandler): Promise<string> {
		const rawPath = args['path'] ?? '';
		const content = args['content'] ?? '';
		const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;

		return new Promise(resolve => {
			const existing = this.app.vault.getAbstractFileByPath(path);
			const getOriginal = existing instanceof TFile ? this.app.vault.read(existing) : Promise.resolve(undefined);

			void getOriginal.then(original => {
				const el = this.messagesEl.createDiv('agent-msg agent-msg-edit');
				el.createEl('div', { text: `✏️ Proposed edit: ${path}`, cls: 'agent-msg-role' });

				// Diff display
				if (original !== undefined) {
					const diff = el.createDiv('agent-diff');

					const oldSec = diff.createDiv('agent-diff-section');
					oldSec.createEl('div', { text: 'Before', cls: 'agent-diff-label agent-diff-label-old' });
					oldSec.createEl('pre', {
						text:
							original.length > DIFF_PREVIEW_CHARS
								? `${original.slice(0, DIFF_PREVIEW_CHARS)}\n[…]`
								: original,
						cls: 'agent-diff-pre agent-diff-pre-old',
					});

					const newSec = diff.createDiv('agent-diff-section');
					newSec.createEl('div', { text: 'After', cls: 'agent-diff-label agent-diff-label-new' });
					newSec.createEl('pre', {
						text:
							content.length > DIFF_PREVIEW_CHARS
								? `${content.slice(0, DIFF_PREVIEW_CHARS)}\n[…]`
								: content,
						cls: 'agent-diff-pre agent-diff-pre-new',
					});
				} else {
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					el.createEl('div', { text: '(New file)', cls: 'agent-diff-label agent-diff-label-new' });
					el.createEl('pre', {
						text:
							content.length > DIFF_PREVIEW_CHARS
								? `${content.slice(0, DIFF_PREVIEW_CHARS)}\n[…]`
								: content,
						cls: 'agent-diff-pre agent-diff-pre-new',
					});
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

	private appendUserBubble(text: string, notePath?: string): void {
		const el = this.messagesEl.createDiv('agent-msg agent-msg-user');
		if (notePath) {
			el.createEl('div', { text: `📄 ${notePath}`, cls: 'agent-msg-context' });
		}
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
		const preview = result.length > TOOL_RESULT_PREVIEW_CHARS ? `${result.slice(0, TOOL_RESULT_PREVIEW_CHARS)}…` : result;
		el.createEl('div', { text: `✅ ${name}: ${preview}`, cls: 'agent-msg-text' });
		this.scrollToBottom();
	}

	private appendError(message: string): void {
		const el = this.messagesEl.createDiv('agent-msg agent-msg-error');
		el.createEl('div', { text: `❌ Error: ${message}`, cls: 'agent-msg-text' });
		this.scrollToBottom();
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
		this.messages = [];
		this.messagesEl.empty();
	}
}
