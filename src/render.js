/* ---------------- 渲染层（彼此不互调） ---------------- */
function renderSync(){
  var d = $('syncDot'), t = $('syncTxt');
  if(!d || !t) return;
  d.className = 'dot' + (state.syncing ? ' busy' : (state.online ? '' : ' off'));
  /* v2.31：批量跑的时候把进度写在这里（清空 / 撤销 / 导入动辄几十条，原来只有个转圈，用户不知道是卡了还是在跑） */
  t.textContent = state.syncing ? (state.syncMsg || '同步中…')
    : (state.online ? '已同步' : (state.hasCloud ? '离线模式' : '本地存储'));
  /* v2.32：有带 tag 的批量任务在跑才显示「停止」 */
  var sb = $('serialStop');
  if(sb) sb.hidden = !state.serialTag;
}
function renderToday(){
  var s = statOf();
  var grid = $('todayGrid');
  grid.innerHTML =
    '<div class="tbox blue"><div class="n">'+s.noImg+'</div><div class="l">待生成图片</div></div>' +
    '<div class="tbox blue"><div class="n">'+s.noVid+'</div><div class="l">待生成视频</div></div>' +
    (s.noAudio > 0
      ? '<div class="tbox" style="background:var(--warn-soft);border-color:#F5D9A0"><div class="n" style="color:#B46B00">'+s.noAudio+'</div><div class="l">待配音</div></div>'
      : '<div class="tbox"><div class="n">0</div><div class="l">待配音</div></div>') +
    (s.fail > 0
      ? '<div class="tbox red"><div class="n">'+s.fail+'</div><div class="l">失败待重试</div></div>'
      : '<div class="tbox"><div class="n">0</div><div class="l">失败待重试</div></div>') +
    '<div class="tbox green"><div class="n">'+s.done+'</div><div class="l">视频已完成</div></div>';
  var items = todoItems(), box = $('todoList');
  var pendingAssets = state.assets.filter(function(a){ return (a['状态'] || '未生成') !== '已完成'; });
  var html = '';
  $('updAt').textContent = '共 ' + s.total + ' 镜 · 预计成片 ' + fmtSec(s.seconds);
  /* v2.29：云端批量写入有失败项——改动已存本机但没写进云端，刷新（重拉云端）会丢，必须显式提醒 + 给重试入口 */
  if(state.bulkFail && state.bulkFail.length){
    html += '<div class="todo" style="background:#FDECEC;border-color:#F3B7B7">' +
      '<span class="bad" style="color:#B42318">未同步</span>' +
      '<span class="txt">有 ' + state.bulkFail.length + ' 条改动没写进云端（已存在本机）。现在重试，或先检查网络 / 数据表权限：</span>' +
      '<button class="btn sm" data-act="bulkretry">重试写入</button>' +
      '<button class="btn gh sm" data-act="bulkfailclear">忽略</button></div>';
  }
  /* v2.38：生成失败的清单卡——把「失败」从散在各镜卡里的错误信息，收成首页一条可点的账。
     四类全覆盖（v2.37 及以前配音 / 口型失败在首页完全看不到），给分组摘要 + 首个失败镜的原因，
     三个动作：全部重试 / 去看第一个 / 只看失败。 */
  var fg = failGroups();
  if(fg.length){
    var ffirst = fg[0].list[0];
    html += '<div class="todo" style="background:#FDECEC;border-color:#F3B7B7">' +
      '<span class="bad" style="color:#B42318">生成失败</span>' +
      '<span class="txt">' + esc(failBrief()) + '，共 ' + failCount() + ' 项、涉及 ' + failShots().length + ' 个镜头。' +
      '第一个：第 ' + esc(ffirst['镜号']) + ' 镜 ' + esc(fg[0].name) + esc(failWhyTxt(ffirst)) + '</span>' +
      '<button class="btn sm" data-act="failretry">全部重试</button>' +
      '<button class="btn gh sm" data-act="failjump">去看第一个</button>' +
      '<button class="btn gh sm" data-act="failfilter">只看失败</button></div>';
  }
  if(pendingAssets.length && state.shots.length){
    html += '<div class="todo" style="background:var(--warn-soft);border-color:#F5D9A0">' +
      '<span class="bad" style="color:#B46B00">一致性</span>' +
      '<span class="txt">还有 ' + pendingAssets.length + ' 张设定图没生成，先生成它们再出分镜图</span>' +
      '<button class="btn sm" data-act="goasset">去生成</button></div>';
  }
  /* v2.17：上次批量没跑完的剩余进度——首页给一处可见入口，点「去续跑」直接跳到对应镜头。
     v2.18：补「只跑剩余镜」——不重算列表，直接把存档里的剩余镜号投队列，口径与上次完全一致。
     v2.19：按类型分条，三类都有剩余时各出一张卡，互不挤占。 */
  var allLeft = batchLoadAll();
  ['img','vid','audio','lip'].forEach(function(lk){
    var lrec = allLeft[lk];
    if(!lrec || !lrec.ids || !lrec.ids.length) return;
    var leftTot = num(lrec.total) || lrec.ids.length;
    html += '<div class="todo" style="background:#EEF0FF;border-color:#DCD9FB">' +
      '<span class="bad" style="color:#5B5BD6">续跑</span>' +
      '<span class="txt">上次' + batchLeftName(lk) + '共 ' + leftTot + ' 个，还剩 ' + lrec.ids.length + ' 个没跑完（第 ' + esc(leftNosPreview(lrec.ids)) + ' 镜）</span>' +
      '<button class="btn sm" data-act="leftrun" data-kind="' + esc(lk) + '">只跑剩余镜</button>' +
      '<button class="btn gh sm" data-act="leftjump" data-kind="' + esc(lk) + '">去定位</button>' +
      '<button class="btn gh sm" data-act="leftsave" data-kind="' + esc(lk) + '">存为选区</button>' +
      '<button class="btn gh sm" data-act="leftlist" data-kind="' + esc(lk) + '">导出清单</button>' +
      '<button class="btn gh sm" data-act="leftclear" data-kind="' + esc(lk) + '">忽略</button></div>';
  });
  /* v2.22：生图与生视频都有剩余时，给一个「串跑」入口——先补图，出完图自动接着生视频，
     省掉「等图跑完 → 回来再点一次生视频」这一趟。
     v2.23：扩到「图 → 视频 → 配音」三段，且只要能凑够 2 类剩余就值得串（顺带把高风险镜对口型）。
     v2.24：步骤可自定义——在卡里勾选要跑的段（生图/生视频/配音/对口型），一键按选中顺序串跑。 */
  function hasLeftIds(lk){ return !!(allLeft[lk] && allLeft[lk].ids && allLeft[lk].ids.length); }
  var pipeKinds = ['img','vid','audio'].filter(hasLeftIds);
  var lipN = cfg.lipBase ? lipTodoShots().length : 0;
  var pipeSteps = [
    { k:'img',   on: hasLeftIds('img'),   n:'生图',   tip:'按剩余镜号补图' },
    { k:'vid',   on: hasLeftIds('vid'),   n:'生视频', tip:'按剩余镜号出视频' },
    { k:'audio', on: hasLeftIds('audio'), n:'配音',   tip:'按剩余镜号配音' },
    { k:'lip',   on: lipN > 0,            n:'对口型', tip:'高风险镜自动对口型' }
  ];
  var avail = pipeSteps.filter(function(s){ return s.on; });
  if(avail.length){
    var plabel = pipeKinds.map(function(k){ return batchLeftName(k) + ' ' + allLeft[k].ids.length + ' 个'; }).join(' → ');
    var pp = pipelinePick();
    var chips = pipeSteps.map(function(s){
      var sel = !!pp[s.k];
      return '<button class="btn ' + (sel ? '' : 'gh ') + 'sm" data-act="piptoggle" data-k="' + s.k + '" title="' + esc(s.tip) + (s.on ? '' : '（当前无剩余）') + '">' +
        (sel ? svgIc('check',13) + ' ' : '') + s.n + (s.on ? (' ' + (s.k === 'lip' ? lipN : allLeft[s.k].ids.length) + ' 个') : '') + '</button>';
    }).join('');
    html += '<div class="todo" style="background:#EEF0FF;border-color:#DCD9FB">' +
      '<span class="bad" style="color:#5B5BD6">流水线</span>' +
      '<span class="txt">还有 ' + (plabel || '0') + (lipN ? (' + 高风险镜对口型 ' + lipN + ' 个') : '') + ' 没跑完。勾选要跑的步骤，一键串起来跑完：</span>' +
      '<div class="tools" style="margin:6px 0 0;gap:8px">' + chips + '</div>' +
      '<div class="tools" style="margin:8px 0 0;gap:8px">' +
        '<button class="btn sm" data-act="pipeluncustom">运行选中流水线</button>' +
        (pipeKinds.length >= 2 ? '<button class="btn gh sm" data-act="piperesume">' + pipeKinds.map(batchLeftName).join('→') + ' 全串跑</button>' : '') +
      '</div></div>';
  }
  /* v2.25：候选图待挑选——批量生图开了 A/B 时，跑完一堆镜都有候选没挑。给一个「批量选最高分」入口，免得逐镜点面板。
     v2.26：再给一个「去挑」——把生成页筛成只看有候选待挑的镜，想手挑的人不用自己翻。 */
  var pendCand = state.shots.filter(function(s){ return Array.isArray(s._imgCand) && s._imgCand.length; }).length;
  if(pendCand){
    html += '<div class="todo" style="background:#EAF7EE;border-color:#BFE6CB">' +
      '<span class="bad" style="color:#1F7A3D">选优</span>' +
      '<span class="txt">有 ' + pendCand + ' 个镜头的候选图没挑（批量生图开了 A/B 时常见）。可按评分自动选最高分，也可以只挑这几个镜手选：</span>' +
      '<button class="btn sm" data-act="autopick">批量选最高分</button>' +
      '<button class="btn gh sm" data-act="filtercand">去挑（只看待选）</button></div>';
  }
  /* v2.20：关键字段体检——只有出现「硬性缺料」（缺画面描述 / 没时长 / 无生图提示词）时才弹卡，
     免得「没章节」这类软性提示天天占着首页让人麻木。明细与报告里两种都会列。 */
  var hIss = shotHealth(state.shots), hHard = healthHardCount(hIss);
  if(hHard){
    /* v2.26：能靠本地规则推定的缺料项（时长 / 章节 / 单角色）——有才显示「一键自动修复」 */
    var fixSum = healthFixSummary();
    var hs = healthSummary(hIss);
    html += '<div class="todo" style="background:#F5F6F8;border-color:#E3E5EC">' +
      '<span class="bad" style="color:#4B5563">体检</span>' +
      '<span class="txt">' + hIss.length + ' 个镜头缺关键字段：' +
      hs.order.slice(0, 3).map(function(k){ return k + ' ' + hs.byType[k]; }).join('、') +
      (hs.order.length > 3 ? ' 等' : '') + '（会拖累出图与成片）</span>' +
      '<button class="btn sm" data-act="hjump">去修第一个</button>' +
      (fixSum.total ? '<button class="btn gh sm" data-act="hfixall" title="可自动推定：' + esc(fixSum.txt) + '">一键自动修复(' + fixSum.total + ')</button>' : '') +
      '<button class="btn gh sm" data-act="hcheck">查看明细</button>' +
      '<button class="btn gh sm" data-act="hexp">导出报告</button></div>';
  }
  if(!items.length && !html){
    box.innerHTML = '<div class="hint">' +
      (s.total ? '所有镜头都已推进到位了，可以去「成片与导出」收尾。' : '还没有分镜。到「剧本拆镜」粘贴小说，点「AI 一键拆镜」开始。') + '</div>';
    return;
  }
  box.innerHTML = html + items.map(function(it){
      var label = batchLeftName(it.kind);   /* v2.41：跟批量取名表同一份，免得再加一类就用错文案 */
      return '<div class="todo"><span class="bad">第'+esc(it.no)+'镜</span><span class="txt">'+esc(it.text)+'</span>' +
        '<button class="btn sm" data-act="fixone" data-id="'+it.id+'" data-kind="'+it.kind+'">'+label+'</button></div>';
    }).join('');
}
function fmtSec(n){ var m = Math.floor(n/60), ss = n%60; return (m?m+'分':'') + ss + '秒'; }

