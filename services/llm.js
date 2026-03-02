import OpenAI from 'openai';

let openaiClient = null;
let modelName = 'openai/gpt-oss-120b';

function getCredentials() {
  if (process.env.VCAP_SERVICES) {
    try {
      const vcap = JSON.parse(process.env.VCAP_SERVICES);
      const genaiService = vcap.genai || vcap['gen-ai'] || vcap['generative-ai'];

      if (genaiService && genaiService.length > 0) {
        const creds = genaiService[0].credentials;
        const ep = creds.endpoint || creds;
        return {
          apiKey: ep.api_key || ep.apiKey,
          baseURL: (ep.api_base || ep.apiBase || ep.url) + '/openai/v1',
          model: ep.model || ep.model_name || 'openai/gpt-oss-120b',
        };
      }
    } catch (err) {
      console.error('Failed to parse VCAP_SERVICES for GenAI:', err.message);
    }
  }

  return {
    apiKey: process.env.GENAI_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.GENAI_API_BASE || process.env.OPENAI_BASE_URL || undefined,
    model: process.env.GENAI_MODEL || 'openai/gpt-oss-120b',
  };
}

function getClient() {
  if (!openaiClient) {
    const creds = getCredentials();
    if (!creds.apiKey) {
      console.warn('No LLM API key configured. AI features will be unavailable.');
      return null;
    }
    const config = { apiKey: creds.apiKey };
    if (creds.baseURL) config.baseURL = creds.baseURL;
    openaiClient = new OpenAI(config);
    modelName = creds.model;
  }
  return openaiClient;
}

export async function chat(messages, options = {}) {
  try {
    const client = getClient();
    if (!client) return null;

    const response = await client.chat.completions.create({
      model: options.model || modelName,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 8192,
    });

    return response.choices[0]?.message?.content || null;
  } catch (err) {
    console.error('LLM chat error:', err.message);
    return null;
  }
}

export async function vision(imageDataUri, prompt) {
  try {
    const client = getClient();
    if (!client) return null;

    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUri, detail: 'high' } },
          ],
        },
      ],
      temperature: 0.5,
      max_tokens: 4096,
    });

    return response.choices[0]?.message?.content || null;
  } catch (err) {
    console.error('LLM vision error:', err.message);
    return null;
  }
}
