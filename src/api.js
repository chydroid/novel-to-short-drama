/* ---------------- API 层 ---------------- */
function guessCorsMsg(e){
  var m = String(e && e.message ? e.message : e);
  if(/Failed to fetch|NetworkError|Load failed/i.test(m)){
    return '请求发不出去：多半是浏览器跨域（CORS）被拦。解决办法是在设置里把「接口 Base URL」改成你自己的本地代理地址（例如 http://127.0.0.1:8787/v1）。';
  }
  return m;
}
/* v2.54：网络请求统一超时加固。
   原生 fetch 没有默认超时，本地 CORS 代理（agnes-proxy）挂起时会导致整个生成流程永久卡死。
   用 AbortController 统一加超时；AbortError 转成带中文提示的超时错误。 */
var API_TIMEOUT = 120000, AUDIO_TIMEOUT = 30000;
function apiFetch(url, opts, timeoutMs){
  opts = opts || {};
  var ms = timeoutMs || API_TIMEOUT;
  if(typeof AbortController === 'undefined') return fetch(url, opts);
  var ac = new AbortController();
  var o = {}; for(var k in opts) o[k] = opts[k];
  o.signal = ac.signal;
  var tid = setTimeout(function(){ try{ ac.abort(); }catch(_){} }, ms);
  return fetch(url, o).then(function(r){ clearTimeout(tid); return r; }, function(e){
    clearTimeout(tid);
    if(e && (e.name === 'AbortError' || e.name === 'TimeoutError')){
      var err = new Error('请求超时（' + Math.round(ms/1000) + ' 秒无响应）：请检查本地 CORS 代理 agnes-proxy 是否在运行、远端接口是否可达');
      err.timeout = true; throw err;
    }
    throw e;
  });
}
function apiGet(url, key){
  return apiFetch(url, { method:'GET', headers: { 'Authorization':'Bearer '+key, 'Content-Type':'application/json' } })
    .then(function(r){ return r.text().then(function(t){ return { status:r.status, text:t }; }); });
}
function apiPost(url, key, body){
  return apiFetch(url, {
    method:'POST',
    headers: { 'Authorization':'Bearer '+key, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  }).then(function(r){ return r.text().then(function(t){ return { status:r.status, text:t }; }); });
}
function parseJsonSafe(t){ try{ return JSON.parse(t); }catch(e){ return null; } }

/* --- 图片：agnes-image-2.5-flash --- */
/* 一致性关键：把角色 / 场景设定卡同时作为「文字锚点」和「图片参考」注入每一镜 */
var SHOTSIZE_EN = { '远景':'extreme wide shot', '全景':'full wide shot', '中景':'medium shot',
                    '近景':'medium close-up', '特写':'close-up', '大特写':'extreme close-up' };
/* v2.7：镜头语言受控词表（对标火宝把机位角度/运镜枚举化）。用户或拆镜模型填受控中文，
   提示词拼装时自动映射成规范英文，避免中英混拼让镜头语言不稳定；词典没命中的自由文本原样保留。 */
var CAM_MOVE_EN = {
  '固定':'static (locked-off) shot', '固定机位':'static (locked-off) shot', '静止':'static shot',
  '推镜':'push-in', '推近':'slow push-in', '缓慢推近':'slow push-in', '推进':'push-in', '缓推':'slow push-in',
  '拉镜':'pull-back', '拉远':'slow pull-back', '缓慢拉远':'slow pull-back', '拉出':'pull-back',
  '摇镜':'pan', '横摇':'pan', '左摇':'pan left', '右摇':'pan right', '上摇':'tilt up', '下摇':'tilt down',
  '横移':'tracking (lateral) shot', '移镜':'tracking shot', '跟拍':'following shot', '跟随':'following shot',
  '升降':'crane/jib shot', '升降镜':'crane shot', '环绕':'orbit around the subject', '环绕镜':'orbit around the subject',
  '手持':'handheld shot', '手持跟拍':'handheld follow shot', '甩镜':'whip pan', '急摇':'whip pan'
};
var CAM_ANGLE_EN = {
  '平视':'eye-level camera', '平拍':'eye-level camera',
  '俯视':'high angle (looking down)', '俯拍':'high angle (looking down)', '鸟瞰':'top-down view',
  '仰视':'low angle (looking up)', '仰拍':'low angle (looking up)',
  '过肩':'over-the-shoulder shot', '侧拍':'side profile camera', '侧面':'side profile camera',
  '背拍':'shot from behind', '背面':'shot from behind', '正面':'front-on camera', '正面平视':'front-on eye-level camera',
  '45度':'three-quarter (45°) angle', '四分之三':'three-quarter (45°) angle', '顶拍':'top-down shot'
};
function _mapLex(t, dict){
  t = String(t || '').trim(); if(!t) return '';
  if(dict[t]) return dict[t];
  var hits = [], keys = Object.keys(dict).sort(function(a, b){ return b.length - a.length; });
  keys.forEach(function(k){ if(t.indexOf(k) > -1) hits.push(dict[k]); });
  return hits.length ? hits.join(' + ') : t;          // 没命中任何词 → 原样返回，不打断自由创作
}
function cameraMoveEn(t){ return _mapLex(t, CAM_MOVE_EN); }
function cameraAngleEn(t){ return _mapLex(t, CAM_ANGLE_EN); }
/* 组合机位+运镜的英文：把一个镜的「运镜」字段（可能混写机位与运动）转成可控英文提示 */
function cameraLangEn(t){
  var raw = String(t || '').trim(); if(!raw) return '';
  var ang = cameraAngleEn(raw), mov = cameraMoveEn(raw);
  var out = [];
  if(ang && ang !== raw) out.push(ang);
  if(mov && mov !== raw) out.push(mov);
  if(!out.length) return raw;
  var set = out.filter(function(v, i){ return out.indexOf(v) === i; });
  return set.join(', ');
}
var CONSIST_TAIL = 'CRITICAL CONSISTENCY RULES: ' +
  'the face, hairstyle, hair color, body proportions and outfit of every character MUST be identical to their reference picture; ' +
  'do NOT redesign, do NOT age, do NOT change clothes, do NOT alter facial features; ' +
  'the room layout, furniture positions, doors, windows and light direction MUST stay identical to the location reference; ' +
  'keep the same art style, color grading, lens and lighting as the reference images; ' +
  'only the camera angle, framing, action and emotion may change.';
function buildImageBody(s){
  var anc = anchorsForShot(s);
  var main = (s['英文提示词'] && String(s['英文提示词']).trim()) || (s['画面描述'] && String(s['画面描述']).trim()) || '';
  var parts = [];
  if(cfg.prefix) parts.push(cfg.prefix);
  /* v2.17：把「剧集画面类型」前置给模型（auto 类型描述为空 → 不注入，行为与 v2.16 一致） */
  var gEn = genrePromptOn() ? genreStyleEn() : '';
  if(gEn) parts.push('Genre and visual style: ' + gEn + '.');

  /* 1. 参考图：逐张说明身份，模型才知道哪张是谁 */
  if(anc.urls.length){
    parts.push('Reference pictures (must be respected exactly):');
    anc.refs.slice(0, anc.urls.length).forEach(function(r, i){
      parts.push(' - picture ' + (i+1) + ': ' + r.label + '; preserve it exactly.');
    });
  }
  /* 2. 景别：不写清楚构图就会乱变 */
  var sz = String(s['景别'] || '').trim();
  if(sz && SHOTSIZE_EN[sz]) parts.push('Shot size: ' + sz + ' (' + SHOTSIZE_EN[sz] + ').');
  /* 3. 场景 / 角色 / 服装的文字锚点（即使没参考图也强制注入） */
  if(anc.scenePhrase) parts.push('Location, keep layout identical: ' + anc.scenePhrase + '.');
  if(anc.rolePhrase.length) parts.push('Characters: ' + anc.rolePhrase.join('; ') + '.');
  if(anc.outfitPhrase.length) parts.push('Outfit lock: ' + anc.outfitPhrase.join('; ') + '.');
  /* 4. 本镜内容 */
  parts.push('Shot content: ' + main);
  /* 5. 表演 / 情绪（性格一致性） */
  if(String(s['角色情绪'] || '').trim()) parts.push('Performance and emotion: ' + String(s['角色情绪']).trim() + '.');
  /* 6. 运镜 / 机位（受控词表映射成英文，保证镜头语言稳定） */
  var mv = String(s['运镜'] || '').trim();
  if(mv){ var mvEn = cameraLangEn(mv); parts.push('Camera: ' + mv + (mvEn && mvEn !== mv ? ' (' + mvEn + ')' : '')); }
  /* 6.5 光影 / 时间 / 天气 / 色调（画面质感与氛围一致性的关键维度） */
  var la = String(s['光影氛围'] || '').trim();
  if(la) parts.push('Lighting, time of day and atmosphere: ' + la + '.');
  parts.push(CONSIST_TAIL);
  /* v2.8：项目级统一画风令牌——整剧固定同一调性（画风/年代/材质/光质），每镜都注入，防各镜自由发挥漂移 */
  if(String(cfg.globalStyle || '').trim()) parts.push('Global art style for this whole drama (apply consistently): ' + String(cfg.globalStyle).trim() + '.');
  /* 7. 负向提示 */
  var neg = [cfg.neg, String(s['负向提示'] || '').trim()].filter(Boolean).join(', ');
  if(neg) parts.push('Avoid: ' + neg + '.');

  /* 图片提示词覆盖：在「查看提示词」里手动改过就用改后的（参考图仍然带上） */
  var finalPrompt = String(s['图片提示词覆盖'] || '').trim() || parts.filter(Boolean).join(' ');
  var body = {
    model: cfg.imgModel || 'agnes-image-2.5-flash',
    prompt: finalPrompt,
    size: cfg.imgSize,
    ratio: cfg.imgRatio,
    extra_body: { response_format: 'url' }
  };
  var imgs = anc.urls.slice();
  if(cfg.refMode === 'prev' || cfg.prevRef){
    var prev = prevShotImage(s);
    if(prev && imgs.indexOf(prev) === -1) imgs.push(prev);
  }
  if(imgs.length) body.extra_body.image = imgs;
  else if(cfg.ref) body.extra_body.image = [cfg.ref];
  return body;
}
function prevShotImage(s){
  var cur = num(s['镜号']), best = null, bestNo = -1;
  state.shots.forEach(function(x){
    var n = num(x['镜号']);
    if(n < cur && n > bestNo && x['图片URL']){ bestNo = n; best = x['图片URL']; }
  });
  return best;
}
/* 设定图生成：
   角色 ①全身定妆照 ②同一人的面部特写（以①为参考，保证是同一张脸）
   场景 ①无人的空景广角主机位 ②同一空间的反打机位（以①为参考，保证布局一致） */
function buildAssetBody(a, which){
  which = which || 1;
  var anchor = (a['英文锚点'] && String(a['英文锚点']).trim()) || (a['中文描述'] || '').trim() || String(a['名称']||'').trim();
  var isRole = a['类型'] === '角色';
  /* 服装/外观描述：优先「整体常服」，否则用结构化字段自动拼装，保证定妆照和分镜图口径一致 */
  var outfit = '';
  if(isRole){
    var ob = [];
    if(String(a['发型'] || '').trim()) ob.push(String(a['发型']).trim() + ' hair');
    if(String(a['常服'] || '').trim()) ob.push('wearing ' + String(a['常服']).trim());
    else{
      var cl = [String(a['上装'] || '').trim(), String(a['下装'] || '').trim()].filter(Boolean).join(' and ');
      if(cl) ob.push('wearing ' + cl);
    }
    if(String(a['配饰道具'] || '').trim()) ob.push('with ' + String(a['配饰道具']).trim());
    if(String(a['性别年龄'] || '').trim()) ob.unshift(String(a['性别年龄']).trim());
    outfit = ob.length ? ', ' + ob.join(', ') : '';
  }
  var extra;
  if(isRole){
    extra = which === 2
      ? ', head and shoulders portrait, face close-up, neutral expression, looking straight at camera, even soft studio lighting, sharp detailed facial features, plain neutral grey background, the SAME person as the character sheet'
      : ', full-body character reference sheet, standing straight front view, arms relaxed at sides, neutral plain light grey background, even soft lighting, entire outfit clearly visible, sharp facial features, consistent character design';
  }else{
    extra = which === 2
      ? ', wide shot of the SAME empty location from the opposite camera angle, no people, identical furniture and layout, natural lighting, high detail'
      : ', wide establishing shot, completely empty location with no people, natural lighting, wide angle, clear spatial layout of furniture doors and windows, high detail';
  }
  /* v2.17：设定图也带上剧集画面类型（角色卡画成古装/动画，后续分镜才有统一参考） */
  var gEnA = genrePromptOn() ? genreStyleEn() : '';
  var body = {
    model: cfg.imgModel || 'agnes-image-2.5-flash',
    prompt: (cfg.prefix ? cfg.prefix + ' ' : '') + (gEnA ? gEnA + ' ' : '') + anchor + outfit + extra,
    size: '1K',
    ratio: isRole ? '3:4' : cfg.imgRatio,
    extra_body: { response_format: 'url' }
  };
  /* 副图必须以主图为参考，否则等于重新抽卡 */
  if(which === 2 && a['参考图URL']) body.extra_body.image = [a['参考图URL']];
  return body;
}
function genAsset(id, which){
  which = which || 1;
  var a = null;
  for(var i=0;i<state.assets.length;i++){ if(state.assets[i]._id === id) a = state.assets[i]; }
  if(!a) return Promise.resolve();
  if(state.busy['a_' + id]) return Promise.resolve();   /* 防双击重复计费 */
  if(!hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return Promise.resolve(); }
  var nm = a['名称'] || (a['类型'] || '');
  var field = which === 2 ? '参考图2' : '参考图URL';
  var patch = { 状态:'生成中', 错误信息:'', 更新时间:nowStr() };
  state.busy['a_' + id] = true;
  return patchAsset(id, patch)
    .then(function(){ return apiPostAgnes(cfg.agnesBase + '/images/generations', buildAssetBody(a, which)); })
    .then(function(r){
      var j = parseJsonSafe(r.text);
      var url = j && j.data && j.data[0] && (j.data[0].url || (j.data[0].b64_json ? 'data:image/png;base64,'+j.data[0].b64_json : ''));
      if(r.status >= 400 || !url){
        var msg = (j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error) : r.text.slice(0,180);
        throw new Error('HTTP ' + r.status + ' ' + msg);
      }
      var ok = { 状态:'已完成', 错误信息:'', 更新时间:nowStr() };
      ok[field] = url;
      patchAsset(id, ok);
      bumpUse('usedImg', 1);
      toast('「'+nm+'」' + (which === 2 ? '副视图' : '设定图') + '完成');
    })
    .catch(function(e){
      console.error(e);
      patchAsset(id, { 状态:'失败', 错误信息:guessCorsMsg(e).slice(0,300), 更新时间:nowStr() });
      toast('「'+nm+'」设定图失败');
    })
    .then(function(){ delete state.busy['a_' + id]; });
}
/* 一键生成：先出全部主图，再出全部副图（副图依赖主图） */
function batchAssets(){
  var need1 = state.assets.filter(function(a){ return (a['状态'] || '未生成') === '未生成' || a['状态'] === '失败'; });
  if(!need1.length && !cfg.multiView){ toast('没有待生成的设定图'); return; }
  if(!hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return; }
  toast('开始生成设定图（这一步决定后面所有镜头的一致性）…');
  /* v2.31：①同步条上给进度（十几张设定图跑很久，原来只有一句 toast，中途完全没反馈）；
     ②末端补 catch——loadAssets 之类的失败会让整条链静默 reject，用户一直等到天荒地老。
     v2.40：进度改由 runSerial 的 label 统一刷（原来这里有 i1/t1 两个计数器，现在不需要了）。 */
  var r1 = null;
  runSerial(need1.map(function(a){
    return function(){ return genAsset(a._id, 1); };
  }), { label: '设定图', min: 1 }).then(function(r){
    r1 = r;
    if(!cfg.multiView) return;
    return loadAssets().then(function(){
      var need2 = state.assets.filter(function(a){ return a['参考图URL'] && !a['参考图2']; });
      if(!need2.length) return;
      toast('主图完成，继续生成 ' + need2.length + ' 张副视图（面部特写 / 反打机位）…');
      return runSerial(need2.map(function(a){
        return function(){ return genAsset(a._id, 2); };
      }), { label: '副视图', min: 1 });
    });
  }).then(function(){ return loadAssets(); }).then(function(){
    /* v2.35：genAsset 自己吞错只把状态写成「失败」，链上永远 resolve——
       原来无论几张失败都报「设定图全部完成，现在可以去生成分镜图了」，
       用户真去了，出来的分镜图全都没有参考图（一致性 2.0 直接失效）。 */
    var bad = state.assets.filter(function(a){ return (a['状态'] || '未生成') === '失败'; }).length;
    var thrown = (r1 && r1.fail) || 0;          /* v2.40：runSerial 单独记「真正抛错」的条数，跟状态失败不是一回事 */
    setSync(bad || thrown ? 'off' : 'ok');
    toast(bad ? ('设定图跑完，但有 ' + bad + ' 张失败（看卡上的错误信息，修好再点一次；' +
                 '带着失败的设定图去生分镜图会丢参考图）')
              : (thrown ? ('设定图跑完，但有 ' + thrown + ' 项请求异常（看卡上的错误信息，可再点一次）')
                        : '设定图全部完成，现在可以去生成分镜图了'));
  }).catch(function(e){
    console.error(e);
    setSync('off');
    toast('设定图批量生成中断：' + (e && e.message ? e.message : e));
  });
}
/* AI 批量补全设定描述（中文描述 + 英文锚点） */
function aiAnchors(){
  var list = state.assets.filter(function(a){ return String(a['名称']||'').trim(); });
  if(!list.length){ toast('先创建角色卡 / 场景卡'); return; }
  if(!cfg.textKey || !cfg.textModel){ toast('请先在设置里配置文本模型'); openDrawer(); return; }
  var box = $('anchorResult');
  box.className = 'result show'; box.textContent = '正在让模型写设定描述…';
  var brief = list.map(function(a){
    return (a['类型'] === '角色' ? '角色' : '场景') + '名：' + String(a['名称']).trim() +
      (a['中文描述'] ? '（已知：' + a['中文描述'] + '）' : '');
  }).join('\n');
  var shotsBrief = state.shots.slice(0, 60).map(function(s){
    return '第' + s['镜号'] + '镜 [' + (s['场景']||'') + '] ' + (s['画面描述']||'') + ' 出场：' + (s['出场角色']||'');
  }).join('\n');
  var sys = '你是影视美术指导兼配音导演。请为下面每个角色 / 场景撰写用于 AI 绘图与配音的设定。' +
    '只输出严格 JSON 数组，不要任何解释文字，不要代码块围栏。每项格式：' +
    '{"name":"名称，必须与给定的名称完全一致","cn":"中文描述，20-40 字",' +
    '"en":"英文锚点，40-80 词：角色写清年龄、性别、发型发色、脸型五官、体型、常穿服装及颜色、标志性配饰；场景写清房间类型与尺寸、墙面地面材质颜色、家具种类与摆放方位、门窗位置、光源方向、整体色调",' +
    '"outfit":"角色：常穿服装与配色（中文，20 字内，用于锁死每镜不换装）；场景：关键陈设与摆放方位（中文，20 字内）",' +
    '"persona":"角色：性格与说话方式（中文 15-30 字，用于统一表演和配音语气）；场景：时间与光线（如 上午，左侧窗光 + 日光灯）",' +
    '"voice":"从 mimo_default、冰糖、茉莉、苏打、白桦、Mia、Chloe、Milo、Dean 中选一个最贴合该角色的音色，只填英文 id；场景填空字符串",' +
    '"style":"TTS 风格标签，如 冷静低沉、元气少女、东北话、语速偏慢；场景填空字符串"}';
  apiPost(cfg.textBase + '/chat/completions', cfg.textKey, {
    model: cfg.textModel,
    messages: [
      { role:'system', content: sys },
      { role:'user', content: '小说原文节选：\n' + ($('novel').value || '').slice(0, 4000) + '\n\n分镜：\n' + shotsBrief + '\n\n待设定：\n' + brief }
    ],
    temperature: 0.6
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0,160));
    var content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if(!content) throw new Error('模型没有返回内容：' + r.text.slice(0,160));
    var arr = parseShotArray(content);
    if(!arr.length) throw new Error('没能解析出设定数组：' + String(content).slice(0,200));
    var map = {};
    arr.forEach(function(it){ if(it && it.name) map[String(it.name).trim()] = it; });
    var hit = 0;
    var chain = Promise.resolve();
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
  }).then(function(hit){
    box.className = 'result show ok';
    box.textContent = '已补全 ' + hit + ' 张设定卡的描述。检查一下英文锚点是否够具体，然后点「生成全部设定图」。';
    refreshAll();
  }).catch(function(e){
    console.error(e);
    box.className = 'result show bad';
    box.textContent = guessCorsMsg(e);
  });
}
function genImage(id){
  var s = shotById(id); if(!s) return Promise.resolve();
  if(guardBudget()) return Promise.resolve();   /* v2.47：预算硬上限，拦截图片生成 */
  if(!hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return Promise.resolve(); }
  state.busy[id] = true;
  return patchShot(id, { 图片状态:'生成中', 错误信息:'', 更新时间:nowStr() })
    .then(function(){ return apiPostAgnes(cfg.agnesBase + '/images/generations', buildImageBody(shotById(id) || s)); })
    .then(function(r){
      var j = parseJsonSafe(r.text);
      var url = j && j.data && j.data[0] && (j.data[0].url || (j.data[0].b64_json ? 'data:image/png;base64,'+j.data[0].b64_json : ''));
      if(r.status >= 400 || !url){
        var msg = (j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error) : r.text.slice(0,180);
        throw new Error('HTTP ' + r.status + ' ' + msg);
      }
      var cur = shotById(id) || s;
      var oldUrl = cur['图片URL'] || '';
      if(oldUrl && oldUrl !== url) pushImgHist(cur, oldUrl);    /* 旧图先入历史，不静默覆盖 */
      if(oldUrl !== url) markImageChanged(cur);                  /* 有下游视频则提示「换图待重做」 */
      patchShot(id, { 图片URL:url, 图片状态:'已完成', 错误信息:'', 更新时间:nowStr() });
      bumpUse('usedImg', 1);
      toast('第 ' + s['镜号'] + ' 镜图片完成');
    })
    .catch(function(e){
      console.error(e);
      patchShot(id, { 图片状态:'失败', 错误信息:guessCorsMsg(e).slice(0,300), 更新时间:nowStr() });
      toast('第 ' + s['镜号'] + ' 镜生成失败');
    })
    .then(function(){ delete state.busy[id]; refreshAll(); });
}

