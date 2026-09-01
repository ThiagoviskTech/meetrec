# MeetRec

App web (PWA) para transcrever reunioes pelo microfone do celular/computador e gerar, com IA, topicos, participantes, resumo e plano de acao.

## Como funciona

- A transcricao roda **no navegador**, usando a Web Speech API (so funciona bem no **Chrome**, Android ou desktop — Safari/iOS nao e suportado).
- Ao clicar em "Parar e gerar resumo", a transcricao e enviada para uma funcao serverless (`netlify/functions/claude-proxy.js`) que chama a API da Anthropic (Claude) e devolve o resumo estruturado.
- O historico de reunioes fica salvo localmente no navegador (localStorage) — nao ha banco de dados.
- O indicador nativo de "microfone em uso" do navegador/sistema operacional continua aparecendo normalmente durante a gravacao. Isso e uma protecao de privacidade do proprio sistema e nao e (e nao deve ser) removido pelo app.

## Configuracao necessaria no Netlify

1. Crie o site no Netlify apontando para este repositorio (sem build command; publish directory = `.`).
2. Em **Site settings > Environment variables**, adicione:
   - `ANTHROPIC_API_KEY` = sua chave da API da Anthropic (gerada em https://console.anthropic.com/settings/keys). **Nunca coloque essa chave no codigo ou no repositorio.**
   - (opcional) `ANTHROPIC_MODEL` = para trocar o modelo usado (padrao: `claude-sonnet-4-5-20250929`).
3. Faca o deploy. O Netlify detecta automaticamente a funcao em `netlify/functions/claude-proxy.js`.

## Uso

1. Abra o site publicado no Chrome do celular.
2. (Opcional) No menu do Chrome, "Adicionar a tela inicial" para instalar como app.
3. Preencha titulo e participantes (opcional), toque em "Iniciar gravacao" e permita o uso do microfone.
4. Ao terminar, toque em "Parar e gerar resumo".
5. Baixe as notas em Markdown ou consulte reunioes anteriores no icone de historico.

## Limitacoes conhecidas

- Sem diarizacao de falantes: a Web Speech API nao identifica quem esta falando. Os participantes vem do campo manual + mencoes de nomes na fala.
- Exige conexao a internet (para a etapa de resumo com IA) e navegador Chrome (para a transcricao).
- Se o modelo configurado em `ANTHROPIC_MODEL`/padrao nao existir mais na API, ajuste a constante em `netlify/functions/claude-proxy.js` ou a env var — veja a lista atual em https://docs.claude.com/en/docs/about-claude/models.

