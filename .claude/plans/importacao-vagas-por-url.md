# Plano: importar descrição de vaga por URL

Data: 2026-10-04  
Status: proposto para implementação

## Objetivo

Adicionar duas formas de entrada à primeira etapa de criação de candidatura: importar uma URL ou colar a descrição manualmente. A importação preenche o textarea para revisão; a extração por IA continua sendo uma ação separada, usando o texto revisado. Ao criar a candidatura, salvar o conteúdo e a procedência no PostgreSQL para que a descrição continue disponível mesmo quando a página original desaparecer.

Este documento planeja a alteração; não implementa a funcionalidade.

## Base no projeto atual

| Área | Situação encontrada | Consequência para a implementação |
|---|---|---|
| `dashboard/src/pages/NewApplicationPage.tsx` | Duas etapas: texto → proposta da IA/revisão → criação. Também permite preenchimento manual. | Inserir a importação antes do fluxo existente. |
| `server/api.ts` | API Node HTTP com validação Zod; `POST /api/extract` e `POST /api/applications`. | Criar uma rota de obtenção de texto, sem chamar a IA nem criar registros. |
| `server/ai.ts` | Extração recebe `text`, `provider` e `model`; os provedores implementados são Groq e Gemini. | Reutilizar o contrato existente, sem adicionar provedores. |
| `dashboard/src/domain/applicationForm.ts` | `job_url` já existe; `formFromSuggestion()` pode substituí-lo pelo resultado da IA. | Preservar a URL informada pelo usuário durante a extração. |
| `server/postgres-store.ts` | `createApplication()` serializa a descrição e cria os registros numa transação. | Acrescentar metadados de captura nessa mesma transação. |
| `server/db/migrations/001_initial.sql` | `jobs` já possui `job_url`, `description_md`, `description_source` e `description_captured_on`. | Evitar duplicação de conteúdo e acrescentar apenas os metadados ausentes. |
| `dashboard/src/domain/jobDescription.ts` | Markdown tem `Source:`, `Captured on:`, texto original e listas estruturadas. | Manter compatibilidade com documentos e editor existentes. |
| `dashboard/src/pages/JobDescriptionPage.tsx` | Edição usa `jobRevision`; a origem é um link e a captura é uma data. | Preservar revisão e metadados ao editar a descrição. |
| `scripts/export.ts` | Exporta os documentos Markdown retornados pelo store. | Garantir que a procedência relevante também apareça no documento exportado. |

Hoje, `description_source` significa **URL de origem**, não `url`/`manual`. Além disso, `createApplication()` usa `input.date` como data de captura; esse valor pode ser uma data antiga de candidatura. Esses significados precisam ser tratados explicitamente.

## Escopo da primeira versão

- Importação server-side de páginas públicas com conteúdo no HTML ou em JSON-LD `JobPosting`.
- Texto importado editável antes de `Extract fields`.
- Preenchimento manual disponível mesmo sem credenciais de IA.
- Snapshot da descrição revisada e metadados de origem persistidos ao criar a candidatura.
- Mensagens de erro orientadas a colar o texto manualmente.
- Validação de destino, limites de recursos e testes determinísticos.

Ficam para fases posteriores: navegador Playwright, adaptadores específicos de ATS, PDFs, páginas autenticadas, reimportação de candidaturas existentes e histórico completo de versões da descrição. A primeira versão não tenta resolver CAPTCHA nem contornar bloqueios.

## Fluxo de interface

```text
URL → Import from URL → backend → texto no textarea
                                      ↓
Colar descrição ─────────────────→ revisão do texto
                                      ↓
                    Extract fields ou Fill in manually
                                      ↓
                           Step 2: revisão dos campos
                                      ↓
                             Create application
                                      ↓
                         transação no PostgreSQL
```

Na primeira etapa, exibir `Job URL`, botão `Import from URL`, separador `or` e `Paste job description`, seguindo o idioma inglês da interface. Manter `ModelPicker`, `Extract fields` e `Fill in manually`.

Regras de comportamento:

