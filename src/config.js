/* ---------------- 配置 ---------------- */
var DEFAULT_CFG = {
  agnesKey:'', agnesBase:'https://apihub.agnes-ai.com/v1', agnesQuery:'https://apihub.agnes-ai.com',
  imgSize:'1K', imgRatio:'9:16', vidSec:'5', vidRatio:'9:16', vidSize:'720P',
  /* 生图/生视频模型可配置（默认 Agnes 2.5-flash）。改错只会在生成时被接口拒绝并提示，不会静默出错。 */
  imgModel:'agnes-image-2.5-flash', vidModel:'agnes-video-2.5-flash',
  ref:'', prefix:'', prevRef:false,
  refMode:'best', multiView:true, refMax:4,
  neg:'different face, changed hairstyle, changed outfit, deformed hands, extra fingers, extra limbs, watermark, text, logo, low quality',
  textBase:'https://api.openai.com/v1', textKey:'', textModel:'gpt-4o-mini',
  ttsKey:'', ttsBase:'https://api.xiaomimimo.com/v1', ttsModel:'mimo-v2.5-tts',
  ttsVoice:'mimo_default', ttsNarr:'白桦', ttsFormat:'mp3', ttsSync:true,
  lipBase:'', lipKey:'', lipMode:'get', lipAuto:false,
  pipeShots:6, pipeBatch:0, pipeChunk:3000,
  bgmUrl:'', bgmVol:0.18, bgmFade:2, cnRate:4.5,
  subFont:'Microsoft YaHei', subSize:14, subMargin:36, subColor:'FFFFFF', subOutlineColor:'000000', subOutline:1, subBold:true, subBg:false,
  costImg:0.1, costVidSec:0.5, costTts:0, costLip:0.1,
  usedImg:0, usedVidSec:0, usedTts:0, usedLip:0,
  /* v2.47：budgetCap = 预算硬上限（元）。填正数即开启，0 = 不限制。
     当前预估花费 = usageCost()（用量 × 单价）越过上限后，五个 AI 生成入口一律拦截，不再发请求。 */
  budgetCap:0,
  /* v2.5：并发队列 / 多 Key 轮换 / 成片输出参数 */
  agnesKeys:'', conc:2, retry:1,
  trans:'fade', transDur:0.5, kb:'in', fps:30, bitrate:'8M', stylePreset:'',
  /* v2.8：项目级「全局统一画风令牌」——对标 Jellyfish 的全局风格防漂移。
     填一段画风/年代/材质/光质描述，会固定注入每一个镜头（生图/生视频）的提示词尾部，
     让整部剧从第一镜到最后一镜保持同一视觉调性，而不是各镜自由发挥。 */
  globalStyle:'',
  /* v2.9：imgN = 「A/B 选优」一次生成的候选图数（2~3，1=不启用）；
     srtCue = 导出字幕时按逐句 cue 拆条（说话人/情绪/断句结构化）
     v2.10：batchCand = 批量生图/流水线也按候选数生成（静默存候选，跑完逐镜挑）；
     cueTts = 逐句 TTS（每句按自己的角色音色合成后拼接，解决一镜多说话人） */
  imgN:1, srtCue:true, batchCand:false, cueTts:false,
  /* v2.11：imgScore = A/B 选优面板给候选图算技术分（清晰度/曝光/饱和度）；
     ttsZip  = 逐句配音压成 webm/opus 再存本机（体积约 wav 的 1/10）；
     cueAlign= 导出字幕时，跑过逐句配音的镜头按每句真实音频时长切分（字幕与口型对齐） */
  imgScore:true, ttsZip:true, cueAlign:true,
  /* v2.12：imgCons  = 候选图评分里计入「与全剧色调一致性」（占 25%）；
     ttsConc = 逐句配音的并发路数（1~3，2 为默认，结果仍按句序拼接）；
     trackZip= 整轨配音导出压缩版 webm/opus（默认关，需实时录制，耗时≈音频总长） */
  imgCons:true, ttsConc:2, trackZip:false,
  /* v2.13：imgSafe = 候选图评分里计入构图安全区（底部过挤 / 主体贴边被裁 / 重心偏离） */
  imgSafe:true,
  /* v2.14：imgSubj = 候选图评分里计入人物主体占比（肤色像素比例近似，免模型） */
  imgSubj:true,
  /* v2.16：genre = 剧集画面类型（auto/modern/costume/anime），按类型调评分阈值。
     v2.17：补进 DEFAULT_CFG——loadCfg 只回填「已在 cfg 里的键」，之前漏了导致刷新后类型选择丢失。
     genrePrompt = 是否把该画面类型也写进生成提示词（默认开，auto 本身无描述等同不注入）。 */
  genre:'auto', genrePrompt:true,
  /* v2.17：expScope = 一键打包的默认范围（all/done/filter/chapter/range），记住上次选择 */
  expScope:'all',
  /* v2.18：自定镜号区间的起止（0 = 不限该端）。v2.19 起界面改用 expRange 表达式，
     这两个键保留只为迁移老配置，不再在界面出现。 */
  expFrom:0, expTo:0,
  /* v2.19：自定镜号表达式（多段 + 排除），如 "1-20,25,30-35" 或 "1-50,!8-10" */
  expRange:'',
  /* v2.20：rangePresets = 镜号表达式的常用预设 [{n:'名', v:'表达式'}]，一键套用，免每次手打；
     genrePresets = 用户自定义的类型套餐 [{n, style, globalStyle, prompt}]（内置三套之外的私有配方）。 */
  rangePresets:[],
  genrePresets:[],
  /* v2.22：filterExpr = 「按镜号选区」筛选用的表达式（与导出范围同一套写法，可用 @预设名）；
     bundleHealth / bundleLeft = 一键打包时是否顺手带上体检报告 / 剩余清单（默认不勾，包保持精简）。 */
  filterExpr:'',
  bundleHealth:false,
  bundleLeft:false,
  /* v2.23：filterViews = 命名筛选视图 [{n, mode, expr}]，把常用筛选存下来一键切回；
     bundlePick = 一键打包时「只打这些文件」的勾选（srt/md/csv/json/ff/xlsx）。
     v2.24：pipelinePick = 首页流水线可自定义要跑的步骤（图/视频/配音/对口型）；
     bundleStatus = 一键打包时按镜头状态二次筛选（all/noimg/novid/cand/fail/done）。 */
  filterViews:[],
  bundlePick:{ srt:true, md:true, csv:true, json:true, ff:true, xlsx:false },
  pipelinePick:{ img:true, vid:true, audio:true, lip:false },
  bundleStatus:'all',
  /* v2.29：healthOpen = 体检明细里各问题类型分组的展开状态 { 问题类型: true/false }。
     没记住的类型回落「硬性组默认展开」，所以不配也不会错。 */
  healthOpen:{}
};
function loadCfg(){
  cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
  try{
    var raw = localStorage.getItem(pk('cfg'));
    if(raw){ var o = JSON.parse(raw); for(var k in o){ if(k in cfg) cfg[k] = o[k]; } }
  }catch(e){}
}
function saveCfg(){
  /* v2.55：原来裸 setItem + 静默 catch——配额写满时设置全部静默丢失（刷新后 Key、
     提示词前缀、筛选视图、风格套餐全回到默认）。改走 lsSet：先腾挪可再生配音缓存再试，
     仍失败则 toast 告知，绝不再静默吞。 */
  lsSet(pk('cfg'), JSON.stringify(cfg),
    { warn:true, msg:'设置保存失败（本机存储已满）：本次改动刷新后不保留，请先导出备份' });
  fillSettings();
}
/* ---------- 多 API Key 轮询（对标 moyin-creator 的 API key rotation） ----------
   多个 Key 每行一个，依次轮换；遇 429/401/403 自动换下一个重试一次，抗限流。 */
