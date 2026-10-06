# Spec UX: Fluxo de candidatura com indicador de etapas

Plano de UI/UX para o frontend implementar. Não contém código; os nomes de ficheiros, props e chaves são vinculativos, a estrutura interna fica ao critério de quem implementa.

Relacionado: `specs/job-application-flow.md` (funcionalidade). Esta spec trata apenas de orientação, layout e copy.

---

## 1. Diagnóstico — onde o utilizador se perde

| # | Onde | Fricção observada no código | Gravidade |
|---|---|---|---|
| F1 | `NewApplicationPage` → `create()` | Depois de criar, navega para a visão geral (`/applications/:slug`). O passo seguinte ("Preparar candidatura") é um link pequeno na linha de metadados, ao lado de "Editar candidatura". | Alta |
| F2 | `NewApplicationPage` + `applicationForm.ts` | A IA devolve `apply_url` (`suggestion.ts`), mas `ApplicationFormValues` não tem esse campo e `formFromSuggestion` descarta-o. O link de candidatura detectado perde-se sempre. | Alta |
| F3 | `PreparationPage` → "Aplicar manualmente" | Só faz `window.open`. Nada regista a submissão: a candidatura fica em `interested` para sempre e o fluxo nunca "acaba". O registo manual existe mas está noutro sítio (`ApplicationHistory`, em inglês, "Record CV submission") e não muda o estado. | Alta |
| F4 | `JobDescriptionPage` | O link de candidatura vive aqui, num mini-formulário separado com botão próprio, longe dos outros dados da vaga. A `PreparationPage` manda o utilizador para esta página para o definir. | Média |
| F5 | `JobDescriptionPage` → `save()` | Depois de guardar, navega para a vista do documento (`/doc/job-description.md`): beco sem saída, sem botão para seguir. | Média |
| F6 | `PreparationPage` | Ordem das secções não segue a ordem de trabalho: Resumo → Contexto → CV → Perguntas → (formulário de edição) → Submeter. O "Contexto" (raramente alterado) ocupa o topo. | Média |
| F7 | `PreparationPage` | O formulário de edição de uma pergunta aparece **depois da lista inteira**, longe do cartão em que se clicou "Editar". | Média |
| F8 | `PreparationPage` | Três acções de CV sem explicação da diferença ("Usar esta versão" / "Adaptar CV para ATS"); "Resolver respostas" não diz o que faz; cinco badges por resposta. | Média |
| F9 | `PreparationPage` | "Aplicar automaticamente" desactivado só explica o motivo num `title` (tooltip, invisível em touch). | Baixa |
| F10 | `NewApplicationPage` | "Passo 1 de 2 / Passo 2 de 2" está enterrado num parágrafo `muted`; nenhum botão tem destaque de acção principal (não existe estilo `primary` no CSS). | Média |
| F11 | Todas | Nenhuma página mostra o que está completo vs pendente no conjunto. O "Resumo" da preparação só existe dentro da própria preparação. | Alta |

---

## 2. Modelo do fluxo

### 2.1 Etapas

| Nº | id | Label | O utilizador pensa… |
|---|---|---|---|
| 1 | `posting` | Vaga | "Tenho o anúncio guardado?" |
| 2 | `details` | Detalhes | "Empresa, cargo e link para me candidatar estão certos?" |
| 3 | `preparation` | Preparação | "Tenho o CV e as respostas prontos?" |
| 4 | `submit` | Submeter | "Já me candidatei e ficou registado?" |

### 2.2 Etapa → rota

| Etapa | Antes de a candidatura existir | Depois de criada |
|---|---|---|
| 1 Vaga | `/new` (sub-passo `posting`) | `/applications/:slug/job-description` |
| 2 Detalhes | `/new` (sub-passo `review`) | `/applications/:slug/edit` |
| 3 Preparação | — (não disponível) | `/applications/:slug/preparation` |
| 4 Submeter | — (não disponível) | `/applications/:slug/submit` **(rota nova)** |

A visão geral (`/applications/:slug`) **não é uma etapa**: é o ponto de entrada que mostra o indicador sem etapa activa e um cartão "Próximo passo".

Nota: `EditApplicationPage.tsx` não estava na lista de páginas do pedido, mas é a única página que edita empresa/cargo depois da criação, por isso passa a ser a etapa 2 pós-criação.

### 2.3 Diagrama

```
 Quadro ──"Nova candidatura"──▶ /new
                                 │
        ┌────────────────────────┴───────────────────────┐
        │ ETAPA 1 · Vaga            (sub-passo posting)  │
        │ link ou texto do anúncio                       │
        │ [Extrair campos e continuar]  [Continuar sem IA]│
        └────────────────────────┬───────────────────────┘
                                 ▼
        ┌────────────────────────────────────────────────┐
        │ ETAPA 2 · Detalhes        (sub-passo review)   │
        │ empresa, cargo, link de candidatura, …         │
        │ [← Voltar ao anúncio] [Criar candidatura e continuar]
        └────────────────────────┬───────────────────────┘
                                 │ POST /applications
              ┌──────────────────┴──────────────────┐
   "Data de candidatura" preenchida        em branco (caso normal)
              ▼                                     ▼
   /applications/:slug               /applications/:slug/preparation
   (fluxo já concluído)              ┌──────────────────────────────┐
                                     │ ETAPA 3 · Preparação         │
                                     │ CV → perguntas e respostas   │
                                     │ [← Detalhes] [Continuar para submissão]
                                     └──────────────┬───────────────┘
                                                    ▼
                                     /applications/:slug/submit
                                     ┌──────────────────────────────┐
                                     │ ETAPA 4 · Submeter           │
                                     │ verificação → automática     │
                                     │            ou manual+registo │
                                     └──────────────┬───────────────┘
                                                    ▼ estado = applied
                                     /applications/:slug (visão geral)

 Depois de criada, qualquer etapa é alcançável pelo indicador:
   (1) job-description ⇄ (2) edit ⇄ (3) preparation ⇄ (4) submit
 e a visão geral aponta sempre para a primeira etapa por concluir.
```

