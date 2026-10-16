/* ---------------- 示例数据 ---------------- */
function seedDemo(){
  var assets = [
    { 类型:'角色', 名称:'林小满',
      中文描述:'17 岁高中女生，齐刘海黑色长发，身材纤细，穿白色校服衬衫 + 藏青色百褶裙',
      英文锚点:'a 17-year-old Chinese high school girl, shoulder-length straight black hair with blunt bangs, slender build, pale skin, almond eyes, wearing a white school shirt with navy collar and a navy pleated skirt',
      性别年龄:'女 / 17 岁', 常服:'white school shirt with navy collar and navy pleated skirt',
      性格语气:'内向寡言，声音细，紧张时会结巴', TTS音色:'茉莉', TTS风格:'胆怯、小声、紧张', 语速:'偏慢',
      状态:'未生成' },
    { 类型:'角色', 名称:'陈老师',
      中文描述:'40 岁男教师，黑色短发，微胖，黑框眼镜，灰色 polo 衫',
      英文锚点:'a 40-year-old Chinese male teacher, short neat black hair, slightly heavyset, black rectangular glasses, calm expression, wearing a grey polo shirt and dark trousers',
      性别年龄:'男 / 40 岁', 常服:'grey polo shirt and dark trousers',
      性格语气:'严厉克制，语速慢，带压迫感', TTS音色:'白桦', TTS风格:'低沉、平稳、有威严', 语速:'偏慢',
      状态:'未生成' },
    { 类型:'场景', 名称:'高三2班教室',
      中文描述:'老式高中教室，六排双人木课桌朝向讲台，正前方绿色黑板，左侧三扇大窗，米黄色墙',
      英文锚点:'an old Chinese high school classroom, six rows of worn wooden double desks facing the front, a large green blackboard on the front wall, three tall windows on the left wall with daylight coming through, beige painted walls, fluorescent ceiling lights, grey tiled floor',
      性别年龄:'上午，左侧窗光 + 顶部日光灯', 常服:'六排双人木课桌面向讲台，正前方绿色黑板，左侧三扇窗',
      状态:'未生成' }
  ];
  var demo = [
    { 镜号:1, 画面描述:'清晨的教室，阳光从左侧窗户斜射进来，林小满独自坐在倒数第二排靠窗位', 英文提示词:'morning light streaming through the left windows, the girl sits alone at the second-to-last row by the window, quiet atmosphere, wide shot', 运镜:'镜头缓慢前推', 台词旁白:'这是她第三次在早自习迟到。', 时长秒:5, 出场角色:'林小满', 场景:'高三2班教室', 景别:'全景', 说话角色:'', 角色情绪:'困倦，躲避旁人目光', 图片状态:'未生成', 视频状态:'未生成' },
    { 镜号:2, 画面描述:'陈老师站在讲台上点名，目光看向林小满的方向', 英文提示词:'the male teacher stands at the podium taking attendance, looking toward the window side, medium shot', 运镜:'固定机位轻微摇镜', 台词旁白:'“林小满，你来回答一下。”', 时长秒:5, 出场角色:'陈老师, 林小满', 场景:'高三2班教室', 景别:'近景', 说话角色:'陈老师', 角色情绪:'平静但不容置疑', 图片状态:'未生成', 视频状态:'未生成' },
    { 镜号:3, 画面描述:'特写：林小满猛地抬头，笔从指间滑落', 英文提示词:'close-up of the girl looking up suddenly, a pen slipping from her fingers, shallow depth of field', 运镜:'微距推近', 台词旁白:'她的手在抖。', 时长秒:5, 出场角色:'林小满', 场景:'高三2班教室', 景别:'特写', 说话角色:'', 角色情绪:'惊惶，瞳孔收缩', 图片状态:'未生成', 视频状态:'未生成' },
    { 镜号:4, 画面描述:'全班寂静，所有同学回头看向林小满，她缓缓站起', 英文提示词:'the whole class turns back to look at the girl, she slowly stands up, tense silence, wide shot from the front', 运镜:'横移长镜头', 台词旁白:'三十七双眼睛，同时落在她身上。', 时长秒:6, 出场角色:'林小满', 场景:'高三2班教室', 景别:'全景', 说话角色:'', 角色情绪:'羞耻，强撑着不低头', 图片状态:'失败', 视频状态:'未生成', 错误信息:'示例：上次调用超时，可点「重新生图」重试' }
  ];
  var p = db();
  demo.forEach(function(d){ d['口型风险'] = lipRiskOf(d); d['口型状态'] = '不需要'; });
  var base = { 参考图URL:'', 错误信息:'', 更新时间:nowStr() };
  var shotBase = { 图片URL:'', 视频URL:'', 音频URL:'', 音频时长:0, 任务ID:'',
                   配音状态:'未生成', 满意锁定:'否', 错误信息:'', 更新时间:nowStr() };
  if(!p){
    assets.forEach(function(a){ state.assets.push(Object.assign({ _id: newId(), pid: state.pid }, base, a)); });
    lsSaveAssets();
    demo.forEach(function(d){ state.shots.push(Object.assign({ _id: newId(), pid: state.pid }, shotBase, d)); });
    localSave(state.shots); refreshAll();
    toast('已载入示例：2 张角色卡 + 1 张场景卡 + 4 个分镜');
    return;
  }
  setSync('busy');
  /* v2.31：两段都改 runSerial——原来第一条 addRecord 失败整链断，示例只载入一半
     （有角色卡没分镜，或有分镜没角色卡），外面还照样报「已载入示例」，用户以为齐了。
     现在设定卡 / 分镜各自汇总，缺哪部分说清楚，且分镜段不会被设定卡段的失败连累。 */
  runSerial(assets.map(function(a){
    return function(){
      return p.addRecord({ databaseId: ASSET_DB_ID, properties: toProps(Object.assign({ 参考图URL:'', 错误信息:'', 更新时间:nowStr(), pid: state.pid }, a)) });
    };
  }))
    .then(function(ra){ return loadAssets().then(function(){ return ra; }); })
    .then(function(ra){
      return runSerial(demo.map(function(d){
        return function(){ return p.addRecord({ databaseId: DB_ID, properties: toProps(Object.assign({ pid: state.pid }, shotBase, d)) }); };
      })).then(function(rs){ return { a: ra, s: rs }; });
    })
    .then(function(r){ return loadShots().then(function(){ return r; }); })
    .then(function(r){
      refreshAll();
      if(!r.a.fail && !r.s.fail){
        setSync('ok');
        toast('已载入示例：2 张角色卡 + 1 张场景卡 + 4 个分镜');
      }else{
        setSync('off');
        toast('示例只载入了一部分：设定卡 ' + r.a.ok + '/' + assets.length + '、分镜 ' + r.s.ok + '/' + demo.length + '（可再点一次「载入示例」补齐）');
      }
    })
    .catch(function(e){ console.error(e); toast('载入失败'); });
}

