export const REMEMBER_KEY='finance-remembered-account-v1';
const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:'';
export function rememberedAccount(storage){try{return email(JSON.parse(storage.getItem(REMEMBER_KEY)||'null')?.email);}catch{return '';}}
export function rememberAccount(storage,value){const valid=email(value);try{if(valid)storage.setItem(REMEMBER_KEY,JSON.stringify({email:valid}));else storage.removeItem(REMEMBER_KEY);return true;}catch{return false;}}
