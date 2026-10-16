/* ---------- 提示词调试：查看 / 改写最终提示词（专业平台必备） ---------- */
var pmShotId = '';
function showPromptBox(id){
  var s = shotById(id);
  if(!s){ toast('找不到这一镜'); return; }
  pmShotId = id;
  var ip, vp;
  try{ ip = buildImageBody(s).prompt; }catch(e){ ip = '（拼装失败：' + (e.message || e) + '）'; }
  try{ vp = buildVideoBody(s).prompt; }catch(e){ vp = '（拼装失败：' + (e.message || e) + '）'; }
  var nRef = 0;
  try{ nRef = (buildImageBody(s).extra_body.image || []).length; }catch(e){}
  $('pmTitle').textContent = '第 ' + s['镜号'] + ' 镜 · 最终提示词';
  $('pmMsg').innerHTML =
    '<div class="mini" style="margin-bottom:4px">生图提示词（改了就固定用你这份，不再自动拼装）</div>' +
    '<textarea class="inp" id="pmImg" rows="10" style="font-size:12px;line-height:1.55">'+esc(ip)+'</textarea>' +
    '<div class="mini" style="margin:12px 0 4px">生视频提示词</div>' +
    '<textarea class="inp" id="pmVid" rows="5" style="font-size:12px;line-height:1.55">'+esc(vp)+'</textarea>' +
    '<div class="hint" style="margin-top:10px">本镜会额外附带 <b>' + nRef + '</b> 张参考图（角色定妆 / 场景空景 / 基准帧），参考图不在提示词文本里，生成时由接口单独传入。两个框都清空并保存即还原为自动拼装。</div>';
  $('pmBox').classList.add('on'); $('pmMask').classList.add('on');
}
function closePromptBox(){ $('pmBox').classList.remove('on'); $('pmMask').classList.remove('on'); pmShotId = ''; }
function savePromptOverride(){
  var id = pmShotId; if(!id) return;
  var i = String($('pmImg').value || '').trim(), v = String($('pmVid').value || '').trim();
  closePromptBox();
  patchShot(id, { 图片提示词覆盖:i, 视频提示词覆盖:v, 更新时间:nowStr() });
  toast((i || v) ? '已保存改写，下次生成用你这份' : '已还原为自动拼装');
}

/* ---------- 分镜质检 Agent（对标 moyin-creator 质检 Agent） ---------- */
var QA = [];
function auditShots(){
  var shots = sortedShots();
  if(!shots.length){ toast('还没有分镜可以质检'); return; }
  var rate = num(cfg.cnRate) || 4.5;   /* 中文配音语速：字 / 秒 */
  var issues = [], lastSize = '', sameRun = 0, totalSec = 0;
  shots.forEach(function(s){
    var no = s['镜号'], id = s._id, d = shotDur(s);
    totalSec += d;
    /* 1. 时长必须在模型允许的 4–12 秒内 */
    if(num(s['时长秒']) < 4 || num(s['时长秒']) > 12){
      issues.push({ lv:'err', id:id, no:no, text:'时长 ' + (num(s['时长秒'])||0) + ' 秒超出模型允许的 4–12 秒，会被接口整单拒绝', act:'dur', sec:Math.min(12, Math.max(4, Math.round(d || 5))) });
    }
    /* 2. 台词念不完 / 镜头太拖 */
    var line = String(s['台词旁白'] || '').trim();
    if(line){
      var cn = (line.match(/[\u4e00-\u9fa5]/g) || []).length;
      var need = cn / rate;
      if(need > d + 0.3){
        issues.push({ lv:'err', id:id, no:no, act:'dur', sec:Math.min(12, Math.max(4, Math.ceil(need))),
          text:'台词约 ' + cn + ' 字，按 ' + rate + ' 字/秒需 ' + need.toFixed(1) + ' 秒，镜头只有 ' + d.toFixed(1) + ' 秒，配音会念不完' });
      }else if(d - need > 3.5){
        issues.push({ lv:'info', id:id, no:no, act:'dur', sec:Math.min(12, Math.max(4, Math.ceil(need + 0.5))),
          text:'台词只需约 ' + need.toFixed(1) + ' 秒，镜头给了 ' + d.toFixed(1) + ' 秒，成片会拖 ' + (d - need).toFixed(1) + ' 秒' });
      }
    }
    /* 2b. v2.9：逐句 cue 质检 —— 一镜多说话人 / 超长句断句 */
    if(line){
      var qc = parseCues(line), spks = {}, longHit = false;
      qc.forEach(function(c){
        if(c.speaker && c.speaker !== '旁白') spks[c.speaker] = 1;
        if(!longHit && (c.text.match(/[\u4e00-\u9fa5]/g) || []).length > 20) longHit = true;
      });
      var spkNames = Object.keys(spks);
      if(spkNames.length > 1)
        issues.push({ lv:'warn', id:id, no:no, text:'一镜里出现了 ' + spkNames.length + ' 个说话人（' + spkNames.join('、') + '），单音色配音会读串。建议：拆成多镜，或在设置里开「逐句配音」让每句按各自角色的音色合成' });
      if(longHit)
        issues.push({ lv:'info', id:id, no:no, text:'有一句超过 20 字的长台词，字幕一行放不下、配音也容易赶。建议在「逐句编辑」里断句或删减' });
    }
    /* 3. 一致性资产缺口 */
    splitNames(s['出场角色']).forEach(function(n){
      var a = assetByName(n, '角色');
      if(!a) issues.push({ lv:'err', id:id, no:no, act:'role', name:n, text:'出场角色「'+n+'」没有角色卡，无法锁定长相与服装' });
      else if(!a['参考图URL']) issues.push({ lv:'warn', id:id, no:no, act:'gen', text:'角色「'+n+'」还没生成定妆照，本镜只能靠文字描述，漂移风险高' });
    });
    var scn = String(s['场景'] || '').trim();
    if(scn){
      var sc = assetByName(scn, '场景');
      if(!sc) issues.push({ lv:'warn', id:id, no:no, act:'scene', name:scn, text:'场景「'+scn+'」没有场景卡，布局会逐镜变化' });
      else if(!sc['参考图URL']) issues.push({ lv:'warn', id:id, no:no, act:'gen', text:'场景「'+scn+'」还没生成空景图，只能靠文字描述锁定布局' });
    }
    /* 4. 生成状态 */
    if(s['图片状态'] === '失败') issues.push({ lv:'err', id:id, no:no, act:'img', text:'图片生成失败' + (s['错误信息'] ? '：' + String(s['错误信息']).slice(0,80) : '') });
    if(s['视频状态'] === '失败') issues.push({ lv:'err', id:id, no:no, act:'vid', text:'视频生成失败' + (s['错误信息'] ? '：' + String(s['错误信息']).slice(0,80) : '') });
    if(s['配音状态'] === '失败') issues.push({ lv:'err', id:id, no:no, act:'audio', text:'配音生成失败' + (s['错误信息'] ? '：' + String(s['错误信息']).slice(0,80) : '') });
    /* 5. 口型风险 */
    if(s['口型风险'] === '高' && s['口型状态'] !== '已完成' && s['口型状态'] !== '不需要'){
      issues.push({ lv:'warn', id:id, no:no, act:'lip', text:'正面大脸说话，口型对不上风险高，建议改过肩 / 侧脸或做口型同步' });
    }
    /* 6. 连续同景别 */
    var sz = String(s['景别'] || '中景');
    if(sz === lastSize) sameRun++; else { lastSize = sz; sameRun = 1; }
    if(sameRun === 3) issues.push({ lv:'info', id:id, no:no, act:'goto', text:'连续 3 镜都是「'+sz+'」，节奏会单调，建议插一镜其它景别' });
  });
  /* 7. 全局 */
  if(totalSec < 30 && shots.length) issues.push({ lv:'info', id:'', no:'', act:'', text:'全片仅 ' + Math.round(totalSec) + ' 秒，短于 30 秒的竖屏短剧完播率通常较差' });
  QA = issues;
  var cnt = { err:0, warn:0, info:0 };
  issues.forEach(function(i){ cnt[i.lv]++; });
  $('qaTitle').textContent = '分镜质检报告 · ' + shots.length + ' 镜' + (cnt.err || cnt.warn ? '（' + (cnt.err ? cnt.err + ' 个必须处理' : '') + (cnt.err && cnt.warn ? '、' : '') + (cnt.warn ? cnt.warn + ' 个建议处理' : '') + '）' : '（未发现问题）');
  if(!issues.length){
    $('qaMsg').innerHTML = '<div class="hint">没有发现问题，可以去「成片与导出」收尾了。</div>';
  }else{
    var order = { err:0, warn:1, info:2 };
    issues.sort(function(a, b){ return (order[a.lv] - order[b.lv]) || (num(a.no) - num(b.no)); });
    $('qaMsg').innerHTML = issues.map(function(it, i){
      var cls = it.lv === 'err' ? '#D93A3A' : (it.lv === 'warn' ? '#B46B00' : '#5B6076');
      var btns = '';
      if(it.act === 'dur') btns = '<button class="btn sm" data-qa="'+i+'" data-act="dur">改为 ' + it.sec + ' 秒</button>';
      else if(it.act === 'role') btns = '<button class="btn sm" data-qa="'+i+'" data-act="role">建角色卡</button>';
      else if(it.act === 'scene') btns = '<button class="btn sm" data-qa="'+i+'" data-act="scene">建场景卡</button>';
      else if(it.act === 'img' || it.act === 'vid' || it.act === 'audio') btns = '<button class="btn sm" data-qa="'+i+'" data-act="'+it.act+'">重试</button>';
      else if(it.act === 'lip') btns = '<button class="btn sm" data-qa="'+i+'" data-act="lip">AI 规避</button>';
      if(it.id) btns += '<button class="btn gh sm" data-qa="'+i+'" data-act="goto">定位</button>';
      return '<div style="display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--line2)">' +
        '<span style="flex:0 0 auto;font-size:11px;font-weight:700;color:'+cls+';background:'+cls+'1A;padding:2px 7px;border-radius:6px;margin-top:2px">' +
          (it.lv === 'err' ? '必须' : (it.lv === 'warn' ? '建议' : '提示')) + '</span>' +
        '<span style="flex:1;font-size:13px;line-height:1.55">' + (it.no ? '<b>第'+esc(it.no)+'镜</b> · ' : '') + esc(it.text) + '</span>' +
        '<span style="flex:0 0 auto;display:flex;gap:5px">' + btns + '</span></div>';
    }).join('');
  }
  $('qaBox').classList.add('on'); $('qaMask').classList.add('on');
}
function closeQa(){ $('qaBox').classList.remove('on'); $('qaMask').classList.remove('on'); }
function qaDo(i, act){
  var it = QA[i]; if(!it) return;
  if(act === 'dur'){ patchShot(it.id, { 时长秒: it.sec, 更新时间: nowStr() }); toast('第 ' + it.no + ' 镜时长已改为 ' + it.sec + ' 秒'); }
  else if(act === 'role' || act === 'scene'){
    addAsset({ 类型: act === 'role' ? '角色' : '场景', 名称: it.name, 中文描述:'', 英文锚点:'', 参考图URL:'', 状态:'未生成', 错误信息:'', 更新时间: nowStr() });
    toast('已建卡：' + it.name + '，去「② 角色与场景」补全描述后生成设定图');
  }
  else if(act === 'img'){ closeQa(); genImage(it.id); }
  else if(act === 'vid'){ closeQa(); genVideo(it.id); }
  else if(act === 'audio'){ closeQa(); genAudio(it.id); }
  else if(act === 'lip'){ closeQa(); if(typeof avoidLipOne === 'function') avoidLipOne(it.id); else toast('请到该镜的口型区处理'); }
  else if(act === 'goto'){ closeQa(); setView('gen'); state.expanded[it.id] = true; renderGenList(); }
  else return;
  if(act === 'dur' || act === 'role' || act === 'scene') auditShots();   /* 修完重跑，列表实时更新 */
}