### 2.4 Princípios

1. **Não bloqueante.** "Continuar" está sempre activo. Etapas incompletas avisam, não impedem (o utilizador pode candidatar-se manualmente sem respostas preparadas).
2. **O estado vem dos dados, não de onde o utilizador clicou.** "Concluída" é calculado a partir da candidatura e da preparação; nada de novo é persistido para o indicador.
3. **Um botão principal por ecrã**, sempre no fim, à direita. "Voltar" à esquerda.
4. **O fluxo acaba.** Quando o estado deixa de ser `interested`, as páginas de edição voltam ao comportamento actual (ver 2.5).

### 2.5 Modo de fluxo

`emFluxo = application.data.status === INITIAL_STATUS` (`interested`).

| Página | `emFluxo` | Fora do fluxo (já candidatou) |
|---|---|---|
| `/new` | sempre em fluxo | — |
| Visão geral | indicador + cartão "Próximo passo" | sem indicador, sem cartão (como hoje) |
| `job-description`, `edit` | indicador + botões de fluxo | **comportamento actual** (sem indicador, "Guardar…" e destino actuais) |
| `preparation`, `submit` | indicador | indicador com as 4 etapas concluídas; acções de submissão escondidas |

### 2.6 Regras de "concluída" por etapa

Função pura nova em `dashboard/src/domain/applicationFlow.ts` (sem React), que recebe a candidatura (ou os valores do rascunho em `/new`), a preparação (`Preparation | null | undefined`) e a etapa actual, e devolve as 4 etapas já com `status`, `to` e `hint`, mais `nextStep` (primeira etapa não concluída, ou `null`).

| Etapa | Concluída quando | `hint` se pendente | `hint` se concluída |
|---|---|---|---|
| Vaga | `JOB_DESCRIPTION_FILE in application.documents`. Em `/new`: `jobPosting.trim() !== ''` | "Sem descrição" | — |
| Detalhes | `company` e `role` preenchidos **e** `apply_url` começa por `http://` ou `https://` (mesma regra já usada em `PreparationPage`) | "Falta o link de candidatura" | — |
| Preparação | preparação existe **e** `preparationSummary(p).total > 0` **e** `accepted === total` | preparação `null`: "Por começar" · `total === 0`: "Sem itens listados" · senão: "{{accepted}} de {{total}} prontos" | — |
| Submeter | `status !== 'interested'` | — | "Enviada em {{date}}" (se `applied_at`) |

Não usar `summary.status === 'READY'` para a etapa 3: esse estado exige `formInspected`, que só acontece na etapa 4.

`preparation === undefined` significa "ainda a carregar": etapa 3 fica `pending` sem `hint`.

**Dados da preparação fora da `PreparationPage`:** hook novo `usePreparation(slug)` em `dashboard/src/data/` que faz `GET /api/applications/:slug/preparation` (já existe, só leitura, devolve `{ preparation: null }` se ainda não começou — não cria nada). Usado por visão geral, `job-description` e `edit`. Um erro neste pedido não mostra mensagem: a etapa 3 fica simplesmente sem `hint`.

---

## 3. Componente `StepIndicator`

Ficheiro: `dashboard/src/components/StepIndicator.tsx`. Só apresentação: não calcula estados nem faz pedidos.

### 3.1 Props

```ts
type FlowStepId = 'posting' | 'details' | 'preparation' | 'submit'
type FlowStepStatus = 'completed' | 'active' | 'pending'
type FlowStep = {
  id: FlowStepId
  status: FlowStepStatus
  to: string | null   // rota da etapa; null = não navegável
  hint?: string       // texto já traduzido, linha secundária
}
type Props = { steps: readonly FlowStep[] }
```

Os tipos vivem em `domain/applicationFlow.ts`; o componente importa-os. O label vem de `t('flow.steps.<id>')`.

### 3.2 Estados

| Estado | Significado | Círculo | Label | Interacção |
|---|---|---|---|---|
| `completed` | Os dados da etapa estão completos | fundo `--accent`, "✓" na cor `--surface` | cor `--text`, peso normal | link se `to !== null` |
| `active` | Etapa do ecrã actual (ganha a `completed` na apresentação) | fundo `--surface`, borda 2px `--accent`, número em `--accent` | cor `--text`, **peso 600** | não é link; `aria-current="step"` |
| `pending` | Falta alguma coisa, ou ainda não lá chegou | fundo `--surface`, borda 1px `--border`, número em `--muted` | cor `--muted` | link se `to !== null`; se `to === null`, texto simples |

Uma etapa anterior à actual pode estar `pending` (ex.: estou na Preparação mas falta o link em Detalhes). É intencional: é assim que o utilizador vê o que ficou por fazer.

Na visão geral nenhuma etapa está `active`.

### 3.3 Visual

```
 Desktop (> 640px)

  (✓)───────────( 2 )───────────( 3 )───────────( 4 )
  Vaga          Detalhes        Preparação      Submeter
                Falta o link    2 de 5 prontos
                de candidatura

 Mobile (≤ 640px): só o label da etapa activa; hints escondidos

  (✓)────( 2 )────( 3 )────( 4 )
          Detalhes
```

