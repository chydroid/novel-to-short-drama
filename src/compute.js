/* ---------------- 计算层 ---------------- */
function assetByName(name, type){
  if(!name) return null;
  var key = String(name).trim();
  for(var i=0;i<state.assets.length;i++){
    var a = state.assets[i];
    if(String(a['名称']||'').trim() === key && (!type || a['类型'] === type)) return a;
  }
  return null;
}
function splitNames(s){
  if(!s) return [];
  return String(s).split(/[,，、;；\/|]+/).map(function(x){ return x.trim(); }).filter(Boolean);
}
/* 某角色在本镜之前「最像成片」的一张参考帧：优先被标记为满意锁定的镜头图 */
function bestFrameFor(name, beforeNo){
  var best = null, bestNo = -1, fallback = null, fbNo = -1;
  state.shots.forEach(function(x){
    var n = num(x['镜号']);
    if(n >= beforeNo) return;
    if(!x['图片URL']) return;
    if(splitNames(x['出场角色']).indexOf(name) === -1) return;
    if(x['满意锁定'] === '是'){ if(n > bestNo){ bestNo = n; best = x['图片URL']; } }
    if(n > fbNo){ fbNo = n; fallback = x['图片URL']; }
  });
  return best || fallback;
}
/* 组装某一镜的一致性锚点：多视图参考图 + 文字锚点 + 服装/性格锁定 */
function anchorsForShot(s){
  var names = splitNames(s['出场角色']);
  var roleAssets = [], missingRoles = [];
  names.forEach(function(n){
    var a = assetByName(n, '角色');
    if(a) roleAssets.push(a); else missingRoles.push(n);
  });
  var scene = assetByName(s['场景'], '场景');
  var curNo = num(s['镜号']);
  var roleMain = [], roleFace = [], bestRefs = [], sceneMain = [], sceneAlt = [];
  var rolePhrase = [], outfitPhrase = [], persona = [];

  roleAssets.slice(0, 3).forEach(function(a){
    var nm = String(a['名称'] || '').trim();
    if(a['参考图URL']) roleMain.push({ url:a['参考图URL'], label: nm + ' — full-body character reference sheet, front view' });
    if(cfg.multiView && a['参考图2']) roleFace.push({ url:a['参考图2'], label: nm + ' — face close-up of the SAME person' });
    if(cfg.refMode === 'best'){
      var f = bestFrameFor(nm, curNo);
      if(f) bestRefs.push({ url:f, label: nm + ' — approved frame from an earlier shot, match this exact on-screen look' });
    }
    var head = [];
    if(a['性别年龄']) head.push(String(a['性别年龄']));
    if(a['英文锚点']) head.push(String(a['英文锚点']));
    else if(a['中文描述']) head.push(String(a['中文描述']));
    rolePhrase.push(nm + ' (' + head.join(', ') + ')');
    /* 服装锁：优先用「整体常服」，没填就用结构化外观自动拼装（发型 + 上装 + 下装 + 配饰） */
    var ob = [];
    if(String(a['发型'] || '').trim()) ob.push('hair: ' + String(a['发型']).trim());
    var cloth = [String(a['上装'] || '').trim(), String(a['下装'] || '').trim()].filter(Boolean).join(' with ');
    if(String(a['常服'] || '').trim()) ob.push('outfit: ' + String(a['常服']).trim() + (cloth ? ' (' + cloth + ')' : ''));
    else if(cloth) ob.push('outfit: ' + cloth);
    if(String(a['配饰道具'] || '').trim()) ob.push('always carries/wears: ' + String(a['配饰道具']).trim());
    if(ob.length) outfitPhrase.push(nm + ' — ' + ob.join(', '));
    if(a['性格语气']) persona.push(nm + '：' + String(a['性格语气']));
  });

  var scenePhrase = '';
  if(scene){
    if(scene['参考图URL']) sceneMain.push({ url:scene['参考图URL'], label: 'location "' + String(scene['名称']||'').trim() + '" — empty establishing wide shot, no people' });
    if(scene['参考图2']) sceneAlt.push({ url:scene['参考图2'], label: 'the SAME location from the reverse camera angle' });
    scenePhrase = scene['英文锚点'] || scene['中文描述'] || scene['名称'] || '';
  }else if(String(s['场景'] || '').trim()){
    scenePhrase = String(s['场景']).trim();
  }

  /* 参考图优先级：角色定妆 > 场景空景 > 面部特写 > 满意基准帧 > 场景反打
     （模型一次最多吃 4 张左右，超了要按重要性取舍，可在设置里调上限）
     注意：必须按 URL 去重，否则「picture N 是谁」的文字说明会和实际发送的第 N 张图错位 */
  var seen = {}, dedup = [];
  roleMain.concat(sceneMain, roleFace, bestRefs, sceneAlt).forEach(function(r){
    if(r && r.url && !seen[r.url]){ seen[r.url] = 1; dedup.push(r); }
  });
  var refs = dedup;
  var urls = [], max = num(cfg.refMax) || 4;
  refs.forEach(function(r){ if(urls.length < max) urls.push(r.url); });
  return { roleAssets: roleAssets, missingRoles: missingRoles, scene: scene,
           rolePhrase: rolePhrase, scenePhrase: scenePhrase, outfitPhrase: outfitPhrase,
           persona: persona, refs: refs, urls: urls,
           missingScene: (String(s['场景']||'').trim() && !scene) ? String(s['场景']).trim() : '' };
}
function statOf(){
  var s = { total: state.shots.length, noImg: 0, noVid: 0, fail: 0, done: 0, running: 0, seconds: 0, doneSec: 0, noAudio: 0, audioTotal: 0 };
  state.shots.forEach(function(x){
    var is = x['图片状态'] || '未生成', vs = x['视频状态'] || '未生成';
    var sec = num(x['时长秒']) || 5;
    s.seconds += sec;
    if(String(x['台词旁白'] || '').trim()){
      s.audioTotal++;
      if((x['配音状态'] || '未生成') !== '已完成') s.noAudio++;
    }
    if(is === '未生成' || is === '失败') s.noImg++;
    if(vs === '未生成' || vs === '失败') s.noVid++;
    /* v2.38：失败计数扩到配音 / 口型——原来只数图片与视频，配音失败时顶部永远是 0，看着像一切正常 */
    if(is === '失败' || vs === '失败' || x['配音状态'] === '失败' || x['口型状态'] === '失败') s.fail++;
    if(is === '生成中' || vs === '生成中' || vs === '排队中') s.running++;
    if(vs === '已完成'){ s.done++; s.doneSec += sec; }
  });
  return s;
}
function todoItems(){
  var out = [];
  state.shots.forEach(function(x){
    var is = x['图片状态'] || '未生成', vs = x['视频状态'] || '未生成';
    /* v2.41：失败一律先说「失败」，且四类都认——v2.38 把「失败」的口径扩到了图片 / 视频 / 配音 / 口型
       （首页失败卡、顶部计数、筛选都跟着改了），这份待办列表没跟上：
       · 配音失败会掉到最下面那条「台词还没配音」——把「跑失败了」说成「还没做」，
         用户点一下「配音」以为正常排队，其实是失败要重试；
       · 口型失败压根不出现在待办里，只能一镜一镜翻镜卡。
       现在统一问 failKindOf()，文案也跟失败卡用同一份名字表。 */
    var f = failKindOf(x);
    if(f) out.push({ id:x._id, no:x['镜号'], kind:f.k, text:'第 '+x['镜号']+' 镜 '+f.name+'失败'+failWhyTxt(x) });
    else if(is === '未生成') out.push({ id:x._id, no:x['镜号'], kind:'img', text:'第 '+x['镜号']+' 镜 还没生成图片' });
    else if(vs === '未生成' && is === '已完成') out.push({ id:x._id, no:x['镜号'], kind:'vid', text:'第 '+x['镜号']+' 镜 图已就绪，待生成视频' });
    else if(String(x['台词旁白'] || '').trim() && (x['配音状态'] || '未生成') !== '已完成')
      out.push({ id:x._id, no:x['镜号'], kind:'audio', text:'第 '+x['镜号']+' 镜 台词还没配音' });
  });
  return out.slice(0, 8);
}
/* v2.23：把「按条件挑镜头」抽成纯函数——生成页筛选与「筛选视图」共用同一份判定，
   两处口径不会各写一套、越改越偏。expr 为空 = 不限（与导出范围一致，避免筛成空列表）。 */
