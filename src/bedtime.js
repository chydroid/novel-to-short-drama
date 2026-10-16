/* ================= 分支功能：儿童睡前故事 =================
 * 流程：主题 →（LLM）生成结构化故事 → 逐页生图（绘本插画）→ 逐页有感情 TTS 旁白
 *       （独立保存/可下载）→ 组装短视频（服务端 agnes video + 浏览器内幻灯片预览兜底）。
 * 复用现有 AI 抽象：apiPost / apiPostAgnes / apiPostTts / buildTtsBody / audSave / audUrl / pickVideoUrl。
 * 无 key 时走入「演示模式」：内置故事 + SVG 占位插画 + 浏览器朗读 + 占位 WAV，便于离线验证全链路。
 */
function initBedtimeState(){
  if(!state.bedtime) state.bedtime = {
    theme:'', title:'', pages:[], artStyle:'童话水彩绘本', voice:'', style:'温柔', ratio:'3:4', pagesN:6,
    status:'idle', videoURL:'', videoStatus:'', videoTaskId:'', videoErr:'', _cur:0, _playing:false, demo:false
  };
}
function syncBedOpts(){
  var bt = state.bedtime;
  if($('bed-age')) bt.age = $('bed-age').value;
  if($('bed-pages')) bt.pagesN = Math.max(2, Math.min(12, num($('bed-pages').value) || 6));
  if($('bed-art')) bt.artStyle = $('bed-art').value;
  if($('bed-voice')) bt.voice = $('bed-voice').value;
  if($('bed-style')) bt.style = $('bed-style').value;
  if($('bed-ratio')) bt.ratio = $('bed-ratio').value;
  if($('bed-theme')) bt.theme = $('bed-theme').value.trim();
}

/* -------- 演示资源：SVG 占位插画 + 正弦 WAV -------- */
function demoImage(i, text, art){
  var colors = ['#2b2d6e','#3a2b6e','#1f4d6e','#6e2b4d','#2b6e4d','#6e5a2b'];
  var bg = colors[i % colors.length];
  var t = String(text || '').slice(0, 38);
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">'
    + '<rect width="300" height="400" fill="' + bg + '"/>'
    + '<circle cx="240" cy="58" r="26" fill="#ffe9a8"/>'
    + '<text x="150" y="190" fill="#ffffff" font-size="16" text-anchor="middle" font-family="sans-serif">第 ' + (i + 1) + ' 页</text>'
    + '<text x="150" y="230" fill="#ffe9a8" font-size="12" text-anchor="middle" font-family="sans-serif">' + t + '</text>'
    + '<text x="150" y="370" fill="#ffffff" font-size="11" text-anchor="middle" font-family="sans-serif" opacity="0.7">' + (art || '绘本插画') + '</text>'
    + '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function encodeWav(samples, sampleRate){
  var buffer = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buffer);
  function ws(off, s){ for(var i=0;i<s.length;i++) view.setUint8(off + i, s.charCodeAt(i)); }
  ws(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, samples.length * 2, true);
  var off = 44;
  for(var i=0;i<samples.length;i++){ var s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2; }
  return buffer;
}
function sineWavB64(durSec, freq){
  durSec = durSec || 4; freq = freq || 440;
  var sr = 22050, n = Math.floor(durSec * sr), samples = new Float32Array(n);
  for(var i=0;i<n;i++){ var t = i / sr; var env = Math.min(1, t * 4) * Math.min(1, (n - i) / sr * 4); samples[i] = Math.sin(2 * Math.PI * freq * t) * 0.22 * env; }
  var buf = encodeWav(samples, sr), bytes = new Uint8Array(buf), bin = '';
  for(var k=0;k<bytes.length;k++) bin += String.fromCharCode(bytes[k]);
  return btoa(bin);
}

