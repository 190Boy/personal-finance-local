importScripts('../web/vendor/sheetjs/xlsx.full.min.js','../web/vendor/officecrypto/officecrypto.min.js');
self.onmessage=async event=>{
 try{const {readExcelWithPassword}=await import('./excel-decrypt.mjs');const value=await readExcelWithPassword(event.data.bytes,event.data.name,XLSX,OfficeCrypto,event.data.password);self.postMessage({ok:true,value});}
 catch(error){const allowed=['FILE_TOO_LARGE','EMPTY_FILE','EXCEL_REQUIRED','EXCEL_FORMAT','EXCEL_ENCRYPTED','EXCEL_READ_FAILED','EXCEL_LIMIT','EXCEL_EMPTY','EXCEL_PASSWORD_REQUIRED','EXCEL_WRONG_PASSWORD','EXCEL_PASSWORD_LENGTH','EXCEL_ENCRYPTION_UNSUPPORTED','EXCEL_DECRYPT_FAILED'];self.postMessage({ok:false,code:allowed.includes(error.message)?error.message:'EXCEL_READ_FAILED'});}
 finally{event.data.password='';if(event.data.bytes)new Uint8Array(event.data.bytes).fill(0);event.data.bytes=null;}
};