function renderShotTable(){
  var box = $('shotTable');
  $('shotCountTxt').textContent = '共 ' + state.shots.length + ' 镜';
  if(!state.shots.length){
    box.innerHTML = '<div class="empty">还没有分镜。粘贴小说后点「AI 一键拆镜」，或点「+ 手动加一镜」。</div>';
    return;
  }
  box.innerHTML = state.shots.map(function(s){
    return '<div class="row" data-id="'+s._id+'">' +
      '<div class="c cell-no" data-l="镜号">'+esc(s['镜号'])+'</div>' +
      '<div class="c" data-l="画面描述"><input data-f="画面描述" value="'+esc(s['画面描述'])+'" placeholder="这一镜拍什么"></div>' +
      '<div class="c" data-l="运镜"><input data-f="运镜" value="'+esc(s['运镜'])+'" placeholder="缓慢推进"></div>' +
      '<div class="c" data-l="台词 / 旁白"><input data-f="台词旁白" value="'+esc(s['台词旁白'])+'" placeholder="台词 / 旁白"></div>' +
      '<div class="c" data-l="出场角色"><input data-f="出场角色" value="'+esc(s['出场角色'])+'" placeholder="林小满, 陈老师"></div>' +
      '<div class="c" data-l="场景"><input data-f="场景" value="'+esc(s['场景'])+'" placeholder="高三2班教室"></div>' +
      '<div class="c" data-l="时长(秒)"><input type="number" data-f="时长秒" value="'+esc(num(s['时长秒'])||5)+'"></div>' +
      '<div class="c" style="display:flex;gap:4px;align-items:center">' +
        '<button class="rowdel" data-act="up" data-id="'+s._id+'" title="上移（重排镜号）">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg></button>' +
        '<button class="rowdel" data-act="down" data-id="'+s._id+'" title="下移（重排镜号）">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>' +
        '<button class="rowdel" data-act="dup" data-id="'+s._id+'" title="复制此镜">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
        '<button class="rowdel" data-act="ins" data-id="'+s._id+'" title="在此镜后插入空镜">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' +
        '<button class="rowdel" data-act="openshot" data-id="'+s._id+'" title="去生成">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>' +
        '<button class="rowdel" data-act="del" data-id="'+s._id+'" title="删除">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '</div>';
  }).join('');
}