/* ---------- AI 一键提取角色与场景（对标火宝角色提取 Agent） ---------- */
var EX = { roles: [], scenes: [] };
function jsonFromText(t){
  var v = jsonParseLoose(t);   /* v2.51：与拆镜共用同一套容错（围栏/注释/中文引号/尾逗号） */
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
}
function aiExtractAssets(){
  var novel = String($('novel').value || '').trim();
  if(!novel && state.chapters.length){
    novel = state.chapters.map(function(c){ return String(c.title || '') + '\n' + String(c.text || ''); }).join('\n');
  }
  if(!novel){ toast('请先在「剧本拆镜」粘贴小说原文'); return; }
  if(!cfg.textKey || !cfg.textModel){ toast('请先在设置里配置文本模型'); openDrawer(); return; }
  toast('正在让模型读全文提取角色与场景…');
  apiPost(cfg.textBase.replace(/\/+$/, '') + '/chat/completions', cfg.textKey, {
    model: cfg.textModel,
    messages: [
      { role:'system', content:
        '你是影视美术与选角助理。从用户给的小说正文里，提取出真正的主要角色（3–8 个）与主要场景（3–8 个）。\n' +
        '只输出 JSON，不要任何解释文字、不要 markdown 代码块标记。格式：\n' +
        '{"roles":[{"name":"","gender_age":"","hair":"","top":"","bottom":"","accessory":"","persona":"","desc":"","en":"","voice":""}],\n' +
        ' "scenes":[{"name":"","time_light":"","props":"","desc":"","en":""}]}\n' +
        '要求：\n' +
        '- name 用小说里出现的人名/称呼，场景名要短且稳定，后续会用来跨镜匹配。\n' +
        '- desc 是中文外貌/环境描述，30–60 字。\n' +
        '- en 是英文一致性锚点，必须具体到可复现：年龄、性别、发型发色、面部特征、服装款式与配色（角色）；空间布局、门窗墙面地面家具位置、材质与色调（场景）。40–80 个英文单词。\n' +
        '- voice 给出适合该角色的 TTS 音色风格提示，如「青年女声，清亮」/「中年男声，低沉沙哑」。\n' +
        '- persona 是性格与说话方式，会喂给画面情绪与配音。\n' +
        '- 只提取反复出现、对剧情重要的，龙套不要。'
      },
      { role:'user', content: '小说正文：\n' + novel.slice(0, 24000) }
    ],
    temperature: 0.4
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + String(r.text).slice(0, 180));
    var content = j && j.choices && j.choices[0] && (j.choices[0].message && j.choices[0].message.content || j.choices[0].text);
    if(!content) throw new Error('模型没有返回内容：' + String(r.text).slice(0, 180));
    var o = jsonFromText(content);
    if(!o) throw new Error('没能解析出 JSON，原始返回：' + String(content).slice(0, 200));
    var roles = Array.isArray(o.roles) ? o.roles : [];
    var scenes = Array.isArray(o.scenes) ? o.scenes : [];
    if(!roles.length && !scenes.length) throw new Error('模型没提取出任何角色或场景');
    EX.roles = roles.filter(function(x){ return String(x.name || '').trim(); }).slice(0, 12);
    EX.scenes = scenes.filter(function(x){ return String(x.name || '').trim(); }).slice(0, 12);
    renderExtractPreview();
  }).catch(function(e){
    console.error(e);
    toast('提取失败：' + (e.message || e).toString().slice(0, 120));
  });
}
function renderExtractPreview(){
  var rHtml = EX.roles.length ? EX.roles.map(function(x, i){
    var nm = esc(String(x.name).trim());
    var dup = assetByName(String(x.name).trim(), '角色') ? ' <span class="tag warn">已存在，写入会跳过</span>' : '';
    return '<label style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line2)">' +
      '<input type="checkbox" data-ex="r' + i + '" checked style="margin-top:3px">' +
      '<span><b>' + nm + '</b>' + dup +
      '<div class="hint" style="margin-top:2px">' + esc([x.gender_age, x.hair, x.top, x.bottom, x.accessory].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="hint" style="margin-top:2px">性格：' + esc(x.persona || '—') + '　音色：' + esc(x.voice || '—') + '</div>' +
      '<div class="hint" style="margin-top:2px;color:#5B5BD6">EN：' + esc(String(x.en || '').slice(0, 160)) + '</div></span></label>';
  }).join('') : '<div class="hint">没提取到角色</div>';
  var sHtml = EX.scenes.length ? EX.scenes.map(function(x, i){
    var nm = esc(String(x.name).trim());
    var dup = assetByName(String(x.name).trim(), '场景') ? ' <span class="tag warn">已存在，写入会跳过</span>' : '';
    return '<label style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line2)">' +
      '<input type="checkbox" data-ex="s' + i + '" checked style="margin-top:3px">' +
      '<span><b>' + nm + '</b>' + dup +
      '<div class="hint" style="margin-top:2px">' + esc([x.time_light, x.props].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="hint" style="margin-top:2px;color:#5B5BD6">EN：' + esc(String(x.en || '').slice(0, 160)) + '</div></span></label>';
  }).join('') : '<div class="hint">没提取到场景</div>';
  $('exTitle').textContent = 'AI 提取到 ' + EX.roles.length + ' 个角色、' + EX.scenes.length + ' 个场景';
  $('exMsg').innerHTML =
    '<div class="mini" style="margin-bottom:2px">角色（勾选要写入的）</div>' + rHtml +
    '<div class="mini" style="margin:14px 0 2px">场景</div>' + sHtml +
    '<div class="hint" style="margin-top:12px">写入后仍可在卡片里改描述；英文锚点越具体，跨镜长相与布局越稳。</div>';
  $('exBox').classList.add('on'); $('exMask').classList.add('on');
}
function closeExtract(){ $('exBox').classList.remove('on'); $('exMask').classList.remove('on'); }
function saveExtracted(){
  var picks = [];
  $('exMsg').querySelectorAll('input[data-ex]').forEach(function(cb){
    if(!cb.checked) return;
    var k = cb.getAttribute('data-ex'), i = num(k.slice(1));
    if(k.charAt(0) === 'r'){
      var x = EX.roles[i]; if(!x) return;
      picks.push({ 类型:'角色', 名称:String(x.name).trim(), 性别年龄:String(x.gender_age||'').trim(), 发型:String(x.hair||'').trim(),
        上装:String(x.top||'').trim(), 下装:String(x.bottom||'').trim(), 配饰道具:String(x.accessory||'').trim(),
        性格语气:String(x.persona||'').trim(), TTS音色:String(x.voice||'').trim(),
        中文描述:String(x.desc||'').trim(), 英文锚点:String(x.en||'').trim() });
    }else{
      var y = EX.scenes[i]; if(!y) return;
      picks.push({ 类型:'场景', 名称:String(y.name).trim(), 性别年龄:String(y.time_light||'').trim(), 常服:String(y.props||'').trim(),
        中文描述:String(y.desc||'').trim(), 英文锚点:String(y.en||'').trim() });
    }
  });
  var todo = picks.filter(function(p){ return !assetByName(p['名称'], p['类型']); });
  if(!todo.length){ toast('勾选的都已在设定表里了'); closeExtract(); return; }
  closeExtract();
  toast('正在写入 ' + todo.length + ' 张设定卡…');
  /* v2.30：改 runSerial——原来一条失败整链断（后面的都不写），却仍报「已写入 N 张」 */
  runSerial(todo.map(function(p){
    return function(){
      return addAsset(Object.assign({ 参考图URL:'', 参考图2:'', 状态:'未生成', 错误信息:'', 更新时间:nowStr() }, p));
    };
  }), { label: '写入设定卡', tag: 'add' }).then(function(r){
    if(r.fail) toast('写入未完成：成功 ' + r.ok + ' 张、失败 ' + r.fail + ' 张');
    else toast('已写入 ' + r.ok + ' 张设定卡，去填描述并生成设定图');
    setView('asset');
  });
}

/* --- 文本模型：拆镜 --- */
var SIZES = ['远景','全景','中景','近景','特写','大特写'];
function splitShotObj(it, sec){
  var size = String(it.shot_size || it.size || '').trim();
  if(SIZES.indexOf(size) === -1) size = '中景';
  var speaker = String(it.speaker || '').trim();
  if(speaker === '旁白' || speaker === 'narrator' || speaker === 'Narrator') speaker = '';
  var o = {
    镜号: num(it.shot), 画面描述: it.scene || '', 英文提示词: it.prompt || '',
    运镜: it.camera || '', 台词旁白: it.line || '', 时长秒: num(it.seconds) || sec,
    出场角色: charStr(it.characters), 场景: it.location || '',
    景别: size, 说话角色: speaker, 角色情绪: String(it.emotion || '').trim(),
    光影氛围: String(it.lighting || it.light || '').trim(),
    图片状态:'未生成', 视频状态:'未生成', 配音状态:'未生成', 满意锁定:'否',
    口型风险: '低', 口型状态: '不需要',
    图片URL:'', 视频URL:'', 音频URL:'', 音频时长:0, 任务ID:'', 错误信息:'', 更新时间:nowStr(), pid: state.pid
  };
  o['口型风险'] = lipRiskOf(o);
  return o;
}
function splitShots(){
  var novel = $('novel').value.trim();
  if(!novel){ toast('请先粘贴小说原文'); return; }
  if(!cfg.textKey || !cfg.textModel){ toast('请先在设置里配置文本模型'); openDrawer(); return; }
  var n = num($('shotCount').value) || 8, sec = num($('shotSec').value) || 5, style = $('shotStyle').value.trim();
  var sys = buildSplitSys(n, sec, style);   /* 与长篇流水线共用：含跨章词表 + 口型规避 */
  var box = $('splitResult');
  box.className = 'result show'; box.textContent = '正在让模型拆镜，请稍候…';
  apiPost(cfg.textBase.replace(/\/+$/,'') + '/chat/completions', cfg.textKey, {
    model: cfg.textModel,
    messages: [{ role:'system', content: sys }, { role:'user', content: novel.slice(0, 20000) }],
    temperature: 0.7
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    if(r.status >= 400){ throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0,180)); }
    var content = j && j.choices && j.choices[0] && (j.choices[0].message && j.choices[0].message.content || j.choices[0].text);
    if(!content) throw new Error('模型没有返回内容：' + r.text.slice(0,180));
    var arr = parseShotArray(content);
    if(!arr.length) throw new Error('没能解析出分镜数组，原始返回：' + String(content).slice(0,200));
    return arr;
  }).then(function(arr){
    var p = db();
    pushUndo();                     /* v2.31：一次塞进来几十镜，可撤销 */
    if(!p){
      arr.forEach(function(it){
        state.shots.push(Object.assign({ _id: newId() }, splitShotObj(it, sec)));
      });
      localSave(state.shots);
      return arr.length;
    }
    setSync('busy');
    /* v2.30：改 runSerial，返回**实际成功条数**（原来固定返回 arr.length，失败也谎报「已写入 N 个」） */
    return runSerial(arr.map(function(it){
      return function(){ return p.addRecord({ databaseId: DB_ID, properties: toProps(splitShotObj(it, sec)) }); };
    }), { label: '写入分镜', tag: 'split' }).then(function(r){
      /* v2.34：叫停也要说清楚（原来只报失败，中途停了会当成「拆镜完成」） */
      if(r.stopped) toast('已停止写入：进了 ' + r.ok + ' 个分镜，剩下的没动');
      else if(r.fail) toast('拆镜未完成：成功写入 ' + r.ok + ' 个、失败 ' + r.fail + ' 个');
      return r.ok;
    });
  }).then(function(cnt){
    /* v2.32：等设定卡真的建完（syncAssetsFromShots 现在返回 Promise），
       原来这里拿到的是同步的「计划张数」，提示里写的张数可能根本还没建出来 */
    return loadShots().then(function(){ return syncAssetsFromShots().then(function(made){ return { cnt: cnt, made: made }; }); });
  }).then(function(r){
    refreshAll();
    box.className = 'result show ok';
    box.textContent = '拆镜完成，已写入 ' + r.cnt + ' 个分镜' + aiParseNoteTxt() +
      (r.made ? '；并自动建了 ' + r.made + ' 张设定卡（角色/场景）。下一步：去「② 角色与场景」填描述并生成设定图，然后再生分镜图。'
              : '。下一步：去「② 角色与场景」确认设定卡，生成设定图后再生成分镜图。');
    if(r.made) setView('asset');
  }).catch(function(e){
    console.error(e);
    box.className = 'result show bad';
    box.textContent = guessCorsMsg(e);
  });
}
/* v2.51：AI 输出的 JSON 容错解析。
   模型常返回带尾逗号 / 中文引号 / 注释 / 代码块围栏 / Python 风格字面量的「畸形 JSON」，
   甚至撞上 max_tokens 被拦腰截断。旧版只剥离围栏，一遇到这些就整章报废、只能重跑（费钱费时）。
   现在分三步：① 合法 JSON 原样直过（绝不改写，避免破坏字符串内部的中文引号）；
   ② 失败则逐级修复（围栏→注释→中文引号→Python 字面量→尾逗号），每级都试一次；
   ③ 仍失败则括号平衡扫描，抢救被截断数组里**已经完整的**元素——部分成功好过全废。
   AI_PARSE_NOTE 记录本次是否走了降级，供调用方提示。 */
