# Plano de Internacionalização (i18n)

> Data: 2026-10-05  
> Estado: Planeado

## Decisões de arquitectura

### Biblioteca: `react-i18next` + `i18next`

**Porquê não alternatives:**
- `react-intl` (FormatJS) — API mais verbosa, menos adoptada no ecossistema React moderno
- Solução caseira (Context + objecto de strings) — não escala para plurais, formatação de datas/números, interpolação

**Porquê `react-i18next`:**
- Padrão de facto no ecossistema React
- Suporta lazy loading de namespaces por página
- Hook `useTranslation` simples — `t('key')`
- Detector automático de idioma (browser, localStorage, URL)
- Pluralização e interpolação built-in
- Ficheiros JSON simples — fácil de delegar a um agente de tradução

### Estrutura de ficheiros

```
dashboard/src/
  i18n/
    index.ts              ← inicialização do i18next
    locales/
      pt/
        common.json       ← strings partilhadas (botões, erros, navegação)
        status.json       ← STATUS_LABELS, PRIORITY_LABELS, etc.
        pages.json        ← strings específicas de páginas
      en/
        common.json
        status.json
        pages.json
```

### Idioma por defeito: `pt` (Português)

O browser detecta automaticamente; fallback para `pt` se não reconhecido.  
Persistência: `localStorage` (`i18nextLng`).

### Seletor de idioma

Componente simples `<LanguageSwitcher>` no `Layout.tsx` — dois botões `PT | EN`.  
Adicionar novos idiomas = criar pasta `locales/<code>/` com os 3 JSON e registar em `i18n/index.ts`.

---

## Padrão de migração de strings

### Antes
```tsx
<button>Save</button>
<p>No applications found.</p>
```

### Depois
```tsx
const { t } = useTranslation('common')
<button>{t('save')}</button>
<p>{t('no_applications')}</p>
```

### Labels em constants.ts (padrão existente)

Os `Record<X, string>` em `constants.ts` passam a ser chaves de tradução:

```ts
// antes
export const STATUS_LABELS: Record<Status, string> = { interested: 'Interested', ... }

// depois — as labels são chaves, a tradução vive nos JSON
export const STATUS_KEYS: Record<Status, string> = { interested: 'status.interested', ... }
// uso: t(STATUS_KEYS[status])
```

---

## Fases de implementação

### Fase 1 — Infraestrutura (Codex Backend ou Claude Frontend)
1. Instalar `i18next react-i18next i18next-browser-languagedetector`
2. Criar `dashboard/src/i18n/index.ts` com inicialização
3. Criar estrutura `locales/pt/` e `locales/en/` com ficheiros vazios
4. Envolver `<App>` com `<I18nextProvider>`
5. Criar `<LanguageSwitcher>` e adicionar ao `Layout.tsx`

### Fase 2 — Extracção de strings (Agente Tradutor)
1. Extrair todas as strings de `constants.ts` → `locales/pt/status.json` + `locales/en/status.json`
2. Extrair strings de navegação (`Layout.tsx`) → `locales/*/common.json`
3. Extrair strings página a página (14 páginas) → `locales/*/pages.json`
4. Substituir strings inline por chamadas `t('chave')`

### Fase 3 — Validação (Antigravity QA)
1. Verificar que todas as chaves `pt` têm equivalente `en`
2. Correr `npm run build` — sem erros TypeScript
3. Testar visualmente as duas línguas
4. Documentar chaves em falta ou inconsistentes

---

## Agentes e modelos recomendados

| Tarefa | Agente | Motivo |
|---|---|---|
| Fase 1 — setup infra | **Claude Frontend** (Claude Code) | Conhece a estrutura do projecto, bom em config React |
| Fase 2 — extracção e tradução | **Agente Tradutor** novo com **Codex** | Tarefa mecânica e repetitiva — Codex é rápido e barato; não precisa de contexto de produto |
| Fase 3 — validação | **Antigravity QA** | Já tem contexto do projecto, bom para verificação estrutural |

### Agente Tradutor (novo — Codex)

Role dedicada `Translation Agent`:
- Recebe ficheiro `.tsx` ou `.ts`
- Extrai todas as strings em português visíveis ao utilizador
- Produz entrada no JSON `locales/pt/<namespace>.json` e equivalente `locales/en/<namespace>.json`
- Substitui a string inline por `t('chave')`
- Nunca traduz strings de servidor, slugs, valores de enum ou conteúdo gerado pelo utilizador

---

## Regras para o agente tradutor

