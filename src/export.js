/* ================= v2.15：导出中心 =================
   原先导出按钮散在「④ 成片与导出」工具区一排（md/csv/json/srt/整轨/转码/合成包/fcpxml），
   屏幕小的时候要横着找。这里集中成一个面板，按 出片 / 字幕音频 / 数据脚本 / 备份 分组。
   面板里的按钮沿用原来的 id 与事件绑定，所以行为零变化；备份三项转发到首页那套逻辑，避免重复实现。 */
function openExportPanel(){
  var b = $('expBox'), m = $('expMask');
  if(!b) return;
  b.classList.add('on'); if(m) m.classList.add('on');
  updExpPreview();   /* v2.18：打开面板先按当前范围算一遍「导出几镜 / 多长」 */
  renderRangePresets();   /* v2.21：预设括号里的命中镜数要按当前分镜重算（分镜可能在打开之间变了） */
}
function closeExportPanel(){
  var b = $('expBox'), m = $('expMask');
  if(b) b.classList.remove('on');
  if(m) m.classList.remove('on');
}

/* ================= v2.14：mp3 转码命令（FFmpeg 兜底） =================
   浏览器端没有任何 mp3 编码器（内联 lamejs 要几百 KB，走 CDN 又破坏离线可用），
   所以不假装能导出 mp3——直接给一条可复制的 FFmpeg 命令，用户粘到导出目录执行即可。
   一键合成包本来就用 FFmpeg，等于零额外依赖。 */
function ffmpegMp3Cmd(){
  var src = cfg.trackZip ? '整轨配音.m4a' : '整轨配音.wav';
  return 'ffmpeg -i ' + src + ' -codec:a libmp3lame -b:a 128k 整轨配音.mp3\n' +
         '# 分镜单条配音很多个 wav 时，批量转：\n' +
         '# for f in *.wav; do ffmpeg -i "$f" -codec:a libmp3lame -b:a 128k "${f%.wav}.mp3"; done';
}
function fallbackCopy(t){
  try{
    var ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  }catch(e){ return false; }
}
function copyText(t){
  return new Promise(function(res){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(t).then(function(){ res(true); }, function(){ res(fallbackCopy(t)); });
        return;
      }
    }catch(e){}
    res(fallbackCopy(t));
  });
}
function copyFfmpegCmd(){
  var cmd = ffmpegMp3Cmd();
  copyText(cmd).then(function(ok){
    toast(ok ? '已复制 FFmpeg 转码命令，粘到导出目录执行即可出 mp3' : '复制失败，命令是：' + cmd.split('\n')[0]);
  });
}

/* ================= 字幕 / 整轨配音导出 ================= */
function srtTime(t){
  var h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
  var p = function(n){ return (n<10?'0':'')+n; };
  return p(h)+':'+p(m)+':'+p(Math.floor(s))+','+String(Math.floor((s%1)*1000)).padStart(3,'0');
}
function shotDur(s){
  /* 统一镜头有效时长口径（v2.8，对标 Jellyfish 时间轴一致性）：
     优先用配音解析的真实时长，并 clamp 到 API/成片允许的 4–12 秒——
     保证 SRT / 整轨配音 / FCPXML / render.sh 四处的镜头时长完全一致，不再各算各的。 */
  var raw = num(s['音频时长']) > 0 ? num(s['音频时长']) : (num(s['时长秒']) || 5);
  return Math.min(12, Math.max(4, raw));
}
/* v2.16：把字幕生成抽成纯函数，「导出单个」与「一键打包」共用同一份逻辑，避免两处算出不同结果。
   返回 { text, n, cueTotal, alignN }，没有任何台词时返回 null。 */
function buildSrtText(scope){   /* v2.17：可选 scope 只导出指定范围；不传 = 全部镜头，行为与之前一致 */
  var L = scope || state.shots;
  if(!L.length) return null;
  var rate = num(cfg.cnRate) || 4.5;
  var t = 0, out = [], n = 0, cueTotal = 0, alignN = 0;
  L.forEach(function(s){
    var d = shotDur(s), text = String(s['台词旁白'] || '').trim();
    if(text){
      /* v2.9：逐句 cue 拆条——一句一条字幕，时间按各句预计语速占比在本镜时长内分配 */
      var cues = (cfg.srtCue !== false) ? parseCues(text) : [];
      if(cues.length <= 1){
        n++;
        out.push(String(n));
        out.push(srtTime(t) + ' --> ' + srtTime(t + d));
        out.push(text);
        out.push('');
      } else {
        /* v2.11：跑过逐句配音的镜头用每句的真实音频时长切分，字幕与口型严丝合缝；
           没配音或句数对不上（台词改过）时自动退回按字数估算，不会算错时间轴 */
        var real = (cfg.cueAlign !== false) ? cueDurLoad(s._id) : null;
        var ests = (real && real.length === cues.length) ? real.slice() : cues.map(function(c){ return cueEst(c, rate); });
        if(real && real.length === cues.length) alignN++;
        var sum = 0; ests.forEach(function(e){ sum += e; });
        var ct = t;
        cues.forEach(function(c, i){
          var cd = sum > 0 ? d * ests[i] / sum : d / cues.length;
          if(i === cues.length - 1) cd = t + d - ct;   /* 尾句兜到镜末，避免累计误差留缝 */
          n++; cueTotal++;
          out.push(String(n));
          out.push(srtTime(ct) + ' --> ' + srtTime(ct + cd));
          out.push(cuePrefix(c) + c.text);
          out.push('');
          ct += cd;
        });
      }
    }
    t += d;
  });
  if(!n) return null;
  return { text: out.join('\n'), n: n, cueTotal: cueTotal, alignN: alignN };
}
function exportSrt(){
  if(!state.shots.length){ toast('还没有分镜'); return; }
  var r = buildSrtText(exportScopeShots());
  if(!r){ toast('没有任何台词，无法生成字幕'); return; }
  download('分镜字幕.srt', r.text, 'text/plain;charset=utf-8');
  /* v2.53：cueTotal 是「被逐句拆出来的条数」，n 是总条数，恒有 cueTotal <= n，
     原来的 cueTotal > n 永远为假，这句提示是死代码。 */
  toast('字幕已导出，共 ' + r.n + ' 条' + (r.cueTotal > 0 ? '（按逐句 cue 拆分）' : '') +
    (r.alignN ? '，其中 ' + r.alignN + ' 镜按配音真实句长对齐' : ''));
}
/* ================= v2.44：浏览器内成片预览播放器 =================
   不导出即可在网页里看一遍成片：图片轮播（带 Ken Burns 缓慢推近）+ 字幕 + 配音整轨。
   播放范围与「导出中心」的「打包范围 + 状态筛选」完全一致（viewShots(exportScopeShots(),...)），
   保证「预览什么 = 导出什么」；声音复用 buildTrackWav 合成的整轨（含 BGM），字幕复用 buildSrtText 的时间轴。 */
