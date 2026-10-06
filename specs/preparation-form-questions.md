# Spec: Perguntas do Formulário na Preparação

## Objetivo

Na página de Preparação de uma candidatura, o utilizador pode carregar as perguntas reais do formulário de candidatura (via Playwright), ver sugestões automáticas da Knowledge Base para cada pergunta, responder ou ajustar, e aprovar. Respostas novas são guardadas imediatamente na KB para reutilização futura.

## Requisitos

- Botão "Carregar perguntas do formulário" na PreparationPage, visível apenas se `apply_url` estiver definido
- Ao clicar, o sistema corre o Playwright no `apply_url` e extrai todos os campos do formulário: texto livre, checkbox, dropdown, upload de ficheiro, e outros tipos suportados
- As perguntas extraídas são guardadas como `application_answers` na preparation
- Se `application_answers` já existirem para esta preparation, o botão reutiliza os dados guardados sem voltar a correr o Playwright
- Para cada pergunta listada, o sistema sugere automaticamente a melhor resposta da KB (match por conceito ou similaridade de pergunta)
- O utilizador pode: aceitar a sugestão, modificar a sugestão, ou escrever uma resposta completamente nova
- Ao aprovar uma resposta que não existia previamente na KB, cria imediatamente um novo `knowledge_entry` com a pergunta e resposta
- Campos de upload de CV usam a `cv_version` já seleccionada na preparation — sem alterações ao fluxo existente

## Fora de âmbito

- Re-inspecção automática do formulário (Playwright só corre uma vez por preparation)
- Upload de ficheiros externos que não sejam cv_versions já existentes no sistema
- Submissão automática do formulário (pertence ao SubmitPage, já implementado)
- Criação de aliases de perguntas na KB (pode ser feito manualmente na KnowledgePage)

## Critério de concluído

- [ ] Botão "Carregar perguntas do formulário" aparece na PreparationPage quando `apply_url` está definido
- [ ] Clicar no botão corre o Playwright e lista as perguntas do formulário
- [ ] Se a preparation já tem `application_answers`, o botão mostra as perguntas guardadas sem re-inspecionar
- [ ] Cada pergunta mostra a sugestão automática da KB (se existir match)
- [ ] O utilizador pode aceitar, editar ou substituir a sugestão
- [ ] Ao aprovar uma resposta nova (não existente na KB), um `knowledge_entry` é criado imediatamente
- [ ] Campos de upload de CV continuam a usar a cv_version seleccionada (sem regressão)
- [ ] `npm run build` e `npm test` passam sem erros
