/* ================= 分支功能：儿童睡前故事 =================
 * 流程：主题 →（LLM）生成结构化故事 → 逐页生图（绘本插画）→ 逐页有感情 TTS 旁白
 *       （独立保存/可下载）→ 组装短视频（服务端 agnes video + 浏览器内幻灯片预览兜底）。
 * 复用现有 AI 抽象：apiPost / apiPostAgnes / apiPostTts / buildTtsBody / audSave / audUrl / pickVideoUrl。
 * 无 key 时走入「演示模式」：内置故事 + SVG 占位插画 + 浏览器朗读 + 占位 WAV，便于离线验证全链路。
 */
function initBedtimeState(){
  if(!state.bedtime) state.bedtime = newBedStoryObj('');
}
/* -------- 多故事模型（v2.57）：每个睡前故事独立存储，互不干扰 --------
 * 存储：LS+'bedlist'        → 故事索引 [{id,theme,title,updated}]（不含正文）
 *       LS+'bedstory_'+id   → 单个故事正文（含 pages/视频片段；不存 audB64，音频本体走 audSave）
 * 音频本体按 storyId 隔离：audKey(id+'_bed_'+i)，保证不同故事的同一页不会互相覆盖。
 * 下拉框在「儿童睡前故事生成器」右侧选择要编辑的故事；填写主题并生成＝新建一份独立故事。
 * 旧版单故事（LS+'bedtime'）在首次启动时自动迁移为第一条故事。 */
