import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { request, useApplications } from '../data/loadApplications'

type RemovedApplication = { id:string; slug:string; status:string; revision:string; deleted_at:string }
export function TrashPage() {
  const { t } = useTranslation('pages')
  const [items,setItems]=useState<RemovedApplication[]>([])
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const {reload}=useApplications()
  const load=async () => setItems(await request('/trash'))
  useEffect(() => { void load().catch(e=>setMessage(e.message)) },[])
  async function restore(item:RemovedApplication) {
    setBusy(true); setMessage('')
    try { await request(`/applications/${item.id}/restore`,'POST',{revision:item.revision}); await load(); await reload() }
    catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  async function removePermanently(item:RemovedApplication) {
    if (!window.confirm(t('trash.confirm_delete', { slug: item.slug }))) return
    setBusy(true); setMessage('')
    try { await request(`/trash/${item.id}`,'DELETE',{revision:String(item.revision)}); await load(); setMessage(t('trash.application_permanently_deleted')) }
    catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <article className="detail"><h1>{t('trash.trash')}</h1><p>{t('trash.retention_hint')}</p>
    {items.length===0 && <p>{t('trash.no_removed_applications')}</p>}
    {items.map(item=><div className="toolbar" key={item.id}><span>{item.slug}</span><button disabled={busy} onClick={()=>void restore(item)}>{t('trash.restore')}</button><button className="danger" disabled={busy} onClick={()=>void removePermanently(item)}>{t('trash.delete_permanently')}</button></div>)}
    <p role="status">{message}</p>
  </article>
}
