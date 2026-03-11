import { Notice, requestUrl } from 'obsidian';
import { AgentSettings } from '../settings/settings';
import { AgentMessage, AgentModelResponse, AgentToolDefinition, LLMService } from './LLMService';

interface OpenAICompatibleMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface ChatCompletionChoice {
    message?: {
        content?: string;
    };
}

interface ChatCompletionResponse {
    choices?: ChatCompletionChoice[];
    error?: {
        message?: string;
    };
}

interface ChatCompletionToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface ChatCompletionAgentMessage {
    content?: string;
    tool_calls?: ChatCompletionToolCall[];
}

interface ChatCompletionAgentChoice {
    message?: ChatCompletionAgentMessage;
}

interface ChatCompletionAgentResponse {
    choices?: ChatCompletionAgentChoice[];
    error?: {
        message?: string;
    };
}

interface AnthropicTextBlock {
    type: 'text';
    text: string;
}

interface AnthropicToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
}

interface AnthropicMessageResponse {
    content?: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
    error?: {
        message?: string;
    };
}

type AnthropicMessageContent =
    | string
    | Array<
        | AnthropicTextBlock
        | {
            type: 'tool_result';
            tool_use_id: string;
            content: string;
        }
        | AnthropicToolUseBlock
    >;

interface AnthropicRequestMessage {
    role: 'user' | 'assistant';
    content: AnthropicMessageContent;
}

export class LLMProviderService implements LLMService {
    settings: AgentSettings;

    constructor(settings: AgentSettings) {
        this.settings = settings;
    }

    updateSettings(settings: AgentSettings) {
        this.settings = settings;
    }

    async streamResponse(
        messages: { role: string; content: string }[],
        onChunk: (chunk: string) => void,
        onError: (error: Error) => void,
        onComplete: () => void
    ): Promise<void> {
        try {
            if (this.isAnthropicProvider()) {
                const content = await this.requestAnthropicTextResponse(messages);
                onChunk(content);
                onComplete();
                return;
            }

            const url = this.getOpenAICompatibleUrl();

            const requestMessages: OpenAICompatibleMessage[] = [
                { role: 'system', content: this.settings.systemPrompt },
                ...messages.map((message) => {
                    const normalizedRole: OpenAICompatibleMessage['role'] =
                        message.role === 'assistant' || message.role === 'system' ? message.role : 'user';

                    return {
                        role: normalizedRole,
                        content: message.content,
                    };
                }),
            ];

            const response = await requestUrl({
                url,
                method: 'POST',
                throw: false,
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getOpenAICompatibleAuthHeader(),
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: requestMessages,
                    temperature: this.settings.temperature,
                    max_tokens: this.settings.maxTokens,
                    stream: false,
                }),
            });

            const responseJson = this.safeResponseJson<ChatCompletionResponse>(response);

            if (response.status >= 400) {
                const errorMessage = this.buildProviderErrorMessage(
                    response.status,
                    responseJson.error?.message,
                    this.isAnthropicProvider() ? 'anthropic' : 'openai-compatible',
                    this.safeResponseText(response)
                );
                throw new Error(errorMessage);
            }