function keyList(){
  var out = [];
  String(cfg.agnesKeys || '').split(/[\n,;]/).forEach(function(k){ k = k.trim(); if(k) out.push(k); });
  if(!out.length && cfg.agnesKey) out.push(cfg.agnesKey);
  else if(cfg.agnesKey && out.indexOf(cfg.agnesKey) === -1) out.push(cfg.agnesKey);
  return out;
}
function hasAgnesKey(){ return !!keyList().length; }
/* v2.56：密钥轮询序号持久化——原来只存内存，刷新回到第 0 把，多 Key 负载均衡跨刷新不连续。
   懒加载一次 + 防抖落盘（避免每次取 Key 都写 localStorage 拖慢批量）。 */
var KEY_IDX_KEY = LS + 'keyIdx', _keyIdxLoaded = false, _keyIdxTm = 0;
function persistKeyIdx(){
  clearTimeout(_keyIdxTm);
  _keyIdxTm = setTimeout(function(){
    try{ lsSet(KEY_IDX_KEY, String(state.keyIdx)); }catch(e){}
  }, 1500);
}
function ak(){
  var l = keyList();
  if(!l.length) return cfg.agnesKey || '';
  if(!_keyIdxLoaded){
    _keyIdxLoaded = true;
    try{ var sv = parseInt(localStorage.getItem(KEY_IDX_KEY), 10); if(isFinite(sv) && sv >= 0) state.keyIdx = sv; }catch(e){}
  }
  if(typeof state.keyIdx !== 'number') state.keyIdx = 0;
  var r = l[(state.keyIdx++) % l.length];
  persistKeyIdx();
  return r;
}
/* 带 Key 轮换的 POST：限流/鉴权失败时自动换下一个 Key 重试 */
function apiPostAgnes(url, body, tries){
  tries = tries || 0;
  var key = ak();
  return apiPost(url, key, body).then(function(r){
    var limited = (r.status === 429 || r.status === 401 || r.status === 403);
    if(limited && tries < Math.max(1, keyList().length)){
      return apiPostAgnes(url, body, tries + 1);
    }
    return r;
  });
}
/* ---------- 并发任务池（对标 moyin-creator 的 multi-task parallel queue） ----------
   list: 任务数组；worker(item) 返回 Promise；失败自动重试 cfg.retry 次；
   onOne(done, total) 每完成一个回调一次。 */