function anchorTags(s){
  var anc = anchorsForShot(s), out = '';
  splitNames(s['出场角色']).forEach(function(n){
    var a = assetByName(n, '角色');
    var cls = !a ? ' grey' : (a['参考图URL'] ? '' : ' warn');
    var tip = !a ? '无角色卡' : (a['参考图URL'] ? '已用定妆照' : '缺定妆照');
    out += '<span class="tag'+cls+'">'+esc(n)+' · '+tip+'</span>';
  });
  if(String(s['场景']||'').trim()){
    var sc = assetByName(s['场景'], '场景');
    var c2 = !sc ? ' grey' : (sc['参考图URL'] ? '' : ' warn');
    var t2 = !sc ? '无场景卡' : (sc['参考图URL'] ? '已用空景图' : '缺空景图');
    out += '<span class="tag'+c2+'">'+esc(s['场景'])+' · '+t2+'</span>';
  }
  out += '<span class="tag'+(anc.refs.length ? '' : ' warn')+'">本镜参考图 '+anc.refs.length+' 张</span>';
  return out;
}
function pillFor(st){
  st = st || '未生成';
  var cls = st === '已完成' ? 'ok' : (st === '失败' ? 'err' : (st === '生成中' || st === '排队中' ? 'run' : 'idle'));
  return '<span class="pill '+cls+'">'+esc(st)+'</span>';
}
function renderGenList(){
  var list = filteredShots(), box = $('genList');
  var ar = String(cfg.imgRatio || '9:16').replace(':', '/');   /* 媒体框跟随项目画幅，避免 16:9 项目被裁成竖条 */
  if(!list.length){
    box.innerHTML = '<div class="empty">没有符合当前筛选的镜头。</div>';
    return;
  }
  box.innerHTML = list.map(function(s){
    var open = !!state.expanded[s._id];
    var is = s['图片状态'] || '未生成', vs = s['视频状态'] || '未生成';
    var iu = s['图片URL'] || '', vu = s['口型视频URL'] || s['视频URL'] || '';
    var busy = !!state.busy[s._id];
    var aRaw = String(s['音频URL'] || '');
    var aUrl = (aRaw === 'local') ? audUrl(s._id) : aRaw;
    var auReady = !!aUrl;
    var aDur = num(s['音频时长']);
    var durTxt = (auReady && aDur > 0) ? ('语音 ' + aDur.toFixed(1) + ' 秒') : '';
    var warnSync = '';
    if(auReady && aDur > 0){
      var needSec = Math.ceil(aDur), curSec = num(s['时长秒']) || 5;
      if(needSec > curSec) warnSync = '语音比镜头长：建议把时长改成 ' + Math.min(12, needSec) + ' 秒或精简台词';
      else if(aDur > 0 && curSec - aDur > 2.5) warnSync = '镜头比语音长 ' + (curSec - aDur).toFixed(1) + ' 秒，成片会有空白';
    }
    var auHtml = aUrl ? '<audio src="'+esc(aUrl)+'" controls preload="metadata" style="width:100%;margin-top:8px"></audio>' : '';
    var locked = s['满意锁定'] === '是';
    var sizeOpts = ['远景','全景','中景','近景','特写','大特写'].map(function(o){
      return '<option' + (String(s['景别']||'中景') === o ? ' selected' : '') + '>' + o + '</option>';
    }).join('');
    var imgHtml = iu
      ? '<img src="'+esc(iu)+'" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
      : '<div class="ph">'+(is === '生成中' ? '<div class="spin"></div>生成中…' : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span>暂无图片</span>')+'</div>';
    var vidHtml = vu
      ? '<video src="'+esc(vu)+'" controls playsinline preload="metadata" style="background:#000"></video>'
      : '<div class="ph">'+((vs === '生成中' || vs === '排队中') ? '<div class="spin"></div>'+(vs === '排队中' ? '排队中…' : '生成中…') : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m23 7-7 5 7 5V7Z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg><span>暂无视频</span>')+'</div>';
    /* v2.53：原来只判图片 / 视频两类失败，配音 / 口型失败时「错误信息」明明有值却不显示，
       用户看不到「TTS 401 未授权」这类原因只能盲目重试。改用与失败卡同一份口径 failKindOf。 */
    var err = (s['错误信息'] && failKindOf(s)) ? '<div class="errmsg show">'+esc(s['错误信息'])+'</div>' : '';
    return '<div class="gen" data-id="'+s._id+'">' +
      '<div class="gen-hd" data-act="toggle" data-id="'+s._id+'">' +
        '<div class="no">'+esc(s['镜号'])+'</div>' +
        '<div class="ttl">'+esc(s['画面描述'] || '（未填写画面描述）')+'</div>' +
        pillFor(is) + pillFor(vs) + lipBadge(s) +
        (String(s['章节']||'').trim() ? '<span class="tag">'+esc(String(s['章节']).slice(0,14))+'</span>' : '') +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A90A6" stroke-width="2" style="transform:rotate('+(open?90:0)+'deg);transition:.2s"><path d="M9 18l6-6-6-6"/></svg>' +
      '</div>' +
      '<div class="gen-bd'+(open?'':' hide')+'">' +
        '<div>' +
          '<div class="row2">' +
            '<div class="fld"><div class="mini">出场角色（逗号分隔，要能匹配角色卡名称）</div><input class="inp" data-f="出场角色" value="'+esc(s['出场角色'])+'" placeholder="林小满, 陈老师"></div>' +
            '<div class="fld"><div class="mini">场景（要能匹配场景卡名称）</div><input class="inp" data-f="场景" value="'+esc(s['场景'])+'" placeholder="高三2班教室"></div>' +
          '</div>' +
          '<div class="tagrow">'+anchorTags(s)+'</div>' +
          '<div class="row3">' +
            '<div class="fld" style="margin:0"><div class="mini">景别（决定构图，别乱变）</div><select class="inp" data-f="景别">'+sizeOpts+'</select></div>' +
            '<div class="fld" style="margin:0"><div class="mini">说话角色（决定配音音色，留空=旁白）</div><input class="inp" data-f="说话角色" value="'+esc(s['说话角色'])+'" placeholder="林小满"></div>' +
            '<div class="fld" style="margin:0"><div class="mini">情绪 / 表演（同时喂给画面和配音）</div><input class="inp" data-f="角色情绪" value="'+esc(s['角色情绪'])+'" placeholder="紧张、强忍眼泪"></div>' +
          '</div>' +
          '<div class="fld"><div class="mini">画面描述（中文，给你自己看）</div><input class="inp" data-f="画面描述" value="'+esc(s['画面描述'])+'"></div>' +
          '<div class="fld"><div class="mini">图像生成提示词（英文效果更好，留空则用画面描述）</div><textarea class="inp" data-f="英文提示词" rows="3">'+esc(s['英文提示词'])+'</textarea></div>' +
          '<div class="row3">' +
            '<div class="fld"><div class="mini">运镜 / 动作</div><input class="inp" data-f="运镜" value="'+esc(s['运镜'])+'" placeholder="镜头缓慢推进"></div>' +
            '<div class="fld"><div class="mini">时长（秒）</div><input class="inp" type="number" data-f="时长秒" value="'+esc(num(s['时长秒'])||5)+'"></div>' +
            '<div class="fld"><div class="mini">光影 / 时间 / 天气</div><input class="inp" data-f="光影氛围" value="'+esc(s['光影氛围'])+'" placeholder="黄昏暖侧光，雨后微湿"></div>' +
          '</div>' +
          '<div class="fld"><div class="mini">台词 / 旁白（逐句格式：【情绪】角色名(OS)：台词；导出字幕与配音都会按句拆）</div><input class="inp" data-f="台词旁白" value="'+esc(s['台词旁白'])+'">' +
            '<div style="margin-top:4px"><button class="btn gh sm" data-act="cueedit" data-id="'+s._id+'">逐句编辑（说话人 / 类型 / 情绪 / 断句）</button></div></div>' +
          '<div class="fld"><div class="mini">本镜负向提示（可选，追加到全局负向词后）</div><input class="inp" data-f="负向提示" value="'+esc(s['负向提示'])+'" placeholder="如：no glasses, no smile"></div>' +
          '<div class="fld"><div class="mini">提示词调试（查看最终送给模型的完整提示词，可改写后生效）</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              '<button class="btn gh sm" data-act="showprompt" data-id="'+s._id+'">查看 / 改写提示词</button>' +
              (String(s['图片提示词覆盖'] || '').trim() ? '<span class="tag warn">生图提示词已改写</span><button class="btn gh sm" data-act="clrprompt" data-id="'+s._id+'">还原自动拼装</button>' : '') +
              (String(s['视频提示词覆盖'] || '').trim() ? '<span class="tag warn">生视频提示词已改写</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="fld"><div class="mini">配音（小米 MiMo TTS）</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              '<button class="btn sm" data-act="audio" data-id="'+s._id+'"'+(busy?' disabled':'')+'>'+(auReady ? '重新配音' : '生成配音')+'</button>' +
              pillFor(s['配音状态'] || '未生成') +
              (durTxt ? '<span class="hint">'+durTxt+'</span>' : '') +
              (warnSync ? '<span class="hint" style="color:#B46B00">'+warnSync+'</span>' : '') +
            '</div>' +
            auHtml +
          '</div>' +
          lipBoxHtml(s) +
          err +
        '</div>' +
        '<div class="medcol">' +
          '<div class="media" style="aspect-ratio:'+ar+'">'+imgHtml+'</div>' +
          '<div class="mbtns"><button class="btn sm" data-act="img" data-id="'+s._id+'"'+(busy?' disabled':'')+'>'+(iu ? '重新生图' : '生成图片')+'</button>' +
            '<button class="btn gh sm" data-act="imgcand" data-id="'+s._id+'"'+(busy?' disabled':'')+' title="一次生成多版候选图，弹出面板挑最满意的一版（候选数在设置里调）">A/B 选优</button>' +
            (Array.isArray(s._imgCand) && s._imgCand.length ? '<button class="btn gh sm" data-act="pickcand" data-id="'+s._id+'" title="还有 '+s._imgCand.length+' 张候选图没挑，点开继续选">选图('+s._imgCand.length+')</button>' : '') +
            '<button class="btn gh sm" data-act="viewimg" data-id="'+s._id+'"'+(iu?'':' disabled')+'>看大图</button>' +
            '<button class="btn gh sm" data-act="lock" data-id="'+s._id+'"'+(iu?'':' disabled')+' style="'+(locked?'color:#B46B00;border-color:#F5D9A0':'')+'">'+(locked? svgIc('star',13)+' 基准帧' : svgIc('starO',13)+' 标为满意')+'</button>' +
            (Array.isArray(s._imgHist) && s._imgHist.length ? '<button class="btn gh sm" data-act="rollimg" data-id="'+s._id+'" title="回退到上一版图片（当前图保留在历史里）">⇄ 上一版('+s._imgHist.length+')</button>' : '') +
            '</div>' +
          '<div class="media" style="aspect-ratio:'+ar+';margin-top:12px">'+vidHtml+'</div>' +
          (s._imgNewer && (s['视频URL'] || s['口型视频URL'])
            ? '<div class="hint" style="color:#B46B00;margin-top:4px">已换图：下方视频基于旧图生成，请点「重新生视频」让画面与新图一致。</div>'
            : '') +
          '<div class="mbtns"><button class="btn sm" data-act="vid" data-id="'+s._id+'"'+(busy || !iu ? ' disabled':'')+'>'+(vu ? '重新生视频' : '生成视频')+'</button>' +
            '<button class="btn gh sm" data-act="openvid" data-id="'+s._id+'"'+(vu?'':' disabled')+'>打开</button></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}
function assetCardHtml(a){
  var url = a['参考图URL'] || '', url2 = a['参考图2'] || '';
  var st = a['状态'] || '未生成';
  var isRole = a['类型'] === '角色';
  var mediaAr = isRole ? '3/4' : String(cfg.imgRatio || '9:16').replace(':', '/');
  var media = url
    ? '<img src="'+esc(url)+'" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
    : '<div class="ph">' + (st === '生成中'
        ? '<div class="spin"></div>生成中…'
        : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="7" r="4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/></svg><span>未生成设定图</span>') + '</div>';
  var sub = url2
    ? '<img class="asset-subthumb" src="'+esc(url2)+'" referrerpolicy="no-referrer" title="副视图" onerror="this.style.display=\'none\'">'
    : '';
  var roleExtra =
    '<div class="row3" style="margin-top:8px">' +
      '<div class="fld" style="margin:0"><div class="mini">性别 / 年龄</div><input class="inp" data-af="性别年龄" value="'+esc(a['性别年龄'])+'" placeholder="男 / 40 岁"></div>' +
      '<div class="fld" style="margin:0"><div class="mini">发型 / 发色</div><input class="inp" data-af="发型" value="'+esc(a['发型'])+'" placeholder="齐刘海黑色长直发"></div>' +
      '<div class="fld" style="margin:0"><div class="mini">性格 / 语气</div><input class="inp" data-af="性格语气" value="'+esc(a['性格语气'])+'" placeholder="严厉苛刻，说话带压迫感"></div>' +
    '</div>' +
    '<div class="row3" style="margin-top:8px">' +
      '<div class="fld" style="margin:0"><div class="mini">上装</div><input class="inp" data-af="上装" value="'+esc(a['上装'])+'" placeholder="白色校服衬衫"></div>' +
      '<div class="fld" style="margin:0"><div class="mini">下装</div><input class="inp" data-af="下装" value="'+esc(a['下装'])+'" placeholder="藏青色百褶裙"></div>' +
      '<div class="fld" style="margin:0"><div class="mini">配饰 / 标志道具</div><input class="inp" data-af="配饰道具" value="'+esc(a['配饰道具'])+'" placeholder="圆形细框眼镜，帆布书包"></div>' +
    '</div>' +
    '<div class="fld" style="margin-top:8px"><div class="mini">整体常服（防换装；留空则自动用「上装 + 下装 + 配饰」拼装）</div><input class="inp" data-af="常服" value="'+esc(a['常服'])+'" placeholder="白色校服衬衫配藏青百褶裙"></div>';
  var sceneExtra =
    '<div class="row2" style="margin-top:8px">' +
      '<div class="fld" style="margin:0"><div class="mini">时间 / 光线</div><input class="inp" data-af="性别年龄" value="'+esc(a['性别年龄'])+'" placeholder="下午，西侧窗光"></div>' +
      '<div class="fld" style="margin:0"><div class="mini">关键陈设（防布局漂移）</div><input class="inp" data-af="常服" value="'+esc(a['常服'])+'" placeholder="六排课桌、黑板在正前方"></div>' +
    '</div>';
  var ttsRow =
    '<div class="row3" style="margin-top:8px">' +
      '<div class="fld" style="margin:0"><div class="mini">TTS 音色</div><input class="inp" data-af="TTS音色" value="'+esc(a['TTS音色'])+'" placeholder="留空用默认 '+esc(cfg.ttsVoice)+'"></div>' +
      '<div class="fld" style="margin:0"><div class="mini">TTS 风格标签</div><input class="inp" data-af="TTS风格" value="'+esc(a['TTS风格'])+'" placeholder="冷静低沉 / 东北话 / 开心"></div>' +
      '<div class="fld" style="margin:0"><div class="mini">语速</div><input class="inp" data-af="语速" value="'+esc(a['语速'])+'" placeholder="偏慢 / 偏快"></div>' +
    '</div>';
    return '<div class="asset" data-id="'+a._id+'">' +
      '<div class="asset-media" style="aspect-ratio:'+mediaAr+'">'+media+sub+'</div>' +
      '<div class="asset-body">' +
        '<input class="nm" data-af="名称" value="'+esc(a['名称'])+'" placeholder="名称，如 林小满">' +
        '<div class="lb">中文描述</div>' +
        '<textarea class="ds" data-af="中文描述" placeholder="17 岁高中女生，齐刘海黑色长发，穿白色校服…">'+esc(a['中文描述'])+'</textarea>' +
        '<div class="lb">英文锚点（一致性的关键，越具体越好）</div>' +
        '<textarea class="en" data-af="英文锚点" placeholder="a 17-year-old Chinese high school girl, shoulder-length straight black hair with blunt bangs, wearing a white school shirt with navy collar...">'+esc(a['英文锚点'])+'</textarea>' +
        (isRole ? roleExtra : sceneExtra) +
        (isRole ? ttsRow : '') +
        '<div class="asset-ft">' + pillFor(st) +
          '<button class="btn sm" data-act="genasset" data-id="'+a._id+'">'+(url ? '重生成' : (isRole ? '生成定妆照' : '生成空景图'))+'</button>' +
          '<button class="btn gh sm" data-act="genasset2" data-id="'+a._id+'"'+(url ? '' : ' disabled')+'>' +
            (isRole ? (url2 ? '重生成面部特写' : '生成面部特写') : (url2 ? '重生成反打机位' : '生成反打机位')) + '</button>' +
          '<button class="btn gh sm" data-act="delasset" data-id="'+a._id+'">删除</button>' +
        '</div>' +
        (a['错误信息'] ? '<div class="errmsg show">'+esc(a['错误信息'])+'</div>' : '') +
      '</div>' +
    '</div>';
}
function renderAssets(){
  var roles = state.assets.filter(function(a){ return a['类型'] === '角色'; });
  var scenes = state.assets.filter(function(a){ return a['类型'] === '场景'; });
  $('roleList').innerHTML = roles.length
    ? roles.map(assetCardHtml).join('')
    : '<div class="asset-empty">还没有角色卡。点右上「+ 新增角色」，或先去拆镜再点「从分镜提取」。</div>';
  $('sceneList').innerHTML = scenes.length
    ? scenes.map(assetCardHtml).join('')
    : '<div class="asset-empty">还没有场景卡。点右上「+ 新增场景」，或先去拆镜再点「从分镜提取」。</div>';
}
/* 一致性体检：把「会导致漂移」的隐患全部列出来，每条都能一键处理 */
function renderAudit(){
  var box = $('auditBox');
  if(!box) return;
  var roles = state.assets.filter(function(a){ return a['类型'] === '角色'; });
  var scenes = state.assets.filter(function(a){ return a['类型'] === '场景'; });
  if(!state.shots.length){
    box.innerHTML = '<div class="hint">先拆出分镜，体检才有意义。</div>';
    return;
  }
  var issues = [];
  function add(lv, t, act, id, btn){
    issues.push({ lv:lv, t:t, act:act || '', id:id || '', btn:btn || '' });
  }
  roles.forEach(function(a){
    var nm = String(a['名称'] || '').trim() || '未命名角色';
    if(!a['参考图URL']) add('bad', '角色「' + nm + '」没有定妆照 —— 出图必然换脸', 'genasset', a._id, '生成定妆照');
    else if(cfg.multiView && !a['参考图2']) add('warn', '角色「' + nm + '」缺面部特写，脸部一致性打折', 'genasset2', a._id, '生成特写');
    if(!String(a['英文锚点'] || '').trim()) add('bad', '角色「' + nm + '」缺英文锚点，文字层面锁不住长相', 'aiAnchor', '', '');
    if(!String(a['常服'] || '').trim()) add('warn', '角色「' + nm + '」没写常服，容易每镜换装', '', '', '');
    if(!String(a['性格语气'] || '').trim()) add('warn', '角色「' + nm + '」没写性格语气，表演和配音会飘', '', '', '');
    if(!String(a['TTS音色'] || '').trim()) add('warn', '角色「' + nm + '」没绑定 TTS 音色，多角色会串声', '', '', '');
  });
  scenes.forEach(function(a){
    var nm = String(a['名称'] || '').trim() || '未命名场景';
    if(!a['参考图URL']) add('bad', '场景「' + nm + '」没有空景图 —— 布局必然变化', 'genasset', a._id, '生成空景图');
    else if(!a['参考图2']) add('warn', '场景「' + nm + '」缺反打机位，正反打镜头会不一致', 'genasset2', a._id, '生成反打');
    if(!String(a['英文锚点'] || '').trim()) add('bad', '场景「' + nm + '」缺英文锚点，布局锁不住', 'aiAnchor', '', '');
  });
  var missRole = 0, missScene = 0, noSize = 0, noAudio = 0, audioTotal = 0;
  state.shots.forEach(function(s){
    var anc = anchorsForShot(s);
    if(anc.missingRoles.length) missRole++;
    if(anc.missingScene) missScene++;
    if(!String(s['景别'] || '').trim()) noSize++;
    if(String(s['台词旁白'] || '').trim()){
      audioTotal++;
      if((s['配音状态'] || '未生成') !== '已完成') noAudio++;
    }
  });
  if(missRole) add('bad', missRole + ' 个镜头的「出场角色」对不上角色卡（名字必须完全一致），这些镜头等于裸生成', 'goasset', '', '去设定页');
  if(missScene) add('bad', missScene + ' 个镜头的「场景」对不上场景卡，场景会漂移', 'goasset', '', '去设定页');
  if(noSize) add('warn', noSize + ' 个镜头没设景别，构图会乱跳', '', '', '');
  if(noAudio) add('warn', noAudio + ' / ' + audioTotal + ' 条台词还没配音', 'batchAudio', '', '批量配音');

  var score = 100;
  issues.forEach(function(i){ score -= (i.lv === 'bad' ? 9 : 3.5); });
  score = Math.max(0, Math.min(100, Math.round(score)));
  var color = score >= 85 ? '#0B8F6A' : (score >= 60 ? '#B46B00' : '#EF4444');
  var html = '<div class="audit-score">一致性得分 <b style="color:' + color + ';font-size:17px">' + score + '</b> / 100' +
    ' · 角色 ' + roles.length + ' 个 · 场景 ' + scenes.length + ' 个 · 镜头 ' + state.shots.length + ' 镜' +
    (audioTotal ? ' · 配音 ' + (audioTotal - noAudio) + '/' + audioTotal : '') + '</div>';
  if(!issues.length){
    html += '<div class="audit-row"><span class="dotb" style="background:#10B981"></span><span class="t">全部检查通过，可以放心批量出图。</span></div>';
  }else{
    html += '<div class="audit">' + issues.map(function(i){
      var btn = '';
      if(i.act === 'genasset') btn = '<button class="btn sm" data-act="genasset" data-id="'+i.id+'">'+(i.btn||'去生成')+'</button>';
      else if(i.act === 'genasset2') btn = '<button class="btn sm" data-act="genasset2" data-id="'+i.id+'">'+(i.btn||'去生成')+'</button>';
      else if(i.act === 'goasset') btn = '<button class="btn gh sm" data-act="goasset">去设定页</button>';
      else if(i.act === 'aiAnchor') btn = '<button class="btn gh sm" data-act="aiAnchor">AI 补全</button>';
      else if(i.act === 'batchAudio') btn = '<button class="btn gh sm" data-act="batchAudio">批量配音</button>';
      return '<div class="audit-row ' + i.lv + '"><span class="dotb"></span><span class="t">' + esc(i.t) + '</span>' + btn + '</div>';
    }).join('') + '</div>';
  }
  box.innerHTML = html;
}
function renderTimeline(){
  var s = statOf();
  var ar = String(cfg.imgRatio || '9:16').replace(':', '/');
  $('filmTip').textContent = '共 ' + s.total + ' 镜 · 已完成 ' + s.done + ' 镜';
  var pct = s.total ? Math.round(s.done / s.total * 100) : 0;
  var R = 46, C = 2 * Math.PI * R;
  $('progBox').innerHTML =
    '<div class="ring"><svg width="120" height="120" viewBox="0 0 120 120">' +
      '<circle cx="60" cy="60" r="'+R+'" fill="none" stroke="#EDEFF6" stroke-width="12"/>' +
      '<circle cx="60" cy="60" r="'+R+'" fill="none" stroke="#5B5BD6" stroke-width="12" stroke-linecap="round" ' +
        'stroke-dasharray="'+C+'" stroke-dashoffset="'+(C * (1 - pct/100))+'" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="58" text-anchor="middle" font-size="24" font-weight="800" fill="#1B1D29">'+pct+'%</text>' +
      '<text x="60" y="76" text-anchor="middle" font-size="11" fill="#8A90A6">成片进度</text>' +
    '</svg></div>' +
    '<div class="stats">' +
      '<div class="st"><div class="n">'+s.total+'</div><div class="l">总镜头</div></div>' +
      '<div class="st"><div class="n" style="color:#10B981">'+s.done+'</div><div class="l">视频已完成</div></div>' +
      '<div class="st"><div class="n" style="color:'+(s.fail?'#EF4444':'#5B6076')+'">'+s.fail+'</div><div class="l">失败</div></div>' +
      '<div class="st"><div class="n">'+fmtSec(s.seconds)+'</div><div class="l">预计总时长</div></div>' +
      '<div class="st"><div class="n">'+fmtSec(s.doneSec)+'</div><div class="l">已产出时长</div></div>' +
      '<div class="st"><div class="n" style="color:'+(s.running?'#3B82F6':'#5B6076')+'">'+s.running+'</div><div class="l">进行中</div></div>' +
    '</div>' +
    '<div class="hint" style="width:100%;margin-top:10px">' + usageLine() + '</div>';
  var tl = $('timeline');
  if(!state.shots.length){ tl.innerHTML = '<div class="empty" style="width:100%">还没有镜头。</div>'; return; }
  tl.innerHTML = state.shots.map(function(s){
    var vu = s['口型视频URL'] || s['视频URL'] || '', iu = s['图片URL'] || '';
    var inner = vu ? '<video src="'+esc(vu)+'" preload="metadata" muted style="pointer-events:none"></video>'
      : (iu ? '<img src="'+esc(iu)+'" referrerpolicy="no-referrer">' : '<div class="ph">未生成</div>');
    var vs = s['视频状态'] || '未生成';
    var color = vs === '已完成' ? '#10B981' : (vs === '失败' ? '#EF4444' : ((vs==='生成中'||vs==='排队中') ? '#3B82F6' : '#C7CADA'));
    return '<div class="tl-item" title="'+esc(s['画面描述']||'')+'">' +
      '<div class="tl-thumb" style="border-color:'+color+';border-width:2px;aspect-ratio:'+ar+'">'+inner+'</div>' +
      '<div class="tl-no"><span>'+esc(s['镜号'])+'</span><span style="color:'+color+'">'+esc(vs)+'</span></div>' +
    '</div>';
  }).join('');
}
function fillSettings(){
  $('cf_agnesKey').value = cfg.agnesKey; $('cf_agnesBase').value = cfg.agnesBase; $('cf_agnesQuery').value = cfg.agnesQuery;
  $('cf_imgSize').value = cfg.imgSize; $('cf_imgRatio').value = cfg.imgRatio;
  $('cf_vidSec').value = cfg.vidSec; $('cf_vidRatio').value = cfg.vidRatio; $('cf_vidSize').value = cfg.vidSize;
  if($('cf_imgModel')) $('cf_imgModel').value = cfg.imgModel || 'agnes-image-2.5-flash';
  if($('cf_vidModel')) $('cf_vidModel').value = cfg.vidModel || 'agnes-video-2.5-flash';
  $('cf_ref').value = cfg.ref; $('cf_prefix').value = cfg.prefix;
  if($('cf_prevRef')) $('cf_prevRef').checked = !!cfg.prevRef;
  $('cf_textBase').value = cfg.textBase; $('cf_textKey').value = cfg.textKey; $('cf_textModel').value = cfg.textModel;
  if($('cf_refMode')) $('cf_refMode').value = cfg.refMode;
  if($('cf_refMax')) $('cf_refMax').value = String(cfg.refMax || 4);
  if($('cf_multiView')) $('cf_multiView').checked = !!cfg.multiView;
  if($('cf_neg')) $('cf_neg').value = cfg.neg;
  if($('cf_globalStyle')) $('cf_globalStyle').value = cfg.globalStyle || '';
  if($('cf_imgN')) $('cf_imgN').value = String(Math.min(3, Math.max(1, num(cfg.imgN) || 1)));
  if($('cf_srtCue')) $('cf_srtCue').checked = cfg.srtCue !== false;
  if($('cf_imgScore')) $('cf_imgScore').checked = cfg.imgScore !== false;
  if($('cf_ttsZip')) $('cf_ttsZip').checked = cfg.ttsZip !== false;
  if($('cf_cueAlign')) $('cf_cueAlign').checked = cfg.cueAlign !== false;
  if($('cf_imgCons')) $('cf_imgCons').checked = cfg.imgCons !== false;
  if($('cf_ttsConc')) $('cf_ttsConc').value = String(Math.min(3, Math.max(1, num(cfg.ttsConc) || 2)));
  if($('cf_trackZip')) $('cf_trackZip').checked = !!cfg.trackZip;
  if($('cf_imgSafe')) $('cf_imgSafe').checked = cfg.imgSafe !== false;
  if($('cf_imgSubj')) $('cf_imgSubj').checked = cfg.imgSubj !== false;
  if($('cf_genre')) $('cf_genre').value = GENRE_OPTS[cfg.genre] ? cfg.genre : 'auto';
  if($('cf_genrePrompt')) $('cf_genrePrompt').checked = cfg.genrePrompt !== false;
  if($('cf_batchCand')) $('cf_batchCand').checked = !!cfg.batchCand;
  if($('cf_cueTts')) $('cf_cueTts').checked = !!cfg.cueTts;
  if($('cf_ttsKey')) $('cf_ttsKey').value = cfg.ttsKey;
  if($('cf_ttsBase')) $('cf_ttsBase').value = cfg.ttsBase;
  if($('cf_ttsModel')) $('cf_ttsModel').value = cfg.ttsModel;
  if($('cf_ttsVoice')) $('cf_ttsVoice').value = cfg.ttsVoice;
  if($('cf_ttsNarr')) $('cf_ttsNarr').value = cfg.ttsNarr;
  if($('cf_ttsFormat')) $('cf_ttsFormat').value = cfg.ttsFormat;
  if($('cf_ttsSync')) $('cf_ttsSync').checked = !!cfg.ttsSync;
  if($('cf_cnRate')) $('cf_cnRate').value = num(cfg.cnRate) || 4.5;
  if($('cf_lipBase')) $('cf_lipBase').value = cfg.lipBase || '';
  if($('cf_lipKey')) $('cf_lipKey').value = cfg.lipKey || '';
  if($('cf_lipMode')) $('cf_lipMode').value = cfg.lipMode || 'get';
  if($('cf_lipAuto')) $('cf_lipAuto').checked = !!cfg.lipAuto;
  if($('pipeShots')) $('pipeShots').value = cfg.pipeShots || 6;
  if($('pipeBatch')) $('pipeBatch').value = cfg.pipeBatch || 0;
  if($('pipeChunk')) $('pipeChunk').value = cfg.pipeChunk || 3000;
  if($('cf_bgmUrl')) $('cf_bgmUrl').value = cfg.bgmUrl || '';
  if($('cf_agnesKeys')) $('cf_agnesKeys').value = cfg.agnesKeys || '';
  if($('cf_conc')) $('cf_conc').value = num(cfg.conc) || 1;
  if($('cf_retry')) $('cf_retry').value = num(cfg.retry);
  if($('cf_trans')) $('cf_trans').value = cfg.trans || 'fade';
  if($('cf_transDur')) $('cf_transDur').value = num(cfg.transDur);
  if($('cf_kb')) $('cf_kb').value = cfg.kb || 'in';
  if($('cf_fps')) $('cf_fps').value = num(cfg.fps) || 30;
  if($('cf_bitrate')) $('cf_bitrate').value = cfg.bitrate || '8M';
  if($('cf_subFont')) $('cf_subFont').value = cfg.subFont || 'Microsoft YaHei';
  if($('cf_subSize')) $('cf_subSize').value = num(cfg.subSize) || 14;
  if($('cf_subMargin')) $('cf_subMargin').value = num(cfg.subMargin) || 36;
  if($('cf_subColor')) $('cf_subColor').value = cfg.subColor || 'FFFFFF';
  if($('cf_subOutlineColor')) $('cf_subOutlineColor').value = cfg.subOutlineColor || '000000';
  if($('cf_subOutline')) $('cf_subOutline').value = num(cfg.subOutline);
  if($('cf_subBold')) $('cf_subBold').checked = !!cfg.subBold;
  if($('cf_subBg')) $('cf_subBg').checked = !!cfg.subBg;
  if($('cf_bgmVol')) $('cf_bgmVol').value = num(cfg.bgmVol);
  if($('cf_bgmFade')) $('cf_bgmFade').value = num(cfg.bgmFade);
  if($('cf_costImg')) $('cf_costImg').value = num(cfg.costImg);
  if($('cf_costVidSec')) $('cf_costVidSec').value = num(cfg.costVidSec);
  if($('cf_costTts')) $('cf_costTts').value = num(cfg.costTts);
  if($('cf_costLip')) $('cf_costLip').value = num(cfg.costLip);
  /* 只读回显，绝不能被 readSettings 覆盖 */
  if($('cf_usedImg')) $('cf_usedImg').value = num(cfg.usedImg);
  if($('cf_usedVidSec')) $('cf_usedVidSec').value = num(cfg.usedVidSec);
  if($('cf_usedTts')) $('cf_usedTts').value = num(cfg.usedTts);
  if($('cf_usedLip')) $('cf_usedLip').value = num(cfg.usedLip);
  if(typeof updGenreStyleHint === 'function') updGenreStyleHint();   /* v2.18：类型旁显示建议画风 */
  if(typeof renderGenrePresets === 'function') renderGenrePresets(); /* v2.20：套餐库列表也要跟着刷新 */
  if(typeof renderSubPreview === 'function') renderSubPreview();     /* v2.46：字幕样式实时预览先渲染一帧 */
}
function readSettings(){
  cfg.agnesKey = $('cf_agnesKey').value.trim();
  cfg.agnesBase = ($('cf_agnesBase').value.trim() || 'https://apihub.agnes-ai.com/v1').replace(/\/+$/,'');
  cfg.agnesQuery = ($('cf_agnesQuery').value.trim() || 'https://apihub.agnes-ai.com').replace(/\/+$/,'');
  cfg.imgSize = $('cf_imgSize').value; cfg.imgRatio = $('cf_imgRatio').value;
  cfg.vidSec = $('cf_vidSec').value; cfg.vidRatio = $('cf_vidRatio').value;
  if($('cf_imgModel')) cfg.imgModel = ($('cf_imgModel').value.trim() || 'agnes-image-2.5-flash');
  if($('cf_vidModel')) cfg.vidModel = ($('cf_vidModel').value.trim() || 'agnes-video-2.5-flash');
  cfg.ref = $('cf_ref').value.trim(); cfg.prefix = $('cf_prefix').value.trim();
  cfg.prevRef = !!($('cf_prevRef') && $('cf_prevRef').checked);
  cfg.textBase = ($('cf_textBase').value.trim() || 'https://api.openai.com/v1').replace(/\/+$/,'');
  cfg.textKey = $('cf_textKey').value.trim(); cfg.textModel = $('cf_textModel').value.trim();
  if($('cf_refMode')) cfg.refMode = $('cf_refMode').value;
  if($('cf_refMax')) cfg.refMax = num($('cf_refMax').value) || 4;
  if($('cf_multiView')) cfg.multiView = !!$('cf_multiView').checked;
  if($('cf_neg')) cfg.neg = $('cf_neg').value.trim();
  if($('cf_globalStyle')) cfg.globalStyle = $('cf_globalStyle').value.trim();
  if($('cf_imgN')) cfg.imgN = Math.min(3, Math.max(1, num($('cf_imgN').value) || 1));
  if($('cf_srtCue')) cfg.srtCue = !!$('cf_srtCue').checked;
  if($('cf_imgScore')) cfg.imgScore = !!$('cf_imgScore').checked;
  if($('cf_ttsZip')) cfg.ttsZip = !!$('cf_ttsZip').checked;
  if($('cf_cueAlign')) cfg.cueAlign = !!$('cf_cueAlign').checked;
  if($('cf_imgCons')) cfg.imgCons = !!$('cf_imgCons').checked;
  if($('cf_ttsConc')) cfg.ttsConc = Math.min(3, Math.max(1, num($('cf_ttsConc').value) || 2));
  if($('cf_trackZip')) cfg.trackZip = !!$('cf_trackZip').checked;
  if($('cf_imgSafe')) cfg.imgSafe = !!$('cf_imgSafe').checked;
  if($('cf_imgSubj')) cfg.imgSubj = !!$('cf_imgSubj').checked;
  if($('cf_genre')) cfg.genre = GENRE_OPTS[$('cf_genre').value] ? $('cf_genre').value : 'auto';
  if($('cf_genrePrompt')) cfg.genrePrompt = !!$('cf_genrePrompt').checked;
  if($('cf_batchCand')) cfg.batchCand = !!$('cf_batchCand').checked;
  if($('cf_cueTts')) cfg.cueTts = !!$('cf_cueTts').checked;
  if($('cf_ttsKey')) cfg.ttsKey = $('cf_ttsKey').value.trim();
  if($('cf_ttsBase')) cfg.ttsBase = ($('cf_ttsBase').value.trim() || 'https://api.xiaomimimo.com/v1').replace(/\/+$/,'');
  if($('cf_ttsModel')) cfg.ttsModel = $('cf_ttsModel').value;
  if($('cf_ttsVoice')) cfg.ttsVoice = $('cf_ttsVoice').value;
  if($('cf_ttsNarr')) cfg.ttsNarr = $('cf_ttsNarr').value;
  if($('cf_ttsFormat')) cfg.ttsFormat = $('cf_ttsFormat').value;
  if($('cf_ttsSync')) cfg.ttsSync = !!$('cf_ttsSync').checked;
  /* v2.56：TTS 音色软校验——官方只接受预置 ID，手填中文名会触发 HTTP 400。
     不拦截保存（避免误伤未来新增的合法 ID），仅在「非空且非法」时 toast 提醒；
     voicedesign 模型不发送音色参数，无需校验。 */
  if(cfg.ttsModel.indexOf('voicedesign') === -1){
    if(cfg.ttsVoice && !ttsVoiceOk(cfg.ttsVoice)) toast('旁白音色「'+cfg.ttsVoice+'」不是小米预置音色 ID，配音可能报 400；合法值：'+TTS_VOICES.join('/'));
    if(cfg.ttsNarr && !ttsVoiceOk(cfg.ttsNarr)) toast('角色音色「'+cfg.ttsNarr+'」不是小米预置音色 ID，配音可能报 400；合法值：'+TTS_VOICES.join('/'));
  }
  if($('cf_cnRate')) cfg.cnRate = Math.max(2, Math.min(8, num($('cf_cnRate').value) || 4.5));
  if($('cf_lipBase')) cfg.lipBase = ($('cf_lipBase').value.trim() || '').replace(/\/+$/,'');
  if($('cf_lipKey')) cfg.lipKey = $('cf_lipKey').value.trim();
  if($('cf_lipMode')) cfg.lipMode = $('cf_lipMode').value;
  if($('cf_lipAuto')) cfg.lipAuto = !!$('cf_lipAuto').checked;
  if($('cf_bgmUrl')) cfg.bgmUrl = $('cf_bgmUrl').value.trim();
  if($('cf_agnesKeys')) cfg.agnesKeys = $('cf_agnesKeys').value.trim();
  if($('cf_conc')) cfg.conc = Math.max(1, Math.min(8, num($('cf_conc').value) || 1));
  if($('cf_retry')) cfg.retry = Math.max(0, Math.min(3, num($('cf_retry').value)));
  if($('cf_trans')) cfg.trans = $('cf_trans').value;
  if($('cf_transDur')) cfg.transDur = Math.max(0, Math.min(2, num($('cf_transDur').value)));
  if($('cf_kb')) cfg.kb = $('cf_kb').value;
  if($('cf_fps')) cfg.fps = Math.max(24, Math.min(60, num($('cf_fps').value) || 30));
  if($('cf_bitrate')) cfg.bitrate = $('cf_bitrate').value.trim() || '8M';
  if($('cf_subFont')) cfg.subFont = $('cf_subFont').value.trim() || 'Microsoft YaHei';
  if($('cf_subSize')) cfg.subSize = Math.max(8, Math.min(48, num($('cf_subSize').value) || 14));
  if($('cf_subMargin')) cfg.subMargin = Math.max(0, Math.min(200, num($('cf_subMargin').value)));
  if($('cf_subColor')) cfg.subColor = ($('cf_subColor').value.trim() || 'FFFFFF').replace(/^#/, '').toUpperCase();
  if($('cf_subOutlineColor')) cfg.subOutlineColor = ($('cf_subOutlineColor').value.trim() || '000000').replace(/^#/, '').toUpperCase();
  if($('cf_subOutline')) cfg.subOutline = Math.max(0, Math.min(6, num($('cf_subOutline').value)));
  if($('cf_subBold')) cfg.subBold = !!($('cf_subBold').checked);
  if($('cf_subBg')) cfg.subBg = !!($('cf_subBg').checked);
  if($('cf_bgmVol')) cfg.bgmVol = Math.min(1, Math.max(0, num($('cf_bgmVol').value)));
  if($('cf_bgmFade')) cfg.bgmFade = Math.min(10, Math.max(0, num($('cf_bgmFade').value)));
  if($('cf_costImg')) cfg.costImg = Math.max(0, num($('cf_costImg').value));
  if($('cf_costVidSec')) cfg.costVidSec = Math.max(0, num($('cf_costVidSec').value));
  if($('cf_costTts')) cfg.costTts = Math.max(0, num($('cf_costTts').value));
  if($('cf_costLip')) cfg.costLip = Math.max(0, num($('cf_costLip').value));
  if($('cf_budgetCap')) cfg.budgetCap = Math.max(0, num($('cf_budgetCap').value));   /* v2.47：预算上限读取 */
  saveCfg();
}
/* ---- 统一刷新入口：唯一允许调用多个渲染函数的地方 ---- */
function refreshAll(){
  renderSync();
  renderToday();
  renderShotTable();
  renderGenList();
  renderAssets();
  renderAudit();
  renderChapters();
  renderLipTip();
  renderTimeline();
  renderUndoBtns();                  /* v2.34：撤销 / 重做按钮的可用态 */
  renderUndoHist();                  /* v2.39：撤销栈的「历史」面板 */
  renderRetryBtn();                  /* v2.37：失败镜数量实时显示在「重试失败项」上 */
  if(!budgetExceeded()) hideBudgetBanner();   /* v2.47：预算没超就收起横幅（超额由生成事件弹） */
}
/* v2.38：失败的判定只此一处——图片 / 视频 / 配音 / 口型**四类都要认**。
   v2.37 及以前只认图片与视频，于是「配音失败」「口型失败」在首页完全不可见：
   顶部计数不涨、没有任何一键重试入口，只有批量条还弹着的那一会儿能点到「重试失败」，
   条一关就再也没地方找它们了（只能一镜一镜翻镜卡）。 */
var FAIL_KINDS = [
  { k:'img',   name:'分镜图', key:'图片状态' },
  { k:'vid',   name:'视频',   key:'视频状态' },
  { k:'audio', name:'配音',   key:'配音状态' },
  { k:'lip',   name:'口型',   key:'口型状态' }
];
/* 按类型分组的失败清单（只保留非空组），顺序即重跑顺序：图 → 视频 → 配音 → 口型 */
function failGroups(){
  var out = [];
  FAIL_KINDS.forEach(function(f){
    var list = state.shots.filter(function(s){ return s[f.key] === '失败'; });
    if(list.length) out.push({ k:f.k, name:f.name, key:f.key, list:list });
  });
  return out;
}
/* v2.41：这一镜「第一个失败的类型」（按 图 → 视频 → 配音 → 口型 取第一个）。
   首页待办列表里一镜只写一行，所以要有先后；用同一份 FAIL_KINDS 保证与失败卡 / 筛选口径一致。 */
function failKindOf(s){
  if(!s) return null;
  for(var i = 0; i < FAIL_KINDS.length; i++){
    if(s[FAIL_KINDS[i].key] === '失败') return FAIL_KINDS[i];
  }
  return null;
}
/* 涉及失败的镜头（四类去重）——重试名单、按钮数字、顶部计数共用这一份口径 */
function failShots(){
  var ids = {}, out = [];
  failGroups().forEach(function(g){
    g.list.forEach(function(s){ if(!ids[s._id]){ ids[s._id] = 1; out.push(s); } });
  });
  return out;
}
/* 按「项」算（同一镜图片与配音都失败算两项），与分组明细逐条对得上 */
function failCount(){ return failGroups().reduce(function(a, g){ return a + g.list.length; }, 0); }
/* 「分镜图 2、配音 1」这样的分组摘要，用于首页卡与确认框 */
function failBrief(){ return failGroups().map(function(g){ return g.name + ' ' + g.list.length; }).join('、'); }
function failWhyTxt(s){
  var m = String(s && s['错误信息'] || '').replace(/\s+/g, ' ').trim();
  return m ? ('（' + m.slice(0, 36) + (m.length > 36 ? '…' : '') + '）') : '';
}
/* v2.37：「重试失败项」原来永远是干点（有没有失败都一个样，点了才知道）。
   现在把当前失败数写在按钮上、没有失败就置灰，跟撤销 / 重做按钮同一个口径。 */
function renderRetryBtn(){
  var b = $('btnRetryFail'); if(!b) return;
  var n = failShots().length;
  b.disabled = !n;
  b.textContent = n ? ('重试失败项 (' + n + ')') : '重试失败项';
  b.title = n ? ('重试 ' + failBrief() + '，共 ' + failCount() + ' 项、涉及 ' + n + ' 个镜头（按镜卡状态实时统计）')
              : '当前没有失败的镜头';
}
/* v2.34：撤销 / 重做按钮原来永远是可点状态（点了才知道「没有可撤销的操作」），
   现在按栈里剩几步置灰，并把步数写进 title——尤其是刚跨刷新恢复出来的栈，用户根本看不出来有货。 */
function renderUndoBtns(){
  var u = (state.undo && state.undo.length) || 0, r = (state.redo && state.redo.length) || 0;
  document.querySelectorAll('[data-act="undo"]').forEach(function(b){
    b.disabled = !u;
    b.title = u ? ('撤销上一次分镜改动（Ctrl+Z）· 还可撤销 ' + u + ' 步') : '没有可撤销的操作';
  });
  document.querySelectorAll('[data-act="redo"]').forEach(function(b){
    b.disabled = !r;
    b.title = r ? ('重做刚撤销的那一步（Ctrl+Shift+Z）· 可重做 ' + r + ' 步') : '没有可重做的操作';
  });
  /* v2.39：「历史」也要跟撤销按钮一起置灰——没有历史版本时它点开只会是一片空 */
  document.querySelectorAll('[data-act="undohist"]').forEach(function(b){
    b.disabled = !u;
    b.title = u ? ('一次退回好几步：栈里还留着 ' + u + ' 版（列表按「几步前 + 那时多少镜」认）') : '还没有可回到的历史版本';
  });
}

