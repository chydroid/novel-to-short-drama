/* =========================================================
   小说转短剧工作台
   分层：数据层 → 计算层 → 渲染层（单向调用，无环）
   严禁渲染函数之间互相调用，统一由 refreshAll() 调度
   ========================================================= */
var DB_ID = 'AolzNRs7EEyxMBxDlX7LLU';        // 分镜表
var ASSET_DB_ID = 'BMl6SDoOP03s6IgjJHiOQJ';  // 角色与场景设定表
var LS = 'wb_novel2drama_';

var state = {
  shots: [],
  assets: [],   // 角色卡 + 场景卡
  pid: 'prj_default',   // v2.49：当前剧目 id
  projects: [],         // v2.49：剧目列表 [{id,name,createdAt,updatedAt}]
  view: 'script',
  filter: 'all',
  expanded: {},
  online: true,
  hasCloud: true,
  syncing: false,
  budgetWarned: false,   // v2.47：预算横幅是否已弹过提示（避免批量生成时反复 toast）
  busy: {},      // shotId -> true 表示正在生成中
  chapters: [],  // 长篇：识别出的章节（含正文，只存内存）
  pipe: { running: false, stop: false },
  pipeOpts: null,
  undo: [],         // v2.31：撤销栈（整表快照，最近 UNDO_SAVE 条落本机）
  redo: [],         // v2.32：重做栈，与撤销栈同一套存法
  undoHistOpen: false,   // v2.39：「历史」面板是否展开
  syncMsg: '',      // v2.31：同步条上的临时进度文案
  serialTag: '',    // v2.32：正在跑的批量任务名（有值才显示「停止」）
  stopSerial: '',   // v2.32：已请求停止的任务名
  poolFail: 0,      // v2.35：本轮 runPool 里彻底失败的项数（worker 吞错时也能记上）
  lastBatchBad: 0,  // v2.36：上一次 batchRun 的失败条数（流水线靠它对账，别把失败当完成）
  pipeBad: 0        // v2.36：本轮流水线累计失败数
};
var cfg = {};
var pollers = {};   // shotId -> intervalId

/* ---------------- 工具 ---------------- */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/* v2.52：本机存储写入统一走这里。
   localStorage 在配额写满、或 Safari 隐私模式下 setItem 会直接抛异常。
   小说正文是唯一只存本地、云端没有副本的输入——写入失败还闷声不响的话，
   用户就会「以为存住了，刷新后整篇没了」。所以失败必须显式告知本人。 */
var _lsWarn = {};
/* v2.53：写入失败时的「腾挪」——先把最老的几条本机配音缓存删掉，再试一次。
   本应用把每镜配音以 base64 存在 localStorage，单条就能几百 KB；配额一旦写满，
   之后**所有**写入（分镜兜底、配置、剧目列表、章节、撤销栈、续跑存档）会全线失败。
   配音缓存是「可再生」的（重跑一次即可，费钱但不丢数据），
   而分镜 / 章节 / 配置是「不可替代」的（丢了就是真丢），所以腾挪方向只能是这样。
   只清 n 条，且失败不影响主流程。返回实际清掉的条数。 */
function lsFreeAud(n){
  var kill = [], i;
  try{
    for(i = 0; i < localStorage.length; i++){
      var k = localStorage.key(i);
      if(!k || k.indexOf(LS) !== 0) continue;
      if(k.indexOf(':aud_') > -1 || k.indexOf(LS + 'aud_') === 0) kill.push(k);
    }
  }catch(e){ return 0; }
  kill.sort();
  var freed = 0;
  for(i = 0; i < kill.length && freed < (n || 3); i++){
    try{ localStorage.removeItem(kill[i]); freed++; }catch(e){}
  }
  return freed;
}
function lsSet(k, v, opt){
  opt = opt || {};
  try{ localStorage.setItem(k, v); return true; }
  catch(e){
    /* 先腾挪再试一次：opt.free === false 时不做（音频自己就是腾挪对象，别自己删自己陷入递归）。
       腾挪整段再包一层 try：万一它自己出错，也不能连累「原本能写成功」的这一次写入。 */
    if(opt.free !== false){
      try{
        if(lsFreeAud(3)){
          try{ localStorage.setItem(k, v); return true; }catch(e2){}
        }
      }catch(e3){}
    }
    if(opt.warn && !_lsWarn[k]){
      _lsWarn[k] = 1;
      toast(opt.msg || '本机存储写入失败（空间已满或浏览器限制）：当前内容没能存下来，请先导出备份');
    }
    return false;
  }
}
/* v2.53：设定卡本机写入统一收口——原来 7 处各写各的 try/catch(e){}，写失败全静默 */
function lsSaveAssets(){
  return lsSet(pk('assets'), JSON.stringify(state.assets),
    { warn:true, msg:'设定卡本机保存失败（存储已满）：请导出备份后清理部分配音缓存' });
}
/* v2.52：内联图标。v2.50 只换了播放器与剧目弹窗，这里补齐剩余按钮上的字符图标。 */
var ICONS = {
  up:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
  x:'<path d="M18 6L6 18M6 6l12 12"/>',
  pen:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/>',
  star:'<path d="M12 2l3.1 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.9-1.01L12 2z" fill="currentColor" stroke="none"/>',
  starO:'<path d="M12 2l3.1 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.9-1.01L12 2z"/>',
  dot:'<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  dotO:'<circle cx="12" cy="12" r="5.5"/>'
};
function svgIc(n, sz){
  var p = ICONS[n]; if(!p) return '';
  sz = sz || 14;
  return '<svg class="ic" width="'+sz+'" height="'+sz+'" viewBox="0 0 24 24" fill="none"'
    + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true">'+p+'</svg>';
}
function toast(msg){
  var t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._tm); t._tm = setTimeout(function(){ t.classList.remove('on'); }, 2400);
}
function nowStr(){
  var d = new Date(), p = function(n){ return (n<10?'0':'')+n; };
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
}
function download(name, text, mime){
  var b = new Blob([text], {type: mime || 'text/plain;charset=utf-8'});
  var u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(u); }, 200);
}
/* 向上找带 data-act / data-v 的祖先（兼容 SVG 内部元素，不依赖 Element.closest） */
function closestAct(el){
  var n = el;
  while(n && n !== document && n.nodeType){
    if(n.getAttribute && (n.getAttribute('data-act') || n.getAttribute('data-v'))) return n;
    n = n.parentNode;
  }
  return null;
}

