/* ================= 长篇流水线 ================= */
/* 章节识别：优先「第 X 章 / 第X章 / Chapter N / # 标题」，否则按字数切段 */
var CHAPTER_RE = /(^|\n)[ \t]*(第[ \t]*[0-9零一二三四五六七八九十百千两]+[ \t]*[章节回卷篇][^\n]{0,40}|chapter[ \t]*\d+[^\n]{0,40}|#{1,3}[ \t]*\S[^\n]{0,40})/gi;
function parseChapters(text, chunk){
  var t = String(text || '');
  if(!t.trim()) return [];
  var marks = [], m;
  CHAPTER_RE.lastIndex = 0;
  while((m = CHAPTER_RE.exec(t)) !== null){
    marks.push({ idx: m.index + (m[1] ? m[1].length : 0), title: m[0].replace(/^[\s#]+/,'').trim().slice(0, 46) });
  }
  if(marks.length < 2){
    /* 没有可用标题 → 按字数切段 */
    var out = [], size = Math.max(500, num(chunk) || 3000), n = 0;
    for(var i = 0; i < t.length; i += size){
      var seg = t.slice(i, i + size);
      if(!seg.trim()) continue;
      n++;
      out.push({ no: n, title: (marks.length === 1 && n === 1) ? marks[0].title : ('第 ' + n + ' 段'), text: seg, len: seg.length });
    }
    return out;
  }
  var res = [];
  if(marks[0].idx > 200) res.push({ no: 0, title: '引子', text: t.slice(0, marks[0].idx), len: marks[0].idx });
  for(var k = 0; k < marks.length; k++){
    var start = marks[k].idx;
    var end = (k + 1 < marks.length) ? marks[k + 1].idx : t.length;
    var body = t.slice(start, end);
    if(!body.trim()) continue;
    res.push({ no: res.length + 1, title: marks[k].title, text: body, len: body.length });
  }
  return res;
}
function chaptersOf(){
  return parseChapters($('novel').value, num($('pipeChunk').value) || 3000);
}
function onParseChapters(){
  var list = chaptersOf();
  if(!list.length){ toast('先在下面粘贴小说正文，或点「导入 .txt」'); return; }
  var oldSel = {};
  state.chapters.forEach(function(c){ oldSel[c.title] = c; });
  state.chapters = list.map(function(c){
    var o = oldSel[c.title];
    /* 章节文本没变（len 相同）才保留旧剧本化结果，文本变过就弃用，避免拿旧剧本拆新文 */
    return { no: c.no, title: c.title, len: c.len, text: c.text, sel: o ? o.sel : true, st: o ? o.st : '', adapted: (o && o.len === c.len) ? (o.adapted || '') : '' };
  });
  saveChapters(); renderChapters();
  var kw = Math.round(list.reduce(function(a, c){ return a + c.len; }, 0) / 1000);
  toast('识别到 ' + list.length + ' 个章节，共约 ' + kw + ' 千字');
}
var _chsSlimWarn = 0;
/* v2.53：章节状态（含 AI 剧本化结果 adapted）以前是静默写入，
   而 adapted 每章几千字、几十章就足以撑爆配额——存不下却一声不响，
   用户刷新后「章节进度 + 花钱跑出来的剧本」一起消失，还以为是软件坏了。
   现在分两级降级：先试完整存；存不下就丢掉 adapted 保住进度（剧本可重跑，进度丢了要重来）；
   连精简版都存不下才报错，且每轮只提示一次（流水线每章都会调它，别刷屏）。 */
function saveChapters(){
  var full = state.chapters.map(function(c){
    /* adapted（AI 剧本化结果）必须持久化，否则刷新后全部丢失、流水线会退回原文拆镜 */
    return { no: c.no, title: c.title, len: c.len, sel: c.sel, st: c.st, adapted: c.adapted || '' };
  });
  if(lsSet(pk('chs'), JSON.stringify(full), { warn:false })) return;
  var slim = state.chapters.map(function(c){
    return { no: c.no, title: c.title, len: c.len, sel: c.sel, st: c.st, adapted: '' };
  });
  if(lsSet(pk('chs'), JSON.stringify(slim), { warn:false })){
    if(!_chsSlimWarn){ _chsSlimWarn = 1; toast('本机空间不足：已保住章节进度，但 AI 剧本化结果没能存下（可重跑剧本化）'); }
    return;
  }
  lsSet(pk('chs'), JSON.stringify(slim),
    { warn:true, msg:'章节进度保存失败（存储已满）：刷新后章节状态会丢失，请先导出备份' });
}
/* 正文体积大不进 localStorage，页面重开时用已保存的小说正文重新切一次再对上状态 */
function restoreChapters(){
  try{
    var raw = localStorage.getItem(pk('chs'));
    if(!raw) return;
    var meta = JSON.parse(raw);
    var texts = chaptersOf();
    if(!texts.length) return;
    var byTitle = {}, byNo = {};
    texts.forEach(function(t){ byTitle[t.title] = t; byNo[t.no] = t; });
    state.chapters = meta.map(function(m){
      var t = byTitle[m.title] || byNo[m.no];
      return { no: m.no, title: m.title, len: m.len, text: t ? t.text : '', sel: !!m.sel, st: m.st || '', adapted: m.adapted || '' };
    });
  }catch(e){}
}
function renderChapters(){
  var box = $('chapterList');
  if(!box) return;
  if(!state.chapters.length){
    box.innerHTML = '<div class="hint" style="padding:14px">还没有章节。在下面粘贴小说正文后点「识别章节」。</div>';
    return;
  }
  /* v2.36：顶部先给一句汇总——「部分完成 / 失败」现在会如实打标，但混在长列表里不好找 */
  var doneN = 0, badN = 0, leftN = 0;
  state.chapters.forEach(function(c){
    if(c.st === '完成') doneN++;
    else if(c.sel){
      if(c.st && c.st.indexOf('失败') === 0) badN++;
      else if(c.st && c.st.indexOf('部分完成') === 0) leftN++;
    }
  });
  var sum = '<div class="hint" style="padding:8px 14px 2px">共 ' + state.chapters.length + ' 章 · 已完成 ' + doneN +
    (badN ? ' · <b style="color:#B3261E">失败 ' + badN + '</b>' : '') +
    (leftN ? ' · <b style="color:#B46B00">部分完成 ' + leftN + '</b>' : '') +
    ((badN || leftN) ? '（点「开始流水线」只会重跑这些有问题的章）' : '') + '</div>';
  box.innerHTML = sum + state.chapters.map(function(c, i){
    var cls = 'ch' + (c.sel ? ' sel' : '') + (c.st === '完成' ? ' done' : '') + (c.st === '进行中' ? ' on' : '');
    var stCls = c.st === '完成' ? ' ok'
      : (c.st && c.st.indexOf('失败') === 0 ? ' bad'
      : (c.st && c.st.indexOf('部分完成') === 0 ? ' warn' : (c.st === '进行中' ? ' run' : '')));
    return '<div class="'+cls+'" data-ch="'+i+'" style="flex-wrap:wrap">' +
      '<input type="checkbox" '+(c.sel ? 'checked' : '')+' data-chsel="'+i+'">' +
      '<span class="no">'+esc(c.no)+'</span>' +
      '<span class="t">'+esc(c.title)+'</span>' +
      '<span class="n">'+Math.max(1, Math.round(c.len / 1000))+'k字</span>' +
      (c.adapted ? '<span class="tag" style="font-size:11px;color:#B46B00;background:#FDF6E7;border:1px solid #F5D9A0;border-radius:8px;padding:1px 8px">已剧本化</span>' : '') +
      (c.st ? '<span class="st'+stCls+'">'+esc(c.st)+'</span>' : '') +
      '<span style="flex:1"></span>' +
      '<button class="btn gh sm" data-chact="adapt" title="AI 改写成对白化、强钩子的短剧剧本，拆镜更准">'+(c.adapted ? '重新剧本化' : 'AI 剧本化')+'</button>' +
      (c.adapted ? '<button class="btn gh sm" data-chact="restore" title="弃用剧本，改用小说原文拆镜">用原文</button>' : '') +
      '</div>';
  }).join('');
}
function setPipeBar(p){ var b = $('pipeBar'); if(b) b.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; }
function pipeTip(t){ var b = $('pipeTip'); if(b) b.textContent = t || ''; }
function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
/* 等某个字段变成终态（视频 / 口型是异步轮询的，必须等才能接着跑） */
function waitShot(id, field, maxMs){
  var t0 = Date.now();
  return new Promise(function(resolve){
    var h = setInterval(function(){
      var s = shotById(id), st = s ? s[field] : null;
      if(st === '已完成' || st === '失败' || st === '不需要' || (Date.now() - t0) > (maxMs || 240000)){
        clearInterval(h); resolve();
      }
    }, 2000);
  });
}
/* 已有的角色 / 场景名：拆第 2 章之后必须强制复用，否则名字必然漂移 */
function glossary(){
  var roles = [], scenes = [];
  state.assets.forEach(function(a){
    var nm = String(a['名称'] || '').trim(); if(!nm) return;
    if(a['类型'] === '角色') roles.push(nm); else scenes.push(nm);
  });
  return { roles: roles, scenes: scenes };
}
/* 拆镜提示词：单章与长篇流水线共用（跨章词表 + 口型规避都在这里） */
function buildSplitSys(n, sec, style){
  var g = glossary();
  return '你是一位专业的短剧分镜导演。请把用户给的小说章节拆成 ' + n + ' 个分镜，每个分镜约 ' + sec + ' 秒。' +
    (style ? '题材与画风：' + style + '。' : '') +
    '【全局一致性 —— 最重要】' +
    (g.roles.length ? '本剧已确定的角色名单：' + g.roles.join('、') + '。出场的必须是名单里的名字，一个字都不能改，禁止写同义名、简称、加前缀。' : '') +
    (g.scenes.length ? '本剧已确定的场景名单：' + g.scenes.join('、') + '。地点名必须完全复用。' : '') +
    '只有当本章确实出现名单之外的新角色 / 新地点时才允许新增，且必须给出正式统一名称（不要「那个男人」「教室里」这类含糊称呼）。' +
    '【其它要求】1) 同一地点所有镜头 location 字符串完全一致；2) 同一人物名字完全一致；' +
    '3) prompt 只写构图、动作、环境、光影、镜头语言，不要写角色外貌和服装（由系统从角色卡注入，写了会冲突）；' +
    '4) shot_size 必须是「远景/全景/中景/近景/特写/大特写」之一，按叙事节奏分布，不要连续多镜同景别；' +
    '5) speaker 写这句台词谁说的，必须是 characters 里的名字之一；纯旁白或无人说话填「旁白」；' +
    '6) emotion 写这一镜人物情绪与表演（8-16 字中文），会同时喂给画面和配音；' +
    '10) line 必须写成逐句结构化格式（系统会按它拆字幕、分角色配音）：一句一行，多句用 \\n 分隔；' +
        '对白写「角色名：台词」，旁白写「旁白：台词」或直接写正文，画外音写「角色名(OS)：台词」，内心独白写「角色名(VO)：台词」；' +
        '需要情绪时在最前面加「【情绪】」，如「【强忍眼泪】林小满：老师，我真不是故意的。」；' +
        '单句尽量不超过 20 字，太长了就断成两句（换行），不要把一整段塞进一个 line；' +
    '7) 重要：承载台词的镜头尽量用「过肩、侧脸、背身、听者反应、手部或物件特写、远景」，尽量少用正面口部特写 —— AI 视频对不上嘴型；' +
    '8) lighting 写这一镜的光影 / 时间 / 天气（6-16 字中文，如「黄昏暖侧光，雨后微湿」「深夜，冷白顶光」），同一时段同一地点的镜头要保持一致，会同时喂给画面和视频；' +
    '9) 只输出严格 JSON 数组，不要解释文字，不要代码块围栏。格式：' +
    '[{"shot":1,"location":"场景名","characters":["角色名"],"shot_size":"中景","speaker":"角色名或旁白","emotion":"紧张，攥紧书包带","scene":"中文画面描述","prompt":"英文图像生成提示词","camera":"运镜","line":"【强忍眼泪】林小满：老师，我真不是故意的。\\n旁白：走廊尽头传来脚步声。","lighting":"黄昏暖侧光","seconds":' + sec + '}]';
}
/* 章节剧本化（对标火宝 script_rewriter）：小说正文 → 对白化、强钩子、紧凑节奏的短剧剧本。
   改写结果存 c.adapted，拆镜优先用它；「用原文」随时可还原。 */
function adaptChapter(c){
  if(!cfg.textKey || !cfg.textModel){ toast('请先在设置里配置文本模型'); openDrawer(); return Promise.resolve(false); }
  var g = glossary();
  var sys = '你是一位爆款短剧编剧。请把用户给的章节正文改写成「短剧剧本」，供后续拆镜使用：' +
    '1) 以对白和动作为主，删减大段环境与心理描写，浓缩成短句动作与台词；' +
    '2) 开头三句内必须抛出钩子（冲突 / 反转 / 悬念），节奏紧凑，不留废戏；' +
    '3) 台词口语化、带情绪与潜台词，人物名必须与原文名字完全一致' +
    (g.roles.length ? '（已确定角色名单：' + g.roles.join('、') + '，不得新增同义称呼）' : '') + '；' +
    '4) 保留原章节全部关键情节与因果，不得改动设定、不得提前揭晓伏笔；' +
    '5) 场景切换时用「【场景】」单独一行标注地点；6) 台词写成可逐句解析的格式：对白写「角色名：台词」，旁白直接写，' +
    '画外音写「角色名(OS)：台词」，内心独白写「角色名(VO)：台词」，一句一行、单句不超过 20 字（长了就断成两句）；' +
    '7) 只输出改写后的纯文本剧本，不要解释、不要标题前缀、不要代码块。';
  toast('「' + c.title + '」剧本化中…');
  return apiPost(cfg.textBase.replace(/\/+$/, '') + '/chat/completions', cfg.textKey, {
    model: cfg.textModel,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: '章节标题：' + c.title + '\n\n正文：\n' + String(c.text || '').slice(0, 20000) }
    ],
    temperature: 0.8
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 160));
    var content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if(!content || !String(content).trim()) throw new Error('模型没有返回内容：' + r.text.slice(0, 160));
    c.adapted = String(content).trim();
    saveChapters(); renderChapters();
    toast('「' + c.title + '」剧本化完成，拆镜将使用剧本');
    return true;
  }).catch(function(e){
    console.error(e);
    toast('剧本化失败：' + guessCorsMsg(e).slice(0, 160));
    return false;
  });
}
/* 拆一章：返回写入的分镜数 */
function splitChapter(c, n){
  var sec = num($('shotSec').value) || 5, style = $('shotStyle').value.trim();
  var sys = buildSplitSys(n, sec, style);
  return apiPost(cfg.textBase.replace(/\/+$/, '') + '/chat/completions', cfg.textKey, {
    model: cfg.textModel,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: '章节标题：' + c.title + '\n\n正文：\n' + String(c.adapted || c.text || '').slice(0, 20000) }
    ],
    temperature: 0.7
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 160));
    var content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if(!content) throw new Error('模型没有返回内容：' + r.text.slice(0, 160));
    var arr = parseShotArray(content);
    if(!arr.length) throw new Error('没能解析出分镜数组：' + String(content).slice(0, 200));
    var maxNo = 0;
    state.shots.forEach(function(s){ maxNo = Math.max(maxNo, num(s['镜号'])); });
    var objs = arr.map(function(it, i){
      var o = splitShotObj(it, sec);
      o['镜号'] = maxNo + i + 1;
      o['章节'] = c.title;
      o['章节序号'] = c.no;
      o['口型风险'] = lipRiskOf(o);
      o['口型状态'] = '不需要';
      return o;
    });
    var p = db();
    if(!p){
      objs.forEach(function(o){ state.shots.push(Object.assign({ _id: newId() }, o)); });
      localSave(state.shots);
      return objs.length;
    }
    /* v2.30：改 runSerial——原来一条失败整链断且对外谎报「全部成功」（固定返回 objs.length） */
    return runSerial(objs.map(function(o){
      return function(){ return p.addRecord({ databaseId: DB_ID, properties: toProps(o) }); };
    }), { label: '写入分镜', tag: 'add' }).then(function(r){
      if(r.fail) toast('新增未完成：成功 ' + r.ok + ' 镜、失败 ' + r.fail + ' 镜');
      return r.ok;
    });
  });
}
/* v2.36：自愈「假死在生成中」的镜——页面加载时 init() 会调 resetStuck() 清一次，
   但**同一次会话里**被叫停 / 中断留下的「生成中」没人再管：pipeStepList 见「生成中」就跳过，
   而章节对账又一直说「还剩 N 项」→ 每次重跑都不动它，这一章永远跑不完（假死循环）。
   图片 / 配音 / 口型都是同步请求，没在跑（state.busy 里没有）就一定是残留，直接复位成「未生成」。
   视频不在此列：它有任务 ID，能靠 resumePolling 续轮询。 */