var bedtimeReady = false;
function newBedStoryObj(theme){
  return {
    id: 's_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
    theme: theme || '', title:'', pages:[], age:'5-8 岁', artStyle:'童话水彩绘本',
    voice:'', style:'温柔', ratio:'3:4', pagesN:6,
    charDesc:'', charRefURL:'', charRefErr:'',   /* v2.58：主角固定外观设定 + 角色设定图（插画一致性的锚） */
    /* v2.60：独立短视频分镜（参考小说转短剧管线：完整故事拆镜 + 每镜 5-12s + 运镜/环境声） */
    vshots:[], vshotSig:'', vidSec:6, vshotsN:0,
    status:'idle', videoURL:'', videoStatus:'', videoTaskId:'', videoErr:'',
    _cur:0, _playing:false, _moviePlaying:false, demo:false, mergedAudioURL:'', mergedCount:0
  };
}
function bedListLoad(){
  try{ var raw = localStorage.getItem(LS + 'bedlist'); if(!raw) return []; var o = JSON.parse(raw); return Array.isArray(o) ? o : []; }catch(e){ return []; }
}
function bedListSave(list){ try{ localStorage.setItem(LS + 'bedlist', JSON.stringify(list || [])); }catch(e){} }
function bedStoryKey(id){ return LS + 'bedstory_' + id; }
function bedAudKey(i){ return ((state.bedtime && state.bedtime.id) ? state.bedtime.id : 's') + '_bed_' + i; }
function addBedtimeToList(meta){
  var list = state.bedtimeList || [];
  if(!list.some(function(x){ return x.id === meta.id; })) list.push(meta);
  state.bedtimeList = list; bedListSave(list);
}
function safeParseBed(raw){ try{ var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : null; }catch(e){ return null; } }
function ensureBedtime(){
  var list = bedListLoad();
  if(!list.length){
    /* 迁移旧版单故事：LS+'bedtime' → 第一条故事，并把其音频从旧键 bed_<i> 迁到 新键 id+'_bed_'+i */
    var oldRaw = null; try{ oldRaw = localStorage.getItem(LS + 'bedtime'); }catch(e){}
    if(oldRaw){
      try{
        var o = JSON.parse(oldRaw); if(!o || !o.pages) throw 0;
        var id = 's_mig_' + Date.now();
        o.id = id;
        (o.pages || []).forEach(function(p, i){
          if(!p.audRemote){ try{ var a = audLoad('bed_' + i); if(a && a.b64) audSave(id + '_bed_' + i, a.b64, a.mime || 'audio/mpeg', 0); }catch(e){} }
        });
        list.push({ id:id, theme:o.theme || '', title:o.title || '', updated:Date.now() });
        bedListSave(list);
        try{ localStorage.setItem(bedStoryKey(id), oldRaw); }catch(e){}   /* 正文也要落盘，否则 loadBedtimeStory 读空 */
        try{ localStorage.removeItem(LS + 'bedtime'); }catch(e){}
      }catch(e){}
    }
  }
  if(!list.length){
    var ns = newBedStoryObj('');
    state.bedtime = ns; state.bedtimeId = ns.id;
    state.bedtimeList = [ { id:ns.id, theme:'', title:'', updated:Date.now() } ]; bedListSave(state.bedtimeList);
    populateBedInputs(ns);
    bedtimeReady = true; return;
  }
  state.bedtimeList = list;
  var cur = state.bedtimeId || (list[0] && list[0].id);
  if(!cur || !list.some(function(x){ return x.id === cur; })) cur = list[0].id;
  state.bedtimeId = cur;
  loadBedtimeStory(cur, true);
}
function loadBedtimeStory(id, initial){
  var raw = null; try{ raw = localStorage.getItem(bedStoryKey(id)); }catch(e){}
  var o = raw ? safeParseBed(raw) : null;
  if(!o) o = newBedStoryObj('');
  o.id = id;
  if(!Array.isArray(o.pages)) o.pages = [];
  o.pages = o.pages.map(function(p, i){
    var audURL = '';
    if(p.audRemote && p.audURL && p.audURL.indexOf('blob:') !== 0) audURL = p.audURL;
    return {
      text:p.text||'', imgPrompt:p.imgPrompt||'', imgURL:p.imgURL||'', audURL:audURL, audB64:'',
      audMime:p.audMime||'', audRemote:!!p.audRemote, imgErr:p.imgErr||'', audErr:p.audErr||'',
      clips: Array.isArray(p.clips) ? p.clips.slice() : []
    };
  });
  /* 本地音频按 storyId+'_bed_'+i 重新链接生成 blob URL（audSave 已存 base64） */
  o.pages.forEach(function(p, i){ if(!p.audRemote){ try{ var u = audUrl(id + '_bed_' + i); if(u) p.audURL = u; }catch(e){} } });
  /* 运行时态字段复位（这些不持久化） */
  o._cur = 0; o._playing = false; o._moviePlaying = false; o.demo = false;
  o.videoURL=''; o.videoStatus=''; o.videoTaskId=''; o.videoErr='';
  o.mergedAudioURL=''; o.mergedCount=0;
  /* v2.60：短视频分镜恢复。taskId/vstat 持久化是为了刷新后能恢复在途轮询（不重复提交）；
     运行锁/运行中标记一律复位。 */
  o.vshots = Array.isArray(o.vshots) ? o.vshots.map(function(v){
    var d = newBedVShot();
    return {
      no: num(v.no) || d.no, pageIdx: Math.max(0, num(v.pageIdx) || 0),
      scene: v.scene || '', prompt: v.prompt || '', camera: v.camera || '',
      amb: v.amb || '', narration: v.narration || '', shotSize: v.shotSize || '',
      seconds: bedVShotClampSec(num(v.seconds) || 6),
      vidURL: v.vidURL || '', vidErr: v.vidErr || '', taskId: v.taskId || '',
      vstat: v.vstat || '未生成'
    };
  }) : [];
  o.vshotSig = o.vshotSig || '';
  o.vidSec = bedVShotClampSec(num(o.vidSec) || 6);
  o.vshotsN = Math.max(0, num(o.vshotsN) || 0);
  o._genVidRunning = false; o._splitting = false;
  /* v2.58：角色一致性字段（charRefURL 是远程 URL，可持久化；刷新后继续作为每页插画的参考图） */
  o.charDesc = o.charDesc || ''; o.charRefURL = o.charRefURL || ''; o.charRefErr = '';
  state.bedtime = o;
  if(!initial) populateBedInputs(o);
  bedtimeReady = true;
  resumeBedVshotPolls();   /* v2.60：切故事/启动后恢复该故事在途的视频轮询（init 时 Key 未加载则会跳过，由 main.js 再调一次） */
}
function saveStoryData(bt){
  if(!bt || !bt.id) return;
  var hasData = (bt.pages && bt.pages.length) || bt.title || bt.theme;
  if(!hasData){ var ex = null; try{ ex = localStorage.getItem(bedStoryKey(bt.id)); }catch(e){} if(ex) return; }
  var payload = {
    id: bt.id, theme: bt.theme || '', title: bt.title || '',
    pagesN: bt.pagesN || 6, artStyle: bt.artStyle || '童话水彩绘本', voice: bt.voice || '',
    style: bt.style || '温柔', ratio: bt.ratio || '3:4', age: bt.age || '5-8 岁', status: bt.status || '',
    charDesc: bt.charDesc || '', charRefURL: bt.charRefURL || '',
    /* v2.60：短视频分镜（taskId/vstat 也落盘——刷新后据此恢复在途轮询，不重复提交） */
    vshotSig: bt.vshotSig || '', vidSec: bedVShotClampSec(num(bt.vidSec) || 6), vshotsN: Math.max(0, num(bt.vshotsN) || 0),
    vshots: (bt.vshots || []).map(function(v){
      return { no:v.no, pageIdx:v.pageIdx, scene:v.scene, prompt:v.prompt, camera:v.camera,
        amb:v.amb, narration:v.narration, shotSize:v.shotSize, seconds:bedVShotClampSec(num(v.seconds) || 6),
        vidURL:v.vidURL || '', vidErr:v.vidErr || '', taskId:v.taskId || '', vstat:v.vstat || '未生成' };
    }),
    pages: (bt.pages || []).map(function(p){
      var o = { text:p.text||'', imgPrompt:p.imgPrompt||'', imgURL:p.imgURL||'', imgErr:p.imgErr||'', audErr:p.audErr||'', audRemote:!!p.audRemote, audMime:p.audMime||'', clips:(p.clips||[]).slice() };
      if(p.audRemote && p.audURL && p.audURL.indexOf('blob:') !== 0) o.audURL = p.audURL;
      return o;
    })
  };
  lsSet(bedStoryKey(bt.id), JSON.stringify(payload), { warn:true, msg:'睡前故事本机保存失败（存储已满），请导出备份' });
  var list = state.bedtimeList || [];
  var found = false;
  list.forEach(function(x){ if(x.id === bt.id){ x.theme = bt.theme||''; x.title = bt.title||''; x.updated = Date.now(); found = true; } });
  if(!found) list.push({ id:bt.id, theme:bt.theme||'', title:bt.title||'', updated:Date.now() });
  state.bedtimeList = list; bedListSave(list);
}
function saveBedtime(){ if(!bedtimeReady) return; if(!state.bedtime || !state.bedtime.id) return; saveStoryData(state.bedtime); }
/* 适读年龄回填：旧故事存的「3-8 岁」等已下档选项 → 回落默认档，避免下拉显示空白 */
function bedAgeOpt(v){
  var sel = $('bed-age');
  if(!sel) return v || '5-8 岁';
  for(var i = 0; i < sel.options.length; i++){
    if(sel.options[i].value === v) return v;
  }
  return '5-8 岁';
}
function populateBedInputs(bt){
  bt = bt || state.bedtime || {};
  if($('bed-theme')) $('bed-theme').value = bt.theme || '';
  if($('bed-age')) $('bed-age').value = bedAgeOpt(bt.age);
  if($('bed-pages')) $('bed-pages').value = String(bt.pagesN || 6);
  if($('bed-art')) $('bed-art').value = bt.artStyle || '童话水彩绘本';
  if($('bed-ratio')) $('bed-ratio').value = bt.ratio || '3:4';
  if($('bed-voice')) $('bed-voice').value = bt.voice || '温柔女声';
  if($('bed-style')) $('bed-style').value = bt.style || '温柔';
}
function syncBedStorySelect(){
  var sel = $('bed-story-select'); if(!sel) return;
  var list = state.bedtimeList || [];
  var cur = state.bedtimeId || '';
  sel.innerHTML = '';
  if(!list.length){ var o0 = document.createElement('option'); o0.value=''; o0.textContent='（暂无，点＋新建）'; sel.appendChild(o0); return; }
  list.forEach(function(x){
    var o = document.createElement('option'); o.value = x.id;
    var label = (x.theme || x.title || '未命名故事');
    if(x.title && x.title !== label) label = x.title + '（' + (x.theme || '') + '）';
    o.textContent = label; sel.appendChild(o);
  });
  sel.value = cur;
}
function selectBedtimeStory(id){
  if(!id) return;
  saveBedtime();                                /* 先保存当前故事 */
  state.bedtimeId = id;
  loadBedtimeStory(id);
  bedStop();
  var stage = $('bed-stage'); if(stage){ stage.style.display='none'; stage.classList.remove('bed-full'); }
  renderBedtime();
  toast('已切换到：' + (state.bedtime.theme || state.bedtime.title || '未命名故事'));
}
function newBedtimeStory(){
  saveBedtime();
  var ns = newBedStoryObj('');
  state.bedtime = ns; state.bedtimeId = ns.id;
  addBedtimeToList({ id:ns.id, theme:'', title:'', updated:Date.now() });
  populateBedInputs(ns);
  var stage = $('bed-stage'); if(stage){ stage.style.display='none'; stage.classList.remove('bed-full'); }
  renderBedtime();
  if($('bed-theme')) $('bed-theme').focus();
  toast('已新建空白睡前故事，填写主题后点「① 生成故事」');
}
function delBedtimeStory(){
  var id = state.bedtimeId; if(!id) return;
  var label = (state.bedtime.theme || state.bedtime.title || '未命名故事');
  if(!confirm('确定删除当前睡前故事「' + label + '」？\n图片 / 音频 / 视频都将一并删除，且不可恢复。')) return;
  try{ localStorage.removeItem(bedStoryKey(id)); }catch(e){}
  (state.bedtime.pages || []).forEach(function(p, i){ try{ localStorage.removeItem(audKey(id + '_bed_' + i)); }catch(e){} });
  var list = (state.bedtimeList || []).filter(function(x){ return x.id !== id; });
  state.bedtimeList = list; bedListSave(list);
  if(!list.length){ var ns = newBedStoryObj(''); state.bedtime = ns; state.bedtimeId = ns.id; addBedtimeToList({ id:ns.id, theme:'', title:'', updated:Date.now() }); }
  else { state.bedtimeId = list[0].id; loadBedtimeStory(list[0].id); }
  populateBedInputs(state.bedtime);
  renderBedtime();
  toast('已删除睡前故事「' + label + '」');
}
function syncBedOpts(){
  var bt = state.bedtime;
  if($('bed-age')) bt.age = $('bed-age').value || '5-8 岁';
  if($('bed-pages')) bt.pagesN = Math.max(2, Math.min(20, num($('bed-pages').value) || 6));
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

/* 把 AudioBuffer 编码为 16-bit PCM WAV（多声道交织），用于「合成单音频」导出 */
function audioBufferToWav(buf){
  var numCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
  var chans = []; for(var c=0;c<numCh;c++) chans.push(buf.getChannelData(c));
  var inter = new Float32Array(len * numCh);
  for(var i=0;i<len;i++){ for(var c=0;c<numCh;c++) inter[i*numCh+c] = chans[c][i]; }
  var buffer = new ArrayBuffer(44 + inter.length * 2);
  var view = new DataView(buffer);
  function ws(off, s){ for(var i=0;i<s.length;i++) view.setUint8(off+i, s.charCodeAt(i)); }
  ws(0,'RIFF'); view.setUint32(4, 36 + inter.length*2, true); ws(8,'WAVE'); ws(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,numCh,true);
  view.setUint32(24,sr,true); view.setUint32(28,sr*numCh*2,true); view.setUint16(32,numCh*2,true); view.setUint16(34,16,true);
  ws(36,'data'); view.setUint32(40, inter.length*2, true);
  var off=44; for(var i=0;i<inter.length;i++){ var s=Math.max(-1,Math.min(1,inter[i])); view.setInt16(off, s<0?s*0x8000:s*0x7FFF, true); off+=2; }
  return buffer;
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
  return { title:title, character:'本故事的主角（' + (theme || '小熊') + '）：圆滚滚的可爱卡通小动物，大而圆的眼睛，柔和的暖色毛发，身穿柔软的星星图案睡衣', pages:pages };
}

/* -------- 各步骤 -------- */
function genBedtimeStory(){
  var theme0 = ($('bed-theme') ? $('bed-theme').value.trim() : '');
  if(!theme0){ toast('请先在上方填写故事主题'); return; }
  var cur = state.bedtime || newBedStoryObj('');
  /* 主题变了（或当前故事为空 / 无 id）→ 视为新建一份独立睡前故事；
     同主题且已有正文 → 在原故事上重新生成（继续编辑，不另起一份）。 */
  var needNew = (!cur.id) || (cur.pages && cur.pages.length && cur.theme !== theme0);
  if(needNew){
    var ns = newBedStoryObj(theme0);
    state.bedtime = ns; state.bedtimeId = ns.id;
    addBedtimeToList({ id:ns.id, theme:ns.theme, title:'', updated:Date.now() });
  }
  syncBedOpts();                               /* 读入表单到当前故事 */
  var bt = state.bedtime, target = bt;         /* target 固定指向本次要生成的故事，防生成期间切换串档 */
  if(cfg.textKey){
    var sys = '你是一个儿童睡前故事作家。根据用户的「主题」创作一个温柔、治愈、适合 5-8 岁儿童的睡前故事。'
      + '请只输出 JSON，格式：{"title":"故事标题","character":"主角的固定外观设定","pages":[{"text":"这一页的旁白文字（1-3 句，温暖简短）","imgPrompt":"这一页对应的绘本插画提示词（中文，描述画面、角色、氛围，不要含文字）"}]}。'
      + '「character」是整本绘本唯一的主角外观设定（20-60字）：写清物种/年龄/性别、发型发色、五官特点、服装款式与配色、标志性特征，所有页必须完全一致。'
      + '每页的 imgPrompt 只描述该页的场景、动作与氛围，严禁改写主角的外观、服装或配色（主角形象以 character 为准，始终保持同一形象）。'
      + '页数由用户指定。不要输出 JSON 以外的任何内容。';
    var user = '主题：' + theme0 + '\n适读年龄：' + (bt.age || '5-8 岁') + '\n页数：' + bt.pagesN
      + '\n画风：' + bt.artStyle + '\n情绪基调：' + bt.style;
    bt.status = '故事生成中…'; renderBedtime();
    apiPost(cfg.textBase.replace(/\/+$/, '') + '/chat/completions', cfg.textKey, { model:cfg.textModel, messages:[{ role:'system', content:sys }, { role:'user', content:user }] })
      .then(function(r){
        var j = parseJsonSafe(r.text);
        var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        var obj = parseStoryJson(c);
        if(!obj) throw new Error('无法解析故事 JSON：' + (r.text || '').slice(0, 160));
        applyStory(obj, target);
      })
      .catch(function(e){
        console.error(e); target.status = '故事生成失败'; saveStoryData(target);
        toast('故事生成失败：' + guessCorsMsg(e));
      });
  } else {
    applyStory(bedtimeDemoStory(theme0), target);
    toast('未配置文本模型，使用演示故事（演示模式）');
  }
}
function applyStory(obj, target){
  var bt = target || state.bedtime;
  bt.title = obj.title || bt.theme || '睡前故事';
  /* v2.58：主角外观设定整本统一；故事内容变了旧设定图作废（避免新故事顶着上一版的脸） */
  if(obj.character && String(obj.character).trim()) bt.charDesc = String(obj.character).trim();
  bt.charRefURL = ''; bt.charRefErr = '';
  bt.pages = (obj.pages || []).map(function(p){
    return { text:String(p.text || ''), imgPrompt:String(p.imgPrompt || p.text || ''), imgURL:'', audURL:'', audB64:'', audMime:'', audRemote:false, imgErr:'', audErr:'' };
  });
  /* v2.60：故事内容整体更换 → 旧分镜作废（要求按最新完整故事重新拆镜），下次点 ④ 自动重拆 */
  bt.vshots = []; bt.vshotSig = ''; bt.videoStatus = '';
  bt.status = '故事已生成（' + bt.pages.length + ' 页）';
  saveStoryData(bt);
  renderBedtime();
  toast('故事已生成：' + bt.pages.length + ' 页');
}
/* -------- v2.58：角色一致性（解决「每页独立绘制、人物形象不统一」） --------
 * 做法对齐主流程已验证的一致性体系（compute.js anchorsForShot + api.js buildImageBody）：
 *   ① 文字锚点：整本故事共用同一段主角外观设定 charDesc（LLM 生成故事时一并产出），
 *      每页插画提示词都注入「必须与参考图同一角色 / 外观以 charDesc 为准，禁止重新设计」；
 *   ② 图片参考：先花 1 张图生成「角色设定图」charRefURL，之后每一页插画都通过
 *      extra_body.image=[charRefURL] 把它作为参考图传给接口（主流程副图同款机制），
 *      模型有图可依，人物/服装/配色才不会每页重新抽卡；
 *   ③ 画风令牌：artStyle + 情绪每页固定注入，整本统一调性。 */
function bedCharDesc(){
  var bt = state.bedtime || {};
  if(bt.charDesc && String(bt.charDesc).trim()) return String(bt.charDesc).trim();
  var th = (bt.theme || '').trim();
  return th ? ('本故事的主角（' + th + '）的可爱卡通形象') : '本故事的可爱主角';
}
/* 每页插画提示词：角色锁（参考图 + 文字锚点）+ 本页场景动作 + 统一画风 */
function bedImgPrompt(p){
  var bt = state.bedtime || {};
  var parts = [];
  if(bt.charRefURL){
    parts.push('画面主角必须与参考图是同一个角色：保持完全相同的物种、年龄、发型发色、五官、服装款式与配色，'
      + '不要重新设计角色外观、不要更换衣服、不要改变体型；');
  }
  if(bt.charDesc && String(bt.charDesc).trim()) parts.push('主角外观设定（所有页统一）：' + bedCharDesc() + '。');
  parts.push('场景与动作：' + (p.imgPrompt || p.text || '') + '。');
  parts.push('画风（整本绘本统一）：' + (bt.artStyle || '童话水彩绘本') + '，氛围：' + (bt.style || '温柔')
    + '，儿童绘本插画，画面柔和温暖，不要出现任何文字。');
  return parts.join('');
}
/* 生成「角色设定图」：全书一致性的锚。失败时 resolve(false) 让后续插画退化为纯文字锚点，不中断流程 */
function genBedtimeCharRef(){
  var bt = state.bedtime, myId = bt.id;
  if(!bt.pages.length){ toast('请先生成故事'); return Promise.resolve(false); }
  if(!hasAgnesKey()){ toast('需要 Agnes Key 才能生成角色设定图（决定所有插画的人物一致性）'); return Promise.resolve(false); }
  if(guardBudget()) return Promise.resolve(false);
  if(bt._charRefRunning){ toast('角色设定图生成中，请稍候…'); return Promise.resolve(false); }
  bt._charRefRunning = true;
  bt.status = '角色设定图生成中（人物一致性的关键）…'; bt.charRefErr = ''; renderBedtime();
  return apiPostAgnes(cfg.agnesBase + '/images/generations', {
    model:(cfg.imgModel || 'agnes-image-2.5-flash'),
    prompt:'儿童绘本角色设定图（character reference sheet）：' + bedCharDesc() + '。'
      + '主角全身正面立绘，完整清晰展示发型、服装与配色，表情温柔安定，'
      + (bt.artStyle || '童话水彩绘本') + '风格，纯色柔和渐变背景，画面中不要出现任何文字。',
    size:cfg.imgSize || '1024x1024',
    ratio:bt.ratio || '3:4',
    extra_body:{ response_format:'url' }
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    var url = j && j.data && j.data[0] && (j.data[0].url || (j.data[0].b64_json ? 'data:image/png;base64,' + j.data[0].b64_json : ''));
    if(r.status >= 400 || !url){ var m = (j && (j.detail || j.message || j.error)) ? JSON.stringify(j.detail || j.message || j.error) : (r.text || '').slice(0,180); throw new Error('HTTP ' + r.status + ' ' + m); }
    if(state.bedtimeId !== myId) return false;
    bt.charRefURL = url; bt.charRefErr = '';
    bt.status = '角色设定图完成（后续插画都以它为参考，人物全程一致）';
    renderBedtime(); toast('角色设定图完成——每一页插画都会参考它，人物形象统一');
    return true;
  }).catch(function(e){
    console.error(e);
    if(state.bedtimeId === myId){
      bt.charRefErr = guessCorsMsg(e);
      bt.status = '角色设定图失败（' + bt.charRefErr + '），插画将仅用文字锚点';
      renderBedtime(); toast('角色设定图失败：' + bt.charRefErr + '（插画仍会按文字设定生成）');
    }
    return false;
  }).then(function(ok){ bt._charRefRunning = false; return ok; });
}
function genBedtimeImage(p, idx){
  var bt = state.bedtime;
  var body = {
    model:(cfg.imgModel || 'agnes-image-2.5-flash'),
    prompt: bedImgPrompt(p),
    size:cfg.imgSize || '1024x1024',
    ratio:bt.ratio || '3:4',
    extra_body:{ response_format:'url' }
  };
  /* 角色设定图作为参考图传入（主流程副图同款机制）：模型有图可依，人物才不漂移 */
  if(bt.charRefURL) body.extra_body.image = [bt.charRefURL];
  /* v2.62：插画提交补齐限流韧性——与 submitAgnesVideo 共用 isApiLimitErr/agnesErrMsg/
   * retryAfterMs 同一套词表与退避策略（v2.61 只修了视频，插画链路仍是单发一次：
   * 撞上限流整页直接失败，批量时每一页都去撞一次窗口，「个别插画不成功」就是这么来的）。
   * 限流/503 → 8s→20s→40s 退避重试（最多 3 次，尊重 Retry-After，±20% 抖动）；
   * 参数类永久错误不重试；失败透传服务端真实原因 + 行动指引。 */
  var attempt = 0, max = 3;
  function wait(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  function tryOnce(){
    attempt++;
    return apiPostAgnes(cfg.agnesBase + '/images/generations', body)
      .then(function(r){
        var j = parseJsonSafe(r.text);
        var url = j && j.data && j.data[0] && (j.data[0].url || (j.data[0].b64_json ? 'data:image/png;base64,' + j.data[0].b64_json : ''));
        if(url){ bedCoolClear(); return url; }                       /* 请求成功 = 窗口已开 */
        if(r.status >= 400 && !isRetryableVideoErr(r, r.text)){ throw new Error('HTTP ' + r.status + ' ' + agnesErrMsg(j, r)); }
        if(isRetryableVideoErr(r, r.text) && attempt < max){
          var limit = isApiLimitErr(r, r.text);
          var base = limit ? Math.min(60000, 8000 * Math.pow(2, attempt - 1))    // 限流：8s→20s→40s
                           : Math.min(20000, 3000 * Math.pow(2, attempt - 1));   // 队列忙：3s→6s→12s
          var ra = limit ? retryAfterMs(r, 0) : 0;
          var backoff = ra > 0 ? ra : Math.round(base * (0.8 + Math.random() * 0.4));
          if(limit) bedCoolSet(60000);                                     /* 告诉批量循环：账号在窗口内，别再连发 */
          bt.status = (limit ? '已触发 API 限流' : '插画服务繁忙') + '，' + Math.round(backoff / 1000) + 's 后重试（' + attempt + '/' + max + '）…';
          renderBedtime();
          return wait(backoff).then(tryOnce);
        }
        var msg = agnesErrMsg(j, r);
        if(isApiLimitErr(r, r.text)){
          throw new Error('API 速率限制：' + msg + '。免费账号有速率限额，请等待 1-2 分钟后重试（不会重复计费），或升级 Token Plan');
        }
        throw new Error('HTTP ' + (r ? r.status : '?') + ' ' + msg);
      }, function(e){
        /* 网络层失败：没有响应就无法确认服务端是否已开始画，重试可能重复计费——不重试 */
        throw new Error('插画请求未得到响应（' + (e && e.message ? e.message : e) + '）。请稍后重试。');
      });
  }
  return tryOnce();
}
/* v2.59：插画「续生成」计划（纯函数，便于单测）：
 * 默认只挑「没有插画」「上次生成失败（imgErr）」或「只有演示占位图」的页——个别插画失败时，
 * 再次点 ② 只重试这些页，不再把已成功的全部重做、浪费配额；
 * forceAll（点「全部重画插画」）时整本重画。 */
function bedIsRealImg(u){ return !!u && String(u).indexOf('data:image/svg') !== 0; }
function bedImgPlan(bt, forceAll){
  var plan = [], skipped = 0;
  (bt.pages || []).forEach(function(p, i){
    if(forceAll || !bedIsRealImg(p.imgURL) || p.imgErr) plan.push(i); else skipped++;
  });
  return { plan:plan, skipped:skipped };
}
/* v2.62：账号级「API 限流冷却」——限流是账号维度，不是故事维度，所以存全局 key；
 * 且必须落盘：v2.61 的运行态变量一刷新页面就忘，恢复后立刻又撞窗口。
 * - bedCoolLeft()：还剩多少毫秒（0 = 不在冷却期）
 * - bedCoolSet(ms)：进入/延长冷却（取「现在+ms」与已有截止时间的较大值，重复失败会越等越久）
 * - bedCoolClear()：任意一次请求成功就证明窗口已开，立刻解除冷却
 * - bedWaitCool(what, isImg)：冷却中 → 状态行倒计时并自动等到点，不需要用户自己算时间 */
function bedCoolUntilRaw(){
  try{ return Number(localStorage.getItem(LS + 'bedcool')) || 0; }catch(e){ return 0; }
}
function bedCoolLeft(){
  var left = bedCoolUntilRaw() - Date.now();
  return left > 0 ? left : 0;
}
function bedCoolSet(ms){
  var until = Math.max(Date.now() + (Number(ms) || 0), bedCoolUntilRaw());
  try{ lsSet(LS + 'bedcool', String(until), { warn:false }); }catch(e){}
}
function bedCoolClear(){ try{ lsSet(LS + 'bedcool', '0', { warn:false }); }catch(e){} }
function bedWaitCool(what, isImg){
  var left = bedCoolLeft();
  if(!left) return Promise.resolve();
  var bt = state.bedtime;
  var msg = what + '：API 限流冷却中（剩余 ' + Math.ceil(left / 1000) + 's），将自动继续…';
  if(isImg) bt.status = msg; else bt.videoStatus = msg;
  renderBedtime();
  return new Promise(function(res){ setTimeout(res, left); });
}
function genBedtimeImages(forceAll){
  var bt = state.bedtime, myId = bt.id;
  if(!bt.pages.length){ toast('请先生成故事'); return; }
  if(!hasAgnesKey()){
    bt.pages.forEach(function(p, i){ if(!p.imgURL) p.imgURL = demoImage(i, p.text, bt.artStyle); });
    bt.status = '演示插画已生成（演示模式）'; renderBedtime(); toast('未配置 Agnes Key，使用演示插画');
    return;
  }
  if(guardBudget()) return;
  if(bt._genImgRunning){ toast('插画生成中，请稍候…'); return; }
  var pl = bedImgPlan(bt, forceAll);
  if(!pl.plan.length){
    bt.status = '绘本插画已全部生成（' + bt.pages.length + ' 页）— 再次点击 ② 不会重复生成；可点单页「↻ 重画插画」只重做某一页';
    renderBedtime(); toast('插画已全部生成，没有失败页需要重试');
    return;
  }
  var label = forceAll ? '全部重画插画' : '插画续生成';
  bt._genImgRunning = true;
  bt.status = label + '中…（' + pl.skipped + ' 张已成功跳过，本次生成 ' + pl.plan.length + ' 张）';
  renderBedtime();
  var limitStreak = 0, aborted = false, attempted = 0, runOk = 0, runFail = 0;
  var kick = function(){
    if(state.bedtimeId !== myId){ bt._genImgRunning = false; return; }
    var finish = function(){
      bt._genImgRunning = false;
      var failN = bt.pages.filter(function(p){ return p.imgErr; }).length;
      var leftN = pl.plan.length - attempted;      /* 本次还没轮到的页（早停时 > 0） */
      if(aborted){
        bt.status = '绘本插画已因 API 速率限制暂停（本次成功 ' + runOk + ' 张，剩余 ' + leftN + ' 张未尝试）— 免费账号有速率限额，请等 1-2 分钟再点 ②（只补剩余的），或升级 Token Plan';
        toast('连续 ' + limitStreak + ' 张插画因 API 速率限制失败，已暂停整批（剩余 ' + leftN + ' 张未尝试）。请等 1-2 分钟再点 ② 只补剩余页（不会重复计费），或升级 Token Plan');
      }
      else if(failN){
        bt.status = '绘本插画完成（' + failN + ' 张失败）— 再次点击 ② 只重试失败页，或点单页「↻ 重画插画」';
        toast('绘本插画完成，' + failN + ' 张失败（再点 ② 只重试失败页）');
      }
      else {
        bt.status = '绘本插画完成（' + bt.pages.length + ' 页全部成功）';
        toast('绘本插画完成');
      }
      renderBedtime();
    };
    var run = function(k){
      if(state.bedtimeId !== myId){ bt._genImgRunning = false; return; }   /* 已切换到其它故事 → 中止，避免串档 */
      if(aborted || k >= pl.plan.length){ finish(); return; }
      /* v2.62：账号级冷却等待——上一页撞了限流，硬发下一页只会继续被限；
         冷却已落盘，刷新页面/切换故事后回来依然有效 */
      var left = bedCoolLeft();
      if(left){
        bt.status = '已触发 API 限流，冷却 ' + Math.ceil(left / 1000) + 's 后继续…';
        renderBedtime();
        setTimeout(function(){ run(k); }, left);
        return;
      }
      var i = pl.plan[k], p = bt.pages[i];
      attempted++;
      p._imgRunning = true;
      bt.status = label + '中…（第 ' + (i + 1) + ' 页，' + (k + 1) + '/' + pl.plan.length + (pl.skipped ? '，已跳过 ' + pl.skipped + ' 张' : '') + '）';
      renderBedtime();
      genBedtimeImage(p, i).then(function(url){
        if(state.bedtimeId !== myId) return;
        p._imgRunning = false; p.imgURL = url; p.imgErr = ''; limitStreak = 0; runOk++; renderBedtime(); run(k + 1);
      }).catch(function(e){
        if(state.bedtimeId !== myId) return;
        console.error(e); p._imgRunning = false; p.imgErr = guessCorsMsg(e); runFail++;
        /* v2.62：连续 2 页限流失败 → 早停。窗口明显没恢复，把剩余页全撞一遍只是浪费
           几分钟时间和更多 429；停下来说明原因，用户等窗口过去再点 ② 只补剩余页 */
        if(isApiLimitErr(null, p.imgErr)){
          limitStreak++;
          bedCoolSet(limitStreak >= 2 ? 120000 : 60000);
          if(limitStreak >= 2) aborted = true;
        }
        else limitStreak = 0;
        renderBedtime(); run(k + 1);
      });
    };
    run(0);
  };
  /* 先确保有角色设定图：没有就先生成（1 张图的成本换全书人物一致，非常值）；
     生成失败也继续（退化为纯文字锚点，不阻断插画流程）；正在生成中则等它，避免这批插画丢了参考图 */
  if(!bt.charRefURL){
    if(bt._charRefRunning){ bt._genImgRunning = false; toast('角色设定图生成中，请稍候…（它决定所有插画的人物一致性）'); return; }
    genBedtimeCharRef().then(kick); return;
  }
  kick();
}
/* v2.59：单页重画——对某一页插画不满意（或该页上次失败）时，只重做这一页，不影响其它页。
 * 已有角色设定图时自动作为参考图；没有则先补生成设定图再画，保证全书人物一致。 */
function regenBedtimeImage(i){
  var bt = state.bedtime, myId = bt.id;
  var p = bt.pages[i];
  if(!p){ toast('页面不存在'); return; }
  if(bt._genImgRunning){ toast('插画生成中，请稍候…'); return; }
  if(!hasAgnesKey()){ toast('需要 Agnes Key 才能重画插画'); return; }
  if(guardBudget()) return;
  bt._genImgRunning = true;
  var kick = function(){
    if(state.bedtimeId !== myId){ bt._genImgRunning = false; return; }
    /* v2.62：仍在限流冷却期 → 倒计时自动等到点再画（单页重画是明确动作，但不能拿去撞窗口） */
    bedWaitCool('重画第 ' + (i + 1) + ' 页插画', true).then(function(){
      if(state.bedtimeId !== myId){ bt._genImgRunning = false; return; }
      p._imgRunning = true; p.imgErr = '';
      bt.status = '正在重画第 ' + (i + 1) + ' 页插画…'; renderBedtime();
      genBedtimeImage(p, i).then(function(url){
        bt._genImgRunning = false;
        if(state.bedtimeId !== myId) return;
        p._imgRunning = false; p.imgURL = url; p.imgErr = '';
        bt.status = '第 ' + (i + 1) + ' 页插画已重画'; renderBedtime(); toast('第 ' + (i + 1) + ' 页插画已重画');
      }).catch(function(e){
        bt._genImgRunning = false;
        if(state.bedtimeId !== myId) return;
        console.error(e); p._imgRunning = false; p.imgErr = guessCorsMsg(e);
        if(isApiLimitErr(null, p.imgErr)) bedCoolSet(60000);
        bt.status = '第 ' + (i + 1) + ' 页插画重画失败（' + p.imgErr + '）'; renderBedtime();
        toast('第 ' + (i + 1) + ' 页插画重画失败：' + p.imgErr);
      });
    });
  };
  if(!bt.charRefURL){
    if(bt._charRefRunning){ bt._genImgRunning = false; toast('角色设定图生成中，请稍候…（它决定所有插画的人物一致性）'); return; }
    genBedtimeCharRef().then(kick); return;
  }
  kick();
}
function genBedtimeAudio(p){
  return apiPostTts(cfg.ttsBase.replace(/\/+$/, '') + '/chat/completions', cfg.ttsKey, buildTtsBody(p.text, bedtimeVoiceId(), state.bedtime.style))
    .then(function(r){
      var j = parseJsonSafe(r.text);
      var b64 = pickAudioB64(j), url = pickAudioUrl(j);
      if(r.status >= 400 || (!b64 && !url)){ var m = (j && (j.error || j.message)) ? JSON.stringify(j.error || j.message) : (r.text || '').slice(0, 180); throw new Error('HTTP ' + r.status + ' ' + m); }
      return { b64:b64, url:url };
    });
}
function genBedtimeAudioAll(){
  var bt = state.bedtime, myId = bt.id;
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
    if(state.bedtimeId !== myId) return;          /* 已切换到其它故事 → 中止，避免串档 */
    if(k >= seq.length){ bt.status = '旁白音频完成'; renderBedtime(); toast('旁白音频完成'); return; }
    var i = seq[k], p = bt.pages[i];
    genBedtimeAudio(p).then(function(res){
      if(state.bedtimeId !== myId) return;
      if(res.b64){ audSave(bedAudKey(i), res.b64, mime, 0); p.audB64 = res.b64; p.audMime = mime; p.audURL = audUrl(bedAudKey(i)); }
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
/* bedtime 旁白音色：下拉框用中文描述名（温柔女声 等），但小米 TTS 的 audio.voice
   只接受官方预置 ID；这里翻译成合法 ID，未命中则回退默认音色，避免 HTTP 400。
   视频分支（Agnes）仍走 bedtimeVoiceDesc() 的英文描述，不受影响。 */
function bedtimeVoiceId(){
  var v = (state.bedtime.voice || '');
  var map = { '温柔女声':'茉莉', '慈爱爷爷':'白桦', '柔和男声':'苏打', '精灵妹妹':'冰糖' };
  if(map[v]) return map[v];
  var ids = ['mimo_default','冰糖','茉莉','苏打','白桦','Mia','Chloe','Milo','Dean'];
  if(ids.indexOf(v) >= 0) return v;   /* 用户已手动填合法 ID，原样返回 */
  return cfg.ttsVoice || 'mimo_default';
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
      if(tries > 240){ reject(new Error('轮询超时（超过 12 分钟）。视频任务可能仍在后台生成，请稍后重试或查询，不要立即重复提交')); return; }
      apiGet(cfg.agnesQuery + '/agnesapi?video_id=' + encodeURIComponent(videoId) + '&model_name=' + encodeURIComponent(cfg.vidModel || 'agnes-video-2.5-flash'), ak())
        .then(function(r){
          var j = parseJsonSafe(r.text), st = pickStatus(j);
          if(st === 'completed' || st === 'succeeded' || st === 'success'){
            var url = pickVideoUrl(j);
            if(!url){ reject(new Error('任务已完成但未返回视频地址')); return; }
            resolve(url);
          }
          else if(st === 'failed' || st === 'error' || st === 'canceled' || st === 'cancelled' || st === 'aborted'){ reject(new Error((j && (j.error || j.message)) ? JSON.stringify(j.error || j.message) : (r.text || '').slice(0,160))); }
          else {
            /* v2.62：查询也被限流时拉长间隔（统一 isApiLimitErr 词表；服务端给了
               Retry-After 就照办，封顶 15s）——轮询不计费，没必要在速率窗口内连打；
               任务本身还在后台跑，恢复后自然取到成品 */
            var limited = isApiLimitErr(r, r.text);
            setTimeout(tick, limited ? Math.min(15000, Math.max(8000, retryAfterMs(r, 0))) : 3500);
          }
        })
        .catch(function(e){ if(tries > 3) reject(e); else setTimeout(tick, 3500); });
    };
    tick();
  });
}
function genOneClip(p, seg){
  var voice = bedtimeVoiceDesc();
  /* 旁白是第三人称叙述，不是角色台词：让画面表现旁白描述的场景/动作，
     采用画外旁白配音（角色不开口、不出现说话口型），并配轻柔摇篮曲背景音乐。
     Agnes 视频在 keyframe 模式不允许传 audios 参考音频，故 BGM 只能写进 prompt。 */
  var art = state.bedtime.artStyle || '童话水彩';
  var mood = state.bedtime.style || '温柔';
  var prompt = '儿童睡前故事绘本动画片段，' + art + '风格，' + mood + '氛围。'
    + '以首帧插画为起点，自然表现以下旁白所描述的场景与动作：' + seg + '。'
    + '重要：这段是第三人称画外旁白，角色不要开口说话、不要出现说话口型；'
    + '请生成温柔舒缓的画外旁白配音来朗读它（音色：' + voice + '），'
    + '并配以轻柔舒缓的摇篮曲背景音乐，营造安静助眠的氛围。';
  /* v2.58：主角外观锚点——视频以本页插画为首帧，角色形象已由设定图锁定，这里再用文字锁一道 */
  var cd = (state.bedtime.charDesc && String(state.bedtime.charDesc).trim()) ? String(state.bedtime.charDesc).trim() : '';
  if(cd) prompt += '主角外观必须与首帧插画严格一致，不要改变：' + cd + '。';
  /* 对齐官方 agnes-video-2.5-flash（OpenAI-Videos 兼容）：mode 必填；插画作首帧走 keyframe；
     秒数取 4–12，Flash 固定 720P。禁用不存在的 width/height/num_frames/frame_rate/extra_body。 */
  var sec = Math.min(12, Math.max(4, Math.round(seg.length / 4) || 5));
  var body = {
    model:(cfg.vidModel || 'agnes-video-2.5-flash'), prompt:prompt, mode:'keyframe', first_frame:p.imgURL,
    seconds:String(sec), size:'720P', aspect_ratio:(state.bedtime.ratio || '3:4'), n:1
  };
  /* 队列满 / 限流是瞬时错误，submitAgnesVideo 会自动退避重试；重试期间回写状态让用户知道在等待而非卡死 */
  return submitAgnesVideo(body, {
    onWait: function(a, backoff, mx, kind){
      var bt = state.bedtime;
      bt.videoStatus = (kind === 'limit' ? '已触发 API 限流' : '队列已满') + '，退避重试中 (' + a + '/' + mx + ')…'; renderBedtime();
    }
  }).then(function(vid){ return pollAgnesClip(vid); });
}
/* 生成短视频（Agnes V2.0 音画同步）：支持「部分生成 / 断点续生成」边界情况
 * - 各页 clips 与 splitNarration(text) 的分段一一对齐（按索引存放，失败/未生成为 null），
 *   杜绝「中间段失败导致后续片段在数组里前移」的错位。
 * - 再次点击 ④ 时，已成功的片段直接跳过（续生成），不再整体重做、不浪费配额。
 * - 缺真实插画的页（imgURL 为空或为演示 SVG）跳过并标注，不拿空首帧去请求。
 * - 单页片段数随故事文本改变时，自动按新分段数重建 clips 占位（旧片段作废重做）。
 * - 运行锁防止连续点击起多条链抢写同一数组。 */
function genBedtimeVideo(){
  var bt = state.bedtime, myId = bt.id;
  if(!bt.pages.length){ toast('请先生成故事'); return; }
  if(!bt.pages[0].imgURL){ toast('请先生成故事与绘本插画（需真实图片 URL 作参考帧）'); return; }
  if(!hasAgnesKey()){
    toast('未配置 Agnes Key：改用「播放绘本」做浏览器内预览');
    bedPlay(); return;
  }
  if(guardBudget()) return;
  if(bt._genVideoRunning){ toast('短视频生成进行中，请稍候…'); return; }
  bt._moviePlaying = false;
  // 预计算「需生成」清单（已成功的片段跳过）+ 各页缺图标注
  var plan = [];                 /* {pi, si, seg} */
  var done0 = 0, skippedPages = 0;
  bt.pages.forEach(function(p, pi){
    var segs = splitNarration(p.text);
    if(!segs.length) return;
    if(!p.imgURL || p.imgURL.indexOf('data:image/svg') === 0){
      p.clipErr = '需真实插画图片（演示占位图不可用）'; skippedPages++; return;
    }
    if(!Array.isArray(p.clips) || p.clips.length !== segs.length){
      p.clips = new Array(segs.length).fill(null); p.clipErr = '';   /* 首跑或文本改变 → 重建对齐占位 */
    }
    segs.forEach(function(seg, si){
      if(p.clips[si]){ done0++; return; }                           /* 已生成 → 续生成跳过 */
      plan.push({ pi:pi, si:si, seg:seg });
    });
  });
  var total = done0 + plan.length;
  if(!plan.length){
    bt._genVideoRunning = false;
    bt.videoStatus = done0
      ? ('短视频已全部生成（' + done0 + ' 段）— 再次点击 ④ 不会重复生成' + (skippedPages ? '，' + skippedPages + ' 页缺图跳过' : ''))
      : '没有可生成的旁白文本';
    renderBedtime();
    if(skippedPages) toast(skippedPages + ' 页缺真实插画，已跳过');
    return;
  }
  var done = done0, failed = 0;
  bt._genVideoRunning = true;
  bt.videoStatus = '生成中… (' + done + '/' + total + (skippedPages ? '，' + skippedPages + ' 页缺图跳过' : '') + ')';
  renderBedtime();
  var chain = Promise.resolve();
  plan.forEach(function(item){
    var p = bt.pages[item.pi];
    chain = chain.then(function(){
      if(state.bedtimeId !== myId) return Promise.resolve();   /* 已切换到其它故事 → 中止，避免串档 */
      if(!state.bedtime.pages[item.pi]) return;
      return genOneClip(p, item.seg).then(function(url){
        if(state.bedtimeId !== myId) return;
        if(url){ p.clips[item.si] = url; done++; }
        else { p.clips[item.si] = null; failed++; }
        bt.videoStatus = '生成中… (' + done + '/' + total + (failed ? '，' + failed + ' 段失败' : '') + (skippedPages ? '，' + skippedPages + ' 页缺图跳过' : '') + ')';
        renderBedtime();
      }).catch(function(e){
        if(state.bedtimeId !== myId) return;
        console.error(e); p.clips[item.si] = null; p.clipErr = guessCorsMsg(e); failed++;
        bt.videoStatus = '生成中… (' + done + '/' + total + '，' + failed + ' 段失败' + (skippedPages ? '，' + skippedPages + ' 页缺图跳过' : '') + ')';
        renderBedtime();
      });
    });
  });
  chain.then(function(){
    bt._genVideoRunning = false;
    var ok = bt.pages.reduce(function(n, p){ return n + (p.clips || []).filter(Boolean).length; }, 0);
    if(failed){
      bt.videoStatus = '短视频生成完成（成功 ' + ok + '/' + total + '，' + failed + ' 段失败' + (skippedPages ? '，' + skippedPages + ' 页缺图跳过' : '') + '）— 可再次点击 ④ 仅重试失败片段';
    } else {
      bt.videoStatus = '短视频生成完成（' + ok + '/' + total + ' 段 · 旁白配音 + 背景音乐' + (skippedPages ? '，' + skippedPages + ' 页缺图跳过' : '') + '）';
    }
    renderBedtime();
    toast(failed ? ('短视频生成完成，' + failed + ' 段失败（再点 ④ 仅重试失败片段）') : '睡前故事短视频生成完成');
  });
}
function bedAllClips(){
  var bt = state.bedtime; if(!bt || !bt.pages) return [];
  var a = []; bt.pages.forEach(function(p){ if(p.clips) p.clips.forEach(function(u){ if(u) a.push(u); }); }); return a;
}

/* ================= v2.60：睡前故事短视频（参考小说转短剧管线重新设计） =================
 * 与绘本共享的只有两点：角色设定图（charRefURL/charDesc 文字锚点）与画风（artStyle）——
 * 保证短视频里的人物和画面与绘本插画一致；其余完全独立：
 *   ① 基于「完整故事」重新拆镜（LLM 结构化分镜，不再按页旁白硬切）；
 *   ② 每镜 5-12 秒（LLM 给建议值 + 输入框覆盖，clamp 5-12）；
 *   ③ 每镜首帧取对应绘本页插画（keyframe），没有真实插画则退化为文生视频；
 *   ④ 提示词含电影级运镜 + 自然环境声 + 画外旁白（角色不开口）+ 轻柔摇篮曲 BGM；
 *   ⑤ 断点续生成：已成功的镜跳过；刷新后在途任务恢复轮询（不重复提交）；
 *   ⑥ 运行锁 _genVidRunning：批量与单镜重做互斥。
 * 旧版「按页旁白切片」数据（p.clips）保留原样展示与播放，新生成一律走本管线。 */
var bedPollers = {};                 /* 镜索引 → setInterval（刷新后在途恢复用） */
function newBedVShot(){
  return { no:0, pageIdx:0, scene:'', prompt:'', camera:'', amb:'', narration:'', shotSize:'',
    seconds:6, vidURL:'', vidErr:'', taskId:'', vstat:'未生成', _vrun:false };
}
function bedVShotClampSec(s){ return Math.min(12, Math.max(5, Math.round(num(s) || 6))); }
/* 故事签名：内容一变就需要重新拆镜（要求「根据生成的完整睡前故事重新拆镜」） */
function bedStorySig(){
  var bt = state.bedtime;
  var txt = (bt.pages || []).map(function(p){ return p.text || ''; }).join('\n');
  var h = 5381, i;
  for(i = 0; i < txt.length; i++){ h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0; }
  return bt.pages.length + ':' + h.toString(36);
}
/* 拆镜 system prompt：结构化 JSON 分镜（运镜/环境声/旁白/页码/时长受控） */
function bedSplitSys(n, sec){
  var bt = state.bedtime;
  var cd = (bt.charDesc && String(bt.charDesc).trim()) ? String(bt.charDesc).trim() : '';
  var cams = ['固定', '缓推', '拉远', '横摇', '横移', '跟拍', '升降', '环绕', '手持'];
  return '你是一位专业的儿童睡前故事短视频导演。请把用户给的完整睡前故事拆成 ' + n + ' 个镜头，每镜约 ' + sec + ' 秒（按叙事节奏每镜可在 5-12 秒之间增减）。'
    + '【一致性——最重要】主角外观设定：' + (cd || '可爱卡通主角') + '。所有镜头必须是同一个主角，物种、发型发色、五官、服装款式与配色完全一致，禁止重新设计外观。'
    + '【画面】scene 与 prompt 用中文写构图、动作、环境、光影与氛围；不要写主角的外貌与服装细节（由系统统一注入），画面中不要出现任何文字；'
    + '【运镜】camera 只能从这些词里选一个：' + cams.join('、') + '。要电影级、舒缓优雅，符合睡前故事的安静节奏，不要激烈晃动；'
    + '【自然环境声】amb 写这一镜的自然环境声与背景音乐（中文 10-24 字，如「夜晚森林的虫鸣与微风，轻柔摇篮曲」「壁炉里柴火噼啪，远处海浪」），必须与画面场景匹配；'
    + '【旁白】narration 写这一镜对应的第三人称睡前旁白（温柔舒缓，1-2 句，直接用故事原文或轻微润色；不要写成角色对白）；'
    + '【页面对应】page 填这一镜主要对应的绘本页码（1 到 ' + bt.pages.length + ' 的整数，系统会取该页插画作为视频首帧，保证人物与画风同绘本一致）；'
    + '【景别】shot_size 从「远景/全景/中景/近景/特写」中选一个，按叙事节奏分布，不要连续多镜同景别；'
    + 'seconds 填 5 到 12 之间的整数；'
    + '只输出严格 JSON 数组，不要解释文字，不要代码块围栏。格式：'
    + '[{"shot":1,"page":1,"shot_size":"全景","scene":"月光下的森林小屋，主角坐在窗边望向星空","prompt":"月光下的森林小屋，主角坐在窗边望向星空，暖黄灯光透出窗户，萤火虫在草丛间漂浮","camera":"缓推","amb":"夜晚森林的虫鸣与微风，轻柔摇篮曲","narration":"夜深了，小熊抱着枕头，望见窗外一闪一闪的小星星。","seconds":6}]';
}
/* 拆镜：按完整故事文本调用文本模型，产出结构化分镜（复用小说管线的 loose 解析） */
function bedSplitShots(force){
  var bt = state.bedtime, myId = bt.id;
  if(!bt.pages.length){ toast('请先生成故事'); return Promise.resolve(false); }
  if(!cfg.textBase || !cfg.textKey){ toast('请先在设置里配置文本模型 Key（拆镜需要）'); if(window.openDrawer) openDrawer(); return Promise.resolve(false); }
  if(bt._splitting){ toast('正在拆镜，请稍候…'); return Promise.resolve(false); }
  if(bt.vshots.length && !force && !confirm('重新拆镜会清空现有分镜与已生成的片段，确定？')) return Promise.resolve(false);
  bt._splitting = true;
  bt.videoStatus = '正在按完整故事拆分镜头…'; renderBedtime();
  var n = Math.max(3, Math.min(24, num(bt.vshotsN) || Math.ceil(bt.pages.length * 1.5) || 8));
  var sec = bedVShotClampSec(num(bt.vidSec) || 6);
  var full = '《' + (bt.title || '睡前故事') + '》\n'
    + bt.pages.map(function(p, i){ return '第' + (i + 1) + '页：' + (p.text || ''); }).join('\n');
  return apiPost(cfg.textBase.replace(/\/+$/, '') + '/chat/completions', cfg.textKey, {
    model: cfg.textModel, temperature: 0.7,
    messages: [{ role:'system', content: bedSplitSys(n, sec) }, { role:'user', content: full.slice(0, 20000) }]
  }).then(function(r){
    var j = parseJsonSafe(r.text);
    var content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if(r.status >= 400 || !content) throw new Error('HTTP ' + r.status + ' ' + (r.text || '').slice(0, 160));
    var arr = parseShotArray(content);
    if(!arr.length) throw new Error('拆镜结果解析失败（模型未返回有效分镜 JSON）');
    if(state.bedtimeId !== myId) return false;
    bt.vshots = arr.map(function(it, i){
      var v = newBedVShot();
      v.no = i + 1;
      v.pageIdx = Math.max(0, Math.min(bt.pages.length - 1, (num(it.page) || 1) - 1));
      v.scene = String(it.scene || '').trim();
      v.prompt = String(it.prompt || it.scene || '').trim();
      v.camera = String(it.camera || '').trim();
      v.amb = String(it.amb || it.ambient || it.sound || '').trim();
      v.narration = String(it.narration || it.line || it.narr || '').trim();
      v.shotSize = String(it.shot_size || it.size || '').trim();
      v.seconds = bedVShotClampSec(num(it.seconds) || sec);
      return v;
    });
    bt.vshotSig = bedStorySig();
    var okN = bt.vshots.length, bad = arr.length - okN;
    bt.videoStatus = '已拆分 ' + okN + ' 个镜头（每镜 5-12 秒，首帧取对应绘本页插画）— 点 ④ 开始逐镜生成'
      + (bad ? '，' + bad + ' 条记录不完整已忽略' : '');
    renderBedtime(); toast('拆镜完成：' + okN + ' 个镜头');
    return true;
  }).catch(function(e){
    console.error(e);
    if(state.bedtimeId === myId){
      bt.videoStatus = '拆镜失败：' + guessCorsMsg(e);
      renderBedtime(); toast('拆镜失败：' + guessCorsMsg(e));
    }
    return false;
  }).then(function(ok){ bt._splitting = false; return ok; });
}
/* 视频提示词：运镜（受控词表→英文）+ 画面 + 角色文字锚点 + 画风（同绘本）+ 环境声 + 画外旁白 + BGM */
function bedVideoPrompt(vs){
  var bt = state.bedtime;
  var camEn = cameraLangEn(vs.camera);
  var voice = bedtimeVoiceDesc();
  var art = bt.artStyle || '童话水彩绘本';
  var mood = bt.style || '温柔';
  var p = '儿童睡前故事绘本动画片段，' + art + '风格，' + mood + '氛围。';
  if(camEn) p += '电影级运镜：' + camEn + '。';
  p += '画面：' + (vs.prompt || vs.scene || '安静的睡前场景') + '。';
  var cd = (bt.charDesc && String(bt.charDesc).trim()) ? String(bt.charDesc).trim() : '';
  if(cd) p += '主角外观必须与首帧插画严格一致，不要改变：' + cd + '。';
  if(vs.amb) p += '自然环境声：' + vs.amb + '。';
  if(vs.narration){
    p += '重要：以下是第三人称画外旁白，画面中的角色不要开口说话、不要出现说话口型；'
      + '请生成温柔舒缓的画外旁白配音来朗读它（音色：' + voice + '）：' + vs.narration + '。'
      + '并配以轻柔舒缓的摇篮曲背景音乐，营造安静助眠的氛围。';
  } else {
    p += '画面自然流动，无对白，仅有环境氛围与轻柔摇篮曲背景音乐。';
  }
  return p;
}
/* 视频 API body：有对应绘本插画 → keyframe（首帧即绘本页，人物/画风天然一致）；否则文生视频 */
function bedVideoBody(vs){
  var bt = state.bedtime;
  var body = {
    model:(cfg.vidModel || 'agnes-video-2.5-flash'),
    prompt: bedVideoPrompt(vs),
    seconds: String(bedVShotClampSec(num(vs.seconds) || 6)),
    size:'720P',
    aspect_ratio:(bt.ratio || '3:4'),
    n:1
  };
  var pg = bt.pages[vs.pageIdx];
  var img = (pg && bedIsRealImg(pg.imgURL)) ? pg.imgURL : '';
  body.mode = img ? 'keyframe' : 'text';
  if(img) body.first_frame = img;
  return body;
}
function stopBedVshotPoll(i){ if(bedPollers[i]){ clearInterval(bedPollers[i]); delete bedPollers[i]; } }
/* 轮询单镜（刷新后在途恢复用；批量路径走 pollAgnesClip 的 Promise 版） */
function pollBedVshot(i){
  var bt = state.bedtime, myId = bt.id;
  var v = bt.vshots[i]; if(!v || !v.taskId) return;
  stopBedVshotPoll(i);
  var tries = 0;
  var tick = function(){
    if(state.bedtimeId !== myId){ stopBedVshotPoll(i); return; }
    var cur = state.bedtime.vshots[i];
    if(!cur || !cur.taskId){ stopBedVshotPoll(i); return; }
    tries++;
    if(tries > 240){ stopBedVshotPoll(i); cur.vstat = '失败'; cur.vidErr = '轮询超时（超过 12 分钟）'; renderBedtime(); return; }
    apiGet(cfg.agnesQuery + '/agnesapi?video_id=' + encodeURIComponent(cur.taskId) + '&model_name=' + encodeURIComponent(cfg.vidModel || 'agnes-video-2.5-flash'), ak())
      .then(function(r){
        if(state.bedtimeId !== myId){ stopBedVshotPoll(i); return; }
        if(r.status >= 400){
          /* v2.62：查询被限流——任务还在后台跑，不计失败、放慢节奏继续等
             （原来 3 次 429 就把在途镜标成「失败」，用户只能整镜重做，白等一场） */
          if(isApiLimitErr(r, r.text)){
            if(bedPollers[i]){
              stopBedVshotPoll(i);
              bedPollers[i] = setInterval(tick, Math.min(15000, Math.max(8000, retryAfterMs(r, 0))));
            }
            return;
          }
          if(tries > 3){ stopBedVshotPoll(i); cur.vstat = '失败'; cur.vidErr = '查询失败（HTTP ' + r.status + '）'; renderBedtime(); }
          return;
        }
        var j = parseJsonSafe(r.text), st = pickStatus(j);
        if(st === 'completed' || st === 'succeeded' || st === 'success'){
          stopBedVshotPoll(i);
          var url = pickVideoUrl(j);
          if(!url){ cur.vstat = '失败'; cur.vidErr = '任务完成但未返回视频地址'; }
          else { cur.vstat = '已完成'; cur.vidURL = url; cur.vidErr = ''; }
          renderBedtime();
        } else if(st === 'failed' || st === 'error' || st === 'canceled' || st === 'cancelled' || st === 'aborted'){
          stopBedVshotPoll(i); cur.vstat = '失败';
          cur.vidErr = (j && (j.error || j.message)) ? JSON.stringify(j.error || j.message) : (r.text || '').slice(0, 160);
          renderBedtime();
        } else {
          var ns = (st === 'queued' || st === 'pending' || st === 'waiting' || st === 'submitted') ? '排队中' : '生成中';
          if(cur.vstat !== ns){ cur.vstat = ns; renderBedtime(); }   /* 状态没变不重渲，省掉每 3.5s 的全量落盘 */
        }
      })
      .catch(function(e){ if(tries > 3){ stopBedVshotPoll(i); cur.vstat = '失败'; cur.vidErr = guessCorsMsg(e); renderBedtime(); } });
  };
  bedPollers[i] = setInterval(tick, 3500);
}
/* 启动/切故事时恢复在途任务（有 taskId 且排队中/生成中 → 只恢复轮询，绝不重复提交） */
function resumeBedVshotPolls(){
  var bt = state.bedtime;
  if(!bt || !bt.vshots || !hasAgnesKey()) return;
  bt.vshots.forEach(function(v, i){
    if(v.taskId && (v.vstat === '排队中' || v.vstat === '生成中') && !bedPollers[i]) pollBedVshot(i);
  });
}
/* ④ 生成短视频：故事变了/没拆过 → 先按完整故事拆镜，再逐镜生成 */
function genBedtimeVideos(){
  var bt = state.bedtime;
  if(!bt.pages.length){ toast('请先生成故事'); return; }
  if(!hasAgnesKey()){
    toast('未配置 Agnes Key：可先用「播放绘本」在浏览器里预览');
    bedPlay(); return;
  }
  if(guardBudget()) return;
  if(bt._genVidRunning || bt._splitting){ toast('短视频处理中，请稍候…'); return; }
  bt._moviePlaying = false;
  if(!bt.vshots.length || bt.vshotSig !== bedStorySig()){
    if(bt.vshots.length && !confirm('故事内容已变化，需要按最新完整故事重新拆镜（旧分镜作废）。继续？')) return;
    bedSplitShots(true).then(function(ok){ if(ok) runBedVshotBatch(); });
    return;
  }
  runBedVshotBatch();
}
/* 逐镜串行生成：已成功跳过（续生成）；队列满/限流由 submitAgnesVideo 自动退避 */
function runBedVshotBatch(){
  var bt = state.bedtime, myId = bt.id;
  var plan = [], done0 = 0;
  bt.vshots.forEach(function(v, i){ if(v.vidURL){ done0++; return; } plan.push(i); });
  var total = done0 + plan.length;
  if(!plan.length){
    bt.videoStatus = '短视频已全部生成（' + done0 + ' 镜）— 再次点击 ④ 不会重复生成；可点单镜「↻ 重做此镜」';
    renderBedtime(); toast('短视频已全部生成，没有失败镜需要重试');
    return;
  }
  var done = done0, failed = 0, limitStreak = 0, aborted = false;
  bt._genVidRunning = true;
  bt.videoStatus = '生成中… (' + done + '/' + total + ')';
  renderBedtime();
  function wait(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  /* v2.62：开局先等过账号级冷却——可能是上一批、甚至另一个故事刚撞了限流
   * （冷却落盘在全局 key，刷新/切故事都不丢），这时候硬开跑只会整批继续被限 */
  bedWaitCool('生成短视频').then(function(){
    if(state.bedtimeId !== myId){ bt._genVidRunning = false; return; }
    startChain();
  });
  function startChain(){
  var chain = Promise.resolve();
  plan.forEach(function(i){
    chain = chain.then(function(){
      if(state.bedtimeId !== myId) return Promise.resolve();      /* 已切换到其它故事 → 中止，避免串档 */
      var v = state.bedtime.vshots[i]; if(!v) return Promise.resolve();
      if(aborted) return Promise.resolve();                       /* v2.62：连续限流早停 → 剩余镜不再硬撞窗口 */
      /* v2.62：镜间节流——上一镜若因限流失败，说明账号还在速率窗口内，立即提交下一镜
       * 只会继续被限（真实案例：整批一个都没成功）；等过冷却期再发。 */
      var left = bedCoolLeft();
      if(left){
        bt.videoStatus = '已触发 API 限流，冷却 ' + Math.ceil(left / 1000) + 's 后继续…';
        renderBedtime();
        return wait(left).then(runOne);
      }
      return runOne();
      function runOne(){
        if(state.bedtimeId !== myId) return Promise.resolve();
        v = state.bedtime.vshots[i]; if(!v) return Promise.resolve();
        v.vstat = '排队中'; v.vidErr = '';
        bt.videoStatus = '生成中…（第 ' + (i + 1) + ' 镜，' + done + '/' + total + (failed ? '，' + failed + ' 镜失败' : '') + '）';
        renderBedtime();
        return submitAgnesVideo(bedVideoBody(v), {
          onWait: function(a, backoff, mx, kind){
            if(state.bedtimeId !== myId) return;
            bt.videoStatus = (kind === 'limit' ? '已触发 API 限流' : '队列已满') + '，退避重试中 (' + a + '/' + mx + ')…'; renderBedtime();
          }
        }).then(function(vid){
          if(state.bedtimeId !== myId) return;
          v.taskId = String(vid); bedCoolClear(); renderBedtime();   /* v2.62：提交成功 = 窗口已开，解除冷却 */
          return pollAgnesClip(v.taskId);
        }).then(function(url){
          if(state.bedtimeId !== myId) return;
          v.vstat = '已完成'; v.vidURL = url; v.vidErr = ''; done++; limitStreak = 0;
          bt.videoStatus = '生成中… (' + done + '/' + total + (failed ? '，' + failed + ' 镜失败' : '') + ')';
          renderBedtime();
        }).catch(function(e){
          if(state.bedtimeId !== myId) return;
          console.error(e); v.vstat = '失败'; v.vidErr = guessCorsMsg(e); failed++;
          /* v2.62：限流失败 → 进入/延长账号级冷却（连续失败越等越久：60s→120s）；
             连续 2 镜都因限流失败 → 早停：窗口明显没恢复，把剩余镜全撞一遍只是浪费 */
          if(isApiLimitErr(null, v.vidErr)){
            limitStreak++;
            bedCoolSet(limitStreak >= 2 ? 120000 : 60000);
            if(limitStreak >= 2) aborted = true;
          }
          else limitStreak = 0;
          bt.videoStatus = '生成中… (' + done + '/' + total + '，' + failed + ' 镜失败)';
          renderBedtime();
        });
      }
    });
  });
  chain.then(function(){
    if(state.bedtimeId !== myId) return;
    bt._genVidRunning = false;
    var ok = bt.vshots.filter(function(v){ return v.vidURL; }).length;
    var bad = bt.vshots.filter(function(v){ return v.vstat === '失败'; }).length;
    var leftN = Math.max(0, total - ok - bad);
    if(aborted){
      bt.videoStatus = '短视频已因 API 速率限制暂停（成功 ' + ok + '/' + total + ' 镜，剩余 ' + leftN + ' 镜未尝试）— 免费账号有速率限额，请等 1-2 分钟再点 ④（只补未生成的镜），或升级 Token Plan';
      toast('连续 ' + limitStreak + ' 镜因 API 速率限制失败，已暂停整批（剩余 ' + leftN + ' 镜未尝试）。请等 1-2 分钟再点 ④ 只补剩余镜（不会重复计费），或升级 Token Plan');
    }
    else if(bad){
      bt.videoStatus = '短视频生成完成（成功 ' + ok + '/' + total + ' 镜，' + bad + ' 镜失败）— 再点 ④ 只重试失败镜，或点单镜「↻ 重做此镜」';
      var limited = bt.vshots.some(function(v){ return v.vstat === '失败' && isApiLimitErr(null, v.vidErr || ''); });
      toast(limited
        ? ('短视频生成完成，' + bad + ' 镜因 API 速率限制失败。免费账号有速率限额——请等 1-2 分钟再点 ④（只补失败镜），或升级 Token Plan')
        : ('短视频生成完成，' + bad + ' 镜失败（再点 ④ 只重试失败镜）'));
    }
    else {
      bt.videoStatus = '短视频生成完成（' + ok + '/' + total + ' 镜 · 画外旁白 + 自然环境声 + 摇篮曲背景音乐）';
      toast('睡前故事短视频生成完成');
    }
    renderBedtime();
  });
  }
}
/* 单镜重做：只重做这一镜（对某镜不满意/该镜失败），不影响其它镜 */
function regenBedVshot(i){
  var bt = state.bedtime, myId = bt.id;
  var v = bt.vshots[i];
  if(!v){ toast('镜头不存在'); return; }
  if(bt._genVidRunning || bt._splitting){ toast('短视频处理中，请稍候…'); return; }
  if(!hasAgnesKey()){ toast('需要 Agnes Key 才能生成短视频'); return; }
  if(guardBudget()) return;
  bt._genVidRunning = true;
  v.vstat = '排队中'; v.vidErr = ''; v.vidURL = ''; v.taskId = '';
  bt.videoStatus = '正在重做第 ' + (i + 1) + ' 镜…'; renderBedtime();
  /* v2.62：仍在限流冷却期 → 倒计时自动等到点再提交（单镜重做是明确动作，但不拿去撞窗口） */
  bedWaitCool('重做第 ' + (i + 1) + ' 镜').then(submitOne);
  function submitOne(){
    if(state.bedtimeId !== myId){ bt._genVidRunning = false; return; }
    submitAgnesVideo(bedVideoBody(v), {
      onWait: function(a, backoff, mx, kind){
        if(state.bedtimeId !== myId) return;
        bt.videoStatus = (kind === 'limit' ? '已触发 API 限流' : '队列已满') + '，退避重试中 (' + a + '/' + mx + ')…'; renderBedtime();
      }
    }).then(function(vid){
      if(state.bedtimeId !== myId) return;
      v.taskId = String(vid); bedCoolClear(); renderBedtime();
      return pollAgnesClip(v.taskId);
    }).then(function(url){
      bt._genVidRunning = false;
      if(state.bedtimeId !== myId) return;
      v.vstat = '已完成'; v.vidURL = url; v.vidErr = '';
      bt.videoStatus = '第 ' + (i + 1) + ' 镜已生成'; renderBedtime(); toast('第 ' + (i + 1) + ' 镜短视频已生成');
    }).catch(function(e){
      bt._genVidRunning = false;
      if(state.bedtimeId !== myId) return;
      console.error(e); v.vstat = '失败'; v.vidErr = guessCorsMsg(e);
      if(isApiLimitErr(null, v.vidErr)) bedCoolSet(60000);
      bt.videoStatus = '第 ' + (i + 1) + ' 镜失败（' + v.vidErr + '）'; renderBedtime();
      toast('第 ' + (i + 1) + ' 镜失败：' + v.vidErr);
    });
  }
}
/* 成片片段清单：新分镜优先；没有新分镜才回落旧版按页切片 */
function bedMovieList(){
  var bt = state.bedtime;
  var vs = (bt.vshots || []).filter(function(v){ return v.vidURL; }).map(function(v){ return v.vidURL; });
  if(vs.length) return vs;
  return bedAllClips();
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
    if(a){
      if(a.getAttribute('src') !== p.audURL) a.src = p.audURL;   /* 同一页恢复播放不重复重载 */
      a.onended = advance; var pr = a.play(); if(pr && pr.catch) pr.catch(advance);
    } else advance();
  } else if(window.speechSynthesis){
    var u = new SpeechSynthesisUtterance(p.text || ''); u.lang = 'zh-CN'; u.rate = 0.9; u.onend = advance; window.speechSynthesis.speak(u);
  } else {
    var secs = Math.max(2, (p.text || '').length / 8); setTimeout(advance, secs * 1000);
  }
}
function bedPlay(){
  var bt = state.bedtime;
  if(!bt.pages.length){ toast('请先生成故事'); return; }
  if(bt._playing){ bedStop(); return; }              /* 播放中再点 = 暂停；修复「停止不起效」 */
  if(bt._cur >= bt.pages.length) bt._cur = 0;
  bt._playing = true; bedStep();
}
function bedStop(){
  var bt = state.bedtime; bt._playing = false;
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  var a = $('bed-stage-audio');                       /* 真正停掉当前正在播放的音频，否则点停止仍在响 */
  if(a){ try{ a.pause(); a.currentTime = 0; }catch(e){} }
}
function bedPrev(){ var bt = state.bedtime; if(bt._cur > 0){ bt._cur--; if(!bt._playing) bedStep(); } }
function bedNext(){ var bt = state.bedtime; if(bt._cur < bt.pages.length - 1){ bt._cur++; if(!bt._playing) bedStep(); } }
function bedPlayMovie(){
  var bt = state.bedtime, all = bedMovieList(); if(!all.length){ toast('请先生成短视频'); return; }
  var mv = $('bed-movie'); if(!mv) return;
  bt._moviePlaying = true; mv.style.display = 'block';
  var i = 0;
  mv.onended = function(){ if(i >= all.length){ bt._moviePlaying = false; mv.style.display = 'none'; return; } mv.src = all[i++]; var pr = mv.play(); if(pr && pr.catch) pr.catch(function(){ i++; mv.onended(); }); };
  mv.onended();
}

/* -------- ⑤ 合成单音频：把各页旁白合并为一个音频文件，段间插入 0.3s 停顿 --------
 * 复用底层能力：本地音频走 audLoad(bedAudKey(i)) 取 base64（按故事隔离，避免跨故事串档），远程音频走 fetchAudioBuf；
 * 解码后由 concatAudioBufs(bufs, 0.3) 拼接（自带 0.3s 静音段），再编码成 WAV 供播放/下载。 */
function mergeBedtimeAudio(){
  var bt = state.bedtime, myId = bt.id;
  if(!bt.pages.length){ toast('请先生成故事'); return; }
  var total = bt.pages.filter(function(p){ return p.audURL || p.audB64; }).length;
  if(!total){ toast('还没有可合成的旁白音频，请先 ③ 生成旁白'); return; }
  var ctx = audioCtx();
  if(ctx && ctx.state === 'suspended'){ try{ ctx.resume(); }catch(e){} }
  bt.status = '正在合成单音频（合并各页 + 段间 0.3s 停顿）…'; renderBedtime();
  var bufs = [], seq = bt.pages.map(function(p,i){ return i; });
  var chain = Promise.resolve();
  seq.forEach(function(i){
    chain = chain.then(function(){
      if(state.bedtimeId !== myId) return;          /* 已切换到其它故事 → 中止，避免串档 */
      var p = bt.pages[i]; if(!p) return;
      if(p.audB64){ return decodeAudioBuf(p.audB64).then(function(b){ if(b) bufs.push(b); }); }
      var a = audLoad(bedAudKey(i));
      if(a && a.b64){ return decodeAudioBuf(a.b64).then(function(b){ if(b) bufs.push(b); }); }
      if(p.audURL){ return fetchAudioBuf(p.audURL).then(function(b){ if(b) bufs.push(b); }); }
      return Promise.resolve();
    });
  });
  chain.then(function(){
    if(state.bedtimeId !== myId){ toast('已切换到其它故事，本次合成结果未应用'); return; }
    if(!bufs.length){ bt.status = '合成失败：音频解码失败（远程音频若跨域可能被拦截）'; renderBedtime(); toast('音频解码失败，无法合成'); return; }
    var merged = concatAudioBufs(bufs, 0.3);   /* 段间 0.3s 停顿 */
    if(!merged){ bt.status = '合成失败'; renderBedtime(); return; }
    var wav = audioBufferToWav(merged);
    if(bt.mergedAudioURL) try{ URL.revokeObjectURL(bt.mergedAudioURL); }catch(e){}
    bt.mergedAudioURL = URL.createObjectURL(new Blob([wav], { type:'audio/wav' }));
    bt.mergedCount = bufs.length;
    bt.status = '单音频已合成（' + bufs.length + ' 段，段间 0.3s 停顿）'; renderBedtime();
    toast('单音频已合成，可在下方播放或下载');
  }).catch(function(e){ console.error(e); bt.status = '合成失败'; renderBedtime(); toast('合成失败：' + guessCorsMsg(e)); });
}

/* -------- 全屏播放：在原有上一页/播放/下一页基础上，把绘本舞台切到全屏沉浸播放 -------- */
function bedPlayFullscreen(){
  var bt = state.bedtime; if(!bt.pages.length){ toast('请先生成故事'); return; }
  var stage = $('bed-stage'); if(!stage) return;
  stage.style.display = 'block';
  var req = stage.requestFullscreen || stage.webkitRequestFullscreen || stage.msRequestFullscreen;
  if(req){ try{ req.call(stage); }catch(e){} }
  stage.classList.add('bed-full');
  bedPlay();
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

/* ④b：把短视频片段按镜序拼接成单个 mp4（ffmpeg 拼接脚本）。新分镜优先，无则回落旧版按页切片 */
function exportBedtimeMerge(){
  var clips = bedMovieList();
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
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 10px;flex-wrap:wrap">'
    + '  <span style="font-size:20px">🌙 儿童睡前故事生成器</span>'
    + '  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    + '    <label style="font-size:13px;color:#9aa">编辑故事：<select id="bed-story-select" style="padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"></select></label>'
    + '    <button id="bed-story-new" class="bed-btn" style="padding:6px 10px">＋ 新建</button>'
    + '    <button id="bed-story-del" class="bed-btn" style="padding:6px 10px">🗑 删除</button>'
    + '  </div>'
    + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start">'
    + '  <div style="flex:1 1 320px;min-width:280px">'
    + '    <label style="display:block;font-size:13px;color:#9aa">故事主题</label>'
    + '    <textarea id="bed-theme" rows="2" placeholder="例如：一只怕黑的小熊，在森林里找星星" style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #345;background:#0e1530;color:#e8ecff"></textarea>'
    + '  </div>'
    + '  <div style="flex:1 1 320px;min-width:280px;display:grid;grid-template-columns:1fr 1fr;gap:8px">'
    + '    <label style="font-size:13px;color:#9aa">适读年龄<select id="bed-age" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>3-5 岁</option><option selected>5-8 岁</option><option>6-10 岁</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">页数<select id="bed-pages" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>4</option><option selected>6</option><option>8</option><option>10</option><option>12</option><option>14</option><option>16</option><option>18</option><option>20</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">画风<select id="bed-art" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>童话水彩绘本</option><option>柔和 3D 卡通</option><option>蜡笔手绘</option><option>国风水墨</option><option>梦幻光影</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">比例<select id="bed-ratio" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option value="3:4" selected>3:4 竖版</option><option value="1:1">1:1 方图</option><option value="16:9">16:9 横版</option><option value="9:16">9:16 手机</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">旁白音色<select id="bed-voice" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>温柔女声</option><option>慈爱爷爷</option><option>柔和男声</option><option>精灵妹妹</option></select></label>'
    + '    <label style="font-size:13px;color:#9aa">情绪风格<select id="bed-style" style="width:100%;padding:6px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"><option>温柔</option><option>神秘</option><option>欢快</option><option>宁静</option><option>俏皮</option></select></label>'
    + '  </div>'
    + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">'
    + '  <button id="bed-gen-story" class="bed-btn">① 生成故事</button>'
    + '  <button id="bed-gen-img" class="bed-btn">② 生成绘本插画</button>'
    + '  <button id="bed-regen-img-all" class="bed-btn">🎨 全部重画插画</button>'
    + '  <button id="bed-gen-audio" class="bed-btn">③ 生成旁白音频</button>'
    + '  <button id="bed-gen-video" class="bed-btn">④ 生成短视频</button>'
    + '  <button id="bed-play" class="bed-btn">▶ 播放绘本</button>'
    + '  <button id="bed-dl-audio" class="bed-btn">⬇ 下载全部音频</button>'
    + '  <button id="bed-merge-audio" class="bed-btn">⑤ 合成单音频</button>'
    + '  <button id="bed-export" class="bed-btn">⬇ 导出绘本</button>'
    + '  <button id="bed-merge" class="bed-btn">④b 合成单视频(ffmpeg)</button>'
    + '</div>'
    + '<div id="bed-status" style="font-size:13px;color:#8ad;min-height:18px;margin-bottom:6px"></div>'
    + '<div id="bed-charref"></div>'
    + '<div id="bed-stage" style="display:none;margin:8px 0;padding:10px;border:1px solid #345;border-radius:10px;background:#0b1030">'
    + '  <img id="bed-stage-img" style="width:100%;max-width:360px;display:block;margin:0 auto;border-radius:8px" alt="绘本">'
    + '  <div id="bed-stage-cap" style="font-size:13px;color:#cdd;margin:8px 0;text-align:center"></div>'
    + '  <audio id="bed-stage-audio" style="width:100%;display:none"></audio>'
    + '  <div style="display:flex;gap:8px;justify-content:center">'
    + '    <button id="bed-prev" class="bed-btn">‹ 上一页</button>'
    + '    <button id="bed-stop" class="bed-btn">⏸ 停止</button>'
    + '    <button id="bed-next" class="bed-btn">下一页 ›</button>'
    + '    <button id="bed-full" class="bed-btn">⛶ 全屏播放</button>'
    + '  </div>'
    + '</div>'
    + '<div id="bed-merged"></div>'
    + '<div id="bed-video" style="margin:8px 0">'
    + '  <div id="bed-vshot-box" style="margin:8px 0">'
    + '    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0">'
    + '      <button id="bed-resplit" class="bed-btn">↻ 重新拆镜</button>'
    + '      <label style="font-size:13px;color:#9aa">镜头数<input id="bed-vshot-n" type="number" min="3" max="24" style="width:56px;padding:5px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"></label>'
    + '      <label style="font-size:13px;color:#9aa">每镜秒数(5-12)<input id="bed-vshot-sec" type="number" min="5" max="12" style="width:56px;padding:5px;border-radius:6px;border:1px solid #345;background:#0e1530;color:#e8ecff"></label>'
    + '      <button id="bed-vshot-play" class="bed-btn">▶ 连播全部镜头</button>'
    + '      <span style="font-size:12px;color:#789">首帧取对应绘本页插画，人物/画风与绘本一致</span>'
    + '    </div>'
    + '    <div id="bed-vshot-status" style="font-size:13px;color:#8ad;min-height:16px;margin:4px 0"></div>'
    + '    <div id="bed-vshots" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:6px"></div>'
    + '  </div>'
    + '  <div id="bed-video-status" style="font-size:13px;color:#8ad;min-height:16px;margin:4px 0"></div>'
    + '  <div id="bed-video-clips"></div>'
    + '  <video id="bed-movie" controls style="width:100%;max-width:360px;display:none;margin:6px auto;border-radius:8px"></video>'
    + '</div>'
    + '<div id="bed-pages-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:10px"></div>';
  var box = $('v-bedtime'); box.innerHTML = ''; box.appendChild(root);
  // 让 stage 的 audio 元素在播放时可见（用于真实音频播放）
  var stageAudio = $('bed-stage-audio'); if(stageAudio) stageAudio.style.display = 'block';
  $('bed-gen-story').onclick = genBedtimeStory;
  /* 注意：不能直接 = genBedtimeImages——onclick 会把事件对象当 forceAll 传进去（truthy→全部重画）。
     ② 的语义是「续生成」：只补没图/上次失败的页 */
  $('bed-gen-img').onclick = function(){ genBedtimeImages(false); };
  $('bed-regen-img-all').onclick = function(){ genBedtimeImages(true); };
  $('bed-gen-audio').onclick = genBedtimeAudioAll;
  /* v2.60：④ 改走新管线（完整故事拆镜 + 每镜 5-12s + 运镜/环境声）；
     同样必须包一层——onclick 的事件对象会被当参数传进去 */
  $('bed-gen-video').onclick = function(){ genBedtimeVideos(); };
  $('bed-resplit').onclick = function(){
    var bt = state.bedtime;
    if(!bt.pages.length){ toast('请先生成故事'); return; }
    if(bt.vshots.length && !confirm('重新拆镜会清空现有分镜与已生成的片段，确定？')) return;
    bedSplitShots(true);
  };
  $('bed-vshot-play').onclick = bedPlayMovie;
  /* 拆镜参数：镜头数 / 每镜秒数（5-12），变更即存（随故事持久化） */
  var vn = $('bed-vshot-n'), vs2 = $('bed-vshot-sec');
  if(vn){
    vn.value = String(state.bedtime.vshotsN || Math.ceil((state.bedtime.pages.length || 6) * 1.5));
    vn.onchange = function(){ state.bedtime.vshotsN = Math.max(3, Math.min(24, num(vn.value) || 0)); saveBedtime(); };
  }
  if(vs2){
    vs2.value = String(bedVShotClampSec(num(state.bedtime.vidSec) || 6));
    vs2.onchange = function(){ state.bedtime.vidSec = bedVShotClampSec(num(vs2.value) || 6); vs2.value = String(state.bedtime.vidSec); saveBedtime(); };
  }
  $('bed-play').onclick = function(){ $('bed-stage').style.display = 'block'; bedPlay(); };
  $('bed-dl-audio').onclick = downloadAllBedtimeAudio;
  $('bed-merge-audio').onclick = mergeBedtimeAudio;
  $('bed-export').onclick = exportBedtimeBook;
  $('bed-merge').onclick = exportBedtimeMerge;
  $('bed-prev').onclick = bedPrev;
  $('bed-next').onclick = bedNext;
  $('bed-stop').onclick = bedStop;
  $('bed-full').onclick = bedPlayFullscreen;
  $('bed-story-select').onchange = function(){ selectBedtimeStory(this.value); };
  $('bed-story-new').onclick = newBedtimeStory;
  $('bed-story-del').onclick = delBedtimeStory;
  if(!window.__bedFsBound){
    document.addEventListener('fullscreenchange', function(){
      var stage = $('bed-stage');
      if(stage && !document.fullscreenElement && stage.classList.contains('bed-full')) stage.classList.remove('bed-full');
    });
    window.__bedFsBound = true;
  }
  if(!box._styled){
    var st = document.createElement('style');
    st.textContent = '.bed-btn{padding:7px 12px;border-radius:8px;border:1px solid #3a5;border:1px solid #345;background:#16204a;color:#dfe6ff;cursor:pointer;font-size:13px}.bed-btn:hover{background:#1d2c63}.bed-card{background:#0e1530;border:1px solid #2a3566;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}.bed-card-img{width:100%;aspect-ratio:3/4;object-fit:cover;background:#1a2348}.bed-card-txt{font-size:12px;color:#cdd;padding:8px;min-height:48px}.bed-card-aud{padding:0 8px 8px}.bed-card button{margin:0 8px 8px;padding:5px 8px;border-radius:6px;border:1px solid #345;background:#16204a;color:#dfe6ff;cursor:pointer;font-size:12px}'
    /* 全屏覆盖：内联样式（max-width:360px 等）优先级高于样式表，必须用 !important 才能放大 */
    + '#bed-stage.bed-full{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:9999!important;background:#000!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;padding:16px!important;border-radius:0!important;border:none!important;margin:0!important}'
    + '#bed-stage.bed-full #bed-stage-img{width:auto!important;height:auto!important;max-width:92vw!important;max-height:72vh!important;object-fit:contain!important;border-radius:12px!important;margin:0 auto!important;display:block!important}'
    + '#bed-stage.bed-full #bed-stage-cap{font-size:22px!important;color:#fff!important;margin:16px 0!important;max-width:92vw!important;line-height:1.5!important;text-align:center!important}'
    + '#bed-stage.bed-full audio{width:80vw!important;max-width:560px!important;margin-top:6px!important}'
    + '#bed-stage.bed-full>div:last-child{position:fixed!important;bottom:20px!important;left:0!important;right:0!important;display:flex!important;gap:10px!important;justify-content:center!important}'
    + '#bed-stage.bed-full .bed-btn{font-size:15px!important;padding:9px 16px!important}';
    document.head.appendChild(st); box._styled = true;
  }
  populateBedInputs(state.bedtime || {});   /* 首次构建后把已加载故事的设置回填到表单 */
}
function renderBedtime(){
  var box = $('v-bedtime'); if(!box) return;
  initBedtimeState();
  if(!box.querySelector('.bed-wrap')) buildBedtimeShell();
  var bt = state.bedtime;
  syncBedStorySelect();                         /* 把故事下拉同步到当前编辑项 */
  // 状态
  var st = $('bed-status'); if(st) st.textContent = (bt.title ? '《' + bt.title + '》 ' : '') + (bt.status || '');
  // 角色设定图（v2.58：插画/视频人物一致性的锚）
  var cr = $('bed-charref');
  if(cr){
    var thumb = bt.charRefURL
      ? '<img src="' + bt.charRefURL + '" alt="角色设定图" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #345;flex:0 0 auto">'
      : '<div style="width:72px;height:72px;border-radius:8px;border:1px dashed #345;display:flex;align-items:center;justify-content:center;color:#789;font-size:11px;text-align:center;flex:0 0 auto">暂无<br>设定图</div>';
    var desc = (bt.charDesc && String(bt.charDesc).trim())
      ? ('主角设定：' + String(bt.charDesc))
      : '点「② 生成绘本插画」会先自动生成一张主角设定图，之后每一页都以它为参考，人物形象全程统一。';
    cr.innerHTML = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0;padding:8px;border:1px solid #345;border-radius:10px;background:#0b1030">'
      + thumb
      + '<div style="flex:1 1 220px;min-width:200px"><div style="font-size:13px;color:#8ad">🎯 角色设定图（人物一致性的关键）</div>'
      + '<div style="font-size:12px;color:#9aa;line-height:1.5">' + desc
      + (bt.charRefErr ? ' <span style="color:#f99">上次失败：' + bt.charRefErr + '</span>' : '')
      + '</div></div>'
      + '<button id="bed-regen-charref" class="bed-btn">' + (bt.charRefURL ? '↻ 重画角色设定' : '🎨 生成角色设定') + '</button>'
      + '</div>';
    var rb = $('bed-regen-charref'); if(rb) rb.onclick = function(){
      if(bt.charRefURL && !confirm('重画角色设定图？已生成的绘本插画不会自动更新，可点「🎨 全部重画插画」或单页「↻ 重画插画」按新设定重画。')) return;
      genBedtimeCharRef();
    };
  }
  // v2.60：新短视频分镜区（完整故事拆镜 + 每镜 5-12s + 运镜/环境声 + 画外旁白）
  var vss = $('bed-vshot-status');
  if(vss){
    var okN = bt.vshots.filter(function(v){ return v.vidURL; }).length;
    var badN = bt.vshots.filter(function(v){ return v.vstat === '失败'; }).length;
    var runN = bt.vshots.filter(function(v){ return v.vstat === '排队中' || v.vstat === '生成中'; }).length;
    vss.textContent = (bt.videoStatus ? bt.videoStatus : '')
      + (bt.vshots.length ? ('　分镜 ' + okN + '/' + bt.vshots.length + ' 镜已完成' + (badN ? '，' + badN + ' 镜失败' : '') + (runN ? '，' + runN + ' 镜在途' : '')) : '（尚未拆镜：点「④ 生成短视频」会自动按完整故事拆镜）');
  }
  var vsc = $('bed-vshots');
  if(vsc && !bt._moviePlaying){
    vsc.innerHTML = '';
    if(!bt.vshots.length){
      vsc.innerHTML = '<div style="font-size:12px;color:#9aa;padding:8px">尚未拆镜。点「④ 生成短视频」：先按完整睡前故事自动拆分镜头（每镜 5-12 秒），再逐镜生成短视频。</div>';
    }
    bt.vshots.forEach(function(v, i){
      var pg = bt.pages[v.pageIdx];
      var card = document.createElement('div'); card.className = 'bed-card';
      if(v.vstat === '失败') card.style.borderColor = '#a55';
      var head = document.createElement('div');
      head.style.cssText = 'font-size:12px;color:#8ad;padding:8px 8px 2px;line-height:1.5';
      head.textContent = '第 ' + v.no + ' 镜 · 第 ' + (v.pageIdx + 1) + ' 页 · ' + v.seconds + 's'
        + (v.shotSize ? ' · ' + v.shotSize : '') + (v.camera ? ' · ' + v.camera : '')
        + (pg && !bedIsRealImg(pg.imgURL) ? ' · 该页无真实插画（将文生视频）' : '');
      var sc = document.createElement('div');
      sc.style.cssText = 'font-size:12px;color:#cdd;padding:2px 8px;line-height:1.5';
      sc.textContent = v.scene || v.prompt || '';
      var meta = document.createElement('div');
      meta.style.cssText = 'font-size:12px;color:#9aa;padding:2px 8px;line-height:1.5';
      meta.textContent = (v.amb ? '环境声：' + v.amb + '　' : '') + (v.narration ? '旁白：' + v.narration : '');
      card.appendChild(head); card.appendChild(sc); card.appendChild(meta);
      if(v.vidURL){
        var vd = document.createElement('video'); vd.src = v.vidURL; vd.controls = true;
        vd.style.cssText = 'width:100%;display:block;border-radius:8px;margin:6px 8px 0';
        card.appendChild(vd);
      } else if(v.vstat === '失败'){
        var er = document.createElement('div');
        er.style.cssText = 'font-size:12px;color:#f99;padding:4px 8px;line-height:1.4';
        er.textContent = '第 ' + v.no + ' 镜失败：' + (v.vidErr || '未知错误') + '（可点下方按钮重做此镜）';
        card.appendChild(er);
      } else if(v.vstat === '排队中' || v.vstat === '生成中'){
        var wip = document.createElement('div');
        wip.style.cssText = 'font-size:12px;color:#8ad;padding:4px 8px';
        wip.textContent = v.vstat + '…（可关闭页面，任务会在后台继续；刷新后自动恢复进度）';
        card.appendChild(wip);
      }
      var rg = document.createElement('button');
      rg.textContent = (v.vstat === '排队中' || v.vstat === '生成中') ? '…生成中' : '↻ 重做此镜';
      rg.disabled = (v.vstat === '排队中' || v.vstat === '生成中') || !!bt._genVidRunning;
      rg.onclick = function(){ regenBedVshot(i); };
      card.appendChild(rg);
      vsc.appendChild(card);
    });
  }
  var gv = $('bed-gen-video'); if(gv) gv.disabled = !!(bt._genVidRunning || bt._splitting);
  var rs = $('bed-resplit'); if(rs) rs.disabled = !!(bt._genVidRunning || bt._splitting);
  /* 拆镜参数框跟随当前故事（用户正在输入的框不抢值，避免打字被重置） */
  var vni = $('bed-vshot-n'), vsi = $('bed-vshot-sec');
  if(vni && document.activeElement !== vni) vni.value = String(bt.vshotsN || Math.ceil((bt.pages.length || 6) * 1.5));
  if(vsi && document.activeElement !== vsi) vsi.value = String(bedVShotClampSec(num(bt.vidSec) || 6));
  // 旧版「按页旁白切片」数据：仅当没有新分镜时展示（新管线启用后由上方分镜区取代）
  var vst = $('bed-video-status'); if(vst) vst.textContent = (bt.videoStatus && !bt.vshots.length) ? ('旧版片段状态：' + bt.videoStatus) : '';
  var vc = $('bed-video-clips');
  if(vc && !bt._moviePlaying && !bt.vshots.length){
    var all = bedAllClips();
    var planned = 0; bt.pages.forEach(function(p){ if(Array.isArray(p.clips)) planned += p.clips.length; });
    var failed = planned - all.length;
    if(planned){
      var h = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0">'
        + '<button id="bed-movie-play" class="bed-btn">▶ 连播全部片段</button>'
        + '<span style="font-size:12px;color:#9aa">共 ' + all.length + '/' + planned + ' 段（旧版按页切片 · 旁白配音 + 轻柔背景音乐；与③单独下载的 TTS 音色不同）'
        + (failed ? ' · <span style="color:#f99">' + failed + ' 段失败/缺失（旧版数据；新短视频请用上方分镜区，点 ④ 走新流程）</span>' : '') + '</span></div>';
      bt.pages.forEach(function(p, pi){
        if(!Array.isArray(p.clips)) return;
        p.clips.forEach(function(u, si){
          if(u){
            h += '<div style="margin:6px 0"><div style="font-size:12px;color:#9aa">第 ' + (pi + 1) + ' 页 · 片段 ' + (si + 1) + '</div>'
              + '<video src="' + u + '" controls style="width:100%;max-width:360px;display:block;border-radius:8px"></video></div>';
          } else {
            h += '<div style="margin:6px 0;padding:6px 8px;border:1px dashed #a55;border-radius:8px;font-size:12px;color:#f99">第 ' + (pi + 1) + ' 页 · 片段 ' + (si + 1) + '：失败/缺失（旧版数据，重做请用上方新分镜）</div>';
          }
        });
      });
      vc.innerHTML = h;
      var mp = $('bed-movie-play'); if(mp) mp.onclick = bedPlayMovie;
    } else { vc.innerHTML = ''; }
  }
  // 合成单音频（⑤）
  var mg = $('bed-merged');
  if(mg){
    if(bt.mergedAudioURL){
      mg.innerHTML = '<div style="margin:8px 0;padding:10px;border:1px solid #345;border-radius:10px;background:#0b1030">'
        + '<div style="font-size:13px;color:#8ad;margin-bottom:6px">🎧 合成单音频（' + (bt.mergedCount||0) + ' 段，段间 0.3s 停顿）</div>'
        + '<audio id="bed-merged-audio" controls style="width:100%"></audio>'
        + '<button id="bed-merged-dl" class="bed-btn" style="margin-top:8px">⬇ 下载单音频 (WAV)</button>'
        + '</div>';
      var ma = $('bed-merged-audio'); if(ma) ma.src = bt.mergedAudioURL;
      var md = $('bed-merged-dl'); if(md) md.onclick = function(){ doDownload(bt.mergedAudioURL, '睡前故事_单音频.wav'); };
    } else { mg.innerHTML = ''; }
  }
  // 绘本页
  var pg = $('bed-pages-grid'); if(!pg) return;
  pg.innerHTML = '';
  bt.pages.forEach(function(p, i){
    var card = document.createElement('div'); card.className = 'bed-card';
    if(p.imgErr) card.style.borderColor = '#a55';               /* 失败页红框标出，一眼可见 */
    var img = document.createElement('img'); img.className = 'bed-card-img'; img.src = p.imgURL || demoImage(i, p.text, bt.artStyle); img.alt = '第 ' + (i + 1) + ' 页';
    var txt = document.createElement('div'); txt.className = 'bed-card-txt'; txt.textContent = (i + 1) + '. ' + (p.text || '');
    /* 插画失败/缺失提示：刷新后依然能看到是哪一页失败、为什么（imgErr 已随故事落盘） */
    if(p.imgErr){
      var er = document.createElement('div');
      er.style.cssText = 'font-size:12px;color:#f99;padding:0 8px 6px;line-height:1.4';
      er.textContent = '插画失败：' + p.imgErr + '（点下方按钮仅重画此页）';
      card.appendChild(er);
    }
    var aud = document.createElement('div'); aud.className = 'bed-card-aud';
    if(p.audURL){ var a = document.createElement('audio'); a.controls = true; a.src = p.audURL; a.style.width = '100%'; aud.appendChild(a); }
    else { aud.textContent = p.audErr ? '音频失败：' + p.audErr : '（未生成音频）'; aud.style.color = '#888'; aud.style.fontSize = '12px'; }
    var dl = document.createElement('button'); dl.textContent = '下载音频'; dl.onclick = function(){ downloadPageAudio(i); };
    /* v2.59：单页重画——对某一幅插画不满意（或上次失败）时只重做这一页，不动其它页 */
    var rg = document.createElement('button');
    rg.textContent = p._imgRunning ? '↻ 重画中…' : '↻ 重画插画';
    rg.disabled = !!p._imgRunning;
    rg.onclick = function(){ regenBedtimeImage(i); };
    card.appendChild(img); card.appendChild(txt); card.appendChild(aud); card.appendChild(dl); card.appendChild(rg);
    pg.appendChild(card);
  });
  /* 插画生成进行中：禁用批量按钮，避免起第二条链抢写同一批页面 */
  var gi = $('bed-gen-img'), ga = $('bed-regen-img-all');
  if(gi) gi.disabled = !!bt._genImgRunning;
  if(ga) ga.disabled = !!bt._genImgRunning;
  saveBedtime();                              /* v2.56：每次渲染即落盘，文字/图片随刷新保留 */
}
initBedtimeState();