/* ---------------- v2.14：批量进度条 ----------------
   原来批量任务只靠 toast 刷「进度 3/20」，一是刷屏、二是看不到失败数、三是没法中途停。
   这里给一个常驻的进度面板：标题 + 已完成/总数 + 失败数 + 进度条 + 停止按钮。 */
var _bbFail = 0, _bbTimer = 0;
function batchBarOpen(title){
  _bbFail = 0;
  var b = $('bbar'); if(!b) return;
  clearTimeout(_bbTimer);
  state.batchPause = false;                     /* v2.15：新任务重置暂停状态 */
  if($('bbarPause')) $('bbarPause').textContent = '暂停';
  $('bbarT').textContent = title || '批量处理';
  $('bbarMsg').textContent = '';
  $('bbarFill').style.width = '0%';
  $('bbarC').textContent = '准备中…';
  b.classList.add('on');
}
function batchBarStep(done, total){
  var b = $('bbar'); if(!b) return;
  var pct = total ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 0;
  $('bbarFill').style.width = pct + '%';
  $('bbarC').textContent = total ? (done + ' / ' + total + (_bbFail ? '　失败 ' + _bbFail : '')) : '准备中…';
}
function batchBarMsg(t){ var el = $('bbarMsg'); if(el) el.textContent = t || ''; }
function batchBarFail(){ _bbFail++; }
/* v2.15：暂停 / 继续——暂停后不再取新任务，正在跑的这几项跑完就停在那儿，点「继续」接着跑。
   注意「续跑」的另一半是天然支持的：批量入口本来就按「未生成 / 失败」筛选，
   所以中途关页面也没关系，重新点一次批量就是接着跑未完成的。 */
