export async function readLocalExcel(file,{signal,password=''}={}){
 if(file.size>25*1024*1024)throw Error('FILE_TOO_LARGE');
 if(signal?.aborted)throw Error('CANCELLED');
 let bytes=await file.arrayBuffer();
 if(signal?.aborted){bytes=null;throw Error('CANCELLED');}
 return new Promise((resolve,reject)=>{
  let worker,finished=false;
  const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();bytes=null;password='';if(error)reject(error);else resolve(value);};
  const abort=()=>finish(Error('CANCELLED'));
  const timer=setTimeout(()=>finish(Error('EXCEL_TIMEOUT')),30000);
  try{worker=new Worker(new URL('./excel-worker.js',import.meta.url));worker.onmessage=e=>e.data.ok?finish(null,e.data.value):finish(Error(e.data.code));worker.onerror=()=>finish(Error('EXCEL_WORKER'));signal?.addEventListener('abort',abort,{once:true});worker.postMessage({bytes,name:file.name,password},[bytes]);password='';bytes=null;}
  catch{finish(Error('EXCEL_WORKER'));}
 });
}
