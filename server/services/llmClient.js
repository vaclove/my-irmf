/**
 * Provider-normalized LLM client for subtitle translation and quality
 * suggestions. Two providers behind one interface:
 *
 *   - 'azure'     GPT-5.6 Sol on the project's Azure AI Foundry resource
 *                 (chat/completions, api-key header, reasoning_effort,
 *                 response_format json_schema). Default.
 *   - 'anthropic' Claude Opus via @anthropic-ai/sdk (adaptive thinking,
 *                 output_config json_schema, prompt caching). Fallback.
 *
 * Selection: LLM_PROVIDER env ('azure' | 'anthropic', default 'azure').
 * When the chosen provider has no API key but the other one does, the other
 * is used and a warning is logged once — so a half-configured deploy still
 * translates instead of 503ing.
 *
 * complete() accepts Anthropic-style system blocks; the Azure path flattens
 * them into one system message and drops cache_control (Azure prefix-caches
 * automatically), the Anthropic path passes them through unchanged so the
 * existing source-reference cache behavior is preserved.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logger } = require('../utils/logger');

const AZURE_DEFAULTS = {
  endpoint: 'https://irmf.cognitiveservices.azure.com',
  deployment: 'gpt-5.6-sol',
  apiVersion: '2025-04-01-preview',
  reasoningEffort: 'medium',
};

const AZURE_MAX_ATTEMPTS = 5;
const AZURE_BACKOFF_CAP_MS = 20000;

class LlmError extends Error {
  constructor(message, { kind = 'api', status = null, provider = null } = {}) {
    super(message);
    this.kind = kind; // 'auth' | 'rate_limit' | 'api' | 'network'
    this.status = status;
    this.provider = provider;
  }
}

function azureConfigured() {
  return !!process.env.AZURE_OPENAI_API_KEY;
}

function anthropicConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

let warnedFallback = false;

/** @returns {'azure'|'anthropic'|null} */
function resolveProvider() {
  const wanted = (process.env.LLM_PROVIDER || 'azure').toLowerCase();
  const preferred = wanted === 'anthropic' ? 'anthropic' : 'azure';
  const other = preferred === 'azure' ? 'anthropic' : 'azure';
  const configured = { azure: azureConfigured(), anthropic: anthropicConfigured() };
  if (configured[preferred]) return preferred;
  if (configured[other]) {
    if (!warnedFallback) {
      warnedFallback = true;
      logger.warn(
        `[LlmClient] LLM_PROVIDER=${preferred} has no API key; falling back to ${other}`
      );
    }
    return other;
  }
  return null;
}

function isConfigured() {
  return resolveProvider() !== null;
}

/** Model identifier stamped on job/run rows: whichever provider will run. */
function getModel() {
  const provider = resolveProvider();
  if (provider === 'azure') {
    return process.env.AZURE_OPENAI_DEPLOYMENT || AZURE_DEFAULTS.deployment;
  }
  return process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
}

// ---------------------------------------------------------------------------
// Azure (GPT-5.6 Sol) — chat/completions via global fetch
// ---------------------------------------------------------------------------