/* ---------------- 导出 ---------------- */
function exportJson(){
  var data = { exportedAt: nowStr(), novel: $('novel').value || '', assets: state.assets, shots: state.shots };
  /* v2.7：配音随备份恢复。音频 base64 较大，默认询问是否一并导出（不导仍可导整轨 .wav） */
  askConfirm('是否把每镜配音一并存进备份？', '要恢复配音就选“是”，文件会较大。', true)
    .then(function(includeAud){
      if(includeAud){
        var byNo = {};
        state.shots.forEach(function(s){
          var a = audLoad(s._id);
          if(a && a.b64) byNo[num(s['镜号'])] = { b64:a.b64, mime:a.mime, dur:a.dur };
        });
        data.audioByNo = byNo;
      }
      download('短剧工作台备份_' + nowStr().replace(/[: ]/g,'-') + '.json', JSON.stringify(data, null, 2), 'application/json');
      toast('已导出 JSON 备份' + (includeAud ? '（含配音）' : ''));
    });
}
/* 导入后，若备份里带音频，按「镜号」写回本机配音缓存（镜号在导入重排后仍稳定） */
function restoreBackupAudio(data){
  if(!data || !data.audioByNo) return;
  state.shots.forEach(function(s){
    var o = data.audioByNo[num(s['镜号'])];
    if(o && o.b64) audSave(s._id, o.b64, o.mime || 'audio/mpeg', o.dur || num(s['音频时长']) || 0);
  });
}
function buildMdText(scope){
  var L = scope || state.shots;
  var lines = ['# 分镜脚本', '', '> 导出时间：' + nowStr(), ''];
  if(state.assets.length){
    lines.push('## 角色与场景设定', '');
    state.assets.forEach(function(a){
      lines.push('- **' + (a['类型']||'') + '｜' + (a['名称']||'') + '**：' + (a['中文描述']||''));
      if(a['英文锚点']) lines.push('  - 锚点：`' + a['英文锚点'] + '`');
    });
    lines.push('');
  }
  L.forEach(function(s){
    lines.push('## 第 ' + s['镜号'] + ' 镜 · ' + (num(s['时长秒'])||5) + '秒 · ' + (s['景别']||'中景') +
      (s['章节'] ? '　〔' + s['章节'] + '〕' : ''));
    lines.push('- 画面：' + (s['画面描述'] || ''));
    if(s['出场角色']) lines.push('- 出场：' + s['出场角色']);
    if(s['场景']) lines.push('- 场景：' + s['场景']);
    if(s['角色情绪']) lines.push('- 情绪：' + s['角色情绪']);
    if(s['运镜']) lines.push('- 运镜：' + s['运镜']);
    if(s['口型风险'] && s['口型风险'] !== '低') lines.push('- 口型风险：' + s['口型风险'] +
      (s['口型状态'] === '已完成' ? '（已对口型）' : ''));
    if(s['台词旁白']) lines.push('- 台词/旁白（' + (s['说话角色'] || '旁白') + '）：' + s['台词旁白'] +
      (num(s['音频时长']) > 0 ? '　[语音 ' + num(s['音频时长']).toFixed(1) + ' 秒]' : ''));
    if(s['英文提示词']) lines.push('- 图像提示词：`' + s['英文提示词'] + '`');
    if(s['图片URL']) lines.push('- 图片：' + s['图片URL']);
    if(s['视频URL']) lines.push('- 视频：' + s['视频URL']);
    if(s['口型视频URL']) lines.push('- 口型视频（剪辑优先用这条）：' + s['口型视频URL']);
    lines.push('');
  });
  return lines.join('\n');
}
function exportMd(){
  download('分镜脚本_' + nowStr().replace(/[: ]/g,'-') + '.md', buildMdText(exportScopeShots()), 'text/markdown');
  toast('已导出分镜脚本');
}
function buildCsvRows(scope){
  var L = scope || state.shots;
  var rows = [['镜号','章节','景别','光影氛围','画面描述','运镜','角色情绪','说话角色','台词旁白','语音秒','出场角色','场景','时长秒','图片URL','视频URL','口型视频URL','口型风险','图片状态','视频状态','配音状态','口型状态']];
  L.forEach(function(s){
    rows.push([s['镜号'], s['章节']||'', s['景别']||'中景', s['光影氛围']||'', s['画面描述']||'', s['运镜']||'', s['角色情绪']||'', s['说话角色']||'',
               s['台词旁白']||'', num(s['音频时长'])>0 ? num(s['音频时长']).toFixed(2) : '', s['出场角色']||'', s['场景']||'',
               num(s['时长秒'])||5, s['图片URL']||'', s['视频URL']||'', s['口型视频URL']||'',
               s['口型风险']||'低', s['图片状态']||'', s['视频状态']||'', s['配音状态']||'未生成', s['口型状态']||'不需要']);
  });
  return rows;
}
function buildCsvText(scope){
  return buildCsvRows(scope).map(function(r){
    return r.map(function(c){ return '"' + String(c).replace(/"/g,'""') + '"'; }).join(',');
  }).join('\r\n');
}
/* v2.24：把当前范围导成「多工作表合并 Excel」——视频清单 + （勾选时）体检 + 各类型剩余清单，
   一类一张工作表，发协作者时一个文件看全。复用 buildCsvRows / buildHealthRows / buildLeftSheet。 */
function buildXlsxSheets(scope){
  var rows = buildCsvRows(scope);
  var sheets = [{ name:'视频清单', rows: rows, style:{ boldRows:[1], freeze:'A2', widths:xlsxAutoWidths(rows) } }];
  if(cfg.bundleHealth){ var h = buildHealthRows(); if(h && h.length) sheets.push({ name:'关键字段体检', rows:h, style:{ boldRows:[1], freeze:'A2', widths:xlsxAutoWidths(h) } }); }
  if(cfg.bundleLeft){ leftKindsWithData().forEach(function(k){
    var sh = buildLeftSheet(k);
    if(sh && sh.rows && sh.rows.length) sheets.push({ name: sh.name, rows: sh.rows, style:{ boldRows:[1], freeze:'A2', widths:xlsxAutoWidths(sh.rows) } });
  }); }
  return sheets;
}
function exportCsv(){
  download('视频清单_' + nowStr().replace(/[: ]/g,'-') + '.csv', '\ufeff' + buildCsvText(exportScopeShots()), 'text/csv;charset=utf-8');
  toast('已导出视频清单');
}
function importJson(file){
  var fr = new FileReader();
  fr.onload = function(){
    var data;
    try{ data = JSON.parse(fr.result); }catch(e){ toast('文件不是合法 JSON'); return; }
    var arr = Array.isArray(data) ? data : (data.shots || []);
    if(!arr.length){ toast('文件里没有分镜数据'); return; }
    askConfirm('导入将覆盖当前全部 ' + state.shots.length + ' 条分镜，共写入 ' + arr.length + ' 条。确定继续？', '覆盖导入', true)
      .then(function(ok){ if(ok) runImport(arr, data); });
  };
  fr.readAsText(file);
}
function runImport(arr, data){
    pushUndo();   /* v2.31：覆盖导入也能撤销（原来导入后旧数据就彻底没了） */
    purgeAud();   /* 导入会替换全部分镜 id，旧的本机音频全部作废，清掉释放空间 */
    var p = db();
    var build = function(it){
      return Object.assign({ pid: state.pid }, {   /* v2.53：导入的分镜也要归属当前剧目，否则切剧目后一条都读不到 */
        镜号: num(it['镜号']), 画面描述: it['画面描述']||'', 英文提示词: it['英文提示词']||'',
        运镜: it['运镜']||'', 台词旁白: it['台词旁白']||'', 时长秒: num(it['时长秒'])||5,
        图片URL: it['图片URL']||'', 视频URL: it['视频URL']||'', 音频URL: it['音频URL']||'',
        音频时长: num(it['音频时长']), 任务ID: it['任务ID']||'',
        出场角色: it['出场角色']||'', 场景: it['场景']||'',
        景别: (SIZES.indexOf(String(it['景别']||'').trim()) > -1 ? String(it['景别']).trim() : '中景'),
        说话角色: it['说话角色']||'', 角色情绪: it['角色情绪']||'', 满意锁定: (it['满意锁定'] === '是' ? '是' : '否'),
        章节: it['章节']||'', 章节序号: num(it['章节序号']), 负向提示: it['负向提示']||'',
        口型风险: (['低','中','高'].indexOf(String(it['口型风险']||'').trim()) > -1 ? String(it['口型风险']).trim() : '低'),
        口型状态: it['口型状态']||'不需要', 口型视频URL: it['口型视频URL']||'',
        图片状态: it['图片状态']||'未生成', 视频状态: it['视频状态']||'未生成', 配音状态: it['配音状态']||'未生成',
        错误信息: it['错误信息']||'', 更新时间: nowStr()
      });
    };
    var incAssets = Array.isArray(data.assets) ? data.assets : [];
    var buildAsset = function(it){
      return Object.assign({ pid: state.pid }, {   /* v2.53：同 build，设定卡也要带 pid */
        类型: it['类型'] || '角色', 名称: it['名称'] || '', 中文描述: it['中文描述'] || '',
        英文锚点: it['英文锚点'] || '', 参考图URL: it['参考图URL'] || '', 参考图2: it['参考图2'] || '',
        性别年龄: it['性别年龄'] || '', 常服: it['常服'] || '', 性格语气: it['性格语气'] || '',
        TTS音色: it['TTS音色'] || '', TTS风格: it['TTS风格'] || '', 语速: it['语速'] || '',
        状态: it['状态'] || '未生成', 错误信息: '', 更新时间: nowStr()
      });
    };
    if(!p){
      state.shots = arr.map(function(it){ return Object.assign({ _id: newId() }, build(it)); });
      state.assets = incAssets.map(function(it){ return Object.assign({ _id: newId() }, buildAsset(it)); });
      localSave(state.shots);
      lsSaveAssets();
      if(data.novel) $('novel').value = data.novel;
      lsSet(pk('novel'), $('novel').value, { warn:true });
      restoreBackupAudio(data);                // v2.7：把随备份的配音写回本机
      refreshAll(); toast('导入完成，共 ' + arr.length + ' 个分镜 + ' + incAssets.length + ' 张设定卡');
      return;
    }
    setSync('busy');
    /* v2.30：两段批量 addRecord 都改 runSerial——原来一条失败整链断（后面的全不导入），
       收尾却照样报「导入完成，共 N 个」，实际只进来一部分。现在按**实际成功条数**汇报。 */
    var repA = null, repS = null;
    clearAllShots(true)                       /* v2.31：快照已在 runImport 开头存过，别存两份 */
    .then(function(){ return clearAllAssets(); })
    .then(function(){
      return runSerial(incAssets.map(function(it){
        return function(){ return p.addRecord({ databaseId: ASSET_DB_ID, properties: toProps(buildAsset(it)) }); };
      }), { label: '导入设定卡', tag: 'import' });
    })
    .then(function(r){ repA = r; return loadAssets(); })
    .then(function(){
      return runSerial(arr.map(function(it){
        return function(){ return p.addRecord({ databaseId: DB_ID, properties: toProps(build(it)) }); };
      }), { label: '导入分镜', tag: 'import' });
    }).then(function(r){ repS = r; if(data.novel) $('novel').value = data.novel; })
      .then(function(){ lsSet(pk('novel'), $('novel').value, { warn:true }); })
      .then(function(){ return loadShots(); })
      .then(function(){
        var f = (repA ? repA.fail : 0) + (repS ? repS.fail : 0);
        var stopped = (repA && repA.stopped) || (repS && repS.stopped);   /* v2.34 */
        restoreBackupAudio(data); refreshAll();
        if(stopped){
          setSync('off');
          toast('已停止导入：设定卡进了 ' + (repA ? repA.ok : 0) + ' 张、分镜进了 ' + (repS ? repS.ok : 0) + ' 镜（剩下的没动，可重新导入一次）');
        }else if(f){
          setSync('off');
          toast('导入未完成：设定卡 ' + (repA ? repA.ok : 0) + ' 张、分镜 ' + (repS ? repS.ok : 0) + ' 镜成功，' + f + ' 条失败（已按云端实际状态刷新）');
        }else{
          setSync('ok');
          toast('导入完成，共 ' + arr.length + ' 个分镜 + ' + incAssets.length + ' 张设定卡');
        }
      })
      .catch(function(e){ console.error(e); toast('导入失败：' + (e && e.message ? e.message : e)); });
}

