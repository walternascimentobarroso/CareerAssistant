# Registo de Desenvolvimento — Application Agent (MVP)

**Data:** 2026-10-05  
**Sessão:** Implementação, Refinamento de API/UI e Validação Final de QA  
**Estado:** Concluído com sucesso (40/40 testes a passar, build limpa)

---

## 1. O que foi implementado

### A. Base de Dados e Persistência
- **Migração [`006_application_agent.sql`](file:///Users/macbook/projets/CareerAssistant/server/db/migrations/006_application_agent.sql):**
  - Criação das tabelas `knowledge_entries`, `knowledge_question_aliases`, `application_preparations` e `application_answers`.
  - Índices parciais de unicidade filtrando registos ativos (`WHERE deleted_at IS NULL`).
  - Triggers `zz_touch` para atualização de timestamps e incremento automático de `row_version`.
  - Triggers `require_active_parent` em relações pai-filho.
  - Atualização do trigger `protect_shared_delete` para impedir a eliminação de versões de CV referenciadas por preparações.
- **Store PostgreSQL ([`server/postgres-store.ts`](file:///Users/macbook/projets/CareerAssistant/server/postgres-store.ts)):**
  - CRUD transacional de Knowledge Base (`knowledge`, `knowledgeEntry`, `saveKnowledge`, `patchKnowledge`, `deleteKnowledge`).
  - Gestão de Preparação (`preparation`, `startPreparation`, `updatePreparation`, `selectPreparationCv`, `addPreparationAnswer`, `savePreparationAnswer`, `patchApplicationPreparationAnswer`, `deletePreparationAnswer`, `resolvePreparation`).
  - Suporte a rotas singulares e operações de patch parcial preservando o controlo de concorrência (`row_version`).
  - Purga controlada em cascata na eliminação definitiva da candidatura da reciclagem.

### B. Domínio e Motor de Resolução
- **Modelos de Domínio:**
  - [`dashboard/src/domain/knowledge.ts`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/domain/knowledge.ts): Schemas Zod, tipos de resposta tipados (`text`, `boolean`, `number`, `single_select`, `multi_select`, `money`), normalização NFKD (`normalizeText`), e serialização canónica de restrições com [`contextKey`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/domain/knowledge.ts#L43).
  - [`dashboard/src/domain/applicationPreparation.ts`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/domain/applicationPreparation.ts): Schemas de requisitos/respostas, cálculo de compatibilidade de opções ([`answerFits`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/domain/applicationPreparation.ts#L46)), e sumário determinístico de completude ([`preparationSummary`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/domain/applicationPreparation.ts#L54)).
- **Motor de Resolução ([`server/application-answer-resolver.ts`](file:///Users/macbook/projets/CareerAssistant/server/application-answer-resolver.ts)):**
  - Resolução determinística sem alucinações.
  - Extração estrita de dados do perfil pessoal sem inferência abusiva de autorizações.
  - Matching contextual e por idioma contra a base de conhecimento.
  - Desambiguação de qualificadores e retenção com evidências em caso de conflitos ou respostas incompatíveis.

### C. Backend API ([`server/api.ts`](file:///Users/macbook/projets/CareerAssistant/server/api.ts))
- Rotas para a Knowledge Base: `GET/POST /api/knowledge`, `GET/PATCH/PUT/DELETE /api/knowledge/:id`.
- Rotas para Preparação:
  - `GET/POST /api/applications/:slug/preparation` e `/api/applications/:slug/preparations`.
  - `PUT /api/preparations/:id`, `POST /api/preparations/:id/select-cv`, `POST /api/preparations/:id/resolve`.
  - Adição, patch e eliminação de respostas: `POST /api/preparations/:id/answers`, `PATCH /api/applications/:id/preparation/answers/:answerId`, `DELETE /api/preparations/:id/answers/:answerId`.

### D. Frontend Dashboard
- **Componentes e Páginas:**
  - [`dashboard/src/pages/KnowledgePage.tsx`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/pages/KnowledgePage.tsx): Gestão visual da Candidate Knowledge Base, filtros por categoria e idioma, formulário de adição/edição com suporte a aliases e múltiplos contextos.
  - [`dashboard/src/pages/PreparationPage.tsx`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/pages/PreparationPage.tsx): Ecrã de preparação da candidatura, barra de progresso e completude, seleção de versão de CV, revisão de propostas, edição manual e opção de memorização (`Remember this answer`).
  - [`dashboard/src/components/AnswerInput.tsx`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/components/AnswerInput.tsx): Componente dinâmico de input por tipo de dado.
  - Navegação e integração em [`dashboard/src/App.tsx`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/App.tsx), [`dashboard/src/components/Layout.tsx`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/components/Layout.tsx) e [`dashboard/src/pages/ApplicationPage.tsx`](file:///Users/macbook/projets/CareerAssistant/dashboard/src/pages/ApplicationPage.tsx).

---

## 2. Divisão de Responsabilidades e Executores

- **Claude Orquestrador / Equipa de Desenvolvimento:**
  - Conceção da arquitetura e plano inicial.
  - Implementação das migrações PostgreSQL, endpoints de API e camadas de store.
  - Desenvolvimento dos componentes e páginas React no dashboard.
  - Implementação de refinamentos nas rotas singulares e suporte a PATCH.
- **Antigravity QA (Engenheiro de QA e Documentação):**
  - Análise exaustiva da cobertura dos testes unitários e de integração (`application-agent.test.ts` e `postgres.test.ts`).
  - Verificação de conformidade de regras de arquitetura relacional (UUIDs, soft-delete, row_version e triggers).
  - Identificação de lacunas de cobertura e pontos de atenção técnica.
  - Elaboração da documentação técnica de arquitetura em [`.claude/application-agent.md`](file:///Users/macbook/projets/CareerAssistant/.claude/application-agent.md).
  - Execução e validação final da suíte completa de testes (unitários + PostgreSQL) e verificação de tipagem estática TypeScript.

---

## 3. Estado Atual do Projeto

1. **Compilação e Verificação Estática:**
   - Comando: `npm run build` (`tsc --noEmit && vite build`)
   - Resultado: **Sucesso** (0 erros TypeScript).
2. **Suíte de Testes:**
   - Comando: `TEST_DATABASE_URL="postgresql://career_assistant:career_assistant_local@127.0.0.1:5433/career_assistant" npm test`
   - Resultado: **40 testes executados, 40 testes aprovados, 0 falhas, 0 cancelados, 0 ignorados**.
   - Cobertura completa de migrações, concorrência, imutabilidade de snapshots, API HTTP e ciclo de vida de dados.
3. **Documentação:**
   - Criado e consolidado o documento de arquitetura [`.claude/application-agent.md`](file:///Users/macbook/projets/CareerAssistant/.claude/application-agent.md), incluindo secção detalhada de gaps conhecidos e extensões para fases futuras de automação com Playwright.

---

# Registo de Desenvolvimento — Internacionalização (i18n)

**Data:** 2026-10-06  
**Sessão:** Fase 3 — Validação Estrutural e de Qualidade de i18n  
**Estado:** Concluído com sucesso (401/401 chaves validadas, 100% paridade PT/EN, build limpa)

---

## 1. O que foi validado e implementado

### A. Validação de Paridade de Chaves (Script `/tmp/validate_i18n.js`)
- Executada análise exaustiva dos 6 ficheiros de locale (`dashboard/src/i18n/locales/{pt,en}/{common,status,pages}.json`).
- **Namespace `common`:** 37 chaves em PT e 37 chaves em EN (100% de correspondência).
- **Namespace `status`:** 19 chaves em PT e 19 chaves em EN (100% de correspondência).
- **Namespace `pages`:** 345 chaves em PT e 345 chaves em EN (100% de correspondência cobrindo todas as 14 páginas).
- **Total:** 401 chaves folha extraídas. Zero chaves em falta em EN, zero chaves em falta em PT. Zero assimetrias.

### B. Avaliação de Qualidade das Traduções
- Amostragem sistemática realizada nos 3 namespaces (12 chaves em cada).
- **Inglês (EN):** Terminologia natural, idiomática e correta no contexto de rastreio de candidaturas a emprego (ex.: "Applied", "Technical Interview", "Save changes", "Unable to load profile salary defaults").
- **Português (PT):** Português padrão/europeu rigoroso e consistente com a convenção do projeto (ex.: "Candidatura enviada", "Guardar alterações", «Data de candidatura», "Perfil pessoal").
- **Chaves Idênticas:** Confirmado que as únicas strings idênticas entre PT e EN são acrónimos técnicos ("CVs", "B2B"), nomes próprios ("Career Assistant", "LinkedIn", "GitHub"), formatos ("Markdown") e códigos de nível internacional CEFR ("A1"–"C2"). Sem chaves esquecidas em inglês no ficheiro português.

### C. Compilação e Testes
- `npm run build` executado com sucesso: 0 erros TypeScript no cliente React e rotas i18n.
- Suíte de 40 testes mantida a passar na totalidade (`npm test` com base de dados de integração).

### D. Documentação Atualizada
- Atualizado [`.claude/i18n-plan.md`](file:///Users/macbook/projets/CareerAssistant/.claude/i18n-plan.md) com a secção `## Estado actual`, detalhando o inventário de chaves, os ficheiros modificados no Lote 1 e Lote 2, e pontos de melhoria futura (nomenclatura semântica de chaves longas, pluralização formal i18next e formatação localizada de moedas/datas).