function healStuckShot(s, kind){
  if(!s || kind === 'vid') return s;
  var f = batchStKey(kind);
  if(s[f] !== '生成中' || state.busy[s._id]) return s;
  var o = {}; o[f] = '未生成';
  patchShot(s._id, o);
  return shotById(s._id) || s;
}
/* 对某章的分镜依次跑某一类任务 */
function pipeStepList(list, kind){
  var i = 0;
  function nx(){
    if(state.pipe.stop || i >= list.length) return Promise.resolve(0);
    var s = list[i]; i++;
    var cur = shotById(s._id);
    if(!cur) return nx();
    cur = healStuckShot(cur, kind);
    if(!hasAgnesKey() && kind !== 'audio'){ return Promise.resolve(i); }
    if(kind === 'img'){
      if(cur['图片状态'] === '已完成' || cur['图片状态'] === '生成中') return nx();
      pipeTip('  生图 ' + i + '/' + list.length + '（第 ' + cur['镜号'] + ' 镜）');
      return genShotImage(s._id).then(function(){ return wait(400); }).then(nx);
    }
    if(kind === 'audio'){
      if(cur['配音状态'] === '已完成' || cur['配音状态'] === '生成中') return nx();
      if(!String(cur['台词旁白'] || '').trim()) return nx();
      pipeTip('  配音 ' + i + '/' + list.length + '（第 ' + cur['镜号'] + ' 镜）');
      return genAudio(s._id).then(function(){ return wait(400); }).then(nx);
    }
    if(kind === 'vid'){
      if(cur['视频状态'] === '已完成' || cur['视频状态'] === '生成中' || cur['视频状态'] === '排队中') return nx();
      if(!cur['图片URL']) return nx();
      pipeTip('  生视频 ' + i + '/' + list.length + '（第 ' + cur['镜号'] + ' 镜，较慢耐心等）');
      return genVideo(s._id).then(function(){ return waitShot(s._id, '视频状态', 300000); }).then(function(){ return wait(500); }).then(nx);
    }
    if(kind === 'lip'){
      if(cur['口型状态'] === '已完成' || cur['口型状态'] === '生成中') return nx();
      if(!cur['视频URL'] || lipRiskOf(cur) !== '高') return nx();
      pipeTip('  对口型 ' + i + '/' + list.length + '（第 ' + cur['镜号'] + ' 镜）');
      return genLipsync(s._id).then(function(){ return waitShot(s._id, '口型状态', 300000); }).then(nx);
    }
    return nx();
  }
  return nx();
}
function shotsOfChapter(c){
  return state.shots.filter(function(s){ return String(s['章节'] || '') === c.title; });
}
/* v2.36：这一章还剩多少「该做没做」的项——章节算不算完成，不看有没有抛错、只看事实。
   只有勾了对应步骤的类型才计入（用户没勾视频，就不能因为没视频说这章没完成）。
   返回 -1 表示连分镜都没拆出来（拆镜本身失败了）。 */
