import json,ssl,urllib.request,urllib.parse,hashlib,re,pathlib
ids=['STD;Arnaud%1Legoux%1Moving%1Average','STD;Least%1Squares%1Moving%1Average','STD;Chandelier_Exit']
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
out=[]
for id in ids:
 url='https://pine-facade.tradingview.com/pine-facade/get/'+urllib.parse.quote(id,safe='')+'/last'
 with opener.open(url,timeout=25)as r:
  j=json.load(r);date=r.headers.get('Date');status=r.status
 s=j['source'];plots=[l.strip()for l in s.splitlines()if l.strip().startswith('plot(')]
 out.append({'id':id,'url':url,'version':j.get('version'),'sha256':hashlib.sha256(s.encode()).hexdigest(),'status':status,'httpDate':date,'plotCount':len(plots),'plotColorTokens':[re.findall(r'#[0-9a-fA-F]{6,8}|color\.[A-Za-z]+',l)for l in plots],'tls':'Python default CERT_REQUIRED/check_hostname, no proxy, no insecure flags','fullSourceSaved':False})
p=pathlib.Path(__file__).resolve().parents[2]/'docs/CHANNEL_AVERAGE_PRIMARY_CAPTURE.json';p.write_text(json.dumps(out,indent=2),'utf-8');print(json.dumps(out))
