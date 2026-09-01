// Netlify Function: claude-proxy.js
// Recebe a transcricao de uma reuniao e usa a API gratuita do Google Gemini para
// extrair topicos, participantes, resumo e plano de acao.
//
// Requer a variavel de ambiente GEMINI_API_KEY configurada no Netlify
// (Site settings > Environment variables). Chave gratuita em https://aistudio.google.com/apikey
// A chave NUNCA e exposta ao navegador.
//
// Reunioes longas (2-3h) geram transcricoes grandes, o que pode fazer a chamada unica
// ao Gemini demorar mais do que o limite de execucao do Netlify (~30s). Para evitar isso,
// transcricoes acima de CHUNK_CHAR_LIMIT sao divididas em pedacos, resumidos em paralelo,
// e so entao combinados numa chamada final — o tempo total fica limitado ao pedaco mais
// lento, nao a soma de todos.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const CHUNK_CHAR_LIMIT = 18000;
const MAX_CHUNKS = 6;

function splitIntoChunks(text) {
  if (text.length <= CHUNK_CHAR_LIMIT) return [text];
  const chunkSize = Math.max(CHUNK_CHAR_LIMIT, Math.ceil(text.length / MAX_CHUNKS));
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks;
}

async function callGemini(apiKey, signal, body) {
  const resp = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) ? data.error.message : 'Erro na API do Gemini';
    const err = new Error(msg);
    err.statusCode = resp.status;
    throw err;
  }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function summarizeChunk(apiKey, signal, chunk, idx, total) {
  const prompt = `Este e o trecho ${idx + 1} de ${total} da transcricao de uma reuniao longa (gerada por reconhecimento de voz, pode ter erros e falta de pontuacao). Liste em topicos curtos e objetivos, em portugues do Brasil: os principais assuntos discutidos, decisoes tomadas e tarefas/combinados mencionados neste trecho especifico. Nao escreva introducao nem conclusao, apenas os pontos.

Trecho:
"""
${chunk}
"""`;
  const text = await callGemini(apiKey, signal, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 600 }
  });
  return text.trim();
}

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
- Seja objetivo e evite repetir a transcricao literalmente no resumo.
- Se a entrada vier dividida em "Trechos" numerados (resumos parciais de uma reuniao longa), una-os num unico resumo coerente, sem repetir informacao entre topicos e sem mencionar que a transcricao foi dividida.`;

  const chunks = splitIntoChunks(transcript);

  // O Netlify mata a funcao aos 30s. Damos um teto um pouco menor pra sempre conseguir
  // devolver um JSON de erro amigavel, em vez do Netlify devolver uma pagina HTML de
  // timeout (que quebra o JSON.parse no front-end).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 27000);

  try {
    let transcriptSection;
    if (chunks.length === 1) {
      transcriptSection = transcript;
    } else {
      const chunkSummaries = await Promise.all(
        chunks.map((chunk, idx) => summarizeChunk(apiKey, controller.signal, chunk, idx, chunks.length))
      );
      transcriptSection = chunkSummaries.map((s, i) => `[Trecho ${i + 1}/${chunks.length}]\n${s}`).join('\n\n');
    }

    const label = chunks.length > 1
      ? 'Resumos parciais dos trechos da transcricao (reuniao longa, dividida em partes para processamento)'
      : 'Transcricao';

    const userPrompt = `Titulo da reuniao: ${title || '(nao informado)'}
Participantes informados manualmente: ${participantsHint || '(nao informado)'}
Topicos sugeridos pelo usuario (considerar e incluir se fizer sentido): ${topicsHint || '(nao informado)'}

${label}:
"""
${transcriptSection}
"""`;

    const raw = await callGemini(apiKey, controller.signal, {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 2000
      }
    });

    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'A IA retornou um formato inesperado. Tente novamente.' }) };
    }

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { statusCode: 504, body: JSON.stringify({ error: 'A IA demorou demais para responder. Tente novamente — para reuniões muito longas, isso pode acontecer ocasionalmente.' }) };
    }
    return { statusCode: e.statusCode || 500, body: JSON.stringify({ error: 'Falha ao chamar a API do Gemini: ' + e.message }) };
  } finally {
    clearTimeout(timeout);
  }
};