/* --- v2.7：同镜图像版本历史（对标 MoneyPrinterTurbo 多版本选优）---
   每次重生成/替换本镜图片前，先把旧的「当前图」压入 _imgHist（本地字段，不进资料库），
   绝不静默覆盖；并提供 rollbackImg 一键切回上一版。旧图只要还留在历史里，
   后续镜头的一致性基准帧就不会因为一次误生成而「丢了原来的脸」。 */
function pushImgHist(s, oldUrl){
  if(!s || !oldUrl) return;
  s._imgHist = Array.isArray(s._imgHist) ? s._imgHist.slice() : [];
  if(s['图片URL'] !== oldUrl && s._imgHist.indexOf(oldUrl) === -1) s._imgHist.push(oldUrl);
  if(s._imgHist.length > 9) s._imgHist = s._imgHist.slice(-9);   // 最多留 9 版
}
function rollbackImg(id){
  var s = shotById(id); if(!s || !Array.isArray(s._imgHist) || !s._imgHist.length){ toast('没有可回退的历史图'); return; }
  var hist = s._imgHist.slice();
  var prev = hist.pop();                      // 取最近一版
  var cur = s['图片URL'] || '';
  var obj = { 图片URL: prev, _imgHist: hist, _imgNewer: false, 更新时间: nowStr() };
  if(cur) pushImgHist(Object.assign({}, s, { 图片URL: '' }), cur);   // 把当前图放回历史
  if(s['视频URL'] || s['口型视频URL']){ obj.视频URL=''; obj.口型视频URL=''; obj.任务ID=''; obj.视频状态='未生成'; obj.口型状态='不需要'; }
  toast('第 ' + s['镜号'] + ' 镜已切回上一版图片' + (obj.视频URL === '' && (s['视频URL']||s['口型视频URL']) ? '（旧视频已作废，请重新生成）' : ''));
  patchShot(id, obj);
}
/* 本镜图片被更新：若它已有基于旧图的视频 / 口型视频，标记「换图待重做」，不静默删，UI 上给警示 */
function markImageChanged(s){
  if(!s) return;
  if(s['视频URL'] || s['口型视频URL']) s._imgNewer = true;
}

