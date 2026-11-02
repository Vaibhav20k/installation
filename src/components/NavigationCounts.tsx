"use client";
import { createContext, useContext, useEffect, useState } from 'react';
const Counts = createContext<Record<string,number> | null>(null);
export function useNavigationCounts(fallback:Record<string,number>) { return useContext(Counts) ?? fallback; }
/** Queue badges load independently: navigation and page content never wait for the expensive queue queries. */
export function NavigationCounts({children}:{children:React.ReactNode}) {
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{
  let disposed=false, active=false;
  let queued=false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const controller=new AbortController();
  const load=async()=>{
   if(disposed) return;
   if(active){queued=true;return;}
   active=true;
   try { const r=await fetch('/api/navigation-counts',{cache:'no-store',signal:controller.signal}); if(r.ok && !disposed)setCounts(await r.json()); }
   catch { /* Keep the last badges during an interrupted connection. */ }
   finally {active=false;if(queued && !disposed){queued=false;void load();}}
  };
  const changed=()=>{clearTimeout(debounce);debounce=setTimeout(()=>void load(),250);};
  const visible=()=>{if(document.visibilityState==='visible')changed();};
  void load();
  const timer=setInterval(visible,60000);
  window.addEventListener('im-data-changed',changed);
  document.addEventListener('visibilitychange',visible);
  return ()=>{disposed=true;controller.abort();clearTimeout(debounce);clearInterval(timer);window.removeEventListener('im-data-changed',changed);document.removeEventListener('visibilitychange',visible);};
 },[]);
 return <Counts.Provider value={counts}>{children}</Counts.Provider>;
}