function toggleBatchPause(){
  state.batchPause = !state.batchPause;
  var btn = $('bbarPause');
  if(btn) btn.textContent = state.batchPause ? '继续' : '暂停';
  batchBarMsg(state.batchPause ? '已暂停（正在跑的这几项会跑完），点「继续」接着跑' : '已继续');
  toast(state.batchPause ? '已暂停' : '已继续');
}
function batchBarClose(msg, kind){
  var b = $('bbar'); if(!b) return;
  state.batchPause = false;
  if($('bbarPause')) $('bbarPause').textContent = '暂停';
  $('bbarFill').style.width = '100%';
  /* v2.16：如果暂停/停止导致还有没跑完的，把剩余数量写进收尾提示，用户不会「不知道还剩多少」 */
  var left = batchLoadLeft(kind);   /* v2.19：按类型取，不再需要自行比对 kind */
  if(left && left.ids && left.ids.length){
    msg = (msg || '') + '　还剩 ' + left.ids.length + ' 个' + batchLeftName(left.kind) + '未完成';
  }
  batchBarMsg(msg || '');
  clearTimeout(_bbTimer);
  _bbTimer = setTimeout(function(){ b.classList.remove('on'); }, msg ? 3200 : 0);
}
/* ---------------- v2.16：批量剩余进度持久化 ----------------
   暂停后关页面 / 刷新，跑没跑完这件事就丢了，用户得自己回想「哪些是没生成的」。
   这里把「剩余镜号」写进本机存档：一是收尾提示能报准数，二是下次打开页面直接告诉你还剩多少，
   批量入口本来就按「未生成 / 失败」筛选，所以点一下批量就是按未完成项续跑。
   v2.19：按类型分条存，三类任务互不挤占，可各自续跑。 */
var BATCH_KIND_NAME = { img:'生图', vid:'生视频', audio:'配音', lip:'对口型' };
function batchLeftKey(){ return pk('batchLeft'); }
function batchLeftName(kind){ return BATCH_KIND_NAME[kind] || '任务'; }
/* v2.23：状态字段名与「缺什么」判定都收敛到这两处——以前散在批量和清单好几处 if-else 里，
   加「口型」这个新类型时最容易漏改其中一处，导致清单里的状态列读错字段。 */
function batchStKey(kind){
  if(kind === 'img') return '图片状态';
  if(kind === 'audio') return '配音状态';
  if(kind === 'lip') return '口型状态';
  return '视频状态';
}
function leftWhyTxt(kind, s){
  if(kind === 'vid' && !s['图片URL']) return '没图片';
  if(kind === 'audio' && !String(s['台词旁白'] || '').trim()) return '没台词';
  if(kind === 'lip' && !s['视频URL']) return '没视频';
  if(kind === 'lip' && String(s['口型风险'] || lipRiskOf(s)) !== '高') return '口型风险不高';
  return '';
}
/* v2.19：存档从「只有一条」改成「按类型分条」——生图、生视频、配音可以各自留着各自的剩余，
   三个都能同时续跑；以前只有一条，跑配音就会把生图的剩余挤掉。
   存储结构：{ img:{ids,total,at}, vid:{...}, audio:{...} }。
   读到旧格式（单条、自带 kind 字段）会自动迁移成新结构，老用户的剩余不会丢。 */