function viewShots(list, mode, expr){
  list = list || [];
  if(mode === 'expr'){   /* v2.22：按镜号选区筛选——表达式与导出范围同一套写法，可用 @预设名 */
    var pr = parseShotRange(expr);
    if(pr.empty) return list.slice();
    return list.filter(function(x){ return rangeHit(num(x['镜号']), pr); });
  }
  return list.filter(function(x){
    var is = x['图片状态'] || '未生成', vs = x['视频状态'] || '未生成';
    if(mode === 'all' || !mode) return true;
    if(mode === 'noimg') return is === '未生成';
    if(mode === 'novid') return vs === '未生成' && is === '已完成';
    if(mode === 'cand') return Array.isArray(x._imgCand) && x._imgCand.length > 0;   /* v2.26：有候选待挑 */
    /* v2.38：筛「失败」要覆盖四类——否则点「只看失败」时配音 / 口型失败的镜根本不出现，等于假筛选 */
    if(mode === 'fail') return is === '失败' || vs === '失败' || x['配音状态'] === '失败' || x['口型状态'] === '失败';
    if(mode === 'done') return vs === '已完成';
    return true;
  });
}
function filteredShots(){ return viewShots(state.shots, state.filter, cfg.filterExpr); }
function shotById(id){ for(var i=0;i<state.shots.length;i++){ if(state.shots[i]._id === id) return state.shots[i]; } return null; }
/* v2.27：把「切到生成页 → 展开该镜 → 滚动到它」抽成一处（体检「去修第一个」/ 体检明细逐条「去改」/ 剩余镜定位 共用） */
function locateShot(s){
  if(!s) return;
  state.expanded[s._id] = true;
  setView('gen');
  setTimeout(function(){
    var el = document.querySelector('.gen[data-id="' + s._id + '"]');
    if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
  }, 80);
}
function charStr(v){
  if(Array.isArray(v)) return v.map(function(x){ return String(x).trim(); }).filter(Boolean).join(', ');
  return v ? String(v).trim() : '';
}
function clearAllAssets(){
  if(!hasCloud()){
    state.assets = [];
    lsSaveAssets();
    return Promise.resolve();
  }
  var p = db();
  var ids = state.assets.map(function(a){ return a._id; });
  if(!ids.length) return Promise.resolve();
  setSync('busy');
  var rep = null;
  /* v2.30：逐条独立 catch + 汇总提示（原来一条失败整链断，且不提示） */
  return runSerial(ids.map(function(id){
    return function(){ return p.deleteRecord({ databaseId: ASSET_DB_ID, recordId: id }); };
  }), { label: '清空设定卡', tag: 'clear' }).then(function(r){ rep = r; return loadAssets(); })
    .then(function(){
      /* v2.34：叫停也要如实说（原来只有失败才提示，中途停了会被当成「完成」） */
      if(rep && (rep.fail || rep.stopped)){
        setSync('off');
        toast(rep.stopped
          ? ('已停止：删了 ' + rep.ok + ' 张，还剩 ' + (ids.length - rep.ok) + ' 张没动')
          : ('设定卡清空未完成：已删 ' + rep.ok + ' 张，' + rep.fail + ' 张失败'));
      }
      else setSync('ok');
    });
}
/* 扫描所有分镜，把出现过的角色名 / 场景名补齐成设定卡（去重）。
   v2.32：**返回 Promise<实际补齐张数>**——原来同步返回「计划张数」，可云端那一段是异步的，
   流水线紧接着就 `loadAssets()` → `fillNewAssets()`（AI 补全设定描述），
   经常发生「新设定卡还没建好就开始补描述」→ 新建的角色卡空着描述进生图，一致性全崩。 */
