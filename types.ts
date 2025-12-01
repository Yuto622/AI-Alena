export interface AIModel {
  id: string;
  name: string;
  provider: string;
  avatarColor: string;
  description: string;
  systemPersona?: string; // Used to simulate other models using Gemini
}

export interface ModelResponse {
  modelId: string;
  text: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  executionTime?: number;
}

export type GridColumns = 1 | 2 | 3 | 4;

export const AVAILABLE_MODELS: AIModel[] = [
  {
    id: 'gemini',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    avatarColor: 'bg-blue-500',
    description: '高速かつマルチモーダルな推論'
  },
  {
    id: 'gpt4o',
    name: 'ChatGPT-4o',
    provider: 'OpenAI',
    avatarColor: 'bg-green-500',
    description: '推論能力に優れたフラッグシップ',
    systemPersona: 'あなたはOpenAIによって開発されたChatGPT-4oです。論理的で丁寧な日本語で回答してください。'
  },
  {
    id: 'grok',
    name: 'Grok 3',
    provider: 'xAI',
    avatarColor: 'bg-white text-black',
    description: 'ユーモアと反骨精神',
    systemPersona: 'あなたはxAIによって開発されたGrokです。少し皮肉屋でユーモアがあり、反骨精神を持っています。堅苦しい敬語は避け、親しみやすく、かつウィットに富んだ日本語で回答してください。'
  },
  {
    id: 'claude',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    avatarColor: 'bg-orange-600',
    description: '自然でニュアンス豊かな表現',
    systemPersona: 'あなたはAnthropicによって開発されたClaude（クロード）です。知的で、誠実で、害のないAIアシスタントとして振る舞ってください。非常に自然で流暢な日本語を使い、長文でも読みやすい構成で回答してください。'
  },
  {
    id: 'llama3',
    name: 'Llama 3 70B',
    provider: 'Meta',
    avatarColor: 'bg-blue-600',
    description: 'オープンソースの強力なモデル',
    systemPersona: 'あなたはMetaによって開発されたLlama 3です。簡潔かつ正確に、事実に基づいた回答を心がけてください。'
  },
  {
    id: 'mistral',
    name: 'Mistral Large',
    provider: 'Mistral AI',
    avatarColor: 'bg-yellow-500',
    description: '欧州発の高性能モデル',
    systemPersona: 'あなたはフランスのMistral AIによって開発されたMistral Largeです。効率的で無駄のない、洗練された回答をしてください。'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek-V3',
    provider: 'DeepSeek',
    avatarColor: 'bg-purple-600',
    description: '論理的思考とコーディング',
    systemPersona: 'あなたはDeepSeek-V3です。論理的思考力とコーディング能力に優れています。技術的な質問には詳細に、論理的に回答してください。'
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    provider: 'Perplexity',
    avatarColor: 'bg-teal-500',
    description: '検索特化型エンジン',
    systemPersona: 'あなたはPerplexityです。最新の情報を検索したかのように振る舞ってください。回答は事実に基づき、客観的なスタイルで記述してください。「検索結果によると...」のような言い回しを用いてください。'
  }
];