/* -------- 故事解析 / 演示故事 -------- */
function parseStoryJson(c){
  if(!c) return null;
  c = String(c).trim();
  var m = c.match(/```(?:json)?\s*([\s\S]*?)```/i); if(m) c = m[1].trim();
  try { var o = JSON.parse(c); if(o && o.pages) return o; } catch(e){}
  var i = c.indexOf('{'), j = c.lastIndexOf('}');
  if(i >= 0 && j > i){ try { var o2 = JSON.parse(c.slice(i, j + 1)); if(o2 && o2.pages) return o2; } catch(e){} }
  return null;
}
function bedtimeDemoStory(theme){
  var n = state.bedtime.pagesN || 6;
  var title = '🌙 ' + (theme || '森林里的小熊');
  var arcs = [
    '夜深了，' + (theme || '小熊') + '轻轻闭上眼睛。',
    '窗外，一颗小星星探出云朵，朝它眨了眨眼。',
    '温柔的风抱着它，慢慢数着：一、二、三……',
    '月亮把银色的光，轻轻盖在它身上。',
    '远处的溪流唱着安眠的歌，哗啦，哗啦。',
    '它打了个哈欠，把白天的调皮都放下了。',
    '梦里，它坐在一朵软软的云上飘呀飘。',
    '星星牵着它的手，说：别怕，我一直都在。',
    '眼皮越来越沉，像被棉花糖裹住。',
    '晚安，小宝贝，明天太阳升起时，我们再玩。'
  ];
  var pages = [];
  for(var i=0;i<n;i++){ var t = arcs[i % arcs.length]; pages.push({ text:t, imgPrompt:'儿童绘本插画，梦幻柔和，' + (theme || '小熊') + '，第 ' + (i + 1) + ' 幕：' + t }); }
  return { title:title, pages:pages };
}

