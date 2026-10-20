// This module never receives PDF bytes, passwords, transaction objects or OAuth credentials.
const statusNode=document.getElementById('pwaStatus');
const installButton=document.getElementById('installApp');
let promptEvent=null;
const scopeUrl=new URL('../',import.meta.url);
const cachePrefix='finance-shell-'+encodeURIComponent(scopeUrl.pathname)+'-';
const show=text=>{if(statusNode)statusNode.textContent=text;};
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
window.addEventListener('beforeinstallprompt',event=>{
 event.preventDefault();promptEvent=event;
 installButton.hidden=false;
});
installButton?.addEventListener('click',async()=>{
 if(!promptEvent)return;
 await promptEvent.prompt();await promptEvent.userChoice;
 promptEvent=null;installButton.hidden=true;
});
window.addEventListener('appinstalled',()=>{show('已安裝至主畫面。');promptEvent=null;installButton.hidden=true;});
export async function clearPublicCache(){
 if('serviceWorker' in navigator){
  const registrations=await navigator.serviceWorker.getRegistrations();
  for(const registration of registrations)if(registration.scope===scopeUrl.href)await registration.unregister();
 }
 if('caches' in window)for(const key of await caches.keys())if(key.startsWith(cachePrefix))await caches.delete(key);
 show('已清除本專案公開程式快取。請關閉所有本 App 視窗；下次連線開啟會重新下載程式。');
}
export async function initPwa(){
 if(location.protocol==='file:'||!window.isSecureContext||!('serviceWorker' in navigator)){
  show('此環境無法啟用 PWA。請用 GitHub Pages HTTPS 或本機 localhost 開啟。');return;
 }
 try{
  const registration=await navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{scope:scopeUrl.href,updateViaCache:'none'});
  const ready=()=>{
   if(registration.waiting){show('有新版程式待啟用。先清除預覽，再關閉所有本 App 視窗並重新開啟。');return;}
   if(registration.active)show((standalone()?'主畫面模式 · ':'')+'公開程式資源已備妥；PDF 與交易資料不在離線快取中。');
   else if(registration.installing?.state==='redundant')show('離線資源尚未準備成功。請保持連線、確認儲存空間後重新開啟。');
   else show('正在準備公開程式資源；請保持連線至完成。');
  };
  registration.installing?.addEventListener('statechange',ready);
  ready();registration.addEventListener('updatefound',()=>{
   const worker=registration.installing;
   worker?.addEventListener('statechange',ready);
  });
  navigator.serviceWorker.addEventListener('controllerchange',ready);
 }catch{
  show('PWA 離線資源準備失敗；連線下仍可測試。請確認完整發布、HTTPS 與儲存空間。');
 }
}