function azureUrl() {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || AZURE_DEFAULTS.endpoint).replace(
    /\/+$/,
    ''
  );
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || AZURE_DEFAULTS.deployment;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || AZURE_DEFAULTS.apiVersion;
  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function azureComplete({ systemBlocks, messages, maxTokens, jsonSchema, schemaName }) {
  const systemText = systemBlocks.map((b) => b.text).join('\n\n');
  const body = {
    messages: [
      { role: 'system', content: systemText },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_completion_tokens: maxTokens,
    reasoning_effort:
      process.env.AZURE_OPENAI_REASONING_EFFORT || AZURE_DEFAULTS.reasoningEffort,
  };
  if (jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: schemaName || 'reply', strict: true, schema: jsonSchema },
    };
  }

  let lastError;
  for (let attempt = 0; attempt < AZURE_MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(azureUrl(), {
        method: 'POST',
        headers: {
          'api-key': process.env.AZURE_OPENAI_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      lastError = new LlmError(`network error: ${networkError.message}`, {
        kind: 'network',
        provider: 'azure',
      });
      await sleep(Math.min(2 ** attempt * 1000, AZURE_BACKOFF_CAP_MS));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      lastError = new LlmError(`Azure OpenAI HTTP ${res.status}`, {
        kind: res.status === 429 ? 'rate_limit' : 'api',
        status: res.status,
        provider: 'azure',
      });
      await sleep(
        retryAfter ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, AZURE_BACKOFF_CAP_MS)
      );
      continue;
    }

    let json;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.status === 401 || res.status === 403) {
      throw new LlmError('Azure OpenAI API key is invalid or lacks access', {
        kind: 'auth',
        status: res.status,
        provider: 'azure',
      });
    }
    if (!res.ok) {
      const detail = json ? JSON.stringify(json).slice(0, 500) : `HTTP ${res.status}`;
      throw new LlmError(`Azure OpenAI error ${res.status}: ${detail}`, {
        kind: 'api',
        status: res.status,
        provider: 'azure',
      });
    }

    const choice = json?.choices?.[0];
    if (!choice) {
      throw new LlmError('Azure OpenAI reply has no choices', {
        kind: 'api',
        provider: 'azure',
      });
    }
    const u = json.usage || {};
    return {
      text: choice.message?.content || '',
      truncated: choice.finish_reason === 'length',
      refusal: choice.message?.refusal || null,
      usage: {
        inputTokens: u.prompt_tokens || 0,
        outputTokens: u.completion_tokens || 0,
        cachedTokens: u.prompt_tokens_details?.cached_tokens || 0,
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens || 0,
      },
    };
  }
  throw lastError || new LlmError('Azure OpenAI call failed', { provider: 'azure' });
}

// ---------------------------------------------------------------------------
// Anthropic (Claude Opus) — existing SDK behavior, moved verbatim
// ---------------------------------------------------------------------------

let anthropicClient = null;

function getAnthropicClient() {
  if (!anthropicClient) anthropicClient = new Anthropic({ maxRetries: 4 });
  return anthropicClient;
}

async function anthropicComplete({ systemBlocks, messages, maxTokens, jsonSchema }) {
  const request = {
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system: systemBlocks,
    messages,
    // No temperature/top_p/top_k: rejected with 400 on current Opus models.
  };
  if (jsonSchema) {
    request.output_config = { format: { type: 'json_schema', schema: jsonSchema } };
  }
  const response = await getAnthropicClient().messages.create(request);
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const usage = response.usage || {};
  return {
    text,
    truncated: response.stop_reason === 'max_tokens',
    refusal: null,
    usage: {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cachedTokens: usage.cache_read_input_tokens || 0,
      reasoningTokens: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Array<{type:'text', text:string, cache_control?:object}>} args.systemBlocks
 * @param {Array<{role:'user'|'assistant', content:string}>} args.messages
 * @param {number} args.maxTokens
 * @param {object|null} [args.jsonSchema] strict JSON schema for the reply
 * @param {string} [args.schemaName]
 * @param {string} [args.stage] label for debug logging
 * @returns {Promise<{text:string, truncated:boolean, refusal:string|null,
 *   usage:{inputTokens:number, outputTokens:number, cachedTokens:number, reasoningTokens:number}}>}
 */
async function complete({ systemBlocks, messages, maxTokens, jsonSchema = null, schemaName, stage }) {
  const provider = resolveProvider();
  if (!provider) {
    throw new LlmError('No LLM provider is configured', { kind: 'auth' });
  }
  const impl = provider === 'azure' ? azureComplete : anthropicComplete;
  const result = await impl({ systemBlocks, messages, maxTokens, jsonSchema, schemaName });
  logger.debug('[LlmClient] model call', {
    provider,
    model: getModel(),
    stage: stage || null,
    truncated: result.truncated,
    refused: !!result.refusal,
    ...result.usage,
  });
  return result;
}

/** Provider-agnostic user-facing message for any error from complete(). */
function describeError(error) {
  if (error instanceof LlmError) {
    const name = error.provider === 'azure' ? 'Azure OpenAI' : error.provider === 'anthropic' ? 'Anthropic' : 'LLM';
    if (error.kind === 'auth') return `${name} API key is invalid or missing`;
    if (error.kind === 'rate_limit') return `${name} rate limit exceeded — try again later`;
    if (error.kind === 'network') return `${name} is unreachable: ${error.message}`;
    return `${name} API error: ${error.message}`;
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Anthropic API key is invalid';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate limit exceeded — try again later';
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error (${error.status ?? 'network'}): ${error.message}`;
  }
  return null; // not an LLM error — caller falls through to its own mapping
}

module.exports = {
  LlmError,
  resolveProvider,
  isConfigured,
  getModel,
  complete,
  describeError,
};
