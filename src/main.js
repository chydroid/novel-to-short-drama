/* ---------------- 连通性自检 ---------------- */
function testAgnes(){
  var box = $('testResult');
  box.className = 'result show'; box.textContent = '测试中…';
  readSettings();
  if(!hasAgnesKey()){ box.className='result show bad'; box.textContent='请先填 Agnes API Key'; return; }
  var url = cfg.agnesQuery + '/agnesapi?video_id=__connect_test__&model_name=agnes-video-2.5-flash';
  apiGet(url, ak()).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status === 401 || r.status === 403){
      box.className = 'result show bad'; box.textContent = '网络通了，但 API Key 不被接受（HTTP ' + r.status + '）。请检查 Key。';
    }else if(r.status === 0){
      box.className = 'result show bad'; box.textContent = '请求被浏览器拦截，几乎可以确定是跨域（CORS）。请把 Base URL 换成本地代理地址。';
    }else{
      box.className = 'result show ok';
      box.textContent = '连通正常（HTTP ' + r.status + '）。Key 可用。' + (j ? ' 返回：' + r.text.slice(0,120) : '');
    }
  }).catch(function(e){
    box.className = 'result show bad';
    box.textContent = guessCorsMsg(e);
  });
}
function testText(){
  var box = $('testTextResult');
  box.className = 'result show'; box.textContent = '测试中…';
  readSettings();
  if(!cfg.textKey || !cfg.textModel){ box.className='result show bad'; box.textContent='请先填 Key 和模型名'; return; }
  apiPost(cfg.textBase + '/chat/completions', cfg.textKey, {
    model: cfg.textModel, messages: [{ role:'user', content:'回复两个字：正常' }], max_tokens: 10
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status >= 400){ throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0,160)); }
    var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    box.className = 'result show ok'; box.textContent = '文本模型可用，回复：' + (c || '(空)');
  }).catch(function(e){ box.className='result show bad'; box.textContent = guessCorsMsg(e); });
}

/* ---------------- 抽屉 ---------------- */
function openDrawer(){ fillSettings(); $('drawer').classList.add('on'); $('mask').classList.add('on'); }
function closeDrawer(){ $('drawer').classList.remove('on'); $('mask').classList.remove('on'); }

