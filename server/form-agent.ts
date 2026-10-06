import { chromium, type Browser } from 'playwright'
import { randomUUID } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { normalizeText } from '../dashboard/src/domain/knowledge.ts'
import type { PreparationAnswer } from '../dashboard/src/domain/applicationPreparation.ts'
import { StoreError } from './store.ts'
import { createSession, closeSession, sessions } from './form-sessions.ts'

export type FormField = { selector: string; label: string; type: string; matchedAnswer?: PreparationAnswer; filled: boolean; required: boolean }
export type FormInspection = { sessionId: string; fields: FormField[]; screenshot: string; canAutoFill: boolean }
export type CvUpload = string | { name: string; mimeType: string; buffer: Buffer }
type Launcher = (options: { headless: boolean }) => Promise<Browser>
export function matchAnswer(names: string[], answers: PreparationAnswer[]) {
  const labels = names.map(normalizeText).filter(Boolean)
  const matches = answers.filter(a => a.approval === 'accepted' && a.answer && labels.includes(normalizeText(a.question)))
  return matches.length === 1 ? matches[0] : undefined
}
export async function cvPdf(content: string): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ javaScriptEnabled: false })
    await page.route('**/*', route => route.abort())
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { skipHtml: true, children: content,
      components: { img: () => null, a: ({ children }) => createElement('span', null, children) } }))
    await page.setContent(`<html><head><meta charset="utf-8"><style>body{font:11pt Arial;line-height:1.4}h1{font-size:22pt}h2{font-size:16pt}li{break-inside:avoid}</style></head><body>${html}</body></html>`)
    return await page.pdf({ format: 'A4', margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' }, printBackground: true })
  } finally { await browser.close() }
}
export class FormAgent {
  constructor(private launch: Launcher = options => chromium.launch(options), private headless = false) {}
  async inspect(applyUrl: string, answers: PreparationAnswer[], cvPdfPath?: CvUpload): Promise<FormInspection> {
    let url: URL
    try { url = new URL(applyUrl) } catch { throw new StoreError(400, 'Invalid application URL') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new StoreError(400, 'Use an HTTP(S) application URL without credentials')
    if (sessions.size >= 5) throw new StoreError(429, 'Too many open form sessions. Close a session or wait for it to expire.')
    const browser = await this.launch({ headless: this.headless })
    let sessionId: string | undefined
    try {
      const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' })
      let blockedNavigation = false
      await context.route('**/*', async route => {
        const request = route.request()
        const target = new URL(request.url())
        if ((request.isNavigationRequest() || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) && target.hostname !== url.hostname) {
          blockedNavigation = true
          await route.abort(); return
        }
        await route.continue()
      })
      const page = await context.newPage()
      page.setDefaultTimeout(10_000)
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (blockedNavigation || new URL(page.url()).hostname !== url.hostname) throw new StoreError(409, 'Application navigation left the approved domain')
      await page.locator('input,textarea,select').first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
      const token = randomUUID()
      const discovered = await page.evaluate(token => {
        const forms = [...document.forms]
        forms.forEach((form, i) => form.setAttribute('data-career-form', `${token}-${i}`))
        return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')]
          .filter(el => !el.disabled && (el.type === 'file' || el.getClientRects().length > 0) && !['hidden','password','submit','button','reset','image'].includes(el.type))
          .map((el, i) => {
            el.setAttribute('data-career-field', `${token}-${i}`)
            const labels = [...(el.labels ?? [])].map(label => {
              const copy = label.cloneNode(true) as HTMLElement
              copy.querySelectorAll('input,textarea,select,button').forEach(control => control.remove())
              return copy.textContent?.trim() ?? ''
            })
            const labelledBy = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() ?? '')
            const names = [...labels, ...labelledBy, el.getAttribute('aria-label') ?? '', el.name, el.getAttribute('placeholder') ?? '']
            const legend = el.closest('fieldset')?.querySelector('legend')?.textContent?.trim() ?? ''
            if (legend) names.push(legend)
            return { selector: `[data-career-field="${token}-${i}"]`, label: names.find(Boolean) ?? '', names,
              type: el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : el.type,
              required: el.required, group: el.name, form: el.form ? forms.indexOf(el.form) : -1, value: el.value, legend }
          })
      }, token)
      const fields: FormField[] = []
      for (const field of discovered) {
        const matchedAnswer = matchAnswer(field.names, answers)
        const view: FormField = { selector: field.selector, label: field.label, type: field.type, required: field.required, matchedAnswer, filled: false }
        const locator = page.locator(field.selector)
        try {
          if (field.type === 'file' && cvPdfPath) { await locator.setInputFiles(cvPdfPath); view.filled = true }
          const answer = matchedAnswer?.answer
          if (answer) {
            if (['text','email','tel','url','textarea','number','search'].includes(field.type) && ['text','number','single_select'].includes(answer.type)) {
              await locator.fill('value' in answer ? String(answer.value) : '')
              view.filled = true
            } else if (field.type === 'select' && (answer.type === 'single_select' || answer.type === 'multi_select')) {
              const values = Array.isArray(answer.value) ? answer.value : [answer.value]
              const options = await locator.locator('option').evaluateAll(elements => elements.map(el => ({ value: (el as HTMLOptionElement).value, label: el.textContent ?? '' })))
              const selected = values.map(value => options.filter(option => normalizeText(option.label) === normalizeText(value) || option.value === value))
              if (selected.every(matches => matches.length === 1)) { await locator.selectOption(selected.map(matches => matches[0].value)); view.filled = true }
            } else if (field.type === 'checkbox' && answer.type === 'boolean') {
              await locator.setChecked(answer.value); view.filled = true
            } else if (field.type === 'checkbox' && answer.type === 'multi_select') {
              await locator.setChecked(answer.value.some(value => [field.value, ...field.names.slice(0, 1)].some(name => normalizeText(name) === normalizeText(value))))
              view.filled = true
            } else if (field.type === 'radio' && (answer.type === 'single_select' || answer.type === 'boolean')) {
              const wanted = answer.type === 'boolean' ? (answer.value ? ['yes','true','sim'] : ['no','false','nao']) : [normalizeText(answer.value)]
              if ([field.value, field.names[0]].some(value => wanted.includes(normalizeText(value)))) { await locator.check(); view.filled = true }
            }
          }
        } catch { view.filled = false }
        fields.push(view)
      }
      const scores = new Map<number, number>()
      discovered.forEach((field, i) => { if (field.form >= 0) scores.set(field.form, (scores.get(field.form) ?? 0) + (fields[i].filled ? 2 : 1)) })
      const ranked = [...scores].sort((a, b) => b[1] - a[1])
      const chosen = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : -1
      const formSelector = chosen >= 0 ? `[data-career-form="${token}-${chosen}"]` : ''
      const mappedRequired = discovered.every((field, i) => field.form !== chosen || !field.required || fields[i].filled
        || field.type === 'radio' && !!field.group && discovered.some((other, j) => other.form === chosen && other.type === 'radio' && other.group === field.group && fields[j].filled))
      const requiredComplete = chosen >= 0 && mappedRequired && await page.locator(formSelector).evaluate(form => (form as HTMLFormElement).checkValidity())
      const screenshot = (await page.screenshot({ fullPage: true })).toString('base64')
      sessionId = createSession(page, browser, formSelector)
      return { sessionId, fields, screenshot, canAutoFill: page.frames().length === 1 && !!formSelector && fields.some(field => field.filled) && !!requiredComplete }
    } catch (error) {
      if (sessionId) await closeSession(sessionId)
      else await browser.close().catch(() => {})
      if (error instanceof StoreError) throw error
      throw new StoreError(502, 'Unable to inspect application form')
    }
  }
}