- Estrutura: `<nav aria-label={t('flow.nav_label')}>` › `<ol className="steps">` › `<li className="step" data-status="…">`.
- Círculo: 24×24px, `border-radius: 50%`, número/✓ centrado, 12px, peso 600.
- Conector: linha horizontal de 1px entre círculos, `--border`; passa a `--accent` quando a etapa **à esquerda** está `completed`.
- Label: 13px por baixo do círculo. Hint: 12px, `--muted`, máximo 2 linhas.
- As 4 colunas têm a mesma largura (`grid-template-columns: repeat(4, 1fr)`), alinhadas à esquerda com o conteúdo de `.detail` (máx. 820px).
- Link: sem sublinhado; `:hover` e `:focus-visible` sublinham o label. Área clicável = círculo + label.
- **Sempre visível:** `position: sticky; top: 0; z-index: 1; background: var(--bg); padding: 8px 0; border-bottom: 1px solid var(--border)`. A `.topbar` não é sticky, por isso `top: 0` chega.
- Sem animações nem transições.
- Não introduzir cores novas: só os tokens existentes em `:root` (funciona em modo escuro sem trabalho extra).

### 3.4 Acessibilidade

- Cada item tem texto só para leitores de ecrã com o estado: `t('flow.status.completed')` / `t('flow.status.pending')`. O activo usa `aria-current="step"` (sem texto extra).
- Requer classe utilitária nova `.visually-hidden` em `styles.css`.
- O "✓" tem `aria-hidden="true"`.
- As etapas navegáveis são `<Link>` normais: o `useUnsavedGuard` já intercepta cliques em links, por isso a confirmação de alterações por guardar funciona sem código extra. Não usar `navigate()` em `onClick` no indicador (contornaria a guarda).

### 3.5 Posicionamento na página

Primeiro filho de `<article className="detail">`, **antes** do link "←" de voltar. Em `/new` todas as etapas têm `to: null` (indicador apenas informativo; a navegação faz-se pelos botões).

---

## 4. Padrões partilhados (CSS em `styles.css`)

| Classe | Uso |
|---|---|
| `button.primary` | Acção principal: fundo `--accent`, texto `--surface`, borda `--accent`. Uma por ecrã. Aplica-se também a `<Link className="button primary">` (ver abaixo). |
| `.button` | Dá a um `<Link>` o aspecto de botão (mesmo padding/borda/raio de `button`). Para "Continuar" sem gravação e para "← Voltar". |
| `.flow-actions` | Rodapé de etapa: `display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 16px`. Voltar à esquerda, principal à direita. |
| `.flow-note` | Aviso não bloqueante por cima do rodapé: fundo `--today-bg`, cor `--today`, padding 8px 12px, raio 5px. |
| `.checklist` | Lista sem marcadores; cada `<li>` começa por "✓" (`--accent`) ou "○" (`--muted`). |
| `.visually-hidden` | Texto só para leitores de ecrã. |

**Regra do botão principal em páginas de edição** (`job-description`, `edit`, em fluxo):
- com alterações por guardar → "Guardar e continuar" (grava, depois navega);
- sem alterações → "Continuar" (só navega).

Não criar um componente para o rodapé: o que "continuar" faz difere demasiado entre páginas.

---

## 5. Alterações por página

### 5.1 `NewApplicationPage.tsx` — etapas 1 e 2

**Fica:** importação por URL, colar texto, `ModelPicker`, extracção, confirmações `window.confirm`, lógica `imported`/proveniência, guarda de alterações, listas extraídas, remuneração do perfil.

**Muda — comum aos dois sub-passos**
- `StepIndicator` no topo. Sub-passo `posting`: 1 `active`, restantes `pending`. Sub-passo `review`: 1 `completed` se há texto (senão `pending`), 2 `active`, 3–4 `pending`. Todos com `to: null`.
- As frases "Passo 1 de 2." / "Passo 2 de 2." saem do copy (`step_one`, `step_two`): o indicador substitui-as.

**Muda — sub-passo `posting` (Etapa 1 · Vaga)**

```
[StepIndicator]
← Quadro
Nova candidatura
Importa o anúncio pelo endereço ou cola o texto. Ainda não é guardado nada.

┌ Anúncio ─────────────────────────────────────────────┐
│ Endereço da vaga  [https://________________________] │
│ [Importar por URL]  Apenas páginas públicas. …       │
│ ou                                                   │
│ Colar descrição da vaga                              │
│ [ textarea 16 linhas                               ] │
│ Importado de … [Tratar como texto colado]            │
└──────────────────────────────────────────────────────┘
┌ Leitura com IA ──────────────────────────────────────┐
│ [ModelPicker]                                        │
│ Apenas o texto do anúncio é enviado ao fornecedor; … │
└──────────────────────────────────────────────────────┘
(motivo se o botão principal estiver desactivado)
                 [Continuar sem IA] [Extrair campos e continuar]
```

- Dois `<fieldset>` com `<legend>`: "Anúncio" e "Leitura com IA".
- Rodapé `.flow-actions`: à esquerda nada; à direita "Continuar sem IA" (secundário, era "Preencher manualmente") e "Extrair campos e continuar" (`primary`).
- Quando o principal está desactivado, mostrar o motivo em texto visível por cima do rodapé (`.muted`), por esta ordem:
  1. sem texto → "Cola ou importa o anúncio para a IA o poder ler."
  2. sem chave → mensagem existente `provider_no_key` (passa a aparecer aqui, não solta no meio do formulário).

**Muda — sub-passo `review` (Etapa 2 · Detalhes)**
- Campo novo **"Link de candidatura"** no `ApplicationForm` (ver 5.6), preenchido pela sugestão da IA e marcado como `suggested`. Corrige F2.
- `withTypedUrl` continua a aplicar-se só a `job_url`.
- Rodapé `.flow-actions`: esquerda "← Voltar ao anúncio" (existente); direita "Criar candidatura e continuar" (`primary`).
- Destino depois de criar:
  - "Data de candidatura" em branco → `/applications/:slug/preparation` (corrige F1);
  - preenchida (candidatura já enviada) → `/applications/:slug`, como hoje.
- Texto do botão acompanha: com data preenchida o label é "Criar candidatura" (sem "e continuar").