/* --- v2.9：多版本一次生成 A/B 选优（对标 MoneyPrinterTurbo / Jellyfish 的多候选工作流）---
   一次并发生成 N 版候选图（N 在设置里配，2~3），弹出面板并排对比，
   点「选它」才落到本镜当前图；没被选中的候选与当前图都会进入 _imgHist 版本历史，
   与 v2.7 的 ⇄ 回退共用同一套历史，绝不静默覆盖任何一张已经花钱生成的图。 */
function genImageCand(id, silent, nOverride){
  var s = shotById(id); if(!s) return Promise.resolve();
  if(guardBudget()) return Promise.resolve();   /* v2.47：预算硬上限，拦截候选图生成 */
  if(!hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return Promise.resolve(); }
  var n = Math.min(3, Math.max(2, num(nOverride) || num(cfg.imgN) || 2));
  state.busy[id] = true;
  patchShot(id, { 图片状态:'生成中', 错误信息:'', 更新时间:nowStr() });
  var jobs = [];
  for(var i=0;i<n;i++) jobs.push(i);
  return Promise.all(jobs.map(function(){
    return apiPostAgnes(cfg.agnesBase + '/images/generations', buildImageBody(shotById(id) || s))
      .then(function(r){
        var j = parseJsonSafe(r.text);
        if(r.status >= 400){
          var msg = (j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error) : (r.text || '').slice(0,160);
          throw new Error('HTTP ' + r.status + ' ' + msg);
        }
        var urls = [];
        if(j && Array.isArray(j.data)) j.data.forEach(function(d){
          if(!d) return;
          if(d.url) urls.push(d.url);
          else if(d.b64_json) urls.push('data:image/png;base64,' + d.b64_json);
        });
        if(!urls.length) throw new Error('接口没有返回图片：' + (r.text || '').slice(0,120));
        return urls;
      });
  })).then(function(arrs){
    var urls = [];
    arrs.forEach(function(a){ a.forEach(function(u){ if(urls.indexOf(u) === -1) urls.push(u); }); });
    if(!urls.length) throw new Error('没有取到候选图');
    var cur = shotById(id) || s;
    cur._imgCand = urls;
    patchShot(id, { 图片状态: cur['图片URL'] ? '已完成' : '未生成', 错误信息:'', 更新时间:nowStr() });
    bumpUse('usedImg', urls.length);
    /* v2.10：批量/流水线静默模式 —— 不弹面板打断跑批，候选存着，跑完在镜卡「选图(N)」逐镜挑 */
    if(silent) return;
    openCandPanel(id);
  }).catch(function(e){
    console.error(e);
    patchShot(id, { 图片状态:'失败', 错误信息:guessCorsMsg(e).slice(0,300), 更新时间:nowStr() });
    toast('第 ' + s['镜号'] + ' 镜候选图生成失败');
  }).then(function(){ delete state.busy[id]; refreshAll(); });
}
/* 生图统一入口：批量/流水线按设置决定是否走候选（静默），单镜按钮永远走单图 */
function genShotImage(id){
  var n = Math.min(3, Math.max(1, num(cfg.imgN) || 1));
  return (cfg.batchCand && n > 1) ? genImageCand(id, true, n) : genImage(id);
}
var cbShotId = '';
function openCandPanel(id){
  var s = shotById(id);
  if(!s || !Array.isArray(s._imgCand) || !s._imgCand.length){ toast('没有待挑选的候选图'); return; }
  cbShotId = id;
  var ar = String(cfg.imgRatio || '9:16').replace(':', '/');
  var grid = s._imgCand.map(function(u, i){
    return '<div style="flex:1 1 0;min-width:150px;text-align:center">' +
      '<div class="media" style="aspect-ratio:'+ar+'"><img src="'+esc(u)+'" referrerpolicy="no-referrer"></div>' +
      '<div class="cscore" data-ci="'+i+'" style="font-size:12px;margin-top:5px;min-height:34px;line-height:1.4;color:var(--tx2)">' +
        (cfg.imgScore === false ? '' : '评分中…') + '</div>' +
      '<button class="btn sm" style="margin-top:6px;width:100%" data-cbact="pick" data-i="'+i+'">'+svgIc('check',13)+' 选 ' + String.fromCharCode(65+i) + '</button>' +
      '</div>';
  }).join('');
  $('cbTitle').textContent = '第 ' + s['镜号'] + ' 镜 · ' + s._imgCand.length + ' 版候选（A/B 选优）';
  $('cbMsg').innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap">' + grid + '</div>' +
    '<div class="hint" style="margin-top:10px">选中的一版会成为本镜当前图，其余候选连同旧图自动进入版本历史（⇄ 上一版可随时切回）。若本镜已有视频，换图后需重新生成视频。</div>';
  $('cbBox').classList.add('on'); $('cbMask').classList.add('on');
  runCandScore(id);
}
function closeCandPanel(){ $('cbBox').classList.remove('on'); $('cbMask').classList.remove('on'); cbShotId = ''; }
/* v2.11：候选图技术评分——只评客观技术项（糊 / 暗 / 灰 / 死白），审美留给人。
   打分与点评都是纯函数（scoreImgStats），便于离线单测；取像素失败（跨域）时静默显示「—」。 */
