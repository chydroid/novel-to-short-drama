/* ================= 口型（Lip Sync） ================= */
var LIP_HIGH = { '特写':1, '大特写':1, '近景':1 };
/* 风险 = 有台词 + 说话的人在画面里 + 景别近（嘴看得见） */
function lipRiskOf(s){
  if(!String(s['台词旁白'] || '').trim()) return '低';
  var sp = String(s['说话角色'] || '').trim();
  if(!sp) return '低';                                  // 旁白 / 无人说话
  var chars = splitNames(s['出场角色']);
  if(chars.length && chars.indexOf(sp) === -1) return '低'; // 画外音：说话人不在画面
  var sz = String(s['景别'] || '中景');
  if(LIP_HIGH[sz]) return '高';
  if(sz === '中景') return '中';
  return '低';
}
function lipBadge(s){
  var st = s['口型状态'] || '不需要';
  var r = s['口型风险'] || lipRiskOf(s);
  if(st === '已完成') return '<span class="lip ok">口型已同步</span>';
  if(st === '生成中') return '<span class="lip mid">口型生成中</span>';
  if(st === '失败') return '<span class="lip hi">口型失败</span>';
  if(r === '高') return '<span class="lip hi">口型高风险</span>';
  if(r === '中') return '<span class="lip mid">口型中风险</span>';
  return '';
}
function lipBoxHtml(s){
  var r = s['口型风险'] || lipRiskOf(s);
  if(r === '低') return '';
  var st = s['口型状态'] || '不需要';
  var tip = r === '高'
    ? '<b>这一镜是「说话的人正面近景」，AI 视频嘴型对不上配音，观感最差。</b>建议：① 点上方「AI 规避改写」自动改成过肩/侧脸/反应镜头（免费、最有效）；② 或生成视频后点「对口型」交给唇形服务；③ 或把景别改成远景/全景。'
    : '说话的人在中景，嘴部较小，一般可接受；要求高的话可做对口型或改成更远的景别。';
  var btn = (st === '已完成') ? '' :
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">' +
      '<button class="btn gh sm" data-act="lip" data-id="'+s._id+'"'+(s['视频URL'] ? '' : ' disabled')+'>对口型'+(st === '失败' ? '（重试）' : '')+'</button>' +
      '<button class="btn gh sm" data-act="avoidlip" data-id="'+s._id+'">改成低风险镜头</button>' +
    '</div>';
  return '<div class="lipbox">' + tip + btn + '</div>';
}
function renderLipTip(){
  var box = $('lipTip'); if(!box) return;
  var hi = 0, mid = 0, done = 0;
  state.shots.forEach(function(s){
    var r = s['口型风险'] || lipRiskOf(s);
    if(r === '高') hi++; else if(r === '中') mid++;
    if(s['口型状态'] === '已完成') done++;
  });
  box.textContent = state.shots.length
    ? ('口型：高风险 ' + hi + ' 镜 · 中风险 ' + mid + ' 镜 · 已同步 ' + done + ' 镜' + (cfg.lipBase ? '' : '（未配置唇形服务，建议用「AI 规避改写」）'))
    : '';
}
/* 扫描并把风险等级写回数据表 */
function scanLipRisk(){ scanLipRiskCore(true); }
function scanLipRiskQuiet(){ scanLipRiskCore(false); }
function scanLipRiskCore(loud){
  if(!state.shots.length) return;
  /* v2.29：原来逐条 patchShot 串行写（N 次落盘 + N 次重排 + N 个云端请求），
     改成先算完全量更新再一次 bulkPatch。 */
  var ups = [], n = 0;
  state.shots.forEach(function(s){
    var r = lipRiskOf(s);
    if(r === s['口型风险']) return;
    n++;
    ups.push({ id: s._id, obj: { 口型风险: r } });
  });
  if(!ups.length){ if(loud) toast('风险等级已是最新'); return; }
  bulkPatch(ups);
  if(loud) toast('已更新 ' + n + ' 个镜头的口型风险等级');
}
/* 让文本模型把高风险镜头改写成看不到嘴的镜头，台词不变 */
function aiAvoidLip(){
  var list = state.shots.filter(function(s){ return (s['口型风险'] || lipRiskOf(s)) === '高'; });
  if(!list.length){ toast('没有高口型风险的镜头'); return; }
  avoidLipCore(list);
}
/* 单镜改写 */
function avoidLipOne(id){
  var s = shotById(id);
  if(!s) return;
  if(!cfg.textKey || !cfg.textModel){ toast('请先在设置里配置文本模型'); openDrawer(); return; }
  avoidLipCore([s]);
}
function avoidLipCore(list){
  if(!cfg.textKey || !cfg.textModel){ toast('请先在设置里配置文本模型'); openDrawer(); return; }
  var sys = '你是短剧导演。下面这些镜头是「角色正面说话的近景/特写」，AI 视频生成无法让嘴型对上配音，观感很差。' +
    '请把每个镜头改写为「能承载同一句台词、但看不到嘴或嘴不明显」的镜头。可选手法：' +
    '过肩镜头（从说话人肩膀后方拍听者）、说话人侧脸或背身、听者的反应镜头、说话人的手部/书包/桌面等物件特写、环境空镜、远景全身、镜子或玻璃反光中的侧影。' +
    '要求：1) line（台词）一字不改；2) characters / location / speaker 保持不变；' +
    '3) shot_size 改成能避开嘴部的景别；4) scene 和 prompt 用改写后的画面，prompt 用英文；' +
    '5) 只输出严格 JSON 数组，不要解释文字，不要代码块围栏。格式：' +
    '[{"shot":镜号,"shot_size":"中景","scene":"中文画面描述","prompt":"英文图像提示词","camera":"运镜"}]';
  var brief = list.map(function(s){
    return '第' + s['镜号'] + '镜 [' + (s['景别'] || '') + '] 出场' + (s['出场角色'] || '') + ' 说话：' + (s['说话角色'] || '旁白') +
      '\n  原画面：' + (s['画面描述'] || '') + '\n  原提示词：' + (s['英文提示词'] || '') + '\n  台词：' + (s['台词旁白'] || '');
  }).join('\n');
  toast('正在改写 ' + list.length + ' 个高风险镜头…');
  apiPost(cfg.textBase.replace(/\/+$/, '') + '/chat/completions', cfg.textKey, {
    model: cfg.textModel,
    messages: [{ role:'system', content: sys }, { role:'user', content: brief }],
    temperature: 0.8
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0,160));
    var content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if(!content) throw new Error('模型没有返回内容：' + r.text.slice(0,160));
    var arr = parseShotArray(content);
    if(!arr.length) throw new Error('没能解析出改写结果：' + String(content).slice(0,200));
    var map = {};
    arr.forEach(function(it){ if(it) map[num(it.shot)] = it; });
    /* v2.29：先算完全量更新再一次 bulkPatch（原来逐条串行 patchShot，N 次落盘 + N 次重排） */
    var ups = [], hit = 0;
    list.forEach(function(s){
      var it = map[num(s['镜号'])];
      if(!it) return;
      hit++;
      var o = {};
      if(it.shot_size) o['景别'] = (SIZES.indexOf(String(it.shot_size).trim()) > -1) ? String(it.shot_size).trim() : '中景';
      if(it.scene) o['画面描述'] = String(it.scene);
      if(it.prompt) o['英文提示词'] = String(it.prompt);
      if(it.camera) o['运镜'] = String(it.camera);
      o['口型风险'] = '低'; o['口型状态'] = '不需要';
      o['图片状态'] = '未生成'; o['视频状态'] = '未生成';  // 画面变了，图和视频要重生成
      o['满意锁定'] = '否';                               // 旧基准帧对应旧画面，不能再当锚点
      o['更新时间'] = nowStr();
      ups.push({ id: s._id, obj: o });
    });
    if(ups.length) bulkPatch(ups);
    return hit;
  }).then(function(hit){
    if(!hit) return;   /* bulkPatch 内部已刷新；没命中就别再刷一遍、也别报「已改写 0 个」 */
    refreshAll();
    toast('已改写 ' + hit + ' 个镜头为低口型风险，需要重新生成这些镜头的图片和视频');
  }).catch(function(e){ console.error(e); toast('改写失败：' + guessCorsMsg(e).slice(0, 160)); });
}
/* 单镜对口型：把视频 URL + 音频 URL 交给唇形服务 */
function genLipsync(id){
  var s = shotById(id); if(!s) return Promise.resolve();
  if(guardBudget()) return Promise.resolve();   /* v2.47：预算硬上限，拦截口型生成 */
  if(!cfg.lipBase){ toast('请先在设置里填唇形服务 Base URL'); openDrawer(); return Promise.resolve(); }
  var vid = s['口型视频URL'] || s['视频URL'];
  if(!vid) return Promise.resolve();
  var aud = String(s['音频URL'] || '').trim();
  if(!aud || aud === 'local'){
    return patchShot(id, { 口型状态:'失败', 错误信息:'音频只存在本机（local），远端唇形服务取不到。请在设置里改用返回音频 URL 的 TTS，或直接用「AI 规避改写」方案。', 更新时间:nowStr() })
      .then(function(){ toast('第 ' + s['镜号'] + ' 镜：本机音频无法提交给唇形服务'); });
  }
  return patchShot(id, { 口型状态:'生成中', 错误信息:'', 更新时间:nowStr() })
    .then(function(){
      return apiPost(cfg.lipBase + '/lipsync', cfg.lipKey, { video_url: vid, audio_url: aud });
    })
    .then(function(r){
      var j = parseJsonSafe(r.text);
      if(r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 160));
      var url = j && (j.video_url || j.url || j.output || (j.data && (j.data.video_url || j.data.url || j.data.output)));
      if(url) return { url: url };
      var tid = j && (j.id || j.task_id || (j.data && (j.data.id || j.data.task_id)));
      if(tid) return pollLip(tid);
      throw new Error('没取到结果或任务 ID：' + r.text.slice(0, 160));
    })
    .then(function(o){
      if(!o || !o.url) throw new Error('唇形服务没返回视频地址');
      patchShot(id, { 口型视频URL: String(o.url), 口型状态:'已完成', 错误信息:'', 更新时间:nowStr() });
      bumpUse('usedLip', 1);
      toast('第 ' + s['镜号'] + ' 镜口型同步完成');
    })
    .catch(function(e){
      console.error(e);
      patchShot(id, { 口型状态:'失败', 错误信息: guessCorsMsg(e).slice(0, 300), 更新时间: nowStr() });
      toast('第 ' + s['镜号'] + ' 镜口型失败');
    });
}
function pollLip(tid){
  var t0 = Date.now();
  return new Promise(function(resolve, reject){
    var h = setInterval(function(){
      if(Date.now() - t0 > 300000){ clearInterval(h); reject(new Error('唇形任务超时（5 分钟）')); return; }
      var p = (cfg.lipMode === 'post')
        ? apiPost(cfg.lipBase + '/task', cfg.lipKey, { id: tid })
        : apiGet(cfg.lipBase + '/task/' + encodeURIComponent(tid), cfg.lipKey);
      p.then(function(r){
        var j = parseJsonSafe(r.text); if(!j) return;
        var st = String(j.status || (j.data && j.data.status) || '').toLowerCase();
        if(st === 'completed' || st === 'succeeded' || st === 'success' || st === 'done' || st === 'finished'){
          clearInterval(h);
          resolve({ url: j.video_url || j.url || j.output || (j.data && (j.data.video_url || j.data.url || j.data.output)) });
        }else if(st === 'failed' || st === 'error' || st === 'canceled'){
          clearInterval(h); reject(new Error('唇形任务失败：' + r.text.slice(0, 140)));
        }
      }).catch(function(){});
    }, 4000);
  });
}
function batchLipsync(){
  var list = state.shots.filter(function(s){
    return (s['口型风险'] || lipRiskOf(s)) === '高' && s['视频URL'] && s['口型状态'] !== '已完成';
  });
  if(!list.length){ toast('没有需要对口型的镜头'); return; }
  if(!cfg.lipBase){ toast('请先在设置里填唇形服务 Base URL'); openDrawer(); return; }
  var est = costEstimateTxt(list, { lip:1 });
  var pf = preflightShots(list, 'lip');   /* v2.23：走 batchRun 前先预检，确认框里说清会跳过几个 */
  if(!pf.run.length){ toast('这 ' + list.length + ' 个镜头都缺前置条件（' + skipWhyTxt(pf.skip) + '）'); return; }
  list = pf.run;
  askConfirm((est || ('共 ' + list.length + ' 个镜头。')) +
    (pf.skip.length ? ('另有 ' + pf.skip.length + ' 个' + skipWhyTxt(pf.skip) + '，本次跳过；') : '') +
    '确定开始？', '开始')
    .then(function(ok){
      if(!ok) return;
      /* v2.23：收尾统一交给 batchRun——进度条 / 暂停 / 剩余续跑与生图生视频完全一致 */
      return batchRun('lip', list);
    });
}
function testLip(){
  var box = $('testLipResult');
  if(!cfg.lipBase){ box.className = 'result show bad'; box.textContent = '先填唇形服务 Base URL 再测试'; return; }
  box.className = 'result show'; box.textContent = '测试中…';
  apiGet(cfg.lipBase.replace(/\/+$/, '') + '/models', cfg.lipKey).then(function(r){
    box.className = 'result show ' + (r.status < 400 ? 'ok' : 'bad');
    box.textContent = 'HTTP ' + r.status + ' ' + r.text.slice(0, 160);
  }).catch(function(e){ box.className = 'result show bad'; box.textContent = guessCorsMsg(e); });
}