function syncAssetsFromShots(){
  var names = { '角色': [], '场景': [] };
  state.shots.forEach(function(s){
    splitNames(s['出场角色']).forEach(function(n){ if(names['角色'].indexOf(n) === -1) names['角色'].push(n); });
    var sc = String(s['场景'] || '').trim();
    if(sc && names['场景'].indexOf(sc) === -1) names['场景'].push(sc);
  });
  var todo = [];
  ['角色','场景'].forEach(function(t){
    names[t].forEach(function(n){ if(!assetByName(n, t)) todo.push({ 类型: t, 名称: n }); });
  });
  if(!todo.length) return Promise.resolve(0);
  if(hasCloud()){
    /* v2.31：改 runSerial——原来是一条 addRecord 失败整链断（后面的设定卡全不建）、
       既没有 catch（unhandled rejection）也不提示，而外面照样按 todo.length 报「已提取 N 张」。
       v2.32：并对外返回 Promise<实际成功数>，调用方（尤其流水线）才等得到。 */
    setSync('busy');
    return runSerial(todo.map(function(a){
      return function(){
        return db().addRecord({ databaseId: ASSET_DB_ID, properties: toProps(
          Object.assign({ 中文描述:'', 英文锚点:'', 参考图URL:'', 状态:'未生成', 错误信息:'', 更新时间:nowStr(), pid: state.pid }, a)
        )});
      };
    }), { label: '补设定卡' })
      .then(function(r){ return loadAssets().then(function(){ return r; }); })
      .then(function(r){
        refreshAll();
        if(r.fail){ setSync('off'); toast('设定卡只补上 ' + r.ok + ' 张，' + r.fail + ' 张写入失败（可再点一次提取）'); }
        else setSync('ok');
        return r.ok;                                  /* v2.32：实际张数交给调用方 */
      });
  }else{
    todo.forEach(function(a){
      state.assets.push(Object.assign(
        { _id: newId(), 中文描述:'', 英文锚点:'', 参考图URL:'', 状态:'未生成', 错误信息:'', 更新时间:nowStr(), pid: state.pid }, a));
    });
    lsSaveAssets();
    refreshAll();
  }
  return Promise.resolve(todo.length);
}
/* v2.32：「从分镜提取角色 / 场景」两个按钮共用——syncAssetsFromShots 现在是异步的，
   提示必须等真正建完再说（原来同步返回计划数，云端还没写完就报「已提取 N 张」） */
function pickAssetsFromShots(){
  syncAssetsFromShots().then(function(n){
    toast(n ? '已从分镜提取 ' + n + ' 张设定卡' : '分镜里没有新的角色 / 场景名');
  });
}

