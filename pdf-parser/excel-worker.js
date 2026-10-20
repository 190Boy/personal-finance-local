importScripts('../web/vendor/sheetjs/xlsx.full.min.js');
self.onmessage=async event=>{
 try{const {readExcel}=await import('./excel-core.mjs');const value=readExcel(event.data.bytes,event.data.name,XLSX);self.postMessage({ok:true,value});}
 catch(error){const allowed=['FILE_TOO_LARGE','EMPTY_FILE','EXCEL_REQUIRED','EXCEL_FORMAT','EXCEL_ENCRYPTED','EXCEL_READ_FAILED','EXCEL_LIMIT','EXCEL_EMPTY'];self.postMessage({ok:false,code:allowed.includes(error.message)?error.message:'EXCEL_READ_FAILED'});}
};