function scoreImgStats(st){
  var s = 0, tags = [];
  var sh = Math.min(1, Math.max(0, num(st.sharp)));          /* 已经归一化到 0–1 的梯度能量 */
  s += 40 * sh;
  if(sh < 0.12) tags.push('偏糊'); else if(sh > 0.5) tags.push('锐利');
  var b = num(st.bright), bs = Math.max(0, 1 - Math.abs(b - 0.47) / 0.33);
  s += 25 * bs;
  if(b < 0.2) tags.push('偏暗'); else if(b > 0.78) tags.push('偏亮/过曝');
  var cs = Math.min(1, num(st.contrast) / 0.28);
  s += 20 * cs;
  if(num(st.contrast) < 0.08) tags.push('发灰');
  var ss = Math.min(1, num(st.sat) / 0.35);
  s += 15 * ss;
  if(num(st.sat) < 0.06) tags.push('色彩寡淡');
  return { score: Math.round(Math.min(100, Math.max(0, s))), tags: tags };
}
/* RGBA 像素统计：亮度均值 / 亮度标准差（对比度）/ 平均饱和度 / 归一化梯度能量（清晰度代理） */
function imgStatsFromData(d, w, h){
  var n = w * h, i, g = new Float32Array(n);
  var sum = 0;
  for(i = 0; i < n; i++){
    var o = i * 4;
    g[i] = (0.299 * d[o] + 0.587 * d[o+1] + 0.114 * d[o+2]) / 255;
    sum += g[i];
  }
  var mean = sum / n, vsum = 0, satsum = 0, grad = 0, gn = 0;
  for(i = 0; i < n; i++){
    var q = i * 4;
    var d1 = g[i] - mean; vsum += d1 * d1;
    var mx = Math.max(d[q], d[q+1], d[q+2]), mn = Math.min(d[q], d[q+1], d[q+2]);
    satsum += mx > 0 ? (mx - mn) / mx : 0;
    var x = i % w, y = (i - x) / w;
    if(x + 1 < w){ grad += Math.abs(g[i] - g[i+1]); gn++; }
    if(y + 1 < h){ grad += Math.abs(g[i] - g[i+w]); gn++; }
  }
  return {
    bright: mean,
    contrast: Math.sqrt(vsum / n),
    sat: satsum / n,
    sharp: Math.min(1, (gn ? grad / gn : 0) / 0.06),     /* 6% 平均梯度视为满分清晰度 */
    hist: histFromData(d, w, h),                         /* v2.12：顺带出色彩直方图，用于一致性比对 */
    safe: safeAreaStats(d, w, h),                        /* v2.13：顺带出构图安全区统计 */
    subj: subjRatio(d, w, h, genreOpts())                /* v2.15：顺带出主体占比（肤色∪显著性）；v2.16 按剧集类型调阈值 */
  };
}
/* 肤色判定：经典 YCbCr 区间（Kovac 规则）——Y>60、77≤Cb≤127、133≤Cr≤173。
   强信号：命中基本就是人的皮肤。弱点是暗光 / 古装大面积覆体 / 强色偏时会漏。 */
function isSkin(R, G, B){
  var Y  =  0.299 * R + 0.587 * G + 0.114 * B;
  if(Y < 60) return false;
  var Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
  var Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
  return Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173;
}
function skinRatio(d, w, h){
  var n = w * h, i, o, hit = 0;
  for(i = 0; i < n; i++){
    o = i * 4;
    if(isSkin(d[o], d[o+1], d[o+2])) hit++;
  }
  return n ? hit / n : 0;
}
/* v2.16：剧集画面类型预设——同一套像素统计，按题材换判定阈值。
   为什么需要：古装厚衣几乎不露肤色、动画高饱和且光照平坦，两者都会让「主体占比」偏低而误报空镜；
   而现代都市真人剧肤色最可信，可以把更多权重给肤色。
   所有阈值都有内置默认值（= auto），不传 opt 时行为与 v2.15 完全一致。 */
/* v2.17：除阈值外，再给每种类型配一段「画面类型」画风描述（cn 给视频/中文提示，en 给生图英文提示）。
   auto 留空 = 不注入，行为与 v2.16 完全一致；其余类型把「这是古装 / 动画」提前告诉模型，
   避免把古装人物画成现代装、把动画画成实拍——这是评分阈值管不到的另一半。 */
var GENRE_OPTS = {
  auto:    { salDev: 0.12, salGrad: 1.5, salW: 0.60, faint: 0.015, small: 0.040, huge: 0.62, loBand: 0.05, hiBand: 0.40, busyHi: 1.60, cutHi: 1.70, offHi: 0.42, cn:'', en:'' },
  modern:  { salDev: 0.13, salGrad: 1.6, salW: 0.50, faint: 0.015, small: 0.040, huge: 0.62, loBand: 0.05, hiBand: 0.42, busyHi: 1.60, cutHi: 1.70, offHi: 0.42,
             cn:'现代都市写实剧，当代生活场景与真实服化道，自然光与实景质感',
             en:'modern urban realistic drama, contemporary setting and costumes, natural daylight, true-to-life production design' },
  costume: { salDev: 0.10, salGrad: 1.3, salW: 0.85, faint: 0.010, small: 0.030, huge: 0.60, loBand: 0.04, hiBand: 0.38, busyHi: 1.75, cutHi: 1.85, offHi: 0.46,
             cn:'中国古装剧，东方古典美学，汉服与传统建筑陈设，柔和自然光',
             en:'chinese period costume drama, eastern classical aesthetics, traditional hanfu robes and ancient architectural interior, soft natural light' },
  anime:   { salDev: 0.17, salGrad: 2.2, salW: 0.55, faint: 0.020, small: 0.050, huge: 0.68, loBand: 0.06, hiBand: 0.45, busyHi: 1.45, cutHi: 1.55, offHi: 0.40,
             cn:'日式二维动画番剧，赛璐璐平涂上色，干净线稿与细腻背景美术',
             en:'japanese 2d anime series, cel-shaded flat coloring, clean line art, detailed anime background art' }
};
/* 取当前剧集类型对应的阈值（异常/缺省一律回落到 auto，保证不会因为脏配置算错分） */
function genreOpts(){
  var g = (cfg && cfg.genre) || 'auto';
  return GENRE_OPTS[g] || GENRE_OPTS.auto;
}
/* v2.17：剧集画面类型写进生成提示词的总开关（默认开；auto 类型本身不带描述，等同不注入） */
function genrePromptOn(){ return !(cfg && cfg.genrePrompt === false); }
function genreStyleCn(){ var o = genreOpts(); return (o && o.cn) || ''; }
/* v2.18：剧集类型 ↔ 画风预设 联动。
   之前类型只改评分阈值和提示词描述，用户还得自己去点风格预设，很容易忘了配；
   这里给出「类型 → 建议画风预设」的映射，并提供一键套用（画风 / 前缀 / 负向词一起换）。 */
var GENRE_LABEL = { auto:'自动 / 通用', modern:'现代都市', costume:'古装 / 年代', anime:'动画 / 二次元' };
var GENRE_STYLE_SUGGEST = { auto:'', modern:'写实电影感', costume:'国风古装', anime:'日系动画' };
/* v2.19：类型联动从「只换一套画风预设」升级为「整套配置套餐」——一次把画风预设、
   全局画风令牌（整剧统一调性）、以及「类型写进提示词」开关一起设成匹配该题材的一套，
   避免用户在「类型 / 画风 / 全局令牌」三处各设各的、互相打架。 */