function batchLoadAll(){
  var raw = null;
  try{ raw = JSON.parse(localStorage.getItem(batchLeftKey()) || 'null'); }catch(e){ return {}; }
  if(!raw || typeof raw !== 'object') return {};
  if(raw.kind){   /* 旧单条格式 → 迁移 */
    var one = {}; one[raw.kind] = { ids: raw.ids || [], total: num(raw.total) || (raw.ids || []).length, at: raw.at || '' };
    return one;
  }
  return raw;
}
function batchSaveAll(map){
  var any = false, k;
  for(k in map){ if(map[k] && map[k].ids && map[k].ids.length){ any = true; break; } }
  try{
    if(!any) localStorage.removeItem(batchLeftKey());
    else lsSet(batchLeftKey(), JSON.stringify(map), { warn:true, msg:'续跑存档保存失败（存储已满）：中断后可能无法继续上次进度' });
  }catch(e){}
}
/* 指定 kind 就取那一条（自带 kind 字段）；不指定时返回「当前剩下的第一条」，供不关心类型的收尾提示用 */
function batchLoadLeft(kind){
  var all = batchLoadAll(), k;
  if(kind){ var r = all[kind]; return (r && r.ids && r.ids.length) ? { kind: kind, ids: r.ids, total: num(r.total) || r.ids.length, at: r.at || '' } : null; }
  for(k in all){ if(all[k] && all[k].ids && all[k].ids.length) return { kind: k, ids: all[k].ids, total: num(all[k].total) || all[k].ids.length, at: all[k].at || '' }; }
  return null;
}
function batchSaveLeft(kind, list, total){
  if(!kind) return;
  var all = batchLoadAll(), ids = [];
  (list || []).forEach(function(s){ var n = num(s && s['镜号']); if(n) ids.push(n); });
  if(ids.length) all[kind] = { ids: ids, total: num(total) || ids.length, at: nowStr() };
  else delete all[kind];
  batchSaveAll(all);
}
/* 不传 kind = 清掉全部类型；传了就只清那一类（「忽略」按钮只忽略自己那张卡） */
function batchClearLeft(kind){
  if(!kind){ try{ localStorage.removeItem(batchLeftKey()); }catch(e){} return; }
  var all = batchLoadAll(); delete all[kind]; batchSaveAll(all);
}
/* 打开页面时提示上次还剩多少，并在对应批量按钮上挂「（续跑 N）」角标 */
function batchLeftTip(){
  /* v2.19：三类各自可能有剩余，逐类挂「（续跑 N）」角标并汇总成一条提示 */
  var all = batchLoadAll(), kinds = [], msg = [];
  ['img','vid','audio','lip'].forEach(function(k){
    var r = all[k]; if(!r || !r.ids || !r.ids.length) return;
    kinds.push(k); msg.push(batchLeftName(k) + ' ' + r.ids.length + ' 个');
    /* v2.23：加了口型类型——它对应「批量对口型」按钮 */
    var btn = k === 'audio' ? $('btnBatchAudio')
            : (k === 'img' ? $('btnBatchImg')
            : (k === 'vid' ? $('btnBatchVid')
            : $('btnLipBatch')));
    if(btn && btn.tagName === 'BUTTON'){
      btn.textContent = String(btn.textContent).replace(/（续跑 \d+）/, '') + '（续跑 ' + r.ids.length + '）';
    }
  });
  if(kinds.length) toast('上次未完成：' + msg.join('、') + '，可用首页「续跑」卡的「只跑剩余镜」继续');
  renderToday();   /* v2.17：首页「现在要处理」也要出现续跑卡（refreshAll 在本函数之前已跑过） */
}
/* v2.17：把剩余镜号缩成「1, 3, 7 等」，太长就省略，首页卡片不至于被撑爆 */
function leftNosPreview(ids, max){
  var n = Math.max(1, num(max) || 6), arr = ids || [], head = arr.slice(0, n).join(', ');
  return arr.length > n ? head + ' 等' : head;
}
/* v2.20：把某类型的剩余镜号导成清单——离线核对用（例如发给负责生图 / 配音的同事）。
   按「镜号 / 章节 / 景别 / 当前状态 / 缺什么」列成 TSV，Excel 直接能开。 */
/* v2.21：清单改成真正的 CSV（逗号分隔 + 需要时加引号），导出时再加 UTF-8 BOM——
   之前是无 BOM 的 TSV，Windows 版 Excel 打开中文会乱码，而且默认分隔符未必是 Tab。 */
