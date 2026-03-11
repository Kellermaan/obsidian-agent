import { Notice, requestUrl } from 'obsidian';
import { AgentSettings } from '../settings/settings';
import { LLMService } from './LLMService';

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
}
