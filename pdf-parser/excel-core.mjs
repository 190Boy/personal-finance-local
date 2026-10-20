// SheetJS parser adapter: values only; never execute formulas/macros or follow hyperlinks.
export function readExcel(bytes,name,XLSX){
 if(bytes.byteLength>25*1024*1024)throw Error('FILE_TOO_LARGE');
 if(!bytes.byteLength)throw Error('EMPTY_FILE');
 const ext=name.toLowerCase().match(/\.(xlsx|xls)$/)?.[1];if(!ext)throw Error('EXCEL_REQUIRED');
 const data=new Uint8Array(bytes),zip=data[0]===80&&data[1]===75,ole=data[0]===208&&data[1]===207&&data[2]===17&&data[3]===224;
 let source=data,type='array';
 if(ext==='xlsx'&&!zip)throw Error('EXCEL_FORMAT');
 if(ext==='xls'&&!ole){
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{try{text=new TextDecoder('big5',{fatal:true}).decode(data);}catch{throw Error('EXCEL_FORMAT');}}
  if(!/^\s*(?:\uFEFF)?\s*(?:<\?xml|<!doctype\s+html|<html|<table)/i.test(text))throw Error('EXCEL_FORMAT');
  source=text;type='string';
 }
 let book;
 try{book=XLSX.read(source,{type,raw:true,cellFormula:true,cellHTML:false,cellText:true,cellNF:true,cellDates:false,bookVBA:false,sheetRows:50002,dateNF:'yyyy/mm/dd'});}
 catch(e){throw Error(/password|encrypt/i.test(e.message)?'EXCEL_ENCRYPTED':'EXCEL_READ_FAILED');}
 if(!book.SheetNames.length)throw Error('EXCEL_EMPTY');if(book.SheetNames.length>20)throw Error('EXCEL_LIMIT');
 const sheets=[];let totalRows=0,totalText=0;
 for(const sheetName of book.SheetNames){
  const sheet=book.Sheets[sheetName];if(!sheet?.['!ref'])continue;
  const full=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
  if(full.e.r>50000||full.e.c>=256)throw Error('EXCEL_LIMIT');
  const range=XLSX.utils.decode_range(sheet['!ref']),rows=[];
  for(let r=range.s.r;r<=range.e.r;r++){
   const cells=[],raw=[],formulaColumns=[],errorColumns=[];
   for(let c=range.s.c;c<=range.e.c;c++){
    const cell=sheet[XLSX.utils.encode_cell({r,c})],i=c-range.s.c;
    const value=cell?.v??'';
    const text=cell?.t==='e'?'#EXCEL_ERROR':String(value);
    cells.push(text);raw.push(['number','string'].includes(typeof value)?value:String(value));
    if(cell?.f)formulaColumns.push(i);if(cell?.t==='e')errorColumns.push(i);
    totalText+=text.length;if(totalText>10000000)throw Error('EXCEL_LIMIT');
   }
   if(cells.some(v=>v.trim())||formulaColumns.length){rows.push({cells,raw,line:r+1,formulaColumns,errorColumns});if(++totalRows>50000)throw Error('EXCEL_LIMIT');}
  }
  if(rows.length)sheets.push({name:sheetName,rows});
 }
 if(!sheets.length)throw Error('EXCEL_EMPTY');
 return {sheets,date1904:!!book.Workbook?.WBProps?.date1904,libraryVersion:XLSX.version};
}