/* 静默版：只给指定设定卡补全描述，不弹提示、不动画面（流水线用） */
function aiAnchorsQuiet(list){
  if(!list || !list.length) return Promise.resolve(0);
  if(!cfg.textKey || !cfg.textModel) return Promise.resolve(0);
  var brief = list.map(function(a){
    return (a['类型'] === '角色' ? '角色' : '场景') + '名：' + String(a['名称']).trim() +
      (a['中文描述'] ? '（已知：' + a['中文描述'] + '）' : '');
  }).join('\n');
  var shotsBrief = state.shots.slice(-40).map(function(s){
    return '第' + s['镜号'] + '镜 [' + (s['场景'] || '') + '] ' + (s['画面描述'] || '') + ' 出场：' + (s['出场角色'] || '');
  }).join('\n');
  var sys = '你是影视美术指导兼配音导演。请为下面每个角色 / 场景撰写用于 AI 绘图与配音的设定。' +
    '只输出严格 JSON 数组，不要解释文字，不要代码块围栏。每项格式：' +
    '{"name":"名称，必须与给定的名称完全一致","cn":"中文描述，20-40 字",' +
    '"en":"英文锚点，40-80 词：角色写清年龄、性别、发型发色、脸型五官、体型、常穿服装及颜色、标志性配饰；场景写清房间类型与尺寸、墙面地面材质颜色、家具种类与摆放方位、门窗位置、光源方向、整体色调",' +
    '"outfit":"角色：常穿服装与配色（中文 20 字内）；场景：关键陈设与摆放方位（中文 20 字内）",' +
    '"persona":"角色：性格与说话方式（中文 15-30 字）；场景：时间与光线",' +
    '"voice":"从 mimo_default、冰糖、茉莉、苏打、白桦、Mia、Chloe、Milo、Dean 中选一个最贴合的音色，只填英文 id；场景填空字符串",' +
    '"style":"TTS 风格标签，如 冷静低沉、元气少女、东北话、语速偏慢；场景填空字符串"}';
  return apiPost(cfg.textBase.replace(/\/+$/, '') + '/chat/completions', cfg.textKey, {
    model: cfg.textModel,
    messages: [
      { role:'system', content: sys },
      { role:'user', content: '小说原文节选：\n' + ($('novel').value || '').slice(0, 3000) + '\n\n最近分镜：\n' + shotsBrief + '\n\n待设定：\n' + brief }
    ],
    temperature: 0.6
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status >= 400) return 0;
    var content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    var arr = content ? parseShotArray(content) : [];
    if(!arr.length) return 0;
    var map = {};
    arr.forEach(function(it){ if(it && it.name) map[String(it.name).trim()] = it; });
    var chain = Promise.resolve(), hit = 0;
    list.forEach(function(a){
      var it = map[String(a['名称']).trim()];
      if(!it) return;
      hit++;
      var patch = { 更新时间: nowStr() };
      if(it.cn) patch['中文描述'] = String(it.cn);
      if(it.en) patch['英文锚点'] = String(it.en);
      if(it.outfit) patch['常服'] = String(it.outfit);
      if(it.persona) patch[a['类型'] === '角色' ? '性格语气' : '性别年龄'] = String(it.persona);
      if(a['类型'] === '角色'){
        if(it.voice) patch['TTS音色'] = String(it.voice);
        if(it.style) patch['TTS风格'] = String(it.style);
      }
      chain = chain.then(function(){ return patchAsset(a._id, patch); });
    });
    return chain.then(function(){ return hit; });
  }).catch(function(e){ console.error(e); return 0; });
}
/* 静默版批量生成设定图（流水线用），返回 Promise */
function batchAssetsQuiet(){
  var need1 = state.assets.filter(function(a){ return (a['状态'] || '未生成') === '未生成' || a['状态'] === '失败'; });
  if(!need1.length && !cfg.multiView) return Promise.resolve();
  if(!hasAgnesKey()) return Promise.resolve();
  /* v2.40：同 batchAssets——两段 reduce 链换成逐条独立 catch，一条抛错不再中断整批设定图。
     静默版不给同步条文案（流水线自己有步骤提示），也不往外抛（见下方 catch 的说明）。 */
  return runSerial(need1.map(function(a){
    return function(){ return genAsset(a._id, 1); };
  })).then(function(){
    if(!cfg.multiView) return;
    return loadAssets().then(function(){
      var need2 = state.assets.filter(function(a){ return a['参考图URL'] && !a['参考图2']; });
      if(!need2.length) return;
      return runSerial(need2.map(function(a){
        return function(){ return genAsset(a._id, 2); };
      }));
    });
  }).then(function(){ return loadAssets(); })
    .then(function(){
      /* v2.35：静默版同样吞错——流水线里设定图全失败也照样往下跑，出来的分镜图全没参考图。
         这里不打断流水线（绝不能往外抛），只给一句明确提示。 */
      var bad = state.assets.filter(function(a){ return (a['状态'] || '未生成') === '失败'; }).length;
      if(bad) toast('有 ' + bad + ' 张设定图生成失败，后续分镜图会缺参考图（流水线结束后去「② 角色与场景」补跑）');
    })
    /* v2.31：静默版更不能往外抛——流水线里一段 reject 会让整条链永远挂在「进行中」 */
    .catch(function(e){ console.error(e); setSync('off'); });
}