var GENRE_BUNDLE = {
  modern:  { style:'写实电影感', globalStyle:'现代都市写实，自然光与真实肤色，克制调色，纪实感' },
  costume: { style:'国风古装',   globalStyle:'中国古装年代剧，东方美学配色，柔和自然光，服饰纹样清晰' },
  anime:   { style:'日系动画',   globalStyle:'日式二维动画，干净线条与赛璐璐上色，明亮通透，背景细节丰富' }
};
function genreBundle(){ return GENRE_BUNDLE[selGenre()] || null; }
/* 设置面板里「当前选中的」类型——设置是点保存才写入 cfg 的，所以 UI 提示要跟着下拉框走 */
function selGenre(){
  var sel = $('cf_genre');
  if(sel && GENRE_OPTS[sel.value]) return sel.value;
  return (cfg && cfg.genre) || 'auto';
}
function genreLabel(){ return GENRE_LABEL[selGenre()] || GENRE_LABEL.auto; }
function genreStyleSuggest(){ return GENRE_STYLE_SUGGEST[selGenre()] || ''; }
function genreStyleEn(){ var o = genreOpts(); return (o && o.en) || ''; }
/* v2.15：主体占比 = 肤色占比 ∪ 显著性占比（取较大者，显著性按 salW 打折）。
   为什么要改：v2.14 只用肤色，暗调夜戏 / 古装厚衣 / 强色偏一律被打成「看不到人物」的假报警。
   显著性用「亮度偏离全图均值 + 边缘强度」找前景，对人物不依赖肤色，代价是风景空镜也会有一点分——
   所以它只是兜底（打折后取 max），真正判「空镜」仍然靠两者都极低。
   依然是像素统计、不是人脸检测，只作提示不替用户决定。 */
function subjRatio(d, w, h, opt){
  var n = w * h, i, o, x, y;
  if(!n) return { skin: 0, sal: 0, subj: 0 };
  var salDev  = (opt && opt.salDev  != null) ? num(opt.salDev)  : 0.12;
  var salGrad = (opt && opt.salGrad != null) ? num(opt.salGrad) : 1.5;
  var salW    = (opt && opt.salW    != null) ? num(opt.salW)    : 0.6;
  var g = new Float32Array(n), mean = 0;
  for(i = 0; i < n; i++){
    o = i * 4;
    g[i] = (0.299 * d[o] + 0.587 * d[o+1] + 0.114 * d[o+2]) / 255;
    mean += g[i];
  }
  mean /= n;
  var grad = new Float32Array(n), gsum = 0;
  for(i = 0; i < n; i++){
    x = i % w; y = (i - x) / w;
    var a = 0;
    if(x + 1 < w) a += Math.abs(g[i] - g[i+1]);
    if(y + 1 < h) a += Math.abs(g[i] - g[i+w]);
    grad[i] = a; gsum += a;
  }
  var gavg = gsum / n || 1e-6;
  var skinHit = 0, salHit = 0;
  for(i = 0; i < n; i++){
    o = i * 4;
    if(isSkin(d[o], d[o+1], d[o+2])) skinHit++;
    if(Math.abs(g[i] - mean) > salDev || grad[i] > gavg * salGrad) salHit++;
  }
  var sk = skinHit / n, sa = salHit / n;
  return { skin: sk, sal: sa, subj: Math.max(sk, sa * salW) };
}
/* 主体占比 → 0–100 分：竖屏人物剧的舒适区间大致是 loBand–hiBand 画面，两头都扣分。
   v2.16：区间按剧集类型可调（costume 收窄、anime 放宽），缺省与 v2.15 一致。 */
function subjScore(r, opt){
  if(r == null) return null;
  var loBand = (opt && opt.loBand != null) ? num(opt.loBand) : 0.05;
  var hiBand = (opt && opt.hiBand != null) ? num(opt.hiBand) : 0.40;
  var faint  = (opt && opt.faint  != null) ? num(opt.faint)  : 0.015;
  var small  = (opt && opt.small  != null) ? num(opt.small)  : 0.040;
  var huge   = (opt && opt.huge   != null) ? num(opt.huge)   : 0.62;
  var v = num(r), s;
  if(v < loBand) s = 100 * (v / loBand);                          /* 越小越可能根本没有人物 */
  else if(v <= hiBand) s = 100;                                   /* 舒适区 */
  else if(v <= hiBand + 0.20) s = 100 - 45 * ((v - hiBand) / 0.20); /* 逐渐怼近 */
  else s = 55 - 30 * Math.min(1, (v - hiBand - 0.20) / 0.35);     /* 贴满画框 */
  var tags = [];
  if(v < faint) tags.push('几乎看不到人物（可能是空镜）');
  else if(v < small) tags.push('人物主体偏小');
  else if(v > huge) tags.push('主体怼满画面（特写过近）');
  return { score: Math.round(Math.max(0, Math.min(100, s))), tags: tags };
}
/* v2.12：色彩直方图（RGB 各量化 4 级 = 64 桶，归一化）——判断两张图「像不像同一部剧」的廉价代理。
   真·语义一致性要 CLIP 之类的模型，纯前端做不到；色调分布是最接近的可算维度。 */
