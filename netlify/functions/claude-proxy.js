// Netlify Function: claude-proxy.js
// Recebe a transcricao de uma reuniao e usa a API gratuita do Google Gemini para
// extrair topicos, participantes, resumo e plano de acao.
//
// Requer a variavel de ambiente GEMINI_API_KEY configurada no Netlify
// (Site settings > Environment variables). Chave gratuita em https://aistudio.google.com/apikey
// A chave NUNCA e exposta ao navegador.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Metodo nao permitido' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GEMINI_API_KEY nao configurada no Netlify (Site settings > Environment variables). Gere uma chave gratuita em aistudio.google.com/apikey.' })
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
  const topicsHint = (payload.topicsHint || '').trim();

  const systemPrompt = `Voce e um assistente que transforma transcricoes brutas de reunioes (geradas por reconhecimento de voz, entao podem ter erros de transcricao e falta de pontuacao) em notas de reuniao estruturadas, em portugues do Brasil.

Responda APENAS com um JSON valido, no seguinte formato exato:

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
- Se o usuario sugerir topicos, priorize inclui-los em "topicos" quando fizerem sentido com o conteudo da transcricao (nao invente algo que nao tenha relacao nenhuma com a fala).
- Se nao houver itens de acao claros, retorne "plano_de_acao": [].
- Corrija erros obvios de transcricao por contexto, mas nao invente informacoes que nao estao no texto.
- Seja objetivo e evite repetir a transcricao literalmente no resumo.`;

  const userPrompt = `Titulo da reuniao: ${title || '(nao informado)'}
Participantes informados manualmente: ${participantsHint || '(nao informado)'}
Topicos sugeridos pelo usuario (considerar e incluir se fizer sentido): ${topicsHint || '(nao informado)'}

Transcricao:
"""
${transcript}
"""`;

  try {
    const resp = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 2000
        }
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : 'Erro na API do Gemini';
      return { statusCode: resp.status, body: JSON.stringify({ error: msg }) };
    }

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'A IA retornou um formato inesperado. Tente novamente.' }) };
    }

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao chamar a API do Gemini: ' + e.message }) };
  }
};