/* -------- 各步骤 -------- */
function genBedtimeStory(){
  syncBedOpts();
  var bt = state.bedtime, theme = bt.theme;
  if(!theme){ toast('请先在上方填写故事主题'); return; }
  if(cfg.textKey){
    var sys = '你是一个儿童睡前故事作家。根据用户的「主题」创作一个温柔、治愈、适合 3-8 岁儿童的睡前故事。'
      + '请只输出 JSON，格式：{"title":"故事标题","pages":[{"text":"这一页的旁白文字（1-3 句，温暖简短）","imgPrompt":"这一页对应的绘本插画提示词（中文，描述画面、角色、氛围，不要含文字）"}]}。'
      + '页数由用户指定。不要输出 JSON 以外的任何内容。';
    var user = '主题：' + theme + '\n适读年龄：' + (bt.age || '3-8 岁') + '\n页数：' + bt.pagesN
      + '\n画风：' + bt.artStyle + '\n情绪基调：' + bt.style;
    bt.status = '故事生成中…'; renderBedtime();
    apiPost(cfg.textBase.replace(/\/+$/, '') + '/chat/completions', cfg.textKey, { model:cfg.textModel, messages:[{ role:'system', content:sys }, { role:'user', content:user }] })
      .then(function(r){
        var j = parseJsonSafe(r.text);
        var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        var obj = parseStoryJson(c);
        if(!obj) throw new Error('无法解析故事 JSON：' + (r.text || '').slice(0, 160));
        applyStory(obj);
      })
      .catch(function(e){ console.error(e); bt.status = '故事生成失败'; toast('故事生成失败：' + guessCorsMsg(e)); renderBedtime(); });
  } else {
    applyStory(bedtimeDemoStory(theme));
    toast('未配置文本模型，使用演示故事（演示模式）');
  }
}
function applyStory(obj){
  var bt = state.bedtime;
  bt.title = obj.title || bt.theme || '睡前故事';
  bt.pages = (obj.pages || []).map(function(p){
    return { text:String(p.text || ''), imgPrompt:String(p.imgPrompt || p.text || ''), imgURL:'', audURL:'', audB64:'', audMime:'', audRemote:false, imgErr:'', audErr:'' };
  });
  bt.status = '故事已生成（' + bt.pages.length + ' 页）';
  renderBedtime();
  toast('故事已生成：' + bt.pages.length + ' 页');
}
function genBedtimeImage(p, idx){
  return apiPostAgnes(cfg.agnesBase + '/images/generations', {
    model:'agnes-image-2.5-flash',
    prompt:(p.imgPrompt || '') + '。' + (state.bedtime.artStyle || ''),
    size:cfg.imgSize || '1024x1024',
    ratio:state.bedtime.ratio || '3:4',
    extra_body:{ response_format:'url' }
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    var url = j && j.data && j.data[0] && (j.data[0].url || (j.data[0].b64_json ? 'data:image/png;base64,' + j.data[0].b64_json : ''));
    if(r.status >= 400 || !url){ var m = (j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error) : (r.text || '').slice(0, 180); throw new Error('HTTP ' + r.status + ' ' + m); }
    return url;
  });
}
function genBedtimeImages(){
  var bt = state.bedtime;
  if(!bt.pages.length){ toast('请先生成故事'); return; }
  if(!hasAgnesKey()){
    bt.pages.forEach(function(p, i){ if(!p.imgURL) p.imgURL = demoImage(i, p.text, bt.artStyle); });
    bt.status = '演示插画已生成（演示模式）'; renderBedtime(); toast('未配置 Agnes Key，使用演示插画');
    return;
  }
  if(guardBudget()) return;
  bt.status = '插画生成中…'; renderBedtime();
  var seq = bt.pages.map(function(p, i){ return i; });
  var run = function(k){
    if(k >= seq.length){ bt.status = '绘本插画完成'; renderBedtime(); toast('绘本插画完成'); return; }
    var i = seq[k], p = bt.pages[i];
    genBedtimeImage(p, i).then(function(url){ p.imgURL = url; p.imgErr = ''; renderBedtime(); run(k + 1); })
      .catch(function(e){ console.error(e); p.imgErr = guessCorsMsg(e); renderBedtime(); run(k + 1); });
  };
  run(0);
}
function genBedtimeAudio(p){
  return apiPostTts(cfg.ttsBase.replace(/\/+$/, '') + '/chat/completions', cfg.ttsKey, buildTtsBody(p.text, state.bedtime.voice, state.bedtime.style))
    .then(function(r){
      var j = parseJsonSafe(r.text);
      var b64 = pickAudioB64(j), url = pickAudioUrl(j);
      if(r.status >= 400 || (!b64 && !url)){ var m = (j && (j.error || j.message)) ? JSON.stringify(j.error || j.message) : (r.text || '').slice(0, 180); throw new Error('HTTP ' + r.status + ' ' + m); }
      return { b64:b64, url:url };
    });
}
function genBedtimeAudioAll(){
  var bt = state.bedtime;
  if(!bt.pages.length){ toast('请先生成故事'); return; }
  if(!cfg.ttsKey){
    bt.demo = true; bt.status = '未配置 TTS：播放绘本将用浏览器朗读（演示）'; renderBedtime(); toast('未配置 TTS Key，使用浏览器朗读演示');
    return;
  }
  if(guardBudget()) return;
  bt.demo = false; bt.status = '旁白生成中…'; renderBedtime();
  var mime = (cfg.ttsFormat === 'wav') ? 'audio/wav' : 'audio/mpeg';
  var seq = bt.pages.map(function(p, i){ return i; });
  var run = function(k){
    if(k >= seq.length){ bt.status = '旁白音频完成'; renderBedtime(); toast('旁白音频完成'); return; }
    var i = seq[k], p = bt.pages[i];
    genBedtimeAudio(p).then(function(res){
      if(res.b64){ audSave('bed_' + i, res.b64, mime, 0); p.audB64 = res.b64; p.audMime = mime; p.audURL = audUrl('bed_' + i); }
      else if(res.url){ p.audURL = res.url; p.audRemote = true; }
      p.audErr = ''; renderBedtime(); run(k + 1);
    }).catch(function(e){ console.error(e); p.audErr = guessCorsMsg(e); renderBedtime(); run(k + 1); });
  };
  run(0);
}
/* -------- Agnes V2.0 音画同步短视频（原生带同步语音+口型） -------- */
function bedtimeVoiceDesc(){
  var v = (state.bedtime.voice || '温柔女声');
  return ({ '温柔女声':'gentle female voice, soft and warm tone', '慈爱爷爷':'kind old grandfather voice, deep and warm tone', '柔和男声':'soft male voice, calm tone', '精灵妹妹':'cheerful little fairy girl voice, sweet tone' })[v] || 'gentle voice';
}
function bedtimeDims(){
  var r = state.bedtime.ratio || '3:4';
  return ({ '3:4':[768,1024], '1:1':[1024,1024], '16:9':[1280,720], '9:16':[720,1280] })[r] || [768,1024];
}
/* V2.0 单片段上限约 121 帧@24fps≈5s，旁白过长需按句/按逗号拆成多段 */
function splitNarration(t){
  t = String(t || '').trim(); if(!t) return [];
  var segs = t.split(/(?<=[。！？；\n])/).map(function(s){ return s.trim(); }).filter(Boolean);
  var out = [];
  segs.forEach(function(s){
    if(s.length <= 24){ out.push(s); return; }
    var parts = s.split(/(?<=[，,、])/).map(function(x){ return x.trim(); }).filter(Boolean);
    if(parts.length > 1){ parts.forEach(function(p){ out.push(p); }); }
    else { for(var i=0;i<s.length;i+=20) out.push(s.slice(i, i+20)); }
  });
  return out.filter(function(s){ return s.length; });
}
function pollAgnesClip(videoId){
  return new Promise(function(resolve, reject){
    var tries = 0;
    var tick = function(){
      tries++;
      if(tries > 240){ reject(new Error('轮询超时（超过 12 分钟）')); return; }
      apiGet(cfg.agnesQuery + '/agnesapi?video_id=' + encodeURIComponent(videoId) + '&model_name=agnes-video-v2.0', ak())
        .then(function(r){
          var j = parseJsonSafe(r.text), st = pickStatus(j), url = pickVideoUrl(j);
          if(st === 'completed' || st === 'succeeded' || st === 'success' || url){ resolve(url || ''); }
          else if(st === 'failed' || st === 'error'){ reject(new Error((j && (j.error || j.message)) ? JSON.stringify(j.error || j.message) : (r.text || '').slice(0,160))); }
          else setTimeout(tick, 3500);
        })
        .catch(function(e){ if(tries > 3) reject(e); else setTimeout(tick, 3500); });
    };
    tick();
  });
}
function genOneClip(p, seg){
  var dims = bedtimeDims(), voice = bedtimeVoiceDesc();
  var prompt = '儿童睡前故事绘本动画，' + (state.bedtime.artStyle || '童话水彩') + '风格，' + (state.bedtime.style || '温柔') + '氛围。'
    + '画面中的主角用' + voice + '温柔地讲述：(用中文说)\'' + seg + '\' 主角正在说话，嘴巴在动，表情安详。';
  var nf = Math.min(121, Math.max(24, Math.round(seg.length * 5)));
  return apiPostAgnes(cfg.agnesBase + '/videos', {
    model:'agnes-video-v2.0', prompt:prompt, width:dims[0], height:dims[1], num_frames:nf, frame_rate:24,
    extra_body:{ image:p.imgURL }
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    var vid = (j && (j.video_id || j.id || j.task_id)) || '';
    if(r.status >= 400 || !vid) throw new Error('未取到 video_id：' + (r.text || '').slice(0,180));
    return pollAgnesClip(vid);
  });
}
function genBedtimeVideo(){
  var bt = state.bedtime;
  if(!bt.pages.length || !bt.pages[0].imgURL){ toast('请先生成故事与绘本插画（需真实图片 URL 作参考帧）'); return; }
  if(!hasAgnesKey()){
    toast('未配置 Agnes Key：改用「播放绘本」做浏览器内预览');
    bedPlay(); return;
  }
  if(guardBudget()) return;
  bt._moviePlaying = false;
  var total = 0, done = 0;
  bt.pages.forEach(function(p){ p.clips = []; p.clipErr = ''; total += splitNarration(p.text).length; });
  if(!total){ toast('没有可生成旁白的文本'); return; }
  bt.videoStatus = '生成中… (0/' + total + ')'; renderBedtime();
  var chain = Promise.resolve();
  bt.pages.forEach(function(p, pi){
    var segs = splitNarration(p.text);
    segs.forEach(function(seg){
      chain = chain.then(function(){
        if(!state.bedtime.pages[pi]) return;
        return genOneClip(p, seg).then(function(url){
          if(url){ p.clips.push(url); }
          done++; bt.videoStatus = '生成中… (' + done + '/' + total + ')'; renderBedtime();
        }).catch(function(e){ console.error(e); p.clipErr = guessCorsMsg(e); bt.videoStatus = '部分片段失败：' + guessCorsMsg(e); renderBedtime(); });
      });
    });
  });
  chain.then(function(){
    bt.videoStatus = '短视频生成完成（' + done + '/' + total + ' 段 · Agnes V2.0 原生音画同步）';
    renderBedtime(); toast('睡前故事短视频生成完成');
  });
}
function bedAllClips(){
  var bt = state.bedtime; if(!bt || !bt.pages) return [];
  var a = []; bt.pages.forEach(function(p){ if(p.clips) p.clips.forEach(function(u){ a.push(u); }); }); return a;
}

