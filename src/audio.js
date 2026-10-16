/* ================= 配音：小米 MiMo TTS ================= */
/* 小米 TTS 用 OpenAI 兼容的 /chat/completions，认证头两种都发，兼容不同版本 */
function apiPostTts(url, key, body){
  return apiFetch(url, {
    method:'POST',
    headers: { 'Authorization':'Bearer '+key, 'api-key':key, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  }).then(function(r){ return r.text().then(function(t){ return { status:r.status, text:t }; }); });
}
function buildTtsBody(text, voice, style){
  var body = {
    model: cfg.ttsModel,
    messages: [
      { role:'user', content: style || '用自然、贴合角色性格的中文语气朗读下面的台词，语速适中，情绪到位。' },
      { role:'assistant', content: text }
    ],
    audio: { format: cfg.ttsFormat }
  };
  /* voicedesign 模型不接受内置音色，改用音色描述模式 */
  if(cfg.ttsModel.indexOf('voicedesign') === -1) body.audio.voice = voice || cfg.ttsVoice;
  else body.audio.optimize_text_preview = true;
  return body;
}
function pickAudioB64(j){
  if(!j) return '';
  var c = [
    j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.audio && j.choices[0].message.audio.data,
    j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.audio && j.choices[0].delta.audio.data,
    j.audio && j.audio.data, j.data && j.data.audio, j.data && j.data[0] && j.data[0].b64
  ];
  for(var i=0;i<c.length;i++){ if(typeof c[i] === 'string' && c[i].length > 200) return c[i]; }
  return '';
}
function pickAudioUrl(j){
  if(!j) return '';
  try{
    var m = JSON.stringify(j).match(/https?:\/\/[^"\\ ]+?\.(?:mp3|wav|m4a|ogg|flac)[^"\\ ]*/i);
    return m ? m[0] : '';
  }catch(e){ return ''; }
}
/* 音频本体只存本机 localStorage：base64 太大，不适合进数据表；数据表只存状态与时长 */
var AUD = {};
function audKey(id){ return pk('aud_' + id); }
function audLoad(id){
  if(AUD[id]) return AUD[id];
  try{
    var raw = localStorage.getItem(audKey(id));
    if(!raw) return null;
    var o = JSON.parse(raw);
    AUD[id] = { b64:o.b64, mime:o.mime, dur:o.dur, url:null };
    return AUD[id];
  }catch(e){ return null; }
}
function audUrl(id){
  var a = audLoad(id);
  if(!a) return '';
  if(!a.url){
    try{
      var bin = atob(a.b64), arr = new Uint8Array(bin.length);
      for(var i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
      a.url = URL.createObjectURL(new Blob([arr], { type: a.mime || 'audio/mpeg' }));
    }catch(e){ return ''; }
  }
  return a.url;
}
function audSave(id, b64, mime, dur){
  AUD[id] = { b64:b64, mime:mime, dur:dur, url:null };
  return lsSet(audKey(id), JSON.stringify({ b64:b64, mime:mime, dur:dur }),
    { warn:true, msg:'本机音频存储已满：已尝试清理较早的配音，仍存不下这条（建议导出整轨配音后清理）' });
}
/* v2.11：逐句配音的「每句真实时长」本地账本——只有它才能让字幕与口型严丝合缝。
   与 AUD 一样只存本机（下划线字段不落资料库），删镜时一并清掉。 */
var CUE_DUR = {};
function cueDurKey(id){ return pk('cuedur_' + id); }
function cueDurLoad(id){
  if(CUE_DUR[id]) return CUE_DUR[id];
  try{
    var raw = localStorage.getItem(cueDurKey(id));
    if(raw){ var a = JSON.parse(raw); if(Array.isArray(a) && a.length){ CUE_DUR[id] = a; return a; } }
  }catch(e){}
  return null;
}
function cueDurSave(id, arr){
  CUE_DUR[id] = arr;
  lsSet(cueDurKey(id), JSON.stringify(arr),
    { warn:true, msg:'逐句时长账本保存失败（存储已满）：字幕会退回按字数估算，可能与口型对不齐' });
}
function cueDurClear(id){
  delete CUE_DUR[id];
  try{ localStorage.removeItem(cueDurKey(id)); }catch(e){}
}
var _actx = null;
function audioCtx(){
  if(!_actx){ try{ _actx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ _actx = null; } }
  return _actx;
}
function decodeAudioBuf(b64){
  return new Promise(function(resolve){
    var ctx = audioCtx();
    if(!ctx) return resolve(null);
    try{
      var bin = atob(b64), arr = new Uint8Array(bin.length);
      for(var i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
      ctx.decodeAudioData(arr.buffer, function(b){ resolve(b); }, function(){ resolve(null); });
    }catch(e){ resolve(null); }
  });
}
/* 拉取远程音频并解码出真实时长（URL 音频也要参与音画同步） */
function fetchAudioBuf(url){
  var ctx = audioCtx();
  if(!ctx || !url || !/^https?:/.test(url)) return Promise.resolve(null);
  return apiFetch(url, {}, AUDIO_TIMEOUT).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(function(ab){
      return new Promise(function(resolve){
        try{ ctx.decodeAudioData(ab, function(b){ resolve(b); }, function(){ resolve(null); }); }
        catch(e){ resolve(null); }
      });
    })
    .catch(function(){ return null; });
}
/* ---------- v2.10：cue 级 TTS（逐句各自音色，解决「一镜多说话人读串」） ---------- */
/* 每一句 cue 单独决定音色与风格：对白用该角色卡的音色，旁白用旁白音色，
   OS/VO 用同一角色的音色但加画外 / 内心独白的演法提示。 */
function cueVoiceStyle(cue, s){
  var t = String(cue.type || '').toLowerCase();
  var spk = (t === 'narr') ? '' : (cue.speaker || '');
  var isNarr = !spk || spk === '旁白';
  var role = isNarr ? null : assetByName(spk, '角色');
  var voice = (role && role['TTS音色']) || (isNarr ? cfg.ttsNarr : cfg.ttsVoice);
  var style = (role && role['TTS风格']) ? String(role['TTS风格']) : '';
  if(role && role['性格语气']) style = (style ? style + '；' : '') + '角色性格：' + role['性格语气'];
  if(role && role['语速']) style = (style ? style + '；' : '') + '语速' + role['语速'];
  if(t === 'os') style = (style ? style + '；' : '') + '这是画外音（OS）：人在画面外说话，像隔着一点距离，音量自然';
  if(t === 'vo') style = (style ? style + '；' : '') + '这是内心独白（VO）：贴近麦克风的轻声自语，不要字正腔圆地念';
  if(cue.emotion) style = (style ? style + '；' : '') + '本句情绪：' + cue.emotion;
  else if(String(s['角色情绪'] || '').trim()) style = (style ? style + '；' : '') + '本镜情绪：' + String(s['角色情绪']).trim();
  return { voice:voice, style:style };
}
/* 拼接多段音频：句间插入短静音，避免两句黏在一起 */
function concatAudioBufs(bufs, gapSec){
  var list = (bufs || []).filter(function(b){ return !!b && b.length > 0; });
  if(!list.length) return null;
  var ctx = audioCtx();
  if(!ctx) return list.length === 1 ? list[0] : null;
  var sr = list[0].sampleRate, ch = list[0].numberOfChannels;
  var gapLen = Math.max(0, Math.round((gapSec || 0) * sr));
  var total = 0, i;
  for(i=0;i<list.length;i++) total += list[i].length + (i ? gapLen : 0);
  var out = ctx.createBuffer(ch, total, sr);
  for(var c=0;c<ch;c++){
    var dst = out.getChannelData(c), off = 0;
    for(i=0;i<list.length;i++){
      if(i) off += gapLen;
      var src = list[i].getChannelData(Math.min(c, list[i].numberOfChannels - 1));
      for(var k=0;k<list[i].length;k++) dst[off + k] = src[k];
      off += list[i].length;
    }
  }
  return out;
}
/* 降到 24k 采样率再落盘：逐句配音是 wav，体积比 mp3 大得多，必须瘦身 */
function resampleBuf(buf, sr){
  if(!buf || buf.sampleRate <= sr) return Promise.resolve(buf);
  try{
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if(!OC) return Promise.resolve(buf);
    var oc = new OC(buf.numberOfChannels, Math.ceil(buf.duration * sr), sr);
    var src = oc.createBufferSource();
    src.buffer = buf; src.connect(oc.destination); src.start();
    return Promise.resolve(oc.startRendering()).then(function(b){ return b || buf; }, function(){ return buf; });
  }catch(e){ return Promise.resolve(buf); }
}
/* v2.11：把拼好的 PCM 压成 webm/opus 再存本机——wav 一分钟约 2.8MB，opus 只有零点几 MB，
   本机 localStorage 只有几 MB，不压缩存不了几镜。浏览器不支持 MediaRecorder 时返回 null，调用方自动退回 wav。 */
function encodeCompressed(buffer, mimeList){
  return new Promise(function(resolve){
    var done = false;
    function fin(v){ if(!done){ done = true; resolve(v); } }
    setTimeout(function(){ fin(null); }, (buffer.duration || 0) * 1000 + 8000);   /* 兜底超时：编码卡住也不能把流程吊死 */
    try{
      var MR = window.MediaRecorder;
      if(!MR || !MR.isTypeSupported) return fin(null);
      var cands = (mimeList && mimeList.length) ? mimeList
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      var mime = cands.filter(function(m){ try{ return MR.isTypeSupported(m); }catch(e){ return false; } })[0];
      if(!mime) return fin(null);
      var ctx = audioCtx(); if(!ctx) return fin(null);
      if(ctx.state === 'suspended' && ctx.resume){ try{ ctx.resume(); }catch(e){} }
      var dest = ctx.createMediaStreamDestination();
      var src = ctx.createBufferSource();
      src.buffer = buffer; src.connect(dest);
      var rec = new MR(dest.stream, { mimeType: mime });
      var chunks = [];
      rec.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function(){ fin(null); };
      rec.onstop = function(){
        if(!chunks.length) return fin(null);
        try{
          var fr = new FileReader();
          fr.onload = function(){
            var s = String(fr.result || '');
            var b64 = s.indexOf(',') >= 0 ? s.slice(s.indexOf(',') + 1) : '';
            fin(b64 ? { b64: b64, mime: mime } : null);
          };
          fr.onerror = function(){ fin(null); };
          fr.readAsDataURL(new Blob(chunks, { type: mime }));
        }catch(e){ fin(null); }
      };
      rec.start();
      src.start();
      src.onended = function(){ setTimeout(function(){ try{ rec.stop(); }catch(e){ fin(null); } }, 150); };
    }catch(e){ fin(null); }
  });
}
/* ArrayBuffer → base64（分块拼接，避免大数组 apply 爆栈） */
function abToB64(ab){
  var bytes = new Uint8Array(ab), CH = 0x8000, bin = '';
  for(var i=0;i<bytes.length;i += CH){
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}
/* 逐句合成 + 拼接：一镜里林小满说一句、旁白接一句、陈老师再回一句，
   各自用自己的音色念出来，而不是一个音色从头念到尾 */
function genAudioCue(id){
  var s = shotById(id);
  if(!s) return Promise.resolve();
  if(!cfg.ttsKey){ toast('请先在设置里填小米 TTS API Key'); openDrawer(); return Promise.resolve(); }
  var text = String(s['台词旁白'] || '').trim();
  if(!text){ toast('这一镜还没写台词 / 旁白'); return Promise.resolve(); }
  var cues = parseCues(text);
  if(cues.length < 2){ return genAudio(id); }
  var durs = [];                       /* v2.11：每句的真实音频时长，供字幕对齐用 */
  state.busy[id] = true;
  return patchShot(id, { 配音状态:'生成中', 错误信息:'', 更新时间:nowStr() })
    .then(function(){
      /* v2.12：可控并发（设置 1–3 路，默认 2）——结果按句序下标回填，拼接顺序不会乱 */
      var conc = Math.max(1, Math.min(3, num(cfg.ttsConc) || 2));
      var results = new Array(cues.length), cursor = 0;
      function synth(idx){
        var c = cues[idx];
        var vs = cueVoiceStyle(c, s);
        var attempt = 0;
        var retryN = Math.max(0, Math.min(3, num(cfg.retry) || 0));   /* 沿用全局「失败自动重试」配置 */
        function run(){
          return apiPostTts(cfg.ttsBase.replace(/\/+$/,'') + '/chat/completions', cfg.ttsKey, buildTtsBody(c.text, vs.voice, vs.style))
            .then(function(r){
              var j = parseJsonSafe(r.text);
              if(r.status >= 400){
                var msg = (j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error) : (r.text || '').slice(0,160);
                throw new Error('第 ' + (idx + 1) + ' 句 HTTP ' + r.status + ' ' + msg);
              }
              var b64 = pickAudioB64(j), url = pickAudioUrl(j);
              if(b64) return decodeAudioBuf(b64);
              if(url) return fetchAudioBuf(url);
              throw new Error('第 ' + (idx + 1) + ' 句没取到音频数据');
            })
            .catch(function(e){
              /* v2.13：单句限流 / 抖动先退避重试，别因为一句就把整镜判死 */
              attempt++;
              if(attempt <= retryN) return wait(1200 * attempt).then(run);
              throw e;
            });
        }
        return run().then(function(b){ if(b) results[idx] = b; });
      }
      function worker(){
        if(cursor >= cues.length) return Promise.resolve();
        var idx = cursor++;
        return synth(idx).then(worker);
      }
      var ws = [];
      for(var k = 0; k < Math.min(conc, cues.length); k++) ws.push(worker());
      return Promise.all(ws).then(function(){
        return results.filter(function(b){ return !!b; });      /* 缺句的镜仍按顺序拼，不会串位 */
      });
    })
    .then(function(bufs){
      if(!bufs.length) throw new Error('逐句配音没有取到任何音频');
      bumpUse('usedTts', bufs.length);
      var gap = 0.12;
      /* 句间那 0.12 秒静音归给前一句，这样各句时长之和正好等于整段时长，字幕不会累积漂移 */
      durs = bufs.map(function(b, i){ return b.duration + (i < bufs.length - 1 ? gap : 0); });
      return concatAudioBufs(bufs, gap);
    })
    .then(function(out){
      if(!out) throw new Error('逐句音频拼接失败（浏览器不支持音频解码时无法拼接）');
      return resampleBuf(out, 24000);
    })
    .then(function(out){
      /* v2.11：优先压成 webm/opus 存本机，体积约为 wav 的 1/10；不支持则退回 wav */
      if(cfg.ttsZip !== false) return encodeCompressed(out).then(function(z){ return { out:out, zip:z }; });
      return { out:out, zip:null };
    })
    .then(function(r){
      var out = r.out, b64, mime;
      if(r.zip){ b64 = r.zip.b64; mime = r.zip.mime; }
      else { b64 = abToB64(encodeWav(out)); mime = 'audio/wav'; }
      var dur = out.duration;
      if(!audSave(id, b64, mime, dur)) throw new Error('本机音频存储已满：先导出整轨配音再清理，或到设置里开启「逐句配音压成压缩格式」');
      if(durs.length === cues.length) cueDurSave(id, durs);
      var eff = (cfg.ttsSync && dur > 0) ? Math.min(12, Math.max(4, Math.ceil(dur))) : dur;
      var patch = { 音频URL:'local', 音频时长:eff, 配音状态:'已完成', 错误信息:'', 更新时间:nowStr() };
      if(cfg.ttsSync && dur > 0) patch['时长秒'] = eff;
      patchShot(id, patch);
      toast('第 ' + s['镜号'] + ' 镜逐句配音完成（' + cues.length + ' 句 / ' + dur.toFixed(1) + ' 秒' + (r.zip ? '，已压缩存储' : '') + '）');
    })
    .catch(function(e){
      console.error(e);
      patchShot(id, { 配音状态:'失败', 错误信息:guessCorsMsg(e).slice(0,300), 更新时间:nowStr() });
      toast('第 ' + s['镜号'] + ' 镜逐句配音失败');
    })
    .then(function(){ delete state.busy[id]; refreshAll(); });
}

/* 生成一镜配音：角色音色 + 性格风格 + 本镜情绪 → 音频 → 时长回写镜头（音画同步）
   v2.9：台词按 cue 结构化消费——
   ① 「说话角色」留空时自动取第一个对白 cue 的说话人，用对应角色音色；
   ② 每句 cue 的【情绪】逐句注入 TTS 风格指令；
   ③ 送给 TTS 的文本剥掉「角色名：」前缀（音色已区分说话人，不能把名字念出来），
      多句用换行连接，天然形成句间停顿。 */
function genAudio(id){
  var s = shotById(id);
  if(!s) return Promise.resolve();
  if(guardBudget()) return Promise.resolve();   /* v2.47：预算硬上限，拦截配音生成 */
  if(!cfg.ttsKey){ toast('请先在设置里填小米 TTS API Key'); openDrawer(); return Promise.resolve(); }
  var text = String(s['台词旁白'] || '').trim();
  if(!text){ toast('这一镜还没写台词 / 旁白'); return Promise.resolve(); }
  var cues = parseCues(text);
  /* v2.10：开了「逐句配音」且本镜有多句 → 每句按各自说话人的音色分别合成再拼接 */
  if(cfg.cueTts && cues.length > 1) return genAudioCue(id);
  var speaker = String(s['说话角色'] || '').trim();
  if(!speaker){
    for(var ci=0; ci<cues.length; ci++){
      if(cues[ci].type === 'dlg' && cues[ci].speaker && cues[ci].speaker !== '旁白'){ speaker = cues[ci].speaker; break; }
    }
  }
  var role = speaker ? assetByName(speaker, '角色') : null;
  var voice = (role && role['TTS音色']) || (speaker ? cfg.ttsVoice : cfg.ttsNarr);
  var style = (role && role['TTS风格']) ? String(role['TTS风格']) : '';
  if(role && role['性格语气']) style = (style ? style + '；' : '') + '角色性格：' + role['性格语气'];
  if(String(s['角色情绪'] || '').trim()) style = (style ? style + '；' : '') + '本镜情绪：' + String(s['角色情绪']).trim();
  if(role && role['语速']) style = (style ? style + '；' : '') + '语速' + role['语速'];
  var emoBits = [];
  cues.forEach(function(c, i){
    if(c.emotion) emoBits.push('第' + (i + 1) + '句' + (c.speaker && c.speaker !== '旁白' ? '（' + c.speaker + '）' : '') + '用「' + c.emotion + '」的语气念');
  });
  if(emoBits.length) style = (style ? style + '；' : '') + '逐句情绪：' + emoBits.join('，');
  var ttsText = cues.length ? cues.map(function(c){ return c.text; }).join('\n') : text;
  state.busy[id] = true;
  return patchShot(id, { 配音状态:'生成中', 错误信息:'', 更新时间:nowStr() })
    .then(function(){
      return apiPostTts(cfg.ttsBase.replace(/\/+$/,'') + '/chat/completions', cfg.ttsKey, buildTtsBody(ttsText, voice, style));
    })
    .then(function(r){
      var j = parseJsonSafe(r.text);
      if(r.status >= 400){
        var msg = (j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error) : r.text.slice(0,180);
        throw new Error('HTTP ' + r.status + ' ' + msg);
      }
      var b64 = pickAudioB64(j), url = pickAudioUrl(j);
      if(!b64 && !url) throw new Error('没取到音频数据：' + r.text.slice(0,180));
      if(url){
        /* URL 音频同样要解析真实时长，否则音画同步 / 字幕 / 整轨全部失效 */
        return fetchAudioBuf(url).then(function(buf){
          var dur = buf ? buf.duration : 0;
          /* v2.8：音频时长也 clamp 到 4–12，与时长秒、render.sh 段长同口径，杜绝 SRT/整轨/合成三处不一致 */
          var eff = (cfg.ttsSync && dur > 0) ? Math.min(12, Math.max(4, Math.ceil(dur))) : dur;
          var patch = { 音频URL:url, 音频时长:eff, 配音状态:'已完成', 错误信息:'', 更新时间:nowStr() };
          if(cfg.ttsSync && dur > 0) patch['时长秒'] = eff;
          bumpUse('usedTts', 1);
          patchShot(id, patch);
          toast('第 ' + s['镜号'] + ' 镜配音完成' +
                (dur > 0 ? '（' + dur.toFixed(1) + ' 秒' + (patch['时长秒'] ? '，镜头已对齐 ' + patch['时长秒'] + ' 秒' : '') + '）'
                         : '（远端音频，时长待剪辑软件读取）'));
        });
      }
      var mime = cfg.ttsFormat === 'wav' ? 'audio/wav' : 'audio/mpeg';
      return decodeAudioBuf(b64).then(function(buf){
        var dur = buf ? buf.duration : 0;
        if(!audSave(id, b64, mime, dur)) throw new Error('本机音频存储已满，无法保存配音');
        /* v2.8：音频时长 clamp 到 4–12，与时长秒同口径 */
        var eff = (cfg.ttsSync && dur > 0) ? Math.min(12, Math.max(4, Math.ceil(dur))) : dur;
        var patch = { 音频URL:'local', 音频时长:eff, 配音状态:'已完成', 错误信息:'', 更新时间:nowStr() };
        bumpUse('usedTts', 1);
        /* 关键：把镜头时长对齐到语音长度，视频按这个时长生成 → 音画同步 */
        if(cfg.ttsSync && dur > 0) patch['时长秒'] = eff;
        patchShot(id, patch);
        toast('第 ' + s['镜号'] + ' 镜配音完成（' + dur.toFixed(1) + ' 秒）' +
              (cfg.ttsSync && dur > 0 ? '，镜头时长已对齐为 ' + patch['时长秒'] + ' 秒' : ''));
      });
    })
    .catch(function(e){
      console.error(e);
      patchShot(id, { 配音状态:'失败', 错误信息:guessCorsMsg(e).slice(0,300), 更新时间:nowStr() });
      toast('第 ' + s['镜号'] + ' 镜配音失败');
    })
    .then(function(){ delete state.busy[id]; refreshAll(); });
}
function batchAudio(){
  var list = state.shots.filter(function(s){
    var st = s['配音状态'] || '未生成';
    return (st === '未生成' || st === '失败') && String(s['台词旁白'] || '').trim();
  });
  if(!list.length){ toast('没有待生成配音的镜头（需要有台词）'); return; }
  if(!cfg.ttsKey){ toast('请先在设置里填小米 TTS Key'); openDrawer(); return; }
  /* v2.19：与生图/生视频统一口径——万一有镜头的台词被清空了，这里也先剔掉再报数 */
  var pfA = preflightShots(list, 'audio');
  if(!pfA.run.length){ toast('这 ' + list.length + ' 条都还没写台词，先补台词再来'); return; }
  var skipNoteA = pfA.skip.length ? ('另有 ' + pfA.skip.length + ' 个' + skipWhyTxt(pfA.skip) + '，本次跳过；') : '';
  list = pfA.run;
  var est = costEstimateTxt(list, { audio:1 });
  askConfirm((est || ('共 ' + list.length + ' 条配音。')) + skipNoteA + '确定开始？', '开始')
    .then(function(ok){
      if(!ok) return;
      /* v2.18：与生图/生视频共用同一套收尾（batchRun） */
      return batchRun('audio', list);
    });
}
/* v2.18：首页续跑卡「只跑剩余镜」——严格按存档里的剩余镜号投队列。
   以前只能「去定位」再自己点批量按钮，而批量入口是按「未生成/失败」重算列表，
   口径跟上次的剩余不一定一致（中途改过设置/筛选就会多跑或少跑）。
   这里只跑存档里那几个镜号，跑完/再暂停会按同一套逻辑刷新存档。 */
/* v2.22：把某类型的剩余存档映射回镜头列表（保持存档里的镜号顺序）。
   返回 {k, left, list}；list 为空表示那些镜都被删了。抽出来给「续跑」与「流水线」共用。 */
function leftShotList(kind){
  var left = batchLoadLeft(kind);
  if(!left || !left.ids || !left.ids.length) return null;
  var byNo = {};
  state.shots.forEach(function(s){ byNo[String(num(s['镜号']))] = s; });
  var list = [];
  left.ids.forEach(function(no){ var s = byNo[String(num(no))]; if(s) list.push(s); });
  return { k: left.kind || kind, left: left, list: list };
}
function resumeLeftRun(kind){
  var r = leftShotList(kind);
  if(!r){ toast('没有可续跑的剩余记录'); return; }
  var k = r.k, list = r.list;
  if(!list.length){ batchClearLeft(k); renderToday(); toast('剩余镜头已不存在（可能被删除），已清除记录'); return; }
  if(k === 'audio'){
    if(!cfg.ttsKey){ toast('请先在设置里填小米 TTS Key'); openDrawer(); return; }
  }else if(k === 'lip'){
    if(!cfg.lipBase){ toast('请先在设置里填唇形服务 Base URL'); openDrawer(); return; }
  }else if(!hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return; }
  batchRun(k, list, { resume:true });
}
/* v2.22：续跑流水线——生图与生视频同时有剩余时，按「先补图 → 再出视频」的自然顺序一次跑完。
   为什么要串起来：生视频要求先有图片，分两次点等于中间得等、还得回来再点一次；
   串成流水线后第一段跑完（图片就绪）立刻接第二段，不用人守着。中途暂停则停在哪段就是哪段。 */
/* v2.23：流水线扩到三段——补图 → 出视频 → 配音，并且可以顺带把高风险镜对口型。
   顺序不是随便排的：视频要图、对口型要视频 + 音频，这三段天然串行，串起来就不用人守着分几次点。 */
/* v2.24：首页流水线「自定义步骤」的勾选状态——缺省图/视频/配音都勾、对口型不勾；
   老配置没有这个键时回落到缺省，不会报错。 */
function pipelinePick(){
  var d = { img:true, vid:true, audio:true, lip:false }, p = cfg.pipelinePick;
  if(p && typeof p === 'object'){ for(var k in d){ if(k in p) d[k] = !!p[k]; } }
  return d;
}
function togglePipelineStep(k){
  if(!cfg.pipelinePick || typeof cfg.pipelinePick !== 'object') cfg.pipelinePick = { img:true, vid:true, audio:true, lip:false };
  if(k in cfg.pipelinePick){ cfg.pipelinePick[k] = !cfg.pipelinePick[k]; saveCfg(); renderToday(); }
}
function runPipelineCustom(){
  var pp = pipelinePick(), steps = ['img','vid','audio','lip'].filter(function(k){ return pp[k]; });
  if(!steps.length){ toast('先在流水线卡里勾选要跑的步骤'); return; }
  var all = batchLoadAll(), real = steps.filter(function(k){
    if(k === 'lip') return cfg.lipBase ? lipTodoShots().length > 0 : false;
    return !!(all[k] && all[k].ids && all[k].ids.length);
  });
  if(!real.length){ toast('勾选的步骤当前都没有可跑的剩余镜头'); return; }
  if(((real.indexOf('img') > -1) || (real.indexOf('vid') > -1)) && !hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return; }
  askConfirm('流水线按选中步骤跑：' + real.map(function(k){
    return batchLeftName(k) + ' ' + (k === 'lip' ? lipTodoShots().length : all[k].ids.length) + ' 个';
  }).join(' → ') + '，跑完一段自动接下一段。确定开始？', '开始')
    .then(function(ok){ if(ok) runResumeStep(real.slice(), 0); });
}
function pipelineSteps(){
  var has = leftKindsWithData(), steps = [];
  ['img', 'vid', 'audio'].forEach(function(k){ if(has.indexOf(k) > -1) steps.push(k); });
  return steps;
}
/* 还需要对口型的镜头（高风险 + 有视频 + 没同步过）。口型没有「剩余存档」——它是按当前数据现算的 */
function lipTodoShots(){
  return state.shots.filter(function(s){
    var st = s['口型状态'] || '不需要';
    return (s['口型风险'] || lipRiskOf(s)) === '高' && s['视频URL'] && st !== '已完成' && st !== '生成中';
  });
}
function resumePipeline(){
  var steps = pipelineSteps();
  if(!steps.length){ toast('没有可续跑的剩余记录'); return; }
  var needAgnes = (steps.indexOf('img') > -1) || (steps.indexOf('vid') > -1);
  if(needAgnes && !hasAgnesKey()){ toast('请先在设置里填 Agnes API Key'); openDrawer(); return; }
  var lipList = cfg.lipBase ? lipTodoShots() : [];
  var total = 0, label = [];
  steps.forEach(function(k){
    var r = leftShotList(k);
    if(r && r.list.length){ total += r.list.length; label.push(batchLeftName(k) + ' ' + r.list.length + ' 个'); }
  });
  askConfirm('流水线续跑：' + label.join(' → ') +
    (lipList.length ? ('；结尾再把 ' + lipList.length + ' 个高风险镜对口型') : '') +
    '，共 ' + total + ' 个任务，跑完一段自动接下一段。确定开始？', '开始')
    .then(function(ok){
      if(!ok) return;
      var all = steps.slice();
      if(lipList.length) all.push('lip');
      runResumeStep(all, 0);
    });
}
function runResumeStep(steps, i){
  if(i === 0) state.pipeBad = 0;
  if(i >= steps.length){
    /* v2.36：流水线收尾必须把各段的失败汇总说出来——原来这里直接 return 0，
       而每段的 batchRun 只吐自己的 toast，「补图全失败 → 出视频没图可跑 → 配音照跑」
       整条下来用户仍以为一切正常。 */
    if(state.pipeBad){
      setSync('off');
      toast('流水线跑完，但有 ' + state.pipeBad + ' 个任务失败（看镜卡里的错误信息；修好后点一次续跑，只会补没成的）');
    }
    return Promise.resolve(0);
  }
  var k = steps[i];
  var r = (k === 'lip') ? { k: 'lip', list: lipTodoShots() } : leftShotList(k);
  if(!r || !r.list.length){
    if(k !== 'lip') batchClearLeft(k);
    renderToday();
    return Promise.resolve(0).then(function(){ return runResumeStep(steps, i + 1); });
  }
  /* 每一段跑前校验自己那把钥匙（Agnes 在入口已校验过，这里补 TTS / 唇形） */
  if(k === 'audio' && !cfg.ttsKey){
    toast('流水线停在第 ' + (i + 1) + ' 段（配音）：请先在设置里填小米 TTS Key');
    openDrawer(); return Promise.resolve(0);
  }
  if(k === 'lip' && !cfg.lipBase){
    return Promise.resolve(0).then(function(){ return runResumeStep(steps, i + 1); });
  }
  toast('流水线第 ' + (i + 1) + ' 段：' + batchLeftName(k) + '（' + r.list.length + ' 个）');
  return batchRun(k, r.list, { resume:true }).then(function(left){
    state.pipeBad += num(state.lastBatchBad);      /* v2.36：段内失败累到流水线账上 */
    renderToday();
    /* 这一段被暂停/停止（left > 0）→ 整条流水线就停在这，别硬着头皮跑下一段 */
    if(left){ toast('流水线已暂停在第 ' + (i + 1) + ' 段（' + batchLeftName(k) + ' 还剩 ' + left + ' 个），修好后再点一次即可继续'); return left; }
    return runResumeStep(steps, i + 1);
  });
}
function testTts(){
  var box = $('testTtsResult');
  if(!cfg.ttsKey){ toast('请先填 TTS API Key'); return; }
  box.className = 'result show'; box.textContent = '正在合成一句测试语音…';
  apiPostTts(cfg.ttsBase.replace(/\/+$/,'') + '/chat/completions', cfg.ttsKey, buildTtsBody('音画同步测试，这句是工作台连通性自检。', cfg.ttsVoice, ''))
    .then(function(r){
      var j = parseJsonSafe(r.text);
      if(r.status >= 400){
        var msg = (j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error) : r.text.slice(0,180);
        throw new Error('HTTP ' + r.status + ' ' + msg);
      }
      var b64 = pickAudioB64(j), url = pickAudioUrl(j);
      if(!b64 && !url) throw new Error('没取到音频：' + r.text.slice(0,180));
      if(url){
        box.className = 'result show ok';
        box.innerHTML = 'TTS 连通正常，音频地址：<a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(url)+'</a>';
        return;
      }
      return decodeAudioBuf(b64).then(function(buf){
        var dur = buf ? buf.duration : 0;
        var mime = cfg.ttsFormat === 'wav' ? 'audio/wav' : 'audio/mpeg';
        var bin = atob(b64), arr = new Uint8Array(bin.length);
        for(var i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
        var u = URL.createObjectURL(new Blob([arr], { type: mime }));
        box.className = 'result show ok';
        box.innerHTML = 'TTS 连通正常，时长 ' + dur.toFixed(1) + ' 秒。<br><audio src="'+esc(u)+'" controls style="width:100%;margin-top:8px"></audio>';
      });
    })
    .catch(function(e){
      console.error(e);
      box.className = 'result show bad';
      box.textContent = guessCorsMsg(e);
    });
}

/* ================= v2.9：台词逐句 cue 结构化 =================
   「台词旁白」仍是唯一落库字段（向后兼容，老项目零迁移）；cue 是它的结构化视图，
   文本序列化约定（一行一句）：
     【情绪】角色名：台词        → 对白（dlg）
     【情绪】角色名(OS)：台词    → 画外音（off screen）
     【情绪】角色名(VO)：台词    → 内心独白（voice over）
     【情绪】旁白：台词 / 纯文本 → 旁白（narr）
   消费方：① 导出字幕逐句拆条（时间按各句字数占比分配）
          ② 配音按句断句 + 每句情绪注入 TTS 风格 + 说话人留空时自动取第一个对白的角色音色
          ③ 质检：一镜多说话人告警、超长句断句提示 */
function parseCues(text){
  var raw = String(text || '').trim();
  if(!raw) return [];
  var cues = [];
  raw.split(/\r?\n/).forEach(function(ln){
    ln = ln.trim();
    if(!ln) return;
    var m = ln.match(/^【([^【】]{1,16})】\s*/);
    var emo = m ? m[1] : '';
    if(m) ln = ln.slice(m[0].length);
    var sp = ln.match(/^([^【】：:（）()]{1,12}?)(?:\((OS|VO)\)|（(OS|VO)）)?\s*[：:]\s*(.+)$/);
    if(sp && sp[4] && sp[1].trim()){
      var speaker = sp[1].trim();
      var tag = (sp[2] || sp[3] || '').toLowerCase();
      cues.push({ speaker:speaker, type:(speaker === '旁白' ? 'narr' : (tag || 'dlg')), emotion:emo, text:sp[4].trim() });
    } else {
      cues.push({ speaker:'旁白', type:'narr', emotion:emo, text:ln });
    }
  });
  /* 整段无换行、无说话人前缀的纯文本：自动按句号等标点拆成多条旁白 cue，方便字幕逐句 */
  if(cues.length === 1 && cues[0].type === 'narr' && !cues[0].emotion && cues[0].text.length > 22){
    var segs = cues[0].text.split(/([。！？；])/), buf = '', parts = [];
    for(var i=0;i<segs.length;i++){
      buf += segs[i];
      if(/^[。！？；]$/.test(segs[i]) || i === segs.length - 1){ if(buf.trim()) parts.push(buf.trim()); buf = ''; }
    }
    if(parts.length > 1) cues = parts.map(function(x){ return { speaker:'旁白', type:'narr', emotion:'', text:x }; });
  }
  return cues;
}
function fmtCues(cues){
  return (cues || []).map(function(c){
    var t = String(c.type || '').toLowerCase();
    var head = '';
    if(c.emotion) head += '【' + c.emotion + '】';
    if(t === 'narr' && (!c.speaker || c.speaker === '旁白')){
      if(c.emotion) head += '旁白：';
    } else {
      head += (c.speaker || '旁白') + (t === 'os' ? '(OS)' : (t === 'vo' ? '(VO)' : '')) + '：';
    }
    return head + String(c.text || '').trim();
  }).filter(function(x){ return x; }).join('\n');
}
/* 一句 cue 的预计念白秒数（中文按字，英文/数字按 2 字符 1 字折算），保底 0.6 秒 */
function cueEst(c, rate){
  var t = String(c.text || '');
  var cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  var other = (t.match(/[A-Za-z0-9]/g) || []).length / 2;
  return Math.max(0.6, (cn + other) / (num(rate) || 4.5));
}
/* 字幕里一条 cue 的说话人前缀 */
function cuePrefix(c){
  var t = String(c.type || '').toLowerCase();
  if(t === 'dlg') return c.speaker + '：';
  if(t === 'os') return c.speaker + '(OS)：';
  if(t === 'vo') return c.speaker + '(VO)：';
  return '';
}

/* ---------- 逐句 cue 编辑器 ---------- */
var cueShotId = '';
function cueRowHtml(c){
  var t = c.type || 'narr';
  var opts = [['dlg','对白'],['narr','旁白'],['os','OS 画外'],['vo','VO 内心']].map(function(o){
    return '<option value="' + o[0] + '"' + (t === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('');
  return '<div class="cue-row" style="display:grid;grid-template-columns:110px 100px 110px 1fr 34px;gap:6px;align-items:center;margin-bottom:6px">' +
    '<input class="inp" data-cf="spk" list="cueRoleList" value="' + esc(c.speaker === '旁白' ? '' : (c.speaker || '')) + '" placeholder="说话人">' +
    '<select class="inp" data-cf="type">' + opts + '</select>' +
    '<input class="inp" data-cf="emo" value="' + esc(c.emotion || '') + '" placeholder="情绪，如：强忍眼泪">' +
    '<input class="inp" data-cf="txt" value="' + esc(c.text || '') + '" placeholder="这一句的台词">' +
    '<button class="btn gh sm" data-cact="delrow" title="删除这一句">'+svgIc('x',13)+'</button>' +
    '</div>';
}
function openCueBox(id){
  var s = shotById(id);
  if(!s){ toast('找不到这一镜'); return; }
  cueShotId = id;
  var roles = [];
  state.assets.forEach(function(a){ if(a['类型'] === '角色' && a['名称']) roles.push(String(a['名称']).trim()); });
  var cues = parseCues(s['台词旁白']);
  if(!cues.length) cues = [{ speaker:'', type:'dlg', emotion:'', text:'' }];
  $('cueTitle').textContent = '第 ' + s['镜号'] + ' 镜 · 台词逐句编辑（' + cues.length + ' 句）';
  $('cueMsg').innerHTML =
    '<div class="hint" style="margin-bottom:8px">一行一句。<b>说话人</b>留空 = 旁白；<b>类型</b>：对白 / 旁白 / OS 画外音 / VO 内心独白；<b>情绪</b>会逐句注入配音，并影响质检的时长估算。保存后以 <b>【情绪】角色名(OS)：台词</b> 格式回写「台词 / 旁白」字段，导出字幕逐句拆条、配音按句断句。</div>' +
    '<datalist id="cueRoleList">' + roles.map(function(r){ return '<option value="' + esc(r) + '">'; }).join('') + '</datalist>' +
    '<div id="cueRows">' + cues.map(cueRowHtml).join('') + '</div>';
  $('cueBox').classList.add('on'); $('cueMask').classList.add('on');
}
function closeCueBox(){ $('cueBox').classList.remove('on'); $('cueMask').classList.remove('on'); cueShotId = ''; }
function collectCues(){
  var box = $('cueRows');
  if(!box) return [];
  var rows = box.querySelectorAll('.cue-row'), out = [];
  for(var i=0;i<rows.length;i++){
    var get = function(f){ var el = rows[i].querySelector('[data-cf="' + f + '"]'); return el ? String(el.value || '').trim() : ''; };
    var txt = get('txt');
    if(!txt) continue;
    out.push({ speaker:get('spk') || '旁白', type:get('type') || 'narr', emotion:get('emo'), text:txt });
  }
  return out;
}
function saveCueBox(){
  var id = cueShotId;
  if(!id) return;
  var cues = collectCues();
  if(!cues.length){ toast('至少保留一句台词'); return; }
  closeCueBox();
  patchShot(id, { 台词旁白:fmtCues(cues), 更新时间:nowStr() });
  toast('已保存 ' + cues.length + ' 句台词（逐句结构化）');
}

