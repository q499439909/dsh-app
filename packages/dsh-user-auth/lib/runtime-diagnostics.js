import { channel } from 'node:diagnostics_channel';

// Record transport mechanics, never headers, request bodies, URL paths or messages.
export function transportFacts({request,error}) {
  let origin;
  try { origin=new URL(request?.origin).origin; } catch { origin='unknown'; }
  const causes=[];
  for(let e=error;e&&causes.length<4;e=e.cause)causes.push({name:e.name||'Error',code:e.code||null,syscall:e.syscall||null});
  return {origin,causes};
}

export function observeTransport(record) {
  const errors=channel('undici:request:error');
  const listener=value=>{try{record('http_transport_error',transportFacts(value))}catch{/* Diagnostic observers cannot interrupt requests. */}};
  errors.subscribe(listener);
  return ()=>errors.unsubscribe(listener);
}