/* -------- 浏览器内幻灯片（短视频预览，永远可用） -------- */
function bedStep(){
  var bt = state.bedtime, p = bt.pages[bt._cur];
  if(!p){ bedStop(); return; }
  var img = $('bed-stage-img'); if(img) img.src = p.imgURL || demoImage(bt._cur, p.text, bt.artStyle);
  var cap = $('bed-stage-cap'); if(cap) cap.textContent = '第 ' + (bt._cur + 1) + ' / ' + bt.pages.length + ' 页 · ' + (p.text || '');
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  var advance = function(){ if(!bt._playing) return; bt._cur++; if(bt._cur >= bt.pages.length){ bedStop(); return; } bedStep(); };
  if(p.audURL && !bt.demo){
    var a = $('bed-stage-audio');
    if(a){ a.src = p.audURL; a.onended = advance; var pr = a.play(); if(pr && pr.catch) pr.catch(advance); }
    else advance();
  } else if(window.speechSynthesis){
    var u = new SpeechSynthesisUtterance(p.text || ''); u.lang = 'zh-CN'; u.rate = 0.9; u.onend = advance; window.speechSynthesis.speak(u);
  } else {
    var secs = Math.max(2, (p.text || '').length / 8); setTimeout(advance, secs * 1000);
  }
}
function bedPlay(){ var bt = state.bedtime; if(!bt.pages.length){ toast('请先生成故事'); return; } bt._cur = 0; bt._playing = true; bedStep(); }
function bedStop(){ var bt = state.bedtime; bt._playing = false; if(window.speechSynthesis) window.speechSynthesis.cancel(); }
function bedPrev(){ var bt = state.bedtime; if(bt._cur > 0){ bt._cur--; if(!bt._playing) bedStep(); } }
function bedNext(){ var bt = state.bedtime; if(bt._cur < bt.pages.length - 1){ bt._cur++; if(!bt._playing) bedStep(); } }
function bedPlayMovie(){
  var bt = state.bedtime, all = bedAllClips(); if(!all.length){ toast('请先生成短视频'); return; }
  var mv = $('bed-movie'); if(!mv) return;
  bt._moviePlaying = true; mv.style.display = 'block';
  var i = 0;
  mv.onended = function(){ if(i >= all.length){ bt._moviePlaying = false; mv.style.display = 'none'; return; } mv.src = all[i++]; var pr = mv.play(); if(pr && pr.catch) pr.catch(function(){ i++; mv.onended(); }); };
  mv.onended();
}