1. Importar não muda de etapa, não consome IA e não salva candidatura.
2. O botão de importação independe de chave de IA; o de extração mantém a exigência atual.
3. Distinguir estados `importing`, `extracting` e `saving`, com mensagens específicas e ações conflitantes desabilitadas.
4. Se já houver texto, pedir confirmação de substituição antes da requisição. Uma falha preserva texto, campos e metadados anteriores.
5. Uma importação bem-sucedida preenche o textarea, marca o formulário como alterado e associa metadados àquele conteúdo.
6. Editar o texto importado mantém sua origem `url`, mas marca `edited = true`. Oferecer ação explícita para descartar a importação e usar entrada manual, limpando os metadados de captura.
7. Alterar apenas o input de URL não modifica a origem do texto já importado. Ela só muda após nova importação bem-sucedida.
8. Ao extrair, preservar o `job_url` preenchido pelo usuário; usar a sugestão da IA somente se o campo estiver vazio. A IA não é responsável por decidir a procedência.
9. Em preenchimento manual, transportar também a URL informada para a revisão. A origem continua `manual` quando nenhum texto foi importado.
10. Voltar da revisão preserva texto e metadados. Usar cancelamento/identificador de requisição para impedir respostas antigas de sobrescrever uma entrada nova ou um componente desmontado.
11. Ajustar a mensagem da segunda etapa: será salvo o texto revisado, que pode ter sido colado ou importado, junto das listas estruturadas.

O `job_url` da candidatura permanece editável na revisão. Alterá-lo não reescreve a URL de onde o snapshot foi obtido.

## Contrato da importação

Adicionar `POST /api/job-postings/fetch` em `server/api.ts`, mantendo as verificações locais de host/origem e o padrão JSON da API.

Entrada estrita:

```json
{ "url": "https://example.com/jobs/123" }
```

Resposta de sucesso proposta:

```json
{
  "text": "Senior Engineer\n\nResponsibilities…",
  "requestedUrl": "https://example.com/jobs/123",
  "resolvedUrl": "https://careers.example.com/jobs/123",
  "capturedAt": "2026-10-04T10:40:00.000Z",
  "method": "json_ld"
}
```

`method` será `json_ld` ou `html`. O instante é produzido pelo backend após obter e validar o texto. Remover fragmentos das URLs; não remover parâmetros indiscriminadamente, pois podem identificar a vaga.

Falhas retornam `{ error, code }`, preservando o campo `error` consumido pelo helper `request()`. Usar códigos estáveis, como `INVALID_URL`, `BLOCKED_DESTINATION`, `FETCH_TIMEOUT`, `RESPONSE_TOO_LARGE`, `UNSUPPORTED_CONTENT`, `REMOTE_UNAVAILABLE` e `NO_JOB_CONTENT`.

- `422`: entrada inválida.
- `403`: destino proibido.
- `413`: resposta remota maior que o limite.
- `504`: prazo de importação excedido.
- `502`: falha remota, bloqueio de acesso ou conteúdo incompatível/insuficiente.

Não devolver HTML remoto, detalhes internos de rede ou stack traces. Acrescentar à mensagem de importação: `Couldn't retrieve this job posting. Paste the job description manually.`

## Serviço de obtenção e extração

Criar `server/job-posting-fetcher.ts`, com rede, resolução DNS e relógio substituíveis nos testes. Separar o transporte seguro da extração de conteúdo, evitando misturar esse serviço com `Ai`.

### Transporte e limites iniciais

- Aceitar apenas HTTP/HTTPS, sem usuário/senha na URL; limitar a URL a 4.096 caracteres e restringir portas a 80/443.
- Rejeitar localhost, IPs privados, loopback, link-local, multicast, endereços reservados e não globais, incluindo IPv6 e IPv4 mapeado em IPv6.
- Resolver nomes e validar todos os endereços retornados. Conectar somente a endereço validado, mantendo hostname/SNI e validação TLS corretos. Validar DNS e depois usar um `fetch()` comum que resolve novamente não é proteção suficiente contra DNS rebinding.
- Usar redirecionamentos manuais, no máximo cinco; resolver `Location` relativa e repetir a validação de URL/DNS/conexão em cada salto. Bloquear redirecionamento HTTPS → HTTP.
- Prazo total inicial de 15 segundos, incluindo DNS, redirecionamentos e leitura; propagar abort e encerrar streams/sockets.
- Limitar o corpo a 2 MiB efetivamente lidos/descomprimidos, mesmo sem `Content-Length`. Rejeitar conteúdo excessivo, sem truncar silenciosamente.
- Aceitar `text/html`, `application/xhtml+xml` e `text/plain`. Rejeitar binários e respostas não bem-sucedidas.
- Texto final entre 200 e 100.000 caracteres; tratar o mínimo como heurística ajustável, não como garantia de que o conteúdo é uma vaga.
- Não encaminhar cookies, credenciais da aplicação ou chaves dos provedores. Usar identificação simples do cliente e não registrar corpo remoto ou URL com parâmetros potencialmente sensíveis.
- Limitar a duas importações simultâneas no servidor local, sem fila ilimitada.