            const content = responseJson.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error('No response content returned from model');
            }

            onChunk(content);
            onComplete();

        } catch (error) {
            console.error('LLM Service Error:', error);
            const normalizedError = error instanceof Error ? error : new Error('Unknown LLM service error');
            new Notice(`Agent error: ${normalizedError.message}`);
            onError(normalizedError);
        }
    }

    async generateAgentResponse(messages: AgentMessage[], tools: AgentToolDefinition[]): Promise<AgentModelResponse> {
        if (this.isAnthropicProvider()) {
            return await this.generateAnthropicAgentResponse(messages, tools);
        }

        const url = this.getOpenAICompatibleUrl();

        const response = await requestUrl({
            url,
            method: 'POST',
            throw: false,
            headers: {
                'Content-Type': 'application/json',
                ...this.getOpenAICompatibleAuthHeader(),
            },
            body: JSON.stringify({
                model: this.settings.model,
                messages: messages.map((message) => {
                    if (message.role === 'tool') {
                        return {
                            role: 'tool',
                            content: message.content,
                            tool_call_id: message.toolCallId,
                        };
                    }

                    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
                        return {
                            role: 'assistant',
                            content: message.content,
                            tool_calls: message.toolCalls.map((toolCall) => ({
                                id: toolCall.id,
                                type: 'function',
                                function: {
                                    name: toolCall.name,
                                    arguments: toolCall.arguments,
                                },
                            })),
                        };
                    }

                    return {
                        role: message.role,
                        content: message.content,
                    };
                }),
                tools,
                tool_choice: 'auto',
                temperature: this.settings.temperature,
                max_tokens: this.settings.maxTokens,
                stream: false,
            }),
        });

        const responseJson = this.safeResponseJson<ChatCompletionAgentResponse>(response);
        if (response.status >= 400) {
            throw new Error(this.buildProviderErrorMessage(
                response.status,
                responseJson.error?.message,
                'openai-compatible',
                this.safeResponseText(response)
            ));
        }

        const message = responseJson.choices?.[0]?.message;
        const toolCalls = message?.tool_calls?.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
        })) ?? [];

        return {
            content: message?.content ?? '',
            toolCalls,
        };
    }

    private isAnthropicProvider(): boolean {
        return this.settings.provider === 'anthropic' || this.settings.provider === 'custom-anthropic';
    }

    private getOpenAICompatibleUrl(): string {
        if (this.settings.provider === 'custom' && this.settings.baseUrl) {
            return this.ensureEndpointPath(this.settings.baseUrl, '/chat/completions');
        }

        return 'https://api.openai.com/v1/chat/completions';
    }

    private getAnthropicUrl(): string {
        if (this.settings.provider === 'custom-anthropic' && this.settings.baseUrl) {
            return this.ensureEndpointPath(this.settings.baseUrl, '/messages');
        }

        return 'https://api.anthropic.com/v1/messages';
    }

    private getOpenAICompatibleAuthHeader(): Record<string, string> {
        if (!this.settings.apiKey.trim()) {
            return {};
        }

        return { Authorization: `Bearer ${this.settings.apiKey}` };
    }

    private normalizeBaseUrl(baseUrl: string): string {
        return baseUrl.trim().replace(/\/+$/, '');
    }

    private ensureEndpointPath(baseUrl: string, endpointPath: '/chat/completions' | '/messages'): string {
        const normalized = this.normalizeBaseUrl(baseUrl);
        if (normalized.endsWith(endpointPath)) {
            return normalized;
        }

        return `${normalized}${endpointPath}`;
    }

    private buildProviderErrorMessage(
        status: number,
        upstreamMessage: string | undefined,
        providerKind: 'openai-compatible' | 'anthropic',
        rawBody?: string
    ): string {
        const normalizedBody = rawBody?.trim();
        const bodyPreview = normalizedBody ? normalizedBody.slice(0, 300) : '';
        const base = upstreamMessage?.trim() || (bodyPreview ? `HTTP Error: ${status}. Response: ${bodyPreview}` : `HTTP Error: ${status}`);

        if (providerKind === 'anthropic' && status === 404) {
            return `${base}. Check model name and endpoint. For Anthropic, use a Claude model and the /messages endpoint.`;
        }

        return base;
    }

    private safeResponseJson<T>(response: { json?: unknown; text?: string }): T {
        try {
            if (typeof response.json === 'string') {
                return JSON.parse(response.json) as T;
            }

            if (response.json && typeof response.json === 'object') {
                return response.json as T;
            }

            if (response.text && response.text.trim()) {
                return JSON.parse(response.text) as T;
            }
        } catch {
            // Ignore parse errors and let callers handle missing fields gracefully.
        }

        return {} as T;
    }

    private safeResponseText(response: { text?: string; json?: unknown }): string | undefined {
        try {
            if (response.text && response.text.trim()) {
                return response.text;
            }

            if (typeof response.json === 'string') {
                return response.json;
            }
        } catch {
            return undefined;
        }

        return undefined;
    }

    private async requestAnthropicTextResponse(messages: { role: string; content: string }[]): Promise<string> {
        const url = this.getAnthropicUrl();
        const requestMessages = this.mapSimpleMessagesForAnthropic(messages);

        const response = await requestUrl({
            url,
            method: 'POST',
            throw: false,
            headers: {
                'Content-Type': 'application/json',
                ...(this.settings.apiKey.trim() ? { 'x-api-key': this.settings.apiKey } : {}),
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: this.settings.model,
                max_tokens: this.settings.maxTokens,
                temperature: this.settings.temperature,
                system: this.settings.systemPrompt,
                messages: requestMessages,
            }),
        });

        const responseJson = this.safeResponseJson<AnthropicMessageResponse>(response);
        if (response.status >= 400) {
            throw new Error(this.buildProviderErrorMessage(
                response.status,
                responseJson.error?.message,
                'anthropic',
                this.safeResponseText(response)
            ));
        }

        const content = (responseJson.content ?? [])
            .filter((block): block is AnthropicTextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('');

        if (!content) {
            throw new Error('No response content returned from model');
        }

        return content;
    }

    private async generateAnthropicAgentResponse(
        messages: AgentMessage[],
        tools: AgentToolDefinition[]
    ): Promise<AgentModelResponse> {
        const url = this.getAnthropicUrl();
        const { systemPrompt, messages: anthropicMessages } = this.mapAgentMessagesForAnthropic(messages);

        const response = await requestUrl({
            url,
            method: 'POST',
            throw: false,
            headers: {
                'Content-Type': 'application/json',
                ...(this.settings.apiKey.trim() ? { 'x-api-key': this.settings.apiKey } : {}),
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: this.settings.model,
                max_tokens: this.settings.maxTokens,
                temperature: this.settings.temperature,
                system: systemPrompt,
                messages: anthropicMessages,
                tools: tools.map((tool) => ({
                    name: tool.function.name,
                    description: tool.function.description,
                    input_schema: tool.function.parameters,
                })),
            }),
        });

        const responseJson = this.safeResponseJson<AnthropicMessageResponse>(response);
        if (response.status >= 400) {
            throw new Error(this.buildProviderErrorMessage(
                response.status,
                responseJson.error?.message,
                'anthropic',
                this.safeResponseText(response)
            ));
        }

        const content = (responseJson.content ?? [])
            .filter((block): block is AnthropicTextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('');

        const toolCalls = (responseJson.content ?? [])
            .filter((block): block is AnthropicToolUseBlock => block.type === 'tool_use')
            .map((block) => ({
                id: block.id,
                name: block.name,
                arguments: JSON.stringify(block.input ?? {}),
            }));

        return {
            content,
            toolCalls,
        };
    }

    private mapSimpleMessagesForAnthropic(messages: { role: string; content: string }[]): AnthropicRequestMessage[] {
        return messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: message.content,
            }));
    }

    private mapAgentMessagesForAnthropic(messages: AgentMessage[]): { systemPrompt: string; messages: AnthropicRequestMessage[] } {
        const extraSystemPrompts: string[] = [];
        const mappedMessages: AnthropicRequestMessage[] = [];

        for (const message of messages) {
            if (message.role === 'system') {
                if (message.content.trim()) {
                    extraSystemPrompts.push(message.content.trim());
                }
                continue;
            }

            if (message.role === 'tool') {
                if (message.toolCallId) {
                    mappedMessages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: message.toolCallId,
                                content: message.content,
                            },
                        ],
                    });
                } else {
                    mappedMessages.push({
                        role: 'user',
                        content: message.content,
                    });
                }
                continue;
            }

            if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
                mappedMessages.push({
                    role: 'assistant',
                    content: [
                        ...(message.content.trim() ? [{ type: 'text' as const, text: message.content }] : []),
                        ...message.toolCalls.map((toolCall) => ({
                            type: 'tool_use' as const,
                            id: toolCall.id,
                            name: toolCall.name,
                            input: this.parseToolCallArgs(toolCall.arguments),
                        })),
                    ],
                });
                continue;
            }

            mappedMessages.push({
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: message.content,
            });
        }

        const systemPrompt = [this.settings.systemPrompt, ...extraSystemPrompts].filter((item) => item.trim()).join('\n\n');
        return { systemPrompt, messages: mappedMessages };
    }

    private parseToolCallArgs(rawArgs: string): Record<string, unknown> {
        if (!rawArgs.trim()) {
            return {};
        }

        try {
            const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
            return parsed;
        } catch {
            return { _raw: rawArgs };
        }
    }
}