### 5.2 `JobDescriptionPage.tsx` — etapa 1 depois de criada

**Fica:** edição do texto original, origem, data de captura, listas, proveniência, "outro conteúdo", controlo de revisão.

**Muda**
- `StepIndicator` no topo quando `emFluxo` (etapa 1 `active`).
- **Sai** o mini-formulário "Link de candidatura" (estado `applyUrl`, `saveApplyUrl`, respectiva mensagem). O campo passa para Detalhes. Corrige F4.
- Em fluxo: rodapé `.flow-actions` — esquerda "← Visão geral" (link para `/applications/:slug`); direita botão principal conforme regra da secção 4, destino `/applications/:slug/edit`. Corrige F5.
- Fora do fluxo: botão e destino actuais ("Guardar descrição da vaga" → vista do documento).
- "Alterações por guardar" continua a aparecer ao lado do botão.

### 5.3 `EditApplicationPage.tsx` — etapa 2 depois de criada

**Fica:** tudo (formulário, validação, revisão).

**Muda**
- `StepIndicator` no topo quando `emFluxo` (etapa 2 `active`).
- Ganha o campo "Link de candidatura" por via do `ApplicationForm`.
- Em fluxo: rodapé `.flow-actions` — esquerda "← Vaga" (link para `…/job-description`); direita botão principal conforme regra da secção 4, destino `…/preparation`.
- Fora do fluxo: "Guardar alterações" → visão geral, como hoje.

### 5.4 `PreparationPage.tsx` — etapa 3

O componente passa a servir duas rotas, com uma prop `view: 'prepare' | 'submit'`. Esta secção descreve `view="prepare"`.

**Fica:** toda a lógica (`run`, revisões, conflito 409, `adaptCv`, respostas, memorizar, escopos), `AnswerInput`, guarda de alterações.

**Nova ordem do ecrã**

```
[StepIndicator]                       (3 active)
← {empresa}
Preparar candidatura
{empresa} · {cargo}
(mensagem de estado / botão "Carregar versão atual")

O que falta                           ← substitui "Resumo"
  ✓ CV fixado: {nome} v{n}
  ○ Respostas: 2 de 5 aceites · 1 por rever · 2 em falta
  [badge de estado]

▸ Contexto do formulário — País: DE · Idioma: en · CV obrigatório   (<details> fechado)

1. CV
2. Perguntas e respostas
                         [← Detalhes]  [Continuar para submissão]
```

**Muda**
1. **"O que falta"** substitui a secção "Resumo": `.checklist` com duas linhas.
   - CV: "✓ CV fixado: {{version}}" · "○ Nenhum CV fixado" · "✓ CV não obrigatório".
   - Respostas: "✓ Todas as respostas obrigatórias aceites ({{total}})" · "○ Respostas: {{accepted}} de {{total}} aceites · {{pending}} por rever · {{missing}} em falta" · "○ Ainda não há perguntas listadas".
   - O badge de estado mantém-se. A frase `form_not_inspected_hint` sai daqui (vai para a etapa 4).
2. **Contexto** passa a `<details>` fechado por omissão, com `<summary>` que mostra os valores actuais. Abre automaticamente se `contextDirty`. Conteúdo e botão "Guardar contexto" inalterados. Corrige F6.
3. **Secção "1. CV"** (era "Versão do CV"):
   - Linha de estado por cima do selector: "CV fixado para esta candidatura: {{version}}" ou "Ainda não fixaste um CV."
   - Frase explicativa (`.muted`): "«Usar esta versão» fixa o CV tal como está. «Adaptar para ATS» cria uma versão nova ajustada a esta vaga e fixa-a."
   - Botões: "Usar esta versão" e "Adaptar para ATS" (era "Adaptar CV para ATS"), ambos secundários; o segundo sempre visível (desactivado sem selecção), para não saltar no layout.
4. **Secção "2. Perguntas e respostas"** (era "Perguntas e requisitos"):
   - "Resolver respostas" → "Preencher respostas automaticamente", com `.muted` ao lado: "Usa o teu perfil e a base de conhecimento."
   - **Formulário de edição no sítio:** ao editar uma resposta, o formulário aparece no lugar do cartão dessa resposta; "Nova pergunta" aparece logo abaixo da barra de botões, antes da lista. Corrige F7.
   - Badges por resposta reduzidos a dois: obrigatório/opcional e aprovação. Tipo, origem e confiança passam para uma linha `.muted` por baixo: "{{type}} · Origem: {{source}} · Confiança: {{confidence}}". Corrige F8.
5. **Sai** a secção "Submeter candidatura" e o `FormInspectionDialog` desta vista (vão para `view="submit"`).
6. **Rodapé `.flow-actions`:** esquerda "← Detalhes" (link para `…/edit`); direita "Continuar para submissão" (`primary`, link para `…/submit`). Desactivado só enquanto há rascunho de pergunta aberto ou `busy`.
7. **Aviso não bloqueante** (`.flow-note`) por cima do rodapé quando a etapa não está concluída: "Ainda faltam itens obrigatórios. Podes continuar, mas a candidatura automática pode não conseguir preencher tudo."

### 5.5 Vista "Submeter" — etapa 4 (`/applications/:slug/submit`)

Rota nova em `App.tsx`: `applications/:slug/submit` → `<PreparationPage view="submit" />`. A rota existente passa a `<PreparationPage view="prepare" />`. Mudar de rota remonta o componente e recarrega a preparação; é aceitável.