1. **Não traduzir:** slugs, UUIDs, nomes de campos de API, valores de enum internos, conteúdo escrito pelo utilizador (notas, descrições de candidaturas)
2. **Chaves em snake_case** — `save_changes`, `no_applications_found`
3. **Namespaces por domínio** — `common` (global), `status` (enums de status), `pages` (por página)
4. **Português primeiro** — a chave `pt` é a fonte de verdade; `en` é a tradução
5. **Plurais** com convenção i18next: `key_one`, `key_other`

---

## Estimativa de esforço

| Fase | Ficheiros afectados | Complexidade |
|---|---|---|
| Fase 1 | 4-5 ficheiros novos + App.tsx + Layout.tsx | Baixa |
| Fase 2 | 14 páginas + ~6 componentes + constants.ts | Média (mecânica) |
| Fase 3 | Revisão dos JSON | Baixa |

---

## Estado actual

> Atualizado em: 2026-10-06 (Fase 3 — Validação i18n concluída por Antigravity QA)

### 1. Resumo de chaves por namespace
- **`common`**: 37 chaves (PT: 37, EN: 37) — 100% paridade
- **`status`**: 19 chaves (PT: 19, EN: 19) — 100% paridade
- **`pages`**: 345 chaves (PT: 345, EN: 345) — 100% paridade
- **Total global:** 401 chaves (PT: 401, EN: 401) — 0 assimetrias (100% paridade)

### 2. Ficheiros modificados por Lote

#### Lote 1 — Infraestrutura, Constantes e Navegação Core
- `package.json` e `package-lock.json` (dependências: `i18next`, `react-i18next`, `i18next-browser-languagedetector`)
- `dashboard/src/main.tsx` (configuração do `I18nextProvider`)
- `dashboard/src/i18n/index.ts` (inicialização do i18next com deteção de idioma e fallback para `pt`)
- `dashboard/src/components/LanguageSwitcher.tsx` (seletor de idioma `PT | EN`)
- `dashboard/src/components/Layout.tsx` (navegação e integração do LanguageSwitcher)
- `dashboard/src/domain/constants.ts` (migração de labels estáticas para chaves de tradução `STATUS_KEYS`, `PRIORITY_KEYS`, `CONTRACT_TYPE_KEYS`, `RATE_PERIOD_KEYS`)
- `dashboard/src/components/Badges.tsx` (tradução de badges de status e prioridade)
- `dashboard/src/components/NextActionBox.tsx` (tradução de ações seguintes)
- `dashboard/src/components/ApplicationForm.tsx` (formulário base de candidatura)
- `dashboard/src/pages/KanbanPage.tsx`
- `dashboard/src/pages/NewApplicationPage.tsx`
- `dashboard/src/pages/ApplicationPage.tsx`
- `dashboard/src/pages/EditApplicationPage.tsx`
- `dashboard/src/pages/CvPage.tsx`
- `dashboard/src/pages/TasksPage.tsx`
- `dashboard/src/pages/TrashPage.tsx`

#### Lote 2 — Páginas Especializadas e Domínios Avançados
- `dashboard/src/components/AnswerInput.tsx` (inputs dinâmicos de resposta)
- `dashboard/src/pages/PersonalProfilePage.tsx` (perfil pessoal, línguas, autorizações, remuneração)
- `dashboard/src/pages/KnowledgePage.tsx` (Candidate Knowledge Base, filtros, categorias e aliases)
- `dashboard/src/pages/PreparationPage.tsx` (preparação de candidatura, progresso, resolução e aprovação)
- `dashboard/src/pages/JobDescriptionPage.tsx` (descrição de vaga, captura por URL/manual e proveniência)
- `dashboard/src/pages/DocumentPage.tsx` (visualização e edição de documentos Markdown)
- `dashboard/src/pages/MessagesPage.tsx` (modelos de mensagem)
- `dashboard/src/pages/SettingsPage.tsx` (definições de fuso horário e base de dados)

### 3. Gaps e Melhorias Identificadas
- **Nomenclatura das chaves:** Algumas chaves no namespace `pages` foram geradas diretamente a partir do texto integral em inglês (ex.: `job_description.original_text_paste_the_full_posting_unedited`, `preparation.no_questions_yet_add_the_ones_you_know_the_form_asks`). No futuro, simplificar para identificadores semânticos mais curtos (ex.: `job_description.original_text_hint`).
- **Pluralização formal i18next:** Várias strings usam contadores interpolados diretamente (`{{count}}`, `{{number}}`), sem explorar a chave de sufixo `_one` / `_other` do i18next. A introdução formal de regras de plural enriquece a qualidade gramatical em listas vazias/unitárias.
- **Formatação de Moeda e Data:** Valores monetários e datas ainda dependem de helpers utilitários do domínio (`formatMoney`, `formatDate`). Integrar formatadores nativos do i18next baseados no `locale` ativo (`pt-PT` vs `en-US`) uniformiza separadores de milhar/decimal e formatos de calendário.

