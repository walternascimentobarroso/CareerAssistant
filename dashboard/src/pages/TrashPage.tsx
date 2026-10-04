import { useEffect, useState } from 'react'
import { request, useApplications } from '../data/loadApplications'

type RemovedApplication = { id:string; slug:string; status:string; revision:string; deleted_at:string }
export function TrashPage() {
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
  return <article className="detail"><h1>Trash</h1><p>Removed applications retain their documents and history.</p>
    {items.length===0 && <p>No removed applications.</p>}
    {items.map(item=><div className="toolbar" key={item.id}><span>{item.slug}</span><button disabled={busy} onClick={()=>void restore(item)}>Restore</button></div>)}
    <p role="status">{message}</p>
  </article>
}