```
[StepIndicator]                       (4 active)
← {empresa}
Submeter candidatura
{empresa} · {cargo}

Antes de submeter
  ✓ Link de candidatura: careers.example.com/…
  ○ CV: nenhum fixado                     → Preparação
  ○ Respostas: 2 de 5 aceites             → Preparação
  ○ Formulário ainda não inspecionado

┌ Candidatura automática ─────────────────────────────┐
│ Abrimos o formulário, preenchemos com as tuas       │
│ respostas aceites e mostramos-te o resultado antes  │
│ de enviar. Nada é enviado sem a tua confirmação.    │
│ [Preencher e rever formulário]                      │
│ (motivo, se desactivado)                            │
└─────────────────────────────────────────────────────┘
┌ Candidatura manual ─────────────────────────────────┐
│ Abre a página, candidata-te e regista aqui o envio. │
│ [Abrir página de candidatura ↗]                     │
│ Data de envio [2026-10-06]  [Já me candidatei — registar envio]
└─────────────────────────────────────────────────────┘
[← Preparação]
```

**Verificação "Antes de submeter"** (`.checklist`)
| Linha | ✓ quando | Texto ✓ | Texto ○ | Link de correcção |
|---|---|---|---|---|
| Link | `apply_url` http(s) válido | "Link de candidatura: {{host}}" | "Falta o link de candidatura" | "Definir em Detalhes" → `…/edit` |
| CV | `preparation.cv` ou `!cvRequired` | "CV: {{version}}" / "CV não obrigatório" | "CV: nenhum fixado" | "Ir para Preparação" → `…/preparation` |
| Respostas | `accepted === total` e `total > 0` | "Respostas: todas aceites ({{total}})" | "Respostas: {{accepted}} de {{total}} aceites" | idem |
| Formulário | `preparation.formInspected` | "Formulário inspecionado" | "Formulário ainda não inspecionado" | — |

**Cartão "Candidatura automática"**
- Botão `primary` "Preencher e rever formulário" (era "Aplicar automaticamente"; o novo label diz o que acontece e que há revisão). Em curso: "A inspecionar o formulário…".
- Mesma condição de activação (`canApplyAutomatically`). Se desactivado, o motivo é **texto visível** por baixo do botão (não `title`): "Requer o link de candidatura e pelo menos uma resposta aceite." Corrige F9.
- `FormInspectionDialog` sem alterações de comportamento.

**Cartão "Candidatura manual"**
- "Abrir página de candidatura ↗" — só existe com `apply_url` válido; senão, texto `.muted`: "Sem link de candidatura. Podes candidatar-te pelo canal que tiveres e registar o envio abaixo."
- Campo "Data de envio" (`type="date"`, por omissão hoje via `todayIsoDate()`) + botão "Já me candidatei — registar envio". Corrige F3.
- Confirmação antes de registar (`window.confirm`): "Registar a candidatura a {{company}} como enviada em {{date}}?"
- Ver secção 6 para o que o registo faz.

**Depois de submetida** (automática ou manual; ou ao abrir a vista com `status !== 'interested'`)
- Os dois cartões e a verificação são substituídos por:
  "✓ Candidatura enviada em {{date}}." + botão `primary` "Ver candidatura" → `/applications/:slug`.
- O indicador mostra as 4 etapas concluídas (a 4 continua `active` neste ecrã).

**Rodapé:** só "← Preparação" à esquerda. Não há "Continuar": os botões dos cartões são as acções desta etapa.

### 5.6 `ApplicationForm.tsx` — campo novo

- Novo campo de texto `apply_url` no fieldset "Job", imediatamente a seguir a "Job posting URL": `type="url"`, placeholder `https://…`.
- Texto de ajuda por baixo (`.muted`): "Página onde se submete a candidatura. Necessário para a candidatura automática; podes acrescentá-lo depois."
- Em `domain/applicationForm.ts`: acrescentar `apply_url` a `ApplicationFormValues`, `formFromApplication`, `formFromSuggestion` (a partir de `suggestion.apply_url`) e `fieldsFromForm` (`null` quando vazio, como `job_url`).
- Nota fora de âmbito: os restantes labels do `ApplicationForm` estão em inglês fixo no código. O campo novo usa i18n (chaves na secção 7); traduzir o resto do formulário é trabalho à parte.

### 5.7 `ApplicationPage.tsx` — visão geral

**Fica:** tudo o que existe (cabeçalho, remuneração, contacto, documentos, entrevistas, histórico, cronologia, etiquetas, notas, remover).

**Muda, só quando `emFluxo`**
- `StepIndicator` logo a seguir ao link "← Quadro", sem etapa activa; todas as etapas são links.
- Cartão **"Próximo passo"** entre o `<header>` e a secção "Próxima ação" (reutiliza o aspecto de `.next-action`): título, uma frase e um botão `primary` que leva à primeira etapa não concluída (`nextStep`).

| `nextStep` | Título | Frase | Botão → destino |
|---|---|---|---|
| `posting` | "Guarda o anúncio da vaga" | "Sem o texto do anúncio não é possível adaptar o CV a esta vaga." | "Adicionar descrição da vaga" → `…/job-description` |
| `details` | "Completa os detalhes" | "Falta o link de candidatura." | "Completar detalhes" → `…/edit` |
| `preparation` | "Prepara a candidatura" | "Escolhe o CV e revê as respostas ao formulário." | "Preparar candidatura" → `…/preparation` |
| `submit` | "Está tudo pronto" | "Submete a candidatura e regista o envio." | "Submeter candidatura" → `…/submit` |

- Na linha de metadados, o link "Preparar candidatura" sai enquanto `emFluxo` (o cartão substitui-o). "Editar candidatura" mantém-se.

**Fora do fluxo:** sem indicador nem cartão. O link de metadados passa a chamar-se "Ver preparação" (leva a `…/preparation`).

Para não confundir "Próximo passo" (fluxo de candidatura) com "Próxima ação" (tarefa do utilizador, já existente): o cartão novo só existe antes de candidatar; a secção "Próxima ação" não muda.

### 5.8 `App.tsx` e `Layout.tsx`

