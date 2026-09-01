// Netlify Function: claude-proxy.js
// Recebe a transcricao de uma reuniao e usa a API da Anthropic (Claude) para
// extrair topicos, participantes, resumo e plano de acao.
//
// Requer a variavel de ambiente ANTHROPIC_API_KEY configurada no Netlify
// (Site settings > Environment variables). A chave NUNCA e exposta ao navegador.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Metodo nao permitido' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY nao configurada no Netlify (Site settings > Environment variables).' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON invalido' }) };
  }

  const transcript = (payload.transcript || '').trim();
  if (!transcript) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Transcricao vazia' }) };
  }
  const title = (payload.title || '').trim();
  const participantsHint = (payload.participantsHint || '').trim();

  const systemPrompt = `Voce e um assistente que transforma transcricoes brutas de reunioes (geradas por reconhecimento de voz, entao podem ter erros de transcricao e falta de pontuacao) em notas de reuniao estruturadas, em portugues do Brasil.

Responda APENAS com um JSON valido, sem markdown, sem texto antes ou depois, no seguinte formato exato:

{
  "resumo": "resumo executivo em 1-2 paragrafos curtos",
  "topicos": ["topico 1", "topico 2", "..."],
  "participantes": ["nome 1", "nome 2", "..."],
  "plano_de_acao": [
    {"tarefa": "descricao da acao", "responsavel": "nome ou vazio se nao mencionado", "prazo": "prazo ou vazio se nao mencionado"}
  ]
}

Regras:
- Se a lista de participantes informada pelo usuario estiver disponivel, use-a como base e complete com nomes claramente mencionados na transcricao.
- Se nenhum participante puder ser identificado, retorne uma lista vazia.
- Se nao houver itens de acao claros, retorne "plano_de_acao": [].
- Corrija erros obvios de transcricao por contexto, mas nao invente informacoes que nao estao no texto.
- Seja objetivo e evite repetir a transcricao literalmente no resumo.`;

  const userPrompt = `Titulo da reuniao: ${title || '(nao informado)'}
Participantes informados manualmente: ${participantsHint || '(nao informado)'}

Transcricao:
"""
${transcript}
"""`;

  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : 'Erro na API da Anthropic';
      return { statusCode: resp.status, body: JSON.stringify({ error: msg }) };
    }

    const raw = (data.content && data.content[0] && data.content[0].text) || '{}';
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/,'').replace(/```\s*$/,'');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'A IA retornou um formato inesperado. Tente novamente.' }) };
    }

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao chamar a API da Anthropic: ' + e.message }) };
  }
};
