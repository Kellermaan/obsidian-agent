import { requestUrl } from 'obsidian';
import { AgentPluginSettings } from '../settings';
import { ChatMessage, StreamDelta } from '../types';

export interface ChatCompletionRequest {
model: string;
messages: ChatMessage[];
tools?: object[];
max_tokens?: number;
temperature?: number;
stream?: boolean;
}

export type StreamChunk =
| { type: 'token'; content: string }
| { type: 'done'; message: ChatMessage };

export class AIClient {
private settings: AgentPluginSettings;

constructor(settings: AgentPluginSettings) {
this.settings = settings;
}

private get completionsUrl(): string {
return `${this.settings.apiUrl.replace(/\/$/, '')}/chat/completions`;
}

async complete(messages: ChatMessage[], tools?: object[]): Promise<ChatMessage> {
const body: ChatCompletionRequest = {
model: this.settings.model,
messages,
max_tokens: this.settings.maxTokens,
temperature: this.settings.temperature,
stream: false,
};
if (tools && tools.length > 0) body.tools = tools;

const resp = await requestUrl({
url: this.completionsUrl,
method: 'POST',
headers: {
'Content-Type': 'application/json',
Authorization: `Bearer ${this.settings.apiKey}`,
},
body: JSON.stringify(body),
throw: false,
});

if (resp.status !== 200) {
throw new Error(`API error ${resp.status}: ${resp.text}`);
}

const data = resp.json as { choices: Array<{ message: ChatMessage }> };
const first = data.choices[0];
if (!first) throw new Error('API returned no choices');
return first.message;
	}

	// requestUrl does not support streaming SSE responses, so native fetch is used here.
	async *streamComplete(messages: ChatMessage[], tools?: object[]) {
const body: ChatCompletionRequest = {
model: this.settings.model,
messages,
max_tokens: this.settings.maxTokens,
temperature: this.settings.temperature,
stream: true,
};
if (tools && tools.length > 0) body.tools = tools;

// fetch is intentional: requestUrl does not support streaming.
// eslint-disable-next-line no-restricted-globals
const resp = await fetch(this.completionsUrl, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
Authorization: `Bearer ${this.settings.apiKey}`,
},
body: JSON.stringify(body),
});

if (!resp.ok) {
const errText = await resp.text();
throw new Error(`API error ${resp.status}: ${errText}`);
}

if (!resp.body) throw new Error('Streaming response body is null');
		const reader = resp.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

let fullContent = '';
const toolCallsAccum = new Map<number, { id: string; name: string; arguments: string }>();

while (true) {
const { done, value } = await reader.read();
if (done) break;

buffer += decoder.decode(value, { stream: true });
const lines = buffer.split('\n');
buffer = lines.pop() ?? '';

for (const line of lines) {
if (!line.startsWith('data: ')) continue;
const data = line.slice(6).trim();

if (data === '[DONE]') {
const message: ChatMessage = { role: 'assistant', content: fullContent || null };
if (toolCallsAccum.size > 0) {
message.tool_calls = Array.from(toolCallsAccum.entries()).map(([, tc]) => ({
id: tc.id,
type: 'function' as const,
function: { name: tc.name, arguments: tc.arguments },
}));
}
yield { type: 'done' as const, message };
return;
}

try {
const delta = JSON.parse(data) as StreamDelta;
const choice = delta.choices[0];
if (!choice) continue;

if (choice.delta.content) {
fullContent += choice.delta.content;
yield { type: 'token' as const, content: choice.delta.content };
}

if (choice.delta.tool_calls) {
for (const tc of choice.delta.tool_calls) {
if (!toolCallsAccum.has(tc.index)) {
toolCallsAccum.set(tc.index, { id: '', name: '', arguments: '' });
}
const existing = toolCallsAccum.get(tc.index)!;
if (tc.id) existing.id = tc.id;
if (tc.function?.name) existing.name += tc.function.name;
if (tc.function?.arguments) existing.arguments += tc.function.arguments;
}
}
} catch {
// Skip malformed JSON chunks
}
}
}

// Stream ended without [DONE] – synthesise final message
const message: ChatMessage = { role: 'assistant', content: fullContent || null };
if (toolCallsAccum.size > 0) {
message.tool_calls = Array.from(toolCallsAccum.entries()).map(([, tc]) => ({
id: tc.id,
type: 'function' as const,
function: { name: tc.name, arguments: tc.arguments },
}));
}
yield { type: 'done' as const, message };
}
}