/* ---------------- 事件绑定（统一委托） ---------------- */
function bind(){
  document.addEventListener('click', function(ev){
    var t = closestAct(ev.target);
    if(!t) return;
    var act = t.getAttribute('data-act');
    if(!act) return;
    var id = t.getAttribute('data-id');
    switch(act){
      case 'toggle': state.expanded[id] = !state.expanded[id]; renderGenList(); break;
      case 'img': genImage(id); break;
      case 'vid': genVideo(id); break;
      case 'fixone': {
        var kind = t.getAttribute('data-kind');
        setView('gen'); state.expanded[id] = true;
        /* v2.41：补上口型——待办列表现在会列口型失败，这里不认的话点了按钮会静默走成「生视频」 */
        setTimeout(function(){
          if(kind === 'img') genImage(id);
          else if(kind === 'audio') genAudio(id);
          else if(kind === 'lip') genLipsync(id);
          else genVideo(id);
        }, 60);
        break;
      }
      /* v2.17：首页「去续跑」——切到对应筛选、展开并滚动到第一个剩余镜头 */
      case 'leftjump': {
        var lk = t.getAttribute('data-kind');
        var lf = batchLoadLeft(lk);   /* v2.19：按卡上的类型取，多张卡各跳各的 */
        var want = lk === 'img' ? 'noimg' : (lk === 'vid' ? 'novid' : 'all');
        state.filter = want;
        if($('filterSel')) $('filterSel').value = want;
        var firstNo = (lf && lf.ids && lf.ids.length) ? lf.ids[0] : 0, fs = null;
        state.shots.forEach(function(x){ if(num(x['镜号']) === num(firstNo)) fs = x; });
        if(fs) locateShot(fs); else setView('gen');   /* renderGenList 带上刚设好的筛选 */
        toast('已筛出剩余' + batchLeftName(lk) + '镜头（' + ((lf && lf.ids) ? lf.ids.length : 0) + ' 个），点批量按钮即可续跑');
        break;
      }
      /* v2.18：只跑剩余镜——不切筛选、不重算，直接按存档镜号投队列（v2.19：带类型） */
      case 'leftrun': resumeLeftRun(t.getAttribute('data-kind')); break;
      case 'leftclear': batchClearLeft(t.getAttribute('data-kind')); renderToday(); toast('已忽略该类型的剩余记录'); break;
      case 'leftlist': exportLeftList(t.getAttribute('data-kind')); break;   /* v2.20：导出剩余清单 */
      case 'leftsave': saveLeftAsPreset(t.getAttribute('data-kind')); break;  /* v2.21：剩余镜号存为选区预设 */
      case 'piperesume': resumePipeline(); break;                            /* v2.22：生图→生视频串跑 */
      case 'piptoggle': togglePipelineStep(t.getAttribute('data-k')); break;   /* v2.24：流水线步骤开关 */
      case 'pipeluncustom': runPipelineCustom(); break;                        /* v2.24：按勾选步骤跑流水线 */
      /* v2.21：体检卡「去修第一个」——直接定位到第一个硬性缺料的镜头，省得自己在几十镜里翻 */
      case 'hjump': {
        var hh = shotHealth(state.shots).filter(function(x){ return x.issues.some(function(tt){ return HEALTH_HARD[tt]; }); });
        if(!hh.length){ toast('已经没有硬性缺料的镜头了'); break; }
        state.filter = 'all';
        if($('filterSel')) $('filterSel').value = 'all';
        locateShot(shotById(hh[0].id));
        toast('已定位到第 ' + hh[0].no + ' 镜（' + hh[0].issues.join('、') + '）');
        break;
      }
      /* v2.27：体检明细里逐条「去改」——关掉明细、直接跳到那一镜 */
      case 'hfixone': {
        closeDlg(false);
        var h1 = shotById(id);
        if(!h1){ toast('没找到这一镜，可能已被删除'); break; }
        locateShot(h1);
        toast('已定位到第 ' + (h1['镜号'] || '') + ' 镜，改完可再点「查看明细」复查');
        break;
      }
      /* v2.27：明细内就地修复——关明细 → 走确认 → 修完（或取消）自动重列明细，看得见还剩什么 */
      case 'hfixallbox': closeDlg(false); fixHealthAuto(null, function(){ setTimeout(showHealthBox, 30); }); break;
      case 'hfixdurbox': closeDlg(false); fixHealthAuto(['dur'], function(){ setTimeout(showHealthBox, 30); }); break;
      case 'rnguse': applyRangePreset(t.getAttribute('data-i')); break;      /* v2.20：套用镜号预设 */
      case 'rngdel': delRangePreset(t.getAttribute('data-i')); break;        /* v2.20：删除镜号预设 */
      case 'rngfilter': filterByRangePreset(t.getAttribute('data-i')); break;/* v2.22：按选区预设筛选生成页 */
      case 'rngup': moveRangePreset(t.getAttribute('data-i')); break;        /* v2.22：预设上移一位 */
      case 'fvuse': applyFilterView(t.getAttribute('data-i')); break;        /* v2.23：套用命名筛选视图 */
      case 'fvdel': delFilterView(t.getAttribute('data-i')); break;          /* v2.23：删除筛选视图 */
      case 'fvren': renameFilterView(t.getAttribute('data-i')); break;        /* v2.24：重命名筛选视图 */
      case 'hcheck': showHealthBox(); break;                                 /* v2.20：关键字段体检明细 */
      case 'hexp': exportHealthReport(); break;                              /* v2.20：导出体检报告 */
      case 'hfixall': fixHealthAuto(); break;                              /* v2.26：一键自动修复（时长/章节/单角色） */
      case 'bulkretry': retryBulkFail(); break;                            /* v2.29：重试没写成云端的批量改动 */
      case 'bulkfailclear': state.bulkFail = []; refreshAll(); toast('已忽略，改动仍在本机，切回云端数据源前不会同步'); break;
      case 'failretry': retryFailed(); break;                              /* v2.38：四类失败逐类重跑 */
      case 'failjump': {                                                   /* v2.38：跳到第一个失败镜 */
        var fs = failShots();
        if(!fs.length){ toast('当前没有失败的镜头'); break; }
        locateShot(fs[0]);
        break;
      }
      case 'failfilter': {                                                 /* v2.38：只看失败（四类） */
        state.filter = 'fail';
        if($('filterSel')) $('filterSel').value = 'fail';
        setView('gen');
        toast('已只筛出失败的镜头（图片 / 视频 / 配音 / 口型都算）');
        break;
      }
      case 'hfixdur': fixDurationsAuto(); break;                           /* v2.25：只补时长（自动修复子集） */
      case 'autopick': autoPickAllCand(); break;                           /* v2.25：候选图批量选最高分 */
      case 'filtercand': {                                                 /* v2.26：只筛出「有候选待挑」的镜 */
        state.filter = 'cand';
        if($('filterSel')) $('filterSel').value = 'cand';
        setView('gen');
        toast('已只筛出有候选待挑的镜头，可点任一镜的「选图」手挑');
        break;
      }
      case 'guse': applyGenrePreset(t.getAttribute('data-i')); break;        /* v2.20：套用自定义类型套餐 */
      case 'gdel': delGenrePreset(t.getAttribute('data-i')); break;          /* v2.20：删除自定义类型套餐 */
      case 'del': {
        var ds = shotById(id);
        askConfirm('确定删除第 ' + (ds ? ds['镜号'] : '') + ' 镜？删除后可用「撤销」恢复。', '删除', true)
          .then(function(ok){ if(ok){ if(!id){ toast('没取到这一镜的 ID，请刷新页面重试'); return; } pushUndo(); delShot(id); } });
        break;
      }
      case 'up': moveShot(id, -1); break;
      case 'down': moveShot(id, 1); break;
      case 'dup': dupShot(id); break;
      case 'ins': insertShotAfter(id); break;
      case 'undo': undoShots(); break;
      case 'redo': redoShots(); break;                 /* v2.32 */
      case 'undohist': toggleUndoHist(); break;        /* v2.39：展开 / 收起「跳到某一版」 */
      case 'undoto': undoTo(num(t.getAttribute('data-i'))); break;   /* v2.39：一步跳到指定版本 */
      /* v2.49：多剧目 */
      case 'projmgr': openProjMgr(); break;
      case 'projnew': askInput('给新剧目起个名字', '新剧目').then(function(n){ if(n) createProject(n); }); break;
      case 'projswitch': { var sp = t.getAttribute('data-pid'); if(sp) switchProject(sp); closeProjMgr(); break; }
      case 'projrename': { var rp = t.getAttribute('data-pid'); if(rp) askInput('重命名剧目', projName(rp) || '剧目').then(function(n){ if(n) renameProject(rp, n); }); break; }
      case 'projdelete': { var dp = t.getAttribute('data-pid'); if(dp) askConfirm('删除剧目「' + (projName(dp) || '') + '」？该剧目下的分镜与设定卡会一并清除（不可恢复）。', '删除', true).then(function(ok){ if(ok) deleteProject(dp); }); break; }
      case 'projclose': closeProjMgr(); break;
      case 'serialstop': stopSerial(); break;          /* v2.32：批量跑到一半可以叫停 */
      case 'openshot': setView('gen'); state.expanded[id] = true; renderGenList();
        setTimeout(function(){ var el = document.querySelector('.gen[data-id="'+id+'"]'); if(el) el.scrollIntoView({behavior:'smooth', block:'center'}); }, 80);
        break;
      case 'goasset': setView('asset'); break;
      case 'genasset': genAsset(id, 1); break;
      case 'genasset2': genAsset(id, 2); break;
      case 'audio': genAudio(id); break;
      case 'batchAudio': batchAudio(); break;
      case 'aiAnchor': setView('asset'); aiAnchors(); break;
      case 'lock': {
        var sl = shotById(id);
        if(sl) patchShot(id, { 满意锁定: (sl['满意锁定'] === '是' ? '否' : '是'), 更新时间: nowStr() });
        break;
      }
      case 'rollimg': rollbackImg(id); break;
      case 'imgcand': genImageCand(id); break;
      case 'pickcand': openCandPanel(id); break;
      case 'cueedit': openCueBox(id); break;
      case 'delasset': {
        var da = null;
        for(var ai=0; ai<state.assets.length; ai++){ if(state.assets[ai]._id === id) da = state.assets[ai]; }
        askConfirm('删除设定卡「' + (da ? (da['名称']||'') : '') + '」？删除后相关镜头会失去一致性参考。', '删除', true)
          .then(function(ok){ if(ok) delAsset(id); });
        break;
      }
      case 'showprompt': showPromptBox(id); break;
      case 'clrprompt': patchShot(id, { 图片提示词覆盖:'', 视频提示词覆盖:'', 更新时间:nowStr() }); toast('已还原为自动拼装'); break;
      case 'viewimg': { var s = shotById(id); if(s) openUrl(s['图片URL'], 'image'); break; }
      case 'openvid': { var s2 = shotById(id); if(s2) openUrl(s2['口型视频URL'] || s2['视频URL'], 'video'); break; }
      case 'lip': genLipsync(id); break;
      case 'avoidlip': {
        var al = shotById(id);
        if(!al) break;
        askConfirm('把第 ' + al['镜号'] + ' 镜改写成看不到嘴部的低风险镜头？台词不变，画面会变，需要重新生图和生视频。', '改写')
          .then(function(ok){ if(ok) avoidLipOne(id); });
        break;
      }
    }
  });

  /* 章节列表：点整行切换勾选，点复选框只切自己，点「剧本化 / 用原文」走各自动作 */
  $('chapterList').addEventListener('click', function(ev){
    var chAct = ev.target.getAttribute && ev.target.getAttribute('data-chact');
    if(chAct){
      var ar = ev.target.closest ? ev.target.closest('[data-ch]') : null;
      if(ar){
        var ac = state.chapters[num(ar.getAttribute('data-ch'))];
        if(ac){
          if(chAct === 'adapt') adaptChapter(ac);
          else { delete ac.adapted; saveChapters(); renderChapters(); toast('已还原：拆镜将使用小说原文'); }
        }
      }
      return;
    }
    var cb = ev.target.getAttribute && ev.target.getAttribute('data-chsel');
    var row = ev.target.closest ? ev.target.closest('[data-ch]') : null;
    if(!row){
      var n = ev.target;
      while(n && n !== document){ if(n.getAttribute && n.getAttribute('data-ch')){ row = n; break; } n = n.parentNode; }
    }
    if(!row) return;
    var i = num(row.getAttribute('data-ch'));
    var c = state.chapters[i];
    if(!c) return;
    if(cb === null || cb === undefined || cb === '') c.sel = !c.sel;
    saveChapters(); renderChapters();
  });

  /* 表格 / 卡片内输入：失焦即存 */
  function bindEdit(root){
    root.addEventListener('change', function(ev){
      var el = ev.target;
      var f = el.getAttribute('data-f') || el.getAttribute('data-af');
      if(!f) return;
      var row = el.closest('[data-id]'); if(!row) return;
      var id = row.getAttribute('data-id');
      var o = {}; o[f] = el.value;
      if(f === '时长秒') o[f] = num(el.value);
      if(el.getAttribute('data-af')) patchAsset(id, o);
      else patchShot(id, o);
    });
  }
  bindEdit($('shotTable'));
  bindEdit($('genList'));
  bindEdit($('roleList'));
  bindEdit($('sceneList'));

  $('btnNewRole').addEventListener('click', function(){
    addAsset({ 类型:'角色', 名称:'新角色', 中文描述:'', 英文锚点:'', 参考图URL:'', 状态:'未生成', 错误信息:'', 更新时间:nowStr() });
  });
  $('btnNewScene').addEventListener('click', function(){
    addAsset({ 类型:'场景', 名称:'新场景', 中文描述:'', 英文锚点:'', 参考图URL:'', 状态:'未生成', 错误信息:'', 更新时间:nowStr() });
  });
  $('btnPickRoles').addEventListener('click', pickAssetsFromShots);
  $('btnPickScenes').addEventListener('click', pickAssetsFromShots);
  $('btnBatchAsset').addEventListener('click', batchAssets);
  $('btnAiAnchor').addEventListener('click', aiAnchors);

  $('novel').addEventListener('input', function(){
    clearTimeout(window._nvTm);
    window._nvTm = setTimeout(function(){
      lsSet(pk('novel'), $('novel').value, { warn:true });
    }, 500);
  });

  $('filterSel').addEventListener('change', function(){
    saveViewScroll();   /* v2.23：切走前记下当前视图的滚动位置（必须先于 state.filter 的改动） */
    state.filter = this.value;
    /* v2.22：选「按镜号选区」但还没设过表达式时，别把列表筛成空的 */
    if(state.filter === 'expr' && !String(cfg.filterExpr || '').trim()){
      toast('还没有选区表达式——到「成片与导出 → 导出中心」，在镜号预设上点「筛」');
      state.filter = 'all'; this.value = 'all';
    }
    saveCfg(); renderGenList(); renderFilterViews();
  });
  /* v2.23：筛选视图——把常用筛选存成命名的一套，一键切回并回到上次看的位置 */
  if($('btnFilterSave')) $('btnFilterSave').addEventListener('click', saveFilterView);
  renderFilterViews();
  /* v2.24：视图拖拽排序——容器内事件委托，记下起点下标，落在哪个视图上就插到它前面 */
  (function(){
    var box = $('filterViews'), dragFrom = -1;
    if(!box) return;
    box.addEventListener('dragstart', function(e){
      var sp = e.target.closest && e.target.closest('[data-fvdrag]');
      if(!sp) return;
      dragFrom = num(sp.getAttribute('data-i'));
      try{ e.dataTransfer.setData('text/plain', String(dragFrom)); }catch(_){}
      e.dataTransfer.effectAllowed = 'move';
    });
    box.addEventListener('dragover', function(e){ if(dragFrom >= 0){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    box.addEventListener('drop', function(e){
      if(dragFrom < 0) return;
      e.preventDefault();
      var sp = e.target.closest && e.target.closest('[data-fvdrag]');
      var to = sp ? num(sp.getAttribute('data-i')) : -1, from = dragFrom; dragFrom = -1;
      if(to >= 0 && to !== from) moveFilterView(from, to);
    });
  })();
  $('btnSet').addEventListener('click', openDrawer);
  if($('projSel')) $('projSel').addEventListener('change', function(){ var v = $('projSel').value; if(v && v !== state.pid) switchProject(v); });  /* v2.49：头部下拉切换剧目 */
  $('btnCloseSet').addEventListener('click', closeDrawer);
  $('mask').addEventListener('click', closeDrawer);
  $('btnSaveSet').addEventListener('click', function(){ readSettings(); toast('设置已保存到本机'); closeDrawer(); });
  /* v2.18：剧集类型 ↔ 画风预设 联动——换类型即时刷新「建议画风」提示，一键套用
     v2.19：套餐还含全局画风令牌与提示词开关，这两处改动也刷新提示
     v2.20：再加「套餐库」——内置 3 套 + 自定义配方，可套用 / 删除 / 另存 */
  if($('cf_genre')) $('cf_genre').addEventListener('change', function(){ updGenreStyleHint(); });
  if($('btnGenreStyle')) $('btnGenreStyle').addEventListener('click', applyGenreStyle);
  if($('cf_globalStyle')) $('cf_globalStyle').addEventListener('input', function(){ updGenreStyleHint(); });
  if($('cf_genrePrompt')) $('cf_genrePrompt').addEventListener('change', function(){ updGenreStyleHint(); });
  /* v2.46：字幕样式实时预览——输入框/勾选框变动即重渲染示例框（input+change 双绑，覆盖文本/数字/勾选） */
  ['cf_subFont','cf_subSize','cf_subMargin','cf_subColor','cf_subOutlineColor','cf_subOutline','cf_subBold','cf_subBg','subPrevText'].forEach(function(id){
    var e = $(id); if(!e) return;
    e.addEventListener('input', renderSubPreview);
    e.addEventListener('change', renderSubPreview);
  });
  if($('btnGenreSave')) $('btnGenreSave').addEventListener('click', saveGenrePreset);
  /* v2.22：套餐导出 / 导入（JSON），便于换设备或多人共用同一套配方 */
  if($('btnGenreExport')) $('btnGenreExport').addEventListener('click', exportGenrePresets);
  if($('btnGenreImport')) $('btnGenreImport').addEventListener('click', importGenrePresets);
  if($('fileGenreJson')) $('fileGenreJson').addEventListener('change', function(){
    var f = this.files && this.files[0];
    this.value = '';
    if(!f) return;
    var fr = new FileReader();
    fr.onload = function(){ importGenrePresetsText(fr.result); };
    fr.onerror = function(){ toast('读取套餐文件失败'); };
    fr.readAsText(f, 'utf-8');
  });
  renderGenrePresets();
  $('btnTest').addEventListener('click', testAgnes);
  $('btnTestText').addEventListener('click', testText);
  if($('btnTestTts')) $('btnTestTts').addEventListener('click', function(){ readSettings(); testTts(); });
  if($('btnExpSrt')) $('btnExpSrt').addEventListener('click', exportSrt);
  if($('btnExpAudio')) $('btnExpAudio').addEventListener('click', exportAudioTrack);
  if($('btnFfCmd')) $('btnFfCmd').addEventListener('click', copyFfmpegCmd);
  /* v2.15：导出中心开关，以及备份/清空的转发（复用首页那套同一逻辑，不重复实现） */
  if($('btnOpenExport')) $('btnOpenExport').addEventListener('click', openExportPanel);
  if($('expClose')) $('expClose').addEventListener('click', closeExportPanel);
  if($('expMask')) $('expMask').addEventListener('click', closeExportPanel);
  /* 备份 / 导入 / 清空都会弹确认框，先把导出中心收起来，避免两层弹窗叠在一起 */
  if($('btnExBackup')) $('btnExBackup').addEventListener('click', function(){ closeExportPanel(); if($('btnExport')) $('btnExport').click(); });
  if($('btnExImport')) $('btnExImport').addEventListener('click', function(){ closeExportPanel(); if($('fileJson')) $('fileJson').click(); });
  if($('btnExClear')) $('btnExClear').addEventListener('click', function(){ closeExportPanel(); if($('btnClear')) $('btnClear').click(); });
  if($('btnExpBundle')) $('btnExpBundle').addEventListener('click', exportBundle);
  /* v2.22：打包可选附带体检 / 剩余清单；另给两个 xlsx 直出按钮（Excel 里能排序筛选） */
  if($('btnExpHealthXlsx')) $('btnExpHealthXlsx').addEventListener('click', exportHealthXlsx);
  if($('btnExpLeftXlsx')) $('btnExpLeftXlsx').addEventListener('click', function(){ exportLeftXlsx(); });
  if($('expInclHealth')){
    $('expInclHealth').checked = !!cfg.bundleHealth;
    $('expInclHealth').addEventListener('change', function(){ cfg.bundleHealth = !!this.checked; saveCfg(); });
  }
  if($('expInclLeft')){
    $('expInclLeft').checked = !!cfg.bundleLeft;
    $('expInclLeft').addEventListener('change', function(){ cfg.bundleLeft = !!this.checked; saveCfg(); });
  }
  /* v2.23：「只打这些文件」的勾选——回填当前选择并即时写档 */
  var _pickMap = { expPickSrt:'srt', expPickMd:'md', expPickCsv:'csv', expPickJson:'json', expPickFf:'ff', expPickXlsx:'xlsx' };
  Object.keys(_pickMap).forEach(function(eid){
    var el = $(eid); if(!el) return;
    var key = _pickMap[eid];
    el.checked = bundlePick()[key];
    el.addEventListener('change', function(){
      if(!cfg.bundlePick || typeof cfg.bundlePick !== 'object') cfg.bundlePick = { srt:true, md:true, csv:true, json:true, ff:true };
      cfg.bundlePick[key] = !!el.checked;
      saveCfg();
    });
  });
  /* v2.17：打包范围记住上次选择（默认全部），免得每次都重选 */
  if($('expScope')){
    $('expScope').value = cfg.expScope || 'all';
    $('expScope').addEventListener('change', function(){ cfg.expScope = this.value; saveCfg(); updExpPreview(); });
  }
  /* v2.24：打包状态二次筛选——回填并即时写档 */
  if($('expStatusSel')){
    $('expStatusSel').value = cfg.bundleStatus || 'all';
    $('expStatusSel').addEventListener('change', function(){ cfg.bundleStatus = this.value; saveCfg(); });
  }
  /* v2.19：自定镜号表达式（多段 + 排除）记住，并参与实时预览；
     老配置里的「起止镜号」自动拼成表达式迁过来，老用户不用重填。 */
  if($('expRange')){
    var _er = String(cfg.expRange || '').trim();
    if(!_er && (num(cfg.expFrom) || num(cfg.expTo))){
      var _f = num(cfg.expFrom), _t = num(cfg.expTo);
      _er = (_f && _t) ? (_f + '-' + _t) : (_f ? (_f + '-') : ('-' + _t));
      cfg.expRange = _er; saveCfg();
    }
    $('expRange').value = _er;
    $('expRange').addEventListener('input', function(){ cfg.expRange = this.value; saveCfg(); updExpPreview(); });
    if($('btnRangeSave')) $('btnRangeSave').addEventListener('click', saveRangePreset);
    /* v2.23：镜号预设的导出 / 导入（与类型套餐同一套 JSON 机制） */
    if($('btnRangeExport')) $('btnRangeExport').addEventListener('click', exportRangePresets);
    if($('btnRangeImport')) $('btnRangeImport').addEventListener('click', importRangePresets);
  /* v2.24：预设与套餐合并包导出 / 导入（云端同步一键包） */
  if($('btnExpPresets')) $('btnExpPresets').addEventListener('click', exportPresetsPkg);
  if($('btnImpPresets')) $('btnImpPresets').addEventListener('click', function(){ if($('filePresetPkg')) $('filePresetPkg').click(); });
  if($('filePresetPkg')) $('filePresetPkg').addEventListener('change', function(){
    var f = this.files && this.files[0];
    this.value = '';
    if(!f) return;
    var fr = new FileReader();
    fr.onload = function(){ importPresetsPkgText(fr.result); };
    fr.onerror = function(){ toast('读取套餐包失败'); };
    fr.readAsText(f, 'utf-8');
  });
    if($('fileRangeJson')) $('fileRangeJson').addEventListener('change', function(){
      var f = this.files && this.files[0];
      this.value = '';
      if(!f) return;
      var fr = new FileReader();
      fr.onload = function(){ importRangePresetsText(fr.result); };
      fr.onerror = function(){ toast('读取预设文件失败'); };
      fr.readAsText(f, 'utf-8');
    });
    renderRangePresets();   /* v2.20：把存过的镜号预设列出来 */
  }
  if($('btnExpRender')) $('btnExpRender').addEventListener('click', exportRenderPack);
  /* v2.44：成片预览入口与播放器控件一次性绑定 */
  wirePreview();
  if($('btnExpFcp')) $('btnExpFcp').addEventListener('click', exportFcpXml);
  if($('btnExpDraft')) $('btnExpDraft').addEventListener('click', exportJianyingDraft);   /* v2.49：导出剪映草稿 */
  if($('btnStopBatch')) $('btnStopBatch').addEventListener('click', function(){
    state.stopBatch = true; toast('已请求停止，正在跑的这几个会跑完');
  });
  if($('stylePresets')) $('stylePresets').addEventListener('click', function(ev){
    var b = ev.target.closest ? ev.target.closest('[data-style]') : null;
    if(b) applyStylePreset(b.getAttribute('data-style'));
  });
  renderStylePresets();
  document.addEventListener('keydown', function(ev){
    if((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 'z'){
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      if(tag === 'input' || tag === 'textarea') return;   /* 不抢输入框内的撤销 */
      ev.preventDefault();
      if(ev.shiftKey) redoShots();                        /* v2.32：Ctrl+Shift+Z = 重做 */
      else undoShots();
    }
    /* v2.32：Ctrl+Y 也是重做（Windows 习惯） */
    if((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 'y'){
      var tg2 = (ev.target && ev.target.tagName || '').toLowerCase();
      if(tg2 === 'input' || tg2 === 'textarea') return;
      ev.preventDefault(); redoShots();
    }
  });
  if($('btnResetUse')) $('btnResetUse').addEventListener('click', function(){
    askConfirm('把用量统计（图片 / 视频秒 / 配音 / 口型计数）清零？单价不变。', '清零', true)
      .then(function(ok){
        if(!ok) return;
        cfg.usedImg = 0; cfg.usedVidSec = 0; cfg.usedTts = 0; cfg.usedLip = 0;
        saveCfg(); refreshAll(); toast('用量统计已清零');
      });
  });
  /* v2.47：预算横幅「知道了」——只关横幅，生成仍会被拦（warned 复位，下次拦截再提示一次） */
  if($('budgetClose')) $('budgetClose').addEventListener('click', function(){ hideBudgetBanner(); state.budgetWarned = false; });
  if($('btnBatchAudio')) $('btnBatchAudio').addEventListener('click', batchAudio);
  if($('btnTestLip')) $('btnTestLip').addEventListener('click', function(){ readSettings(); testLip(); });
  if($('btnLipScan')) $('btnLipScan').addEventListener('click', scanLipRisk);
  if($('btnLipAvoid')) $('btnLipAvoid').addEventListener('click', aiAvoidLip);
  if($('btnLipBatch')) $('btnLipBatch').addEventListener('click', batchLipsync);
  if($('btnParseCh')) $('btnParseCh').addEventListener('click', function(){ readSettings(); onParseChapters(); });
  if($('btnPipeRun')) $('btnPipeRun').addEventListener('click', function(){ readSettings(); runPipeline(); });
  if($('btnPipeStop')) $('btnPipeStop').addEventListener('click', stopPipeline);
  if($('btnAudit')) $('btnAudit').addEventListener('click', function(){ renderAudit(); toast('已重新体检'); });
  $('btnSplit').addEventListener('click', splitShots);
  $('btnAddShot').addEventListener('click', function(){
    var no = state.shots.length ? (num(state.shots[state.shots.length-1]['镜号']) + 1) : 1;
    /* v2.42：手动加一镜也必须入撤销栈——复制/插入/删除都已入栈，唯独这里漏了，
       导致「加一镜 → 撤销」会跳过这次新增、直接退到更早的快照（静默丢数据）。 */
    pushUndo();
    addShotObj({ 镜号:no, 画面描述:'', 英文提示词:'', 运镜:'', 台词旁白:'', 时长秒:num($('shotSec').value)||5,
      图片状态:'未生成', 视频状态:'未生成', 图片URL:'', 视频URL:'', 任务ID:'', 错误信息:'', 更新时间:nowStr() });
  });
  $('btnDemo').addEventListener('click', function(){
    if(!state.shots.length){ seedDemo(); return; }
    askConfirm('当前已有 ' + state.shots.length + ' 条分镜，示例会追加在后面，继续？', '继续')
      .then(function(ok){ if(ok) seedDemo(); });
  });
  $('btnBatchImg').addEventListener('click', function(){ batch('img'); });
  $('btnBatchVid').addEventListener('click', function(){ batch('vid'); });
  $('btnRetryFail').addEventListener('click', retryFailed);
  $('btnExport').addEventListener('click', exportJson);
  $('btnExpJson').addEventListener('click', exportJson);
  $('btnExpMd').addEventListener('click', exportMd);
  $('btnExpCsv').addEventListener('click', exportCsv);
  $('btnImport').addEventListener('click', function(){ $('fileJson').click(); });
  $('fileJson').addEventListener('change', function(){ if(this.files && this.files[0]) importJson(this.files[0]); this.value=''; });
  $('btnLoadFile').addEventListener('click', function(){ $('fileNovel').click(); });
  $('fileNovel').addEventListener('change', function(){
    var f = this.files && this.files[0]; if(!f) return;
    var fr = new FileReader();
    fr.onload = function(){ $('novel').value = fr.result; lsSet(pk('novel'), fr.result, { warn:true }); toast('已导入 ' + f.name); };
    fr.readAsText(f, 'utf-8');
    this.value = '';
  });
  $('btnClear').addEventListener('click', function(){
    if(!state.shots.length){ toast('当前没有数据'); return; }
    var total = state.shots.length, atotal = state.assets.length;
    askConfirm('将删除全部 ' + total + ' 个分镜和 ' + atotal + ' 张设定卡，且不可恢复。建议先导出备份。', '继续', true)
      .then(function(ok){
        if(!ok) return false;
        return askConfirm('再确认一次：真的要清空全部 ' + total + ' 个分镜 + ' + atotal + ' 张设定卡吗？', '确认清空', true);
      })
      .then(function(ok){ if(ok) clearAllShots().then(clearAllAssets).then(function(){ toast('已清空'); }); });
  });
  $('btnWipeKey').addEventListener('click', function(){
    askConfirm('清除本机保存的 Agnes / 文本模型 / TTS / 唇形服务的所有 Key？', '清除', true).then(function(ok){
      if(!ok) return;
      cfg.agnesKey = ''; cfg.agnesKeys = ''; cfg.textKey = ''; cfg.ttsKey = ''; cfg.lipKey = ''; saveCfg(); toast('已清除全部 Key');
    });
  });
  $('dlgYes').addEventListener('click', function(){ closeDlg(true); });
  $('dlgNo').addEventListener('click', function(){ closeDlg(false); });
  $('dlgMask').addEventListener('click', function(){ closeDlg(false); });
  /* v2.20：输入框弹窗（askInput）里回车 = 确定；只对输入模式生效，免得影响普通确认框 */
  $('dialog').addEventListener('keydown', function(e){
    if(e.key === 'Enter' && _dlgInput){ e.preventDefault(); closeDlg(true); }
  });
  /* v2.52：Esc 关掉「最上层」那个浮层。原来只有确认框和成片播放器响应，
     设置抽屉 / 剧目管理 / 字幕编辑都只能去找关闭按钮。按层级从上往下判定。 */
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    if($('dialog').classList.contains('on')){ closeDlg(false); return; }
    if($('projDlg').classList.contains('on')){ closeProjMgr(); return; }
    if($('cueBox').classList.contains('on')){ closeCueBox(); return; }
    if($('drawer').classList.contains('on')){ closeDrawer(); return; }
  });

  /* 提示词调试弹窗 */
  $('pmSave').addEventListener('click', savePromptOverride);
  $('pmClose').addEventListener('click', closePromptBox);
  $('pmReset').addEventListener('click', function(){
    if($('pmImg')) $('pmImg').value = '';
    if($('pmVid')) $('pmVid').value = '';
  });
  $('pmMask').addEventListener('click', closePromptBox);

  /* v2.14：批量进度条的「停止」按钮；v2.15 增加「暂停 / 继续」 */
  $('bbarStop').addEventListener('click', function(){
    state.stopBatch = true;
    state.batchPause = false;
    if($('bbarPause')) $('bbarPause').textContent = '暂停';
    batchBarMsg('已请求停止，正在跑的这几个会跑完；未完成的重新点一次批量即可续跑…');
    toast('已请求停止');
  });
  $('bbarPause').addEventListener('click', toggleBatchPause);

  /* v2.9：候选图 A/B 选优弹窗 */
  $('cbClose').addEventListener('click', closeCandPanel);
  $('cbMask').addEventListener('click', closeCandPanel);
  $('cbAllNo').addEventListener('click', discardCand);
  $('cbMsg').addEventListener('click', function(ev){
    var b = ev.target;
    if(b && b.getAttribute && b.getAttribute('data-cbact') === 'pick') pickCand(num(b.getAttribute('data-i')));
  });

  /* v2.9：台词逐句 cue 编辑弹窗 */
  $('cueSave').addEventListener('click', saveCueBox);
  $('cueClose').addEventListener('click', closeCueBox);
  $('cueMask').addEventListener('click', closeCueBox);
  $('cueAdd').addEventListener('click', function(){
    var box = $('cueRows');
    if(!box) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = cueRowHtml({ speaker:'', type:'dlg', emotion:'', text:'' });
    box.appendChild(tmp.firstChild);
    var inputs = box.querySelectorAll('.cue-row:last-child input[data-cf="txt"]');
    if(inputs.length) inputs[0].focus();
  });
  $('cueMsg').addEventListener('click', function(ev){
    var b = ev.target;
    if(b && b.getAttribute && b.getAttribute('data-cact') === 'delrow'){
      var row = b.parentNode;
      if(row && row.parentNode) row.parentNode.removeChild(row);
    }
  });

  /* 质检报告弹窗 */
  $('qaClose').addEventListener('click', closeQa);
  $('qaMask').addEventListener('click', closeQa);
  $('qaMsg').addEventListener('click', function(ev){
    var b = ev.target.closest ? ev.target.closest('button[data-qa]') : null;
    if(!b) return;
    qaDo(num(b.getAttribute('data-qa')), b.getAttribute('data-act'));
  });

  /* AI 提取弹窗 */
  $('exSave').addEventListener('click', saveExtracted);
  $('exClose').addEventListener('click', closeExtract);
  $('exMask').addEventListener('click', closeExtract);

  $('btnAuditShot').addEventListener('click', auditShots);
  $('btnAiExtract').addEventListener('click', aiExtractAssets);

  document.querySelectorAll('.tab').forEach(function(b){
    b.addEventListener('click', function(){ setView(b.getAttribute('data-v')); });
  });
  document.querySelectorAll('.mtab').forEach(function(b){
    b.addEventListener('click', function(){ setView(b.getAttribute('data-v')); });
  });
}
function setView(v){
  state.view = v;
  ['script','asset','gen','film','bedtime'].forEach(function(k){ $('v-'+k).style.display = (k === v ? '' : 'none'); });
  document.querySelectorAll('.tab').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-v') === v); });
  document.querySelectorAll('.mtab').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-v') === v); });
  if(typeof renderBedtime === 'function' && v === 'bedtime') renderBedtime();
  refreshAll();
}

/* ---------------- 初始化 ---------------- */
function resumePolling(){
  state.shots.forEach(function(s){
    var vs = s['视频状态'] || '';
    if((vs === '排队中' || vs === '生成中') && s['任务ID']) startPoll(s._id);
  });
}
/* 页面刷新会中断进行中的请求，把无法续跑的「生成中」卡死状态重置，
   否则永远停在生成中（视频有任务 ID 能续轮询，不在此列） */
function resetStuck(){
  var jobs = [];
  state.shots.forEach(function(s){
    var o = null;
    if(s['图片状态'] === '生成中'){ o = o || {}; o['图片状态'] = '未生成'; }
    if(s['配音状态'] === '生成中'){ o = o || {}; o['配音状态'] = '未生成'; }
    if(s['口型状态'] === '生成中'){ o = o || {}; o['口型状态'] = '未生成'; }
    if(o){ o['更新时间'] = nowStr(); jobs.push({ id:s._id, o:o }); }
  });
  var ajobs = [];
  state.assets.forEach(function(a){
    if(a['状态'] === '生成中') ajobs.push({ id:a._id, o:{ 状态:'未生成', 更新时间:nowStr() } });
  });
  /* v2.29：镜头侧走 bulkPatch（一次落盘一次刷新），设定图侧通常只有几条，保持逐条 */
  /* v2.45：bulkPatch 返回 Promise，用 .then 取写入镜数决定资产侧是否额外刷新 */
  var n = jobs.length ? bulkPatch(jobs) : Promise.resolve(0);
  /* v2.31：设定卡侧也走 runSerial（原来一条失败整链断，后面的卡一直卡在「生成中」） */
  runSerial(ajobs.map(function(j){ return function(){ return patchAsset(j.id, j.o); }; }))
    .then(function(){ n.then(function(cnt){ if(ajobs.length && !cnt) refreshAll(); }); });
}
/* ============== v2.49：多剧目管理 ============== */
function projName(id){ var p = (state.projects||[]).filter(function(x){ return x.id === id; })[0]; return p ? p.name : ''; }
function saveProjects(){
  /* v2.53：剧目列表写失败不能静默——否则删掉的剧目刷新后又冒出来（数据已删，只剩个空壳） */
  lsSet(LS+'projects', JSON.stringify(state.projects), { warn:true, msg:'剧目列表保存失败（存储已满）：本次改动刷新后不保留' });
  try{ localStorage.setItem(LS+'lastpid', state.pid); }catch(e){}
}
function ensureProjects(){
  var raw = null;
  try{ raw = JSON.parse(localStorage.getItem(LS+'projects') || 'null'); }catch(e){ raw = null; }
  if(Array.isArray(raw) && raw.length){
    state.projects = raw;
    var lp = ''; try{ lp = localStorage.getItem(LS+'lastpid') || ''; }catch(e){}
    var cur = raw.filter(function(p){ return p.id === lp; })[0];
    state.pid = (cur || raw[0]).id;
    return;
  }
  /* 首次运行 / 从旧版升级：把旧的全局本机数据迁到默认剧目命名空间，避免丢数据 */
  state.pid = 'prj_default';
  var def = { id:'prj_default', name:'默认剧目', createdAt:Date.now(), updatedAt:Date.now() };
  /* v2.55：迁移写失败原来静默吞掉——而下面 state.projects 照写、state.pid 照切，
     于是老用户升级时若配额满：数据仍躺在旧全局 key 下读不到，界面表现为「分镜/正文
     凭空消失」，且下次启动走上面的早退分支**永不重试迁移**＝永久丢失。
     现在：迁移逐项走 lsSet 腾挪；只要有一项没搬成功，就不写 projects 列表、
     不改 pid，直接提示用户（下次启动会再试一次迁移）。 */
  var migFail = false;
  ['shots','chs','novel','cfg','assets'].forEach(function(k){
    var old = null; try{ old = localStorage.getItem(LS + k); }catch(e){}
    if(old != null && !lsSet(pk(k), old)) migFail = true;
  });
  /* v2.53：配音缓存 / 逐句时长账本 / 撤销栈也按前缀迁一遍。
     这几类 key 是「LS + 前缀 + 动态 id」，不在上面那个固定名单里，
     于是老用户升级后：配音全丢（看着像要重新花钱生成）、撤销栈空、
     逐句时长账本没了导致字幕退回按字数估算、与口型对不齐。 */
  ['aud_','cuedur_'].forEach(function(pre){
    try{
      var move = [], i;
      for(i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if(k && k.indexOf(LS + pre) === 0) move.push(k);
      }
      move.forEach(function(k){
        var rest = k.slice(LS.length);                 /* 形如 aud_rec1 */
        var val = null; try{ val = localStorage.getItem(k); }catch(e){}
        if(val != null && !lsSet(pk(rest), val)) migFail = true;
      });
    }catch(e){ migFail = true; }
  });
  ['undo','redo'].forEach(function(k){
    var old = null; try{ old = localStorage.getItem(LS + k); }catch(e){}
    if(old != null && !lsSet(pk(k), old)) migFail = true;
  });
  /* 迁移没搬干净就别落 projects / 别切 pid：保持「未迁移」状态，下次启动重试。
     否则一旦落盘，上面的早退分支会让迁移再也不会执行（v2.55 修复的真丢数据路径）。 */
  if(migFail){
    state.pid = '';
    state.projects = [];
    setTimeout(function(){
      toast('旧数据迁移失败（本机存储已满）：已保留原数据未动，请导出备份后清理浏览器的配音缓存，再刷新页面重试');
    }, 200);
    return;
  }
  state.projects = [def];
  saveProjects();
}
function renderProjSel(){
  var sel = $('projSel'); if(!sel) return;
  sel.innerHTML = (state.projects || []).map(function(p){
    return '<option value="' + esc(p.id) + '"' + (p.id === state.pid ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  }).join('');
}
function renderProjDlg(){
  var box = $('projList'); if(!box) return;
  box.innerHTML = (state.projects || []).map(function(p){
    var cur = p.id === state.pid;
    return '<div class="proj-row' + (cur ? ' cur' : '') + '">' +
      '<div class="pinfo"><div class="pn">' + esc(p.name) + '</div><div class="pt">创建于 ' + new Date(p.createdAt||Date.now()).toLocaleDateString() + '</div></div>' +
      '<button class="btn gh sm" data-act="projswitch" data-pid="' + esc(p.id) + '"' + (cur ? ' disabled' : '') + '>切换</button>' +
      '<button class="btn gh sm" data-act="projrename" data-pid="' + esc(p.id) + '">重命名</button>' +
      '<button class="btn sm danger" data-act="projdelete" data-pid="' + esc(p.id) + '"' + (state.projects.length <= 1 ? ' disabled' : '') + '>删除</button>' +
      '</div>';
  }).join('');
}
function openProjMgr(){ renderProjDlg(); $('projDlg').classList.add('on'); $('projMask').classList.add('on'); }
function closeProjMgr(){ $('projDlg').classList.remove('on'); $('projMask').classList.remove('on'); }
/* v2.53：切换 / 新建剧目时清掉「只属于上一个剧目」的界面状态。
   不清的后果：① 上剧目的云端失败清单还在首页，点重试对着已不存在的镜 id 写云；
   ② 「只看失败」「1-3 镜」这类筛选带进空的新剧目 → 列表一片空白，用户第一反应是「数据丢了」；
   ③ 候选图 / 字幕 / 提示词浮层还指向上一剧目的镜 id，编辑会写到不存在的镜上。 */
function resetProjUiState(){
  state.bulkFail = [];
  state.filter = 'all';
  cfg.filterExpr = '';
  try{ saveCfg(); }catch(e){}
  try{ cbShotId = ''; cueShotId = ''; pmShotId = ''; }catch(e){}
  /* 浮层若开着就一并关掉；这几个 close 函数内部直接取 DOM，元素缺失会抛，逐个兜住 */
  try{ if(typeof closeCandPanel === 'function') closeCandPanel(); }catch(e){}
  try{ if(typeof closeCueBox === 'function') closeCueBox(); }catch(e){}
  try{ if(typeof closePromptBox === 'function') closePromptBox(); }catch(e){}
}
function createProject(name){
  name = (name || '新剧目').trim() || '新剧目';
  var id = 'prj_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  state.projects.push({ id:id, name:name, createdAt:Date.now(), updatedAt:Date.now() });
  saveProjects();
  /* 新建剧目必然是空的：直接把当前剧目切成它，清空内存并拉一次空数据 */
  state.pid = id; saveProjects();
  state.shots = []; state.assets = []; state.chapters = []; state.undo = []; state.redo = [];
  resetProjUiState();                 /* v2.53：清掉上一剧目的失败清单 / 筛选 / 浮层，避免「串台」 */
  try{ AUD = {}; }catch(e){}
  try{ localStorage.removeItem(pk('batchLeft')); }catch(e){}
  try{ if($('novel')) $('novel').value = localStorage.getItem(pk('novel')) || ''; }catch(e){}
  renderProjSel(); renderProjDlg();
  return loadShots().then(function(){ return loadAssets(); }).then(function(){
    restoreChapters(); loadUndo(); loadRedo(); refreshAll(); renderProjSel(); renderProjDlg();
    return id;
  });
}
function switchProject(pid){
  if(!pid || pid === state.pid) return Promise.resolve();
  state.pid = pid; saveProjects();
  state.shots = []; state.assets = []; state.chapters = []; state.undo = []; state.redo = [];
  resetProjUiState();                 /* v2.53：同上 */
  try{ AUD = {}; }catch(e){}
  try{ localStorage.removeItem(pk('batchLeft')); }catch(e){}
  try{ if($('novel')) $('novel').value = localStorage.getItem(pk('novel')) || ''; }catch(e){}
  refreshAll(); renderProjSel(); renderProjDlg();
  return loadShots().then(function(){ return loadAssets(); }).then(function(){
    restoreChapters(); loadUndo(); loadRedo(); refreshAll(); renderProjSel(); renderProjDlg();
    return true;
  });
}
function renameProject(pid, name){
  name = (name || '').trim(); if(!name) return;
  state.projects.forEach(function(p){ if(p.id === pid){ p.name = name; p.updatedAt = Date.now(); } });
  saveProjects(); renderProjSel(); renderProjDlg();
  toast('已重命名为「' + name + '」');
}
function deleteProject(pid){
  if(!pid || state.projects.length <= 1){ toast('至少保留一个剧目'); return Promise.resolve(); }
  var wasCurrent = state.pid === pid;
  state.projects = state.projects.filter(function(p){ return p.id !== pid; });
  saveProjects();
  try{ var pre = LS + pid + ':'; var kill = []; for(var i=0;i<localStorage.length;i++){ var kk = localStorage.key(i); if(kk && kk.indexOf(pre) === 0) kill.push(kk); } kill.forEach(function(kk){ localStorage.removeItem(kk); }); }catch(e){}
  if(!hasCloud()){ if(wasCurrent) return switchProject(state.projects[0].id); renderProjSel(); renderProjDlg(); return Promise.resolve(); }
  var jobs = [];
  return loadPage().then(function(all){
    all.filter(function(r){ return r.pid === pid; }).forEach(function(r){ jobs.push(function(){ return db().deleteRecord({ databaseId: DB_ID, recordId: r._id }); }); });
    return loadAssetsPage();
  }).then(function(all){
    all.filter(function(r){ return r.pid === pid; }).forEach(function(r){ jobs.push(function(){ return db().deleteRecord({ databaseId: ASSET_DB_ID, recordId: r._id }); }); });
    if(!jobs.length){ if(wasCurrent) return switchProject(state.projects[0].id); renderProjSel(); renderProjDlg(); return; }
    return runSerial(jobs, { label:'删除剧目数据', tag:'delproj' });
  }).then(function(){
    if(wasCurrent) return switchProject(state.projects[0].id);
    renderProjSel(); renderProjDlg();
  });
}

function init(){
  ensureProjects();                 /* v2.49：先确定当前剧目，再按 pid 命名空间加载数据 */
  loadCfg();
  fillSettings();
  try{ $('novel').value = localStorage.getItem(pk('novel')) || ''; }catch(e){}
  bind();
  renderProjSel();                  /* v2.49：头部剧目下拉 */
  refreshAll();
  loadShots().then(function(){
    loadUndo();                        /* v2.31：镜头拉下来之后才能判断旧快照还作不作数 */
    loadRedo();                        /* v2.32：重做栈同样跨刷新保留 */
    return loadAssets();
  }).then(function(){
    restoreChapters();          /* 用已保存的小说正文重切章节，恢复勾选与进度 */
    refreshAll();
    if(!state.hasCloud) toast('当前是本地存储模式：数据只保存在这台设备的浏览器里');
    resetStuck();
    resumePolling();
    seedDemoAuto();   /* 内部自行判断：已 seed 过或已有数据则只落标记，不再注入 */
    scanLipRiskQuiet();
    batchLeftTip();   /* v2.16：上次批量没跑完的话，打开页面就告诉用户还剩多少 */
    if(hasCloud() && typeof db().onUpdated === 'function'){
      db().onUpdated(function(payload){
        var ids = (payload && payload.databaseIds) || [];
        var needAssets = ids.indexOf(ASSET_DB_ID) > -1;
        if(ids.length && ids.indexOf(DB_ID) === -1 && !needAssets) return;
        clearTimeout(window._updTm);
        window._updTm = setTimeout(function(){
          loadShots().then(function(){ return needAssets ? loadAssets() : null; }).then(refreshAll);
        }, 400);
      });
    }
  });
}
var _seeded = false;
function seedDemoAuto(){
  if(_seeded) return; _seeded = true;
  /* 已 seed 过、或本机已有数据（含从别处导入）→ 只落标记，不注入示例；
     标记保证用户日后清空数据、刷新页面时示例不再复活 */
  var already = false;
  try{ already = localStorage.getItem(LS+'seeded') === '1'; localStorage.setItem(LS+'seeded','1'); }catch(e){}
  if(already || state.shots.length) return;
  seedDemo();
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
