// Use the displayed text baseline, not the italic/shear component of a font matrix.
export function projectTextItem(item,viewport){
 const m=item.transform,v=viewport.transform;
 if(!Array.isArray(m)||m.length!==6||m.some(n=>!Number.isFinite(n)))return {supported:false,reason:'INVALID_GEOMETRY'};
 const dx=v[0]*m[0]+v[2]*m[1],dy=v[1]*m[0]+v[3]*m[1];
 const length=Math.hypot(dx,dy);
 if(!length||dx<=0||Math.abs(dy)>length*0.02)return {supported:false,reason:'NON_HORIZONTAL_TEXT'};
 const [x,y]=viewport.convertToViewportPoint(m[4],m[5]);
 const scale=Number.isFinite(viewport.scale)?viewport.scale:1;
 const w=Math.abs(item.width*scale),h=Math.abs(item.height*scale);
 if(![x,y,w,h].every(Number.isFinite))return {supported:false,reason:'INVALID_GEOMETRY'};
 return {supported:true,item:{str:item.str,x,y,w,h}};
}
export function applyExtractionWarnings(result,pages){
 let excluded=0;
 for(const page of pages){
  const count=page.excludedItems?.length||0;if(!count)continue;
  excluded+=count;
  result.issues.push({code:'NON_HORIZONTAL_TEXT',page:page.number,line:null,
   detail:'有 '+count+' 段旋轉、直排或無法定位的文字未納入交易。請展開擷取文字並對照原 PDF，確認是否含交易欄位。'});
 }
 if(excluded){
  result.validation.fieldChecksPass=false;
  result.validation.balanceChecksComplete=false;
  result.validation.status='needs_review';
  result.balance.complete=false;
  result.validation.message='部分文字未納入表格，不能視為完整解析通過。';
 }
 return result;
}