function pvFmt(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
/* 把 buildSrtText 产出的标准 SRT 文本解析成 {t0,t1,text} 片段（与导出字幕同一套时间轴，不会算错） */
function parseSrt(txt){
  if(!txt) return [];
  var out = [], blocks = String(txt).replace(/\r/g, '').split(/\n\n+/);
  blocks.forEach(function(b){
    var lines = b.split('\n');
    if(lines.length < 2) return;
    var m = lines[1].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if(!m) return;
    var t0 = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    var t1 = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    var text = lines.slice(2).join('\n').trim();
    if(text) out.push({ t0:t0, t1:t1, text:text });
  });
  return out;
}
/* 字幕样式：与 render.sh 的 force_style 同一套（字体/字号/颜色/描边/边距/加粗），按舞台高度等比缩放 */
function pvSubStyle(){
  var stage = $('pvStage');
  var h = stage ? (stage.clientHeight || 600) : 600;
  var size = Math.max(8, Math.min(48, num(cfg.subSize) || 14));
  var margin = Math.max(0, num(cfg.subMargin) || 36);
  var el = $('pvSub'); if(!el) return;
  el.style.fontFamily = (cfg.subFont || 'Microsoft YaHei') + ', sans-serif';
  el.style.fontSize = Math.round(h * size / 540) + 'px';
  el.style.color = '#' + (cfg.subColor || 'FFFFFF').replace(/^#/, '');
  el.style.fontWeight = cfg.subBold ? 'bold' : 'normal';
  el.style.bottom = Math.round(h * margin / 540) + 'px';
  var ow = Math.max(0, Math.min(6, num(cfg.subOutline) || 1));
  var oc = '#' + (cfg.subOutlineColor || '000000').replace(/^#/, '');
  el.style.webkitTextStroke = ow + 'px ' + oc;
  el.style.textStroke = ow + 'px ' + oc;
  el.style.background = cfg.subBg ? 'rgba(0,0,0,.45)' : 'transparent';
  el.style.padding = cfg.subBg ? '2px 10px' : '0';
  el.style.borderRadius = cfg.subBg ? '6px' : '0';
}
/* v2.46：字幕样式实时预览——与 pvSubStyle 同一套缩放公式，但读的是设置输入框（实时，不必先保存），
   渲染到 #subPrevSub，保证「设置预览 = 成片预览 = 导出字幕」。 */
function renderSubPreview(){
  var box = $('subPrevBox'); if(!box) return;
  var el = $('subPrevSub'); if(!el) return;
  var h = box.clientHeight || 533;   /* 9:16 在 300px 宽时约 533px 高 */
  var gv = function(id, d){ var e = $(id); return e ? e.value : d; };
  var gvC = function(id, d){ var e = $(id); return e ? e.checked : d; };
  var size = Math.max(8, Math.min(48, num(gv('cf_subSize', cfg.subSize)) || 14));
  var margin = Math.max(0, num(gv('cf_subMargin', cfg.subMargin)) || 36);
  var font = (gv('cf_subFont', cfg.subFont) || 'Microsoft YaHei').toString().trim() || 'Microsoft YaHei';
  var color = ((gv('cf_subColor', cfg.subColor) || 'FFFFFF').toString().trim() || 'FFFFFF').replace(/^#/, '').toUpperCase();
  var bold = gvC('cf_subBold', cfg.subBold);
  var ow = Math.max(0, Math.min(6, num(gv('cf_subOutline', cfg.subOutline)) || 1));
  var oc = ((gv('cf_subOutlineColor', cfg.subOutlineColor) || '000000').toString().trim() || '000000').replace(/^#/, '').toUpperCase();
  var bg = gvC('cf_subBg', cfg.subBg);
  var txt = $('subPrevText') ? $('subPrevText').value : '';
  el.textContent = txt || '示例字幕：今天，我们要揭开真相。';
  el.style.fontFamily = font + ', sans-serif';
  el.style.fontSize = Math.round(h * size / 540) + 'px';
  el.style.color = '#' + color;
  el.style.fontWeight = bold ? 'bold' : 'normal';
  el.style.bottom = Math.round(h * margin / 540) + 'px';
  el.style.webkitTextStroke = ow + 'px #' + oc;
  el.style.textStroke = ow + 'px #' + oc;
  el.style.background = bg ? 'rgba(0,0,0,.45)' : 'transparent';
  el.style.padding = bg ? '2px 10px' : '0';
  el.style.borderRadius = bg ? '6px' : '0';
}
function pvSubAt(subs, e){
  for(var i = 0; i < subs.length; i++){ if(e >= subs[i].t0 && e < subs[i].t1) return subs[i].text; }
  return '';
}
var PV = null;   /* 播放器运行态 */
function openPreview(){
  var list = viewShots(exportScopeShots(), cfg.bundleStatus || 'all', '');
  if(!list.length){ toast('当前范围没有可预览的镜头'); return; }
  var seq = list.map(function(s){
    return {
      s:s,
      vid:String(s['口型视频URL'] || s['视频URL'] || ''),
      img:String(s['图片URL'] || ''),
      dur:shotDur(s),
      no:num(s['镜号']),
      ch:String(s['章节'] || '')
    };
  });
  var acc = 0;
  seq.forEach(function(x){ x.t0 = acc; acc += x.dur; x.t1 = acc; });
  var srt = buildSrtText(list);
  var subs = parseSrt(srt && srt.text);
  var stLabel = (cfg.bundleStatus && cfg.bundleStatus !== 'all')
    ? (typeof FILTER_NAMES !== 'undefined' ? (FILTER_NAMES[cfg.bundleStatus] || cfg.bundleStatus) : cfg.bundleStatus)
    : '';
  PV = { seq:seq, subs:subs, total:acc, playing:false, pausedAt:0, startWall:0, raf:null, src:null, shownId:null, buf:null,
         title:(scopeLabel() || '全部镜头') + (stLabel ? ' · ' + stLabel : '') };
  $('pvScope').textContent = '范围：' + PV.title + '（' + seq.length + ' 镜 · ' + pvFmt(acc) + '）';
  pvSubStyle();
  $('pvMask').classList.add('on');
  $('pvBox').classList.add('on');
  renderPvShot(seq[0], true);
  updatePvUI(0);
  /* 异步合成整轨（含 BGM）作声音；无声/失败也不影响画面与字幕 */
  try{
    buildTrackWav(list).then(function(r){ if(PV && r && r.mix) PV.buf = r.mix; }).catch(function(){});
  }catch(e){}
}
function pvCurAt(e){
  var seq = PV.seq;
  for(var i = 0; i < seq.length; i++){ if(e < seq[i].t1) return seq[i]; }
  return seq[seq.length - 1];
}
function renderPvShot(x, force){
  if(!x || !PV) return;
  if(!force && PV.shownId === x.s._id) return;
  PV.shownId = x.s._id;
  var box = $('pvBox'), vid = $('pvVid'), img = $('pvImg'), nom = $('pvNoMedia');
  box.classList.remove('showvid', 'kbimg', 'shownom');
  if(x.vid){
    vid.src = x.vid; try{ vid.currentTime = 0; }catch(_){}
    box.classList.add('showvid');
    try{ vid.play().catch(function(){}); }catch(_){}
  } else if(x.img){
    img.src = x.img; box.classList.add('kbimg');
  } else {
    nom.textContent = '第 ' + x.no + ' 镜' + (x.ch ? '（' + x.ch + '）' : '') + '\n（本镜还没有图或视频）';
    box.classList.add('shownom');
  }
  $('pvMeta').textContent = '第 ' + x.no + ' 镜' + (x.ch ? ' · ' + x.ch : '');
}
function updatePvUI(e){
  if(!PV) return;
  renderPvShot(pvCurAt(e));
  $('pvSub').textContent = pvSubAt(PV.subs, e);
  $('pvTime').textContent = pvFmt(e) + ' / ' + pvFmt(PV.total);
  $('pvSeek').value = PV.total ? Math.round(e / PV.total * 1000) : 0;
  $('pvPlay').innerHTML = PV.playing
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>暂停'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.4v13.2L18.6 12z"/></svg>播放';
}
function pvTick(){
  if(!PV || !PV.playing) return;
  var e = (performance.now() - PV.startWall) / 1000 + PV.pausedAt;
  if(e >= PV.total){ pvStop(true); return; }
  updatePvUI(e);
  PV.raf = requestAnimationFrame(pvTick);
}
function pvAudioStart(){
  if(!PV || !PV.buf) return;
  try{
    var ctx = audioCtx(); if(!ctx) return;
    if(ctx.state === 'suspended'){ ctx.resume().catch(function(){}); }
    var n = ctx.createBufferSource(); n.buffer = PV.buf; n.connect(ctx.destination);
    n.start(0, Math.min(PV.pausedAt, Math.max(0, PV.buf.duration - 0.02)));
    PV.src = n;
  }catch(e){ PV.src = null; }
}
function pvAudioStop(){
  if(PV && PV.src){ try{ PV.src.stop(); PV.src.disconnect(); }catch(_){} PV.src = null; }
}
function pvPlay(){
  if(!PV || PV.playing) return;
  PV.playing = true; PV.startWall = performance.now();
  pvAudioStart(); updatePvUI(PV.pausedAt);
  PV.raf = requestAnimationFrame(pvTick);
}
function pvPause(){
  if(!PV || !PV.playing) return;
  PV.pausedAt = (performance.now() - PV.startWall) / 1000 + PV.pausedAt;
  PV.playing = false; pvAudioStop();
  if(PV.raf) cancelAnimationFrame(PV.raf);
  updatePvUI(PV.pausedAt);
}
function pvToggle(){ if(PV) PV.playing ? pvPause() : pvPlay(); }
function pvStop(reset){
  if(!PV) return;
  PV.playing = false; pvAudioStop();
  if(PV.raf) cancelAnimationFrame(PV.raf);
  if(reset) PV.pausedAt = 0;
  updatePvUI(PV.pausedAt);
}
function pvSeekTo(t){
  if(!PV) return;
  t = Math.max(0, Math.min(PV.total, t));
  var was = PV.playing;
  pvAudioStop(); PV.pausedAt = t; PV.shownId = null;
  if(was){ PV.startWall = performance.now(); pvAudioStart(); }
  updatePvUI(t);
}
function pvGotoShot(dir){
  if(!PV) return;
  var e = PV.pausedAt + (PV.playing ? (performance.now() - PV.startWall) / 1000 : 0);
  var cur = pvCurAt(e), idx = PV.seq.indexOf(cur);
  var ni = Math.max(0, Math.min(PV.seq.length - 1, idx + dir));
  pvSeekTo(PV.seq[ni].t0 + 0.01);
}
function closePreview(){
  if(!PV) return;
  pvStop(false); PV = null;
  $('pvMask').classList.remove('on');
  $('pvBox').classList.remove('on');
  var vid = $('pvVid'); if(vid){ try{ vid.pause(); }catch(_){} try{ vid.removeAttribute('src'); vid.load(); }catch(_){} }
}
function wirePreview(){
  var b = $('btnExpPreview'); if(b) b.addEventListener('click', function(){ closeExportPanel(); openPreview(); });
  var play = $('pvPlay'); if(play) play.addEventListener('click', pvToggle);
  var prev = $('pvPrev'); if(prev) prev.addEventListener('click', function(){ pvGotoShot(-1); });
  var next = $('pvNext'); if(next) next.addEventListener('click', function(){ pvGotoShot(1); });
  var seek = $('pvSeek'); if(seek) seek.addEventListener('input', function(){ if(PV) pvSeekTo(num(this.value) / 1000 * PV.total); });
  var full = $('pvFull'); if(full) full.addEventListener('click', function(){ var st = $('pvStage'); if(st && st.requestFullscreen) st.requestFullscreen().catch(function(){}); });
  var close = $('pvClose'); if(close) close.addEventListener('click', closePreview);
  var mask = $('pvMask'); if(mask) mask.addEventListener('click', closePreview);
  document.addEventListener('keydown', function(e){
    if(!PV) return;
    if(e.code === 'Space'){ e.preventDefault(); pvToggle(); }
    else if(e.key === 'Escape'){ closePreview(); }
    else if(e.key === 'ArrowLeft'){ pvGotoShot(-1); }
    else if(e.key === 'ArrowRight'){ pvGotoShot(1); }
  });
}
function encodeWav(buffer){
  var sr = buffer.sampleRate, len = buffer.length, bytes = 44 + len*2;
  var ab = new ArrayBuffer(bytes), v = new DataView(ab);
  function str(o, s){ for(var i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); }
  str(0,'RIFF'); v.setUint32(4, bytes-8, true); str(8,'WAVE');
  str(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
  str(36,'data'); v.setUint32(40, len*2, true);
  var d = buffer.getChannelData(0), o = 44;
  for(var i=0;i<len;i++){
    var x = Math.max(-1, Math.min(1, d[i]));
    v.setInt16(o, x < 0 ? x*0x8000 : x*0x7FFF, true); o += 2;
  }
  return ab;
}
/* base64 → ArrayBuffer（导出压缩音频时用） */
function b64ToAb(b64){
  var bin = atob(b64), arr = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}
function downloadBlob(name, ab, mime){
  var b = new Blob([ab], { type: mime });
  var u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(u); }, 400);
}
/* 把 BGM 循环铺底混进人声轨：音量、淡入淡出都在设置里配 */
function mixBgm(out){
  var vol = Math.min(1, Math.max(0, num(cfg.bgmVol)));
  if(!cfg.bgmUrl || vol <= 0 || !out) return Promise.resolve(out);
  return fetchAudioBuf(cfg.bgmUrl).then(function(b){
    if(!b || !b.length){ toast('BGM 拉取失败，整轨只含人声'); return out; }
    var len = out.length, sr = out.sampleRate;
    var ch = out.getChannelData(0), g = b.getChannelData(0);
    var fade = Math.min(Math.floor(num(cfg.bgmFade) * sr), Math.floor(len / 2));
    for(var i = 0, j = 0; i < len; i++, j++){
      if(j >= g.length) j = 0;                       /* BGM 不够长就循环铺底 */
      var w = g[j] * vol;
      if(fade > 0){
        if(i < fade) w *= i / fade;
        else if(i > len - fade) w *= (len - i) / fade;
      }
      ch[i] = Math.max(-1, Math.min(1, ch[i] + w));
    }
    return out;
  }).catch(function(){ toast('BGM 拉取失败，整轨只含人声'); return out; });
}
/* v2.16：把「按镜序拼整轨 + 混 BGM」抽成纯异步函数，供「导出整轨」与「一键打包」共用。
   返回 { mix, ab, sec, withBgm }；没有任何本机配音时返回 null。 */
function buildTrackWav(scope){   /* v2.17：可选 scope 只合成指定范围的整轨（与打包范围同源） */
  var list = sortShots(scope || state.shots);
  var has = 0;
  list.forEach(function(s){ if(audLoad(s._id)) has++; });
  if(!has) return Promise.resolve(null);
  var ctx = audioCtx();
  if(!ctx) return Promise.resolve(null);
  return Promise.all(list.map(function(s){
    var raw = String(s['音频URL'] || '');
    if(raw && raw !== 'local') return fetchAudioBuf(raw);   /* URL 音频直接拉取解码 */
    var a = audLoad(s._id);
    return a ? decodeAudioBuf(a.b64) : Promise.resolve(null);
  })).then(function(bufs){
    var sr = 24000, total = 0, durs = [];
    bufs.forEach(function(b, i){
      /* 没取到音频的镜头：优先用已解析的音频时长字段垫静音，保证与字幕时间轴一致 */
      var d = b ? b.duration : (shotDur(list[i]));
      durs.push(d); total += d;
    });
    for(var q=0;q<bufs.length;q++){ if(bufs[q]){ sr = bufs[q].sampleRate; break; } }
    var len = Math.ceil(total * sr) + 1;
    var out = ctx.createBuffer(1, len, sr), ch = out.getChannelData(0), off = 0;
    bufs.forEach(function(b, i){
      if(!b){ off += Math.floor(durs[i] * sr); return; }
      var d = b.getChannelData(0);
      for(var k=0;k<d.length;k++){ if(off + k < len) ch[off + k] = d[k]; }
      off += d.length;
    });
    return mixBgm(out).then(function(mix){
      return { mix: mix, ab: encodeWav(mix), sec: Math.round(total),
               withBgm: !!(cfg.bgmUrl && num(cfg.bgmVol) > 0) };
    });
  });
}
/* 把各镜配音按镜头顺序拼成一条整轨，直接拖进剪映与画面对齐 */
function exportAudioTrack(){
  var has = 0;
  state.shots.forEach(function(s){ if(audLoad(s._id)) has++; });
  if(!has){ toast('还没有生成任何配音（音频只存在本机）'); return; }
  if(!audioCtx()){ toast('当前环境不支持 WebAudio，无法合成整轨'); return; }
  toast('正在合成整轨配音，请稍候…');
  buildTrackWav().then(function(r){
    if(!r){ toast('合成失败：没有取到可用音频'); return; }
    var tail = '，总长 ' + fmtSec(r.sec) + (r.withBgm ? '（含 BGM）' : '');
    /* v2.12：可选导出压缩版（webm/opus，体积约 wav 的 1/10）。压缩需实时录制，耗时≈音频总长，故默认关 */
    if(cfg.trackZip){
      toast('整轨已合成，正在压缩（耗时≈成片长度）…');
      /* v2.13：优先 audio/mp4（AAC，剪映 / PR / 达芬奇都直接认），不支持再退回 webm/opus */
      return encodeCompressed(r.mix, ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']).then(function(z){
        if(z && z.b64){
          var isAac = z.mime.indexOf('mp4') >= 0;
          downloadBlob(isAac ? '整轨配音.m4a' : '整轨配音.webm', b64ToAb(z.b64), z.mime);
          toast('整轨配音已导出（压缩版 ' + (isAac ? 'AAC' : 'opus') + '）' + tail);
        }else{
          downloadBlob('整轨配音.wav', r.ab, 'audio/wav');
          toast('浏览器不支持压缩，已改存 wav' + tail);
        }
      });
    }
    downloadBlob('整轨配音.wav', r.ab, 'audio/wav');
    /* v2.14：浏览器端没有 mp3 编码器，不假装能导 mp3——指一条 FFmpeg 命令给用户 */
    toast('整轨配音已导出' + tail + '；要 mp3 可点「复制 mp3 转码命令」');
  }).catch(function(e){ console.error(e); toast('合成失败：' + (e.message||e)); });
}

/* ================= v2.16：一键导出包（zip） =================
   为什么自己写 zip：浏览器端没有打包能力，引 JSZip 又是几百 KB 外部依赖（违背单文件零依赖铁律）。
   好在 ZIP 的 store 模式（不压缩）不需要任何压缩算法，只有「CRC32 + 三段头部」，
   文本与 wav 原样入包，WinRAR / 系统解压 / 剪映都能正常打开。 */
var _crcTab = null;
function crc32(u8){
  if(!_crcTab){
    _crcTab = new Int32Array(256);
    for(var n = 0; n < 256; n++){
      var c = n;
      for(var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTab[n] = c;
    }
  }
  var crc = -1;
  for(var i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ _crcTab[(crc ^ u8[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}
function utf8Bytes(s){
  s = String(s == null ? '' : s);
  if(typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  var out = [];                                   /* 老浏览器兜底：手写 UTF-8 编码 */
  for(var i = 0; i < s.length; i++){
    var c = s.charCodeAt(i);
    if(c < 128) out.push(c);
    else if(c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
    else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  return new Uint8Array(out);
}
/* files: [{name:'分镜字幕.srt', data:'文本' 或 Uint8Array}] → Uint8Array（完整 zip） */
function zipStore(files){
  var d = new Date();
  var dosTime = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  var dosDate = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  var items = files.map(function(f){
    var nameB = utf8Bytes(f.name);
    var data = (f.data instanceof Uint8Array) ? f.data : utf8Bytes(f.data);
    return { nameB: nameB, data: data, crc: crc32(data), off: 0 };
  });
  /* v2.22 修复：这里过去把「本地段 + 中央目录项」一起累加给下一项当起点，导致第 2 个文件起的
     header_offset 全部偏大（第一个文件正常，后面的在解压软件里报 bad magic number）。
     正确做法是把两段分开累加：先算本地段得到每项的 off，再单独算中央目录与 EOCD 的总长。 */
  var total = 0;
  items.forEach(function(it){
    it.off = total;
    total += 30 + it.nameB.length + it.data.length;          /* 本地头 + 文件名 + 数据 */
  });
  items.forEach(function(it){ total += 46 + it.nameB.length; });   /* 中央目录项 */
  total += 22;                                                              /* EOCD */
  var buf = new Uint8Array(total), v = new DataView(buf.buffer), p = 0;
  function u16(x){ v.setUint16(p, x, true); p += 2; }
  function u32(x){ v.setUint32(p, x >>> 0, true); p += 4; }
  function raw(b){ buf.set(b, p); p += b.length; }
  items.forEach(function(it){
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(it.crc); u32(it.data.length); u32(it.data.length);
    u16(it.nameB.length); u16(0);
    raw(it.nameB); raw(it.data);
  });
  var cdStart = p;
  items.forEach(function(it){
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(it.crc); u32(it.data.length); u32(it.data.length);
    u16(it.nameB.length); u16(0); u16(0); u16(0); u16(0); u32(0);
    u32(it.off);
    raw(it.nameB);
  });
  var cdSize = p - cdStart;
  u32(0x06054b50); u16(0); u16(0); u16(items.length); u16(items.length); u32(cdSize); u32(cdStart); u16(0);
  return buf;
}
function downloadZip(name, files){
  var buf = zipStore(files);
  var blob = new Blob([buf], { type: 'application/zip' });
  var u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(u); }, 400);
  toast('已导出 ' + files.length + ' 个文件，共 ' + Math.max(1, Math.round(buf.length / 1024)) + ' KB');
}
/* ================= v2.22：极简 xlsx（Excel 工作簿）导出 =================
   为什么能手写：xlsx 本质就是一个 zip，里面固定放几段 XML。我们已经有了 zipStore，
   所以只要拼 [Content_Types].xml / _rels/.rels / workbook.xml / workbook.xml.rels /
   worksheets/sheetN.xml 这五类部件即可，**不必引任何表格库**（单文件零依赖铁律）。
   单元格统一用 inlineStr（省掉 sharedStrings 部件），数字单独走 <v>，Excel 才认得出是数值。 */
function xlsxCol(i){                     /* 0 → A、25 → Z、26 → AA */
  var s = '';
  i = num(i);
  do{ s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }while(i >= 0);
  return s;
}
/* XML 非法控制字符（0x00–0x08 / 0x0B / 0x0C / 0x0E–0x1F）会让 Excel 直接报「文件损坏」，必须先剔掉 */
function xlsxTxt(v){
  return esc(String(v == null ? '' : v)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
/* v2.23：最基础的「能看」样式——标题/表头加粗、首行冻结、列宽自适应。
   全部靠手写 styles.xml 实现，仍然零依赖。样式索引：0=普通正文，1=加粗。 */
function xlsxStylesXml(){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
      '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="2">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
}
/* 估一个单元格在 Excel 里占几个字符宽：汉字/全角算 2，其余算 1 */
function xlsxDispW(v){
  var s = String(v == null ? '' : v), w = 0;
  for(var i = 0; i < s.length; i++){ w += (s.charCodeAt(i) > 0x2E80) ? 2 : 1; }
  return w;
}
/* 列宽自适应：取该列最宽的格子，留 2 字余量，夹在 6~48 之间（免得某一列超长把表撑爆） */
function xlsxAutoWidths(rows){
  var w = [];
  (rows || []).forEach(function(r){
    (r || []).forEach(function(v, ci){ var d = xlsxDispW(v); if(d > (w[ci] || 0)) w[ci] = d; });
  });
  return w.map(function(d){ return Math.min(48, Math.max(6, d + 2)); });
}
/* 表格行上挂的「加粗行号」（1-based，Excel 口径）——由各 build*Rows 边拼边记 */
function sheetBoldRows(rows){ return (rows && rows._bold) || [1]; }
function xlsxSheetXml(rows, opt){
  opt = opt || {};
  var bold = {};
  (opt.boldRows || sheetBoldRows(rows)).forEach(function(n){ bold[num(n)] = 1; });
  var body = (rows || []).map(function(r, ri){
    var st = bold[ri + 1] ? ' s="1"' : '';
    var cells = (r || []).map(function(v, ci){
      var ref = xlsxCol(ci) + (ri + 1);
      if(typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
      var t = xlsxTxt(v);
      if(!t) return '';
      return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + t + '</t></is></c>';
    }).join('');
    return '<row r="' + (ri + 1) + '">' + cells + '</row>';
  }).join('');
  /* 冻结窗格：注意 sheetViews 必须排在 cols / sheetData 之前才是合法顺序 */
  var frz = num(opt.freeze), views = '';
  if(frz > 0){
    views = '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="' + frz + '" topLeftCell="A' + (frz + 1) + '" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A' + (frz + 1) + '" sqref="A' + (frz + 1) + '"/>' +
      '</sheetView></sheetViews>';
  }
  var widths = opt.widths || (opt.autoWidth !== false ? xlsxAutoWidths(rows) : null), cols = '';
  if(widths && widths.length){
    cols = '<cols>' + widths.map(function(w, i){
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('') + '</cols>';
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + views + cols +
    '<sheetData>' + body + '</sheetData></worksheet>';
}
/* 工作表名不能含 Excel 的非法字符（方括号 星号 斜杠 问号 冒号），且不超过 31 字符，否则打不开 */
function sheetNameSafe(n, i){
  var s = String(n || ('Sheet' + (i + 1))).replace(/[\[\]\*\/\\\?:]/g, ' ').trim().slice(0, 31);
  return s || ('Sheet' + (i + 1));
}
function xlsxBuild(sheets){
  sheets = (sheets || []).filter(Boolean);
  if(!sheets.length) sheets = [{ name: 'Sheet1', rows: [] }];
  var overrides = sheets.map(function(sh, i){
    return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }).join('');
  var sheetTags = sheets.map(function(sh, i){
    return '<sheet name="' + esc(sheetNameSafe(sh.name, i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
  }).join('');
  var rels = sheets.map(function(sh, i){
    return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
  }).join('');
  var files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides +
      /* v2.23：样式部件（加粗表头 / 冻结 / 列宽都靠它） */
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetTags + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>' },
    { name: 'xl/styles.xml', data: xlsxStylesXml() }
  ];
  sheets.forEach(function(sh, i){ files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: xlsxSheetXml(sh.rows, sh.style) }); });
  return zipStore(files);
}
function downloadXlsx(name, sheets){
  var buf = xlsxBuild(sheets);
  var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  var u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(u); }, 400);
  toast('已导出 ' + name + '（' + Math.max(1, Math.round(buf.length / 1024)) + ' KB）');
}
/* v2.17：统一按镜号排序——字幕 / 清单 / 整轨的顺序口径只此一处，避免各处各排各的 */
function sortShots(list){ return (list || []).slice().sort(function(a,b){ return num(a['镜号']) - num(b['镜号']); }); }
function selectedChapterTitles(){
  var out = {};
  (state.chapters || []).forEach(function(c){ if(c.sel) out[String(c.title || '')] = 1; });
  return out;
}
/* v2.19：自定镜号区间升级为「多段 + 排除」。语法（分隔符逗号 / 空格 / 分号都行）：
     1-20,25,30-35        包含 1–20、25、30–35
     1-50,!8-10           上面的基础上排除 8–10（! 或 ^ 前缀表示排除）
     !3                   只写排除段 = 全部减去 3
     8-  /  -20           开区间：8 到末尾 / 开头到 20
     20                   单个镜号
   v2.20：再加「#章节名」——直接引用某个章节下的全部镜号（包含匹配，如 #第一集），
     1-100,!#第一集       也可整章排除。
   v2.22：再加「@预设名」——引用一个已存的镜号预设（如 @夜戏 或 1-20,@片头,!@片尾），
     最多展开 2 层，找不到同名预设就忽略该段。
   写错的段直接忽略、不报错、不炸；空字符串表示「不限」，避免导出空包。 */
/* v2.20：#章节名 → 该章节下所有镜号。先试「完全等于章节名」，命中即只取这些章节；
   没有任何章节名完全相等时，退化为「包含」匹配（用户常只记得片段，如「第一集」）。 */
function chapterShotNos(name){
  var key = String(name == null ? '' : name).trim(), out = [];
  if(!key) return out;
  var chs = state.chapters || [], exact = {}, hasExact = false, i;
  for(i = 0; i < chs.length; i++){
    if(String(chs[i].title || '') === key){ exact[String(chs[i].title)] = 1; hasExact = true; }
  }
  (state.shots || []).forEach(function(s){
    var t = String(s['章节'] || '');
    var hit = hasExact ? !!exact[t] : (t.indexOf(key) > -1);
    if(hit){ var n = num(s['镜号']); if(n) out.push(n); }
  });
  return out;
}
function parseShotRange(str, depth){
  var inc = [], exc = [];
  depth = num(depth) || 0;   /* v2.22：@预设 引用的展开层数，最多 2 层，防自引用 / 互相引用转圈 */
  String(str == null ? '' : str).split(/[,，;；\s]+/).forEach(function(seg){
    seg = String(seg).trim(); if(!seg) return;
    var neg = false;
    if(seg[0] === '!' || seg[0] === '^'){ neg = true; seg = seg.slice(1); }
    /* v2.22：@预设名 —— 直接引用另一个已存的镜号预设，省得把长表达式抄第二遍。
       找不到同名预设就忽略该段（与写错的段一致，不报错不炸）。 */
    if(seg[0] === '@'){
      if(depth < 2){
        var want = seg.slice(1).trim(), ref = null, rp = rangePresets(), ri;
        for(ri = 0; ri < rp.length; ri++){ if(String(rp[ri].n || '') === want){ ref = rp[ri]; break; } }
        if(ref){
          var sub = parseShotRange(ref.v, depth + 1);
          /* 正常引用：原样并入；加 ! 取反：包含段转排除、排除段转包含 */
          sub.inc.forEach(function(x){ (neg ? exc : inc).push(x); });
          sub.exc.forEach(function(x){ (neg ? inc : exc).push(x); });
        }
      }
      return;
    }
    /* v2.20：#章节名 —— 展开成该章节下每个镜号的单点区间（保持 rangeHit 只做数值判断） */
    if(seg[0] === '#'){
      chapterShotNos(seg.slice(1)).forEach(function(n){ (neg ? exc : inc).push([n, n]); });
      return;
    }
    var a, b,
        m  = seg.match(/^(\d+)\s*[-~－—至到]\s*(\d+)$/),
        m2 = seg.match(/^(\d+)\s*[-~－—至到]$/),
        m3 = seg.match(/^[-~－—至到]\s*(\d+)$/);
    if(m){ a = num(m[1]); b = num(m[2]); }
    else if(m2){ a = num(m2[1]); b = 999999; }
    else if(m3){ a = 1; b = num(m3[1]); }
    else if(/^\d+$/.test(seg)){ a = b = num(seg); }
    else return;
    if(!a || !b) return;
    if(a > b){ var t = a; a = b; b = t; }
    (neg ? exc : inc).push([a, b]);
  });
  return { inc: inc, exc: exc, empty: !inc.length && !exc.length };
}
function rangeHit(no, p){
  if(!p) return true;
  var i;
  for(i = 0; i < p.exc.length; i++){ if(no >= p.exc[i][0] && no <= p.exc[i][1]) return false; }
  if(!p.inc.length) return true;   /* 只写了排除段 → 等价「全部扣掉这些」 */
  for(i = 0; i < p.inc.length; i++){ if(no >= p.inc[i][0] && no <= p.inc[i][1]) return true; }
  return false;
}
function shotRangeTxt(p){
  function seg(x){
    if(x[0] === x[1]) return String(x[0]);
    if(x[1] >= 999999) return x[0] + '–末';
    if(x[0] <= 1) return '首–' + x[1];
    return x[0] + '–' + x[1];
  }
  if(!p || p.empty) return '未填（等于全部）';
  var inc = p.inc.map(seg).join(','), exc = p.exc.map(seg).join(',');
  return (inc || '全部') + (exc ? '，排除 ' + exc : '');
}
/* v2.17：一键打包的「范围」——把导出对象收窄到用户真正要用的那一部分。
   filter 分支复用「生成图/视频」页的 filteredShots()，保证两处筛选口径一致； */
function exportScopeShots(){
  var sc = ($('expScope') && $('expScope').value) || 'all';
  var list = sortShots(state.shots);
  if(sc === 'done'){
    return list.filter(function(s){ return !!(s['口型视频URL'] || s['视频URL'] || s['视频状态'] === '已完成'); });
  }
  if(sc === 'filter'){
    var keep = {};
    filteredShots().forEach(function(s){ keep[s._id] = 1; });
    return list.filter(function(s){ return keep[s._id]; });
  }
  if(sc === 'chapter'){
    var sel = selectedChapterTitles(), has = false, k;
    for(k in sel){ has = true; break; }
    if(!has) return list;   /* 一个章节都没勾 → 视为不限，避免导出空包 */
    return list.filter(function(s){ return sel[String(s['章节'] || '')]; });
  }
  /* v2.19：自定镜号区间——支持多段与排除（如 1-20,25,30-35 或 1-50,!8-10）；不填等于不限 */
  if(sc === 'range'){
    var pr = parseShotRange($('expRange') && $('expRange').value);
    if(pr.empty) return list;
    return list.filter(function(s){ return rangeHit(num(s['镜号']), pr); });
  }
  return list;
}
function scopeLabel(){
  var sc = ($('expScope') && $('expScope').value) || 'all';
  if(sc === 'range'){
    var raw = String(($('expRange') && $('expRange').value) || '').trim();
    /* v2.20：含 #章节引用 时直接回显原文——展开成几十个镜号反而看不懂 */
    return '自定镜号 ' + (raw.indexOf('#') > -1 ? raw : shotRangeTxt(parseShotRange(raw)));
  }
  return { all:'全部镜头', done:'仅已完成镜头', filter:'跟随当前筛选', chapter:'仅勾选章节' }[sc] || '全部镜头';
}
/* v2.20：镜号表达式的常用预设——「只导前 20 镜」「排除片头」这类固定选区不必每次手打。
   预设存在 cfg.rangePresets（本机持久化），点击套用、× 删除。 */
function rangePresets(){
  if(!Array.isArray(cfg.rangePresets)) cfg.rangePresets = [];
  return cfg.rangePresets;
}
/* v2.21：把一串镜号压成表达式——[1,2,3,5,8,9] → "1-3,5,8-9"。
   用途：续跑卡上的剩余镜号可以直接变成一个选区表达式（存成预设 / 贴进导出范围）。 */
function nosExpr(ids){
  var arr = [], seen = {};
  (ids || []).forEach(function(n){ n = num(n); if(n > 0 && !seen[n]){ seen[n] = 1; arr.push(n); } });
  arr.sort(function(a, b){ return a - b; });
  var out = [], i = 0;
  while(i < arr.length){
    var j = i;
    while(j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++;
    out.push(i === j ? String(arr[i]) : (arr[i] + '-' + arr[j]));
    i = j + 1;
  }
  return out.join(',');
}
/* 预设当前命中多少镜（拿现有分镜算）——套用前就知道这个选区对不对，不用打完包才发现 */
function presetHits(v){
  var pr = parseShotRange(v);
  if(pr.empty) return state.shots.length;
  var n = 0;
  state.shots.forEach(function(s){ if(rangeHit(num(s['镜号']), pr)) n++; });
  return n;
}
function renderRangePresets(){
  var box = $('rangePresets'), hint = $('rangePresetsHint');
  if(!box) return;
  var arr = rangePresets();
  if(hint) hint.textContent = arr.length ? ('共 ' + arr.length + ' 个预设，点名称套用；点「筛」去生成页只看这几个镜；点 × 删除（括号里是当前命中的镜数；表达式可用 @名字 引用别的预设）') : '还没有预设，填好表达式后点左边按钮存一个';
  box.innerHTML = arr.map(function(p, i){
    var hits = presetHits(p.v);
    return '<span style="display:inline-flex;align-items:center;gap:2px;margin:0 8px 6px 0">' +
      '<button class="btn gh sm" data-act="rnguse" data-i="' + i + '" title="' + esc(p.v || '') + '（命中 ' + hits + ' 镜）">' +
        esc(p.n || ('预设 ' + (i + 1))) + ' <span style="color:var(--tx3)">(' + hits + ')</span></button>' +
      '<button class="btn gh sm" data-act="rngfilter" data-i="' + i + '" title="切到「③ 生成图 / 视频」页，按这个选区只看这几个镜">筛</button>' +
      (i > 0 ? '<button class="btn gh sm" data-act="rngup" data-i="' + i + '" title="上移一位（列表顺序 = 常用度，自己排）">'+svgIc('up',13)+'</button>' : '') +
      '<button class="btn gh sm" data-act="rngdel" data-i="' + i + '" title="删除该预设">×</button>' +
    '</span>';
  }).join('');
}
/* v2.22：预设排序——常用的往上挪，删起来不至于误删、找起来不用翻。 */
function moveRangePreset(i){
  var arr = rangePresets(), k = num(i);
  if(k <= 0 || k >= arr.length) return;
  var t = arr[k - 1]; arr[k - 1] = arr[k]; arr[k] = t;
  saveCfg(); renderRangePresets();
  toast('已上移「' + (arr[k - 1].n || '') + '」');
}
/* v2.23：镜号预设也能导出 / 导入——和类型套餐共用同一套 JSON 机制。
   一部戏的选区（片头、每集的高潮段落、要去返工的那几条）是攒出来的资产，换设备不该丢。 */
function exportRangePresets(){
  var arr = rangePresets();
  if(!arr.length){ toast('还没有镜号预设可导出——先填个表达式再点「存为预设」'); return; }
  var obj = { app:'novel-to-drama-studio', kind:'rangePresets', version:1, exportedAt: nowStr(), presets: arr };
  download('镜号预设_' + nowStr().replace(/[: ]/g, '-') + '.json', JSON.stringify(obj, null, 2), 'application/json;charset=utf-8');
  toast('已导出 ' + arr.length + ' 个镜号预设（JSON）');
}
/* 纯函数：校验并合并导入的预设（接受「裸数组」或「导出文件对象」两种形态）。
   同名覆盖、新名追加；名字或表达式为空的一律跳过并计数。 */
function mergeRangePresets(raw){
  var list = null;
  if(Array.isArray(raw)) list = raw;
  else if(raw && Array.isArray(raw.presets)) list = raw.presets;
  if(!list) return { ok:false, msg:'不是有效的预设文件（缺少 presets 数组）', added:0, updated:0, bad:0 };
  var arr = rangePresets(), added = 0, updated = 0, bad = 0;
  list.forEach(function(p){
    if(!p || typeof p !== 'object'){ bad++; return; }
    var n = String(p.n == null ? '' : p.n).trim();
    var v = String(p.v == null ? '' : p.v).trim();
    if(!n || !v){ bad++; return; }
    var item = { n: n, v: v }, hit = -1, i;
    for(i = 0; i < arr.length; i++){ if(arr[i].n === n){ hit = i; break; } }
    if(hit > -1){ arr[hit] = item; updated++; } else { arr.push(item); added++; }
  });
  if(added || updated) saveCfg();
  return { ok:true, added:added, updated:updated, bad:bad, msg:'' };
}
function importRangePresetsText(txt){
  var raw = null;
  try{ raw = JSON.parse(String(txt == null ? '' : txt)); }catch(e){ toast('导入失败：不是合法的 JSON 文本'); return; }
  var r = mergeRangePresets(raw);
  if(!r.ok){ toast('导入失败：' + r.msg); return; }
  renderRangePresets();
  toast(r.added || r.updated
    ? ('导入完成：新增 ' + r.added + ' 个、更新 ' + r.updated + ' 个镜号预设' + (r.bad ? ('，忽略无效 ' + r.bad + ' 条') : ''))
    : '文件里没有可导入的预设（可能都是空数据）');
}
function importRangePresets(){ if($('fileRangeJson')) $('fileRangeJson').click(); }
/* v2.24：把镜号预设 / 类型套餐 / 筛选视图合并成一个 JSON 包，存进资料库 / 网盘即相当于云端同步
   （换设备、多人协作时一次导入全部配方）。同名覆盖、新名追加、空条目跳过。 */
function exportPresetsPkg(){
  var pkg = {
    exportedAt: nowStr(), app: 'novel-to-short-drama', version: 2,
    rangePresets: rangePresets(), genrePresets: genrePresets(), filterViews: filterViews()
  };
  download('预设与套餐_' + nowStr().replace(/[: ]/g, '-') + '.json', JSON.stringify(pkg, null, 2), 'application/json');
  toast('已导出 ' + pkg.rangePresets.length + ' 个镜号预设 / ' + pkg.genrePresets.length + ' 个类型套餐 / ' + pkg.filterViews.length + ' 套筛选视图');
}
function importPresetsPkgText(text){
  var pkg;
  try{ pkg = JSON.parse(text); }catch(e){ toast('文件不是合法 JSON'); return; }
  if(!pkg || typeof pkg !== 'object'){ toast('文件格式不对'); return; }
  var added = 0, updated = 0, bad = 0;
  function merge(arr, cur){
    if(!Array.isArray(arr)) return;
    arr.forEach(function(it){
      if(!it || typeof it !== 'object' || !it.n){ bad++; return; }
      for(var i = 0; i < cur.length; i++){ if(cur[i].n === it.n){ Object.assign(cur[i], it); updated++; return; } }
      cur.push(it); added++;
    });
  }
  merge(pkg.rangePresets, rangePresets());
  merge(pkg.genrePresets, genrePresets());
  merge(pkg.filterViews, filterViews());
  saveCfg(); renderRangePresets(); renderGenrePresets(); renderFilterViews();
  toast('导入完成：新增 ' + added + ' 个、更新 ' + updated + ' 个' + (bad ? ('，忽略无效 ' + bad + ' 条') : '') + '（镜号预设 / 类型套餐 / 筛选视图）');
}
function importPresetsPkg(file){
  var fr = new FileReader();
  fr.onload = function(){ importPresetsPkgText(fr.result); };
  fr.onerror = function(){ toast('读取文件失败'); };
  fr.readAsText(file, 'utf-8');
}
/* v2.22：按预设筛选生成页——预设不只在导出时有用，也常想「只看这批镜」逐镜过一遍。 */
function setFilterExpr(expr, name){
  var raw = String(expr == null ? '' : expr).trim();
  saveViewScroll();   /* v2.23：切视图前先记住当前位置 */
  cfg.filterExpr = raw;
  state.filter = raw ? 'expr' : 'all';
  var sel = $('filterSel');
  if(sel) sel.value = state.filter;
  saveCfg(); renderGenList(); renderFilterViews();
  var n = presetHits(raw);
  toast(raw ? ('已按选区「' + (name || raw) + '」筛出 ' + n + ' 镜（清空选区可恢复全部）') : '已恢复显示全部镜头');
}
function filterByRangePreset(i){
  var p = rangePresets()[num(i)];
  if(!p) return;
  if(!String(p.v || '').trim()){ toast('这个预设是空的，先给它填个表达式'); return; }
  state.expanded = state.expanded || {};
  setView('gen');   /* 内部 renderGenList 会带上刚设好的 expr 筛选 */
  var first = null;
  state.shots.forEach(function(x){ if(!first && rangeHit(num(x['镜号']), parseShotRange(p.v))){ first = x; } });
  if(first) state.expanded[first._id] = true;
  setTimeout(function(){
    var el = first ? document.querySelector('.gen[data-id="' + first._id + '"]') : null;
    if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
  }, 80);
}
var FILTER_NAMES = { all:'全部镜头', noimg:'待生成图片', novid:'待生成视频', cand:'候选待选', fail:'失败的', done:'已完成', expr:'按镜号选区' };
function filterViews(){
  if(!Array.isArray(cfg.filterViews)) cfg.filterViews = [];
  return cfg.filterViews;
}
/* 视图指纹 = 下拉取值 + （选区时才有的）表达式。用来判断「现在正处在哪套视图」，
   也当滚动位置的键——同一套视图切回来就回到上次看的那一屏。 */
function filterKey(mode, expr){
  var m = String(mode || 'all');
  return m + '|' + (m === 'expr' ? String(expr == null ? '' : expr).trim() : '');
}
function curFilterKey(){ return filterKey(state.filter, cfg.filterExpr); }
function filterViewLabel(v){ return (v && v.n) || FILTER_NAMES[(v && v.mode) || 'all'] || '视图'; }
function filterViewTip(v){ return FILTER_NAMES[(v && v.mode) || 'all'] || '视图'; }
function filterViewHits(v){ return viewShots(state.shots, v && v.mode, v && v.expr).length; }
/* 切视图前先把当前位置记下来；切回来时再滚回去。滚动记的是窗口位置，容器换了也不受影响。 */
function saveViewScroll(){
  state.viewScroll = state.viewScroll || {};
  var y = 0;
  try{ y = window.scrollY || window.pageYOffset || 0; }catch(e){}
  state.viewScroll[curFilterKey()] = y;
  return y;
}
function restoreViewScroll(key){
  state.viewScroll = state.viewScroll || {};
  var y = num(state.viewScroll[key]);
  if(y > 0) setTimeout(function(){ try{ window.scrollTo(0, y); }catch(e){} }, 60);
  return y;
}
function renderFilterViews(){
  var box = $('filterViews'); if(!box) return;
  var arr = filterViews();
  if(!arr.length){
    box.innerHTML = '<span class="hint" style="margin:0">还没有筛选视图——调好右边的筛选（或按镜号选区）后点「存为视图」，以后一键切回；拖拽可排序，点铅笔图标可重命名</span>';
    return;
  }
  var cur = curFilterKey();
  box.innerHTML = arr.map(function(v, i){
    var k = filterKey(v.mode, v.expr), on = (k === cur);
    var tip = filterViewTip(v) + (String(v.mode) === 'expr' && v.expr ? ('：' + v.expr) : '') + '（命中 ' + filterViewHits(v) + ' 镜）';
    return '<span style="display:inline-flex;align-items:center;gap:2px;margin:0 8px 6px 0" draggable="true" data-i="' + i + '" data-fvdrag="1" title="按住拖拽可调整顺序">' +
      '<span style="cursor:grab;color:var(--tx3);user-select:none" title="拖拽排序">⋮⋮</span>' +
      '<button class="btn ' + (on ? '' : 'gh ') + 'sm" data-act="fvuse" data-i="' + i + '" title="' + esc(tip) + '">' +
        esc(filterViewLabel(v)) + ' <span style="color:var(--tx3)">(' + filterViewHits(v) + ')</span></button>' +
      '<button class="btn gh sm" data-act="fvren" data-i="' + i + '" title="重命名该视图">'+svgIc('pen',13)+'</button>' +
      '<button class="btn gh sm" data-act="fvdel" data-i="' + i + '" title="删除该视图">×</button></span>';
  }).join('');
}
function saveFilterView(){
  var expr = String(cfg.filterExpr || '').trim();
  if(state.filter === 'expr' && !expr){ toast('选区还是空的——先去导出中心的镜号预设上点「筛」，再回来存视图'); return; }
  var nm = FILTER_NAMES[state.filter] || '视图';
  var suffix = (state.filter === 'expr' && expr) ? ('：' + (expr.length > 24 ? expr.slice(0, 24) + '…' : expr)) : '';
  askInput('把当前筛选（' + nm + suffix + '）存成一套视图，起个名字：', nm)
    .then(function(name){
      name = String(name == null ? '' : name).trim();
      if(!name) return;
      var arr = filterViews(), i;
      for(i = 0; i < arr.length; i++){
        if(arr[i].n === name){ arr[i].mode = state.filter; arr[i].expr = expr; saveCfg(); renderFilterViews(); toast('已更新筛选视图「' + name + '」'); return; }
      }
      arr.push({ n: name, mode: state.filter, expr: expr });
      saveCfg(); renderFilterViews();
      toast('已存为筛选视图「' + name + '」，点它即可一键切回');
    });
}
function applyFilterView(i){
  var v = filterViews()[num(i)];
  if(!v) return;
  saveViewScroll();   /* 先把当前视图的滚动位置记下来，切回来时用 */
  state.filter = v.mode || 'all';
  if(state.filter === 'expr') cfg.filterExpr = String(v.expr || '');
  var sel = $('filterSel'); if(sel) sel.value = state.filter;
  saveCfg(); renderGenList(); renderFilterViews();
  var y = restoreViewScroll(filterKey(v.mode, v.expr));
  toast('已切到视图「' + filterViewLabel(v) + '」（命中 ' + filterViewHits(v) + ' 镜）' + (y > 0 ? '，回到上次看的位置' : ''));
}
function delFilterView(i){
  var arr = filterViews(), k = num(i);
  if(!arr[k]) return;
  var nm = filterViewLabel(arr[k]);
  arr.splice(k, 1);
  saveCfg(); renderFilterViews();
  toast('已删除筛选视图「' + nm + '」');
}
/* v2.24：重命名一套视图——名字只影响显示，不影响它存的筛选条件 */
function renameFilterView(i){
  var arr = filterViews(), v = arr[num(i)];
  if(!v) return;
  askInput('给这套视图改个名字：', v.n || '').then(function(name){
    name = String(name == null ? '' : name).trim();
    if(!name) return;
    v.n = name; saveCfg(); renderFilterViews();
    toast('已重命名为「' + name + '」');
  });
}
/* v2.24：拖拽调整视图顺序——顺序即 cfg.filterViews 数组顺序，直接落盘 */
function moveFilterView(a, b){
  var arr = filterViews();
  a = num(a); b = num(b);
  if(a < 0 || b < 0 || a >= arr.length || b >= arr.length || a === b) return;
  var it = arr.splice(a, 1)[0];
  if(b > a) b--;                 /* 抽掉一个后，目标下标前移一位 */
  arr.splice(b, 0, it);
  saveCfg(); renderFilterViews();
}
/* v2.21：把某一类型的剩余镜号直接存成镜号预设——暂停后不必手抄那些镜号，
   以后想在导出里「只导这批镜」直接套用即可。 */
function saveLeftAsPreset(kind){
  var rec = (batchLoadAll() || {})[kind];
  if(!rec || !rec.ids || !rec.ids.length){ toast('这一类型当前没有剩余记录'); return; }
  var expr = nosExpr(rec.ids);
  askInput('把剩余 ' + rec.ids.length + ' 个镜号存成镜号预设（表达式：' + expr + '），起个名字：', '剩余' + batchLeftName(kind))
    .then(function(name){
      if(!name) return;
      var arr = rangePresets(), i;
      for(i = 0; i < arr.length; i++){
        if(arr[i].n === name){ arr[i].v = expr; saveCfg(); renderRangePresets(); toast('已更新预设「' + name + '」'); return; }
      }
      arr.push({ n: name, v: expr });
      saveCfg(); renderRangePresets();
      toast('已存为镜号预设「' + name + '」（' + rec.ids.length + ' 镜）');
    });
}
function saveRangePreset(){
  var el = $('expRange'), v = String((el && el.value) || '').trim();
  if(!v){ toast('先在输入框里写好一个表达式，再存为预设'); return; }
  askInput('给这个镜号表达式起个名字（以后在导出中心一键套用）：', '选区 ' + (rangePresets().length + 1))
    .then(function(name){
      if(!name) return;
      var arr = rangePresets(), i;
      for(i = 0; i < arr.length; i++){
        if(arr[i].n === name){ arr[i].v = v; saveCfg(); renderRangePresets(); toast('已更新预设「' + name + '」'); return; }
      }
      arr.push({ n: name, v: v });
      saveCfg(); renderRangePresets();
      toast('已存为预设「' + name + '」');
    });
}
function applyRangePreset(i){
  var p = rangePresets()[num(i)];
  if(!p) return;
  var el = $('expRange');
  if(el) el.value = p.v || '';
  cfg.expRange = p.v || '';
  saveCfg(); updExpPreview();
  toast('已套用预设「' + (p.n || '') + '」，命中 ' + presetHits(p.v) + ' 镜');
}
function delRangePreset(i){
  var arr = rangePresets(), k = num(i);
  if(!arr[k]) return;
  var nm = arr[k].n || '';
  arr.splice(k, 1);
  saveCfg(); renderRangePresets();
  toast('已删除预设「' + nm + '」');
}
/* v2.19：打包体积估算。文本类按真实内容算（字幕 / 脚本 / 清单 / 数据 / 转码命令），
   整轨配音按「wav 单声道 16bit @24k」估——与 buildTrackWav 的实际规格一致。
   镜数很大（>1500）时按经验均值估，避免每敲一个字符都全量拼字符串把页面卡住。
   v2.20：再细化——分文件列出来，并把 zip 容器自身的开销也算进去（store 模式每个文件
   有本地头 + 中央目录两条记录，各带一次文件名；末尾还有 22 字节 EOCD）。
   这样预览里的数字才和真正下载下来的压缩包对得上，而不是「永远比实际小一点」。 */
function fmtBytes(n){
  n = Math.max(0, Math.round(num(n) || 0));
  if(n < 1024) return n + ' B';
  if(n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
/* zip 容器开销：每文件 本地头(30 + 名字) + 中央目录(46 + 名字)，再加末尾 EOCD 22 字节 */
function zipOverhead(names){
  var b = 22;
  (names || []).forEach(function(n){ var L = utf8Bytes(String(n)).length; b += (30 + L) + (46 + L); });
  return b;
}
function estExportSize(scope){
  scope = scope || [];
  var secs = 0, hasAud = false;
  scope.forEach(function(s){ secs += shotDur(s); if(audLoad(s._id)) hasAud = true; });
  var approx = scope.length > 1500, parts = [], text = 0;
  function add(name, bytes){ parts.push({ name: name, bytes: bytes }); text += bytes; }
  if(approx){
    add('字幕 / 脚本 / 清单 / 数据 / 命令', Math.round(2800 * scope.length));
  }else{
    var srt = buildSrtText(scope);
    add('分镜字幕.srt', utf8Bytes(srt ? srt.text : '').length);
    add('分镜脚本.md', utf8Bytes(buildMdText(scope)).length);
    add('视频清单.csv', utf8Bytes('\ufeff' + buildCsvText(scope)).length);
    add('全量数据.json', utf8Bytes(JSON.stringify({ assets: state.assets, shots: scope })).length);
    add('转码命令 / 打包说明', utf8Bytes(ffmpegMp3Cmd()).length + 320);
  }
  var track = hasAud ? Math.round(secs * 24000 * 2) : 0;   /* 24k 单声道 16bit = 2 字节/采样 */
  var names = parts.map(function(p){ return p.name; });
  if(hasAud) names.push('整轨配音.wav');
  add('zip 容器开销', zipOverhead(names));
  /* 整轨不计入 text：text 保持「不勾整轨时的体积」口径，total 才是含整轨的总体积 */
  if(hasAud) parts.push({ name: '整轨配音.wav', bytes: track, audio: true });
  var biggest = null;
  parts.forEach(function(p){ if(!biggest || p.bytes > biggest.bytes) biggest = p; });
  return { text: text, track: track, total: text + track, secs: secs, hasAud: hasAud, approx: approx, parts: parts, biggest: biggest };
}
/* v2.20：把体积明细按大小排一下，只说前 3 大项——用户想知道「包为什么这么大」时一眼能看到 */
function sizeBreakTxt(sz){
  if(!sz || !sz.parts || !sz.parts.length) return '';
  var arr = sz.parts.slice().sort(function(a, b){ return b.bytes - a.bytes; });
  var top = arr.slice(0, 3).map(function(p){ return esc(p.name) + ' ' + fmtBytes(p.bytes); }).join('　·　');
  var rest = arr.length > 3 ? '　·　其余 ' + (arr.length - 3) + ' 项' : '';
  return '<div style="color:var(--tx3);margin-top:2px">体积明细（按大小）：' + top + rest + '</div>';
}
/* v2.22：整轨配音的体积建议——整轨 wav 往往是包里最大的一项，压缩版能小一个量级。
   浏览器端没有 mp3 编码器（引 lamejs 不划算），但 MediaRecorder 能出 AAC(m4a)，
   所以设置里的「整轨压缩」（cfg.trackZip）就是这条建议的落点；这里把它值多少直接算出来给用户看。 */
function trackAdviceTxt(sz){
  if(!sz || !sz.hasAud || !sz.track) return '';
  var wav = sz.track;
  var m4a = Math.max(1, Math.round(wav * 0.06));   /* AAC 128k 经验值 ≈ wav 的 1/16 */
  var mp3 = Math.max(1, Math.round(wav * 0.07));   /* mp3 128k 经验值 ≈ wav 的 1/14 */
  var save = Math.round((1 - m4a / wav) * 100);
  var on = !!cfg.trackZip;
  var tip = on
    ? '已开「整轨压缩」（导出 .m4a，约 ' + fmtBytes(m4a) + '），比 wav 省 ' + save + '%'
    : '转成压缩版（.m4a 约 ' + fmtBytes(m4a) + '、mp3 约 ' + fmtBytes(mp3) + '）可省 ' + save + '%';
  return '<div style="color:var(--tx3);margin-top:2px">整轨 ' + fmtBytes(wav) + '：' + tip +
    (wav > 20 * 1024 * 1024 && !on ? '　<span style="color:#B45309">已超 20 MB，建议到设置里开「整轨压缩」</span>' : '') + '</div>';
}
/* v2.18：导出前的即时预览——打完包才发现「范围选错了/导了空包」很浪费时间，
   这里在导出中心实时算出「本次会导出几镜、大概多长、大概多大」，并提示空范围。 */
function updExpPreview(){
  var el = $('expScopePrev'); if(!el) return;
  var sc = ($('expScope') && $('expScope').value) || 'all';
  var wrap = $('expRangeWrap'); if(wrap) wrap.style.display = (sc === 'range') ? '' : 'none';
  if(!state.shots.length){ el.innerHTML = '当前还没有分镜，先到「剧本拆镜」导入小说。'; return; }
  var list = exportScopeShots();
  var secs = 0;
  list.forEach(function(s){ secs += shotDur(s); });
  var empty = !list.length;
  var sz = estExportSize(list);
  var sizeTxt = '预计体积 <b>' + (sz.approx ? '≈' : '') + fmtBytes(sz.hasAud ? sz.total : sz.text) + '</b>' +
    (sz.hasAud ? '<span style="color:var(--tx3)">（含整轨 ' + fmtBytes(sz.track) + '；不勾整轨约 ' + fmtBytes(sz.text) + '）</span>' : '');
  el.innerHTML = '本次将导出 <b>' + list.length + '</b> / ' + state.shots.length + ' 镜 · 预计时长 <b>' + fmtSec(Math.round(secs)) + '</b> · ' + sizeTxt +
    (empty ? '　<span style="color:#EF4444">（此范围没有镜头，换个范围再打包）</span>' : '') +
    '　<span style="color:var(--tx3)">范围：' + esc(scopeLabel()) + '</span>' +
    (empty ? '' : sizeBreakTxt(sz) + trackAdviceTxt(sz));
}
/* 一键把所有能导的东西打成一个包：srt + md + csv + json + 转码命令（+ 可选整轨 wav）。
   每个文件都是复用单独导出时的同一份内容（build* 系列纯函数），不会出现「单导和打包结果不一致」。
   v2.17：全部按「打包范围」筛选，范围写进包内说明，避免拿到包不知道导的是哪一部分。 */
/* v2.23：一键打包「只打这些文件」的勾选。缺省全打（与老行为一致），
   存档里的对象万一缺键也按「打」处理，不会因为升级把用户的文件悄悄少了。 */
function bundlePick(){
  var d = { srt:true, md:true, csv:true, json:true, ff:true, xlsx:false }, p = cfg.bundlePick;
  if(p && typeof p === 'object'){ for(var k in d){ if(k in p) d[k] = !!p[k]; } }
  return d;
}
function bundlePickTxt(){
  var p = bundlePick(), a = [];
  if(p.srt) a.push('字幕'); if(p.md) a.push('脚本'); if(p.csv) a.push('清单');
  if(p.json) a.push('数据'); if(p.ff) a.push('转码命令'); if(p.xlsx) a.push('汇总表');
  return a.length ? a.join(' / ') : '（无）';
}
function exportBundle(){
  if(!state.shots.length){ toast('还没有分镜，先导入小说拆镜'); return; }
  var scope = exportScopeShots();
  if(cfg.bundleStatus && cfg.bundleStatus !== 'all') scope = viewShots(scope, cfg.bundleStatus, '');
  if(!scope.length){ toast('当前打包范围（及状态筛选）内没有镜头，换个范围或状态再试'); return; }
  var pick = bundlePick();
  if(!pick.srt && !pick.md && !pick.csv && !pick.json && !pick.ff && !pick.xlsx && !cfg.bundleHealth && !cfg.bundleLeft){
    toast('「打包内容」一个都没勾——至少勾一样再打包'); return;
  }
  var files = [];
  if(pick.srt){ var srt = buildSrtText(scope); if(srt) files.push({ name: '分镜字幕.srt', data: srt.text }); }
  if(pick.md) files.push({ name: '分镜脚本.md', data: buildMdText(scope) });
  if(pick.csv) files.push({ name: '视频清单.csv', data: '\ufeff' + buildCsvText(scope) });
  if(pick.json) files.push({ name: '全量数据.json', data: JSON.stringify({
    exportedAt: nowStr(),
    scope: scopeLabel(),
    shotCount: scope.length,
    novel: ($('novel') && $('novel').value) || '',
    assets: state.assets, shots: scope
  }, null, 2) });
  if(pick.ff) files.push({ name: '转码命令.txt', data: ffmpegMp3Cmd() });
  /* v2.24：勾选时把当前范围导成一个多工作表合并 Excel（视频清单 + 体检 + 剩余清单），
     xlsxBuild 返回的是 Uint8Array，可直接当 zip 内的一件二进制打进包。 */
  if(pick.xlsx){
    var xsheets = buildXlsxSheets(scope);
    if(xsheets && xsheets.length) files.push({ name: '短剧数据汇总.xlsx', data: xlsxBuild(xsheets) });
  }
  /* v2.22：可选把体检报告 / 剩余清单一起打进包——发给协作者时一份包看全，不必再单独导两次 */
  if(cfg.bundleHealth){
    var hRows = buildHealthRows();
    if(hRows) files.push({ name: '关键字段体检.csv', data: '\ufeff' + hRows.map(csvRow).join('\n') });
  }
  if(cfg.bundleLeft){
    leftKindsWithData().forEach(function(k){
      var sh = buildLeftSheet(k);
      if(sh) files.push({ name: sh.name + '.csv', data: '\ufeff' + sh.rows.map(csvRow).join('\n') });
    });
  }
  files.push({ name: '打包说明.txt', data:
    '导出时间：' + nowStr() + '\n' +
    '打包范围：' + scopeLabel() + '\n' +
    '打包内容：' + bundlePickTxt() + (cfg.bundleHealth ? ' / 体检报告' : '') + (cfg.bundleLeft ? ' / 剩余清单' : '') +
    (cfg.bundleStatus && cfg.bundleStatus !== 'all' ? ('\n状态筛选：' + (FILTER_NAMES[cfg.bundleStatus] || cfg.bundleStatus)) : '') + '\n' +
    '包含镜头：' + scope.length + ' / ' + state.shots.length + ' 镜' +
    (scope.length < state.shots.length ? '（第 ' + scope.map(function(s){ return s['镜号']; }).join(', ') + ' 镜）' : '（全部）') + '\n' +
    '说明：字幕 / 脚本 / 清单 / 全量数据 / 整轨配音均只含上述范围内的镜头；' +
    '如需整本导出，把「打包范围」改回「全部镜头」再打一次。\n' });
  var hasAud = false;
  scope.forEach(function(s){ if(audLoad(s._id)) hasAud = true; });
  var name = '短剧工作台导出包_' + nowStr().replace(/[: ]/g,'-') + '.zip';
  if(!hasAud){ downloadZip(name, files); return; }
  askConfirm('本机有已生成的配音，是否把整轨配音（.wav）也打进包里？文件会大一些。（整轨只含上面所选范围内的镜头）', '一起打包', true)
    .then(function(withAud){
      if(!withAud){ downloadZip(name, files); return; }
      toast('正在合成整轨配音…');
      buildTrackWav(scope).then(function(r){
        if(r && r.ab) files.push({ name: '整轨配音.wav', data: new Uint8Array(r.ab) });
        else toast('没取到可用配音，包里跳过整轨');
        downloadZip(name, files);
      }).catch(function(){ toast('整轨合成失败，其余文件照常打包'); downloadZip(name, files); });
    });
}

/* ================= 一键合成包导出（对标火宝 FFmpeg 整集拼接导出） =================
   产出：render.sh（macOS/Linux）、render.bat（Windows）、合成清单.json
   脚本直接用 ffmpeg 读取 Agnes 的公网 URL：逐镜落盘（没视频的镜头用图垫段）→ concat 拼接
   → 混整轨人声 + BGM → 烧 SRT 字幕，输出 成片.mp4 */
function ratioWH(){
  var r = String(cfg.imgRatio || '9:16').split(':');
  var w = num(r[0]) || 9, h = num(r[1]) || 16;
  var scale = 720 / Math.max(w, h);
  return { w: Math.round(w * scale / 2) * 2, h: Math.round(h * scale / 2) * 2 };
}
/* shell 单引号转义 */
function shQ(s){ return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function exportRenderPack(){
  if(!state.shots.length){ toast('还没有分镜'); return; }
  var list = state.shots.slice().sort(function(a, b){ return num(a['镜号']) - num(b['镜号']); });
  var ridx = assignRenderIdx(list);   /* 段号：只数有 图片/视频 的镜，空镜不占号 */
  var wh = ratioWH(), total = 0, segs = [];
  list.forEach(function(s, i){
    var vu = s['口型视频URL'] || s['视频URL'] || '';
    var iu = s['图片URL'] || '';
    if(!vu && !iu) return;                               /* 图都没有的镜跳过，并在清单里标注 */
    var d = shotDur(s);                                  /* v2.8：统一时长口径，与 SRT/整轨/FCPXML 完全一致 */
    total += d;
    segs.push({ idx: padSeg(ridx[s._id]), no: s['镜号'], url: vu || iu, isVid: !!vu, d: d });
  });
  if(!segs.length){ toast('还没有生成任何图片 / 视频，无法合成'); return; }
  var fade = Math.min(10, Math.max(0, num(cfg.bgmFade)));
  var vol = Math.min(1, Math.max(0, num(cfg.bgmVol)));
  var fadeOutAt = Math.max(0, Math.round(total - fade));
  var filter = '[2:a]volume=' + vol + ',afade=t=in:d=' + fade + ',afade=t=out:st=' + fadeOutAt + ':d=' + fade + '[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]';
  /* 字幕样式：全部可在设置里调，字号会按输出分辨率缩放，保证竖屏横屏观感一致 */
  var fs = num(cfg.subSize) || 14;
  /* v2.7：可选手动「半透明黑底」增强可读性（对标 MoneyPrinterTurbo 的字幕底）。
     开启时用 ASS BorderStyle=4 画底（Box，Outline 为盒边），不开则沿用描边方案。 */
  var subBgOn = !!cfg.subBg;
  var subStyle = "subtitles=subs.srt:force_style='FontName=" + (cfg.subFont || 'Microsoft YaHei') +
    ",FontSize=" + fs +
    ",PrimaryColour=&H" + (cfg.subColor || 'FFFFFF') +
    (subBgOn
      ? ",BorderStyle=4,BackColour=&H99000000,Outline=3,Shadow=0"
      : ",OutlineColour=&H" + (cfg.subOutlineColor || '000000') + ",Outline=" + (num(cfg.subOutline) || 1) + ",Shadow=0") +
    ",Alignment=2,MarginV=" + (num(cfg.subMargin) || 36) +
    ",Bold=" + (cfg.subBold ? 1 : 0) + "'";
  var sh = [], bat = [];
  sh.push('#!/bin/bash');
  sh.push('# 《小说转短剧》一键合成脚本（macOS / Linux。需已安装 ffmpeg：brew install ffmpeg 或 apt install ffmpeg）');
  bat.push('@echo off');
  bat.push('chcp 65001 >nul');
  bat.push('rem 《小说转短剧》一键合成脚本（Windows，需已安装 ffmpeg 并加入 PATH）');
  ['使用步骤：',
   '  1. 在网页「成片与导出」里点「导出字幕 .srt」和「导出整轨配音 .wav」，把两个文件和本脚本放进同一个文件夹，并把它们改名为 subs.srt 和 voice.wav；',
   '  2. 本目录会自动生成 合成清单.json 备查；',
   '  3. 运行本脚本（sh: bash render.sh / bat: 双击 render.bat），完成后得到 成片.mp4。',
   '说明：Agnes 的图片/视频 URL 是公网直链，ffmpeg 可直接读取；URL 有时效，请尽快合成。',
   '字幕/配音与画面若有轻微漂移，请在设置里开启「配音后自动对齐镜头时长」并重新生成对不上的镜头视频。','  4. 镜头间转场采用「段内淡入淡出」，总时长不变，因此不会与配音轨/字幕错位；图片垫段带 Ken Burns 缓慢推拉运镜。'].forEach(function(l){
    sh.push('# ' + l);
    bat.push('rem ' + l);
  });
  /* v2.5：图片垫段加 Ken Burns 运镜，段内淡入淡出（保持总时长不变，避免与配音轨错位） */
  var fps = Math.max(24, Math.min(60, num(cfg.fps) || 30));
  var bitrate = String(cfg.bitrate || '8M').replace(/[^\w]/g, '') || '8M';
  var trans = (cfg.trans === 'none') ? 'none' : 'fade';
  var td = Math.max(0, Math.min(2, num(cfg.transDur) || 0.5));
  if(td > 0 && td > (Math.min.apply(null, segs.map(function(g){ return g.d; })) / 2)) td = 0.2;
  var kb = cfg.kb || 'in';
  function baseFilter(withFade, d){
    var f = 'scale=' + wh.w + ':' + wh.h + ':force_original_aspect_ratio=decrease,pad=' + wh.w + ':' + wh.h + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + fps;
    if(withFade && td > 0) f += ',fade=t=in:st=0:d=' + td + ',fade=t=out:st=' + (Math.max(0, d - td)).toFixed(2) + ':d=' + td;
    return f + ',format=yuv420p';
  }
  function kbFilter(d){
    var frames = Math.max(1, Math.round(d * fps));
    var z = (kb === 'out') ? "if(lte(zoom,1.0),1.18,max(1.002,zoom-0.0012))" : "min(zoom+0.0012,1.18)";
    if(kb === 'none') return null;
    return "zoompan=z='" + z + "':d=" + frames + ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=" + wh.w + "x" + wh.h + ":fps=" + fps;
  }
  segs.forEach(function(g){
    var out = 'seg_' + g.idx + '.mp4';
    if(g.isVid && trans === 'none'){
      /* 硬切：视频段直接拷贝，最快 */
      sh.push('echo [seg ' + g.idx + '] 第 ' + g.no + ' 镜（视频）');
      sh.push('ffmpeg -y -loglevel error -i ' + shQ(g.url) + ' -c copy ' + out + ' || ffmpeg -y -loglevel error -i ' + shQ(g.url) + ' ' + out);
      bat.push('echo [seg ' + g.idx + '] 第 ' + g.no + ' 镜（视频）');
      bat.push('ffmpeg -y -loglevel error -i "' + g.url + '" -c copy ' + out);
      bat.push('if errorlevel 1 ffmpeg -y -loglevel error -i "' + g.url + '" ' + out);
    }else if(g.isVid){
      var vf = baseFilter(true, g.d);
      sh.push('echo [seg ' + g.idx + '] 第 ' + g.no + ' 镜（视频 + 淡入淡出）');
      sh.push('ffmpeg -y -loglevel error -i ' + shQ(g.url) + ' -t ' + g.d + ' -vf "' + vf + '" -r ' + fps + ' -b:v ' + bitrate + ' ' + out);
      bat.push('echo [seg ' + g.idx + '] 第 ' + g.no + ' 镜（视频 + 淡入淡出）');
      bat.push('ffmpeg -y -loglevel error -i "' + g.url + '" -t ' + g.d + ' -vf "' + vf + '" -r ' + fps + ' -b:v ' + bitrate + ' ' + out);
    }else{
      var f = 'scale=' + wh.w * 2 + ':' + wh.h * 2 + ':force_original_aspect_ratio=increase,crop=' + wh.w * 2 + ':' + wh.h * 2 + ',' + kbFilter(g.d) + ',' + baseFilter(true, g.d);
      sh.push('echo [seg ' + g.idx + '] 第 ' + g.no + ' 镜（图片垫段 ' + g.d + ' 秒' + (kb === 'none' ? '' : ' + ' + (kb === 'out' ? '拉远' : '推近') + '运镜') + '）');
      sh.push('ffmpeg -y -loglevel error -loop 1 -framerate ' + fps + ' -t ' + g.d + ' -i ' + shQ(g.url) + ' -vf "' + f + '" -r ' + fps + ' -b:v ' + bitrate + ' ' + out);
      bat.push('echo [seg ' + g.idx + '] 第 ' + g.no + ' 镜（图片垫段 ' + g.d + ' 秒' + (kb === 'none' ? '' : ' + ' + (kb === 'out' ? '拉远' : '推近') + '运镜') + '）');
      bat.push('ffmpeg -y -loglevel error -loop 1 -framerate ' + fps + ' -t ' + g.d + ' -i "' + g.url + '" -vf "' + f + '" -r ' + fps + ' -b:v ' + bitrate + ' ' + out);
    }
  });
  var concatLines = segs.map(function(g){ return "file 'seg_" + g.idx + ".mp4'"; }).join('\n');
  sh.push("cat > concat.txt <<'EOF'");
  sh.push(concatLines);
  sh.push('EOF');
  bat.push('type nul > concat.txt');
  segs.forEach(function(g){ bat.push("echo file 'seg_" + g.idx + ".mp4'>>concat.txt"); });
  sh.push('echo 拼接全部镜头…');
  sh.push('ffmpeg -y -loglevel error -f concat -safe 0 -i concat.txt -c copy 01_merged.mp4');
  bat.push('echo 拼接全部镜头…');
  bat.push('ffmpeg -y -loglevel error -f concat -safe 0 -i concat.txt -c copy 01_merged.mp4');
  sh.push('echo 混入配音整轨' + (cfg.bgmUrl ? ' + BGM' : '') + '…');
  bat.push('echo 混入配音整轨' + (cfg.bgmUrl ? ' + BGM' : '') + '…');
  if(cfg.bgmUrl && vol > 0){
    sh.push('ffmpeg -y -loglevel error -i 01_merged.mp4 -i voice.wav -stream_loop -1 -i ' + shQ(cfg.bgmUrl) + ' -filter_complex ' + shQ(filter) + ' -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k 02_av.mp4');
    bat.push('ffmpeg -y -loglevel error -i 01_merged.mp4 -i voice.wav -stream_loop -1 -i "' + cfg.bgmUrl + '" -filter_complex "' + filter + '" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k 02_av.mp4');
  }else{
    sh.push('ffmpeg -y -loglevel error -i 01_merged.mp4 -i voice.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k 02_av.mp4');
    bat.push('ffmpeg -y -loglevel error -i 01_merged.mp4 -i voice.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k 02_av.mp4');
  }
  sh.push('echo 烧录字幕…');
  sh.push('ffmpeg -y -loglevel error -i 02_av.mp4 -vf ' + shQ(subStyle) + ' -c:a copy 成片.mp4');
  sh.push('echo 完成：成片.mp4（约 ' + fmtSec(total) + '，' + segs.length + ' 段）');
  bat.push('echo 烧录字幕…');
  bat.push('ffmpeg -y -loglevel error -i 02_av.mp4 -vf "' + subStyle.replace(/"/g, '') + '" -c:a copy 成片.mp4');
  bat.push('echo 完成：成片.mp4（约 ' + fmtSec(total) + '，' + segs.length + ' 段）');
  bat.push('pause');
  var manifest = {
    导出时间: nowStr(), 画幅: cfg.imgRatio, 分辨率: (wh.w + 'x' + wh.h),
    视频总时长秒: Math.round(total), 段数: segs.length,
    字幕文件: 'subs.srt（由「导出字幕 .srt」改名）', 配音文件: 'voice.wav（由「导出整轨配音 .wav」改名）',
    转场: (trans === 'none' ? '硬切' : ('段内淡入淡出 ' + td + ' 秒')),
    图片运镜: (kb === 'none' ? '静止' : (kb === 'out' ? '缓慢拉远 Ken Burns' : '缓慢推近 Ken Burns')),
    帧率: fps, 码率: bitrate,
    BGM: cfg.bgmUrl || '（未配置）',
    缺失镜头: list.filter(function(s){ return !(s['口型视频URL'] || s['视频URL'] || s['图片URL']); }).map(function(s){ return s['镜号']; }),
    段清单: segs.map(function(g){ return { 镜号: g.no, 类型: g.isVid ? '视频' : '图片垫段', 时长秒: g.d, URL: g.url }; })
  };
  download('render.sh', sh.join('\n') + '\n', 'text/x-sh;charset=utf-8');
  setTimeout(function(){ download('render.bat', bat.join('\r\n') + '\r\n', 'text/plain;charset=utf-8'); }, 250);
  setTimeout(function(){ download('合成清单.json', JSON.stringify(manifest, null, 2), 'application/json;charset=utf-8'); }, 500);
  toast('合成包已导出（render.sh / render.bat / 合成清单.json），配合字幕和整轨配音即可一键出成片');
}

/* ---------- 分镜编辑：排序 / 复制 / 插入 / 撤销（对标导演 Timeline 可拖拽调整） ---------- */
function sortedShots(){
  return state.shots.slice().sort(function(a, b){ return num(a['镜号']) - num(b['镜号']); });
}
/* v2.7：给排序后的每个分镜分配「落盘段号 seg_NN」。口径与 render.sh 一致——
   只数「有图片或有视频」的镜（纯图镜也会被 render.sh 垫段成 seg），纯文字空镜不计。
   FCPXML 与合成脚本都用它命名文件，保证导入剪辑软件后引用的 seg_N.mp4 与 render.sh
   实际落盘的是同一镜，修复此前「缺视频镜时两处编号错位、剪到别的镜」的问题。 */
function assignRenderIdx(sortedList){
  var m = {}, k = 0;
  sortedList.forEach(function(s){
    if(String(s['口型视频URL'] || s['视频URL'] || s['图片URL'] || '').trim()){ k++; m[s._id] = k; }
  });
  return m;
}
function padSeg(n){ return ('00' + n).slice(-3); }
/* v2.31：撤销快照持久化。原来撤销栈只活在内存里，刷新页面 / 误关标签页就全没了，
   而「清空 / 覆盖导入 / 批量改」恰恰是最需要后悔药的操作。
   快照是整表全量，不能照单全存（本机音频 base64 还占着大头），所以：
   只落最近 UNDO_SAVE 条，总字符数过 UNDO_MAX 就从旧往新丢，写爆配额再逐条丢到能塞下为止。
   UNDO_KEEP 是内存里保留的条数（比落盘的多，反正内存便宜）。 */
var UNDO_KEEP = 20, UNDO_SAVE = 3, UNDO_MAX = 600000;
function undoLsKey(){ return pk('undo'); }
function redoLsKey(){ return pk('redo'); }        /* v2.32：重做栈，与撤销栈同一套存法 */
function saveSnaps(key, list){
  try{
    var arr = (list || []).slice(-UNDO_SAVE), total = 0, cut = 0, i;
    for(i = arr.length - 1; i >= 0; i--){          /* 从新往旧累加，超了就只留更近的那截 */
      total += String(arr[i]).length;
      if(total > UNDO_MAX){ cut = i + 1; break; }
    }
    if(cut) arr = arr.slice(cut);
    while(arr.length){
      try{ localStorage.setItem(key, JSON.stringify(arr)); return; }
      catch(e){ arr.shift(); }                     /* 配额不够：丢掉最老的一张再来 */
    }
    /* v2.53：连一张都存不下（或空间被配音占满）时，以前是静默删掉整个撤销栈，
       用户以为「存过快照」，刷新后却一步都撤不了。这里至少要说一声。 */
    try{ localStorage.removeItem(key); }catch(e){}
    if(!_lsWarn[key]){ _lsWarn[key] = 1; toast('撤销历史存不下了（存储已满）：本次刷新后无法回退，建议先导出备份'); }
  }catch(e){}
}
/* v2.31：跨刷新恢复快照有个前提——这份快照得还是「当前这份数据的上一版」。
   换设备、别人改过、或者清空后另起了新数据，旧快照再恢复就是拿历史覆盖现状，
   比没有撤销更糟。所以只在「最新快照的镜头数、镜头 id 与当前完全一致」时才恢复，否则直接丢掉。 */
function loadSnaps(key){
  try{
    var v = JSON.parse(localStorage.getItem(key));
    if(!Array.isArray(v)) return null;
    var arr = v.filter(function(x){ return typeof x === 'string'; }).slice(-UNDO_SAVE);
    if(!arr.length) return null;
    var last = JSON.parse(arr[arr.length - 1]);
    var ids = {};
    state.shots.forEach(function(s){ ids[s._id] = 1; });
    var lastIds = {};
    last.forEach(function(x){ lastIds[x._id] = 1; });
    var every = function(a, inB){ for(var k in a){ if(!inB[k]) return false; } return true; };
    /* 只允许「纯删」或「纯增」两种偏离：快照 ⊇ 现状（清空过）/ 快照 ⊆ 现状（新增过）。
       id 完全对不上说明数据已经换了一批（换设备、别人改过），一律作废。 */
    if(every(ids, lastIds) || every(lastIds, ids)) return arr;
    try{ localStorage.removeItem(key); }catch(e){}
    return null;
  }catch(e){ return null; }
}
/* v2.41：撤销 / 重做 / 跳版都是「先动栈、再拿快照去对齐云端」。可一旦对齐时写入有失败，
   提示写着「可再点一次」，栈却已经被消费掉了——再点就是**静悄悄多退一步**，
   用户以为在重试，实际退到了更早的版本上。
   所以动栈之前先把两个栈拍个平铺副本（元素都是字符串，浅拷就够），失败时原样还回去。 */
function undoStackSnap(){ return { u:(state.undo || []).slice(), r:(state.redo || []).slice() }; }
function undoStackBackup(bak){
  if(!bak) return;
  state.undo = bak.u; state.redo = bak.r;
  saveUndo(); saveRedo(); renderUndoBtns(); renderUndoHist();
}
function saveUndo(){ saveSnaps(undoLsKey(), state.undo); }
function saveRedo(){ saveSnaps(redoLsKey(), state.redo); }
function loadUndo(){ var a = loadSnaps(undoLsKey()); if(a) state.undo = a; }
function loadRedo(){ var a = loadSnaps(redoLsKey()); if(a) state.redo = a; }
/* 当前整表的快照字符串（`_localOnly` 是纯前端派生字段，不入账） */
function snapShots(){
  return JSON.stringify(state.shots.map(function(s){
    var o = {}; for(var k in s){ if(k !== '_localOnly') o[k] = s[k]; } return o;
  }));
}
/* v2.39：撤销栈的「跳到某一版」——原来只能一步一步退（栈里最多 20 步），
   退过头了还得一版一版重做回去。快照本身只是整表的 JSON 字符串、没有标签，
   所以按「几步前 + 那一版的镜数」来认：镜数一变往往一眼就知道是「删之前 / 导入之前」。 */
/* v2.41：「几步前 + 那时的镜数」分不清相邻两版——改字段 / 批量改 / 选最高分这类不动镜数的操作，
   前后两版的镜数一模一样，面板上看就是两条长得一样的按钮。
   这里再算一个「与之后那一版比，增删了几个镜」：id 差异是两份快照直接比出来的，
   不需要给快照加时间戳，也就不用动存储格式（老快照照样能认）。 */
function snapIdsOf(str){
  try{ return (JSON.parse(str) || []).map(function(x){ return String(x && x._id); }); }
  catch(e){ return []; }
}
function snapDiffTxt(here, next){
  if(!here || !next) return '';
  var h = {}, nx = {}, del = 0, add = 0;
  here.forEach(function(k){ h[k] = 1; });
  next.forEach(function(k){ nx[k] = 1; });
  here.forEach(function(k){ if(!nx[k]) del++; });   /* 这一版有、之后没了 = 之后被删掉 */
  next.forEach(function(k){ if(!h[k]) add++; });    /* 之后才出现 = 之后新增进来 */
  if(del && add) return '之后删 ' + del + ' 增 ' + add;
  if(del) return '之后删 ' + del + ' 镜';
  if(add) return '之后增 ' + add + ' 镜';
  return '之后只改内容';
}
function undoPickList(){
  var arr = state.undo || [];
  var ids = arr.map(snapIdsOf);                 /* 一次解析够两个用途：镜数 + 差异 */
  var cur = state.shots.map(function(s){ return String(s && s._id); });
  return arr.map(function(str, i){
    var back = arr.length - i;                  /* 1 = 上一版 */
    /* 这一版「之后」的那一版：最后一版的「之后」就是现在 */
    var next = (i + 1 < ids.length) ? ids[i + 1] : cur;
    return { i:i, back:back, n:ids[i].length, diff:snapDiffTxt(ids[i], next),
             label:(back === 1 ? '上一版' : (back + ' 步前')) };
  }).reverse();                                 /* 从最近往最早列，最上面就是「上一版」 */
}
/* 回到第 idx 版。被跳过的那些版本**按顺序压进重做栈**（后压的先出），
   所以「重做」能一版一版往回走，不会像直接丢栈那样把中间几版弄丢。 */
function undoTo(idx){
  var arr = state.undo || [];
  if(idx < 0 || idx >= arr.length){ toast('这一版已经不在栈里了'); return; }
  var bak = undoStackSnap();                    /* v2.41：失败要把塌掉的这几版还回去 */
  var back = arr.length - idx, k;
  var snap = JSON.parse(arr[idx]);
  state.redo = state.redo || [];
  state.redo.push(snapShots());                 /* 先压「现状」，重做到底就能回到最新 */
  for(k = arr.length - 1; k > idx; k--) state.redo.push(arr[k]);
  while(state.redo.length > UNDO_KEEP) state.redo.shift();
  state.undo = arr.slice(0, idx);
  saveUndo(); saveRedo();
  renderUndoBtns(); renderUndoHist();
  toast('正在回到' + (back === 1 ? '上一版' : (back + ' 步前')) + '…');
  restoreSnap(snap, '回到历史版本').then(function(rep){
    if(rep && rep.fail){
      setSync('off');
      undoStackBackup(bak);          /* v2.41：塌掉的那几版全还回栈里，重试才是同一个目标版本 */
      toast('回到历史版本未完成：' + rep.ok + ' 项成功、' + rep.fail + ' 项失败（已按云端实际状态刷新；撤销栈已还原，可再点一次重试）');
    }else{
      toast('已回到' + (back === 1 ? '上一版' : (back + ' 步前')));
    }
  });
}
/* 面板开关状态（state 里记，刷新界面不会自己合上） */
function toggleUndoHist(){
  state.undoHistOpen = !state.undoHistOpen;
  renderUndoHist();
}
function renderUndoHist(){
  var box = $('undoHistBox'); if(!box) return;
  /* v2.41：先看面板开没开再解析——refreshAll 每次都会调到这儿，
     而 undoPickList 要把栈里几十万字符的快照全部 JSON.parse 一遍，关着还白算一遍。 */
  if(!state.undoHistOpen || !(state.undo && state.undo.length)){
    box.hidden = true; box.innerHTML = '';
    return;
  }
  var list = undoPickList();
  box.hidden = false;
  box.innerHTML = '<div class="hint" style="margin:0 0 8px">撤销栈里还有 ' + list.length + ' 版（每存一次「改动前」算一版）。' +
    '每版后面那句是「相对之后那一版，增删了几个镜」——镜数一样的两版靠它区分。' +
    '点一下直接跳过去，中间的版本仍可用「重做」逐步走回来：</div>' +
    list.map(function(v){
      return '<button class="btn gh sm" data-act="undoto" data-i="' + v.i + '" style="margin:0 6px 6px 0">' +
        esc(v.label) + ' · 那时 ' + v.n + ' 镜' + (v.diff ? ' · ' + esc(v.diff) : '') + '</button>';
    }).join('');
}
function pushUndo(){
  try{
    state.undo = state.undo || [];
    state.undo.push(snapShots());
    if(state.undo.length > UNDO_KEEP) state.undo.shift();
    /* v2.32：一有新改动，之前那条「重做」就作废了（否则重做会跳到一个已经不存在的分支上） */
    state.redo = [];
    saveUndo(); saveRedo();                        /* v2.31：顺手落盘，刷新后还能撤 */
    renderUndoBtns(); renderUndoHist();            /* v2.39：入栈后立刻刷新「历史」面板，别让列表是旧的 */
  }catch(e){}
}
/* v2.32：把「拿一张快照去对齐云端」抽出来，撤销 / 重做共用同一套 diff 逻辑（原来只有撤销一份）。
   返回 Promise<rep>：{ok, fail, errs, stopped}，由调用方决定怎么提示。 */
function restoreSnap(snap, label){
  var p = db(), byId = {}, snapIds = {};
  state.shots.forEach(function(s){ byId[s._id] = s; });
  snap.forEach(function(x){ snapIds[x._id] = true; });
  /* v2.30：改成「先收集任务、再 runSerial」——原来是一条失败整链断（后面的撤销全不执行），
     且 catch 里只 console.error，撤销只成功一半却照样提示「已撤销」，用户完全不知情。 */
  var jobs = [];
  state.shots.forEach(function(s){
    if(!snapIds[s._id]){
      jobs.push(function(){ return p ? p.deleteRecord({ databaseId: DB_ID, recordId: s._id }) : null; });
    }
  });
  snap.forEach(function(x){
    var cur = byId[x._id];
    if(!cur){
      /* v2.53：撤销恢复出来的记录也要归属当前剧目——原来直接 toProps(x)，
         旧快照 / 导入进来的记录没有 pid，恢复后立刻被 loadShots 过滤掉：
         用户点「撤销」不但没找回镜头，反而让它彻底消失。 */
      jobs.push(function(){ return p ? p.addRecord({ databaseId: DB_ID, properties: toProps(Object.assign({ pid: state.pid }, x)) }) : null; });
    }else{
      var diff = {}, has = false;
      for(var k in x){ if(k === '_id') continue; if(String(cur[k] == null ? '' : cur[k]) !== String(x[k] == null ? '' : x[k])){ diff[k] = x[k]; has = true; } }
      if(has) jobs.push(function(){ return p ? p.updateRecord({ databaseId: DB_ID, recordId: x._id, properties: toProps(diff) }) : null; });
    }
  });
  var rep = null;
  return runSerial(jobs, { label: label, tag: 'undo' })
    .then(function(r){
      rep = r;
      state.shots = snap.map(function(x){ return Object.assign({}, x); });
      if(!hasCloud()) localSave(state.shots);
      return loadShots();
    })
    .then(function(){
      refreshAll();
      return rep;
    });
}
function undoShots(){
  if(!state.undo || !state.undo.length){ toast('没有可撤销的操作'); return; }
  var bak = undoStackSnap();                     /* v2.41：失败要把这一步还回栈里 */
  var snap = JSON.parse(state.undo.pop());
  /* v2.32：撤销前把「现状」压进重做栈，撤销就不再是单程票 */
  state.redo = state.redo || [];
  state.redo.push(snapShots());
  if(state.redo.length > UNDO_KEEP) state.redo.shift();
  saveUndo(); saveRedo();                        /* 弹掉/压入一张就重新落盘 */
  restoreSnap(snap, '撤销').then(function(rep){
    if(rep && rep.fail){
      setSync('off');
      undoStackBackup(bak);          /* v2.41：这一步仍在栈顶，所以「再点一次」说的是同一件事 */
      toast('撤销未完成：' + rep.ok + ' 项成功、' + rep.fail + ' 项失败（已按云端实际状态刷新；这一步退回撤销栈了，可再点一次重试）');
    }else{
      toast('已撤销上一步操作');
    }
  });
}
function redoShots(){
  if(!state.redo || !state.redo.length){ toast('没有可重做的操作'); return; }
  var bak = undoStackSnap();                     /* v2.41：同撤销——失败就把这一步还回重做栈 */
  var snap = JSON.parse(state.redo.pop());
  state.undo = state.undo || [];
  state.undo.push(snapShots());                  /* 重做本身也占用一格撤销 */
  saveUndo(); saveRedo();
  toast('正在重做…');
  restoreSnap(snap, '重做').then(function(rep){
    if(rep && rep.fail){
      setSync('off');
      undoStackBackup(bak);
      toast('重做未完成：' + rep.ok + ' 项成功、' + rep.fail + ' 项失败（这一步退回重做栈了，可再点一次重做）');
    }else{
      toast('已重做');
    }
  });
}
/* 重排后统一重编号（镜号即顺序，云端也只认这个字段） */
function renumber(arr){
  arr.forEach(function(s, i){ s['镜号'] = i + 1; });
  return arr;
}
function moveShot(id, dir){
  var arr = sortedShots(), i = -1;
  arr.forEach(function(s, k){ if(s._id === id) i = k; });
  var j = i + dir;
  if(i < 0 || j < 0 || j >= arr.length){ return; }
  pushUndo();
  var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  renumber(arr);
  /* v2.45：镜号重排改 bulkPatch——原来 runSerial 在循环里先改内存再写云，部分失败会留下镜号不一致
     却照样报「已移动」；bulkPatch 一次性合并内存 + 串行写云 + 失败进 bulkFail（首页可重试），内存始终一致。 */
  var ups = arr.map(function(s){ return { id: s._id, obj: { 镜号: s['镜号'], 更新时间: nowStr() } }; });
  bulkPatch(ups);
  toast('已移动，镜号已重排');
}
function dupShot(id){
  var s = shotById(id); if(!s) return;
  pushUndo();
  var o = Object.assign({}, s), arr = sortedShots(), idx = -1;
  arr.forEach(function(x, k){ if(x._id === id) idx = k; });
  renumber(arr);
  o['镜号'] = (idx >= 0 ? idx + 2 : arr.length + 1);
  o['图片状态'] = '未生成'; o['视频状态'] = '未生成'; o['配音状态'] = '未生成';
  o['图片URL'] = ''; o['视频URL'] = ''; o['音频URL'] = ''; o['任务ID'] = ''; o['满意锁定'] = '否';
  o['更新时间'] = nowStr();
  /* v2.45：重排镜号改 bulkPatch——先等重排云写全部完成，再插入复制镜，
     避免 addShotObj 的 loadShots 在重排写云前读到旧镜号造成镜号重复。 */
  var ups = arr.filter(function(x){ return num(x['镜号']) >= o['镜号']; })
    .map(function(x){ return { id: x._id, obj: { 镜号: num(x['镜号']) + 1, 更新时间: nowStr() } }; });
  bulkPatch(ups).then(function(){
    addShotObj(o);
    toast('已复制该镜（生成状态已重置）');
  });
}
function insertShotAfter(id){
  var arr = sortedShots(), idx = -1;
  arr.forEach(function(x, k){ if(x._id === id) idx = k; });
  pushUndo();
  renumber(arr);
  var no = idx >= 0 ? idx + 2 : arr.length + 1;
  /* v2.45：重排镜号改 bulkPatch，逻辑同 dupShot——先等重排云写完成，再插入空镜，避免镜号重复。 */
  var ups = arr.filter(function(x){ return num(x['镜号']) >= no; })
    .map(function(x){ return { id: x._id, obj: { 镜号: num(x['镜号']) + 1, 更新时间: nowStr() } }; });
  bulkPatch(ups).then(function(){
    addShotObj({ 镜号:no, 画面描述:'', 英文提示词:'', 运镜:'', 台词旁白:'', 时长秒:num($('shotSec') ? $('shotSec').value : 0) || 5,
      出场角色:'', 场景:'', 景别:'中景', 说话角色:'', 角色情绪:'',
      图片状态:'未生成', 视频状态:'未生成', 配音状态:'未生成', 满意锁定:'否',
      口型风险:'低', 口型状态:'不需要', 图片URL:'', 视频URL:'', 音频URL:'', 音频时长:0, 任务ID:'', 错误信息:'', 更新时间:nowStr() });
    toast('已在该镜后插入空镜');
  });
}

/* ---------- 风格预设库（对标 moyin-creator 一键视觉风格切换） ---------- */
var STYLE_PRESETS = [
  { n:'写实电影感', style:'现代都市写实，电影级质感',
    pre:'cinematic live-action still, realistic film grain, shallow depth of field, anamorphic lens, dramatic lighting,',
    neg:'anime style, illustration, 3d render, cartoon, painting, oversaturated' },
  { n:'国风古装', style:'中国古装，东方美学',
    pre:'chinese ancient costume drama still, cinematic eastern aesthetics, soft natural light, intricate hanfu embroidery,',
    neg:'modern clothing, western architecture, sci-fi, neon, anime' },
  { n:'日系动画', style:'日式二维动画番剧',
    pre:'japanese anime key visual, clean line art, cel shading, soft pastel palette, detailed background art,',
    neg:'photorealistic, live action, heavy noise, deformed face' },
  { n:'3D 动画', style:'三维动画电影',
    pre:'pixar-style 3d animation film still, soft global illumination, stylized characters, subsurface scattering,',
    neg:'2d flat art, sketch, realistic photo, harsh shadows' },
  { n:'水墨国漫', style:'水墨风国漫',
    pre:'chinese ink wash painting style, expressive brush strokes, monochrome with subtle color accents, xuan paper texture,',
    neg:'photorealistic, neon, cyberpunk, heavy saturation' },
  { n:'赛博朋克', style:'赛博朋克科幻',
    pre:'cyberpunk sci-fi still, neon glow, rain-slicked streets, volumetric fog, high contrast teal and magenta,',
    neg:'pastoral, ancient costume, watercolor, low contrast' },
  { n:'黑白悬疑', style:'黑白悬疑犯罪',
    pre:'black and white noir film still, hard chiaroscuro lighting, venetian blind shadows, high contrast monochrome,',
    neg:'color, bright cheerful, anime, pastel' },
  { n:'青春校园', style:'青春校园清新',
    pre:'youth campus drama still, bright natural daylight, fresh airy color grading, soft lens flare,',
    neg:'dark gritty, horror, cyberpunk, heavy grain' }
];
function renderStylePresets(){
  var box = $('stylePresets');
  if(!box) return;
  box.innerHTML = STYLE_PRESETS.map(function(p){
    var on = cfg.stylePreset === p.n;
    return '<button class="btn gh sm" data-style="'+esc(p.n)+'" style="'+(on ? 'border-color:var(--pri);color:var(--pri)' : '')+'">'+esc(p.n)+'</button>';
  }).join('');
}
function applyStylePreset(name){
  var p = null;
  STYLE_PRESETS.forEach(function(x){ if(x.n === name) p = x; });
  if(!p) return;
  cfg.stylePreset = p.n;
  cfg.prefix = p.pre;
  cfg.neg = p.neg;
  var st = $('shotStyle'); if(st) st.value = p.style;
  /* v2.18：顺手把设置里的「前缀 / 负向词」输入框也同步——以前只改了 cfg，输入框还显示旧值，
     下次一保存设置就把 cfg 又覆盖回旧值，等于白切。 */
  if($('cf_prefix')) $('cf_prefix').value = cfg.prefix;
  if($('cf_neg')) $('cf_neg').value = cfg.neg;
  saveCfg(); renderStylePresets();
  if(typeof updGenreStyleHint === 'function') updGenreStyleHint();
  toast('已切换到「' + p.n + '」风格：画风、提示词前缀、负向词均已更新');
}
/* v2.18：把当前剧集类型对应的画风预设一键套上（类型变了却忘了换画风时尤其有用） */
function applyGenreStyle(){
  var bdl = genreBundle();
  if(!bdl){ toast('「' + genreLabel() + '」不指定固定套餐，请手动选一套风格预设'); return; }
  var p = null; STYLE_PRESETS.forEach(function(x){ if(x.n === bdl.style) p = x; });
  if(!p){ toast('没有找到与「' + genreLabel() + '」匹配的画风预设'); return; }
  /* v2.19：会同时覆盖画风 / 前缀 / 负向词 / 全局画风令牌，先问一声，避免措手不及 */
  askConfirm('按「' + genreLabel() + '」套用整套配置：画风预设 →「' + bdl.style + '」；' +
    '全局画风令牌 →「' + bdl.globalStyle + '」；并开启「类型写进提示词」。' +
    '这会覆盖你当前的画风 / 前缀 / 负向词设置，确定？', '套用')
    .then(function(ok){
      if(!ok) return;
      applyStylePreset(bdl.style);            /* 内部会同步输入框并 saveCfg */
      cfg.globalStyle = bdl.globalStyle;
      if($('cf_globalStyle')) $('cf_globalStyle').value = bdl.globalStyle;
      cfg.genrePrompt = true;
      if($('cf_genrePrompt')) $('cf_genrePrompt').checked = true;
      saveCfg(); updGenreStyleHint();
      toast('已按「' + genreLabel() + '」套用整套配置（画风 + 全局画风令牌 + 提示词注入）');
    });
}
/* v2.18：把「当前类型建议哪套画风 / 是否已套用」显示在类型选择旁，用户不用猜 */
/* 设置面板是「点保存才写 cfg」，所以提示要读控件的当前值，不能只读 cfg（v2.18 的 selGenre 同理） */
function curGlobalStyle(){
  var el = $('cf_globalStyle');
  return el ? String(el.value || '').trim() : String((cfg && cfg.globalStyle) || '');
}
/* v2.20：套餐从「内置三套 + 只能用类型触发」升级为「可编辑的多套」——
   用户可以把调好的配方（画风预设 + 全局令牌 + 是否注入提示词）存成自己的套餐，
   下次不必从零再配一遍。内置三套仍按类型自动推荐，自定义的以星标图标标注。 */
function genrePresets(){
  if(!Array.isArray(cfg.genrePresets)) cfg.genrePresets = [];
  return cfg.genrePresets;
}
function genrePresetList(){
  var out = [];
  ['modern', 'costume', 'anime'].forEach(function(g){
    if(GENRE_BUNDLE[g]) out.push({ n: GENRE_LABEL[g] || g, style: GENRE_BUNDLE[g].style, globalStyle: GENRE_BUNDLE[g].globalStyle, prompt: true, builtin: g });
  });
  genrePresets().forEach(function(p, i){
    out.push({ n: p.n || ('配方 ' + (i + 1)), style: p.style || '', globalStyle: p.globalStyle || '', prompt: p.prompt !== false, custom: i });
  });
  return out;
}
function renderGenrePresets(){
  var box = $('genrePresets'), hint = $('genrePresetsHint');
  if(!box) return;
  var arr = genrePresetList(), mine = genrePresets().length;
  if(hint) hint.textContent = '共 ' + arr.length + ' 套（内置 3 套 + 你自己存的 ' + mine + ' 套）；点名称即套用' + (mine ? '，自定义的可点 × 删除' : '');
  box.innerHTML = arr.map(function(p, i){
    var tip = p.style + (p.globalStyle ? ' ｜ ' + p.globalStyle : '') + (p.prompt ? ' ｜ 注入提示词' : ' ｜ 不注入');
    return '<button class="btn gh sm" data-act="guse" data-i="' + i + '" title="' + esc(tip) + '">' + esc(p.n) + (p.custom != null ? ' ' + svgIc('star',12) : '') + '</button>' +
      (p.custom != null ? '<button class="btn gh sm" data-act="gdel" data-i="' + i + '" title="删除该自定义套餐">×</button>' : '');
  }).join('');
}
function applyGenrePreset(i){
  var p = genrePresetList()[num(i)];
  if(!p) return;
  var cur = curGlobalStyle();
  askConfirm('套用套餐「' + p.n + '」：画风预设 →「' + p.style + '」；全局画风令牌 →「' + (p.globalStyle || '（清空）') + '」；' +
    (p.prompt ? '并开启' : '并关闭') + '「类型写进提示词」。会覆盖你当前的画风 / 前缀 / 负向词' +
    (cur ? '（当前令牌：' + cur + '）' : '') + '，确定？', '套用')
    .then(function(ok){
      if(!ok) return;
      applyStylePreset(p.style);
      cfg.globalStyle = p.globalStyle || '';
      if($('cf_globalStyle')) $('cf_globalStyle').value = cfg.globalStyle;
      cfg.genrePrompt = !!p.prompt;
      if($('cf_genrePrompt')) $('cf_genrePrompt').checked = !!p.prompt;
      saveCfg(); updGenreStyleHint(); renderGenrePresets();
      toast('已套用套餐「' + p.n + '」');
    });
}
function saveGenrePreset(){
  var style = (cfg && cfg.stylePreset) || '';
  if(!style){ toast('先在风格库里挑一套画风（或按类型套用一次），再存为套餐'); return; }
  var gs = curGlobalStyle();
  var pr = $('cf_genrePrompt') ? !!$('cf_genrePrompt').checked : (cfg.genrePrompt !== false);
  askInput('把当前这套配置（画风「' + style + '」' + (gs ? ' + 全局令牌' : '') + '）存成套餐，起个名字：', genreLabel() + ' 配方')
    .then(function(name){
      if(!name) return;
      var arr = genrePresets(), i;
      for(i = 0; i < arr.length; i++){
        if(arr[i].n === name){ arr[i].style = style; arr[i].globalStyle = gs; arr[i].prompt = pr; saveCfg(); renderGenrePresets(); toast('已更新套餐「' + name + '」'); return; }
      }
      arr.push({ n: name, style: style, globalStyle: gs, prompt: pr });
      saveCfg(); renderGenrePresets();
      toast('已存为自定义套餐「' + name + '」');
    });
}
function delGenrePreset(i){
  var p = genrePresetList()[num(i)];
  if(!p || p.custom == null) return;   /* 内置套餐不给删，避免把类型联动弄没了 */
  var arr = genrePresets();
  if(!arr[p.custom]) return;
  var nm = arr[p.custom].n || '';
  arr.splice(p.custom, 1);
  saveCfg(); renderGenrePresets();
  toast('已删除自定义套餐「' + nm + '」');
}
function updGenreStyleHint(){
  var el = $('genreStyleHint'); if(!el) return;
  var bdl = genreBundle(), cur = (cfg && cfg.stylePreset) || '';
  if(!bdl){ el.textContent = '「自动」不限固定套餐，可手动挑一套画风预设'; return; }
  var applied = (cur === bdl.style) && (curGlobalStyle() === bdl.globalStyle);
  el.textContent = '建议套餐：画风「' + bdl.style + '」+ 全局画风令牌' + (applied ? '（已套用）' : '');
}
/* v2.22：类型套餐的导出 / 导入——换设备、发给同事共用一套调好的配方时，不必重新手配一遍。
   导出成 JSON 文本；导入时同名覆盖、新名追加，内置三套（代码内置）不受影响、也不会被覆盖。 */
function exportGenrePresets(){
  var arr = genrePresets();
  if(!arr.length){ toast('还没有自定义套餐可导出（内置三套是代码内置的，无需导出）'); return; }
  var obj = { app: 'novel-to-drama-studio', kind: 'genrePresets', version: 1, exportedAt: nowStr(), presets: arr };
  download('类型套餐_' + nowStr().replace(/[: ]/g, '-') + '.json', JSON.stringify(obj, null, 2), 'application/json;charset=utf-8');
  toast('已导出 ' + arr.length + ' 套自定义套餐（JSON）');
}
/* 纯函数：校验并合并导入的套餐（接受「裸数组」或「导出文件对象」两种形态）。
   返回 {ok, added, updated, bad, msg} —— 便于测试，也让 UI 能把结果说清楚。 */
function mergeGenrePresets(raw){
  var list = null;
  if(Array.isArray(raw)) list = raw;
  else if(raw && Array.isArray(raw.presets)) list = raw.presets;
  if(!list) return { ok:false, msg:'不是有效的套餐文件（缺少 presets 数组）', added:0, updated:0, bad:0 };
  var arr = genrePresets(), added = 0, updated = 0, bad = 0;
  list.forEach(function(p){
    if(!p || typeof p !== 'object'){ bad++; return; }
    var n = String(p.n == null ? '' : p.n).trim();
    if(!n){ bad++; return; }
    var item = { n:n, style:String(p.style == null ? '' : p.style), globalStyle:String(p.globalStyle == null ? '' : p.globalStyle), prompt: p.prompt !== false };
    var hit = -1, i;
    for(i = 0; i < arr.length; i++){ if(arr[i].n === n){ hit = i; break; } }
    if(hit > -1){ arr[hit] = item; updated++; } else { arr.push(item); added++; }
  });
  if(added || updated) saveCfg();
  return { ok:true, added:added, updated:updated, bad:bad, msg:'' };
}
function importGenrePresetsText(txt){
  var raw = null;
  try{ raw = JSON.parse(String(txt == null ? '' : txt)); }catch(e){ toast('导入失败：不是合法的 JSON 文本'); return; }
  var r = mergeGenrePresets(raw);
  if(!r.ok){ toast('导入失败：' + r.msg); return; }
  renderGenrePresets();
  toast(r.added || r.updated
    ? ('导入完成：新增 ' + r.added + ' 套、更新 ' + r.updated + ' 套' + (r.bad ? ('，忽略无效 ' + r.bad + ' 条') : ''))
    : '文件里没有可导入的套餐（可能都是空数据）');
}
function importGenrePresets(){ if($('fileGenreJson')) $('fileGenreJson').click(); }

/* ---------- 导出剪辑时间线 FCPXML（PR / 达芬奇 / Final Cut 可直接导入） ----------
   说明：本文件按「先跑一次 render.sh 把各镜视频落盘成 seg_1.mp4…」的目录结构引用本地文件，
   所以不依赖公网 URL 也能正常剪辑、调速、加特效。 */
function xmlEsc(t){
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fcpDur(sec, fps){ return Math.max(1, Math.round(num(sec) * fps)) + '/' + fps + 's'; }
/* ================= v2.49：导出剪映草稿（draft_content.json + draft_meta_info.json） =================
   与「打包 / 成片预览」同一套范围与筛选（viewShots(exportScopeShots(), cfg.bundleStatus||'all','')），
   生成剪映专业版草稿包（zip）：视频轨（视频优先 → 静帧图片 → 空占位）+ 音频轨（逐镜配音 URL）+ 文本轨
   （复用 buildSrtText 时间轴，与导出 .srt 完全一致）。时间单位微秒（1s = 1e6）。
   因在线 / 浏览器内媒体无法直接给剪映本地路径，导入后若提示媒体丢失，可先用「一键合成包」把素材下到本地
   再「重新链接媒体」；时间轴与字幕已是完整的。 */
function jyId(){
  var h = '0123456789ABCDEF', s = '';
  for(var i=0;i<8;i++) s += h[Math.floor(Math.random()*16)];
  return 'JY' + s + '-' + Date.now().toString(16).toUpperCase() + '-' + Math.floor(Math.random()*65536).toString(16).toUpperCase();
}
function jyMicro(sec){ return Math.max(0, Math.round((num(sec)||0) * 1000000)); }
function jyCrop(){ return { lower_left_x:0.0, lower_left_y:1.0, lower_right_x:1.0, lower_right_y:1.0,
  upper_left_x:0.0, upper_left_y:0.0, upper_right_x:1.0, upper_right_y:0.0, crop_ratio:'free', crop_scale:1.0 }; }
function jyClip(){ return { alpha:1.0, flip:{ horizontal:false, vertical:false }, rotation:0.0, scale:{ x:1.0, y:1.0 }, transform:{ x:0.0, y:0.0 } }; }
function jyHexRgb01(hex){
  var h = String(hex || 'FFFFFF').replace(/^#/, '');
  var r = parseInt(h.slice(0,2),16)/255, g = parseInt(h.slice(2,4),16)/255, b = parseInt(h.slice(4,6),16)/255;
  if(isNaN(r)||isNaN(g)||isNaN(b)) return [1.0,1.0,1.0];
  return [Math.round(r*1000)/1000, Math.round(g*1000)/1000, Math.round(b*1000)/1000];
}
function jyTextContent(txt, size, colorRGB){
  var o = { text: txt, styles: [ { fill: { content: { solid: { color: colorRGB || [1.0,1.0,1.0] } } },
    range: [0, String(txt).length], size: num(size) || 8.0, bold: !!cfg.subBold,
    font: { path: '', id: '' },
    strokes: [ { content: { solid: { color: [0.0,0.0,0.0] } }, width: 0.08 } ] } ] };
  return JSON.stringify(o);
}
function exportJianyingDraft(){
  if(!state.shots.length){ toast('还没有分镜'); return; }
  var list = viewShots(exportScopeShots(), cfg.bundleStatus || 'all', '') || [];
  if(!list.length){ toast('当前范围 / 筛选下没有镜头'); return; }
  var fps = num(cfg.fps) || 30;
  var rr = String(cfg.imgRatio || '9:16').split(':');
  var vw = (num(rr[1])||16) > (num(rr[0])||9) ? 720 : 1280;
  var vh = Math.round(vw * (num(rr[1])||16) / (num(rr[0])||9) / 2) * 2;

  var mats = { videos:[], audios:[], texts:[], speeds:[], canvases:[], sound_channel_mappings:[], vocal_separations:[], material_animations:[] };
  var vTrack = { id: jyId(), type:'video', attribute:0, is_default_name:true, name:'', segments:[] };
  var aTrack = { id: jyId(), type:'audio', attribute:0, is_default_name:true, name:'', segments:[] };
  var tTrack = { id: jyId(), type:'text',  attribute:0, is_default_name:true, name:'', segments:[] };
  var t = 0, nV = 0, nA = 0;

  list.forEach(function(s, idx){
    var dM = jyMicro(shotDur(s)), startM = jyMicro(t);
    var urlV = String(s['口型视频URL'] || s['视频URL'] || '').trim();
    var urlI = String(s['图片URL'] || '').trim();
    var mtype = urlV ? 'video' : 'photo';
    var vmid = jyId();
    mats.videos.push({ id: vmid, type: mtype, path: (urlV || urlI || ''), material_name: '第' + s['镜号'] + '镜',
      width: vw, height: vh, duration: dM, has_audio: !!urlV, category_name:'local', check_flag: 63487,
      crop: jyCrop(), crop_ratio:'free', crop_scale:1.0, audio_fade: null, extra_type_option: 0 });
    var spId = jyId(), scmId = jyId(), vsId = jyId(), cvId = jyId();
    mats.speeds.push({ id: spId, type:'speed', curve_speed: null, mode: 0, speed: 1.0 });
    mats.sound_channel_mappings.push({ id: scmId, type:'none', audio_channel_mapping: 0, is_config_open:false });
    mats.vocal_separations.push({ id: vsId, type:'vocal_separation', choice: 0, production_path:'', removed_sounds: [] });
    mats.canvases.push({ id: cvId, type:'canvas_color', album_image:'', blur:0.0, color:'', image:'', image_id:'', image_name:'' });
    vTrack.segments.push({ id: jyId(), material_id: vmid,
      target_timerange:{ start:startM, duration:dM }, source_timerange:{ start:0, duration:dM },
      speed:1.0, volume:1.0, visible:true, reverse:false, clip: jyClip(),
      render_index: idx, track_render_index: 0, extra_material_refs: [spId, scmId, vsId, cvId],
      uniform_scale:{ on:true, value:1.0 }, cartoon:false, intensifies_audio:false, is_placeholder:false,
      is_tone_modify:false, last_nonzero_volume:1.0, template_id:'', template_scene:'default', track_attribute:0,
      enable_adjust:true, enable_color_curves:true, enable_color_wheels:true, enable_lut:true, enable_smart_color_adjust:false });
    nV++;
    var urlA = String(s['音频URL'] || '').trim();
    if(urlA && urlA !== 'local'){
      var amid = jyId(), aspId = jyId();
      mats.audios.push({ id: amid, type:'extract_music', path: urlA, name: '第' + s['镜号'] + '镜配音',
        duration: dM, category_name:'local', check_flag: 1, wave_points: [] });
      mats.speeds.push({ id: aspId, type:'speed', curve_speed: null, mode: 0, speed: 1.0 });
      aTrack.segments.push({ id: jyId(), material_id: amid,
        target_timerange:{ start:startM, duration:dM }, source_timerange:{ start:0, duration:dM },
        speed:1.0, volume:1.0, visible:true, clip: null, render_index: idx, track_render_index: 1,
        extra_material_refs: [aspId], cartoon:false, intensifies_audio:false, is_placeholder:false,
        is_tone_modify:false, last_nonzero_volume:1.0, reverse:false, template_id:'', template_scene:'default', track_attribute:0 });
      nA++;
    }
    t += shotDur(s);
  });

  var srt = buildSrtText(list);
  var cues = srt ? parseSrt(srt.text) : [];
  var fSize = Math.max(8, Math.min(48, num(cfg.subSize) || 14));
  var fColor = jyHexRgb01(cfg.subColor);
  cues.forEach(function(c, i){
    var tmid = jyId(), am = jyId();
    var cd = Math.max(0.1, c.t1 - c.t0);
    mats.texts.push({ id: tmid, type:'subtitle', content: jyTextContent(c.text, fSize, fColor),
      text_size: fSize, text_color:'#FFFFFF', alignment: 1, background_color:'', letter_spacing: 0, line_spacing: 0.02,
      fonts: [], force_apply_line_max_width:false, global_alpha:1.0, layout:0, line_feed:1, original_size:[vw,vh],
      preset_id:'', preset_name:'', sub_type:0, text_alpha:1.0, text_align:1, typesetting:0, underline:false,
      words:{ text:[], start_time:[], end_time:[] }, rich_text:'' });
    mats.material_animations.push({ id: am, type:'text_animation', animations: [], multi_language_current:'none' });
    tTrack.segments.push({ id: jyId(), material_id: tmid,
      target_timerange:{ start: jyMicro(c.t0), duration: jyMicro(cd) }, source_timerange:{ start:0, duration: jyMicro(cd) },
      speed:1.0, volume:1.0, visible:true, clip: jyClip(), render_index: 30000 + i, track_render_index: 2,
      extra_material_refs: [am], cartoon:false, intensifies_audio:false, is_placeholder:false, is_tone_modify:false,
      last_nonzero_volume:1.0, reverse:false, template_id:'', template_scene:'default', track_attribute:0 });
  });

  var draftId = jyId();
  var name = '短剧成片_' + String(nowStr()).replace(/[^0-9]/g,'').slice(0,14);
  var plat = { app_id:3704, app_source:'lv', app_version:'5.9.0', device_id:'', hard_disk_id:'', mac_address:'', os:'windows', os_version:'' };
  var content = {
    canvas_config:{ width: vw, height: vh, ratio:'original' },
    color_space: 0,
    config:{ maintrack_adsorb:true, video_mute:false, subtitle_sync:false, lyrics_sync:false, material_save_mode:0 },
    cover: null, create_time: 0, duration: jyMicro(t), fps: fps, id: draftId,
    keyframes:{ adjusts:[], audios:[], effects:[], filters:[], handwrites:[], stickers:[], texts:[], videos:[] },
    last_modified_platform: plat, materials: mats, name: name, new_version:'110.0.0', platform: plat,
    relationships:[], render_index_track_mode_on:false, source:'default',
    tracks: [vTrack, aTrack, tTrack], version: 360000
  };
  var meta = {
    draft_cloud_last_action_download:false, draft_cover:'draft_cover.jpg', draft_id: draftId, draft_name: name,
    draft_fold_path:'', draft_root_path:'', draft_is_cloud_draft:false, draft_is_ai_shorts:false,
    draft_materials:[ { type:0, value:[] }, { type:1, value:[] }, { type:2, value:[] } ],
    draft_materials_copied_info:[], draft_segment_extra_info:[], draft_timeline_materials_size_:0, draft_type:'',
    draft_need_rename_folder:false, draft_new_version:'', draft_removable_storage_device:'', draft_watermark_path:'',
    draft_enterprise_info:{ draft_enterprise_extra:'', draft_enterprise_id:'', draft_enterprise_name:'', enterprise_draft_material_id:'' },
    tm_draft_create: Date.now()*1000, tm_draft_modified: Date.now()*1000, tm_draft_removed:0, tm_duration:0
  };
  var readme = [
    '剪映草稿（' + name + '）',
    '==================================================',
    '本 zip 含 draft_content.json 与 draft_meta_info.json，对应「导出范围 + 状态筛选」下的 ' + nV + ' 个镜头。',
    '',
    '【如何导入剪映专业版】',
    '1) 解压本 zip 到一个文件夹（文件夹名随意，如 ' + name + '）。',
    '2) 把整个文件夹放进剪映的草稿目录：',
    '   Windows: C:/Users/<你>/AppData/Local/JianyingPro/User Data/Projects/com.lveditor.draft/',
    '   macOS:   ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/',
    '3) 重启剪映，在「本地草稿」里就能看到它。',
    '',
    '【关于素材】',
    '时间轴（视频轨 / 音频轨）与字幕轨已完整，字幕时间与导出 .srt 完全一致。',
    '本工作台的素材多为在线地址或浏览器内音频，剪映需要本地文件路径；导入后若提示「媒体丢失」：',
    '   - 先用「一键合成包（FFmpeg 脚本）」把镜头素材下载到本地；',
    '   - 在剪映里对丢失片段右键「重新链接媒体」指向本地文件即可。',
    '字幕无需重新链接，可直接使用（也可用导出的 .srt 覆盖）。',
    '',
    '本次导出：视频轨 ' + nV + ' 段 · 音频轨 ' + nA + ' 段 · 字幕 ' + cues.length + ' 条 · 总时长 ' + fmtSec(Math.round(t)) + '。'
  ].join('\r\n');
  downloadZip('剪映草稿_' + name + '.zip', [
    { name: 'draft_content.json', data: JSON.stringify(content) },
    { name: 'draft_meta_info.json', data: JSON.stringify(meta) },
    { name: 'README.txt', data: readme }
  ]);
  toast('剪映草稿已导出：视频轨 ' + nV + ' 段 / 配音 ' + nA + ' 条 / 字幕 ' + cues.length + ' 条');
}
function exportFcpXml(){
  if(!state.shots.length){ toast('还没有分镜'); return; }
  var fps = num(cfg.fps) || 30;
  var r = String(cfg.imgRatio || '9:16').split(':');
  var vw = (num(r[1]) || 16) > (num(r[0]) || 9) ? 720 : 1280;
  var vh = Math.round(vw * (num(r[1]) || 16) / (num(r[0]) || 9) / 2) * 2;
  var list = sortedShots();
  var ridx = assignRenderIdx(list);            /* seg 段号：与 render.sh 落盘文件名同口径 */
  /* 只对有视频的镜头做紧密排布；无视频（还没生成/失败）的镜头不占时间轴，
     这样导入后镜头是紧挨着的，再单独补那几镜即可 */
  var placed = [];
  var cursor = 0;
  list.forEach(function(s){
    if(String(s['口型视频URL'] || s['视频URL'] || '').trim()){
      s._placeOff = cursor;
      placed.push(s);
      cursor += shotDur(s);
    } else {
      s._placeOff = -1;
    }
  });

  var res = [], clips = [], n = 0, skipped = [];
  res.push('<format id="r0" name="FFVideoFormat' + vh + 'p' + fps + '" frameDuration="1/' + fps + 's" width="' + vw + '" height="' + vh + '" colorSpace="1-1-1 (Rec. 709)"/>');
  var totalFrames = 0;
  var placedSec = 0;
  list.forEach(function(s, i){
    var url = String(s['口型视频URL'] || s['视频URL'] || '').trim();
    var d = shotDur(s);
    if(!url){ skipped.push(s['镜号']); return; }        /* 没视频的镜头不进时间线，避免导入报错 */
    n++;
    placedSec += d;
    totalFrames = Math.max(totalFrames, Math.round((s._placeOff + d) * fps));
    var aid = 'a' + n;
    var file = 'seg_' + padSeg(ridx[s._id]) + '.mp4';   /* 与 render.sh 落盘的文件名一致（v2.7 统一段号） */
    res.push('<asset id="' + aid + '" name="shot' + xmlEsc(s['镜号']) + '" uid="shot-' + xmlEsc(s._id) + '" start="0s" duration="' + fcpDur(d, fps) + '" hasVideo="1" hasAudio="1" format="r0">' +
      '<media-rep kind="original-media" src="file://./' + file + '" srcUrl="' + xmlEsc(url) + '"/>' +
      '</asset>');
    var note = String(s['台词旁白'] || '').trim();
    /* offset 从真正的时间线 0 帧开始，不能用 fcpDur（它最小是 1 帧会让首镜后移 1 帧） */
    var offFrame = Math.round(s._placeOff * fps);
    var offStr = offFrame + '/' + fps + 's';
    clips.push('<asset-clip ref="' + aid + '" offset="' + offStr + '" name="第' + xmlEsc(s['镜号']) + '镜 ' + xmlEsc(String(s['画面描述'] || '').slice(0, 20)) + '" start="0s" duration="' + fcpDur(d, fps) + '" format="r0" tcFormat="NDF">' +
      (note ? '<note>' + xmlEsc(note) + '</note>' : '') +
      '<adjust-volume amount="0dB"/>' +
      '</asset-clip>');
  });
  if(!n){ toast('还没有任何镜头生成了视频，无法导出时间线'); return; }
  totalFrames = Math.max(1, totalFrames);

  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n' +
    '<fcpxml version="1.9">\n  <resources>\n    ' + res.join('\n    ') + '\n  </resources>\n' +
    '  <library location="file://./">\n    <event name="短剧素材">\n      <project name="成片">\n' +
    '        <sequence format="r0" duration="' + totalFrames + '/' + fps + 's" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n' +
    '          <spine>\n            ' + (clips.join('\n            ') || '') + '\n          </spine>\n' +
    '        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n';

  download('成片时间线.fcpxml', xml, 'application/xml;charset=utf-8');
  toast('时间线已导出（' + n + ' 个镜头，' + fmtSec(Math.round(placedSec)) + '）' +
        (skipped.length ? '，第 ' + skipped.join('/') + ' 镜无视频已跳过' : ''));
}