/* -------- 下载 / 导出（音频独立保存） -------- */
function doDownload(url, name){ var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function(){ if(a.parentNode) a.parentNode.removeChild(a); }, 120); }
function downloadB64(b64, mime, name){
  try{ var bin = atob(b64), arr = new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([arr], { type:mime || 'audio/mpeg' })); doDownload(url, name); }
  catch(e){ toast('下载失败'); }
}
function downloadPageAudio(i){
  var p = state.bedtime.pages[i]; if(!p) return;
  if(p.audB64) downloadB64(p.audB64, p.audMime || 'audio/mpeg', '睡前故事_第' + (i + 1) + '页.mp3');
  else if(p.audURL) doDownload(p.audURL, '睡前故事_第' + (i + 1) + '页' + (p.audRemote ? '.mp3' : ''));
  else { var b64 = sineWavB64(4, 440); downloadB64(b64, 'audio/wav', '睡前故事_第' + (i + 1) + '页_演示.wav'); }
}
function downloadAllBedtimeAudio(){
  var bt = state.bedtime; if(!bt.pages.length){ toast('请先生成故事'); return; }
  bt.pages.forEach(function(p, i){ setTimeout(function(){ downloadPageAudio(i); }, i * 350); });
  toast('开始下载全部旁白音频（独立文件）');
}
function exportBedtimeBook(){
  var bt = state.bedtime; if(!bt.pages.length){ toast('请先生成故事'); return; }
  var story = (bt.title || '睡前故事') + '\n\n' + bt.pages.map(function(p, i){ return (i + 1) + '. ' + (p.text || ''); }).join('\n');
  var b64 = btoa(unescape(encodeURIComponent(story)));
  downloadB64(b64, 'text/plain;charset=utf-8', (bt.title || '睡前故事') + '.txt');
  bt.pages.forEach(function(p, i){ setTimeout(function(){
    if(p.imgURL && p.imgURL.indexOf('data:image/svg') !== 0){
      if(p.imgURL.indexOf('data:') === 0){ var c = p.imgURL.split(',')[1]; if(c) downloadB64(c, 'image/png', '睡前故事_第' + (i + 1) + '页.png'); }
      else doDownload(p.imgURL, '睡前故事_第' + (i + 1) + '页.png');
    }
  }, 200 + i * 300); });
  toast('导出绘本：逐页图片 + 故事文本');
}