- `App.tsx`: uma rota nova (`applications/:slug/submit`) e a prop `view` nas duas rotas da preparação.
- `Layout.tsx`: **sem alterações.** O indicador pertence às páginas do fluxo, não à barra global.

---

## 6. Backend

| # | Alteração | Necessária? | Porquê |
|---|---|---|---|
| B1 | Registar submissão manual numa só transacção | **Sim** (ver opções) | F3: hoje "Aplicar manualmente" não regista nada |
| B2 | `apply_url` na criação/edição | Não | `POST /applications` e `PATCH /applications/:slug` já aceitam `fields.apply_url` (`EDITABLE_FIELDS`, `schema.ts`); a IA já o devolve (`ai.ts`, `suggestion.ts`). É só frontend. |
| B3 | Estado das etapas | Não | Calculado no cliente; `GET /applications/:slug/preparation` já existe e é só leitura. |
| B4 | Rota `/submit` | Não | Rota só de frontend (HashRouter). |

### B1 — duas abordagens (decisão em aberto)

**Opção A — endpoint novo (recomendada)**
`POST /api/applications/:slug/preparation/record-submission` com `{ revision, date }`, numa transacção:
- `status → applied`, `applied_on = date`;
- se a preparação tem CV fixado: `application_cvs` com `state = 'sent'`, `sent_on = date`, `channel = apply_url` (ou `null`);
- evento de cronologia `applied` ("Application submitted manually"), com `from`/`to` e canal;
- rejeita revisão desactualizada (409) e candidatura que já não está em `interested` (409).

É a contraparte manual de `recordFormSubmission`, reutilizando a mesma lógica. Respeita a regra do projecto "mudança de estado + evento numa transacção" e "registar submissões reais separadamente".

**Opção B — só endpoints existentes**
Frontend chama `PATCH /applications/:slug/status` (`applied`) e depois `POST /applications/:slug/cv-send`.
- A favor: zero backend.
- Contra: duas transacções (a segunda pode falhar e deixar estado aplicado sem CV enviado); a revisão muda entre chamadas (obriga a recarregar no meio); o evento fica como `status_changed` genérico em vez de `applied`; `cv-send` exige um CV em estado `selected`.

### Opcional (não bloqueia)
- B5: incluir um resumo da preparação (`total`, `accepted`, `missing`, `cvSelected`) no payload de `GET /applications`, para dispensar o pedido extra de `usePreparation` e, no futuro, mostrar progresso nos cartões do Quadro. Só vale a pena se o pedido extra se notar.

---

## 7. i18n

Ficheiros: `dashboard/src/i18n/locales/{pt,en}/pages.json` (e `common.json` onde indicado). As duas línguas têm de ser actualizadas.

### 7.1 Chaves novas — `pages.json`

**`flow.*` (indicador e cartão "Próximo passo")**

| Chave | pt | en |
|---|---|---|
| `flow.nav_label` | Etapas da candidatura | Application steps |
| `flow.steps.posting` | Vaga | Job posting |
| `flow.steps.details` | Detalhes | Details |
| `flow.steps.preparation` | Preparação | Preparation |
| `flow.steps.submit` | Submeter | Submit |
| `flow.status.completed` | concluída | completed |
| `flow.status.pending` | pendente | pending |
| `flow.hints.no_posting` | Sem descrição | No description |
| `flow.hints.no_apply_link` | Falta o link de candidatura | Application link missing |
| `flow.hints.not_started` | Por começar | Not started |
| `flow.hints.no_items` | Sem itens listados | No items listed |
| `flow.hints.progress` | {{accepted}} de {{total}} prontos | {{accepted}} of {{total}} ready |
| `flow.hints.submitted_on` | Enviada em {{date}} | Sent on {{date}} |
| `flow.continue` | Continuar | Continue |
| `flow.save_and_continue` | Guardar e continuar | Save and continue |
| `flow.back_to_overview` | ← Visão geral | ← Overview |
| `flow.back_to_posting` | ← Vaga | ← Job posting |
| `flow.back_to_details` | ← Detalhes | ← Details |
| `flow.back_to_preparation` | ← Preparação | ← Preparation |
| `flow.next.title` | Próximo passo | Next step |
| `flow.next.posting.title` | Guarda o anúncio da vaga | Save the job posting |
| `flow.next.posting.text` | Sem o texto do anúncio não é possível adaptar o CV a esta vaga. | Without the posting text the CV cannot be adapted to this job. |
| `flow.next.posting.action` | Adicionar descrição da vaga | Add job description |
| `flow.next.details.title` | Completa os detalhes | Complete the details |
| `flow.next.details.text` | Falta o link de candidatura. | The application link is missing. |
| `flow.next.details.action` | Completar detalhes | Complete details |
| `flow.next.preparation.title` | Prepara a candidatura | Prepare the application |
| `flow.next.preparation.text` | Escolhe o CV e revê as respostas ao formulário. | Choose the CV and review the form answers. |
| `flow.next.preparation.action` | Preparar candidatura | Prepare application |
| `flow.next.submit.title` | Está tudo pronto | Everything is ready |
| `flow.next.submit.text` | Submete a candidatura e regista o envio. | Submit the application and record it. |
| `flow.next.submit.action` | Submeter candidatura | Submit application |

**`application_form.*`**

| Chave | pt | en |
|---|---|---|
| `application_form.apply_url` | Link de candidatura | Application link |
| `application_form.apply_url_hint` | Página onde se submete a candidatura. Necessário para a candidatura automática; podes acrescentá-lo depois. | Page where the application is submitted. Needed for automatic applications; you can add it later. |

**`new_application.*`**

