import json, os, urllib.request, concurrent.futures, datetime
root=r'D:\data\face'; out=os.path.join(root,'images_celeba'); os.makedirs(out,exist_ok=True)
rows=[]
for off in range(0,500,100):
 u=f'https://datasets-server.huggingface.co/first-rows?dataset=flwrlabs%2Fceleba&config=img_align%2Bidentity%2Battr&split=train&offset={off}&length=100'
 for x in json.load(urllib.request.urlopen(u))['rows']:
  if len(rows)>=500: break
  r=x['row']; rows.append({'row':len(rows),'src':r['image']['src'],'celeb_id':r['celeb_id']})
def get(r):
 n=f"{r['row']+1:04d}.jpg"; p=os.path.join(out,n)
 for _ in range(3):
  try:
   if not os.path.exists(p) or os.path.getsize(p)<1000: urllib.request.urlretrieve(r['src'],p)
   if os.path.getsize(p)>1000:return r,n
  except Exception: pass
 return None,n
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as ex: results=list(ex.map(get,rows))
manifest=[]
for r,n in results:
 if r: manifest.append({'id':n,'path':f'images/{n}','source_row':r['row'],'celeb_id':r['celeb_id']})
with open(os.path.join(root,'manifest_celeba.jsonl'),'w',encoding='utf-8') as f:
 for x in manifest:f.write(json.dumps(x)+'\n')
meta={'dataset':'flwrlabs/celeba','source_url':'https://huggingface.co/datasets/flwrlabs/celeba','config':'img_align+identity+attr','split':'train','requested':500,'retrieved':len(manifest),'retrieved_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'notes':'CelebA aligned images; predominantly one face per image. Research-use/source terms apply; review license before redistribution.'}
with open(os.path.join(root,'source_celeba.json'),'w',encoding='utf-8') as f:json.dump(meta,f,ensure_ascii=False,indent=2)
print('done',len(manifest))
