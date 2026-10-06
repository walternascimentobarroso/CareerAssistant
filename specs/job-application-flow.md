# Spec: Fluxo completo de candidatura a uma vaga

## Objectivo

Dado um link ou texto de uma vaga, o sistema:
1. Importa e analisa a vaga
2. Adapta o CV do utilizador para ATS (Applicant Tracking System)
3. Preenche automaticamente o formulário de candidatura online via Playwright

---

## Requisitos

### R1 — Entrada da vaga

- O utilizador pode entrar com: (a) URL da vaga, ou (b) texto colado da vaga
- Se for URL: o sistema faz fetch do conteúdo (já existe em `job-posting-fetcher.ts`)
- Se for texto: o sistema usa directamente
- O AI extrai os dados estruturados (já existe em `ai.ts` → `extract()`)
- O campo `jobs.job_url` guarda o link original da vaga
- **Novo campo `jobs.apply_url`**: URL específico para submeter a candidatura (pode ser diferente do `job_url`; o utilizador pode preencher manualmente se o sistema não o detectar automaticamente)
- O AI tenta detectar o `apply_url` a partir do texto/página (ex: botão "Apply", "Candidatar-me", "Submit application")

### R2 — Adaptação do CV para ATS

- Na `PreparationPage` de uma candidatura, existe uma secção "CV para esta vaga"
- O utilizador selecciona qual CV base usar (cv_versions existente)
- O sistema envia para o AI: CV base (Markdown) + descrição da vaga + perfil do utilizador
- O AI devolve um CV adaptado em Markdown, optimizado para ATS:
  - Palavras-chave da vaga incorporadas naturalmente
  - Secções reordenadas por relevância
  - Experiência reformulada com a linguagem da vaga
  - Skills técnicas em destaque se mencionadas na vaga
- O CV adaptado é guardado como nova `cv_version` com `derived_from_version_id` apontando para o original
- `change_note` fica com "ATS adaptation for: <role> at <company>"
- O utilizador pode editar o CV adaptado antes de submeter

### R3 — Preenchimento automático da candidatura (Playwright)

- Na `PreparationPage`, botão "Aplicar automaticamente" — só activo se `apply_url` estiver definido
- Ao clicar, o sistema:
  1. Abre o `apply_url` num browser controlado por Playwright (headful por defeito — utilizador vê o que acontece)
  2. Usa as `application_answers` já aprovadas (Preparation já implementada) para preencher campos
  3. Usa o CV adaptado para o campo de upload de CV (se existir)
  4. Preenche campos de texto livres com as respostas aprovadas
  5. Pára antes de submeter — apresenta um screenshot/preview ao utilizador
  6. O utilizador aprova ou cancela a submissão final
- Se o Playwright não conseguir identificar um campo, marca-o como `formInspected: false` e pede ao utilizador para preencher manualmente
- Regista o resultado na `application_preparations` com `formInspected: true` após inspecção bem-sucedida

### R4 — Registo da submissão

- Após submissão (manual ou automática), o sistema:
  - Actualiza `applications.status` para `applied`
  - Cria um `application_cv` com `state = 'sent'`
  - Cria um evento de timeline: `type = 'applied'` com data e canal
  - Regista o `apply_url` como canal de submissão

### R5 — Fluxo completo passo a passo (UX)

```
[1] Nova candidatura
      ↓
[2] Entrada da vaga (URL ou texto)
    → AI extrai: empresa, cargo, requisitos, apply_url
      ↓
[3] PreparationPage
    → Adaptar CV para ATS  ← NOVO
    → Preencher respostas (já existe)
      ↓
[4] Aplicar
    → "Aplicar manualmente" (link para apply_url)
    → "Aplicar automaticamente" (Playwright)  ← NOVO
      ↓
[5] Confirmação
    → Status → applied
    → CV sent registado
    → Evento timeline criado
```

---

## Critérios de "concluído"

- [ ] `jobs.apply_url` existe na base de dados (migração)
- [ ] AI tenta detectar `apply_url` ao extrair a vaga; utilizador pode corrigir na UI
- [ ] Na `PreparationPage`, botão "Adaptar CV para ATS" chama o AI e cria nova cv_version
- [ ] O CV adaptado fica editável antes de ser usado
- [ ] Playwright instalado como dependência opcional de desenvolvimento/servidor
- [ ] Endpoint `POST /applications/:slug/prepare-form` inicia sessão Playwright e devolve estado dos campos
- [ ] Endpoint `POST /applications/:slug/submit-form` confirma e submete (ou regista submissão manual)
- [ ] `formInspected` passa a `true` após inspecção Playwright bem-sucedida
- [ ] Submissão regista: status `applied`, cv `sent`, evento timeline, canal
- [ ] `npm run build` e `npm test` passam

---

## O que já existe (não construir de novo)

| Componente | Ficheiro | Estado |
|---|---|---|
| Fetch de URL de vaga | `server/job-posting-fetcher.ts` | Completo |
| Extracção AI de vaga | `server/ai.ts` → `extract()` | Completo |
| `jobs.job_url` | migration 001 | Completo |
| Versionamento de CV | `postgres-store.ts` cv_versions | Completo |
| `application_cvs` (selected/sent) | migration 001 | Completo |
| `application_preparations` + answers | migration 006 | Completo |
| Respostas aprovadas | `application-answer-resolver.ts` | Completo |
| `PreparationPage` (base) | dashboard | Completo |

## O que falta construir

| Componente | Tipo | Complexidade |
|---|---|---|
| `jobs.apply_url` | Migration + API + UI | Baixa |
| Detecção de `apply_url` pelo AI | Prompt engineering | Baixa |
| Endpoint ATS CV adaptation | Server + AI | Média |
| cv_version derivada para ATS | Server | Baixa (reutiliza lógica) |
| UI na PreparationPage (adaptar CV) | Frontend | Média |
| Playwright + inspecção de formulário | Server + Playwright | Alta |
| Endpoint submit-form + confirmação | Server | Média |
| Registo de submissão (status+cv+evento) | Server | Baixa (reutiliza lógica) |

---

## Decisões de arquitectura

### Playwright: servidor ou separado?

**Opção A — No servidor Node.js (recomendado)**
- Playwright corre no mesmo processo Node que a API
- Endpoint HTTP inicia a sessão e devolve estado via polling ou SSE
- Headful no desktop (utilizador vê o browser)
- Sem infra adicional

**Opção B — Processo separado**
- Mais isolado mas adiciona complexidade operacional
- Necessário apenas se o servidor correr em produção remota

→ **Decisão: Opção A** para o contexto pessoal deste projecto.

### Segurança

- Playwright só corre com `apply_url` explicitamente guardado e aprovado pelo utilizador
- Nunca segue redirects para domínios fora do `apply_url` original
- Credenciais nunca passam pelo código — o utilizador preenche no browser visível

### CV para upload

- O Playwright detecta `<input type="file">` e faz upload do CV adaptado exportado como PDF
- Geração de PDF: `puppeteer` (já incluído no Playwright) ou biblioteca leve de Markdown→PDF
