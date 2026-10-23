from pathlib import Path
from html import unescape
import concurrent.futures, hashlib, json, re, urllib.request, subprocess
ROOT=Path(__file__).resolve().parent
ASSETS=ROOT/'source-assets'
data=json.loads((ASSETS/'portaly-home-data.json').read_text())['props']['pageProps']['data']
links=data['links']
images={}
def strip_html(v):
 return unescape(re.sub(r'<[^>]+>', '\n',v or '')).strip()
def add_image(url, caption, page, hidden=False):
 if not url or not url.startswith('https://'): return None
 key=hashlib.sha256(url.encode()).hexdigest()[:12]
 if key not in images: images[key]={'id':key,'url':url,'captions':[],'source_pages':[],'hidden_in_source':hidden,'verification':'first_party_campaign_source; not independently verified'}
 if caption and caption not in images[key]['captions']: images[key]['captions'].append(caption)
 if page not in images[key]['source_pages']: images[key]['source_pages'].append(page)
 return key
pages=[]
for p in [{'slug':'','title':data['name'],'blocks':data['blocks']},*data['pages'].values()]:
 slug=p['slug']; url='https://portaly.cc/hammerlee'+('/pages/'+slug if slug else '')
 blocks=p.get('blocks',{}); blocks=list(blocks.values()) if isinstance(blocks,dict) else blocks
 items=[]
 for b in blocks:
  for item in b.get('items',[]):
   if item.get('description') or item.get('text') or item.get('image'):
    items.append({'block_id':b.get('id'),'hidden':b.get('hidden',False),'alt':item.get('alt'),'label':item.get('text'),'source_text':strip_html(item.get('description')),'image_id':add_image(item.get('image'),item.get('alt') or item.get('text'),url,b.get('hidden',False)),'linked_url':links.get(item.get('linkId'),{}).get('url'),'classification':'biographical_self_report' if slug=='about' else 'campaign_material_or_proposal; not evidence of completion'})
 pages.append({'slug':slug,'url':url,'title':p.get('title'),'items':items,'local_html':'source-assets/portaly-'+(slug or 'home')+'.html'})
for key in ['avatar','headerBanner','footerCustomImage','ogImage']:
 add_image(data.get(key),key,'https://portaly.cc/hammerlee')
(ASSETS/'image-manifest.json').write_text(json.dumps(list(images.values()),ensure_ascii=False,indent=2))
def fetch(job):
 url,path=job
 try:
  r=subprocess.run(['curl','-f','-L','--max-time','25','-sS','-o',str(path),'-w','%{content_type}',url],capture_output=True,text=True)
  if r.returncode: raise RuntimeError(r.stderr.strip())
  mime=r.stdout.strip()
  if path.suffix=='.asset':
   new=path.with_suffix('.png' if 'png' in mime else '.webp' if 'webp' in mime else '.jpg' if 'jpeg' in mime else '.bin')
   path.rename(new); path=new
  return {'url':url,'local_file':str(path.relative_to(ROOT)),'bytes':path.stat().st_size,'mime':mime,'status':'downloaded'}
 except Exception as e: return {'url':url,'status':'failed','error':str(e)}
jobs=[(p['url'],ROOT/p['local_html']) for p in pages if p['slug']]+[(i['url'],ASSETS/(i['id']+'.asset')) for i in images.values()]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 results=list(pool.map(fetch,jobs))
byurl={i['url']:i for i in results}
for i in images.values(): i.update(byurl[i['url']])
for p in pages:
 p['fetch']=byurl.get(p['url'],{'status':'downloaded','local_file':p['local_html']})
audit={'audited_date':'2026-10-23','scope':'Read-only source archive for neutral civic information prototype; no campaign copy created.','source_type':'Candidate-controlled Portaly site; first-party claims are not independent verification.','extraction_method':'Fetched public HTML and parsed its __NEXT_DATA__ object, which includes visible descriptions and internal page records; individually fetched all discovered internal pages.','theme':{'source_theme':'blue','font_family':'sans','background_setting':data.get('background')},'pages':pages,'images':list(images.values()),'facebook':{'url':'https://www.facebook.com/share/p/1BUcxd1m5F/','status':'not_fetched','reason':'web tool returned cache miss; no authenticated access used. Link also found in public Portaly homepage metadata.'},'observations':['Eight internal pages discovered from public page data: about, culture, Sustainability, education, economy, healthcare, construction, childparty.','Most policy cards include machine-readable HTML descriptions in page data, alongside image graphics.','Future proposals require explicit proposal labeling; source material is not proof that proposals are completed.','About page lists previous positions and education but those biographies were not independently verified in this audit.'],'limitations':['No independent verification of campaign claims, figures, infrastructure attribution, or projected outcomes.','Publicly accessible assets were archived for source review; no license or permission to republish is asserted.','Hidden blocks are flagged and should not be assumed to be currently presented content.','Facebook shared post content was unavailable.','Image text has not yet been independently transcribed or compared against its HTML description.']}
(ROOT/'source-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
(ASSETS/'image-manifest.json').write_text(json.dumps(list(images.values()),ensure_ascii=False,indent=2))
print(json.dumps({'pages':len(pages),'images':len(images),'downloads_ok':sum(r['status']=='downloaded' for r in results),'downloads_failed':[r for r in results if r['status']!='downloaded']},ensure_ascii=False))
for i in images.values():
 if any(c in ['avatar','headerBanner','ogImage','footerCustomImage'] for c in i['captions']): print(i['captions'],i.get('local_file'))
