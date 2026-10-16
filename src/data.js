/* ---------------- 数据层（云端优先，localStorage 兜底） ---------------- */
function db(){
  return (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) ? window.__SMART_PAGE__.database : null;
}
function hasCloud(){ return !!db(); }
function newId(){ return 'loc_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
/* v2.49：多剧目——本机 key 全部按 pid 命名空间隔离；无 pid 的旧记录归默认剧目 */
function pk(s){ return LS + (state.pid || 'prj_default') + ':' + s; }
function pidOk(r){ return (r.pid === state.pid) || (!r.pid && state.pid === 'prj_default'); }
function localLoad(){
  try{ var v = JSON.parse(localStorage.getItem(pk('shots'))); return Array.isArray(v) ? v : []; }
  catch(e){ return []; }
}
function localSave(list){
  /* v2.55：原来失败只 toast、不做腾挪——配音缓存（可再生，单条几百 KB）占满空间时，
     分镜（不可替代）反而写不进去。与 lsSet 保持同一口径：先腾挪再试一次。 */
  if(lsSet(pk('shots'), JSON.stringify(list))) return;
  toast('本地存储写入失败：数据量可能过大，已在腾挪配音缓存后仍失败，建议导出备份后清理');
}
/* v2.31：msg 是「正在进行的第几步」这类临时文案，只在本条链路跑完前显示 */
function setSync(mode, msg){
  state.syncing = (mode === 'busy'); state.online = (mode !== 'off');
  state.syncMsg = msg || '';
  renderSync();
}
function loadPage(cursor, acc, guard){
  acc = acc || []; guard = guard || 0;
  if(guard > 60) return Promise.resolve(acc);
  return db().query({ databaseId: DB_ID, pageSize: 200, startCursor: cursor, sorts: [{property:'镜号',direction:'ascending'}] })
    .then(function(r){
      acc = acc.concat(r.results || []);
      var next = r.nextCursor;
      if(r.hasMore && next && next !== cursor && (r.results||[]).length) return loadPage(next, acc, guard+1);
      return acc;
    });
}
function loadShots(){
  if(!hasCloud()){
    state.hasCloud = false; state.online = false;
    state.shots = localLoad().sort(function(a,b){ return num(a['镜号']) - num(b['镜号']); });
    setSync('off');
    return Promise.resolve(state.shots);
  }
  state.hasCloud = true;
  setSync('busy');
  return loadPage().then(function(list){
    list = list.filter(pidOk);          /* v2.49：只取当前剧目（旧记录无 pid 归默认剧目） */
    list.sort(function(a,b){ return (num(a['镜号']) - num(b['镜号'])); });
    state.shots = list; state.online = true; setSync('ok');
    return list;
  }).catch(function(err){
    console.error(err); state.online = false; setSync('off'); return [];
  });
}
function num(v){ var n = Number(v); return isNaN(n) ? 0 : n; }
var FTYPE = { '镜号':'number', '时长秒':'number', '音频时长':'number', '章节序号':'number',
  '图片状态':'select', '视频状态':'select', '配音状态':'select', '满意锁定':'select', '景别':'select',
  '口型风险':'select', '口型状态':'select' };
/* select 字段的空值兜底：写不存在的选项会报错，这里给默认值 */
var SELDEF = { '图片状态':'未生成', '视频状态':'未生成', '配音状态':'未生成', '满意锁定':'否', '景别':'中景',
               '口型风险':'低', '口型状态':'不需要' };
function toProps(o){
  var p = {};
  for(var k in o){
    var v = o[k]; if(v === undefined || v === null) continue;
    if(k.charAt(0) === '_') continue;                    /* 下划线开头的本地字段（如 _imgHist/_imgNewer）不落资料库 */
    if(FTYPE[k] === 'number') p[k] = { number: num(v) };
    else if(FTYPE[k] === 'select') p[k] = { select: String(v || SELDEF[k] || '未生成') };
    else p[k] = { text: String(v == null ? '' : v) };
  }
  return p;
}
/* 更新一条记录：先改本地内存，再写云端（保证写入顺序，避免状态被旧值覆盖） */
function patchShot(id, obj){
  state.shots = state.shots.map(function(s){ return (s._id === id) ? Object.assign({}, s, obj) : s; });
  if(!hasCloud()){ localSave(state.shots); refreshAll(); return Promise.resolve(); }
  setSync('busy');
  return db().updateRecord({ databaseId: DB_ID, recordId: id, properties: toProps(obj) })
    .then(function(){ setSync('ok'); refreshAll(); })
    .catch(function(e){ console.error(e); setSync('off'); toast('保存失败：' + (e && e.message ? e.message : e)); });
}
/* v2.28：批量落库——把「逐条 patchShot」合并成「一次改内存、一次落盘、一次刷新」。
   逐条 patchShot 在批量场景的代价 = N ×（全量 localStorage 序列化 + refreshAll 重排 6 个面板
   + 云端 N 个并发请求），一键修复 200 条就是上千次重排、200 个并发请求。
   这里先把同一镜的多条更新合并（如某镜既补时长又补章节），再统一落盘与刷新；
   云端按顺序串行推送——保持写入顺序，也不并发轰接口。
   updates: [{ id, obj }]；返回实际写入的镜数（镜已被删的条目不计入、也不推云）。
   v2.29 修健壮性问题：原先云端是「一条 reject 整条链断掉」——后面的条目全不推、内存却已改，
   而本地又只在无云时落盘，于是刷新页面改动全丢、用户还不知道。现在每条独立 catch：
   失败项收进 state.bulkFail（首页出重试卡），其余继续推；且**先落一次本地**做兜底。 */
/* v2.45：改返回 Promise<写入镜数>——原来同步返回 n，导致「先排镜号再插复制/插入空镜」这种
   有顺序依赖的结构性操作没法等云写完成就 addShotObj，loadShots 会读到旧镜号造成重复。
   现在调用方可以 `bulkPatch(ups).then(...)` 等重排落云后再插镜。无更新/无云时返回 Promise.resolve(0/n)。 */
function bulkPatch(updates){
  if(!updates || !updates.length) return Promise.resolve(0);
  var byId = {}, order = [];
  updates.forEach(function(u){
    if(!u || !u.id || !u.obj) return;
    if(!byId[u.id]){ byId[u.id] = {}; order.push(u.id); }
    Object.assign(byId[u.id], u.obj);   /* 同镜多条更新合并，后写覆盖前写 */
  });
  if(!order.length) return Promise.resolve(0);
  var hit = {}, n = 0;
  state.shots = state.shots.map(function(s){
    if(!byId[s._id]) return s;
    hit[s._id] = 1; n++;
    return Object.assign({}, s, byId[s._id]);
  });
  if(!n) return Promise.resolve(0);     /* 目标镜全被删了：既不落盘也不推云 */
  localSave(state.shots);               /* v2.29：先落本地兜底，云写失败也不至于「改了没存」 */
  if(!hasCloud()){ refreshAll(); return Promise.resolve(n); }
  setSync('busy');
  var fails = [], chain = Promise.resolve();
  order.forEach(function(id){
    if(!hit[id]) return;
    chain = chain.then(function(){
      return db().updateRecord({ databaseId: DB_ID, recordId: id, properties: toProps(byId[id]) })
        .catch(function(e){ console.error(e); fails.push({ id: id, obj: byId[id], err: e }); });
    });
  });
  return chain.then(function(){
    state.bulkFail = fails.slice();     /* 留给首页「重试」入口 */
    if(fails.length){
      setSync('off');
      toast('云端保存失败 ' + fails.length + ' 条（已成功 ' + (n - fails.length) + ' 条，改动已存本机，可在首页点「重试」）');
    }else{
      setSync('ok');
    }
    refreshAll();
    return n;
  });
}
/* v2.30：串行执行一组云端写操作——每条**独立 catch**，失败不中断，跑完给出成功/失败数。
   与 bulkPatch 是同一类问题的两面：bulkPatch 管「改」，这里管「增 / 删 / 撤销」这类结构性操作。
   此前这些地方都是 `ids.reduce(chain...)`：一条失败整链断掉，后面的全不执行，
   而且要么没有 catch（unhandled rejection、UI 不刷新）、要么 catch 里只 console.error
   （静默半成功，用户以为都成了）。现在统一：跑完 + 汇总 {ok, fail, errs}，由调用方决定提示与收尾。
   jobs: [function(){ return Promise }]（返回 undefined 也算成功，兼容 `p ? ... : null` 的写法）。
   opts（v2.31）：{ label:'清空分镜', min:8 }——条数 >= min 时同步条上显示「label 3/20」，
   免得几十条的活儿只有个转圈，看着像卡死。默认 min=8，不想显示进度就不传 label。
   opts.tag（v2.32）：给这批任务起个名字，同步条右侧会冒出「停止」，点了之后**剩下的任务全部跳过**
   （已经执行的不回滚——收尾照常重新拉云端，界面与真实状态对齐）。 */
function runSerial(jobs, opts){
  opts = opts || {};
  var ok = 0, errs = [], done = 0, chain = Promise.resolve();
  var total = (jobs || []).length;
  var label = opts.label || '', min = opts.min || 8, tag = opts.tag || '';
  if(tag){ state.serialTag = tag; state.stopSerial = ''; renderSync(); }
  (jobs || []).forEach(function(job){
    var idx = ++done;
    chain = chain.then(function(){
      if(tag && state.stopSerial === tag) return;      /* 被叫停：后面的直接跳过，也不计入成功数 */
      if(label && total >= min) setSync('busy', label + ' ' + idx + '/' + total);
      return Promise.resolve().then(job).then(function(){ ok++; },
        function(e){ console.error(e); errs.push(e); });
    });
  });
  return chain.then(function(){
    var stopped = !!(tag && state.stopSerial === tag);
    if(tag){ state.serialTag = ''; state.stopSerial = ''; renderSync(); }
    return { ok: ok, fail: errs.length, errs: errs, stopped: stopped };
  });
}
/* v2.32：用户点「停止」——正在跑的那条会跑完（不半途掐断写请求），剩下的跳过 */
function stopSerial(){
  if(!state.serialTag) return;
  state.stopSerial = state.serialTag;
  toast('正在停止…已经写出去的那几条不会回滚，收尾会重新拉云端对齐');
}
/* v2.29：重试上次云端没写成的条目——失败清单在 state.bulkFail 里，重试前先清空，
   再失败会被 bulkPatch 重新填回去，首页卡也就还在。 */
function retryBulkFail(){
  var f = state.bulkFail || [];
  if(!f.length){ toast('没有待重试的云端写入'); return; }
  state.bulkFail = [];
  /* v2.45：bulkPatch 返回 Promise，按写入镜数给提示 */
  bulkPatch(f.map(function(x){ return { id: x.id, obj: x.obj }; })).then(function(n){
    if(n) toast('正在重试 ' + n + ' 条云端写入…');
    else { toast('这些镜头已不在表中，无需重试'); refreshAll(); }
  });
}
function addShotObj(obj){
  var o = Object.assign({ pid: state.pid }, obj);   /* v2.49：每条分镜归属当前剧目 */
  if(!hasCloud()){
    var rec = Object.assign({ _id: newId() }, o);
    state.shots.push(rec); localSave(state.shots); refreshAll();
    return Promise.resolve();
  }
  setSync('busy');
  return db().addRecord({ databaseId: DB_ID, properties: toProps(o) })
    .then(function(){ return loadShots(); })
    .then(function(){ refreshAll(); })
    .catch(function(e){ console.error(e); setSync('off'); toast('新增失败：'+(e && e.message ? e.message : e)); });
}
/* 清掉本机缓存的音频（base64 很大，删分镜 / 清空 / 导入后必须释放） */
function purgeAud(ids){
  if(ids){
    ids.forEach(function(id){
      delete AUD[id];
      cueDurClear(id);                                  /* v2.11：连每句时长账本一起清 */
      try{ localStorage.removeItem(audKey(id)); }catch(e){}
    });
    return;
  }
  Object.keys(AUD).forEach(function(k){ delete AUD[k]; });
  try{
    var kill = [];
    for(var i = 0; i < localStorage.length; i++){
      var k = localStorage.key(i);
      if(k && k.indexOf(LS + 'aud_') === 0) kill.push(k);
    }
    kill.forEach(function(k){ localStorage.removeItem(k); });
  }catch(e){}
}
function delShot(id){
  if(!hasCloud()){
    purgeAud([id]);
    state.shots = state.shots.filter(function(s){ return s._id !== id; });
    localSave(state.shots); refreshAll(); toast('已删除');
    return Promise.resolve();
  }
  /* v2.30：本机音频**删成功才清**——原来一上来就 purgeAud，云端删除失败时音频已经没了且不可恢复 */
  return db().deleteRecord({ databaseId: DB_ID, recordId: id })
    .then(function(){ purgeAud([id]); return loadShots(); })
    .then(function(){ refreshAll(); toast('已删除'); })
    .catch(function(e){ console.error(e); setSync('off'); toast('删除失败：' + (e && e.message ? e.message : e)); });
}
function clearAllShots(skipUndo){
  var shotIds = state.shots.map(function(s){ return s._id; });
  if(!shotIds.length) return Promise.resolve();
  /* v2.31：清空的后悔药——原来只有本地不落盘的内存快照，且压根没在这里入栈。
     skipUndo 给覆盖导入用：它自己已经存过一张，这里再存一次就变成「撤销要按两下」。 */
  if(!skipUndo) pushUndo();
  if(!hasCloud()){ purgeAud(shotIds); state.shots = []; localSave([]); refreshAll(); return Promise.resolve(); }
  var p = db();
  setSync('busy');
  var rep = null;
  /* v2.30：逐条独立 catch——原来一条失败整链断（后面的都不删），且既不刷新也不提示 */
  return runSerial(shotIds.map(function(id){
    return function(){ return p.deleteRecord({ databaseId: DB_ID, recordId: id }); };
  }), { label: '清空分镜', tag: 'clear'   }).then(function(r){
    rep = r;
    /* v2.34：中途被叫停时也不能清音频——没删掉的镜头还要用 */
    if(!r.fail && !r.stopped) purgeAud(shotIds);
    return loadShots();
  }).then(function(){
    refreshAll();
    if(rep && (rep.fail || rep.stopped)){
      setSync('off');
      toast(rep.stopped
        ? ('已停止清空：删了 ' + rep.ok + ' 条，还剩 ' + (shotIds.length - rep.ok) + ' 条没动（可再点一次清空继续）')
        : ('清空未完成：已删 ' + rep.ok + ' 条，' + rep.fail + ' 条删除失败（可再点一次清空）'));
    }
    else setSync('ok');
  });
}

/* ===== 设定卡（角色 / 场景）数据层 ===== */
function loadAssetsPage(cursor, acc, guard){
  acc = acc || []; guard = guard || 0;
  if(guard > 60) return Promise.resolve(acc);
  return db().query({ databaseId: ASSET_DB_ID, pageSize: 200, startCursor: cursor })
    .then(function(r){
      acc = acc.concat(r.results || []);
      var next = r.nextCursor;
      if(r.hasMore && next && next !== cursor && (r.results||[]).length) return loadAssetsPage(next, acc, guard+1);
      return acc;
    });
}
function loadAssets(){
  if(!hasCloud()){
    try{ var v = JSON.parse(localStorage.getItem(pk('assets'))); state.assets = Array.isArray(v) ? v : []; }
    catch(e){ state.assets = []; }
    return Promise.resolve(state.assets);
  }
  return loadAssetsPage().then(function(list){ state.assets = list.filter(pidOk); return state.assets; })
    .catch(function(e){ console.error(e); return []; });
}
function patchAsset(id, obj){
  state.assets = state.assets.map(function(a){ return (a._id === id) ? Object.assign({}, a, obj) : a; });
  if(!hasCloud()){
    lsSaveAssets();
    refreshAll(); return Promise.resolve();
  }
  setSync('busy');
  return db().updateRecord({ databaseId: ASSET_DB_ID, recordId: id, properties: toProps(obj) })
    .then(function(){ setSync('ok'); refreshAll(); })
    .catch(function(e){ console.error(e); setSync('off'); toast('保存失败：'+(e&&e.message?e.message:e)); });
}
function addAsset(obj){
  var o = Object.assign({ pid: state.pid }, obj);   /* v2.49：设定卡归属当前剧目 */
  if(!hasCloud()){
    state.assets.push(Object.assign({ _id: newId() }, o));
    lsSaveAssets();
    refreshAll(); return Promise.resolve();
  }
  setSync('busy');
  return db().addRecord({ databaseId: ASSET_DB_ID, properties: toProps(o) })
    .then(function(){ return loadAssets(); })
    .then(function(){ refreshAll(); })
    .catch(function(e){ console.error(e); setSync('off'); toast('新增失败：' + (e && e.message ? e.message : e)); });
}
function delAsset(id){
  if(!hasCloud()){
    state.assets = state.assets.filter(function(a){ return a._id !== id; });
    lsSaveAssets();
    refreshAll(); return Promise.resolve();
  }
  return db().deleteRecord({ databaseId: ASSET_DB_ID, recordId: id })
    .then(function(){ return loadAssets(); })
    .then(function(){ refreshAll(); })
    /* v2.31：原来 catch 里只有一句 toast('删除失败')——既不打日志也不说原因，
       卡没删掉但界面看着像删了（loadAssets 没跑，列表没跟云端对齐）。 */
    .catch(function(e){ console.error(e); setSync('off'); toast('删除失败：' + (e && e.message ? e.message : e)); });
}