function histFromData(d, w, h){
  var n = w * h, i, H = new Float32Array(64);
  for(i = 0; i < n; i++){
    var o = i * 4;
    H[((d[o] >> 6) << 4) | ((d[o+1] >> 6) << 2) | (d[o+2] >> 6)]++;
  }
  for(i = 0; i < 64; i++) H[i] /= n;
  return H;
}
/* 直方图交集相似度：1 = 色调分布完全一致，0 = 毫无重叠 */
function histSim(a, b){
  if(!a || !b || a.length !== b.length) return null;
  var s = 0;
  for(var i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return Math.max(0, Math.min(1, s));
}
/* 交集值实测多落在 0.25–0.8，线性拉伸成 0–100 分 */
function consScore(sim){
  if(sim == null) return null;
  return Math.round(Math.max(0, Math.min(1, (sim - 0.25) / 0.55)) * 100);
}
/* v2.13：构图安全区统计——底部字幕区是否过挤、主体是否被画框切断、主体重心是否偏离中心。
   这三个都是「烧字幕 / 竖屏播放」时最容易翻车的构图问题，纯像素可算，无需模型。 */
function safeAreaStats(d, w, h){
  var n = w * h, i, x, y, o;
  var g = new Float32Array(n), mean = 0;
  for(i = 0; i < n; i++){
    o = i * 4;
    g[i] = (0.299 * d[o] + 0.587 * d[o+1] + 0.114 * d[o+2]) / 255;
    mean += g[i];
  }
  mean = mean / n;
  var grad = new Float32Array(n), gsum = 0;
  for(i = 0; i < n; i++){
    x = i % w; y = (i - x) / w;
    var a = 0;
    if(x + 1 < w) a += Math.abs(g[i] - g[i+1]);
    if(y + 1 < h) a += Math.abs(g[i] - g[i+w]);
    grad[i] = a; gsum += a;
  }
  var gavg = gsum / n || 1e-6;
  /* ① 底部字幕区（下 18%）的繁忙度：>1 说明下半部分比全图还热闹，字幕压上去会糊 */
  var y0 = Math.floor(h * 0.82), bs = 0, bn = 0;
  for(i = y0 * w; i < n; i++){ bs += grad[i]; bn++; }
  var bottomBusy = bn ? (bs / bn) / gavg : 1;
  /* ② 最外一圈的梯度：明显高于全图 = 有东西被画框切断（半张脸 / 半只手） */
  var es = 0, en = 0;
  for(i = 0; i < n; i++){
    x = i % w; y = (i - x) / w;
    if(x === 0 || y === 0 || x === w - 1 || y === h - 1){ es += grad[i]; en++; }
  }
  var edgeCut = en ? (es / en) / gavg : 1;
  /* ③ 内容重心到画面中心的归一化距离。权重用「偏离全图均值的程度」而不是「偏离中灰」：
        黑底上的白色主体才会被正确识别为主体，否则整张暗调图的重心会被底噪拉回正中 */
  var cx = 0, cy = 0, wsum = 0;
  for(i = 0; i < n; i++){
    x = i % w; y = (i - x) / w;
    var wt = Math.abs(g[i] - mean) + grad[i] * 2;
    cx += x * wt; cy += y * wt; wsum += wt;
  }
  cx = wsum ? cx / wsum : w / 2;
  cy = wsum ? cy / wsum : h / 2;
  var centerOff = Math.sqrt(Math.pow((cx - w / 2) / (w / 2), 2) + Math.pow((cy - h / 2) / (h / 2), 2)) / Math.SQRT2;
  return { bottomBusy: bottomBusy, edgeCut: edgeCut, centerOff: centerOff };
}
/* v2.16：构图分阈值按剧集类型可调（动画边缘本就多、古装布料边缘杂，容差要放宽）；
   缺省（不传 opt）与 v2.13 行为完全一致。 */
function safeScore(st, opt){
  if(!st) return null;
  var busyHi = (opt && opt.busyHi != null) ? num(opt.busyHi) : 1.6;
  var cutHi  = (opt && opt.cutHi  != null) ? num(opt.cutHi)  : 1.7;
  var offHi  = (opt && opt.offHi  != null) ? num(opt.offHi)  : 0.42;
  var s = 0, tags = [];
  var bb = num(st.bottomBusy);
  s += 40 * Math.max(0, Math.min(1, 1 - (bb - 0.85) / 1.15));
  if(bb > busyHi) tags.push('底部过挤（字幕会压住主体）');
  var ec = num(st.edgeCut);
  s += 35 * Math.max(0, Math.min(1, 1 - (ec - 0.9) / 1.1));
  if(ec > cutHi) tags.push('主体贴边被裁');
  var co = num(st.centerOff);
  s += 25 * Math.max(0, Math.min(1, 1 - co / 0.5));
  if(co > offHi) tags.push('主体偏离画面中心');
  return { score: Math.round(Math.min(100, Math.max(0, s))), tags: tags };
}
/* 技术分 / 一致性分 / 构图分 / 主体分 → 综合分（v2.14 起为四维）。
   权重规则：一致性 20%、构图 20%、主体 15% 各自固定，剩下的全归技术分；
   关掉哪个维度，它那部分权重自动还给技术分——不会因为缺维度而凭空拉低总分。
   全开时 = 技术 45% + 一致性 20% + 构图 20% + 主体 15%。 */
function candFinal(tech, cons, safe, subj){
  var WC = 0.20, WS = 0.20, WJ = 0.15;
  var parts = [], used = 0;
  if(cons != null && isFinite(num(cons))){ parts.push([num(cons), WC]); used += WC; }
  if(safe && safe.score != null){ parts.push([num(safe.score), WS]); used += WS; }
  if(subj && subj.score != null){ parts.push([num(subj.score), WJ]); used += WJ; }
  if(!parts.length) return { score: tech.score, tags: tech.tags, cons: null, safe: null, subj: null };
  var s = num(tech.score) * (1 - used);
  parts.forEach(function(p){ s += p[0] * p[1]; });
  var tags = tech.tags.slice();
  if(cons != null){
    if(cons >= 70) tags.push('调性一致');
    else if(cons < 45) tags.push('与全剧色调有偏差');
  }
  if(safe) tags = tags.concat(safe.tags || []);
  if(subj) tags = tags.concat(subj.tags || []);
  return {
    score: Math.round(Math.max(0, Math.min(100, s))),
    tags: tags,
    cons: cons != null ? cons : null,
    safe: safe ? safe.score : null,
    subj: subj ? subj.score : null
  };
}
/* 本剧基准色调：取最近定稿的若干张镜头图，各算直方图后求平均（跨域取不到像素的自动跳过） */
function dramaBaseHist(excludeId){
  var urls = [];
  state.shots.forEach(function(x){
    if(excludeId && x._id === excludeId) return;
    var u = String(x['图片URL'] || '').trim();
    if(u && /^(https?:|data:image)/.test(u)) urls.push(u);
  });
  if(urls.length > 8) urls = urls.slice(-8);            /* 只要最近的 8 张，避免拉一大堆图 */
  if(!urls.length) return Promise.resolve(null);
  return Promise.all(urls.map(histOfUrl)).then(function(hs){
    var ok = hs.filter(function(h){ return !!h; });
    if(!ok.length) return null;
    var avg = new Float32Array(64), i;
    ok.forEach(function(h){ for(i = 0; i < 64; i++) avg[i] += h[i]; });
    for(i = 0; i < 64; i++) avg[i] /= ok.length;
    return avg;
  }).catch(function(){ return null; });
}
function histOfUrl(url){
  return new Promise(function(resolve){
    var img = new Image();
    if(/^https?:/.test(url)) img.crossOrigin = 'anonymous';
    img.onload = function(){
      try{
        var W = 64, H = Math.max(1, Math.round(W * (img.naturalHeight || 1) / (img.naturalWidth || 1)));
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var cx = cv.getContext('2d'); if(!cx) return resolve(null);
        cx.drawImage(img, 0, 0, W, H);
        resolve(histFromData(cx.getImageData(0, 0, W, H).data, W, H));
      }catch(e){ resolve(null); }
    };
    img.onerror = function(){ resolve(null); };
    img.src = url;
  });
}
/* 加载一张候选图并算分（跨域取不到像素时返回 null，调用方显示「—」即可） */
function scoreCandidate(url){
  return new Promise(function(resolve){
    if(!url || !/^(https?:|data:image)/.test(url)) return resolve(null);
    var img = new Image();
    if(/^https?:/.test(url)) img.crossOrigin = 'anonymous';
    img.onload = function(){
      try{
        var W = 96, H = Math.max(1, Math.round(W * (img.naturalHeight || 1) / (img.naturalWidth || 1)));
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var cx = cv.getContext('2d'); if(!cx) return resolve(null);
        cx.drawImage(img, 0, 0, W, H);
        var d = cx.getImageData(0, 0, W, H).data;
        var st = imgStatsFromData(d, W, H);
        var gop = genreOpts();                                                     /* v2.16：按剧集类型取阈值 */
        var r = scoreImgStats(st);
        r.safe = (cfg.imgSafe !== false && st.safe) ? safeScore(st.safe, gop) : null;   /* v2.13 构图分 */
        /* v2.15：主体占比改取「肤色 ∪ 显著性」，不再单靠肤色，暗调/古装不再误报空镜 */
        r.subj = (cfg.imgSubj !== false && st.subj) ? subjScore(st.subj.subj, gop) : null;
        resolve(r);
      }catch(e){ resolve(null); }        /* 跨域图 getImageData 会抛 SecurityError */
    };
    img.onerror = function(){ resolve(null); };
    img.src = url;
  });
}
/* 面板打开后异步算分：写回每张的分数与点评，并给最高分打「推荐」 */
function runCandScore(id){
  var s = shotById(id);
  if(!s || !Array.isArray(s._imgCand) || cfg.imgScore === false) return;
  var urls = s._imgCand.slice();
  /* v2.12：一致性维度需要本剧基准色调；关掉或取不到基准时，综合分就等于纯技术分 */
  var wantCons = cfg.imgCons !== false;
  Promise.all([
    Promise.all(urls.map(scoreCandidate)),
    wantCons ? dramaBaseHist(id) : Promise.resolve(null)
  ]).then(function(pair){
    if(cbShotId !== id) return;                                  /* 面板已切走就不写 DOM */
    var base = pair[1];
    var rs = pair[0].map(function(t){
      if(!t) return null;
      return candFinal(t, (base && t.hist) ? consScore(histSim(t.hist, base)) : null, t.safe, t.subj);
    });
    var best = -1, bi = -1;
    rs.forEach(function(r, i){ if(r && r.score > best){ best = r.score; bi = i; } });
    rs.forEach(function(r, i){
      var box = $('cbMsg'); if(!box) return;
      var el = box.querySelector('.cscore[data-ci="' + i + '"]');
      if(!el) return;
      if(!r){ el.innerHTML = '<span style="opacity:.55">—（取不到像素，未评分）</span>'; return; }
      var rec = (rs.length > 1 && i === bi);
      var col = r.score >= 70 ? '#4ade80' : (r.score >= 45 ? '#fbbf24' : '#f87171');
      el.innerHTML = '<b style="color:' + col + ';font-size:14px">' + r.score + '</b> 分' +
        (r.cons != null ? '<span style="opacity:.7"> · 一致性 ' + r.cons + '</span>' : '') +
        (r.safe != null ? '<span style="opacity:.7"> · 构图 ' + r.safe + '</span>' : '') +
        (r.subj != null ? '<span style="opacity:.7"> · 主体 ' + r.subj + '</span>' : '') +
        '<div style="opacity:.8">' + esc(r.tags.length ? r.tags.join('、') : '清晰度 / 曝光 / 色彩均正常') + '</div>' +
        (rec ? '<div style="color:#4ade80;font-weight:600">'+svgIc('star',13)+' 推荐</div>' : '');
      var btn = box.querySelector('[data-cbact="pick"][data-i="' + i + '"]');
      if(btn && rec) btn.innerHTML = svgIc('check',13) + ' 选 ' + String.fromCharCode(65 + i) + '（推荐）';
    });
  }).catch(function(){});
}
function pickCand(i){
  var id = cbShotId; if(!id) return;
  var s = shotById(id);
  if(!s || !Array.isArray(s._imgCand) || !s._imgCand[i]){ closeCandPanel(); return; }
  var obj = candCommitObj(s, i);   /* v2.28：与批量选优共用同一套提交口径 */
  closeCandPanel();
  if(!obj) return;
  patchShot(id, obj);
  toast('已选 ' + String.fromCharCode(65 + i) + ' 版为第 ' + s['镜号'] + ' 镜图片');
}
function discardCand(){
  var id = cbShotId, s = id ? shotById(id) : null;
  closeCandPanel();
  if(s){ s._imgCand = []; toast('已放弃候选图，可点「A/B 选优」重新生成'); refreshAll(); }
}
/* v2.25 / v2.28：把「选第 i 版候选」的提交动作抽成可复用函数——面板的 pickCand、批量选最高分、批量落库三处共用同一套
   提交口径，避免多套逻辑各写各的。不依赖面板状态（cbShotId / closeCandPanel），批量场景直接拿 shot 对象提交。
   只算出更新对象 + 做内存副作用（清候选、旧图入历史、标记画面已变），不落库：单条走 patchShot、批量走 bulkPatch。
   越界 / 没有候选返回 null（调用方据此判「跳过」）。 */
function candCommitObj(s, i){
  if(!s || !Array.isArray(s._imgCand) || !s._imgCand[i]) return null;
  var url = s._imgCand[i];
  var oldUrl = s['图片URL'] || '';
  var obj = { 图片URL:url, 图片状态:'已完成', 错误信息:'', 更新时间:nowStr() };
  if(oldUrl && oldUrl !== url){
    pushImgHist(s, oldUrl);
    obj._imgHist = s._imgHist;
    markImageChanged(s);
    if(s['视频URL'] || s['口型视频URL']) obj._imgNewer = true;
  }
  s._imgCand = [];
  return obj;
}
function commitBestCand(s, i){
  var obj = candCommitObj(s, i);
  if(!obj) return false;
  patchShot(s._id, obj);
  return true;
}
/* v2.25：批量选最高分——对每张有候选待选的镜，复用与面板一致的评分口径（清晰度 / 曝光 / 一致性 / 构图 / 主体）算分，自动提交最高分那版。
   省掉「跑完批量 → 逐镜打开面板点推荐」那一趟；某镜全部取不到像素（跨域）就跳过交回人工。 */
function autoPickAllCand(){
  var list = state.shots.filter(function(s){ return Array.isArray(s._imgCand) && s._imgCand.length; });
  if(!list.length){ toast('没有待挑选的候选图'); return; }
  /* v2.27 修 bug：askConfirm 返回的是 Promise，不能拿它当布尔做否定判断（恒为假），
     否则用户在确认框点「取消」也照样开跑。必须在 .then 里判 ok。 */
  askConfirm('对 ' + list.length + ' 个镜头的候选图，按技术评分（清晰度 / 曝光 / 一致性 / 构图 / 主体）自动选最高分的一版？\n评分取不到像素的镜头会跳过，交回你手动选。', '批量选最高分')
    .then(function(ok){ if(ok) autoPickRun(list); });
}
/* v2.27：批量选最高分的执行体（不含确认），单拎出来便于测试与复用 */
function autoPickRun(list){
  if(!list || !list.length){ toast('没有待挑选的候选图'); return; }
  pushUndo();                     /* v2.31：批量选图也是「一键改几十镜」，给个后悔药 */
  batchBarOpen('批量选最高分（共 ' + list.length + ' 镜）');
  var done = 0, picked = 0, skipped = 0;
  /* v2.28：这里只收集「提交对象」，等全部评完再一次性 bulkPatch——
     逐镜 commitBestCand 会触发 N 次全量落盘 + N 次整页重排（几十镜就很卡）。 */
  var ups = [];
  function step(i){
    if(i >= list.length || state.stopBatch){ finish(); return; }
    var s = list[i];
    var urls = s._imgCand.slice();
    var wantCons = cfg.imgCons !== false;
    Promise.all([
      Promise.all(urls.map(scoreCandidate)),
      wantCons ? dramaBaseHist(s._id) : Promise.resolve(null)
    ]).then(function(pair){
      var base = pair[1];
      var rs = pair[0].map(function(t){
        if(!t) return null;
        return candFinal(t, (base && t.hist) ? consScore(histSim(t.hist, base)) : null, t.safe, t.subj);
      });
      var bi = -1, best = -1;
      rs.forEach(function(r, k){ if(r && r.score > best){ best = r.score; bi = k; } });
      if(bi < 0){ skipped++; }
      else {
        var co = candCommitObj(s, bi);
        if(co){ ups.push({ id: s._id, obj: co }); picked++; }
        else skipped++;
      }
      done++;
      batchBarStep(done, list.length);
      batchBarMsg('已处理第 ' + s['镜号'] + ' 镜' + (bi < 0 ? '（取不到像素，跳过）' : '（选最高分 ' + String.fromCharCode(65 + bi) + '）'));
      setTimeout(function(){ step(i + 1); }, 0);
    }).catch(function(){
      skipped++; done++;
      batchBarStep(done, list.length);
      setTimeout(function(){ step(i + 1); }, 0);
    });
  }
  function finish(){
    if(ups.length) bulkPatch(ups);   /* 一次改内存、一次落盘、一次刷新；有云时写完后刷新 */
    else { renderToday(); if(typeof renderGenList === 'function') renderGenList(); }
    batchBarClose('批量选最高分完成：自动选定 ' + picked + ' 镜' + (skipped ? '，' + skipped + ' 镜取不到像素已跳过（请手动选）' : ''), 'img');
    toast('批量选最高分完成：' + picked + ' 镜已自动选定' + (skipped ? '，' + skipped + ' 镜需手动挑选' : ''));
  }
  step(0);
}
/* --- 视频：agnes-video-2.5-flash（OpenAI-Videos 兼容 API，输出带同步音频） --- */
function buildVideoBody(s){
  /* v2.7：运镜/机位经受控词表映射为英文镜头语言，画面仍用中文描述，提升视频动态的确定性 */
  var camEn = cameraLangEn(s['运镜']);
  var prompt = (camEn ? camEn + '. ' : '') + String(s['画面描述'] || '');
  if(String(s['角色情绪'] || '').trim()) prompt += '，人物情绪：' + String(s['角色情绪']).trim();
  if(String(s['光影氛围'] || '').trim()) prompt += '，光影氛围：' + String(s['光影氛围']).trim();
  /* v2.8：项目级统一画风令牌——整剧固定同一视觉调性，防止镜头间风格漂移 */
  if(String(cfg.globalStyle || '').trim()) prompt += '，本剧统一画风：' + String(cfg.globalStyle).trim();
  /* v2.17：把剧集画面类型也写进视频提示（auto 类型为空 → 不注入） */
  var gCnV = genrePromptOn() ? genreStyleCn() : '';
  if(gCnV) prompt += '，画面类型：' + gCnV;
  if(cfg.prefix) prompt = cfg.prefix + prompt;
  /* 视频提示词覆盖：在「查看提示词」里手动改过就用改后的 */
  if(String(s['视频提示词覆盖'] || '').trim()) prompt = String(s['视频提示词覆盖']).trim();
  /* v3：音画同步——把本镜台词/旁白写进 prompt，模型据此生成同步语音；
     音色/语气由 prompt 驱动；参考图走 keyframe 模式的 first_frame 字段 */
  var narr = String(s['台词旁白'] || '').trim();
  if(narr){
    prompt += '。画面中的人物用自然、口语化的语气说出这句台词：' + narr;
    if(String(s['角色情绪'] || '').trim()) prompt += '（语气：' + String(s['角色情绪']).trim() + '）';
    prompt += '，人物嘴部随语音自然开合，做到音画同步';
  }else{
    prompt += '。画面自然流动，无对白，仅环境氛围';
  }
  /* API 只接受 4–12 秒，手动填超范围会被整单拒绝 */
  var sec = Math.min(12, Math.max(4, num(s['时长秒']) || num(cfg.vidSec) || 5));
  /* 对齐官方 OpenAI-Videos 兼容 API：agnes-video-2.5-flash（带同步音频的可用模型）。
     mode 必填；有首帧图走 keyframe(first_frame)，无图走 text。
     切勿使用不存在的 agnes-video-v2.0 / image / width / height / num_frames —— 那正是此前视频必失败的根因。 */
  var imgUrl = String(s['图片URL'] || '').trim();
  var hasImg = /^https?:/.test(imgUrl);
  var vbody = {
    model: cfg.vidModel || 'agnes-video-2.5-flash',
    prompt: prompt,
    mode: hasImg ? 'keyframe' : 'text',
    seconds: String(sec),
    size: '720P',
    aspect_ratio: cfg.vidRatio,
    n: 1
  };
  if(hasImg) vbody.first_frame = imgUrl;
  return vbody;
}
function pickVideoUrl(j){
  if(!j || typeof j !== 'object') return '';
  var cand = [
    j.video_url, j.url, j.metadata && j.metadata.url, j.output && j.output.url, j.result && j.result.url,
    j.data && j.data.url, j.data && j.data[0] && j.data[0].url,
    j.video && j.video.url, j.videos && j.videos[0] && j.videos[0].url,
    j.result && j.result.video_url, j.content && j.content.video_url
  ];
  for(var i=0;i<cand.length;i++){ if(typeof cand[i] === 'string' && /^https?:/.test(cand[i])) return cand[i]; }
  /* 兜底：深度找第一个 http(s) 的 mp4 链接 */
  try{
    var str = JSON.stringify(j), m = str.match(/https?:\/\/[^"\\ ]+?\.mp4[^"\\ ]*/);
    if(m) return m[0];
  }catch(e){}
  return '';
}
function pickStatus(j){
  if(!j) return '';
  return String(j.status || (j.data && j.data.status) || (j.result && j.result.status) || '').toLowerCase();
}
function stopPoll(id){ if(pollers[id]){ clearInterval(pollers[id]); delete pollers[id]; } }
function startPoll(id){
  stopPoll(id);
  var tries = 0;
  var tick = function(){
    var s = shotById(id);
    if(!s || !s['任务ID']){ stopPoll(id); return; }
    tries++;
    if(tries > 240){ stopPoll(id); patchShot(id, { 视频状态:'失败', 错误信息:'轮询超时（超过 12 分钟）', 更新时间:nowStr() }); return; }
    apiGet(cfg.agnesQuery + '/agnesapi?video_id=' + encodeURIComponent(s['任务ID']) + '&model_name=' + encodeURIComponent(cfg.vidModel || 'agnes-video-2.5-flash'), ak())
      .then(function(r){
        /* 查询接口本身报错（鉴权/参数/未找到）：ak() 每次轮换 Key，故给几次重试，仍不过再判失败 */
        if(r.status >= 400){
          if(tries > 3){ stopPoll(id); patchShot(id, { 视频状态:'失败', 错误信息:('查询失败 HTTP ' + r.status + ' ' + (r.text || '').slice(0,160)).slice(0,300), 更新时间:nowStr() }); }
          return;
        }
        var j = parseJsonSafe(r.text);
        var st = pickStatus(j);
        /* 完成与否只认 status，绝不因「响应里恰好有个链接」就判成功——否则失败/排队会被误报成完成 */
        if(st === 'completed' || st === 'succeeded' || st === 'success'){
          stopPoll(id);
          var url = pickVideoUrl(j);
          if(!url){ patchShot(id, { 视频状态:'失败', 错误信息:'任务已完成但未返回视频地址', 更新时间:nowStr() }); return; }
          patchShot(id, { 视频状态:'已完成', 视频URL:url, 视频含音频:true, 错误信息:'', _imgNewer:false, 更新时间:nowStr() });
          bumpUse('usedVidSec', Math.min(12, Math.max(4, num(s['时长秒']) || 5)));
          toast('第 ' + s['镜号'] + ' 镜视频完成');
        }else if(st === 'failed' || st === 'error' || st === 'canceled' || st === 'cancelled' || st === 'aborted'){
          stopPoll(id);
          var msg = (j && (j.error || j.message || j.detail)) ? JSON.stringify(j.error || j.message || j.detail) : (r.text || '').slice(0,180);
          patchShot(id, { 视频状态:'失败', 错误信息:('视频任务失败 ' + msg).slice(0,300), 更新时间:nowStr() });
        }else{
          /* 仍在排队/处理中，只在状态变化时更新文案 */
          var vs = (st === 'queued' || st === 'pending' || st === 'waiting' || st === 'created' || st === 'starting') ? '排队中' : '生成中';
          if((s['视频状态'] || '') !== vs){ s['视频状态'] = vs; refreshAll(); }
        }
      })
      .catch(function(e){
        if(tries > 3){ stopPoll(id); patchShot(id, { 视频状态:'失败', 错误信息:guessCorsMsg(e).slice(0,300), 更新时间:nowStr() }); }
      });
  };
  pollers[id] = setInterval(tick, 3500);
  tick();
}
function isRetryableVideoErr(r, text){
  var t = (text || '').toLowerCase();
  if(r && (r.status === 429 || r.status === 503)) return true;                       // 限流 / 服务暂不可用
  if(/video_queue_full|queue_full|队列已满/.test(t)) return true;                     // 队列满（官方明确「请稍后重试」）
  /* v2.61：补中文限流文案——免费用户限流原文是「您已达到免费用户的 API 速率限制」，
     旧词表只有 rate limit/too_many_requests/触发限流，这条 200 响应匹配不上，
     被当成非瞬时错误直接失败（真实案例：睡前故事短视频整批一个都没成功） */
  if(/rate[_\s-]?limit|too[_\s-]?many|请求过于频繁|触发限流|限流|速率限制|quota/.test(t)) return true;
  return false;
}
/* v2.55：Agnes 视频任务创建对「队列已满 / 限流」类瞬时错误做指数退避重试。
   官方文档：video_queue_full 属服务端过载（队列满，请稍后重试），非参数校验错误，应重试而非判失败；
   永久 400 校验错误（size 非 720P、图片/音频超限等）不重试，避免空转浪费配额。
   v2.58 防重复生成（后台计量 134 vs 实际 <50 的根因之一）：
   - 重试上限 8 → 5（退避 2/4/8/16/30s ≈ 60s，足够队列排空；还满就让用户稍后再来，
     而不是继续打请求——每个被拒的请求在服务端同样计入计量）；
   - **网络层错误（超时/断网，根本没有响应）绝不重试**：请求可能已被服务端接收并创建了
     任务，重试等于重复创建、重复计费。这类错误直接抛出，由上层标记失败、用户知情后再决定。 */
function submitAgnesVideo(body, opts){
  opts = opts || {};
  var max = opts.max || 6;                                   // v2.61：限流时一轮重试要跨过按分钟计的速率窗口，5 次不够 → 6
  var onWait = opts.onWait || function(){};
  var attempt = 0;
  function wait(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  /* v2.61：服务端错误信息透传。 Agnes 把限流放在 {error:{message}} / {message} / {detail}，
     原来最终失败只抛「未取到 video_id：{原文}」——用户看到的是接口异常，
     看不到「免费用户速率限制」这个真实原因，也不知道该等待还是该升级套餐。 */
  function srvErrMsg(j, r){
    var m = j && (j.error && (j.error.message || j.error) || j.message || j.detail);
    if(typeof m === 'string' && m.trim()) return m.trim();
    if(m && typeof m === 'object'){ try{ return JSON.stringify(m); }catch(e){} }
    return String((r && r.text) || '').slice(0, 180);
  }
  /* 限流类（429/503 或命中限流词）：免费账号速率窗口通常按分钟计，
     2s→4s→8s→16s→30s 的五连击全部落在同一窗口内必全军覆没（整批一个都没成功的根因）——
     限流改用 10s→20s→40s→60s→60s 长退避跨窗口；队列满等其它瞬时错误保持短退避。 */
  function isLimit(r, text){
    if(r && (r.status === 429 || r.status === 503)) return true;
    return /限流|速率限制|rate|quota|too many|too_many/i.test(String(text || ''));
  }
  function tryOnce(){
    attempt++;
    return apiPostAgnes(cfg.agnesBase + '/videos', body).then(function(r){
      var j = parseJsonSafe(r.text);
      var vid = (j && (j.video_id || j.id || j.task_id)) || '';
      if(vid) return vid;
      /* 永久 HTTP 校验错误（size/images/audios 超限等）：不重试，原样抛 HTTP 错误 */
      if(r.status >= 400 && !isRetryableVideoErr(r, r.text)){
        throw new Error('HTTP ' + r.status + ' ' + srvErrMsg(j, r));
      }
      /* 瞬时错误（有响应：队列满/限流/503；注意限流也可能是 200 + {error}）且未达上限：退避后重试 */
      if(isRetryableVideoErr(r, r.text) && attempt < max){
        var limit = isLimit(r, r.text);
        var backoff = limit ? Math.min(60000, 10000 * Math.pow(2, attempt - 1))   // 限流：10s→20s→40s→60s→60s
                            : Math.min(30000, 2000 * Math.pow(2, attempt - 1));  // 队列满：2s→4s→8s→16s→30s
        onWait(attempt, backoff, max, limit ? 'limit' : 'queue');
        return wait(backoff).then(tryOnce);
      }
      /* 已达上限或非瞬时：透传服务端真实原因；限流类附行动指引 */
      var msg = srvErrMsg(j, r);
      if(isLimit(r, r.text)){
        throw new Error('API 速率限制：' + msg + '。免费账号有速率限额，请等待 1-2 分钟后重试（不会重复计费），或升级 Token Plan');
      }
      throw new Error('视频提交失败：' + msg);
    }, function(e){
      /* 网络层失败（超时 / 断网 / CORS）：没有响应就无法确认服务端是否已创建任务，
         重试极可能造成重复创建与重复计费 —— 不重试，直接把错误抛给上层。 */
      throw new Error('视频提交未得到响应（' + (e && e.message ? e.message : e) +
        '）。任务可能已在后台创建，请稍后在列表中查看，确认没有成品后再重试。');
    });
  }
  return tryOnce();
}
function genVideo(id){
  var s = shotById(id); if(!s) return Promise.resolve();
  if(guardBudget()) return Promise.resolve();   /* v2.47：预算硬上限，拦截视频生成 */
  if(!hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return Promise.resolve(); }
  if(!s['图片URL']){ toast('请先生成这一镜的图片'); return Promise.resolve(); }
  /* v2.58：该镜已有任务 ID 且仍在途（排队中/生成中）→ 恢复轮询，绝不重新提交。
     刷新页面后 pollers 全丢失、状态冻结在「排队中/生成中」，此时再点生成若走提交逻辑，
     就会创建第二个任务：旧任务在后台继续跑并计费，前端却再也拿不到它（后台计量
     远大于实际成品数的根因之一）。 */
  var st0 = s['视频状态'] || '';
  if(s['任务ID'] && (st0 === '排队中' || st0 === '生成中')){
    startPoll(id);
    toast('第 ' + s['镜号'] + ' 镜已有视频任务在进行中，已恢复进度查询（不会重复提交）');
    return Promise.resolve();
  }
  state.busy[id] = true; refreshAll();
  return submitAgnesVideo(buildVideoBody(s), {
    onWait: function(a, backoff, mx, kind){
      var sh = shotById(id);
      if(sh){ sh['视频状态'] = (kind === 'limit' ? '已触发限流' : '队列已满') + '，退避重试中 (' + a + '/' + mx + ')…'; refreshAll(); }
    }
  }).then(function(vid){
    delete state.busy[id];
    patchShot(id, { 任务ID:String(vid), 视频状态:'排队中', 错误信息:'', 更新时间:nowStr() });
    startPoll(id);
  }).catch(function(e){
    console.error(e);
    delete state.busy[id];
    patchShot(id, { 视频状态:'失败', 错误信息:guessCorsMsg(e).slice(0,300), 更新时间:nowStr() });
    toast('第 ' + s['镜号'] + ' 镜视频提交失败');
  });
}