function csvCell(v){
  var s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? ('"' + s.replace(/"/g, '""') + '"') : s;
}
function csvRow(arr){ return (arr || []).map(csvCell).join(','); }
function buildLeftText(kind){
  var rec = (batchLoadAll() || {})[kind];
  if(!rec || !rec.ids || !rec.ids.length) return null;
  var byNo = {};
  (state.shots || []).forEach(function(s){ byNo[String(num(s['镜号']))] = s; });
  var stKey = batchStKey(kind);
  var lines = [];
  lines.push(csvRow(['剩余' + batchLeftName(kind) + '清单']));
  lines.push(csvRow(['导出时间', nowStr()]));
  lines.push(csvRow(['计划总数', num(rec.total) || rec.ids.length, '未完成', rec.ids.length, '上次记录', rec.at || '—']));
  lines.push('');
  lines.push(csvRow(['镜号', '章节', '景别', '当前状态', '缺什么']));
  var gone = 0;
  rec.ids.forEach(function(no){
    var s = byNo[String(num(no))];
    if(!s){ gone++; lines.push(csvRow([no, '（镜头已删除）', '', '', ''])); return; }
    lines.push(csvRow([no, s['章节'] || '', s['景别'] || '', s[stKey] || '未生成', leftWhyTxt(kind, s)]));
  });
  lines.push('');
  if(gone) lines.push('注：有 ' + gone + ' 个镜号在当前分镜里已找不到（可能被删除），可点「忽略」清掉这类记录。');
  lines.push('说明：本清单只列「上次批量没跑完」的镜号；回首页点续跑卡的「只跑剩余镜」即可接着跑。');
  return lines.join('\n');
}
function exportLeftList(kind){
  var txt = buildLeftText(kind);
  if(!txt){ toast('这一类型当前没有剩余记录'); return; }
  download('剩余' + batchLeftName(kind) + '清单_' + nowStr().replace(/[: ]/g, '-') + '.csv', '\ufeff' + txt, 'text/csv;charset=utf-8');
  toast('已导出剩余' + batchLeftName(kind) + '清单（CSV，Excel 可直接打开）');
}
function runPool(list, worker, onOne, opts){   /* v2.17：补回第 4 个参数 opts——v2.16 漏了形参，函数体里的 opts.kind 会抛 ReferenceError，收尾逻辑全废 */
  var conc = Math.max(1, Math.min(8, num(cfg.conc) || 1));
  var retryN = Math.max(0, Math.min(3, num(cfg.retry)));
  var total = list.length, done = 0, i = 0;
  state.poolFail = 0;                       /* v2.35：本轮失败计数，收尾如实汇报 */
  function one(item){
    var attempt = 0, lastErr = null;
    function run(){
      if(state.stopBatch) return Promise.resolve();
      return Promise.resolve()
        .then(function(){ return worker(item); })
        .then(function(){
          /* v2.35：绝大多数 worker（genImage / genVideo / genAudio / genLipsync）自己 catch 掉错误、
             只把状态字段写成「失败」然后正常 resolve——光看 Promise 永远不知道失败了，
             于是下面这个 retryN 重试**一次都没跑过**（而确认框上还写着「失败自动重试 N 次」）。
             这里用 opts.isFail 按**最新内存状态**再判一次，判定失败就照旧退避重试。 */
          if(opts && opts.isFail && opts.isFail(item)){
            attempt++;
            if(attempt <= retryN) return wait(1500 * attempt).then(run);
            state.poolFail++;                          /* 重试到头还是失败态，记账 */
          }
        })
        .catch(function(e){
          attempt++;
          if(attempt <= retryN){
            return wait(1500 * attempt).then(run);   /* 退避重试，不影响其它并发任务 */
          }
          console.error(e);
          state.poolFail++;                          /* v2.35：统一记账 */
          lastErr = e;
        });
    }
    /* v2.14：onOne 多带一个 item，好让调用方在每项完成时统计失败数
       v2.35：再带 err（成功为 null），调用方不必自己猜 */
    return run().then(function(){ done++; if(onOne) onOne(done, total, item, lastErr); });
  }
  /* v2.15：暂停时不再取新任务——等 state.batchPause 解除（或收到停止）再继续取下一个 */
  function waitResume(){
    if(!state.batchPause) return Promise.resolve();
    return new Promise(function(res){
      var t = setInterval(function(){
        if(!state.batchPause || state.stopBatch){ clearInterval(t); res(); }
      }, 250);
    });
  }
  var workers = [];
  for(var k = 0; k < Math.min(conc, total); k++){
    workers.push((function worker(){
      if(state.stopBatch || i >= total) return Promise.resolve();
      return waitResume().then(function(){
        if(state.stopBatch || i >= total) return Promise.resolve();
        var item = list[i++];
        return one(item).then(worker);
      });
    })());
  }
  return Promise.all(workers).then(function(){
    /* v2.16：暂停/停止导致没跑完时，把剩余镜号存下来；正常跑完则清掉存档。
       v2.18：opts 扩展为 {kind, ids}——ids 是本次批量「计划要跑的镜」ID 全集，写进存档当分母，
       续跑卡就能说清「共 N 个里还剩 M 个」，而不是只报一个孤零零的剩余数。
       v2.19：存档按 kind 分条，这里不再需要「和现有记录比对类型」，直接写/清自己那一条。 */
    var left = list.slice(i), kind = opts && opts.kind;
    if(kind){
      var planned = (opts.ids && opts.ids.length) || 0;
      if(left.length && (state.stopBatch || state.batchPause)) batchSaveLeft(kind, left, planned);
      else batchClearLeft(kind);
    }
    return left.length;
  });
}

/* ---------- 用量与成本追踪（对标 ArcReel 成本追踪） ---------- */
function bumpUse(k, n){ cfg[k] = num(cfg[k]) + (n || 1); saveCfg(); if(budgetExceeded()) showBudgetBanner(); }
/* v2.47：预算硬上限（成本闸）——防止昂贵的 AI 生成（图 / 视频 / 配音 / 口型）在不知情下超额。
   预算上限在设置里填一个正数开启，0 = 不限制。判定口径与成本追踪完全一致：预估花费 = usageCost()（用量 × 单价）。 */
function budgetExceeded(){
  /* 用 1e-9 容差，避免浮点边界（如 ¥0.30 上限、花费正好 0.30）被误判为未超 */
  return num(cfg.budgetCap) > 0 && usageCost() >= num(cfg.budgetCap) - 1e-9;
}
function showBudgetBanner(){
  var b = $('budgetBanner'); if(!b) return;
  var t = b.querySelector('.txt');
  if(t) t.textContent = '已达预算上限 ¥' + num(cfg.budgetCap).toFixed(2) + '（已花费 ¥' + usageCost().toFixed(2) +
    '）。在「设置 → 用量与成本追踪」提高上限，或清空用量后可继续生成。';
  b.classList.add('show');
}
function hideBudgetBanner(){ var b = $('budgetBanner'); if(b) b.classList.remove('show'); }
function guardBudget(){
  if(!budgetExceeded()) return false;
  showBudgetBanner();
  if(!state.budgetWarned){
    state.budgetWarned = true;
    toast('已达预算上限 ¥' + num(cfg.budgetCap).toFixed(2) + '，已停止生成（花费 ¥' + usageCost().toFixed(2) + '）');
  }
  return true;
}
function usageCost(){
  return num(cfg.usedImg) * num(cfg.costImg) + num(cfg.usedVidSec) * num(cfg.costVidSec) +
         num(cfg.usedTts) * num(cfg.costTts) + num(cfg.usedLip) * num(cfg.costLip);
}
function usageLine(){
  var cost = usageCost();
  return '已用：图片 ' + num(cfg.usedImg) + ' 张 · 视频 ' + num(cfg.usedVidSec) + ' 秒 · 配音 ' + num(cfg.usedTts) +
    ' 条 · 口型 ' + num(cfg.usedLip) + ' 次' + (cost > 0 ? ' · 预估花费 ¥' + cost.toFixed(2) : '') +
    (cfg.bgmUrl ? ' · BGM 已配置' : '');
}
/* 批量前的成本预估文案：list 是待处理镜头，opts 指明要估算哪几类 */
function costEstimateTxt(list, opts){
  var imgs = 0, vids = 0, secs = 0, auds = 0, lips = 0;
  list.forEach(function(s){
    var is = s['图片状态'] || '未生成', vs = s['视频状态'] || '未生成';
    if(opts.img && (is === '未生成' || is === '失败')) imgs += (num(opts.imgN) || 1);
    if(opts.vid && (vs === '未生成' || vs === '失败') && s['图片URL']){ vids++; secs += Math.min(12, Math.max(4, num(s['时长秒']) || 5)); }
    if(opts.audio && String(s['台词旁白'] || '').trim() && (s['配音状态'] || '未生成') !== '已完成') auds++;
    if(opts.lip && (s['口型风险'] || lipRiskOf(s)) === '高' && s['视频URL']) lips++;
  });
  var cost = imgs * num(cfg.costImg) + secs * num(cfg.costVidSec) + auds * num(cfg.costTts) + lips * num(cfg.costLip);
  var parts = [];
  if(imgs) parts.push(imgs + ' 张图');
  if(vids) parts.push(vids + ' 段视频约 ' + Math.round(secs) + ' 秒');
  if(auds) parts.push(auds + ' 条配音');
  if(lips) parts.push(lips + ' 次口型');
  if(!parts.length) return '';
  return '本次将生成：' + parts.join('、') + (cost > 0 ? '，预估花费 ¥' + cost.toFixed(2) : '') + '。';
}