function chapterLeft(c, opt){
  var sh = shotsOfChapter(c);
  if(!sh.length) return -1;
  var t = 0;
  sh.forEach(function(s){
    if(opt.doImg && (s['图片状态'] || '未生成') !== '已完成') t++;
    if(opt.doVid && (s['视频状态'] || '未生成') !== '已完成') t++;
    if(opt.doAudio && String(s['台词旁白'] || '').trim() && (s['配音状态'] || '未生成') !== '已完成') t++;
    if(opt.doLip && (s['口型风险'] || lipRiskOf(s)) === '高' && s['视频URL'] && (s['口型状态'] || '不需要') !== '已完成') t++;
  });
  return t;
}
/* 只给还没有描述的设定卡补全（长篇时不重复花钱重写已有设定） */
function fillNewAssets(){
  var need = state.assets.filter(function(a){
    return String(a['名称'] || '').trim() && !String(a['英文锚点'] || '').trim();
  });
  if(!need.length) return Promise.resolve(0);
  return aiAnchorsQuiet(need).then(function(){ return need.length; });
}
function runChapterLoop(list){
  var i = 0, total = list.length, opt = state.pipeOpts, badN = 0;
  function step(){
    if(state.pipe.stop){ finishPipe('已暂停，下次点「开始流水线」可从第 ' + (i + 1) + ' 章继续'); return Promise.resolve(); }
    if(i >= total){
      /* v2.36：收尾要按「实际有没有做完」说话——原来无论多少章卡住都报「全部完成」 */
      finishPipe(badN ? ('本批 ' + total + ' 章跑完，其中 ' + badN + ' 章未完成（章节列表里已标出还差什么，' +
                         '再点一次「开始流水线」只会重跑这些）')
                      : ('全部完成：本批 ' + total + ' 章已跑完'));
      return Promise.resolve();
    }
    var c = list[i];
    c.st = '进行中'; saveChapters(); renderChapters(); setPipeBar(i / total);
    pipeTip('第 ' + (i + 1) + '/' + total + ' 章 · ' + c.title + (opt.doAdapt && !c.adapted ? ' · 剧本化中…' : ' · 拆镜中…'));
    return Promise.resolve()
      .then(function(){ return (opt.doAdapt && !c.adapted) ? adaptChapter(c) : null; })
      .then(function(){
        /* v2.36：这一章已经有分镜就别再拆一遍。splitChapter 是无条件「续号追加」，
           重跑「部分完成」的章（补图 / 补视频）时若无脑再拆一次，这一章的分镜会直接翻倍。
           返回 null 表示「跳过拆镜」，后面按事实汇报。 */
        if(shotsOfChapter(c).length) return null;
        return splitChapter(c, opt.shots);
      })
      .then(function(cnt){
        return loadShots().then(function(){ return loadAssets().then(function(){ return cnt; }); });
      })
      .then(function(cnt){
        pipeTip('第 ' + (i + 1) + '/' + total + ' 章 · ' + c.title +
          (cnt === null ? ' · 已有分镜，跳过拆镜 · 同步设定卡…' : (' · 拆出 ' + cnt + ' 镜 · 同步设定卡…')));
        /* v2.32：必须等它真的写完——原来这里同步返回，紧接着的 fillNewAssets（AI 补全描述）
           跑在 addRecord 之前，新建的角色卡/场景卡拿不到描述就直接进生图，一致性全崩 */
        return syncAssetsFromShots();
      })
      .then(function(){
        if(!opt.doAsset) return;
        pipeTip('第 ' + (i + 1) + '/' + total + ' 章 · AI 补全设定描述…');
        return fillNewAssets();
      })
      .then(function(){
        if(!opt.doAssetImg) return;
        pipeTip('第 ' + (i + 1) + '/' + total + ' 章 · 生成设定图…');
        return batchAssetsQuiet();
      })
      .then(function(){
        if(!opt.doImg) return;
        return pipeStepList(shotsOfChapter(c), 'img');
      })
      .then(function(){
        if(!opt.doAudio) return;
        return pipeStepList(shotsOfChapter(c), 'audio');
      })
      .then(function(){
        if(!opt.doVid) return;
        return loadShots().then(function(){ return pipeStepList(shotsOfChapter(c), 'vid'); });
      })
      .then(function(){
        if(!opt.doLip) return;
        return pipeStepList(shotsOfChapter(c), 'lip');
      })
      .then(function(){
        /* v2.36：章节标不标「完成」按事实对账——本章所有步骤（拆镜 / 设定卡 / 设定图 / 分镜图 /
           配音 / 视频 / 口型）内部都是「吞错型」，几乎不会走到下面的 catch，
           所以原来无论这一章实际做成了什么，都会被打上「完成」；而 runPipeline 的筛选条件是
           `c.st !== '完成'`，于是**失败章永远被跳过、那一章再也没人跑**，用户却看到「全部完成」。 */
        i++;
        var left = chapterLeft(c, opt);
        if(left < 0){ badN++; c.st = '失败：没拆出分镜'; }
        else if(left){ badN++; c.st = '部分完成：还剩 ' + left + ' 项'; }
        else c.st = '完成';
        saveChapters(); renderChapters(); setPipeBar(i / total);
        if(left !== 0) pipeTip('第 ' + i + '/' + total + ' 章 · ' + c.title + ' · ' + c.st);
        refreshAll();
        return step();
      })
      .catch(function(e){
        console.error(e);
        badN++;
        c.st = '失败：' + String(e && e.message ? e.message : e).slice(0, 40);
        i++; saveChapters(); renderChapters(); setPipeBar(i / total); refreshAll();
        return step();
      });
  }
  return step();
}
function finishPipe(msg){
  state.pipe.running = false; state.pipe.stop = false;
  var b = $('btnPipeRun'); if(b) b.textContent = '开始流水线';
  var s = $('btnPipeStop'); if(s) s.style.display = 'none';
  setPipeBar(1); pipeTip(msg);
  saveChapters(); renderChapters(); refreshAll();
  toast(msg);
}
function runPipeline(){
  if(state.pipe.running){ toast('流水线正在运行中'); return; }
  if(!cfg.textKey || !cfg.textModel){ toast('请先在设置里配置文本模型（拆镜要用）'); openDrawer(); return; }
  var list = state.chapters.filter(function(c){ return c.sel && c.st !== '完成'; });
  if(!list.length){ toast('没有待处理的章节（已完成的会被跳过，可取消勾选重跑）'); return; }
  var opt = {
    shots: Math.max(1, num($('pipeShots').value) || 6),
    doAsset: $('pipe_doAsset').checked,
    doAssetImg: $('pipe_doAssetImg').checked,
    doAdapt: !!(($('pipe_doAdapt') && $('pipe_doAdapt').checked)),
    doImg: $('pipe_doImg').checked,
    doAudio: $('pipe_doAudio').checked,
    doVid: $('pipe_doVid').checked,
    doLip: $('pipe_doLip').checked
  };
  if((opt.doAssetImg || opt.doImg || opt.doVid) && !hasAgnesKey()){
    toast('勾选了生图/生视频，请先在设置里填 Agnes API Key'); openDrawer(); return;
  }
  if(opt.doAudio && !cfg.ttsKey){ toast('勾选了配音，请先在设置里填小米 TTS Key'); openDrawer(); return; }
  if(opt.doLip && !cfg.lipBase){ toast('勾选了对口型，请先在设置里填唇形服务地址'); openDrawer(); return; }
  var lim = num($('pipeBatch').value) || 0;
  if(lim > 0) list = list.slice(0, lim);
  cfg.pipeShots = opt.shots; cfg.pipeBatch = lim; cfg.pipeChunk = num($('pipeChunk').value) || 3000;
  saveCfg();
  /* 启动前成本预估（对标火宝批量生成前确认弹窗） */
  var imgs = (opt.doImg ? list.length * opt.shots : 0), vids = (opt.doVid ? list.length * opt.shots : 0);
  var secs = 0;
  if(opt.doVid){
    /* 已拆过镜的章节按真实镜头时长估，比固定值准 */
    list.forEach(function(c){
      state.shots.forEach(function(s){
        if(String(s['章节'] || '') === c.title && (s['视频状态'] || '未生成') !== '已完成') secs += Math.min(12, Math.max(4, num(s['时长秒']) || 5));
      });
    });
    if(!secs) secs = vids * 5;   /* 还没拆镜时按每镜 5 秒估 */
  }
  var auds = (opt.doAudio ? list.length * opt.shots : 0);
  var cost = imgs * num(cfg.costImg) + secs * num(cfg.costVidSec) + auds * num(cfg.costTts);
  var parts = [];
  if(opt.doAssetImg) parts.push('设定图若干张');
  if(imgs) parts.push('分镜图约 ' + imgs + ' 张');
  if(auds) parts.push('配音约 ' + auds + ' 条');
  if(vids) parts.push('视频约 ' + vids + ' 段（' + fmtSec(secs) + '）');
  var launch = function(){
    state.pipeOpts = opt;
    state.pipe.running = true; state.pipe.stop = false;
    var b = $('btnPipeRun'); if(b) b.textContent = '运行中…';
    var s = $('btnPipeStop'); if(s) s.style.display = '';
    toast('流水线启动：' + list.length + ' 章，预计较久，可切走做别的');
    runChapterLoop(list);
  };
  if(parts.length){
    askConfirm('预计生成：' + parts.join('、') + (cost > 0 ? '，预估花费 ¥' + cost.toFixed(2) : '') +
      '。流水线耗时较长，确定开始？', '开始流水线')
      .then(function(ok){ if(ok) launch(); });
    return;
  }
  launch();
}
function stopPipeline(){
  if(!state.pipe.running) return;
  state.pipe.stop = true;
  toast('正在收尾当前步骤后暂停…');
}

