// 日めくりTodo — app shell: offline install, account, cloud sync, import
(function(){
  const $=id=>document.getElementById(id);
  const core=window.todoCore;
  const cfg=window.FIREBASE_CONFIG;
  let fs=null,auth=null,user=null;

  // ---- service worker (offline) ----
  if("serviceWorker" in navigator&&location.protocol!=="file:"){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }

  // ---- panel ----
  $("menuBtn").onclick=()=>{const p=$("panel");p.hidden=!p.hidden;$("menuBtn").setAttribute("aria-expanded",String(!p.hidden))};
  $("syncState").onclick=()=>{$("panel").hidden=false;$("menuBtn").setAttribute("aria-expanded","true")};
  const msg=(id,t,err)=>{const m=$(id);m.textContent=t||"";m.classList.toggle("err",!!err)};

  function syncLabel(){
    const s=$("syncState");s.classList.remove("on","off");
    if(!user){s.textContent=cfg?"この端末に保存（同期はログインで）":"この端末に保存";return}
    if(navigator.onLine){s.classList.add("on");s.textContent="同期中"}
    else{s.classList.add("off");s.textContent="オフライン（つながったら同期）"}
  }
  addEventListener("online",syncLabel);addEventListener("offline",syncLabel);

  // ---- Firestore adapter with the same shape the page uses ----
  function wrapSnap(s){return{exists:s.exists,data:()=>s.data(),metadata:s.metadata}}
  function makeDb(uid){
    const base="users/"+uid+"/";
    return{
      // every saved day, for the running totals
      async allDays(){const q=await fs.collection(base+"days").get();const out={};q.forEach(d=>{out[d.id]=d.data()});return out},
      doc(p){
      const ref=fs.doc(base+p);
      return{
        get:()=>ref.get().then(wrapSnap),
        // offline writes are queued by Firestore; don't wait for the server
        set:b=>{ref.set(b).catch(e=>{console.warn("sync",e);core.writeError&&core.writeError(e)});return Promise.resolve()},
        // metadata changes too, so the page hears when the server has confirmed the day (needed for the day-change carry-over)
        onSnapshot:(next,err)=>ref.onSnapshot({includeMetadataChanges:true},s=>next(wrapSnap(s)),err||(()=>{}))
      };
    }};
  }

  const DAY=/^todo:(\d{4}-\d{2}-\d{2})$/;
  function localDump(){
    const days={};let daily=null;
    try{
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);const m=k.match(DAY);
        if(m){try{const v=JSON.parse(localStorage.getItem(k));days[m[1]]=Array.isArray(v)?{items:v,rdone:{},order:[],carriedFrom:null}:v}catch(e){}}
        if(k==="todo:daily"){try{daily=JSON.parse(localStorage.getItem(k))}catch(e){}}
      }
    }catch(e){}
    return{days,daily};
  }
  // put imported tasks next to what a day already has, instead of replacing it
  function mergeDay(have,inc){
    if(!have||!(have.items||[]).length)return inc;
    const ids=new Set(have.items.map(i=>i.id));
    const add=(inc.items||[]).filter(i=>!ids.has(i.id));
    return{...have,items:[...have.items,...add],
      rdone:{...(inc.rdone||{}),...(have.rdone||{})},
      order:[...(have.order||[]),...(inc.order||[]).filter(k=>!(have.order||[]).includes(k))]};
  }
  function mergeDaily(have,inc){
    if(!have||!(have.items||[]).length)return inc;
    const ids=new Set(have.items.map(i=>i.id));
    return{...have,items:[...have.items,...(inc.items||[]).filter(i=>!ids.has(i.id))]};
  }
  async function readCloud(path){try{const s=await fs.doc(path).get();return s.exists?s.data():null}catch(e){return null}}
  async function writeMerged(uid,data){
    const base="users/"+uid+"/";
    const out={days:{},daily:null};
    for(const [k,v] of Object.entries(data.days||{}))out.days[k]=mergeDay(await readCloud(base+"days/"+k),v);
    if(data.daily)out.daily=mergeDaily(await readCloud(base+"settings/daily"),data.daily);
    await writeAll(uid,out);
  }
  async function writeAll(uid,data){
    const base="users/"+uid+"/";
    const entries=Object.entries(data.days||{});
    for(let i=0;i<entries.length;i+=400){
      const b=fs.batch();
      entries.slice(i,i+400).forEach(([k,v])=>b.set(fs.doc(base+"days/"+k),v));
      if(i===0&&data.daily)b.set(fs.doc(base+"settings/daily"),data.daily);
      await b.commit();
    }
    if(!entries.length&&data.daily)await fs.doc(base+"settings/daily").set(data.daily);
  }
  // first login on a device that already has tasks: upload them if the account is still empty
  async function firstSync(uid){
    const meta=fs.doc("users/"+uid+"/meta/info");
    let snap;try{snap=await meta.get()}catch(e){return}
    if(snap.exists)return;
    const d=localDump();
    // only days the account doesn't have yet are uploaded; nothing in the cloud is overwritten
    try{
      const base="users/"+uid+"/";const up={days:{},daily:null};
      for(const [k,v] of Object.entries(d.days)){const s=await fs.doc(base+"days/"+k).get();if(!s.exists)up.days[k]=v}
      if(d.daily){const s=await fs.doc(base+"settings/daily").get();if(!s.exists)up.daily=d.daily}
      if(Object.keys(up.days).length||up.daily)await writeAll(uid,up);
      await meta.set({created:new Date().toISOString()});
    }catch(e){console.warn(e)}
  }

  function initFirebase(){
    if(!cfg||!window.firebase){
      $("acctOut").hidden=true;
      msg("acctMsg","同期の設定がまだです。今はこの端末だけに保存されます。");
      return;
    }
    firebase.initializeApp(cfg);
    fs=firebase.firestore();
    try{fs.settings({ignoreUndefinedProperties:true,merge:true})}catch(e){}
    fs.enablePersistence({synchronizeTabs:true}).catch(()=>{});
    auth=firebase.auth();
    auth.onAuthStateChanged(async u=>{
      user=u;syncLabel();
      $("acctOut").hidden=!!u;$("acctIn").hidden=!u;
      if(u){
        $("who").textContent=u.email+" でログイン中";
        await firstSync(u.uid);
        core.connect(makeDb(u.uid));
      }else{
        core.disconnect();
      }
    });
  }

  const authErr=e=>{
    const c=(e&&e.code)||"";
    if(c.includes("invalid-credential")||c.includes("wrong-password")||c.includes("user-not-found"))return"メールアドレスかパスワードが違います。";
    if(c.includes("email-already-in-use"))return"このメールアドレスは登録済みです。「ログイン」を押してください。";
    if(c.includes("weak-password"))return"パスワードは6文字以上にしてください。";
    if(c.includes("invalid-email"))return"メールアドレスの形が正しくありません。";
    if(c.includes("network"))return"ネットにつながっていません。つながってからもう一度押してください。";
    if(c.includes("api-key")||c.includes("invalid-api-key"))return"Firebaseの設定（apiKey）が合っていません。";
    if(c.includes("operation-not-allowed"))return"Firebaseで「メール/パスワード」のログインが有効になっていません。";
    return"うまくいきませんでした（"+c+"）";
  };
  const creds=()=>[$("email").value.trim(),$("pass").value];
  $("loginBtn").onclick=async()=>{
    if(!auth)return;const [e,p]=creds();if(!e||!p){msg("acctMsg","メールアドレスとパスワードを入れてください。",true);return}
    msg("acctMsg","ログイン中…");
    try{await auth.signInWithEmailAndPassword(e,p);msg("acctMsg","ログインしました。");core.toast("ログインしました")}catch(err){msg("acctMsg",authErr(err),true)}
  };
  $("signupBtn").onclick=async()=>{
    if(!auth)return;const [e,p]=creds();if(!e||!p){msg("acctMsg","メールアドレスとパスワードを入れてください。",true);return}
    msg("acctMsg","登録中…");
    try{await auth.createUserWithEmailAndPassword(e,p);msg("acctMsg","登録しました。ほかの端末でも同じメールでログインしてください。");core.toast("登録しました")}catch(err){msg("acctMsg",authErr(err),true)}
  };
  $("logoutBtn").onclick=async()=>{if(auth){await auth.signOut();msg("acctMsg","ログアウトしました。");}};

  // ---- import from the old page ----
  $("importBtn").onclick=async()=>{
    let data;
    try{data=JSON.parse($("importBox").value.trim())}catch(e){msg("importMsg","読み込めませんでした。コピーした文字をそのまま貼り付けてください。",true);return}
    if(!data||data.app!=="himekuri-todo"||!data.days){msg("importMsg","このデータは日めくりTodoのものではないようです。",true);return}
    const n=Object.keys(data.days).length;
    try{
      if(user&&fs)await writeMerged(user.uid,data);
      else{
        const get=k=>{try{return JSON.parse(localStorage.getItem("todo:"+k)||"null")}catch(e){return null}};
        Object.entries(data.days).forEach(([k,v])=>localStorage.setItem("todo:"+k,JSON.stringify(mergeDay(get(k),v))));
        if(data.daily)localStorage.setItem("todo:daily",JSON.stringify(mergeDaily(get("daily"),data.daily)));
      }
    }catch(e){msg("importMsg","保存できませんでした（"+((e&&e.code)||e)+"）",true);return}
    $("importBox").value="";
    msg("importMsg",n+"日分を取り込みました。");
    core.refresh();core.toast(n+"日分を取り込みました");
  };

  syncLabel();
  initFirebase();
})();
