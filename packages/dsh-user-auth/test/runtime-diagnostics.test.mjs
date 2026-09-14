import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {observeTransport,transportFacts} from '../lib/runtime-diagnostics.js';

test('transport facts retain error causes without credentials or payloads',()=>{
 const facts=transportFacts({request:{origin:'https://user:password@example.com/private?token=secret'},error:{name:'TypeError',message:'secret',cause:{name:'Error',code:'ECONNREFUSED',syscall:'connect'}}});
 assert.equal(facts.origin,'https://example.com');assert.equal(facts.causes[1].code,'ECONNREFUSED');
 assert.doesNotMatch(JSON.stringify(facts),/secret|password|private/);
});

test('real failed fetch emits transport diagnostics and preserves the rejection',async()=>{
 const events=[],stop=observeTransport((event,value)=>events.push({event,...value}));
 const server=createServer(req=>req.socket.destroy());await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {await assert.rejects(fetch(`http://127.0.0.1:${server.address().port}/private?token=secret`,{headers:{authorization:'secret'}}));assert.equal(events[0].event,'http_transport_error');assert.ok(events[0].causes.some(c=>c.code));assert.doesNotMatch(JSON.stringify(events),/secret|private/);}
 finally{stop();await new Promise(r=>server.close(r))}
});