Escolher transporte Node ou biblioteca com suporte efetivo à conexão validada. Não reutilizar automaticamente o `fetcher` da IA para acesso a URLs arbitrárias. Na implementação, confirmar compatibilidade e APIs das dependências com a versão Node do projeto.

### Extração em camadas dentro do HTML

1. Usar parser HTML, como Cheerio, após confirmar versão compatível; não extrair HTML inteiro com regex.
2. Antes de remover scripts, procurar JSON-LD `JobPosting`, incluindo arrays e `@graph`. Ignorar JSON inválido e escolher uma entrada com descrição útil; diante de múltiplas vagas ambíguas, retornar erro em vez de concatenar anúncios.
3. Converter a descrição HTML do JSON-LD em texto, preservando parágrafos, listas e título quando presente.
4. Sem JSON-LD útil, remover scripts, estilos, navegação, rodapés e formulários; procurar descrição específica, `main` ou `article`, usando `body` como último recurso.
5. Decodificar entidades, normalizar espaços e manter quebras entre blocos. Não resumir, traduzir ou inventar campos.
6. Detectar ausência de conteúdo e indícios fortes de login, CAPTCHA ou tela de bloqueio. Retornar fallback; um tamanho mínimo isolado não basta para aceitar o texto.
7. Renderizar somente texto no textarea. HTML e scripts remotos nunca são inseridos no DOM da aplicação.

Para a URL Kuali/iVisa citada no texto de referência, fazer apenas uma verificação exploratória futura pelo transporte seguro. Sua compatibilidade não está comprovada por este plano e não é requisito para concluir o MVP.

## Persistência e compatibilidade

Manter `description_md` como conteúdo canônico da descrição no PostgreSQL. Não criar uma tabela paralela nem arquivos operacionais Markdown.

Adicionar uma nova migração, com o próximo número disponível — atualmente `003_job_posting_capture.sql` — sem alterar `001` ou `002`:

| Coluna | Decisão |
|---|---|
| `job_url` existente | Link editável da vaga na candidatura. |
| `description_md` existente | Texto revisado e seções, no formato Markdown atual. |
| `description_source` existente | Preservar semântica de URL de origem; para importações, usar a URL solicitada. |
| `description_captured_on` existente | Preservar como data compatível com editor e documentos atuais. |
| `description_input_kind` nova | `TEXT NULL`, restrita a `manual` ou `url`; `NULL` significa legado de procedência desconhecida. |
| `description_captured_at` nova | `TIMESTAMPTZ NULL`; instante real de captura, independente de `applied_on`. |
| `description_resolved_url` nova | `TEXT NULL`; destino final da importação. |
| `description_capture_method` nova | `TEXT NULL`, restrita a `json_ld` ou `html`. |
| `description_edited_after_capture` nova | `BOOLEAN NULL`; informa revisão do texto após importação. |

Não deduzir `input_kind = url` de registros antigos que apenas têm link. Não converter datas legadas em instantes fictícios. Manter novos metadados nulos nesses registros.

Estender o payload de criação com objeto opcional `jobPostingCapture` contendo `inputKind`, `sourceUrl`, `resolvedUrl`, `capturedAt`, `method` e `edited`. Validar combinações: metadados de importação exigem `jobPosting` e origem `url`; a entrada manual não pode declarar método ou URL resolvida de importação. O backend produz o instante para a captura manual no salvamento e nunca usa `input.date` para esse fim.

O frontend transporta os metadados devolvidos pela importação. Por ser uma aplicação pessoal local, tratá-los como informação declarada pelo cliente, sem prometer uma trilha de auditoria autenticada. O endpoint de criação valida formatos e coerência, mas não busca a página novamente.

Alterações no store:

- Ampliar `CreateApplicationInput`, validação da API e `insertApplication()` para salvar descrição e metadados numa única transação.
- Calcular a data de captura a partir do instante e `APP_TIMEZONE`, separadamente da data da candidatura.
- Preservar compatibilidade com clientes que enviam apenas `jobPosting` e `jobSections`: nova criação sem importação representa entrada manual.
- Incluir os novos metadados no retorno de `application()` e no tipo `LiveApplication`.
- Atualizar **todos** os caminhos de cópia de `jobs` em `updateApplication()` para copiar também esses metadados quando houver troca de empresa ou separação de vaga compartilhada.
- Em `saveJobDescription()`, manter `jobRevision`, preservar metadados de captura e marcar edição quando o texto original mudar. Editar o link/data legados não deve apagar o instante ou destino da importação.

Estender `JobDescription`, parser e serializer com campos opcionais de procedência, usando rótulos distintos de `Source:` e `Captured on:`. Ajustar o editor para preservá-los e mostrar a origem sem confundi-la com campos editáveis. Garantir round-trip de conteúdo legado e de textos originais com headings Markdown, inclusive headings que coincidam com as seções estruturadas.