/* ④b：把各页的 V2.0 音画同步短视频片段按页序拼接成单个 mp4（ffmpeg 拼接脚本） */
function exportBedtimeMerge(){
  var clips = bedAllClips();
  if(!clips.length){ toast('还没有生成的短视频片段（请先点 ④ 生成短视频）'); return; }
  var sh = [], bat = [];
  sh.push('#!/bin/bash');
  sh.push('# 睡前故事短视频拼接（Agnes V2.0 音画同步片段，已含同步语音）');
  sh.push('# 用法：把本脚本与可访问的片段 URL 放同一目录，运行  bash merge_bedtime.sh');
  bat.push('@echo off'); bat.push('chcp 65001 >nul');
  bat.push('rem 睡前故事短视频拼接（Agnes V2.0 音画同步片段，已含同步语音）');
  bat.push('rem 用法：运行  merge_bedtime.bat');
  var files = [];
  clips.forEach(function(u, i){
    var f = 'seg_' + (i + 1) + '.mp4'; files.push(f);
    sh.push('ffmpeg -y -loglevel error -i ' + shQ(u) + ' -c copy ' + f + ' || ffmpeg -y -loglevel error -i ' + shQ(u) + ' ' + f);
    bat.push('ffmpeg -y -loglevel error -i "' + u + '" -c copy ' + f);
    bat.push('if errorlevel 1 ffmpeg -y -loglevel error -i "' + u + '" ' + f);
  });
  var concat = files.map(function(f){ return "file '" + f + "'"; }).join('\n');
  sh.push("cat > concat.txt <<'EOF'\n" + concat + "\nEOF");
  bat.push('type nul > concat.txt');
  files.forEach(function(f){ bat.push("echo file '" + f + "'>>concat.txt"); });
  sh.push('ffmpeg -y -loglevel error -f concat -safe 0 -i concat.txt -c copy 睡前故事_成片.mp4');
  bat.push('ffmpeg -y -loglevel error -f concat -safe 0 -i concat.txt -c copy 睡前故事_成片.mp4');
  sh.push('echo 完成：睡前故事_成片.mp4（' + clips.length + ' 段，已含音画同步语音）');
  bat.push('echo 完成：睡前故事_成片.mp4'); bat.push('pause');
  download('merge_bedtime.sh', sh.join('\n'), 'text/plain;charset=utf-8');
  download('merge_bedtime.bat', bat.join('\n'), 'text/plain;charset=utf-8');
  var man = { 说明:'睡前故事 V2.0 音画同步片段拼接为单个 mp4', 片段数: clips.length, 片段URL: clips, 输出:'睡前故事_成片.mp4（运行 merge_bedtime.sh / .bat）' };
  download('睡前故事_合成清单.json', JSON.stringify(man, null, 2), 'application/json');
  toast('已导出 ffmpeg 拼接脚本（merge_bedtime.sh / .bat）+ 片段清单');
}

