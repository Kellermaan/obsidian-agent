import { Notice, requestUrl } from 'obsidian';
import { AgentSettings } from '../settings/settings';
import { AgentMessage, AgentModelResponse, AgentToolDefinition, LLMService } from './LLMService';

interface ChatCompletionMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenAIChatChoice {
    message?: {
        content?: string;
    };
}

interface OpenAIChatResponse {
    choices?: OpenAIChatChoice[];
    error?: {
        message?: string;
    };
}

interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAIAgentMessage {
    content?: string;
    tool_calls?: OpenAIToolCall[];
}

interface OpenAIAgentChoice {
    message?: OpenAIAgentMessage;
}

interface OpenAIAgentResponse {
    choices?: OpenAIAgentChoice[];
    error?: {
        message?: string;
    };
}

export class OpenAIService implements LLMService {
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
            const url = this.settings.provider === 'custom' && this.settings.baseUrl
                ? `${this.settings.baseUrl}/chat/completions`
                : 'https://api.openai.com/v1/chat/completions';

            const requestMessages: ChatCompletionMessage[] = [
                { role: 'system', content: this.settings.systemPrompt },
                ...messages.map((message) => {
                    const normalizedRole: ChatCompletionMessage['role'] =
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
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.settings.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: requestMessages,
                    temperature: this.settings.temperature,
                    max_tokens: this.settings.maxTokens,
                    stream: false,
                }),
            });

            const responseJson = response.json as OpenAIChatResponse;

            if (response.status >= 400) {
                const errorMessage = responseJson.error?.message ?? `HTTP Error: ${response.status}`;
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
        const url = this.settings.provider === 'custom' && this.settings.baseUrl
            ? `${this.settings.baseUrl}/chat/completions`
            : 'https://api.openai.com/v1/chat/completions';

        const response = await requestUrl({
            url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.settings.apiKey}`,
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

        const responseJson = response.json as OpenAIAgentResponse;
        if (response.status >= 400) {
            throw new Error(responseJson.error?.message ?? `HTTP Error: ${response.status}`);
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
}
