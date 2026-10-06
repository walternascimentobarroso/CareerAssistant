import { getSession } from './form-sessions.ts'
import { StoreError } from './store.ts'

export async function submitForm(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  if (session.state === 'submitted') return // Retry database recording without sending the external form twice.
  if (session.state !== 'inspected') throw new StoreError(409, 'Submission is already running or its outcome is uncertain')
  session.state = 'submitting'
  let clicked = false
  try {
    if (!session.formSelector) throw new StoreError(409, 'No unambiguous application form was found')
    const form = session.page.locator(session.formSelector)
    if (!await form.evaluate(el => (el as HTMLFormElement).reportValidity())) throw new StoreError(409, 'Required form fields still need review')
    const buttons = form.locator('button[type="submit"],input[type="submit"],button:not([type])')
    const visible = []
    for (const button of await buttons.all()) if (await button.isVisible() && await button.isEnabled()) visible.push(button)
    const named = []
    for (const button of visible) if (/^(submit|apply|send application|submit application|candidatar|enviar candidatura)/i.test((await button.innerText().catch(() => '')) || (await button.getAttribute('value')) || '')) named.push(button)
    const button = named.length === 1 ? named[0] : visible.length === 1 ? visible[0] : undefined
    if (!button) throw new StoreError(409, 'No unambiguous submit button was found')
    const before = await session.page.locator('body').innerText()
    clicked = true
    await button.click({ noWaitAfter: true })
    await session.page.waitForFunction(before => {
      const text = document.body.innerText
      return text !== before && (/application (?:has been |was )?(?:submitted|received)|thank you for (?:applying|your application)|candidatura (?:enviada|recebida)|successfully submitted/i.test(text)
        || /\/(?:success|thank-you|confirmation)(?:[/?#]|$)/i.test(location.href))
    }, before, { timeout: 30_000 })
    session.state = 'submitted'
  } catch (error) {
    session.state = clicked ? 'uncertain' : 'inspected'
    if (!clicked && error instanceof StoreError) throw error
    throw new StoreError(409, clicked ? 'Submission could not be confirmed. Check the employer page before trying again.' : 'The form changed. Inspect it again before submitting.')
  } finally { if (session.state === 'submitted') await session.browser.close().catch(() => {}) }
}