/* -------- 视图渲染 -------- */
function buildBedtimeShell(){
  var root = document.createElement('div');
  root.className = 'bed-wrap';
  root.innerHTML =
    '<h2 style="margin:0 0 10px;font-size:20px">🌙 儿童睡前故事生成器</h2>'
    + '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start">'
    + '  <div style="flex:1 1 320px;min-width:280px">'
    + '    <label style="display:block;font-size:13px;color:#9aa">故事主题</label>'
    + '    <textarea id="bed-theme" rows="2" placeholder="例如：一只怕黑的小熊，在森林里找星星" style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #345;background:#0e1530;color:#e8ecff"></textarea>'
    + '  </div>'
    + '  <div style="flex:1 1 320px;min-width:280px;display:grid;grid-template-columns:1fr 1fr;gap:8px">'
    + '    <label style="font-size:13px;color:#9aa">适读年龄<select id="bed-age" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>3-5 岁</option><option selected>3-8 岁</option><option>6-10 岁</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">页数<select id="bed-pages" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>4</option><option selected>6</option><option>8</option><option>10</option><option>12</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">画风<select id="bed-art" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>童话水彩绘本</option><option>柔和 3D 卡通</option><option>蜡笔手绘</option><option>国风水墨</option><option>梦幻光影</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">比例<select id="bed-ratio" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option value="3:4" selected>3:4 竖版</option><option value="1:1">1:1 方图</option><option value="16:9">16:9 横版</option><option value="9:16">9:16 手机</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">旁白音色<select id="bed-voice" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>温柔女声</option><option>慈爱爷爷</option><option>柔和男声</option><option>精灵妹妹</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">情绪风格<select id="bed-style" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>温柔</option><option>神秘</option><option>欢快</option><option>宁静</option><option>俏皮</option></select></label>'
    + '  </div>'
    + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">'
    + '  <button id="bed-gen-story" class="bed-btn">① 生成故事</button>'
    + '  <button id="bed-gen-img" class="bed-btn">② 生成绘本插画</button>'
    + '  <button id="bed-gen-audio" class="bed-btn">③ 生成旁白音频</button>'
    + '  <button id="bed-gen-video" class="bed-btn">④ 生成短视频</button>'
    + '  <button id="bed-play" class="bed-btn">▶ 播放绘本</button>'
    + '  <button id="bed-dl-audio" class="bed-btn">⬇ 下载全部音频</button>'
    + '  <button id="bed-export" class="bed-btn">⬇ 导出绘本</button>'
    + '  <button id="bed-merge" class="bed-btn">④b 合成单视频(ffmpeg)</button>'
    + '</div>'
    + '<div id="bed-status" style="font-size:13px;color:#8ad;min-height:18px;margin-bottom:6px"></div>'
    + '<div id="bed-stage" style="display:none;margin:8px 0;padding:10px;border:1px solid #345;border-radius:10px;background:#0b1030">'
    + '  <img id="bed-stage-img" style="width:100%;max-width:360px;display:block;margin:0 auto;border-radius:8px" alt="绘本">'
    + '  <div id="bed-stage-cap" style="font-size:13px;color:#cdd;margin:8px 0;text-align:center"></div>'
    + '  <audio id="bed-stage-audio" style="width:100%;display:none"></audio>'
    + '  <div style="display:flex;gap:8px;justify-content:center">'
    + '    <button id="bed-prev" class="bed-btn">‹ 上一页</button>'
    + '    <button id="bed-stop" class="bed-btn">⏸ 停止</button>'
    + '    <button id="bed-next" class="bed-btn">下一页 ›</button>'
    + '  </div>'
    + '</div>'
    + '<div id="bed-video" style="margin:8px 0">'
    + '  <div id="bed-video-status" style="font-size:13px;color:#8ad;min-height:16px;margin:4px 0"></div>'
    + '  <div id="bed-video-clips"></div>'
    + '  <video id="bed-movie" controls style="width:100%;max-width:360px;display:none;margin:6px auto;border-radius:8px"></video>'
    + '</div>'
    + '<div id="bed-pages" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:10px"></div>';
  var box = $('v-bedtime'); box.innerHTML = ''; box.appendChild(root);
  // 让 stage 的 audio 元素在播放时可见（用于真实音频播放）
  var stageAudio = $('bed-stage-audio'); if(stageAudio) stageAudio.style.display = 'block';
  $('bed-gen-story').onclick = genBedtimeStory;
  $('bed-gen-img').onclick = genBedtimeImages;
  $('bed-gen-audio').onclick = genBedtimeAudioAll;
  $('bed-gen-video').onclick = genBedtimeVideo;
  $('bed-play').onclick = function(){ $('bed-stage').style.display = 'block'; bedPlay(); };
  $('bed-dl-audio').onclick = downloadAllBedtimeAudio;
  $('bed-export').onclick = exportBedtimeBook;
  $('bed-merge').onclick = exportBedtimeMerge;
  $('bed-prev').onclick = bedPrev;
  $('bed-next').onclick = bedNext;
  $('bed-stop').onclick = bedStop;
  if(!box._styled){
    var st = document.createElement('style');
    st.textContent = '.bed-btn{padding:7px 12px;border-radius:8px;border:1px solid #3a5;border:1px solid #345;background:#16204a;color:#dfe6ff;cursor:pointer;font-size:13px}.bed-btn:hover{background:#1d2c63}.bed-card{background:#0e1530;border:1px solid #2a3566;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}.bed-card-img{width:100%;aspect-ratio:3/4;object-fit:cover;background:#1a2348}.bed-card-txt{font-size:12px;color:#cdd;padding:8px;min-height:48px}.bed-card-aud{padding:0 8px 8px}.bed-card button{margin:0 8px 8px;padding:5px 8px;border-radius:6px;border:1px solid #345;background:#16204a;color:#dfe6ff;cursor:pointer;font-size:12px}';
    document.head.appendChild(st); box._styled = true;
  }
}
function renderBedtime(){
  var box = $('v-bedtime'); if(!box) return;
  initBedtimeState();
  if(!box.querySelector('.bed-wrap')) buildBedtimeShell();
  var bt = state.bedtime;
  // 状态
  var st = $('bed-status'); if(st) st.textContent = (bt.title ? '《' + bt.title + '》 ' : '') + (bt.status || '');
  // 视频区（Agnes V2.0 音画同步片段）
  var vst = $('bed-video-status'); if(vst) vst.textContent = (bt.videoStatus ? ('视频状态：' + bt.videoStatus) : '') + (bt.videoErr ? '（' + bt.videoErr + '）' : '');
  var vc = $('bed-video-clips');
  if(vc && !bt._moviePlaying){
    var all = bedAllClips();
    if(all.length){
      var h = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0">'
        + '<button id="bed-movie-play" class="bed-btn">▶ 连播全部片段</button>'
        + '<span style="font-size:12px;color:#9aa">共 ' + all.length + ' 段音画同步短视频（Agnes V2.0 原生生成·自带同步语音；与③单独下载的 TTS 音色不同）</span></div>';
      all.forEach(function(u, i){
        h += '<div style="margin:6px 0"><div style="font-size:12px;color:#9aa">片段 ' + (i + 1) + '</div>'
          + '<video src="' + u + '" controls style="width:100%;max-width:360px;display:block;border-radius:8px"></video></div>';
      });
      vc.innerHTML = h;
      var mp = $('bed-movie-play'); if(mp) mp.onclick = bedPlayMovie;
    } else { vc.innerHTML = ''; }
  }
  // 绘本页
  var pg = $('bed-pages'); if(!pg) return;
  pg.innerHTML = '';
  bt.pages.forEach(function(p, i){
    var card = document.createElement('div'); card.className = 'bed-card';
    var img = document.createElement('img'); img.className = 'bed-card-img'; img.src = p.imgURL || demoImage(i, p.text, bt.artStyle); img.alt = '第 ' + (i + 1) + ' 页';
    var txt = document.createElement('div'); txt.className = 'bed-card-txt'; txt.textContent = (i + 1) + '. ' + (p.text || '');
    var aud = document.createElement('div'); aud.className = 'bed-card-aud';
    if(p.audURL){ var a = document.createElement('audio'); a.controls = true; a.src = p.audURL; a.style.width = '100%'; aud.appendChild(a); }
    else { aud.textContent = p.audErr ? '音频失败：' + p.audErr : '（未生成音频）'; aud.style.color = '#888'; aud.style.fontSize = '12px'; }
    var dl = document.createElement('button'); dl.textContent = '下载音频'; dl.onclick = function(){ downloadPageAudio(i); };
    card.appendChild(img); card.appendChild(txt); card.appendChild(aud); card.appendChild(dl);
    pg.appendChild(card);
  });
}
initBedtimeState();
