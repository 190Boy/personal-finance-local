// Run pnpm install in this directory, then pnpm build. No runtime CDN.
const fs=require('fs'),path=require('path'),browserify=require('browserify'),terser=require('terser');
const packages=new Set();
const b=browserify(require.resolve('officecrypto-tool'),{standalone:'OfficeCrypto'});
b.pipeline.get('deps').on('data',row=>{
 if(!row.file)return;
 let dir=path.dirname(row.file);
 while(dir!==path.dirname(dir)){
  if(fs.existsSync(path.join(dir,'package.json'))){packages.add(dir);break;}
  dir=path.dirname(dir);
 }
});
b.bundle(async(error,buffer)=>{
 if(error)throw error;
 const target=path.resolve(__dirname,'../../web/vendor/officecrypto');fs.mkdirSync(target,{recursive:true});
 const result=await terser.minify(buffer.toString(),{format:{comments:/license|copyright/i}});
 fs.writeFileSync(path.join(target,'officecrypto.min.js'),result.code);
 const notices=[...packages].map(dir=>{
  const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const licenses=fs.readdirSync(dir).filter(n=>/^(license|copying)(\.|$)/i.test(n));
  return `${p.name}@${p.version}\n${p.license||''}\n`+licenses.map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('\n');
 }).sort().join('\n\n========================================\n\n');
 fs.writeFileSync(path.join(target,'THIRD_PARTY_NOTICES.txt'),notices);
 console.log('Built self-hosted OfficeCrypto bundle and dependency license notices.');
});