| Chave | pt | en |
|---|---|---|
| `new_application.posting_legend` | Anúncio | Posting |
| `new_application.ai_legend` | Leitura com IA | AI reading |
| `new_application.extract_and_continue` | Extrair campos e continuar | Extract fields and continue |
| `new_application.continue_without_ai` | Continuar sem IA | Continue without AI |
| `new_application.needs_posting` | Cola ou importa o anúncio para a IA o poder ler. | Paste or import the posting so the AI can read it. |
| `new_application.create_and_continue` | Criar candidatura e continuar | Create application and continue |

**`preparation.*`**

| Chave | pt | en |
|---|---|---|
| `preparation.whats_missing` | O que falta | What is missing |
| `preparation.check_cv_fixed` | CV fixado: {{version}} | CV fixed: {{version}} |
| `preparation.check_cv_none` | Nenhum CV fixado | No CV fixed |
| `preparation.check_cv_not_required` | CV não obrigatório | CV not required |
| `preparation.check_answers_done` | Todas as respostas obrigatórias aceites ({{total}}) | All required answers accepted ({{total}}) |
| `preparation.check_answers_progress` | Respostas: {{accepted}} de {{total}} aceites · {{pending}} por rever · {{missing}} em falta | Answers: {{accepted}} of {{total}} accepted · {{pending}} to review · {{missing}} missing |
| `preparation.check_answers_none` | Ainda não há perguntas listadas | No questions listed yet |
| `preparation.context_summary` | Contexto do formulário — País: {{country}} · Idioma: {{language}} · {{cv}} | Form context — Country: {{country}} · Language: {{language}} · {{cv}} |
| `preparation.context_cv_required` | CV obrigatório | CV required |
| `preparation.context_cv_optional` | CV não obrigatório | CV not required |
| `preparation.cv_section` | 1. CV | 1. CV |
| `preparation.cv_fixed` | CV fixado para esta candidatura: {{version}} | CV fixed for this application: {{version}} |
| `preparation.cv_not_fixed` | Ainda não fixaste um CV. | You have not fixed a CV yet. |
| `preparation.cv_actions_hint` | «Usar esta versão» fixa o CV tal como está. «Adaptar para ATS» cria uma versão nova ajustada a esta vaga e fixa-a. | "Use this version" fixes the CV as it is. "Adapt for ATS" creates a new version tailored to this job and fixes it. |
| `preparation.questions_section` | 2. Perguntas e respostas | 2. Questions and answers |
| `preparation.resolve_hint` | Usa o teu perfil e a base de conhecimento. | Uses your profile and the knowledge base. |
| `preparation.answer_meta` | {{type}} · Origem: {{source}} · Confiança: {{confidence}} | {{type}} · Source: {{source}} · Confidence: {{confidence}} |
| `preparation.continue_to_submit` | Continuar para submissão | Continue to submission |
| `preparation.incomplete_note` | Ainda faltam itens obrigatórios. Podes continuar, mas a candidatura automática pode não conseguir preencher tudo. | Required items are still missing. You can continue, but the automatic application may not fill everything in. |

**`submit.*` (vista nova)**

| Chave | pt | en |
|---|---|---|
| `submit.title` | Submeter candidatura | Submit application |
| `submit.before` | Antes de submeter | Before submitting |
| `submit.check_link` | Link de candidatura: {{host}} | Application link: {{host}} |
| `submit.check_link_missing` | Falta o link de candidatura | Application link missing |
| `submit.fix_in_details` | Definir em Detalhes | Set it in Details |
| `submit.check_cv` | CV: {{version}} | CV: {{version}} |
| `submit.check_cv_none` | CV: nenhum fixado | CV: none fixed |
| `submit.check_answers_done` | Respostas: todas aceites ({{total}}) | Answers: all accepted ({{total}}) |
| `submit.check_answers_progress` | Respostas: {{accepted}} de {{total}} aceites | Answers: {{accepted}} of {{total}} accepted |
| `submit.fix_in_preparation` | Ir para Preparação | Go to Preparation |
| `submit.check_form` | Formulário inspecionado | Form inspected |
| `submit.check_form_pending` | Formulário ainda não inspecionado | Form not inspected yet |
| `submit.auto_title` | Candidatura automática | Automatic application |
| `submit.auto_text` | Abrimos o formulário, preenchemos com as tuas respostas aceites e mostramos-te o resultado antes de enviar. Nada é enviado sem a tua confirmação. | We open the form, fill it in with your accepted answers and show you the result before sending. Nothing is sent without your confirmation. |
| `submit.auto_action` | Preencher e rever formulário | Fill in and review form |
| `submit.manual_title` | Candidatura manual | Manual application |
| `submit.manual_text` | Abre a página, candidata-te e regista aqui o envio. | Open the page, apply, and record it here. |
| `submit.manual_open` | Abrir página de candidatura ↗ | Open application page ↗ |
| `submit.manual_no_link` | Sem link de candidatura. Podes candidatar-te pelo canal que tiveres e registar o envio abaixo. | No application link. Apply through whatever channel you have and record it below. |
| `submit.sent_on` | Data de envio | Sent on |
| `submit.record` | Já me candidatei — registar envio | I have applied — record it |
| `submit.record_confirm` | Registar a candidatura a {{company}} como enviada em {{date}}? | Record the application to {{company}} as sent on {{date}}? |
| `submit.recording` | A registar… | Recording… |
| `submit.done` | Candidatura enviada em {{date}}. | Application sent on {{date}}. |
| `submit.view_application` | Ver candidatura | View application |

**`application.*`**

| Chave | pt | en |
|---|---|---|
| `application.view_preparation` | Ver preparação | View preparation |

### 7.2 Chaves existentes com copy alterado