/* ---- 自绘确认弹窗：资料库页面在 iframe 沙箱里，原生 confirm 会被静默拦截 ---- */
var _dlgResolve = null, _dlgInput = false;   /* v2.20：_dlgInput = 确定按钮要把输入框内容回传 */
function askConfirm(msg, okText, danger){
  return new Promise(function(resolve){
    $('dlgTitle').textContent = danger ? '危险操作' : '请确认';
    $('dlgMsg').textContent = msg;
    var yes = $('dlgYes');
    yes.textContent = okText || '确定';
    yes.className = 'btn' + (danger ? ' danger' : '');
    yes.style.display = '';
    $('dlgNo').style.display = '';
    $('dialog').classList.add('on');
    $('dlgMask').classList.add('on');
    _dlgInput = false;
    _dlgResolve = resolve;
  });
}
/* v2.20：自绘输入弹窗——原生 window.prompt 和 confirm 一样会被 iframe 沙箱静默拦截，
   而「存为预设 / 另存套餐」这类命名操作必须收一个字符串。确定返回 trim 后的名称（空则视为取消），
   取消返回 null；回车等同「确定」。 */
function askInput(msg, defVal, okText){
  return new Promise(function(resolve){
    $('dlgTitle').textContent = '请输入名称';
    $('dlgMsg').innerHTML = '<div style="margin-bottom:8px;color:var(--tx2);line-height:1.5">' + esc(msg) + '</div>' +
      '<input class="inp" id="dlgInput" style="width:100%" placeholder="给个名字，方便以后一眼认出" value="' + esc(defVal || '') + '">';
    var yes = $('dlgYes');
    yes.textContent = okText || '保存';
    yes.className = 'btn';
    yes.style.display = '';
    $('dlgNo').style.display = '';
    $('dialog').classList.add('on');
    $('dlgMask').classList.add('on');
    _dlgInput = true;
    _dlgResolve = resolve;
    setTimeout(function(){ var el = $('dlgInput'); if(el){ el.focus(); el.select(); } }, 30);
  });
}
function closeDlg(v){
  $('dialog').classList.remove('on');
  $('dlgMask').classList.remove('on');
  if($('dlgNo')) $('dlgNo').style.display = '';
  var inputMode = _dlgInput; _dlgInput = false;
  var r = _dlgResolve; _dlgResolve = null;
  if(!r) return;
  if(inputMode){
    var el = $('dlgInput'), val = el ? String(el.value || '').trim() : '';
    r((v && val) ? val : null);
    return;
  }
  r(v);
}
/* 弹窗被浏览器拦截时的兜底：直接在页面内预览 */
function previewMedia(url, kind){
  $('dlgTitle').textContent = kind === 'video' ? '分镜视频' : '分镜大图';
  var inner = kind === 'video'
    ? '<video src="'+esc(url)+'" controls autoplay playsinline></video>'
    : '<img src="'+esc(url)+'" referrerpolicy="no-referrer">';
  $('dlgMsg').innerHTML = '<div class="dlg-media">'+inner+'</div>' +
    '<a class="dlg-link" href="'+esc(url)+'" target="_blank" rel="noopener">若无法播放，点这里在新标签打开：'+esc(url)+'</a>';
  $('dlgNo').style.display = 'none';
  $('dlgYes').textContent = '关闭';
  $('dlgYes').className = 'btn';
  $('dialog').classList.add('on');
  $('dlgMask').classList.add('on');
  _dlgResolve = function(){};
}
function openUrl(url, kind){
  if(!url){ toast('这个镜头还没有可打开的地址'); return; }
  var w = null;
  try{ w = window.open(url, '_blank'); }catch(e){ w = null; }
  if(!w) previewMedia(url, kind);
}

