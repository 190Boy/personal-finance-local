export function rowsToAppend(existing,incoming,{kind='bank'}={}){
 const groups=new Map();for(const r of existing){if(!groups.has(r[0]))groups.set(r[0],[]);groups.get(r[0]).push(r);}
 const fresh=[];let skipped=0,conflicts=0;
 const signature=r=>JSON.stringify(r.slice(1,10));
 for(const row of incoming){
  const prior=groups.get(row[0])||[];
  if(prior.some(r=>signature(r)===signature(row))){skipped++;continue;}
  const copy=[...row];
  if(prior.length){conflicts++;if(kind==='bank'){copy[10]='uncheckable';copy[11]=[copy[11],'CLOUD_ID_CONFLICT'].filter(Boolean).join('|');}}
  fresh.push(copy);prior.push(copy);groups.set(row[0],prior);
 }
 return {fresh,skipped,conflicts};
}