| Chave | pt (novo) | en (novo) |
|---|---|---|
| `new_application.step_one` | Importa o anúncio pelo endereço ou cola o texto. Ainda não é guardado nada. | Import the posting by address or paste the text. Nothing is saved yet. |
| `new_application.step_two` | {{identifier}} Deixa «Data de candidatura» em branco se ainda não enviaste a candidatura. | {{identifier}} Leave "Applied on" empty if you have not applied yet. |
| `preparation.resolve_answers` | Preencher respostas automaticamente | Fill in answers automatically |
| `preparation.adapt_cv_for_ats` | Adaptar para ATS | Adapt for ATS |
| `preparation.adapting` | A adaptar… | Adapting… |
| `preparation.inspecting` | A inspecionar o formulário… | Inspecting the form… |
| `preparation.submitting` | A submeter… | Submitting… |
| `preparation.auto_apply_requirements` | Requer o link de candidatura e pelo menos uma resposta aceite. | Requires the application link and at least one accepted answer. |
| `preparation.detected_fields` | Campos detetados | Detected fields |
| `preparation.no_fields_detected` | Nenhum campo detetado. | No fields detected. |
| `preparation.confirm_and_submit` | Confirmar e submeter | Confirm and submit |

(As últimas linhas uniformizam reticências "…" e a grafia já usada no resto do ficheiro.)

### 7.3 Chaves que deixam de ser usadas (remover das duas línguas)

`new_application.extract_fields`, `new_application.fill_manually`, `job_description.apply_link`, `job_description.save_apply_link`, `job_description.apply_link_saved`, `preparation.summary`, `preparation.completeness`, `preparation.cv_summary`, `preparation.cv_version`, `preparation.questions_and_requirements`, `preparation.source_label`, `preparation.confidence_label`, `preparation.form_not_inspected_hint`, `preparation.submit_application`, `preparation.apply_manually`, `preparation.apply_automatically`, `preparation.define_apply_link`.

Confirmar com uma pesquisa antes de remover; `preparation.application_submitted` é substituída por `submit.done`.

---

## 8. Ficheiros tocados

| Ficheiro | Tipo |
|---|---|
| `dashboard/src/domain/applicationFlow.ts` | **novo** — tipos e regras da secção 2.6 |
| `dashboard/src/components/StepIndicator.tsx` | **novo** |
| `dashboard/src/data/` — hook `usePreparation` | **novo** (ou acrescentado a `loadApplications.tsx`) |
| `dashboard/src/domain/applicationForm.ts` | campo `apply_url` |
| `dashboard/src/components/ApplicationForm.tsx` | campo `apply_url` |
| `dashboard/src/pages/NewApplicationPage.tsx` | 5.1 |
| `dashboard/src/pages/JobDescriptionPage.tsx` | 5.2 |
| `dashboard/src/pages/EditApplicationPage.tsx` | 5.3 |
| `dashboard/src/pages/PreparationPage.tsx` | 5.4 e 5.5 |
| `dashboard/src/pages/ApplicationPage.tsx` | 5.7 |
| `dashboard/src/App.tsx` | rota `submit` |
| `dashboard/src/styles.css` | secções 3.3 e 4 |
| `dashboard/src/i18n/locales/{pt,en}/pages.json` | secção 7 |
| `server/api.ts`, `server/postgres-store.ts` | só se B1 opção A |

Ordem sugerida: (1) `apply_url` no formulário → (2) `applicationFlow.ts` + testes das regras → (3) `StepIndicator` + CSS → (4) `/new` → (5) `job-description` e `edit` → (6) preparação e vista submeter → (7) visão geral → (8) B1.

---

## 9. Critérios de aceitação

- [ ] O indicador aparece no topo de `/new`, `job-description`, `edit`, `preparation`, `submit` e visão geral (as três do meio e a visão geral só enquanto `status = interested`), e fica visível ao fazer scroll.
- [ ] Em cada ecrã de etapa há exactamente uma etapa `active`; na visão geral, nenhuma.
- [ ] Uma candidatura sem link de candidatura mostra "Detalhes" como pendente com "Falta o link de candidatura", mesmo estando o utilizador na Preparação.
- [ ] Extrair com IA um anúncio que contém link de candidatura preenche o campo "Link de candidatura" em Detalhes, e o valor fica guardado ao criar.
- [ ] Criar uma candidatura sem data de candidatura leva directamente à Preparação.
- [ ] Guardar a descrição da vaga em fluxo leva a Detalhes; guardar Detalhes leva à Preparação.
- [ ] Editar uma pergunta abre o formulário no lugar do cartão dessa pergunta.
- [ ] Registar envio manual muda o estado para "Candidatura enviada", cria o evento na cronologia e mostra as 4 etapas concluídas.
- [ ] Depois de submetida, `edit` e `job-description` comportam-se como hoje (sem indicador).
- [ ] Nenhum botão desactivado depende de `title` para explicar o motivo.
- [ ] Navegar pelo indicador com alterações por guardar pede confirmação.
- [ ] Indicador legível a 375px de largura e em modo escuro; navegável por teclado; etapa actual anunciada com `aria-current="step"`.
- [ ] Todo o copy novo existe em `pt` e `en`; nenhuma chave removida continua referenciada.
- [ ] `npm run build` e `npm test` passam.

---

## 10. Decisões em aberto

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Registo de submissão manual: endpoint novo (A) ou dois endpoints existentes (B) — secção 6 | A |
| D2 | Etapa 4 como rota própria (`/submit`) ou secção no fim da Preparação (como hoje) | Rota própria: cada etapa do indicador é um URL, o botão "voltar" do browser funciona, e a Preparação fica mais curta. Custo: um recarregamento da preparação ao mudar de etapa. |
| D3 | "Detalhes" só fica concluída com link de candidatura | Sim, mas sem bloquear: quem se candidata por email continua e regista o envio manualmente; a etapa 2 fica pendente até ao fim e deixa de ser mostrada quando o estado muda. |
| D4 | Mover o link de candidatura da descrição da vaga para Detalhes | Sim (resolve F2 e F4 com um só campo). |