Salvar o texto revisado como snapshot, sem baixar novamente a URL durante criação ou leitura. A indicação de edição deixa claro que esse texto pode diferir do conteúdo obtido inicialmente. O MVP não mantém uma segunda cópia do texto antes da revisão nem oferece versões imutáveis da descrição.

## Sequência de implementação

1. **Contratos e migração:** definir tipos compartilhados em `dashboard/src/domain/jobPosting.ts`; acrescentar migração, metadados Markdown e compatibilidade legada.
2. **Transporte e parser:** implementar `server/job-posting-fetcher.ts` com proteção de destino, limites e fixtures HTML/JSON-LD.
3. **API:** acrescentar rota em `server/api.ts`, erros estáveis e validação do payload de criação; manter `/api/extract` recebendo somente texto.
4. **Store:** gravar, ler e copiar metadados nas operações transacionais; preservar revisão na edição da descrição.
5. **Interface:** atualizar `NewApplicationPage.tsx`, preservação de URL e procedência, estados assíncronos e textos; ajustar `JobDescriptionPage.tsx` e tipos de leitura.
6. **Verificação e documentação:** executar testes relevantes, build e cenários manuais; atualizar README com fluxo, limitações e migração explícita.

Possíveis dependências novas: parser HTML e transporte com conexão a IP validado. Adicionar somente as necessárias, atualizar o lockfile existente e confirmar suas APIs durante a implementação. Não acrescentar Chromium ao MVP.

## Verificação prevista

Testes com `node:test`, compatíveis com `npm test`, sem depender de sites públicos:

- Parser: HTML com descrição, JSON-LD direto/array/`@graph`, JSON inválido, entidades, listas, página vazia, login e bloqueio.
- Transporte: protocolos proibidos, credenciais, portas, IPv4/IPv6 privados e mapeados, DNS com endereço proibido, conexão ao IP validado, redirecionamento para rede privada, loop, timeout, corpo sem tamanho anunciado e conteúdo excessivo.
- API: sucesso com texto/metadados, erros JSON, manutenção das restrições de origem e ausência de chamadas à IA ou persistência durante importação.
- Domínio Markdown: documentos legados, novos metadados e headings no texto original preservados na serialização e leitura.
- PostgreSQL: criação manual e por URL, captura independente de data antiga de candidatura, metadados nulos legados, cópia de vaga, edição preservando procedência e rejeição de revisão antiga.

Usar transportes/resolvedores falsos e fixtures para testar endereços bloqueados; não enfraquecer a proteção para permitir localhost em produção.

Verificação manual da interface: importar sem chave de IA, revisar texto, extrair, preencher manualmente, voltar de etapa, alterar URL, substituir texto com confirmação, receber erro mantendo conteúdo e criar candidatura. Conferir o documento salvo e exportado.

Comandos ao implementar:

```bash
npm run build
npm test
TEST_DATABASE_URL=<banco-descartavel> npm run test:postgres
```

Aplicar a nova migração por `npm run db:migrate` no ambiente de desenvolvimento durante a validação. A aplicação não deve migrar automaticamente no startup. Se não houver banco de testes disponível, registrar explicitamente que os testes de integração não foram executados.

## Critérios de aceite

- [ ] Primeira etapa aceita URL e texto colado, mantendo o fluxo manual existente.
- [ ] Importar preenche texto editável sem chamar IA, mudar de etapa ou criar registros.
- [ ] URL informada não se perde quando a IA omite ou propõe outro link.
- [ ] Falhas preservam o trabalho e indicam colagem manual como alternativa.
- [ ] Importação respeita validação de destino em DNS/conexão/redirecionamentos e limites definidos.
- [ ] Snapshot, origem e captura são salvos atomicamente com a candidatura.
- [ ] Captura não é confundida com data de candidatura nem com data legada desconhecida.
- [ ] Edição e cópia de vaga preservam metadados e controle de revisão.
- [ ] Documentos anteriores continuam legíveis/editáveis; exportação inclui a procedência.
- [ ] Build e testes aplicáveis passam, com eventuais testes indisponíveis documentados.

## Evolução após o MVP

Registrar apenas o necessário para identificar limitações recorrentes, sem armazenar conteúdo remoto em logs. Adicionar um adaptador de ATS quando houver exemplos concretos e API pública adequada; considerar Playwright quando vagas relevantes exigirem JavaScript e não houver alternativa leve. Qualquer camada futura deve manter as mesmas proteções de rede, limites, revisão do texto e fallback manual.