var AI_PARSE_NOTE = '';
function jsonParseLoose(txt){
  var raw = String(txt == null ? '' : txt).trim();
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){}          /* ① 合法 JSON 优先，不做任何改写 */
  var s = raw.replace(/```(?:json|JSON)?/g, '').trim();
  var i1 = s.indexOf('['), i2 = s.indexOf('{'), a, b;
  if(i1 > -1 && (i2 === -1 || i1 < i2)){ a = i1; b = s.lastIndexOf(']'); }
  else { a = i2; b = s.lastIndexOf('}'); }
  var body = (a > -1 && b > a) ? s.slice(a, b + 1) : s;
  try{ return JSON.parse(body); }catch(e){}
  var fixes = [                                      /* ② 逐级修复 */
    function(t){ return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)[ \t]*\/\/[^\n\r]*/g, '$1'); },
    function(t){ return t.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"'); },
    function(t){ return t.replace(/\b(?:undefined|NaN|None)\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false'); },
    function(t){ return t.replace(/,\s*([}\]])/g, '$1'); }
  ];
  var cur = body, k;
  for(k = 0; k < fixes.length; k++){
    cur = fixes[k](cur);
    try{ return JSON.parse(cur); }catch(e){}
  }
  return null;
}
/* 括号平衡扫描：逐段切出顶层 {...}，能 parse 的就收下（用于截断抢救） */
function jsonObjectsLoose(str){
  var out = [], depth = 0, start = -1, inStr = false, esc = false, i, ch;
  var t = String(str == null ? '' : str);
  for(i = 0; i < t.length; i++){
    ch = t.charAt(i);
    if(inStr){
      if(esc) esc = false;
      else if(ch === '\\') esc = true;
      else if(ch === '"') inStr = false;
      continue;
    }
    if(ch === '"'){ inStr = true; continue; }
    if(ch === '{'){ if(depth === 0) start = i; depth++; }
    else if(ch === '}'){
      if(depth > 0) depth--;
      if(depth === 0 && start > -1){
        try{ out.push(JSON.parse(t.slice(start, i + 1))); }catch(e){}
        start = -1;
      }
    }
  }
  return out;
}
function aiParseNoteTxt(){
  if(!AI_PARSE_NOTE) return '';
  if(AI_PARSE_NOTE.indexOf('partial:') === 0) return '（模型返回被截断，已抢救回 ' + AI_PARSE_NOTE.slice(8) + ' 个完整分镜）';
  return '（模型返回格式有小问题，已自动修复）';
}
/* 抢救出来的对象必须「像分镜」：至少命中一个拆镜字段。
   否则模型返回 {} 或 {"msg":"…"} 这类非分镜内容时，会被当成 1 个空镜写进表里。 */
var SHOT_LIKE_KEYS = ['shot', 'scene', 'prompt', 'camera', 'line', 'seconds', 'characters',
  'location', 'shot_size', 'size', 'speaker', 'emotion', 'lighting',
  '镜号', '画面描述', '英文提示词', '台词旁白'];
function isShotLike(o){
  if(!o || typeof o !== 'object' || Array.isArray(o)) return false;
  for(var i = 0; i < SHOT_LIKE_KEYS.length; i++){
    if(Object.prototype.hasOwnProperty.call(o, SHOT_LIKE_KEYS[i])) return true;
  }
  return false;
}
function parseShotArray(txt){
  AI_PARSE_NOTE = '';
  var v = jsonParseLoose(txt), i;
  if(Array.isArray(v)) return v;
  if(v && typeof v === 'object'){                    /* 有些模型会包一层 {"shots":[...]} */
    var ks = ['shots', 'data', 'list', 'result', 'results'];
    for(i = 0; i < ks.length; i++){
      if(Array.isArray(v[ks[i]])){ AI_PARSE_NOTE = 'fixed'; return v[ks[i]]; }
    }
  }
  var got = jsonObjectsLoose(txt).filter(isShotLike);  /* ③ 截断抢救：只收像分镜的 */
  if(got.length){
    AI_PARSE_NOTE = 'partial:' + got.length;
    console.warn('[parseShotArray] JSON 解析失败，已降级抢救 ' + got.length + ' 个分镜');
    return got;
  }
  return [];
}

/* ---------------- 批量 ---------------- */
/* v2.18：把「开进度条 → runPool → 收尾（暂停/完成/候选/失败）」抽成一处。
   原先 batch() 与 batchAudio() 各写一套收尾，改一处漏一处；现在普通批量与
   「只跑剩余镜」直投都走这里，收尾口径只有一个。
   kind: 'img' | 'vid' | 'audio'；opts.resume = true 表示这是续跑（面板标题/文案区分）。
   返回 Promise，resolve 剩余未完成数（0 = 全部跑完）。 */
/* v2.19：跑前预检。生视频但没有图片、配音但没有台词，跑到它们时 genVideo/genAudio 只会弹一句提示就返回，
   既白占一个进度名额，又容易被当成「跑了没结果」。提前剔出去，进度只反映真正有活干的数量。 */
function preflightShots(list, kind){
  var run = [], skip = [];
  (list || []).forEach(function(s){
    if(kind === 'vid' && !s['图片URL']) skip.push({ s: s, why: '没图片' });
    else if(kind === 'audio' && !String(s['台词旁白'] || '').trim()) skip.push({ s: s, why: '没台词' });
    /* v2.23：对口型只做「高风险 + 已有视频」的镜，别的镜头交给唇形服务纯属白花钱 */
    else if(kind === 'lip' && !s['视频URL']) skip.push({ s: s, why: '没视频' });
    else if(kind === 'lip' && String(s['口型风险'] || lipRiskOf(s)) !== '高') skip.push({ s: s, why: '口型风险不高' });
    else run.push(s);
  });
  return { run: run, skip: skip };
}
function skipWhyTxt(skip){
  var c = {}, k, parts = [];
  (skip || []).forEach(function(x){ c[x.why] = (c[x.why] || 0) + 1; });
  for(k in c) parts.push(c[k] + ' 个' + k);
  return parts.join('、');
}
/* v2.20：关键字段体检。跟「跑前预检」不同——预检判断的是「这一步现在能不能跑」，
   体检判断的是「这条数据本身有没有缺料」：缺画面描述 → 生图只能瞎编；没时长 → 成片时长对不上；
   没章节 → 分集打包会乱；有台词没角色 → 配音音色匹配不上。
   分「硬性」与「软性」两档：硬性问题会挡出图/成片质量，软性问题只影响组织方式。
   全部只是提示，不阻断批量——用户可以明知故犯。 */
var HEALTH_HARD = { '缺画面描述':1, '无生图提示词':1, '没时长':1 };
function shotHealth(shots){
  var out = [];
  (shots || []).forEach(function(s){
    var issues = [];
    if(!String(s['画面描述'] || '').trim()) issues.push('缺画面描述');
    if(!String(s['英文提示词'] || '').trim() && !String(s['图片提示词覆盖'] || '').trim()) issues.push('无生图提示词');
    if(!(num(s['时长秒']) > 0)) issues.push('没时长');
    if(!String(s['章节'] || '').trim()) issues.push('没章节');
    if(String(s['台词旁白'] || '').trim() && !String(s['说话角色'] || '').trim()) issues.push('有台词没角色');
    if(issues.length) out.push({ no: num(s['镜号']), id: s._id, issues: issues });
  });
  return out;
}
/* 硬性问题条数（一条镜可能同时命中多条）：>0 才值得在首页弹体检卡，免得软性提示天天刷存在感 */
function healthHardCount(issues){
  var n = 0;
  (issues || []).forEach(function(x){ x.issues.forEach(function(t){ if(HEALTH_HARD[t]) n++; }); });
  return n;
}
function healthSummary(issues){
  var c = {}, arr = issues || [];
  arr.forEach(function(x){ x.issues.forEach(function(t){ c[t] = (c[t] || 0) + 1; }); });
  /* 硬性问题排前面（更该先补），同档再按数量降序，最后按名字稳定排序 */
  var order = Object.keys(c).sort(function(a, b){
    var ha = HEALTH_HARD[a] ? 1 : 0, hb = HEALTH_HARD[b] ? 1 : 0;
    return (hb - ha) || (c[b] - c[a]) || (a < b ? -1 : 1);
  });
  return { count: arr.length, byType: c, order: order };
}
/* v2.28：哪些问题能靠本地规则自动推定——与 healthFixables 的三类一一对应（dur / chap / role）。
   明细里给这些组打「可自动修复」标，用户一眼知道哪几组不必手点。 */
var FIX_KIND_OF = { '没时长':'dur', '没章节':'chap', '有台词没角色':'role' };
/* v2.28：体检明细按「问题类型」分组——一个人查 200 条时，按镜号平铺看不出主次；
   分组后能先集中处理某类问题（比如先把所有「没时长」补掉）。硬性组在前，
   同档按条数降序，组内保持镜号顺序（与全片一致）。纯函数，便于单测。 */
function healthGroupRows(issues){
  var map = {}, arr = issues || [];
  arr.forEach(function(x){
    x.issues.forEach(function(t){
      if(!map[t]) map[t] = [];
      map[t].push(x);
    });
  });
  return Object.keys(map).map(function(t){
    return { type: t, hard: !!HEALTH_HARD[t], fixKind: FIX_KIND_OF[t] || '', rows: map[t] };
  }).sort(function(a, b){
    return ((b.hard ? 1 : 0) - (a.hard ? 1 : 0)) || (b.rows.length - a.rows.length) || (a.type < b.type ? -1 : 1);
  });
}
/* v2.29：记住体检明细各分组的展开状态。<details> 的 toggle 事件**不冒泡**，所以只能在
   document 上用捕获阶段监听；只认带 data-hg 的分组（别处用 details 不受影响）。 */
var _hgBound = false;
function bindHealthGroupToggle(){
  if(_hgBound) return;
  _hgBound = true;
  document.addEventListener('toggle', function(ev){
    var d = ev.target;
    if(!d || d.tagName !== 'DETAILS') return;
    var k = d.getAttribute('data-hg');
    if(!k) return;
    cfg.healthOpen = cfg.healthOpen || {};
    cfg.healthOpen[k] = !!d.open;
    saveCfg();
  }, true);
}
/* 体检明细：不导出时也能在页面上扫一眼（对话框内滚动，最多列 200 条）
   v2.27：从「只读清单」升级为可操作——每条带「去改」直接跳到那一镜；
   顶部给「一键自动修复(N)」「只补时长」两个就地动作，修完/取消都自动重列，方便复查还剩什么。 */
function showHealthBox(){
  var iss = shotHealth(state.shots);
  if(!iss.length){ toast('没有发现关键字段缺失，数据挺完整'); return; }
  var fixSum = healthFixSummary();
  var quick = fixSum.total
    ? '<div class="tools" style="margin:0 0 10px;gap:8px">' +
        '<button class="btn sm" data-act="hfixallbox">一键自动修复(' + fixSum.total + ')</button>' +
        '<button class="btn gh sm" data-act="hfixdurbox">只补时长</button>' +
        '<span class="hint" style="margin:0">可自动推定：' + esc(fixSum.txt) + '</span>' +
      '</div>'
    : '';
  /* v2.28：按问题类型分组——每组一个可折叠的 <details>（原生折叠，零 JS 状态），
     硬性组默认展开；组头带条数与「可自动修复」标，方便一类一类集中处理。
     v2.29：折叠状态记进 cfg.healthOpen，下次打开保持上次的展开/收起（没记住的回落硬性默认展开）。 */
  var shown = iss.slice(0, 200);
  var hgOpen = cfg.healthOpen || {};
  var rows = healthGroupRows(shown).map(function(g){
    var openIt = (g.type in hgOpen) ? !!hgOpen[g.type] : !!g.hard;
    var head = '<summary style="cursor:pointer;padding:6px 2px;font-weight:600">' +
      (g.hard ? '<span style="color:#B45309">'+svgIc('dot',12)+'</span> ' : '<span style="color:var(--tx3)">'+svgIc('dotO',12)+'</span> ') +
      esc(g.type) +
      ' <span style="font-weight:400;color:var(--tx3)">' + g.rows.length + ' 条</span>' +
      (g.fixKind ? ' <span style="font-weight:400;color:#1F7A3D">可自动修复</span>' : '') +
      '</summary>';
    var body = g.rows.map(function(x){
      var extra = x.issues.length > 1 ? '<span style="color:var(--tx3)">　（共 ' + x.issues.length + ' 项）</span>' : '';
      return '<div style="padding:4px 0 4px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">' +
        '<span style="flex:1">第 <b>' + x.no + '</b> 镜' + extra + '</span>' +
        '<button class="btn gh sm" data-act="hfixone" data-id="' + esc(x.id) + '">去改</button></div>';
    }).join('');
    return '<details' + (openIt ? ' open' : '') + ' data-hg="' + esc(g.type) + '" style="border-bottom:1px solid var(--line)">' + head + body + '</details>';
  }).join('');
  var more = iss.length > 200 ? '<div style="margin-top:8px;color:var(--tx3)">只显示前 200 条，完整清单请点「导出报告」。</div>' : '';
  bindHealthGroupToggle();
  $('dlgTitle').textContent = '关键字段体检（' + iss.length + ' 个镜头）';
  $('dlgMsg').innerHTML = quick + '<div style="max-height:52vh;overflow:auto;text-align:left">' + rows + more + '</div>' +
    '<div class="hint" style="text-align:left;margin-top:8px">按问题类型分组，点组头可折叠；点每条「去改」直接跳到那一镜；改完再点「查看明细」复查。</div>';
  $('dlgNo').style.display = 'none';
  $('dlgYes').textContent = '知道了'; $('dlgYes').className = 'btn';
  $('dlgYes').style.display = '';
  $('dialog').classList.add('on'); $('dlgMask').classList.add('on');
  _dlgInput = false;
  _dlgResolve = function(){};
}
function buildHealthText(){
  var iss = shotHealth(state.shots);
  if(!iss.length) return null;
  var hs = healthSummary(iss), lines = [];
  lines.push('关键字段体检报告');
  lines.push('生成时间：' + nowStr());
  lines.push('镜头总数：' + state.shots.length + '　　有缺料的镜头：' + iss.length);
  lines.push('');
  lines.push('按问题类型统计：');
  hs.order.forEach(function(k){ lines.push('　' + k + '：' + hs.byType[k] + ' 个'); });
  lines.push('');
  lines.push(['镜号', '问题'].join('\t'));
  iss.forEach(function(x){ lines.push([x.no, x.issues.join('、')].join('\t')); });
  lines.push('');
  lines.push('说明：缺画面描述 / 没时长 / 无生图提示词 会直接影响出图与成片时长，建议先补齐；');
  lines.push('　　　没章节、有台词没角色 属软性提示，影响分集打包与配音音色匹配。');
  return lines.join('\n');
}
function exportHealthReport(){
  var txt = buildHealthText();
  if(!txt){ toast('没有发现关键字段缺失，无需导出'); return; }
  download('关键字段体检_' + nowStr().replace(/[: ]/g, '-') + '.txt', txt, 'text/plain;charset=utf-8');
  toast('已导出体检报告');
}
/* v2.25：按台词字数估算镜头时长——与字幕 cue 同一套语速口径（cueEst），clamp 到 4–12 秒（对齐 shotDur）。
   仅当有台词时给出估值；无台词的空镜返回 null，不替用户乱填时长。 */
function estShotDurFromText(s){
  var txt = String(s['台词旁白'] || '').trim();
  if(!txt) return null;
  var rate = num(cfg.cnRate) || 4.5;
  var cues = (cfg.srtCue !== false) ? parseCues(txt) : [{ text: txt }];
  var sum = 0;
  cues.forEach(function(c){ sum += cueEst(c, rate); });
  if(sum <= 0) return null;
  return Math.min(12, Math.max(4, sum));
}
/* v2.26：把「能靠本地规则确定推出的」缺料项挑出来——只做有确定依据的推断，猜不出的（缺画面描述 /
   无生图提示词）一律留给人，绝不瞎填。三类：
   ① 没时长 + 有台词 → 按台词字数估（estShotDurFromText，与字幕同一语速口径）
   ② 没章节 → 先「承前」取该镜之前最近的非空章节；若它前面一条都没有（前导缺章节），再「承后」
      取其后最近的非空章节（v2.27 双向）。首尾都找不到才留给人（整片都没章节）。
   ③ 有台词没角色 + 该镜「出场角色」恰好 1 人 → 只能是他，直接填
   kinds 可只取其中几类（如 ['dur'] 就是 v2.25 的「只补时长」）。 */
function healthFixables(kinds){
  kinds = kinds || ['dur', 'chap', 'role'];
  var want = {};
  kinds.forEach(function(k){ want[k] = 1; });
  var shots = state.shots, n = shots.length, out = { dur: [], chap: [], role: [] };
  /* 预扫「承后」表：nextChap[i] = 第 i 镜之后最近的一个非空章节（没有则为空） */
  var nextChap = new Array(n), nxt = '';
  for(var i = n - 1; i >= 0; i--){
    nextChap[i] = nxt;
    var ci = String(shots[i]['章节'] || '').trim();
    if(ci) nxt = ci;
  }
  var prevChap = '';
  shots.forEach(function(s, idx){
    var c = String(s['章节'] || '').trim();
    /* 章节先判承接、再更新 prevChap，否则会把自己当成「前一个」 */
    if(want.chap && !c){
      var take = prevChap || nextChap[idx];
      if(take) out.chap.push({ s: s, val: take });
    }
    if(c) prevChap = c;
    if(want.dur && !(num(s['时长秒']) > 0)){
      var d = estShotDurFromText(s);
      if(d != null) out.dur.push({ s: s, val: d });
    }
    if(want.role && String(s['台词旁白'] || '').trim() && !String(s['说话角色'] || '').trim()){
      var cast = splitNames(s['出场角色']);
      if(cast.length === 1) out.role.push({ s: s, val: cast[0] });
    }
  });
  return out;
}
/* 可自动修复的总项数 + 分项摘要（首页体检卡用它决定按钮文案，不写库、无副作用） */
function healthFixSummary(kinds){
  var p = healthFixables(kinds);
  var parts = [];
  if(p.dur.length) parts.push('时长 ' + p.dur.length);
  if(p.chap.length) parts.push('章节 ' + p.chap.length);
  if(p.role.length) parts.push('角色 ' + p.role.length);
  return { total: p.dur.length + p.chap.length + p.role.length, txt: parts.join('、') };
}
/* v2.27：真正落库那一半单独抽出来——好测（不碰确认弹窗）、也好被别处复用
   v2.28：改走 bulkPatch——一次确认里常有上百项（且同一镜往往既缺时长又缺章节），
   逐条 patchShot 会触发上百次全量落盘 + 上百次整页重排；合并后只落盘/刷新一次。 */
function applyHealthFix(plan){
  var t = nowStr(), ups = [];
  plan.dur.forEach(function(x){ ups.push({ id: x.s._id, obj: { 时长秒: x.val, 更新时间: t } }); });
  plan.chap.forEach(function(x){ ups.push({ id: x.s._id, obj: { 章节: x.val, 更新时间: t } }); });
  plan.role.forEach(function(x){ ups.push({ id: x.s._id, obj: { 说话角色: x.val, 更新时间: t } }); });
  if(ups.length) pushUndo();      /* v2.31：体检一键修复会一次改掉几十镜，先存快照再写 */
  bulkPatch(ups);
  return ups.length;
}
/* v2.26：一键自动修复——一次确认把上面三类能推定的项批量写入（patchShot 落库），修完分类汇报。
   缺画面描述 / 无生图提示词 无法本地推定，会明确告诉用户还得手补。
   v2.27 修 bug：askConfirm 返回的是 Promise，原来把它当布尔做否定判断（恒为假），
   用户在确认框点「取消」也照样改数据。现改为在 .then 里判 ok。
   after：可选回调，确认/取消后都会调用（体检明细里用它重列清单）。 */
function fixHealthAuto(kinds, after){
  var plan = healthFixables(kinds);
  var total = plan.dur.length + plan.chap.length + plan.role.length;
  if(!total){
    toast(kinds && kinds.length === 1 && kinds[0] === 'dur'
      ? '没有「既没时长、又有台词」的镜头可自动补（空镜不会动）'
      : '没有可自动修复的项（缺画面描述 / 无生图提示词 只能人工补）');
    if(after) after();
    return;
  }
  var parts = [];
  if(plan.dur.length) parts.push('补时长 ' + plan.dur.length + ' 个');
  if(plan.chap.length) parts.push('补章节 ' + plan.chap.length + ' 个');
  if(plan.role.length) parts.push('补说话角色 ' + plan.role.length + ' 个');
  var msg = '将自动修复 ' + total + ' 项：' + parts.join('、') + '。\n' +
    '规则：时长按台词字数估算（语速 ' + (num(cfg.cnRate) || 4.5) + ' 字/秒，4–12 秒）；' +
    '章节先取该镜之前最近的非空章节、前面没有就承接其后最近的非空章节；' +
    '说话角色仅在出场角色恰为 1 人时填入。\n' +
    '缺画面描述 / 无生图提示词 无法本地推定，会留给你手动补。';
  askConfirm(msg, '一键自动修复').then(function(ok){
    if(ok){
      applyHealthFix(plan);   /* v2.28：内部走 bulkPatch，落库后自己刷新，这里不必再 renderToday */
      toast('已自动修复 ' + total + ' 项（' + parts.join('、') + '）');
    }
    if(after) after();
  });
}
/* v2.25 的细粒度入口：只补时长，等价于自动修复的一个子集（保留给「先补时长看看」的场景） */
function fixDurationsAuto(){ fixHealthAuto(['dur']); }
/* v2.22：体检报告的「表格行」——xlsx 与打包里的 CSV 共用同一份数据，两处口径不会打架。
   硬性 / 软性单独一列，用户在 Excel 里能直接按列排序、筛选。 */
function buildHealthRows(){
  var iss = shotHealth(state.shots);
  if(!iss.length) return null;
  var hs = healthSummary(iss), rows = [];
  rows.push(['关键字段体检报告']);
  rows.push(['生成时间', nowStr()]);
  rows.push(['镜头总数', state.shots.length, '有缺料的镜头', iss.length]);
  rows.push([]);
  rows.push(['按问题类型统计']);
  rows.push(['问题', '数量', '档次']);
  hs.order.forEach(function(k){ rows.push([k, hs.byType[k], HEALTH_HARD[k] ? '硬性' : '软性']); });
  rows.push([]);
  rows.push(['镜号', '问题', '含硬性缺料']);
  iss.forEach(function(x){
    rows.push([num(x.no), x.issues.join('、'), x.issues.some(function(t){ return HEALTH_HARD[t]; }) ? '是' : '否']);
  });
  rows.push([]);
  rows.push(['说明', '缺画面描述 / 没时长 / 无生图提示词 会直接影响出图与成片时长；没章节、有台词没角色 属软性提示。']);
  /* v2.23：告诉 xlsx「哪几行加粗」——标题 + 分区标题 + 两个表头（行号随问题类型数变化，所以在这里算） */
  rows._bold = [1, 5, 6, 8 + hs.order.length];
  return rows;
}
function exportHealthXlsx(){
  var rows = buildHealthRows();
  if(!rows){ toast('没有发现关键字段缺失，无需导出'); return; }
  downloadXlsx('关键字段体检_' + nowStr().replace(/[: ]/g, '-') + '.xlsx',
    [{ name: '体检报告', rows: rows, style: { boldRows: sheetBoldRows(rows), freeze: 1 } }]);
}
/* v2.22：剩余清单的表格行（单类型）。与 buildLeftText 同一口径，只是拆成二维数组给 xlsx 用。 */
function buildLeftSheet(kind){
  var rec = (batchLoadAll() || {})[kind];
  if(!rec || !rec.ids || !rec.ids.length) return null;
  var byNo = {};
  (state.shots || []).forEach(function(s){ byNo[String(num(s['镜号']))] = s; });
  var stKey = batchStKey(kind);
  var rows = [];
  rows.push(['剩余' + batchLeftName(kind) + '清单']);
  rows.push(['导出时间', nowStr()]);
  rows.push(['计划总数', num(rec.total) || rec.ids.length, '未完成', rec.ids.length, '上次记录', rec.at || '—']);
  rows.push([]);
  rows.push(['镜号', '章节', '景别', '当前状态', '缺什么']);
  var gone = 0;
  rec.ids.forEach(function(no){
    var s = byNo[String(num(no))];
    if(!s){ gone++; rows.push([num(no), '（镜头已删除）', '', '', '']); return; }
    rows.push([num(no), s['章节'] || '', s['景别'] || '', s[stKey] || '未生成', leftWhyTxt(kind, s)]);
  });
  rows.push([]);
  if(gone) rows.push(['注', '有 ' + gone + ' 个镜号在当前分镜里已找不到（可能被删除），可点「忽略」清掉这类记录。']);
  rows.push(['说明', '本清单只列「上次批量没跑完」的镜号；回首页点续跑卡的「只跑剩余镜」即可接着跑。']);
  /* v2.23：标题行 + 表头行加粗（xlsx 用） */
  rows._bold = [1, 5];
  return { name: '剩余' + batchLeftName(kind), rows: rows, style: { boldRows: [1, 5], freeze: 1 } };
}
/* 哪几类还有剩余——导出「全部剩余清单」时按这个顺序出多个工作表 */
function leftKindsWithData(){
  var all = batchLoadAll() || {}, out = [];
  ['img', 'vid', 'audio'].forEach(function(k){ if(all[k] && all[k].ids && all[k].ids.length) out.push(k); });
  return out;
}
function exportLeftXlsx(kind){
  var kinds = kind ? [kind] : leftKindsWithData();
  var sheets = [];
  kinds.forEach(function(k){ var sh = buildLeftSheet(k); if(sh) sheets.push(sh); });
  if(!sheets.length){ toast('当前没有剩余记录可导出'); return; }
  downloadXlsx('剩余清单_' + nowStr().replace(/[: ]/g, '-') + '.xlsx', sheets);
}
function batchRun(kind, list, opts){
  opts = opts || {};
  var isImg = (kind === 'img'), isAud = (kind === 'audio'), isLip = (kind === 'lip');
  var stKey = batchStKey(kind);
  var n = Math.min(3, Math.max(1, num(cfg.imgN) || 1));
  var multi = isImg && !!cfg.batchCand && n > 1;
  state.stopBatch = false;
  state.lastBatchBad = 0;              /* v2.36：本段失败数，流水线收尾靠它对账 */
  /* v2.19：统一在入口做预检——续跑路径也会经过这里，所以三处入口都不用各写一遍 */
  var pf = preflightShots(list, kind);
  list = pf.run;
  var skipN = pf.skip.length, skipTxt = skipWhyTxt(pf.skip);
  if(!list.length){
    toast(skipN ? ('这 ' + skipN + ' 个镜头都缺前置条件（' + skipTxt + '），先去补齐再来') : '没有可处理的镜头');
    return Promise.resolve(0);
  }
  batchBarOpen((opts.resume ? '续跑剩余：' : '') +
    (isImg ? '批量生成分镜图' : (isAud ? '批量生成配音' : (isLip ? '批量对口型' : '批量生成视频'))) +
    (skipN ? '（跳过 ' + skipN + ' 个）' : ''));
  return runPool(list, function(s){
    if(isImg) return genShotImage(s._id);
    if(isAud) return genAudio(s._id);
    if(isLip) return genLipsync(s._id).then(function(){ return waitShot(s._id, '口型状态', 300000); });
    if(!s['图片URL']) return Promise.resolve();
    return genVideo(s._id);
  }, function(done, total, s){
    /* v2.35：s 是**跑批那一刻**的对象引用，而 patchShot 是「整表 map 出新对象」，
       所以旧引用上的状态永远是旧值——原来这行判失败一次都没中过，收尾也永远报「失败 0」。
       一律改用 shotById 取当前内存里的那一份。 */
    var cur = s ? shotById(s._id) : null;
    if(cur && cur[stKey] === '失败') batchBarFail();
    batchBarStep(done, total);
    var tag = isAud ? (cfg.cueTts ? '（逐句配音，每句一次请求）' : '') : (multi ? '（每镜 ' + n + ' 版候选）' : '');
    batchBarMsg('正在处理第 ' + (cur ? cur['镜号'] : '?') + ' 镜' + tag);
  }, { kind: kind, ids: list.map(function(s){ return s._id; }),
       /* v2.35：让「失败自动重试」真的会重试——worker 自己吞错不抛，只能按最新状态判 */
       isFail: function(s){ var c = shotById(s._id); return !!c && c[stKey] === '失败'; }
     }).then(function(left){
    var inIds = {};
    list.forEach(function(s){ inIds[s._id] = 1; });
    /* v2.35：同上，按 id 取当前对象再数失败——原来恒为 0，全失败也报「批量任务已全部完成」 */
    var bad = state.shots.filter(function(s){ return inIds[s._id] && s[stKey] === '失败'; }).length;
    state.lastBatchBad = bad;          /* v2.36：交给流水线对账（原来流水线看不到失败） */
    /* v2.38：runPool 自己也记了一份失败数（state.poolFail，含「worker 吞错」与「重试到头」两条路径）。
       它是**独立来源**，跟这里按数据源对账出来的 bad 不一致就说明有一边漏了——v2.35 那次「失败数恒为 0」
       正是如此。留一条 warn 当探针，**显示用的数一律以数据源为准**（被叫停时剩余镜没跑到，天然不同，故排除）。 */
    if(!left && state.poolFail !== bad) console.warn('批量失败计数不一致：runPool=' + state.poolFail + '，数据源对账=' + bad);
    var pend = multi ? state.shots.filter(function(s){ return Array.isArray(s._imgCand) && s._imgCand.length; }).length : 0;
    var tail = (bad ? '，失败 ' + bad + ' 条' + ((isAud || isLip) ? '（可点「重试失败」）' : '') : '') +
      (skipN ? '，跳过 ' + skipN + ' 个（' + skipTxt + '）' : '') +
      (pend ? '；' + pend + ' 个镜头候选待挑选（点镜卡「选图(N)」）' : '');
    /* 中途暂停/停止时不要谎报「全部完成」 */
    if(left){
      batchBarClose('已暂停：' + (list.length - left - bad) + ' / ' + list.length + tail, kind);
      toast('已暂停，还剩 ' + left + ' 个未完成（可点首页续跑卡的「只跑剩余镜」继续）');
      renderToday();
      return left;
    }
    batchBarClose((isAud ? '配音完成：成功 ' + (list.length - bad) + ' 条'
                       : (isLip ? '对口型完成：成功 ' + (list.length - bad) + ' 条'
                                : '批量完成：' + (list.length - bad) + ' / ' + list.length)) + tail, kind);
    toast(isAud ? (bad ? ('配音完成，' + bad + ' 条失败') : ('配音全部完成，共 ' + (list.length - bad) + ' 条'))
                : (isLip ? (bad ? ('对口型完成，' + bad + ' 条失败（多为本机音频无法提交给唇形服务）') : ('对口型全部完成，共 ' + (list.length - bad) + ' 条'))
                         : (pend ? ('批量完成：' + pend + ' 个镜头的候选图待挑选') : '批量任务已全部完成')));
    renderToday();
    return 0;
  });
}
function batch(kind){
  var list = state.shots.filter(function(s){
    var is = s['图片状态'] || '未生成', vs = s['视频状态'] || '未生成';
    if(kind === 'img') return is === '未生成' || is === '失败';
    return vs === '未生成' || vs === '失败';
  });
  if(!list.length){ toast(kind === 'img' ? '没有待生成图片的镜头' : '没有待生成视频的镜头'); return; }
  if(!hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return; }
  /* v2.19：跑前预检——缺图片的视频镜先在确认框里说清会跳过几个，免得「说好 N 个却只跑了 N-k 个」
     注意 v2.19 起 batchRun 内部也会再预检一次（幂等），所以这里剔过之后进去就不会重复计数 */
  var pf = preflightShots(list, kind);
  if(!pf.run.length){ toast('这 ' + list.length + ' 个镜头都缺前置条件（' + skipWhyTxt(pf.skip) + '），先去补齐再来'); return; }
  var skipNote = pf.skip.length ? ('另有 ' + pf.skip.length + ' 个' + skipWhyTxt(pf.skip) + '，本次跳过；') : '';
  list = pf.run;
  /* v2.10：批量也可按候选数生成（静默，不弹面板打断跑批） */
  var n = Math.min(3, Math.max(1, num(cfg.imgN) || 1));
  var multi = (kind === 'img') && !!cfg.batchCand && n > 1;
  var est = costEstimateTxt(list, kind === 'img' ? { img:1, imgN: (multi ? n : 1) } : { vid:1 });
  var conc = Math.max(1, Math.min(8, num(cfg.conc) || 1));
  askConfirm((est || ('共 ' + list.length + ' 个镜头。')) + skipNote +
    (multi ? '每镜 ' + n + ' 版候选（跑完在镜卡点「选图(' + n + ')」逐镜挑）' : '') +
    '（并发 ' + conc + ' 路' +
    (num(cfg.retry) > 0 ? '，失败自动重试 ' + num(cfg.retry) + ' 次' : '') + '）确定开始批量生成？', '开始')
    .then(function(ok){
      if(!ok) return;
      /* v2.18：收尾逻辑统一交给 batchRun，不再在这里重复一遍 */
      return batchRun(kind, list);
    });
}
/* v2.38：一键重试改成「按类型逐段走 batchRun」。
   原来它只重跑图片 / 视频（配音与口型失败压根没有入口），而且自带的 runPool 调用绕过了
   batchRun 的预检、剩余存档与失败对账——等于在项目里维护了第二套批量逻辑，两套迟早走岔。
   现在四类统一交给 batchRun：预检、进度条、暂停/停止、失败对账全都与手动批量完全一致。 */
function retryFailed(){
  var groups = failGroups();
  if(!groups.length){ toast('没有失败的镜头'); return; }
  var n = failShots().length, items = failCount();
  var est = costEstimateTxt(failShots(), { img:1, vid:1, audio:1, lip:1 });
  askConfirm('失败：' + failBrief() + '（共 ' + items + ' 项、涉及 ' + n + ' 个镜头）。' +
    (est ? est + '。' : '') + '确定按「分镜图 → 视频 → 配音 → 口型」逐类重跑？', '重试')
    .then(function(ok){
      if(!ok) return;
      state.stopBatch = false;
      var i = 0, stopped = false;
      function step(){
        if(state.stopBatch || i >= groups.length) return Promise.resolve();
        var g = groups[i++];
        return batchRun(g.k, g.list).then(function(left){
          if(left){ stopped = true; return null; }        /* 被暂停/叫停：别再往下开下一类 */
          return step();
        });
      }
      return step().then(function(){
        /* 收尾按**数据源**对账（不是按跑批那一刻的引用）：剩下几项失败，问的就是 state.shots */
        var leftN = failCount();
        refreshAll(); renderToday();
        if(stopped) toast('已停止重试：修好 ' + (items - leftN) + ' 项' + (leftN ? ('，仍有 ' + leftN + ' 项失败') : ''));
        else if(leftN) toast('重试完成：修好 ' + (items - leftN) + ' 项，仍有 ' + leftN + ' 项失败（' + failBrief() + '，可再点一次或看镜卡里的错误信息）');
        else toast('重试完成：' + items + ' 项全部成功');
      });
    });
}

