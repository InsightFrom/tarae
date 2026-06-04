const https = require('https');
const vscode = require('vscode');

const {
  buildReportPrompt,
  formatReportMarkdown
} = require('./reports');

const OPENAI_API_KEY_SECRET = 'tarae.openai.apiKey';
const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-4.1-mini';

class MissingCredentialsError extends Error {
  constructor(provider) {
    super(`No ${provider} API key is configured.`);
    this.name = 'MissingCredentialsError';
    this.code = 'missingCredentials';
    this.provider = provider;
  }
}

async function configureLlmProvider(context) {
  const provider = await vscode.window.showQuickPick(
    [{ label: 'OpenAI', value: 'openai', description: 'Use an OpenAI API key stored in VS Code SecretStorage' }],
    {
      title: 'Tarae: Configure LLM Provider',
      placeHolder: 'Select an LLM provider'
    }
  );
  if (!provider) {
    return false;
  }

  await vscode.workspace.getConfiguration().update(
    'tarae.llm.provider',
    provider.value,
    vscode.ConfigurationTarget.Global
  );

  const currentModel = getConfiguredModel();
  const model = await vscode.window.showInputBox({
    title: 'Tarae: LLM Model',
    prompt: 'Model used to generate Tarae session reports.',
    value: currentModel,
    ignoreFocusOut: true
  });
  if (model) {
    await vscode.workspace.getConfiguration().update(
      'tarae.llm.model',
      model.trim(),
      vscode.ConfigurationTarget.Global
    );
  }

  const apiKey = await vscode.window.showInputBox({
    title: 'Tarae: OpenAI API Key',
    prompt: 'Stored only in VS Code SecretStorage. It is never sent to the Webview.',
    password: true,
    ignoreFocusOut: true
  });
  if (!apiKey) {
    return false;
  }

  await context.secrets.store(OPENAI_API_KEY_SECRET, apiKey.trim());
  vscode.window.showInformationMessage('Tarae OpenAI API key saved in VS Code SecretStorage.');
  return true;
}

async function clearLlmCredentials(context) {
  await context.secrets.delete(OPENAI_API_KEY_SECRET);
  vscode.window.showInformationMessage('Tarae LLM credentials cleared.');
}

async function getLlmState(context) {
  const provider = getConfiguredProvider();
  const model = getConfiguredModel();
  const apiKey = await context.secrets.get(OPENAI_API_KEY_SECRET);
  return {
    provider,
    model,
    hasCredentials: Boolean(apiKey)
  };
}

async function generateSessionReport(context, reportContext) {
  const provider = getConfiguredProvider();
  const model = getConfiguredModel();

  if (provider !== 'openai') {
    throw new Error(`Unsupported Tarae LLM provider: ${provider}`);
  }

  const apiKey = await context.secrets.get(OPENAI_API_KEY_SECRET);
  if (!apiKey) {
    throw new MissingCredentialsError(provider);
  }

  const generatedAt = new Date().toISOString();
  const rawMarkdown = await callOpenAiResponses({
    apiKey,
    model,
    input: buildReportPrompt(reportContext)
  });
  const markdown = formatReportMarkdown({
    markdown: rawMarkdown,
    provider,
    model,
    generatedAt,
    context: reportContext
  });

  return {
    provider,
    model,
    generatedAt,
    markdown
  };
}

function getConfiguredProvider() {
  return vscode.workspace.getConfiguration().get('tarae.llm.provider', DEFAULT_PROVIDER);
}

function getConfiguredModel() {
  return vscode.workspace.getConfiguration().get('tarae.llm.model', DEFAULT_MODEL);
}

function callOpenAiResponses({ apiKey, model, input }) {
  const body = JSON.stringify({
    model,
    input,
    max_output_tokens: 2200
  });

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'api.openai.com',
      path: '/v1/responses',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message = payload && payload.error && payload.error.message
            ? payload.error.message
            : text || `HTTP ${response.statusCode}`;
          reject(new Error(`OpenAI report generation failed: ${message}`));
          return;
        }

        const output = extractResponseText(payload);
        if (!output) {
          reject(new Error('OpenAI response did not include text output.'));
          return;
        }
        resolve(output);
      });
    });

    request.on('error', reject);
    request.setTimeout(120000, () => {
      request.destroy(new Error('OpenAI report generation timed out.'));
    });
    request.write(body);
    request.end();
  });
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (typeof payload.output_text === 'string') {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return '';
  }

  const parts = [];
  for (const item of payload.output) {
    if (!item || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (typeof content.text === 'string') {
        parts.push(content.text);
      } else if (typeof content.output_text === 'string') {
        parts.push(content.output_text);
      }
    }
  }
  return parts.join('\n').trim();
}

module.exports = {
  MissingCredentialsError,
  clearLlmCredentials,
  configureLlmProvider,
  generateSessionReport,
  getLlmState
};
