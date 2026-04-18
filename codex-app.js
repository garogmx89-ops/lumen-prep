// ═══════════════════════════════════════════════
// LUMEN CODEX — app: parser, renders, etapas,
//   diff, validación, IA, output, init
// ═══════════════════════════════════════════════
// ══ VERIFICACIÓN ═════════════════════════════════════════════════
function verificarArticulos(orig,limpio){
  const extraer=t=>[...t.matchAll(/Artículo\s+(\d+)/gi)].map(m=>parseInt(m[1]));
  const sO=new Set(extraer(orig)),sL=new Set(extraer(limpio));
  const faltantes=[...sO].filter(n=>!sL.has(n));
  if(!faltantes.length)logOk('Artículos verificados',`Todos presentes (${sO.size})`,`${sL.size}`);
  else logErr('Artículos faltantes',`Faltan: ${faltantes.slice(0,8).join(', ')}`,`×${faltantes.length}`);
  return{total:sO.size,faltantes};
}


// ══ DIFF ═════════════════════════════════════════════════════════
function calcularDiffTokens(orig,limp){
  const lineasA=orig.split('\n'),lineasB=limp.split('\n');
  const tokens=[];
  const lm=lineasA.length,ln=lineasB.length;
  const ldp=Array.from({length:lm+1},()=>new Int32Array(ln+1));
  for(let i=lm-1;i>=0;i--)for(let j=ln-1;j>=0;j--)
    ldp[i][j]=lineasA[i]===lineasB[j]?ldp[i+1][j+1]+1:Math.max(ldp[i+1][j],ldp[i][j+1]);
  let i=0,j=0;const tok=t=>t.match(/[^\s]+|\s+/g)||[];
  while(i<lm||j<ln){
    if(i<lm&&j<ln&&lineasA[i]===lineasB[j]){for(const p of tok(lineasA[i]+'\n'))tokens.push({tipo:'igual',texto:p,id:'t'+tokens.length});i++;j++;}
    else if(j<ln&&(i>=lm||ldp[i][j+1]>=ldp[i+1][j])){tokens.push({tipo:'agregado',texto:lineasB[j]+'\n',id:'t'+tokens.length});j++;}
    else{for(const p of tok(lineasA[i]+'\n'))tokens.push({tipo:'borrado',texto:p,id:'t'+tokens.length});i++;}
  }
  return tokens;
}

function renderDiff(){
  const el=document.getElementById('pane-cambios');
  if(!state.textoOriginal||!state.textoLimpio){
    el.innerHTML=`<div class="empty-state"><div class="empty-state-icon">🔍</div><p>Procesa un documento.</p></div>`;return;
  }
  // Usar el texto crudo original para el diff — no el normalizado
  // IMPORTANTE: aplicar la misma limpieza de markdown que hace etapa2 Paso 0,
  // para que el LCS encuentre coincidencias entre original y limpio.
  // Sin esto, "**ARTÍCULO 1.-**" nunca iguala "ARTÍCULO 1.-" y todo se clasifica como borrado.
  const textoParaDiff = (state.textoOriginalCrudo || state.textoOriginal)
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')   // quitar **negrita** de pandoc
    .replace(/\*([^*\n]+)\*/g, '$1')        // quitar *cursiva* de pandoc
    .replace(/[ \t]{2,}/g, ' ');            // normalizar espacios múltiples
  // Eliminar solo las marcas §NOTA§ del textoLimpio preservando el contenido de las notas y los saltos
  // Esto permite que el diff vea el texto con notas inline como texto plano, no como markup
  const textoLimpioParaDiff = state.textoLimpio
    .replace(/§NOTA§/g, '')
    .replace(/§\/NOTA§/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  diffTokens=calcularDiffSemantico(textoParaDiff, textoLimpioParaDiff);
  state.tokensRestaurados=new Set();tokenSeleccionado=null;
  const pO=contarPalabras(textoParaDiff),pL=contarPalabras(textoLimpioParaDiff);
  const cO=textoParaDiff.length,cL=textoLimpioParaDiff.length;
  const eO=(textoParaDiff.match(/ /g)||[]).length,eL=(textoLimpioParaDiff.match(/ /g)||[]).length;
  const sO=(textoParaDiff.match(/\n/g)||[]).length,sL=(textoLimpioParaDiff.match(/\n/g)||[]).length;
  const dP=pL-pO,dC=cL-cO,dE=eL-eO,dS=sL-sO;
  const pct=pO>0?(Math.abs(dP)/pO*100).toFixed(1):0;
  const clP=Math.abs(dP)<50?'ok':Math.abs(dP)<200?'warn':'err';
  let hO='',hL='',borrados=0,reformateados=0,agregados=0;
  const _ayudaCambios = renderPanelAyuda('cambios');
  for(const tok of diffTokens){
    const t=escHtml(tok.texto);
    if(tok.tipo==='igual'){hO+=`<span class="tok-igual">${t}</span>`;hL+=`<span class="tok-igual">${t}</span>`;}
    else if(tok.tipo==='borrado'){hO+=`<span class="tok-del" data-tid="${tok.id}" onclick="seleccionarToken('${tok.id}')">${t}</span>`;borrados++;}
    else if(tok.tipo==='reformateado'){hO+=`<span class="tok-ref" data-tid="${tok.id}" onclick="seleccionarToken('${tok.id}')">${t}</span>`;reformateados++;}
    else if(tok.tipo==='agregado'){hL+=`<span class="tok-add">${t}</span>`;agregados++;}
    else if(tok.tipo==='restaurado'){hL+=`<span class="tok-add">${t}</span>`;}
  }
  // ── Agrupar tokens por artículo para bloques colapsables ──
  const bloques = [];
  let bloqueActual = null;
  for(const tok of diffTokens){
    const art = tok.art || '__preambulo__';
    if(!bloqueActual || bloqueActual.art !== art){
      bloqueActual = {art, tokens:[], tieneCambios:false};
      bloques.push(bloqueActual);
    }
    bloqueActual.tokens.push(tok);
    if(tok.tipo==='borrado'||tok.tipo==='reformateado'||tok.tipo==='agregado')
      bloqueActual.tieneCambios = true;
  }

  // Renderizar bloques colapsables
  let bloquesHtml = '';
  bloques.forEach((bloque, bi) => {
    let bO = '', bL = '';
    let nBorrados=0, nRef=0, nAgr=0;
    for(const tok of bloque.tokens){
      const t = escHtml(tok.texto);
      if(tok.tipo==='igual'){bO+=`<span class="tok-igual">${t}</span>`;bL+=`<span class="tok-igual">${t}</span>`;}
      else if(tok.tipo==='borrado'){bO+=`<span class="tok-del" data-tid="${tok.id}" onclick="seleccionarToken('${tok.id}')">${t}</span>`;nBorrados++;}
      else if(tok.tipo==='reformateado'){bO+=`<span class="tok-ref" data-tid="${tok.id}" onclick="seleccionarToken('${tok.id}')">${t}</span>`;nRef++;}
      else if(tok.tipo==='agregado'){bL+=`<span class="tok-add">${t}</span>`;nAgr++;}
      else if(tok.tipo==='restaurado'){bL+=`<span class="tok-add">${t}</span>`;}
    }
    const label = bloque.art === '__preambulo__' ? 'Preámbulo' : bloque.art;
    const expandido = false;
    // Badges de cambios en el header
    let badges = '';
    if(nBorrados) badges += `<span style="background:var(--err-bg);color:var(--err-text);border:1px solid var(--err-border);border-radius:20px;padding:1px 7px;font-size:10px;font-family:'DM Mono',monospace;">🔴 ${nBorrados}</span>`;
    if(nRef)      badges += `<span style="background:var(--warn-bg);color:var(--warn-text);border:1px solid var(--warn-border);border-radius:20px;padding:1px 7px;font-size:10px;font-family:'DM Mono',monospace;">🟡 ${nRef}</span>`;
    if(nAgr)      badges += `<span style="background:var(--diff-add-bg);color:var(--ok);border:1px solid #00c2a855;border-radius:20px;padding:1px 7px;font-size:10px;font-family:'DM Mono',monospace;">🟢 ${nAgr}</span>`;
    if(!bloque.tieneCambios) badges += `<span style="color:var(--text-faint);font-size:10px;font-family:'DM Mono',monospace;">sin cambios</span>`;

    bloquesHtml += `
    <div class="diff-bloque" id="diff-bloque-${bi}">
      <div class="diff-bloque-header" onclick="toggleBloquesDiff(${bi})" style="display:flex;align-items:center;justify-content:space-between;padding:7px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;cursor:pointer;gap:8px;margin-bottom:2px;${expandido?'border-color:var(--border2);':'opacity:.7;'}">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
          <span style="color:var(--text-faint);font-size:11px;" id="diff-bloque-arrow-${bi}">${expandido?'▾':'▸'}</span>
          <span style="font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:${bloque.tieneCambios?'var(--text)':'var(--text-faint)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;">${escHtml(label)}</span>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0;">${badges}</div>
      </div>
      <div id="diff-bloque-body-${bi}" style="display:${expandido?'block':'none'};">
        <div class="diff-layout" style="margin-bottom:8px;">
          <div class="diff-col-wrap"><div class="diff-col-header orig">ORIGINAL</div><div class="diff-col-body">${bO}</div></div>
          <div class="diff-col-wrap"><div class="diff-col-header limp">LIMPIO (tiempo real)</div><div class="diff-col-body">${bL}</div></div>
        </div>
      </div>
    </div>`;
  });

  el.innerHTML=_ayudaCambios+`
    <div class="diff-hint">💡
      <span style="color:var(--diff-del-text);font-weight:600;">■ Rojo</span> = eliminado real &nbsp;|&nbsp;
      <span style="color:var(--warn-text);font-weight:600;">■ Amarillo</span> = reformateado (mismo contenido) &nbsp;|&nbsp;
      <span style="color:var(--diff-add-text);font-weight:600;">■ Verde</span> = normalizado
    </div>
    <table class="diff-compare-table" style="margin:14px;width:calc(100% - 28px);">
      <tr><th></th><th>Palabras</th><th>Caracteres</th><th>Espacios</th><th>Saltos de línea</th></tr>
      <tr><td class="col-label">Original</td><td>${pO.toLocaleString()}</td><td>${cO.toLocaleString()}</td><td>${eO.toLocaleString()}</td><td>${sO.toLocaleString()}</td></tr>
      <tr><td class="col-label">Limpio</td><td>${pL.toLocaleString()}</td><td>${cL.toLocaleString()}</td><td>${eL.toLocaleString()}</td><td>${sL.toLocaleString()}</td></tr>
      <tr><td class="col-label">Diferencia</td>
        <td class="${clP}">${dP>0?'+':''}${dP} (${pct}%)${clP==='ok'?' ✅':clP==='warn'?' ⚠':' ❌'}</td>
        <td>${dC>0?'+':''}${dC}</td><td>${dE>0?'+':''}${dE}</td>
        <td style="color:${dS<0?'var(--ok)':dS>0?'#f87171':'var(--text-faint)'}">${dS>0?'+':''}${dS}</td>
      </tr>
    </table>
    <div class="diff-stats-bar">
      <span style="color:var(--text-faint);font-size:10px;margin-right:2px;">FILTRAR:</span>
      <button class="diff-filter-btn flt-del" id="flt-borrado" onclick="toggleFiltro('borrado')">🔴 ${borrados} eliminado(s)</button>
      <button class="diff-filter-btn flt-ref" id="flt-reformateado" onclick="toggleFiltro('reformateado')">🟡 ${reformateados} reformateado(s)</button>
      <button class="diff-filter-btn flt-add" id="flt-agregado" onclick="toggleFiltro('agregado')">🟢 ${agregados} normalizado(s)</button>
      <span style="color:var(--ok);font-size:11px;margin-left:4px;">↵ ${Math.abs(dS)} salto(s) ${dS<=0?'normalizados':'agregados'}</span>
      <span class="ds-neu" id="diff-rest-count"></span>
    </div>
    <div class="diff-nav-bar" id="diff-nav-bar" style="display:none;">
      <button class="diff-nav-btn" id="nav-prev" onclick="navegarCambio(-1)">◀ Anterior</button>
      <button class="diff-nav-btn" id="nav-next" onclick="navegarCambio(1)">Siguiente ▶</button>
      <span class="diff-nav-info" id="nav-info">— / —</span>
      <span class="diff-nav-art" id="nav-art"></span>
      <button class="diff-nav-btn" onclick="toggleFiltro(null)" style="margin-left:auto;">✕ Quitar filtro</button>
    </div>
    <div class="diff-toolbar">
      <span class="dtl">Seleccionado:</span>
      <span id="diff-sel-preview" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-dim);background:var(--surface2);padding:3px 8px;border-radius:4px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">— ninguno —</span>
      <span id="diff-sel-tipo" style="font-size:10px;color:var(--text-faint);font-family:'IBM Plex Mono',monospace;"></span>
      <button class="dab dab-restore" id="dab-restore" onclick="restaurarToken()" disabled>↩ Restaurar</button>
      <button class="dab dab-remove" id="dab-remove" onclick="confirmarEliminacion()" disabled>✕ Eliminar</button>
      <button class="dab dab-keep" onclick="deseleccionarToken()" style="margin-left:auto;">Deseleccionar</button>
    </div>
    <div id="diff-layout-wrap" style="display:flex;flex-direction:column;gap:6px;padding:0 14px 14px;">
      ${bloquesHtml}
    </div>
    <div id="diff-results-wrap" style="display:none;flex:1;overflow:hidden;"></div>`;
  // Badge sidebar Cambios
  const bCamb = document.getElementById('nav-badge-cambios');
  if(bCamb){
    const total = borrados + reformateados;
    bCamb.textContent = total > 0 ? total : '';
    bCamb.className = 'nav-badge' + (borrados > 0 ? ' warn' : total > 0 ? '' : '');
    bCamb.style.display = total > 0 ? '' : 'none';
  }
  // Actualizar label del nav-item en sidebar
  const navCamb = document.getElementById('nav-cambios');
  if(navCamb){
    const label = navCamb.childNodes[1];
    if(label) label.textContent = borrados > 0 ? ` Cambios` : ` Cambios ✓`;
  }
}


function toggleBloquesDiff(bi){
  const body  = document.getElementById(`diff-bloque-body-${bi}`);
  const arrow = document.getElementById(`diff-bloque-arrow-${bi}`);
  if(!body) return;
  const abierto = body.style.display !== 'none';
  body.style.display  = abierto ? 'none' : 'block';
  if(arrow) arrow.textContent = abierto ? '▸' : '▾';
}


function seleccionarToken(tid){
  if(tokenSeleccionado)document.querySelectorAll(`[data-tid="${tokenSeleccionado}"]`).forEach(el=>el.classList.remove('sel'));
  tokenSeleccionado=tid;
  document.querySelectorAll(`[data-tid="${tid}"]`).forEach(el=>el.classList.add('sel'));
  const tok=diffTokens.find(t=>t.id===tid);
  const prev=document.getElementById('diff-sel-preview');
  const tipoEl=document.getElementById('diff-sel-tipo');
  if(prev&&tok)prev.textContent=`"${tok.texto.trim().slice(0,35)}"`;
  if(tipoEl&&tok){const lb={borrado:'🔴 Eliminado',reformateado:'🟡 Reformateado'};tipoEl.textContent=lb[tok.tipo]||tok.tipo;}
  document.getElementById('dab-restore').disabled=false;
  document.getElementById('dab-remove').disabled=false;
}
function deseleccionarToken(){
  if(tokenSeleccionado)document.querySelectorAll(`[data-tid="${tokenSeleccionado}"]`).forEach(el=>el.classList.remove('sel'));
  tokenSeleccionado=null;
  document.getElementById('dab-restore').disabled=true;
  document.getElementById('dab-remove').disabled=true;
  const p=document.getElementById('diff-sel-preview');if(p)p.textContent='— ninguno —';
}

// ── Filtro y navegación por tipo de cambio ─────────────────────
let diffFiltroActivo = null;
let diffNavIndices = [];   // índices en diffTokens del tipo filtrado
let diffNavPos = -1;       // posición actual en diffNavIndices

function toggleFiltro(tipo){
  const layout = document.getElementById('diff-layout-wrap');
  const lista  = document.getElementById('diff-results-wrap');

  if(diffFiltroActivo === tipo || tipo === null){
    // Quitar filtro — volver a vista completa
    diffFiltroActivo = null;
    diffNavIndices = [];
    diffNavPos = -1;
    document.querySelectorAll('.diff-filter-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('diff-nav-bar').style.display = 'none';
    if(layout) layout.style.display = '';
    if(lista)  lista.style.display = 'none';
    return;
  }

  diffFiltroActivo = tipo;
  document.querySelectorAll('.diff-filter-btn').forEach(b=>b.classList.remove('active'));
  const btnId = {borrado:'flt-borrado', reformateado:'flt-reformateado', agregado:'flt-agregado'}[tipo];
  if(btnId) document.getElementById(btnId)?.classList.add('active');

  // Construir grupos de tokens contiguos del mismo tipo (agrupar saltos/espacios juntos)
  const grupos = [];
  let grupoActual = null;
  diffTokens.forEach((tok, idx) => {
    if(tok.tipo === tipo){
      if(!grupoActual){
        grupoActual = {indices:[idx], art: tok.art||''};
        grupos.push(grupoActual);
      } else {
        grupoActual.indices.push(idx);
        if(tok.art) grupoActual.art = tok.art;
      }
    } else {
      grupoActual = null;
    }
  });

  diffNavIndices = grupos.map((_,i)=>i);
  diffNavPos = grupos.length > 0 ? 0 : -1;

  // Renderizar lista de resultados
  const claseHit = {borrado:'diff-hit-del', reformateado:'diff-hit-ref', agregado:'diff-hit-add'};
  const CTX = 120; // chars de contexto antes/después

  let cardsHtml = '';
  grupos.forEach((grupo, gi) => {
    const primerIdx = grupo.indices[0];
    const ultimoIdx = grupo.indices[grupo.indices.length-1];

    // Contexto: tokens igual anteriores
    let ctxAntes = '';
    for(let k = primerIdx-1; k >= Math.max(0, primerIdx-15); k--){
      ctxAntes = escHtml(diffTokens[k].texto) + ctxAntes;
      if(ctxAntes.length > CTX) break;
    }
    if(ctxAntes.length > CTX) ctxAntes = '…' + ctxAntes.slice(-CTX);

    // Contenido del hit (todos los tokens del grupo)
    let hitHtml = '';
    grupo.indices.forEach(idx => {
      const t = diffTokens[idx];
      const txt = escHtml(t.texto);
      // Mostrar espacios y saltos como símbolo visible
      const vis = txt.replace(/ /g,'·').replace(/\n/g,'↵\n');
      hitHtml += `<span class="${claseHit[tipo]}">${vis}</span>`;
    });

    // Contexto: tokens igual posteriores
    let ctxDespues = '';
    for(let k = ultimoIdx+1; k <= Math.min(diffTokens.length-1, ultimoIdx+15); k++){
      ctxDespues += escHtml(diffTokens[k].texto);
      if(ctxDespues.length > CTX) break;
    }
    if(ctxDespues.length > CTX) ctxDespues = ctxDespues.slice(0, CTX) + '…';

    const artLabel = grupo.art ? `<span class="diff-result-art">${escHtml(grupo.art)}</span>` : '<span class="diff-result-art" style="opacity:.4;">Preámbulo / Transitorios</span>';

    cardsHtml += `<div class="diff-result-card" id="res-card-${gi}">
      <div class="diff-result-header">
        <span class="diff-result-num">#${gi+1} / ${grupos.length}</span>
        ${artLabel}
      </div>
      <div class="diff-result-body"><span class="diff-ctx">${ctxAntes}</span>${hitHtml}<span class="diff-ctx">${ctxDespues}</span></div>
    </div>`;
  });

  // Mostrar panel de resultados, ocultar layout normal
  if(layout) layout.style.display = 'none';
  if(lista){
    lista.style.display = '';
    lista.innerHTML = `<div class="diff-results-list">${cardsHtml || '<div style="color:var(--text-faint);padding:20px;">Sin resultados</div>'}</div>`;
  }

  document.getElementById('diff-nav-bar').style.display = 'flex';
  document.getElementById('nav-info').textContent = `${grupos.length} resultado(s)`;
  document.getElementById('nav-prev').disabled = true;
  document.getElementById('nav-next').disabled = grupos.length <= 1;
  document.getElementById('nav-art').style.display = 'none';
}

function navegarCambio(dir){
  if(diffNavIndices.length === 0) return;
  diffNavPos = Math.max(0, Math.min(diffNavIndices.length-1, diffNavPos + dir));
  // Scroll a la tarjeta correspondiente
  const card = document.getElementById(`res-card-${diffNavPos}`);
  if(card) card.scrollIntoView({behavior:'smooth', block:'center'});
  // Actualizar nav
  const info = document.getElementById('nav-info');
  if(info) info.textContent = `${diffNavPos+1} / ${diffNavIndices.length}`;
  document.getElementById('nav-prev').disabled = diffNavPos <= 0;
  document.getElementById('nav-next').disabled = diffNavPos >= diffNavIndices.length-1;
}

function actualizarNavInfo(){
  const info = document.getElementById('nav-info');
  if(info && diffNavIndices.length > 0)
    info.textContent = `${diffNavPos+1} / ${diffNavIndices.length}`;
}

function scrollACambio(tokenIdx){
  const tok = diffTokens[tokenIdx];
  if(!tok) return;
  seleccionarToken(tok.id);
  setTimeout(()=>{
    const el = document.querySelector(`[data-tid="${tok.id}"]`);
    if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
  }, 50);
}
function restaurarToken(){
  if(!tokenSeleccionado)return;
  const tok=diffTokens.find(t=>t.id===tokenSeleccionado);if(!tok)return;
  state.tokensRestaurados.add(tokenSeleccionado);tok.tipo='restaurado';
  document.querySelectorAll(`[data-tid="${tokenSeleccionado}"]`).forEach(el=>{el.classList.remove('sel');el.classList.add('rest');});
  actualizarColumnaLimpio();
  reconstruirTextoLimpio();deseleccionarToken();
  const el=document.getElementById('diff-rest-count');if(el)el.textContent=`↩ ${state.tokensRestaurados.size} restaurado(s)`;
  toast('Fragmento restaurado','success');
}
function confirmarEliminacion(){
  if(!tokenSeleccionado)return;
  if(!confirm('¿Confirmas eliminar este fragmento?'))return;
  document.querySelectorAll(`[data-tid="${tokenSeleccionado}"]`).forEach(el=>{el.style.opacity='.2';el.style.pointerEvents='none';el.classList.remove('sel');});
  const tok=diffTokens.find(t=>t.id===tokenSeleccionado);if(tok)tok.tipo='eliminado';
  deseleccionarToken();toast('Fragmento eliminado','success');
}
function reconstruirTextoLimpio(){
  let nuevo='';
  for(const tok of diffTokens)if(tok.tipo==='igual'||tok.tipo==='agregado'||tok.tipo==='restaurado')nuevo+=tok.texto;
  state.textoLimpio=nuevo;
  state.estructura=parsear(state.textoLimpio,state.perfilActivo);
  state.problemas=detectarProblemas(state.estructura);
  actualizarStats();renderEstructura();renderJSON();renderProblemas();
  state.aprobado=false;
}


// ══ DESHACER ═════════════════════════════════════════════════════
function guardarSnapshot(){
  state.snapshots.push({
    textoLimpio:state.textoLimpio,
    estructura:JSON.parse(JSON.stringify(state.estructura)),
    problemas:JSON.parse(JSON.stringify(state.problemas)),
    resaltados:JSON.parse(JSON.stringify(state.resaltados)),
    banco:JSON.parse(JSON.stringify(state.banco)),
    problemasResueltos:new Set(state.problemasResueltos)
  });
  if(state.snapshots.length>5)state.snapshots.shift();
  document.getElementById('undo-banner').classList.add('visible');
}
function deshacerProcesado(){
  if(!state.snapshots.length){toast('Sin procesado anterior','error');return;}
  const snap=state.snapshots.pop();
  Object.assign(state,{textoLimpio:snap.textoLimpio,estructura:snap.estructura,
    problemas:snap.problemas,resaltados:snap.resaltados,banco:snap.banco,
    problemasResueltos:snap.problemasResueltos,aprobado:false});
  actualizarStats();renderVista();renderDiff();renderEstructura();renderJSON();renderProblemas();
  document.getElementById('panel-top-bar')?.classList.remove('hidden');
  const btnNuevo = document.getElementById('btn-nuevo-doc');
  if(btnNuevo) btnNuevo.style.display = '';
  if(!state.snapshots.length)document.getElementById('undo-banner').classList.remove('visible');
  toast('Procesado deshecho','success');
}
function marcarTodosResueltos(){
  state.problemas.forEach(p => state.problemasResueltos.add(p.articulo));
  renderProblemas(); actualizarStats();
  toast('Todos los problemas validados como OK','success');
}

function marcarComoResuelto(idx){
  const p=state.problemas[idx];if(!p)return;
  state.problemasResueltos.add(p.articulo);renderProblemas();actualizarStats();
}


// ══ PARSER ═══════════════════════════════════════════════════════
function rArt(p){
  switch(p?.patronArticulo){
    case 'mayusculas':return /(?=ART[IÍ]CULO\s+\d+[°º.]?)/g;
    case 'abreviado': return /(?=Art\.\s*\d+)/g;
    case 'custom':try{return new RegExp(`(?=${p.artRegexCustom})`,'g');}catch(e){}
    default:return /(?=Artículo\s+\d+[°º.]?)/g;
  }
}
function rTituloArt(p){
  switch(p?.patronArticulo){
    case 'mayusculas':return /^(ART[IÍ]CULO\s+\d+[°º.]?\.?-?)/;
    case 'abreviado': return /^(Art\.\s*\d+[°º.]?\.?-?)/;
    case 'custom':try{return new RegExp(`^(${p.artRegexCustom}[^\\n]{0,10})`);}catch(e){}
    default:return /^(Artículo\s+\d+[°º.]?\.?-?)/i;
  }
}
function rFrac(p){
  switch(p?.tipoFraccion||'romanos'){
    case 'arabigos':return /(?:^|\n)\s*(\d+)[.)]\s+/gm;
    case 'ambos':   return /(?:^|\n)\s*([IVXLCDM]{1,6}|\d+)[.)]\s+/gm;
    case 'ninguno': return null;
    default:        return /(?:^|\n)\s*([IVXLCDM]{1,6})[.)]\s+/gm;
  }
}
function rInc(p){
  switch(p?.tipoInciso||'minusculas'){
    case 'mayusculas':return /(?:^|\n)\s*([A-Z])\)\s+/gm;
    case 'puntos':    return /(?:^|\n)\s*([a-z])\.\s+/gm;
    case 'ninguno':   return null;
    default:          return /(?:^|\n)\s*([a-z])\)\s+/gm;
  }
}
function parsear(texto,perfil){
  const estructura=[];
  const kwT=perfil?.transitorios?.length?perfil.transitorios:['TRANSITORIOS','Transitorios'];
  let tN=texto,tT='';
  for(const kw of kwT){const m=texto.indexOf(kw);if(m!==-1){tT=texto.slice(m);tN=texto.slice(0,m);break;}}
  const ra=rArt(perfil);const pi=tN.search(ra);
  if(pi>0){
    let introTexto=tN.slice(0,pi).trim();
    // Recortar intro hasta antes del inicio del cuerpo normativo
    // Usar patronesCorteIntro del perfil si existen, o predeterminados
    const patronesCorte = perfil?.patronesCorteIntro?.length
      ? perfil.patronesCorteIntro
      : ['TÍTULO PRIMERO','TÍTULO ÚNICO','TÍTULO SEGUNDO','Capítulo Primero','CAPÍTULO PRIMERO','CAPÍTULO ÚNICO'];
    const rCorteStr = patronesCorte.map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    const rCorte = new RegExp('\\n(' + rCorteStr + ')');
    const mCorte = introTexto.search(rCorte);
    if(mCorte>0) introTexto=introTexto.slice(0,mCorte).trim();
    if(introTexto.length>10)
      estructura.push({tipo:'introduccion',contenido:introTexto,subsecciones:[],estado:'procedimental',instruccion_agente:'Preámbulo. Contexto general, no norma aplicable.'});
  }
  // Capturar bloque seccional huérfano entre fin de intro y primer artículo
  // Ocurre cuando TÍTULO/CAPÍTULO precede al Artículo 1 y no pertenece a ningún artículo
  if(pi>0){
    const bloqueHuerfano = tN.slice(0,pi);
    const mCorteIntro = bloqueHuerfano.search(new RegExp('\\n(' + (perfil?.patronesCorteIntro?.length
      ? perfil.patronesCorteIntro : ['TÍTULO PRIMERO','TÍTULO ÚNICO','TÍTULO SEGUNDO','Capítulo Primero','CAPÍTULO PRIMERO','CAPÍTULO ÚNICO'])
      .map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')'));
    if(mCorteIntro>0){
      const seccionHuerfana = bloqueHuerfano.slice(mCorteIntro).trim();
      if(seccionHuerfana.length>2)
        estructura.push({tipo:'seccion',contenido:seccionHuerfana,estado:'procedimental',instruccion_agente:'Encabezado seccional. Organiza el cuerpo normativo.'});
    }
  }
  ra.lastIndex=0;
  const partes=tN.split(ra).filter(Boolean);const rt=rTituloArt(perfil);
  // Regex para detectar encabezados seccionales (TÍTULO/CAPÍTULO) al final del contenido de un artículo
  const rSeccion=/\n\n((?:TÍTULO\s+[\w]+(?:\s+[\w]+)*\n\n[^\n]+|CAPÍTULO\s+[\w]+(?:\s+[\w]+)*(?:\n\n[^\n]+)?)\s*)$/;
  for(const parte of partes){
    if(!parte.trim())continue;
    const mt=parte.match(rt);if(!mt)continue;
    const titulo=mt[1].trim();
    // Descartar si el título no contiene número — evita que notas de reforma ("Artículo reformado DOF...")
    // sean interpretadas como artículos por el parser
    if(!/\d/.test(titulo))continue;
    let resto=parte.slice(mt[0].length).trim();

    // Detectar y extraer encabezado seccional al final del contenido
    // Patrón: bloque TÍTULO/CAPÍTULO pegado al final antes del siguiente artículo
    // Captura bloque seccional completo: TÍTULO solo, CAPÍTULO solo, o TÍTULO + CAPÍTULO anidado
    const rSec=/\n\n((?:TÍTULO|CAPÍTULO)\s[\s\S]*?)$/;
    const mSec = resto.match(rSec);
    let encabezadoSeccional = null;
    if(mSec){
      encabezadoSeccional = mSec[1].trim();
      resto = resto.slice(0, resto.length - mSec[0].length).trim();
    }

    const {textoLimpio:restoL, notas}=extraerNotasReforma(resto);
    resto=restoL;
    const estadoArt=detectarEstadoJuridico(resto,titulo);
    const item={tipo:'articulo',articulo:titulo,estado:estadoArt,instruccion_agente:generarInstruccionAgente(estadoArt,notas)};
    if(notas.length>0)item.reformas=notas;
    const rf=rFrac(perfil),mf=rf?[...resto.matchAll(rf)]:[];
    if(mf.length>0){
      const ia=resto.slice(0,mf[0].index).trim();if(ia)item.introduccion=ia;
      item.fracciones=[];
      for(let j=0;j<mf.length;j++){
        const etq=mf[j][1]+'.', ini=mf[j].index+mf[j][0].length;
        const fin=j+1<mf.length?mf[j+1].index:resto.length;
        const cf=resto.slice(ini,fin).trim(),fi={fraccion:etq,contenido:cf};
        const ri=rInc(perfil),mi=ri?[...cf.matchAll(ri)]:[];
        if(mi.length>0){
          const iF=cf.slice(0,mi[0].index).trim();if(iF)fi.introduccion=iF;
          fi.incisos=[];
          for(let k=0;k<mi.length;k++){
            const eI=mi[k][1]+')',iiI=mi[k].index+mi[k][0].length;
            const fI=k+1<mi.length?mi[k+1].index:cf.length;
            fi.incisos.push({inciso:eI,contenido:cf.slice(iiI,fI).trim()});
          }
          delete fi.contenido;
        }
        item.fracciones.push(fi);
      }
      // Ensamblar contenido completo para RAG e indexación
      let contenidoEnsamblado = item.introduccion ? item.introduccion + '\n' : '';
      for(const fr of item.fracciones){
        contenidoEnsamblado += '\n' + fr.fraccion + ' ';
        if(fr.incisos && fr.incisos.length>0){
          if(fr.introduccion) contenidoEnsamblado += fr.introduccion + '\n';
          for(const inc of fr.incisos)
            contenidoEnsamblado += '\n' + inc.inciso + ' ' + inc.contenido;
        } else {
          contenidoEnsamblado += (fr.contenido||'');
        }
      }
      item.contenido = contenidoEnsamblado.trim();
    }else{item.contenido=resto;}
    estructura.push(item);

    // Insertar el encabezado seccional como elemento propio DESPUÉS del artículo
    if(encabezadoSeccional){
      estructura.push({
        tipo:'seccion',
        contenido:encabezadoSeccional,
        estado:'procedimental',
        instruccion_agente:'Encabezado seccional. Organiza el cuerpo normativo, no es norma aplicable.'
      });
    }
  }
  if(tT){
    const textoT = tT.trim();
    // Detectar inicio del historial de decretos de reforma
    // Todo lo que venga después es contexto histórico, no norma vigente
    // El historial puede iniciar con un encabezado "ARTÍCULOS TRANSITORIOS DE DECRETOS DE REFORMA"
    // antes del primer DECRETO — ese encabezado debe ir al historial, no a la firma
    const reDecretoHistorial = /\n(?:ARTÍCULOS TRANSITORIOS DE DECRETOS DE REFORMA|DECRETO por el que se)/
    const corteDecretoHistorial = textoT.search(reDecretoHistorial);
    const zonaOriginal = corteDecretoHistorial > 0 ? textoT.slice(0, corteDecretoHistorial).trim() : textoT;
    const zonaHistorial = corteDecretoHistorial > 0 ? textoT.slice(corteDecretoHistorial).trim() : '';
    // Dentro de la zona original: separar transitorios de firmas
    const patronesFirma = [
      /\n(Ciudad de México, a \d)/,
      /\n(En cumplimiento de lo dispuesto por la fracción I)/
    ];
    let corte = -1;
    for(const pat of patronesFirma){
      const m = zonaOriginal.search(pat);
      if(m !== -1 && (corte === -1 || m < corte)) corte = m;
    }
    if(corte > 0){
      const textoTransitorio = zonaOriginal.slice(0, corte).trim();
      const textoFirma = zonaOriginal.slice(corte).trim();
      if(textoTransitorio)
        estructura.push({tipo:'transitorio', contenido:textoTransitorio, estado:'procedimental', instruccion_agente:'Transitorios originales de la ley. Determinan vigencia y derogaciones al momento de la publicación.'});
      if(textoFirma)
        estructura.push({tipo:'firma', contenido:textoFirma, estado:'procedimental', instruccion_agente:'Firmas de promulgación. Parte del instrumento jurídico formal, no norma aplicable.'});
    } else {
      if(zonaOriginal)
        estructura.push({tipo:'transitorio', contenido:zonaOriginal, estado:'procedimental', instruccion_agente:'Transitorios originales de la ley. Determinan vigencia y derogaciones al momento de la publicación.'});
    }
    // Zona de decretos de reforma: separar en decretos individuales (C1-05)
    if(zonaHistorial)
      estructura.push(..._separarDecretosHistorial(zonaHistorial));
  }
  return estructura;
}
// ════════════════════════════════════════════════════════════════
// C1-05 — SEPARAR decreto_historial EN DECRETOS INDIVIDUALES
// Cada DECRETO por el que se… se convierte en un objeto con:
//   tipo:'decreto_historial', numero, fecha, titulo, transitorios[]
// ════════════════════════════════════════════════════════════════
function _separarDecretosHistorial(zonaHistorial) {
  const bloques = zonaHistorial
    .split(/(?=\nDECRETO por el que se|\nDECRETO que |\nDECRETO del )/)
    .map(b => b.trim()).filter(Boolean);

  // Si no hay separaciones reconocibles, fallback al bloque monolítico
  if (bloques.length <= 1) {
    return [{
      tipo: 'decreto_historial',
      contenido: zonaHistorial,
      estado: 'historial',
      instruccion_agente: 'Historial de decretos de reforma. Contexto histórico de modificaciones. NO es norma vigente — NUNCA usar para interpretar el texto actual.'
    }];
  }

  return bloques.map((bloque, idx) => {
    // Extraer fecha de publicación DOF del bloque (ej. "DOF 15-01-2026")
    const mFecha = bloque.match(/DOF\s+(\d{2}-\d{2}-\d{4})/i);
    const fecha  = mFecha ? mFecha[1] : '';

    // Título = primera línea no vacía
    const titulo = bloque.split('\n').map(l=>l.trim()).find(l=>l.length>5) || `Decreto ${idx+1}`;

    // Separar transitorios propios del decreto (líneas que empiecen con ARTÍCULO PRIMERO/ÚNICO/SEGUNDO…)
    // del cuerpo del decreto
    const mTrans = bloque.match(/\n((?:ARTÍCULO\s+(?:PRIMERO|ÚNICO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|SÉPTIMO|OCTAVO|NOVENO|DÉCIMO)[.\s-][\s\S]*))$/i);
    const transitorios = mTrans ? mTrans[1].trim() : '';
    const cuerpo       = mTrans ? bloque.slice(0, bloque.length - transitorios.length).trim() : bloque;

    return {
      tipo:      'decreto_historial',
      numero:    idx + 1,
      fecha,
      titulo:    titulo.slice(0, 120),
      contenido: cuerpo,
      transitorios: transitorios || null,
      estado:    'historial',
      instruccion_agente: `Decreto de reforma #${idx+1}${fecha ? ' (DOF '+fecha+')' : ''}. Contexto histórico — NO es norma vigente. Sus transitorios pueden establecer condiciones de vigencia o derogaciones específicas de esa reforma.`
    };
  });
}

function detectarProblemas(estructura){
  const p=[];
  const arts=estructura.filter(e=>e.tipo==='articulo');
  for(let i=0;i<arts.length;i++){
    const item=arts[i];
    if(state.problemasResueltos.has(item.articulo))continue;
    if(item.estado==='derogado'||item.estado==='reservado')continue;
    if(!item.fracciones&&(item.contenido||'').length>300)
      p.push({articulo:item.articulo,problema:'Artículo largo sin estructura',sugerencia:'Usar corrección IA',tipo:'estructura'});
    if(!item.contenido&&!item.fracciones&&!item.introduccion)
      p.push({articulo:item.articulo,problema:'Artículo sin contenido',sugerencia:'Revisar texto original',tipo:'contenido'});
    const alertas=detectarCorteArticulo(item, i+1<arts.length?arts[i+1]:null);
    for(const alerta of alertas)
      p.push({articulo:item.articulo,problema:alerta,sugerencia:'Revisar en Estructura',tipo:'corte'});
  }
  const derogados=arts.filter(a=>a.estado==='derogado').length;
  if(derogados>0)logInfo('Derogados detectados',`${derogados} artículo(s) — contexto histórico`,`×${derogados}`);
  return p;
}


// ══ ORQUESTADOR ══════════════════════════════════════════════════
async function procesarDocumento(){
  // Este botón aplica cuando el usuario pega texto manualmente en el textarea
  const texto=document.getElementById('raw-input').value.trim();
  if(!texto){toast('Pega o carga un documento','error');return;}
  if(!state.perfilActivo){
    toast('Selecciona un perfil antes de procesar','error');
    const sel=document.getElementById('perfil-select');
    if(sel){sel.style.borderColor='var(--err)';sel.style.boxShadow='0 0 0 2px #f8717133';setTimeout(()=>{sel.style.borderColor='';sel.style.boxShadow='';},2000);}
    return;
  }
  if(state.textoLimpio)guardarSnapshot();
  setLoading(true);
  state.resaltados=[];diffTokens=[];state.tokensRestaurados=new Set();
  state.log=[];state.aprobado=false;state.banco=[];state.introSubsecciones=[];
  state.temasGenerados=[];
  setTimeout(()=>{
    try{
      logInfo('Inicio',`Perfil: ${state.perfilActivo?.nombre||'Genérico'}`,new Date().toLocaleTimeString());
      state.textoOriginal=texto;
      state.textoOriginalCrudo=texto;
      // Lanzar preview antes de ejecutar la limpieza
      mostrarPreviewEtapa1(texto, state.perfilActivo);
    }catch(e){toast('Error: '+e.message,'error');logErr('Error',e.message);setLoading(false);}
  },50);
}


// ══ RENDER VISTA ═════════════════════════════════════════════════
function renderVista(){
  const _ayudaVista = renderPanelAyuda('vista');
  let t=state.textoLimpio;
  const kws=state.perfilActivo?.transitorios||['TRANSITORIOS','Transitorios'];
  for(const kw of kws)t=t.replace(new RegExp(`\\b${escapeRegex(kw)}\\b`,'g'),`<span class="hl-transitorio">${kw}</span>`);
  switch(state.perfilActivo?.patronArticulo){
    case 'mayusculas':t=t.replace(/(ART[IÍ]CULO\s+\d+[°º.]?\.?[^\n]*)/gi,'<span class="hl-articulo">$1</span>');break;
    case 'abreviado': t=t.replace(/(Art\.\s*\d+[°º.]?\.?[^\n]*)/gi,'<span class="hl-articulo">$1</span>');break;
    default:          t=t.replace(/(Artículo\s+\d+[°º.]?\.?[^\n]*)/gi,'<span class="hl-articulo">$1</span>');
  }
  const tf=state.perfilActivo?.tipoFraccion||'romanos';
  if(tf!=='ninguno'){const rp=tf==='arabigos'?/(?:^|\n)(\s*)(\d+)[.)]\s+/gm:/(?:^|\n)(\s*)([IVXLCDM]{1,6})[.)]\s+/gm;t=t.replace(rp,'\n$1<span class="hl-fraccion">$2.</span> ');}
  const ti=state.perfilActivo?.tipoInciso||'minusculas';
  if(ti!=='ninguno'){const rp=ti==='mayusculas'?/(?:^|\n)(\s*)([A-Z])\)\s+/gm:/(?:^|\n)(\s*)([a-z])\)\s+/gm;t=t.replace(rp,'\n$1<span class="hl-inciso">$2)</span> ');}
  // Mostrar vista-content y ocultar welcome screen
  const ws = document.getElementById('welcome-screen');
  const vc = document.getElementById('vista-content');
  if(ws) ws.style.display = 'none';
  if(vc){ vc.style.display = ''; vc.innerHTML = _ayudaVista+`<div id="viewer">${t}</div>`; }
  // Mostrar tabs superiores
  document.getElementById('panel-top-bar')?.classList.remove('hidden');
}


// ══ RENDER ESTRUCTURA (EDITABLE) ═════════════════════════════════
function reconstruirTextoDesdeEstructura(){
  // Reconstruye texto plano desde state.estructura para comparar contra state.textoLimpio
  let partes = [];
  for(const item of state.estructura){
    if(item.tipo === 'seccion'){
      partes.push(item.contenido || '');
    } else if(item.tipo === 'introduccion'){
      if(item.subsecciones && item.subsecciones.length){
        partes.push(item.subsecciones.map(s=>s.contenido||'').join('\n\n'));
      } else {
        partes.push(item.contenido || '');
      }
    } else if(item.tipo === 'articulo'){
      let bloque = item.articulo || '';
      // Incluir notas de reforma — dan contexto de vigencia al agente IA
      if(item.reformas && item.reformas.length) bloque += ' ' + item.reformas.join(' ');
      if(item.introduccion) bloque += ' ' + item.introduccion;
      if(item.fracciones && item.fracciones.length){
        for(const f of item.fracciones){
          bloque += ' ' + (f.fraccion||'') + ' ';
          if(f.introduccion) bloque += f.introduccion + ' ';
          if(f.incisos && f.incisos.length){
            for(const inc of f.incisos) bloque += (inc.inciso||'') + ' ' + (inc.contenido||'') + ' ';
          } else {
            bloque += (f.contenido||'');
          }
        }
      } else {
        bloque += ' ' + (item.contenido || '');
      }
      partes.push(bloque.trim());
    } else if(item.tipo === 'transitorio' || item.tipo === 'firma' || item.tipo === 'decreto_historial'){
      partes.push(item.contenido || '');
    }
  }
  return partes.join('\n\n');
}

function calcularIntegridadEstructura(){
  if(!state.textoLimpio || !state.estructura.length) return null;
  const textoRef   = state.textoLimpio;
  const textoRecon = reconstruirTextoDesdeEstructura();
  const pRef  = contarPalabras(textoRef);
  const pRecon= contarPalabras(textoRecon);
  const cRef  = textoRef.replace(/\s/g,'').length;
  const cRecon= textoRecon.replace(/\s/g,'').length;
  const arts  = state.estructura.filter(e=>e.tipo==='articulo').length;
  const diffP = pRecon - pRef;
  const diffC = cRecon - cRef;
  const pct   = pRef > 0 ? ((pRecon/pRef)*100).toFixed(1) : '0';
  const ok    = Math.abs(diffP) <= Math.round(pRef * 0.01); // tolerancia 1%
  return { pRef, pRecon, cRef, cRecon, diffP, diffC, pct, ok, arts };
}

function renderEstructura(){
  const el=document.getElementById('pane-estructura');
  if(!state.estructura.length)return;

  // Calcular integridad
  const _ayudaEst = renderPanelAyuda('estructura');
  const integ = calcularIntegridadEstructura();
  const arts  = state.estructura.filter(e=>e.tipo==='articulo').length;

  // Badge de artículos
  const artsBadge = integ
    ? `<span style="font-family:'DM Mono',monospace;font-size:11px;padding:3px 9px;border-radius:20px;border:1px solid ${integ.ok?'var(--ok)':'var(--warn)'};color:${integ.ok?'var(--ok)':'var(--warn)'};">
        ${integ.ok?'✓':'⚠'} ${arts} artículos · ${integ.pct}% integridad
       </span>` : '';

  // Tabla de integridad Limpio vs Estructura
  let tablaInteg = '';
  if(integ){
    const fmtDiff = (d) => {
      if(d === 0) return `<span style="color:var(--ok);">0 ✅</span>`;
      const s = d > 0 ? `+${d}` : `${d}`;
      const col = Math.abs(d) <= 5 ? 'var(--warn)' : 'var(--err)';
      return `<span style="color:${col};">${s}</span>`;
    };
    tablaInteg = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:11px;">
      <div style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text-faint);margin-bottom:8px;">
        Integridad — Limpio vs Estructura reconstruida
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;padding:3px 8px;color:var(--text-faint);font-weight:600;font-size:10px;"></th>
            <th style="text-align:right;padding:3px 8px;color:var(--text-faint);font-weight:600;font-size:10px;">PALABRAS</th>
            <th style="text-align:right;padding:3px 8px;color:var(--text-faint);font-weight:600;font-size:10px;">CARACTERES</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:4px 8px;font-weight:600;color:var(--text-dim);">Limpio</td>
            <td style="padding:4px 8px;text-align:right;font-family:'DM Mono',monospace;">${integ.pRef.toLocaleString()}</td>
            <td style="padding:4px 8px;text-align:right;font-family:'DM Mono',monospace;">${integ.cRef.toLocaleString()}</td>
          </tr>
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:4px 8px;font-weight:600;color:var(--text-dim);">Estructura</td>
            <td style="padding:4px 8px;text-align:right;font-family:'DM Mono',monospace;">${integ.pRecon.toLocaleString()}</td>
            <td style="padding:4px 8px;text-align:right;font-family:'DM Mono',monospace;">${integ.cRecon.toLocaleString()}</td>
          </tr>
          <tr style="border-top:1px solid var(--border2);">
            <td style="padding:4px 8px;font-weight:700;color:var(--text);">Diferencia</td>
            <td style="padding:4px 8px;text-align:right;font-family:'DM Mono',monospace;">${fmtDiff(integ.diffP)}</td>
            <td style="padding:4px 8px;text-align:right;font-family:'DM Mono',monospace;">${fmtDiff(integ.diffC)}</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:6px;color:var(--text-faint);font-size:10px;">
        ℹ La reconstrucción incluye notas de reforma y estado jurídico de cada artículo. Una diferencia de 0 indica parseo completo.
      </div>
    </div>`;
  }

  let html=_ayudaEst+`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <div style="font-size:11px;color:var(--text-faint);">
        💡 Haz clic en <strong style="color:var(--text-dim);">✏ Editar</strong> para modificar un elemento. Selecciona texto para crear reglas o cortar fragmentos.
      </div>
      ${artsBadge}
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      ${state.perfilActivo?.reglas?.length?
        `<div style="font-size:11px;color:var(--ok);">📌 ${state.perfilActivo.reglas.length} regla(s) en perfil</div>`:''}
      <button class="btn btn-ghost btn-sm" onclick="exportarEstructuraPDF()" style="font-size:11px;">&#11015; PDF Estructura</button>
    </div>
  </div>
  ${tablaInteg}
  <div class="estructura-container">`;

  state.estructura.forEach((item,idx)=>{
    if(item.tipo==='introduccion'){
      html+=renderIntroCard(item,idx);
    } else if(item.tipo==='transitorio'){
      html+=`<div style="background:var(--diff-del-bg);border:1px solid #f8717133;border-left:3px solid var(--trans);border-radius:6px;padding:11px 13px;font-size:12px;color:var(--text-dim);">
        <div style="font-size:10px;color:var(--trans);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Transitorios</div>
        <div data-art-idx="${idx}" class="art-content-view"><p class="art-parrafo">${renderConNotas(item.contenido)}</p></div></div>`;
    } else if(item.tipo==='firma'){
      html+=`<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid #a78bfa;border-radius:6px;padding:11px 13px;font-size:12px;color:var(--text-dim);">
        <div style="font-size:10px;color:#a78bfa;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">✍ Firmas de promulgación</div>
        <div data-art-idx="${idx}" class="art-content-view"><p class="art-parrafo">${renderConNotas(item.contenido)}</p></div></div>`;
    } else if(item.tipo==='decreto_historial'){
      // Dividir el historial por decreto, renderizar cada uno por separado e insertar <hr> entre ellos
      const SEP_HR = '<hr style="border:none;border-top:1px solid #ec489944;margin:16px 0;">';
      const bloquesDec = item.contenido.split(/(?=\nDECRETO por el que se)/).map(b=>b.trim()).filter(Boolean);
      const contenidoDecretoHtml = bloquesDec.map(b => renderConNotas(b)).join(SEP_HR);
      html+=`<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid #ec4899;border-radius:6px;padding:11px 13px;font-size:12px;color:var(--text-dim);">
        <div style="font-size:10px;color:#ec4899;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">📋 Historial de decretos de reforma</div>
        <div data-art-idx="${idx}" class="art-content-view"><p class="art-parrafo">${contenidoDecretoHtml}</p></div></div>`;
    } else if(item.tipo==='seccion'){
      html+=`<div style="background:transparent;border:none;border-top:1px solid var(--border);padding:10px 4px 4px;margin:4px 0;">
        <div style="font-size:10px;color:var(--frac);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;font-family:'DM Mono',monospace;white-space:pre-wrap;">${escHtml(item.contenido)}</div>
      </div>`;
    } else if(item.tipo==='articulo'){
      html+=renderArtCard(item,idx);
    }
  });

  // Banco de fragmentos
  if(state.banco.length){
    html+=`<div class="banco-section">
      <div class="banco-header" onclick="toggleBanco(this)">
        <span class="banco-title">📦 Banco de fragmentos (${state.banco.length})</span>
        <span style="color:var(--text-faint);font-size:11px;">▾</span>
      </div>
      <div id="banco-body">`;
    state.banco.forEach((b,i)=>{
      html+=`<div class="banco-item">
        <div class="banco-item-text">${escHtml(b.texto.slice(0,120))}${b.texto.length>120?'...':''}</div>
        <div class="banco-item-actions">
          <button class="btn btn-ghost btn-sm" onclick="recuperarDeBanco(${i})">↩ Recuperar</button>
          <button class="btn btn-danger btn-sm" onclick="eliminarDeBanco(${i})">🗑</button>
        </div>
      </div>`;
    });
    html+=`</div></div>`;
  }

  html+=`</div>`;
  el.innerHTML=html;
}

function renderIntroCard(item,idx){
  const subs=item.subsecciones||[];
  let html=`<div class="intro-card" id="intro-card-${idx}">
    <div class="intro-header">
      <span class="intro-title">Introducción</span>
      <div style="display:flex;gap:6px;">
        <button class="art-edit-btn" onclick="toggleEditIntro(${idx})">✏ Editar</button>
        <button class="art-edit-btn" onclick="dividirIntro(${idx})" style="display:${document.getElementById('intro-card-'+idx)?.classList.contains('editing')?'':'none'}" id="btn-dividir-${idx}">✂ Dividir selección</button>
      </div>
    </div>`;

  if(!subs.length){
    // Sin subsecciones — mostrar como bloque
    html+=`<div style="padding:0 13px 12px;">
      <div data-art-idx="${idx}" class="art-content-view intro-sub-content"
        style="border-left:2px solid var(--intro);padding-left:8px;font-style:italic;"
        id="intro-contenido-${idx}"><p class="art-parrafo">${renderParrafos(item.contenido)}</p></div>
      <textarea class="art-content-edit" id="intro-edit-${idx}" style="display:none;"
        onchange="state.estructura[${idx}].contenido=this.value;renderJSON();">${escHtml(item.contenido)}</textarea>
      <div style="font-size:11px;color:var(--text-faint);margin-top:8px;">
        💡 En modo edición: selecciona parte del texto y usa <strong>✂ Dividir selección</strong> para crear subsecciones.
      </div>
    </div>`;
  } else {
    html+=`<div>`;
    subs.forEach((sub,si)=>{
      const ti=TIPOS_ELEMENTO[sub.tipo]||{label:sub.tipo,color:'#8892a4'};
      html+=`<div class="intro-subsection" data-sub-idx="${si}">
        <button class="intro-sub-remove" onclick="eliminarSubseccion(${idx},${si})">×</button>
        <div class="intro-sub-label" style="background:${ti.color}22;border:1px solid ${ti.color};color:${ti.color};">
          ${escHtml(ti.label)}
        </div>
        <div class="intro-sub-content" id="intro-sub-view-${idx}-${si}"><p class="art-parrafo">${renderParrafos(sub.contenido)}</p></div>
        <textarea class="intro-sub-content-edit" id="intro-sub-edit-${idx}-${si}" style="display:none;"
          onchange="state.estructura[${idx}].subsecciones[${si}].contenido=this.value;renderJSON();">${escHtml(sub.contenido)}</textarea>
      </div>`;
    });
    // Contenido restante sin clasificar
    if(item.contenido&&item.contenido.trim()){
      html+=`<div class="intro-subsection" style="background:var(--surface2);">
        <div class="intro-sub-label" style="background:var(--border);border:1px solid var(--border2);color:var(--text-faint);">Sin clasificar</div>
        <div class="intro-sub-content" data-art-idx="${idx}"><p class="art-parrafo">${renderParrafos(item.contenido)}</p></div>
      </div>`;
    }
    html+=`</div>`;
  }
  html+=`</div>`;
  return html;
}

function renderArtCard(item,idx){
  const tf=item.fracciones?.length||0;
  return `<div class="art-card" id="art-card-${idx}" data-idx="${idx}">
    <div class="art-header">
      <div class="art-header-left">
        <span class="art-drag-handle" title="Arrastrar para reordenar">⠿</span>
        <span class="art-title" id="art-title-view-${idx}">${escHtml(item.articulo)}</span>
        <input class="art-title-input" id="art-title-edit-${idx}" value="${escAttr(item.articulo)}"
          style="display:none;"
          onchange="state.estructura[${idx}].articulo=this.value;"
          onclick="event.stopPropagation()">
      </div>
      <div class="art-header-actions">
        <span style="color:var(--text-faint);font-size:11px;">${tf?tf+' fracc. ':''}</span>
        <!-- Botones modo normal -->
        <div id="art-actions-normal-${idx}" style="display:flex;gap:5px;align-items:center;">
          <button class="art-edit-btn" onclick="toggleEditArt(${idx},event)">✏ Editar</button>
          <button class="art-edit-btn" onclick="moverArt(${idx},-1)" title="Subir">↑</button>
          <button class="art-edit-btn" onclick="moverArt(${idx},1)"  title="Bajar">↓</button>
          <span style="color:var(--text-faint);font-size:11px;cursor:pointer;padding:3px 5px;" onclick="toggleArtBody(${idx})">▾</span>
        </div>
        <!-- Botones modo edición — siempre visibles en el header -->
        <div id="art-actions-edit-${idx}" style="display:none;gap:5px;align-items:center;flex-wrap:wrap;">
          <button class="art-edit-btn" onclick="agregarFraccionManual(${idx})" title="Agregar fracción">+ Fracc.</button>
          <button class="art-edit-btn" style="color:var(--err-text);border-color:#f8717144;" onclick="eliminarArt(${idx})" title="Eliminar artículo">🗑</button>
          <button class="art-edit-btn active" onclick="guardarEdicionArt(${idx})" style="background:var(--ok);color:#fff;border-color:var(--ok);">✓ Guardar</button>
          <button class="art-edit-btn" onclick="cancelarEdicionArt(${idx})" style="color:var(--text-faint);">✕ Cancelar</button>
        </div>
      </div>
    </div>
    <div class="art-body" id="art-body-${idx}">
      ${item.introduccion?`<div class="art-intro"><p class="art-parrafo">${renderConNotas(item.introduccion)}</p></div>`:''}
      ${tf?renderFracciones(item,idx):
        `<div class="art-content-view" data-art-idx="${idx}" id="art-content-view-${idx}"><p class="art-parrafo">${renderConNotas(item.contenido||'')}</p></div>
         <textarea class="art-content-edit" id="art-content-edit-${idx}" style="display:none;"
           rows="6"
           oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';">${escHtml(item.contenido||'')}</textarea>`
      }
    </div>
  </div>`;
}

function renderFracciones(item,idx){
  let html='';
  for(const frac of item.fracciones){
    html+=`<div class="frac-item"><span class="frac-label">${escHtml(frac.fraccion)}</span><div class="frac-text">`;
    if(frac.introduccion)html+=`<div style="margin-bottom:3px;font-style:italic;">${renderConNotas(frac.introduccion)}</div>`;
    if(frac.incisos?.length)
      for(const inc of frac.incisos)
        html+=`<div class="inc-item"><span class="inc-label">${escHtml(inc.inciso)}</span><span class="inc-text">${renderConNotas(inc.contenido)}</span></div>`;
    else html+=renderConNotas(frac.contenido||'');
    html+=`</div></div>`;
  }
  return html;
}


// ── Acciones de edición en Estructura ────────────────────────────
function toggleArtBody(idx){
  const body=document.getElementById(`art-body-${idx}`);
  if(body)body.style.display=body.style.display==='none'?'':'none';
}

function toggleEditArt(idx,event){
  event?.stopPropagation();
  const card=document.getElementById(`art-card-${idx}`);
  if(!card)return;
  const isEditing=card.classList.contains('editing');
  if(isEditing){guardarEdicionArt(idx);}
  else{activarEdicionArt(idx);}
}

function activarEdicionArt(idx){
  const card=document.getElementById(`art-card-${idx}`);
  if(!card)return;

  // Mostrar inputs
  const titleView=document.getElementById(`art-title-view-${idx}`);
  const titleEdit=document.getElementById(`art-title-edit-${idx}`);
  const contentView=document.getElementById(`art-content-view-${idx}`);
  const contentEdit=document.getElementById(`art-content-edit-${idx}`);

  if(titleView)titleView.style.display='none';
  if(titleEdit){titleEdit.style.display='';titleEdit.value=state.estructura[idx]?.articulo||'';}
  if(contentView)contentView.style.display='none';
  if(contentEdit){
    contentEdit.style.display='';
    contentEdit.value=state.estructura[idx]?.contenido||'';
    // Auto-altura
    setTimeout(()=>{contentEdit.style.height='auto';contentEdit.style.height=contentEdit.scrollHeight+'px';},10);
  }

  // Cambiar botones del header
  const normal=document.getElementById(`art-actions-normal-${idx}`);
  const edit  =document.getElementById(`art-actions-edit-${idx}`);
  if(normal)normal.style.display='none';
  if(edit)  edit.style.display='flex';

  // Marcar card y mostrar body
  card.classList.add('editing');
  const body=document.getElementById(`art-body-${idx}`);
  if(body)body.style.display='';
}

function guardarEdicionArt(idx){
  const card=document.getElementById(`art-card-${idx}`);
  const titleEdit  =document.getElementById(`art-title-edit-${idx}`);
  const titleView  =document.getElementById(`art-title-view-${idx}`);
  const contentEdit=document.getElementById(`art-content-edit-${idx}`);
  const contentView=document.getElementById(`art-content-view-${idx}`);
  const normal=document.getElementById(`art-actions-normal-${idx}`);
  const edit  =document.getElementById(`art-actions-edit-${idx}`);

  // Guardar valores al estado
  if(titleEdit  &&state.estructura[idx])state.estructura[idx].articulo =titleEdit.value.trim()||state.estructura[idx].articulo;
  if(contentEdit&&state.estructura[idx])state.estructura[idx].contenido=contentEdit.value;

  // Restaurar vista
  if(titleView)  {titleView.textContent  =state.estructura[idx]?.articulo||'';  titleView.style.display='';}
  if(titleEdit)   titleEdit.style.display='none';
  if(contentView){contentView.textContent=state.estructura[idx]?.contenido||'';contentView.style.display='';}
  if(contentEdit) contentEdit.style.display='none';
  if(normal)normal.style.display='flex';
  if(edit)  edit.style.display='none';
  card?.classList.remove('editing');

  renderJSON();
  toast('Cambios guardados','success');
}

function cancelarEdicionArt(idx){
  const card=document.getElementById(`art-card-${idx}`);
  const titleEdit  =document.getElementById(`art-title-edit-${idx}`);
  const titleView  =document.getElementById(`art-title-view-${idx}`);
  const contentEdit=document.getElementById(`art-content-edit-${idx}`);
  const contentView=document.getElementById(`art-content-view-${idx}`);
  const normal=document.getElementById(`art-actions-normal-${idx}`);
  const edit  =document.getElementById(`art-actions-edit-${idx}`);

  // Restaurar sin guardar
  if(titleView)  titleView.style.display='';
  if(titleEdit)  titleEdit.style.display='none';
  if(contentView)contentView.style.display='';
  if(contentEdit)contentEdit.style.display='none';
  if(normal)normal.style.display='flex';
  if(edit)  edit.style.display='none';
  card?.classList.remove('editing');
  toast('Edición cancelada','success');
}

function moverArt(idx,dir){
  const nuevoIdx=idx+dir;
  if(nuevoIdx<0||nuevoIdx>=state.estructura.length)return;
  [state.estructura[idx],state.estructura[nuevoIdx]]=[state.estructura[nuevoIdx],state.estructura[idx]];
  renderEstructura();renderJSON();
  toast('Elemento reordenado','success');
}

function eliminarArt(idx){
  if(!confirm('¿Eliminar este elemento? Irá al banco de fragmentos.'))return;
  const item=state.estructura[idx];
  state.banco.push({id:'banco_'+Date.now(),texto:`${item.articulo}\n${item.contenido||''}`,origen:'Eliminado manualmente'});
  state.estructura.splice(idx,1);
  renderEstructura();renderJSON();
  toast('Elemento enviado al banco','success');
}

function agregarFraccionManual(idx){
  const item=state.estructura[idx];if(!item)return;
  if(!item.fracciones)item.fracciones=[];
  item.fracciones.push({fraccion:`${toRomano(item.fracciones.length+1)}.`,contenido:'[Nuevo contenido]'});
  renderEstructura();renderJSON();
  setTimeout(()=>activarEdicionArt(idx),50);
}

function toRomano(n){
  const v=[1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const s=['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let r='';for(let i=0;i<v.length;i++)while(n>=v[i]){r+=s[i];n-=v[i];}return r;
}

// Introducción estructurable
function toggleEditIntro(idx){
  const card=document.getElementById(`intro-card-${idx}`);
  if(!card)return;
  const isEditing=card.classList.contains('editing');
  if(isEditing){
    card.classList.remove('editing');
    const cv=document.getElementById(`intro-contenido-${idx}`);
    const ce=document.getElementById(`intro-edit-${idx}`);
    if(cv)cv.style.display='';
    if(ce){state.estructura[idx].contenido=ce.value;ce.style.display='none';}
    renderJSON();toast('Introducción guardada','success');
  } else {
    card.classList.add('editing');
    const cv=document.getElementById(`intro-contenido-${idx}`);
    const ce=document.getElementById(`intro-edit-${idx}`);
    if(cv)cv.style.display='none';
    if(ce)ce.style.display='';
    const btnD=document.getElementById(`btn-dividir-${idx}`);
    if(btnD)btnD.style.display='';
  }
}

function dividirIntro(idx){
  const sel=window.getSelection();
  const textoSel=sel?sel.toString().trim():'';
  if(!textoSel){toast('Selecciona texto en la introducción para dividir','error');return;}

  // Abrir mini-selector de tipo
  const tipo=prompt(
    'Tipo de subsección:\n1. Encabezado de publicación\n2. Nombre de la ley\n3. Decreto / Acuerdo\n4. Exposición de motivos\n5. Firmas\nEscribe el número:'
  );
  const tiposMap={'1':'encabezado_publicacion','2':'nombre_ley','3':'decreto','4':'exposicion_motivos','5':'firma'};
  const tipoSel=tiposMap[tipo?.trim()]||'encabezado_publicacion';

  const item=state.estructura[idx];
  if(!item.subsecciones)item.subsecciones=[];
  // Quitar del contenido principal
  item.contenido=(item.contenido||'').replace(textoSel,'').trim();
  item.subsecciones.push({tipo:tipoSel,contenido:textoSel});

  window.getSelection()?.removeAllRanges();
  renderEstructura();renderJSON();
  toast('Subsección creada','success');
}

function eliminarSubseccion(artIdx,subIdx){
  const item=state.estructura[artIdx];if(!item?.subsecciones)return;
  const sub=item.subsecciones[subIdx];
  item.contenido=((item.contenido||'')+' '+sub.contenido).trim();
  item.subsecciones.splice(subIdx,1);
  renderEstructura();renderJSON();
  toast('Subsección fusionada con contenido principal','success');
}

// Banco
function toggleBanco(header){
  const body=document.getElementById('banco-body');
  if(body)body.style.display=body.style.display==='none'?'':'none';
}
function recuperarDeBanco(idx){
  const b=state.banco[idx];if(!b)return;
  state.estructura.push({tipo:'articulo',articulo:'[Recuperado del banco]',contenido:b.texto});
  state.banco.splice(idx,1);
  renderEstructura();renderJSON();
  toast('Fragmento recuperado como nuevo artículo','success');
}
function eliminarDeBanco(idx){
  if(!confirm('¿Eliminar definitivamente este fragmento?'))return;
  state.banco.splice(idx,1);
  renderEstructura();
  toast('Fragmento eliminado','success');
}


// ══ RENDER JSON ═══════════════════════════════════════════════════
function renderJSON(){
  const _ayudaJSON = renderPanelAyuda('json');
  const output=construirOutputFinal();
  const salida=[...output.contenido];
  const json=JSON.stringify(salida,null,2);
  const col=json
    .replace(/("[\w\sáéíóúüñÁÉÍÓÚÜÑ_]+")(\s*:)/g,'<span class="json-key">$1</span>$2')
    .replace(/:\s*(".*?")/g,': <span class="json-string">$1</span>')
    .replace(/:\s*(\d+)/g,': <span class="json-number">$1</span>');
  const _btnDescargaJSON = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
    <button onclick="exportarJSONAprobado()" class="btn btn-ghost btn-sm" style="font-size:11px;">
      ⬇ Descargar JSON
    </button>
  </div>`;
  document.getElementById('pane-json').innerHTML=_ayudaJSON+_btnDescargaJSON+`<pre id="json-view">${col}</pre>`;
}


// ══ RENDER PROBLEMAS ═════════════════════════════════════════════
function renderProblemas(){
  const _ayudaProb = renderPanelAyuda('problemas');
  const el=document.getElementById('pane-problemas');
  const activos=state.problemas.filter(p=>!state.problemasResueltos.has(p.articulo));
  if(!activos.length&&!state.problemas.length){el.innerHTML=_ayudaProb+`<div class="empty-state"><div class="empty-state-icon">✅</div><p>Sin problemas.</p></div>`;return;}

  // Clasificar problemas activos
  const truncados = activos.filter(p=>p.problema&&p.problema.includes('truncado'));
  const largos = activos.filter(p=>p.problema&&p.problema.includes('largo'));
  const otros = activos.filter(p=>!p.problema||(!p.problema.includes('truncado')&&!p.problema.includes('largo')));

  let html='';

  // Barra de resumen + botón validar todos
  if(activos.length){
    html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:13px;color:var(--text-dim);font-weight:600;">${activos.length} pendiente(s)</span>
        ${truncados.length?`<span style="font-size:10px;background:var(--err-bg);color:var(--err-text);border:1px solid var(--err-border);border-radius:20px;padding:2px 8px;">⚠ ${truncados.length} truncado(s)</span>`:''}
        ${largos.length?`<span style="font-size:10px;background:var(--warn-bg);color:var(--warn-text);border:1px solid var(--warn-border);border-radius:20px;padding:2px 8px;">${largos.length} largo(s) sin estructura</span>`:''}
      </div>
      <button class="btn btn-success btn-sm" onclick="marcarTodosResueltos()" style="font-size:11px;">✓ Validar todos como OK</button>
    </div>`;
  }

  state.problemas.forEach((p,i)=>{
    const res=state.problemasResueltos.has(p.articulo);
    const esTruncado = p.problema&&p.problema.includes('truncado');
    const borderColor = res?'var(--border)':esTruncado?'var(--err-text)':'var(--warn-text)';
    const bgColor = res?'var(--diff-add-bg)':esTruncado?'var(--err-bg)':'var(--warn-bg)';
    html+=`<div class="problem-item${res?' resuelto':''}" style="border-left-color:${borderColor};background:${bgColor};">
      <div><strong>${escHtml(p.articulo)}</strong><span>${res?'✓ Correcto':escHtml(p.problema)}</span>
      ${!res&&p.sugerencia?`<div style="margin-top:4px;font-size:11px;color:var(--accent);">💡 ${escHtml(p.sugerencia)}</div>`:''}</div>
      ${!res?`<button class="btn btn-success btn-sm" onclick="marcarComoResuelto(${i})">✓ OK</button>`:''}
    </div>`;
  });
  el.innerHTML=_ayudaProb+html;
}


// ══ VALIDACIÓN ═══════════════════════════════════════════════════
async function renderValidacion(){
  const _ayudaVal = renderPanelAyuda('validacion');
  const el=document.getElementById('pane-validacion');
  if(!state.estructura.length){el.innerHTML=_ayudaVal+`<div class="empty-state"><div class="empty-state-icon">🛡</div><p>Procesa un documento primero.</p></div>`;return;}
  const arts=state.estructura.filter(e=>e.tipo==='articulo');
  const fracs=arts.reduce((n,a)=>n+(a.fracciones?.length||0),0);
  const incs=arts.reduce((n,a)=>n+(a.fracciones?.reduce((m,f)=>m+(f.incisos?.length||0),0)||0),0);
  const probActivos=state.problemas.filter(p=>!state.problemasResueltos.has(p.articulo)).length;
  const pO=contarPalabras(state.textoOriginal),pL=contarPalabras(state.textoLimpio);
  const pct=pO>0?(Math.abs(pL-pO)/pO*100).toFixed(1):0;
  const clI=pct<1?'val-ok':pct<3?'val-warn':'val-err';
  const sO=new Set([...state.textoOriginal.matchAll(/Artículo\s+(\d+)/gi)].map(m=>parseInt(m[1])));
  const sL=new Set([...state.textoLimpio.matchAll(/Artículo\s+(\d+)/gi)].map(m=>parseInt(m[1])));
  const faltantes=[...sO].filter(n=>!sL.has(n));
  const clA=faltantes.length===0?'val-ok':'val-err';
  const reglas=state.perfilActivo?.reglas||[];
  const hash=state.hashActual||'—';

  let html=`
    <div class="val-section">
      <div class="val-section-header">Resumen del documento</div>
      <div class="val-grid">
        <div class="val-cell"><div class="val-cell-label">Artículos</div><div class="val-cell-value ${clA}">${arts.length}</div><div class="val-cell-sub">${faltantes.length>0?`⚠ Faltan: ${faltantes.slice(0,5).join(', ')}`:'✓ Todos presentes'}</div></div>
        <div class="val-cell"><div class="val-cell-label">Fracciones</div><div class="val-cell-value">${fracs}</div></div>
        <div class="val-cell"><div class="val-cell-label">Incisos</div><div class="val-cell-value">${incs}</div></div>
        <div class="val-cell"><div class="val-cell-label">Problemas</div><div class="val-cell-value ${probActivos>0?'val-err':'val-ok'}">${probActivos}</div></div>
        <div class="val-cell"><div class="val-cell-label">Integridad</div><div class="val-cell-value ${clI}">${pct}%</div><div class="val-cell-sub">${pO.toLocaleString()} → ${pL.toLocaleString()} palabras</div></div>
        <div class="val-cell"><div class="val-cell-label">Reglas del perfil</div><div class="val-cell-value" style="color:var(--accent);">${reglas.length}</div><div class="val-cell-sub">aprendidas</div></div>
      </div>
    </div>`;

  // Reglas del perfil
  if(reglas.length){
    html+=`<div class="val-section">
      <div class="val-section-header">📌 Reglas aprendidas en este perfil</div>
      <div style="padding:12px 14px;">`;
    for(const r of reglas){
      const ti=TIPOS_ELEMENTO[r.tipo]||{label:r.tipo,color:'#8892a4'};
      html+=`<div class="regla-item">
        <div class="regla-color" style="background:${r.color};"></div>
        <div style="flex:1;">
          <div class="regla-nombre">${escHtml(r.nombre)}</div>
          <div class="regla-tipo">${ti.label} · ${r.metodo} · "${escHtml(r.patron?.slice(0,40)||'')}..."</div>
        </div>
        <span class="regla-del" onclick="eliminarRegla('${escAttr(r.patron||'')}')">🗑</span>
      </div>`;
    }
    html+=`</div></div>`;
  }

  html+=`<div class="hash-label">Firma de contenido (SHA-256)</div>
    <div class="hash-box">${escHtml(hash)}</div>
    <div class="val-section">
      <div class="val-section-header">Metadatos</div>
      <div style="padding:12px 14px;font-size:12px;color:var(--text-dim);display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><span style="color:var(--text-faint);">Perfil:</span> ${escHtml(state.perfilActivo?.nombre||'Genérico')}</div>
        <div><span style="color:var(--text-faint);">Ámbito:</span> ${escHtml(state.perfilActivo?.ambito||'—')}</div>
        <div><span style="color:var(--text-faint);">Origen:</span> ${escHtml(state.perfilActivo?.origen||'—')}</div>
        <div><span style="color:var(--text-faint);">Fecha:</span> ${new Date().toLocaleDateString('es-MX',{year:'numeric',month:'long',day:'numeric'})}</div>
      </div>
    </div>`;

  // Temas Sprint 5
  html+=`<div class="val-section">
    <div class="val-section-header">🏷 Temas del documento</div>
    <div style="padding:12px 14px;">
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Los temas ayudan al agente IA a priorizar artículos relevantes.</p>
      <div class="temas-container" id="temas-container"></div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost" id="btn-etiquetar-temas" onclick="etiquetarTemasConIA()" style="font-size:11px;">🏷 Etiquetar temas con IA</button>
        <button class="btn btn-ghost" onclick="exportarContextoAgente()" style="font-size:11px;">📄 Exportar contexto IA (.md)</button>
      </div>
    </div>
  </div>`;

  // Verificación RAG — se rellena por _renderRAGVerificacion() cuando el embed termina
  html += `<div id="rag-verificacion-container">`;
  // Si hay resultado previo en state, renderizarlo inline
  if (state.ragVerificacion) {
    // Se llenará cuando el DOM esté listo vía _renderRAGVerificacion()
  }
  html += `</div>`;

  if(state.aprobado){
    html+=`<div class="approve-box aprobado">
      <div class="aprobado-badge">✓ Documento aprobado</div>
      <h3>Listo para exportar y enviar</h3>
      <p>El JSON incluye estados jurídicos, metadatos y firma de contenido.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn btn-approve" style="width:auto;padding:9px 20px;" onclick="exportarJSONAprobado()">⬇ Descargar JSON</button>
        <button class="btn btn-approve" id="btn-enviar-lumen" onclick="enviarALumen()" style="width:auto;padding:9px 20px;background:var(--frac);border-color:var(--frac);">🚀 Enviar a Lumen</button>
      </div>
      <div class="lumen-send-result" id="lumen-send-result"></div>
    </div>`;
  } else {
    html+=`<div class="approve-box">
      <h3>Revisión y aprobación</h3>
      <p>Confirma que has revisado el documento completo y que el contenido es correcto para importar a Lumen.</p>
      ${faltantes.length>0?`<p style="color:var(--err);font-size:12px;margin-bottom:12px;">⚠ No puedes aprobar con artículos faltantes.</p>`:''}
      <button class="btn btn-approve" onclick="aprobarDocumento()" ${faltantes.length>0?'disabled':''}>🛡 Aprobar y habilitar exportación</button>
    </div>`;
  }
  el.innerHTML=_ayudaVal+html;
  renderTemas();
  // Rellenar verificación RAG si hay resultado en state
  if(state.ragVerificacion) _renderRAGVerificacion();
}

function aprobarDocumento(){
  state.aprobado=true;
  logOk('Aprobado','Usuario aprobó el contenido',new Date().toLocaleTimeString());
  renderValidacion();renderLog();
  const b=document.getElementById('panel-badges');
  const old=b.querySelector('.ok-badge');if(old)old.remove();
  b.innerHTML=`<span class="ok-badge">🛡 Aprobado</span>`+b.innerHTML;
  toast('Aprobado — puedes exportar','success');
}

function exportarEstructuraPDF(){
  const titulo = state.perfilActivo?.nombre || 'Documento';
  const fecha = new Date().toLocaleDateString('es-MX');

  // Construir HTML para imprimir
  let html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <title>Estructura — ${titulo}</title>
  <style>
    body{font-family:Georgia,serif;font-size:11pt;line-height:1.6;color:#111;margin:2cm;max-width:none;}
    h1{font-size:14pt;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:16px;}
    .meta{font-size:9pt;color:#555;margin-bottom:24px;}
    .seccion{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;
             color:#1a56db;border-top:1px solid #ccc;padding-top:8px;margin:16px 0 8px;}
    .art-titulo{font-size:10.5pt;font-weight:700;color:#1a56db;margin:12px 0 4px;}
    .art-body{font-size:10pt;margin-bottom:4px;}
    .art-frac{margin:4px 0 4px 20px;font-size:10pt;}
    .art-frac-etq{font-weight:700;color:#008573;}
    .art-inc{margin:2px 0 2px 36px;font-size:10pt;}
    .art-inc-etq{font-weight:700;color:#b45309;}
    .bloque{background:#f8f8f8;border-left:3px solid #ccc;padding:8px 12px;
            margin:8px 0;font-size:9.5pt;color:#444;}
    .bloque-label{font-size:8pt;font-weight:700;text-transform:uppercase;
                  letter-spacing:1px;color:#888;margin-bottom:4px;}
    .nota{font-size:8.5pt;color:#888;font-style:italic;margin-top:2px;}
    .estado-derogado{color:#999;text-decoration:line-through;}
    .estado-reformado{color:#1a56db;}
    @media print{body{margin:1.5cm;}h1{page-break-after:avoid;}.art-titulo{page-break-after:avoid;}}
  </style></head><body>`;

  html += `<h1>${escHtml(titulo)}</h1>`;
  html += `<div class="meta">Generado: ${fecha} · ${state.estructura.filter(e=>e.tipo==='articulo').length} artículos · Perfil: ${escHtml(state.perfilActivo?.nombre||'Genérico')}</div>`;

  state.estructura.forEach(item => {
    if(item.tipo === 'introduccion'){
      html += `<div class="bloque"><div class="bloque-label">Introducción / Preámbulo</div>${escHtml(item.contenido).replace(/\n/g,'<br>')}</div>`;
    } else if(item.tipo === 'seccion'){
      html += `<div class="seccion">${escHtml(item.contenido).replace(/\n/g,' · ')}</div>`;
    } else if(item.tipo === 'articulo'){
      const claseEstado = item.estado==='derogado'?'estado-derogado':item.estado==='reformado'?'estado-reformado':'';
      html += `<div class="art-titulo ${claseEstado}">${escHtml(item.articulo)}</div>`;
      if(item.fracciones?.length){
        if(item.introduccion) html += `<div class="art-body"><p style="margin:4px 0">${renderConNotasPDF(item.introduccion)}</p></div>`;
        item.fracciones.forEach(f => {
          html += `<div class="art-frac"><span class="art-frac-etq">${escHtml(f.fraccion)}</span> `;
          if(f.incisos?.length){
            if(f.introduccion) html += `<p style="margin:4px 0">${renderConNotasPDF(f.introduccion)}</p>`;
            html += '</div>';
            f.incisos.forEach(inc => {
              html += `<div class="art-inc"><span class="art-inc-etq">${escHtml(inc.inciso)}</span> ${renderConNotasPDF(inc.contenido||'')}</div>`;
            });
          } else {
            html += `${renderConNotasPDF(f.contenido||'')}</div>`;
          }
        });
      } else {
        html += `<div class="art-body"><p style="margin:4px 0">${renderConNotasPDF(item.contenido||'')}</p></div>`;
      }
    } else if(item.tipo === 'transitorio'){
      html += `<div class="bloque"><div class="bloque-label">Transitorios</div><p style="margin:4px 0">${renderConNotasPDF(item.contenido)}</p></div>`;
    } else if(item.tipo === 'firma'){
      html += `<div class="bloque"><div class="bloque-label">Firmas de promulgación</div><p style="margin:4px 0">${renderConNotasPDF(item.contenido)}</p></div>`;
    } else if(item.tipo === 'decreto_historial'){
      html += `<div class="bloque"><div class="bloque-label">Historial de decretos de reforma</div><p style="margin:4px 0">${renderConNotasPDF(item.contenido)}</p></div>`;
    }
  });

  html += `</body></html>`;

  // Abrir en nueva ventana e imprimir
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

function exportarJSONAprobado(){
  if(!state.aprobado){toast('Aprueba el documento primero','error');return;}
  const output=construirOutputFinal();
  output.meta.aprobado=true;
  output.meta.fechaExportacion=new Date().toISOString();
  const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`lumen-codex-${(state.perfilActivo?.nombre||'doc').toLowerCase().replace(/\s+/g,'-')}-${Date.now()}.json`;
  a.click();
  logOk('JSON exportado','Archivo descargado',new Date().toLocaleTimeString());renderLog();
  toast('JSON exportado','success');
}

async function eliminarRegla(patron){
  if(!state.perfilActivo)return;
  if(!confirm('¿Eliminar esta regla del perfil?'))return;
  const reglas=(state.perfilActivo.reglas||[]).filter(r=>r.patron!==patron);
  try{
    await window._updateDoc(window._doc(window._db,'lumenprep_perfiles',state.perfilActivo.id),{reglas});
    state.perfilActivo.reglas=reglas;
    renderLeyenda();renderValidacion();
    toast('Regla eliminada','success');
  }catch(e){toast('Error: '+e.message,'error');}
}


// ══ IA ═══════════════════════════════════════════════════════════
async function corregirConIA(){
  if(!state.estructura.length){toast('Primero procesa','error');return;}
  const arts=state.problemas.filter(p=>p.sugerencia==='Usar corrección IA'&&!state.problemasResueltos.has(p.articulo)).map(p=>p.articulo);
  if(!arts.length){toast('Sin artículos que requieran IA','success');return;}
  setLoading(true);
  const btn=document.getElementById('btn-ia');btn.disabled=true;btn.textContent='⏳ IA...';
  const frags=state.estructura.filter(e=>e.tipo==='articulo'&&arts.includes(e.articulo)).map(e=>`${e.articulo}:\n${e.contenido||''}`).join('\n\n---\n\n');
  const ctx=state.perfilActivo?`Ámbito: ${state.perfilActivo.ambito||'—'}, Origen: ${state.perfilActivo.origen||'—'}.`:'';
  const prompt=`Eres experto en normativa legal mexicana. ${ctx}
Devuelve ÚNICAMENTE JSON válido:
[{"tipo":"articulo","articulo":"Artículo X","introduccion":"opcional","fracciones":[{"fraccion":"I.","contenido":"texto","incisos":[{"inciso":"a)","contenido":"texto"}]}]}]
Si no hay fracciones usa "contenido".\n\n${frags}`;
  try{
    const res=await fetch('https://lumen-briefing.garogmx89.workers.dev',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:4000,messages:[{role:'user',content:prompt}]})});
    const data=await res.json();
    const corr=JSON.parse((data.content?.[0]?.text||'').replace(/```json|```/g,'').trim());
    for(const c of corr){const idx=state.estructura.findIndex(e=>e.tipo==='articulo'&&e.articulo===c.articulo);if(idx!==-1)state.estructura[idx]=c;}
    state.problemas=detectarProblemas(state.estructura);
    logOk('IA aplicada',`${corr.length} artículo(s)`,`×${corr.length}`);
    actualizarStats();renderEstructura();renderJSON();renderProblemas();renderLog();
    const b=document.getElementById('panel-badges');if(!b.querySelector('.ai-badge'))b.innerHTML+=`<span class="ai-badge">🤖 IA</span>`;
    toast(`IA corrigió ${corr.length} artículo(s)`,'success');
  }catch(e){toast('Error IA: '+e.message,'error');logErr('Error IA',e.message);}
  finally{setLoading(false);btn.disabled=false;btn.textContent='🤖 Corregir con IA';}
}


// ══ UTILIDADES ═══════════════════════════════════════════════════
function switchTab(tab){
  state.tabActiva=tab;
  ['vista','cambios','log','estructura','json','problemas','validacion'].forEach(t=>{
    document.getElementById(`pane-${t}`).style.display=t===tab?'':'none';
    const navEl = document.getElementById(`nav-${t}`);
    if(navEl) navEl.classList.toggle('active', t===tab);
  });
  // Mostrar topbar de contexto si hay documento
  if(state.textoLimpio){
    document.getElementById('panel-top-bar')?.classList.remove('hidden');
    _actualizarTopbarContexto();
  }
  // Re-renderizar módulos lazy
  if(state.textoLimpio){
    if(tab==='estructura' && state.estructura.length) renderEstructura();
    if(tab==='cambios') renderDiff();
    if(tab==='log') renderLog();
    if(tab==='json') renderJSON();
    if(tab==='problemas') renderProblemas();
  }
  if(tab==='validacion') renderValidacion();
}

// Actualiza el topbar con título y meta del documento activo
function _actualizarTopbarContexto(){
  const titulo = extraerTituloLey(state.estructura) || state.perfilActivo?.nombre || 'Documento';
  const arts   = state.estructura.filter(e=>e.tipo==='articulo').length;
  const perfil = state.perfilActivo?.nombre || '—';
  const tab    = state.tabActiva || 'vista';
  const tabLabel = {vista:'Vista',cambios:'Cambios',log:'Log',estructura:'Estructura',json:'JSON',problemas:'Problemas',validacion:'Validar'}[tab] || tab;
  const tituloEl = document.getElementById('topbar-doc-titulo');
  const metaEl   = document.getElementById('topbar-doc-meta');
  if(tituloEl) tituloEl.textContent = titulo;
  if(metaEl)   metaEl.textContent   = `${perfil} · ${arts} artículos · ${tabLabel}`;
}
function actualizarStats(){
  const arts=state.estructura.filter(e=>e.tipo==='articulo');
  const fracs=arts.reduce((n,a)=>n+(a.fracciones?.length||0),0);
  const incs=arts.reduce((n,a)=>n+(a.fracciones?.reduce((m,f)=>m+(f.incisos?.length||0),0)||0),0);
  const probActivos=state.problemas.filter(p=>!state.problemasResueltos.has(p.articulo)).length;
  document.getElementById('stat-articulos').textContent=arts.length;
  document.getElementById('stat-fracciones').textContent=fracs;
  document.getElementById('stat-incisos').textContent=incs;
  document.getElementById('stat-problemas').textContent=probActivos;
  // Badges del sidebar
  const bEst = document.getElementById('nav-badge-estructura');
  if(bEst) { bEst.textContent = arts.length > 0 ? arts.length : ''; bEst.style.display = arts.length > 0 ? '' : 'none'; }
  const bProb = document.getElementById('nav-badge-problemas');
  if(bProb) { bProb.textContent = probActivos > 0 ? probActivos : ''; bProb.style.display = probActivos > 0 ? '' : 'none'; }
  const b=document.getElementById('panel-badges');
  const old=b.querySelector('.problem-badge');if(old)old.remove();
  if(probActivos)b.innerHTML=`<span class="problem-badge">⚠ ${probActivos}</span>`+b.innerHTML;
}
function limpiarTodo(){
  state={...state,textoOriginal:'',textoLimpio:'',estructura:[],problemas:[],
    tabActiva:'vista',editandoId:null,resaltados:[],problemasResueltos:new Set(),
    snapshots:[],tokensRestaurados:new Set(),log:[],hashActual:'',aprobado:false,temasGenerados:[],
    banco:[],introSubsecciones:[]};
  diffTokens=[];tokenSeleccionado=null;
  document.getElementById('raw-input').value='';
  // Restaurar welcome screen en pane-vista
  const wsEl = document.getElementById('welcome-screen');
  const vcEl = document.getElementById('vista-content');
  if(wsEl) wsEl.style.display = 'flex';
  if(vcEl){ vcEl.style.display = 'none'; vcEl.innerHTML = ''; }
  // Ocultar tabs superiores y btn nuevo
  document.getElementById('panel-top-bar')?.classList.add('hidden');
  const btnN = document.getElementById('btn-nuevo-doc');
  if(btnN) btnN.style.display = 'none';
  const em=`<div class="empty-state"><div class="empty-state-icon">📋</div><p>Carga un nuevo documento.</p></div>`;
  ['cambios','log','estructura','json','problemas','validacion'].forEach(t=>document.getElementById(`pane-${t}`).innerHTML=em);
  // Resetear badge log en sidebar
  const navBadgeLog = document.getElementById('nav-badge-log');
  if(navBadgeLog){ navBadgeLog.style.display='none'; navBadgeLog.textContent=''; }
  document.getElementById('stats-section').style.display='none';
  document.getElementById('panel-badges').innerHTML='';
  document.getElementById('undo-banner').classList.remove('visible');
  mostrarEstado('Sin documento cargado');toast('Limpiado','success');
}
function setLoading(on){document.getElementById('loading-bar').classList.toggle('active',on);document.getElementById('btn-procesar').disabled=on;}
function mostrarEstado(m){document.getElementById('header-status').textContent=m;}
function escHtml(s){if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){if(!s)return'';return s.replace(/'/g,'&#39;').replace(/"/g,'&quot;');}

// Renderiza texto preservando notas de reforma inline al estilo DOF
// Renderiza texto plano respetando dobles saltos como separadores de párrafo
// Para bloques sin marcas §NOTA§ — introducción, transitorios simples, etc.
function renderParrafos(texto){
  if(!texto) return '';
  return texto.split(/\n\n+/)
    .map(s => escHtml(s.replace(/\n/g,' ').trim()))
    .filter(Boolean)
    .join('</p><p class="art-parrafo">');
}

function renderConNotas(texto){
  if(!texto) return '';
  const partes = texto.split(/(§NOTA§[\s\S]*?§\/NOTA§)/g);
  return partes.map(parte => {
    if(parte.startsWith('§NOTA§')){
      const nota = parte.replace('§NOTA§','').replace('§/NOTA§','').trim();
      return `<span class="nota-reforma">${escHtml(nota)}</span>`;
    }
    // Párrafos separados por doble salto, saltos simples → espacio
    const segmentos = parte.split(/\n\n+/);
    return segmentos.map(s => escHtml(s.replace(/\n/g,' ').trim())).filter(Boolean).join('</p><p class="art-parrafo">');
  }).join('');
}

// Versión para PDF — convierte §NOTA§ a span inline con estilo de impresión
function renderConNotasPDF(texto){
  if(!texto) return '';
  const partes = texto.split(/(§NOTA§[\s\S]*?§\/NOTA§)/g);
  return partes.map(parte => {
    if(parte.startsWith('§NOTA§')){
      const nota = parte.replace('§NOTA§','').replace('§/NOTA§','').trim();
      return `<span style="display:block;font-size:9px;font-style:italic;color:#888;font-family:monospace;margin:2px 0 3px 8px;padding-left:6px;border-left:2px solid #ccc;">${escHtml(nota)}</span>`;
    }
    const segs = parte.split(/\n\n+/);
    return segs.map(s => escHtml(s.replace(/\n/g,' ').trim())).filter(Boolean).join('</p><p style="margin:4px 0">');
  }).join('');
}

// ════════════════════════════════════════════════════════════════
// SPRINT 1 — PROCESO EN DOS ETAPAS
// ════════════════════════════════════════════════════════════════

function etapa2_NormalizacionFormato(texto){
  let t = texto;
  const cambios = [];

  // Paso 0 — Limpiar formato Markdown (asteriscos de pandoc/docx)
  // **texto** → texto (negrita), *texto* → texto (cursiva/itálica)
  // Estas marcas aparecen cuando el docx se convierte con pandoc
  const antMd = t.length;
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');  // **negrita**
  t = t.replace(/\*([^*\n]+)\*/g, '$1');       // *cursiva*
  const diffMd = antMd - t.length;
  if(diffMd > 0)
    cambios.push({tipo:'ok', msg:`Formato Markdown eliminado`, detalle:`${diffMd} chars de marcado ** y * removidos`});

  // Paso 1 — Unir referencias a artículo/fracción/inciso partidas por salto de línea
  // Patrón inequívoco: línea termina en preposición + salto simple + "artículo/fracción/inciso N"
  // Ej: "...conforme a lo dispuesto en el\nartículo 134 de la Constitución..."
  const refsPartidas = (t.match(/\b(?:en el|de la|de los|de las|con el|con la|a la|a los|para el|para la|por el|por la|que el|que la|del|al)\n(?=\s*(?:artículo|artículos|fracción|inciso)\s+\d)/gi) || []).length;
  t = t.replace(
    /(\b(?:en el|de la|de los|de las|con el|con la|a la|a los|para el|para la|por el|por la|que el|que la|del|al))\n(\s*(?:artículo|artículos|fracción|inciso)\s+\d)/gi,
    '$1 $2'
  );
  if(refsPartidas > 0)
    cambios.push({tipo:'ok', msg:`${refsPartidas} referencia(s) a artículo unidas`, detalle:'Salto de línea en medio de referencia normativa'});

  // Paso 2 — Normalizar saltos simples dentro de párrafos
  // EXCEPCIÓN: no unir líneas que son notas de reforma (Fracción reformada DOF, etc.)
  // ni las líneas inmediatamente anteriores a una nota de reforma
  const rEsNota = /^\*?(?:P[aá]rrafo|Art[íi]culo|Fracci[oó]n|Inciso)\s+(?:reformad[ao]|adicionad[ao]|derogad[ao]|recorrid[ao])\s+DOF|^\*?Reforma\s+DOF|^\*?Reformad[ao]\s+DOF/i;
  // Primero marcar líneas de nota con placeholder para protegerlas
  const MARCA_NOTA = '\x02NOTA_REFORMA\x03';
  const lineasProtegidas = t.split('\n').map(l => rEsNota.test(l.trim()) ? MARCA_NOTA + l + MARCA_NOTA : l).join('\n');
  // Ahora unir saltos simples pero no los que rodean MARCAs
  const saltosFixed = (lineasProtegidas.match(/([^.\n\x02\x03])\n(?!\n)(?![^\n]*\x02)/g) || []).length;
  const unido = lineasProtegidas.replace(/([^.\n\x02\x03])\n(?!\n)(?![^\n]*\x02)/g, '$1 ');
  // Restaurar líneas de nota con su salto original
  t = unido.replace(new RegExp(MARCA_NOTA + '([^\\x02\\x03]*)' + MARCA_NOTA, 'g'), '\n$1\n').replace(/\n{3,}/g, '\n\n');
  if(saltosFixed > 0)
    cambios.push({tipo:'ok', msg:'Saltos de línea normalizados', detalle:`${saltosFixed} saltos convertidos a espacio`});

  // Paso 3 — Espacios múltiples
  const antEsp = t.length;
  t = t.replace(/[ \t]{2,}/g, ' ');
  if(antEsp - t.length > 0)
    cambios.push({tipo:'ok', msg:'Espacios múltiples normalizados', detalle:`-${antEsp-t.length} chars`});

  t = t.replace(/\n\n\n+/g, '\n\n');

  const pO = contarPalabras(texto), pL = contarPalabras(t);
  const diff = pO - pL;
  if(diff > 10)
    cambios.push({tipo:'warn', msg:`Diferencia de palabras: ${diff}`, detalle:'Revisar si es normal'});
  else
    cambios.push({tipo:'ok', msg:'Integridad de palabras conservada', detalle:`Diferencia: ${diff}`});

  return {texto: t.trim(), cambios};
}

let etapaState = {textoPost1:'', cambios1:[], cambios2:[]};

// Registro de fragmentos protegidos por el usuario
let fragmentosProtegidos = new Set();

function mostrarPreviewEtapa1(texto, perfil){
  // Calcular preview: qué líneas se van a eliminar, SIN ejecutar la limpieza todavía
  const preview = calcularPreviewEtapa1(texto, perfil);
  etapaState.textoOriginalEtapa1 = texto;
  etapaState.previewLineasEliminar = preview.lineasEliminar; // Set de líneas a eliminar
  etapaState.previewCambios = preview.cambios;
  fragmentosProtegidos = new Set();

  // ── Stats bar ──────────────────────────────────────────────
  const warns = preview.cambios.filter(c=>c.tipo==='warn').length;
  const sinLimpieza = preview.lineasEliminar.size === 0;
  const statsEl = document.getElementById('etapa1-stats');
  if(statsEl) statsEl.innerHTML =
    (sinLimpieza
      ? `<span style="color:var(--ok);">✅ Sin ruido estructural detectado</span>`
      : `<span style="color:var(--diff-del-text);">🔴 ${preview.lineasEliminar.size} línea(s) a eliminar</span>`) +
    (warns>0 ? `<span style="color:var(--warn-text);">⚠️ ${warns} advertencia(s)</span>` : '<span style="color:var(--ok);">✅ Sin advertencias</span>') +
    `<span style="color:var(--text-faint);">${contarPalabras(texto).toLocaleString()} palabras en el original</span>`;

  // ── Mensaje informativo cuando no hay nada que limpiar ──────
  const docMarcado = document.getElementById('etapa1-doc-marcado');
  if(sinLimpieza && docMarcado){
    docMarcado.dataset.sinLimpieza = 'true';
  } else if(docMarcado){
    delete docMarcado.dataset.sinLimpieza;
  }

  // ── Advertencia artículos ───────────────────────────────────
  const warnArt = preview.cambios.find(c=>c.tipo==='warn');
  const warnEl = document.getElementById('etapa1-warn');
  if(warnEl){
    if(warnArt){warnEl.textContent='⚠ '+warnArt.msg+': '+warnArt.detalle;warnEl.classList.add('visible');}
    else warnEl.classList.remove('visible');
  }

  // ── Vista lista ─────────────────────────────────────────────
  const lista = document.getElementById('etapa1-cambios');
  if(lista) lista.innerHTML = preview.cambios.map(c =>
    `<div class="etapa-cambio-item ${c.tipo}">
      <span class="etapa-cambio-icon">${c.tipo==='ok'?'✅':'⚠️'}</span>
      <div class="etapa-cambio-txt" style="flex:1;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <strong>${escHtml(c.msg)}</strong>
          ${c.lineas ? `<span style="font-size:10px;background:var(--surface2);color:var(--text-faint);border-radius:4px;padding:1px 6px;font-family:monospace;letter-spacing:0.3px;">${escHtml(c.lineas)}</span>` : ''}
        </div>
        <div style="font-size:11px;margin-top:2px;color:var(--text-faint);">${escHtml(c.detalle)}</div>
      </div>
    </div>`).join('');

  // ── Vista marcada (usa el original + set de líneas a eliminar) ──
  renderDocumentoMarcadoDesdePreview(texto, preview.lineasEliminar);

  // ── Alertas de compatibilidad con perfil ──────────────────
  const alertasEl = document.getElementById('etapa1-alertas-perfil');
  if(alertasEl){
    const alertas = detectarAlertasPerfil(texto, perfil);
    if(alertas.length === 0){
      alertasEl.innerHTML = '';
    } else {
      alertasEl.innerHTML = alertas.map(a => `
        <div style="background:#f7c94f18;border:1px solid #f7c94f55;border-left:3px solid #f7c94f;
          border-radius:6px;padding:10px 14px;margin-bottom:8px;font-size:12px;">
          <div style="font-weight:700;color:var(--warn-text);margin-bottom:4px;">⚠ ${escHtml(a.titulo)}</div>
          <div style="color:var(--text-dim);">${escHtml(a.detalle)}</div>
          ${a.sugerencia ? `<div style="color:var(--text-faint);font-size:11px;margin-top:4px;">💡 ${escHtml(a.sugerencia)}</div>` : ''}
        </div>`).join('');
    }
  }

  // Mostrar vista marcada por defecto
  switchVistaEtapa('marcada');
  document.getElementById('modal-etapa1').classList.remove('hidden');
}

// Detecta señales de que el perfil activo puede no ser adecuado para este documento
function detectarAlertasPerfil(texto, perfil){
  const alertas = [];
  const lineas = texto.split('\n');

  // ── Señal A: patrón de artículos vs patronArticulo del perfil ──
  const countMayus  = (texto.match(/^ARTÍCULO\s+\d+/gm) || []).length;
  const countStd    = (texto.match(/^Artículo\s+\d+/gm) || []).length;
  const totalArts   = countMayus + countStd;
  if(totalArts > 0 && perfil){
    const perfilEsMayus = perfil.patronArticulo === 'mayusculas';
    const docEsMayus    = countMayus > countStd;
    if(perfilEsMayus && !docEsMayus && countStd > 3){
      alertas.push({
        titulo: 'Patrón de artículos no coincide con el perfil',
        detalle: `El documento usa "Artículo N." (${countStd} ocurrencias) pero el perfil está configurado para "ARTÍCULO N.-" (mayúsculas). El parser puede no detectar los artículos correctamente.`,
        sugerencia: 'Considera cambiar el patronArticulo del perfil a "standard", o usar un perfil Estatal.'
      });
    } else if(!perfilEsMayus && docEsMayus && countMayus > 3){
      alertas.push({
        titulo: 'Patrón de artículos no coincide con el perfil',
        detalle: `El documento usa "ARTÍCULO N.-" (${countMayus} ocurrencias) pero el perfil está configurado para "Artículo N." (estándar). El parser puede no detectar los artículos correctamente.`,
        sugerencia: 'Considera cambiar el patronArticulo del perfil a "mayusculas", o usar el perfil Ley Federal — DOF.'
      });
    }
  }

  // ── Señal B: saltos en la numeración de artículos ──
  const numeros = [];
  lineas.forEach(l => {
    const m = l.match(/^(?:ARTÍCULO|Artículo)\s+(\d+)/);
    if(m) numeros.push(parseInt(m[1]));
  });
  if(numeros.length > 2){
    const saltos = [];
    for(let i = 1; i < numeros.length; i++){
      const diff = numeros[i] - numeros[i-1];
      if(diff > 10 && diff < 5000){ // salto grande pero no el salto al historial de decretos
        saltos.push({ de: numeros[i-1], a: numeros[i], diff });
      }
    }
    if(saltos.length > 0){
      const ejemplos = saltos.slice(0,3).map(s => `Art. ${s.de} → Art. ${s.a}`).join(', ');
      alertas.push({
        titulo: `Saltos en la numeración de artículos (${saltos.length} detectado${saltos.length>1?'s':''})`,
        detalle: `Se detectaron saltos grandes en la secuencia numérica: ${ejemplos}. Puede indicar artículos con formato diferente, secciones no reconocidas, o un documento con estructura atípica.`,
        sugerencia: 'Revisa el módulo Estructura después de procesar para verificar que todos los artículos fueron detectados correctamente.'
      });
    }
  }

  // ── Señal C: documento sin patrón de artículos reconocible ──
  if(totalArts === 0 && texto.length > 500){
    alertas.push({
      titulo: 'No se detectaron artículos con el formato esperado',
      detalle: 'El texto no contiene líneas que comiencen con "ARTÍCULO N" o "Artículo N". Es posible que el documento use un formato diferente al del perfil seleccionado.',
      sugerencia: 'Verifica que el perfil corresponda al tipo de documento, o revisa si el documento requiere un perfil personalizado.'
    });
  }

  return alertas;
}

// Calcula qué líneas serán eliminadas sin modificar el texto todavía
function calcularPreviewEtapa1(texto, perfil){
  const cambios = [];
  const lineasEliminar = new Set(); // índices de líneas a eliminar
  const lineas = texto.split('\n');

  // Helper: formatea lista de índices como rango legible ej. "L3, L7–L9, L15"
  function formatearLineas(indices){
    const sorted = [...indices].sort((a,b)=>a-b);
    const rangos = [];
    let ini = sorted[0], fin = sorted[0];
    for(let i = 1; i < sorted.length; i++){
      if(sorted[i] === fin + 1){ fin = sorted[i]; }
      else {
        rangos.push(ini === fin ? `L${ini+1}` : `L${ini+1}–L${fin+1}`);
        ini = fin = sorted[i];
      }
    }
    rangos.push(ini === fin ? `L${ini+1}` : `L${ini+1}–L${fin+1}`);
    return rangos.slice(0,6).join(', ') + (rangos.length > 6 ? '…' : '');
  }

  // Sellos digitales
  const idxSellos = [];
  lineas.forEach((linea, idx) => {
    if(/[A-Za-z0-9+/]{40,}={0,2}/.test(linea)){
      lineasEliminar.add(idx);
      idxSellos.push(idx);
    }
  });
  if(idxSellos.length > 0)
    cambios.push({tipo:'ok', msg:`${idxSellos.length} sello(s) digital(es) a eliminar`, detalle:'Líneas con firmas digitales', lineas: formatearLineas(idxSellos)});

  // Números de página solos
  const idxPags = [];
  lineas.forEach((linea, idx) => {
    if(!lineasEliminar.has(idx) && /^\s*\d{1,4}\s*$/.test(linea) && linea.trim() !== ''){
      lineasEliminar.add(idx);
      idxPags.push(idx);
    }
  });
  if(idxPags.length > 0)
    cambios.push({tipo:'ok', msg:`${idxPags.length} número(s) de página a eliminar`, detalle:'Líneas que solo contienen un número', lineas: formatearLineas(idxPags)});

  // Ruido del perfil
  if(perfil?.ruido?.length){
    for(const p of perfil.ruido){
      try{
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('^\\s*' + escaped + '\\s*$', 'i');
        const idxRuido = [];
        lineas.forEach((linea, idx) => {
          if(!lineasEliminar.has(idx) && re.test(linea)){
            lineasEliminar.add(idx);
            idxRuido.push(idx);
          }
        });
        if(idxRuido.length > 0)
          cambios.push({tipo:'ok', msg:`Ruido: "${p.slice(0,40)}"`, detalle:`${idxRuido.length} línea(s)`, lineas: formatearLineas(idxRuido)});
      }catch(e){}
    }
  }

  // Reglas tipo pie_pagina
  if(perfil?.reglas?.length){
    for(const regla of perfil.reglas){
      if(regla.tipo !== 'pie_pagina') continue;
      try{
        const esc = regla.patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const ctx = regla.contextoAplicacion || 'linea_sola';
        let re;
        if(ctx === 'linea_sola')       re = new RegExp('^\\s*' + esc + '.*$', 'i');
        else if(ctx === 'inicio_linea') re = new RegExp('^\\s*' + esc, 'i');
        else                            re = new RegExp(esc, 'i');
        const idxRegla = [];
        lineas.forEach((linea, idx) => {
          if(!lineasEliminar.has(idx) && re.test(linea)){
            lineasEliminar.add(idx);
            idxRegla.push(idx);
          }
        });
        if(idxRegla.length > 0)
          cambios.push({tipo:'ok', msg:`Regla: "${regla.nombre}"`, detalle:`ctx:${ctx} · ${idxRegla.length} línea(s)`, lineas: formatearLineas(idxRegla)});
      }catch(e){}
    }
  }

  // Verificar artículos
  const re_art = /Artículo\s+(\d+)/gi;
  const numsOrig = [...texto.matchAll(re_art)].map(m => parseInt(m[1]));
  const textoSinEliminar = lineas.filter((_,idx) => !lineasEliminar.has(idx)).join('\n');
  const numsPost = [...textoSinEliminar.matchAll(re_art)].map(m => parseInt(m[1]));
  const setO = new Set(numsOrig), setP = new Set(numsPost);
  const faltantes = [...setO].filter(n => !setP.has(n));
  if(faltantes.length > 0)
    cambios.push({tipo:'warn', msg:'Artículos posiblemente afectados', detalle:`Revisar: ${faltantes.slice(0,5).join(', ')}`});
  else
    cambios.push({tipo:'ok', msg:'Integridad de artículos: OK', detalle:`${setP.size} artículos presentes tras limpieza`});

  return { lineasEliminar, cambios };
}

// Renderiza el documento original marcando las líneas que SE VAN A eliminar
function renderDocumentoMarcadoDesdePreview(original, lineasEliminar){
  const el = document.getElementById('etapa1-doc-marcado');
  if(!el) return;

  const lineas = original.split('\n');
  let fragmentoIdx = 0;

  // Banner cuando no hay nada que eliminar
  if(lineasEliminar.size === 0){
    el.innerHTML = `<div style="background:var(--ok-dim,#d1fae533);border:1px solid var(--ok,#34d399);border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--ok,#34d399);">
      ✅ <strong>El documento no requiere limpieza estructural.</strong> No se detectaron sellos, números de página ni ruido del perfil. Puedes aprobar directamente.
    </div>`;
    actualizarContadorProtegidos();
    return;
  }

  // Contenedor tipo editor con números de línea
  const numWidth = String(lineas.length).length; // dígitos del total para alinear
  let rowsHtml = '';

  lineas.forEach((linea, idx) => {
    const lineaTrim = linea.trim();
    const numStr = String(idx + 1).padStart(numWidth, ' ');

    if(!lineaTrim){
      // Línea vacía — mostrar número pero sin contenido
      rowsHtml += `<div class="doc-row">
        <span class="doc-linenum">${numStr}</span>
        <span class="doc-linecontent">&nbsp;</span>
      </div>`;
      return;
    }

    if(lineasEliminar.has(idx)){
      const fid = 'frag_' + fragmentoIdx++;
      const esProtegido = fragmentosProtegidos.has(fid);
      rowsHtml += `<div class="doc-row doc-row-eliminar ${esProtegido?'doc-row-protegido':''}"
          data-fid="${fid}" data-idx="${idx}" onclick="toggleProtegerRow('${fid}',this)">
        <span class="doc-linenum">${numStr}</span>
        <span class="doc-linecontent">${escHtml(linea)}</span>
      </div>`;
    } else {
      rowsHtml += `<div class="doc-row">
        <span class="doc-linenum">${numStr}</span>
        <span class="doc-linecontent">${escHtml(linea)}</span>
      </div>`;
    }
  });

  el.innerHTML = `<div class="doc-viewer-numbered">${rowsHtml}</div>`;
  actualizarContadorProtegidos();
}

// toggleProteger adaptado para el nuevo layout de filas
function toggleProtegerRow(fid, rowEl){
  if(fragmentosProtegidos.has(fid)){
    fragmentosProtegidos.delete(fid);
    rowEl.classList.remove('doc-row-protegido');
    toast('Fragmento marcado para eliminar','success');
  } else {
    fragmentosProtegidos.add(fid);
    rowEl.classList.add('doc-row-protegido');
    toast('Fragmento protegido — no se eliminará','success');
  }
  actualizarContadorProtegidos();
}

function renderDocumentoMarcado(original, limpio){
  const el = document.getElementById('etapa1-doc-marcado');
  if(!el) return;

  // Construir diff línea por línea para identificar qué se eliminó
  const lineasOrig = original.split('\n');
  const lineasLimp = new Set(limpio.split('\n'));

  let html = '';
  let fragmentoIdx = 0;

  for(const linea of lineasOrig){
    const lineaTrim = linea.trim();
    if(!lineaTrim){ html += '\n'; continue; }

    if(!lineasLimp.has(linea)){
      // Esta línea fue eliminada — marcarla en rojo
      const fid = 'frag_' + fragmentoIdx++;
      const esProtegido = fragmentosProtegidos.has(fid);
      html += `<span class="marca-eliminar ${esProtegido?'protegido':''}" data-fid="${fid}" data-linea="${escAttr(linea)}" onclick="toggleProteger('${fid}',this)">${escHtml(linea)}</span>
`;
    } else {
      // Línea conservada — texto normal
      html += escHtml(linea) + '\n';
    }
  }

  el.innerHTML = html;
  actualizarContadorProtegidos();
}

function toggleProteger(fid, el){
  if(fragmentosProtegidos.has(fid)){
    fragmentosProtegidos.delete(fid);
    el.classList.remove('protegido');
    toast('Fragmento marcado para eliminar','success');
  } else {
    fragmentosProtegidos.add(fid);
    el.classList.add('protegido');
    toast('Fragmento protegido — no se eliminará','success');
  }
  actualizarContadorProtegidos();
}

function actualizarContadorProtegidos(){
  const el = document.getElementById('etapa1-protegidos-count');
  if(!el) return;
  const n = fragmentosProtegidos.size;
  el.textContent = n > 0 ? `🛡 ${n} fragmento(s) protegido(s)` : '';
}

function switchVistaEtapa(modo){
  const marcada = document.getElementById('vista-marcada-container');
  const lista = document.getElementById('vista-lista-container');
  const btnM = document.getElementById('btn-vista-marcada');
  const btnL = document.getElementById('btn-vista-lista');
  if(modo === 'marcada'){
    if(marcada) marcada.style.display = '';
    if(lista)   lista.style.display = 'none';
    if(btnM){btnM.style.background='var(--accent)';btnM.style.color='#fff';btnM.style.borderColor='var(--accent)';}
    if(btnL){btnL.style.background='';btnL.style.color='';btnL.style.borderColor='';}
  } else {
    if(marcada) marcada.style.display = 'none';
    if(lista)   lista.style.display = '';
    if(btnL){btnL.style.background='var(--accent)';btnL.style.color='#fff';btnL.style.borderColor='var(--accent)';}
    if(btnM){btnM.style.background='';btnM.style.color='';btnM.style.borderColor='';}
  }
}

function cancelarEtapa1(){
  document.getElementById('modal-etapa1').classList.add('hidden');
  // Poner el texto crudo en el textarea para que el usuario pueda trabajar con él
  if(etapaState.textoOriginalEtapa1){
    document.getElementById('raw-input').value = etapaState.textoOriginalEtapa1;
    toast('Proceso cancelado — texto cargado sin limpiar','success');
  } else {
    toast('Proceso cancelado','success');
  }
  setLoading(false);
}

function ajustarReglasDesdeEtapa1(){
  document.getElementById('modal-etapa1').classList.add('hidden');
  setLoading(false);
  editarPerfilActual();
  toast('Ajusta las reglas y vuelve a procesar','success');
}

async function aprobarEtapa1(){
  document.getElementById('modal-etapa1').classList.add('hidden');

  // Recopilar índices de líneas que el usuario protegió
  const indicesProtegidos = new Set();
  document.querySelectorAll('.marca-eliminar.protegido').forEach(span => {
    const idx = parseInt(span.dataset.idx);
    if(!isNaN(idx)) indicesProtegidos.add(idx);
  });

  // Ejecutar la limpieza real AHORA, excluyendo líneas protegidas
  const texto = etapaState.textoOriginalEtapa1;
  const resultado1 = etapa1_LimpiezaEstructuralConProteccion(texto, state.perfilActivo, indicesProtegidos);
  etapaState.textoPost1 = resultado1.texto;
  etapaState.cambios1 = resultado1.cambios;

  if(indicesProtegidos.size > 0)
    logOk('Fragmentos protegidos conservados', `${indicesProtegidos.size} línea(s) mantenidas por el usuario`, `🛡${indicesProtegidos.size}`);

  logOk('Etapa 1 aprobada', `${resultado1.cambios.filter(c=>c.tipo==='ok').length} operaciones aplicadas`, '✓');

  // Poner el texto limpio en el textarea (el usuario lo puede ver)
  document.getElementById('raw-input').value = etapaState.textoPost1;

  // Continuar con Etapa 2 + parseo
  const resultado2 = etapa2_NormalizacionFormato(etapaState.textoPost1);
  etapaState.cambios2 = resultado2.cambios;
  resultado2.cambios.forEach(c => {
    if(c.tipo==='ok') logOk('Etapa 2: '+c.msg, c.detalle, '');
    else logWarn('Etapa 2: '+c.msg, c.detalle, '');
  });
  await finalizarProcesado(resultado2.texto);
}

// Versión de etapa1 que respeta líneas protegidas por índice
function etapa1_LimpiezaEstructuralConProteccion(texto, perfil, indicesProtegidos){
  const cambios = [];
  const lineas = texto.split('\n');

  // Calcular qué líneas eliminar (igual que calcularPreviewEtapa1)
  const lineasEliminar = new Set();

  lineas.forEach((linea, idx) => {
    if(indicesProtegidos.has(idx)) return; // protegida por el usuario
    if(/[A-Za-z0-9+/]{40,}={0,2}/.test(linea)) lineasEliminar.add(idx);
  });
  const sellos = lineasEliminar.size;
  if(sellos > 0) cambios.push({tipo:'ok', msg:`${sellos} sello(s) digital(es) eliminado(s)`, detalle:`-${sellos} líneas`});

  lineas.forEach((linea, idx) => {
    if(indicesProtegidos.has(idx) || lineasEliminar.has(idx)) return;
    if(/^\s*\d{1,4}\s*$/.test(linea) && linea.trim() !== '') lineasEliminar.add(idx);
  });
  const pags = lineasEliminar.size - sellos;
  if(pags > 0) cambios.push({tipo:'ok', msg:`${pags} número(s) de página eliminado(s)`, detalle:'Líneas solo con número'});

  if(perfil?.ruido?.length){
    for(const p of perfil.ruido){
      try{
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('^\\s*' + escaped + '\\s*$', 'i');
        let count = 0;
        lineas.forEach((linea, idx) => {
          if(indicesProtegidos.has(idx) || lineasEliminar.has(idx)) return;
          if(re.test(linea)){ lineasEliminar.add(idx); count++; }
        });
        if(count > 0) cambios.push({tipo:'ok', msg:`Ruido: "${p.slice(0,40)}"`, detalle:`-${count} línea(s)`});
      }catch(e){}
    }
  }

  if(perfil?.reglas?.length){
    for(const regla of perfil.reglas){
      if(regla.tipo !== 'pie_pagina') continue;
      try{
        const esc = regla.patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const ctx = regla.contextoAplicacion || 'linea_sola';
        let re;
        if(ctx === 'linea_sola')       re = new RegExp('^\\s*' + esc + '.*$', 'i');
        else if(ctx === 'inicio_linea') re = new RegExp('^\\s*' + esc, 'i');
        else                            re = new RegExp(esc, 'i');
        let count = 0;
        lineas.forEach((linea, idx) => {
          if(indicesProtegidos.has(idx) || lineasEliminar.has(idx)) return;
          if(re.test(linea)){ lineasEliminar.add(idx); count++; }
        });
        if(count > 0) cambios.push({tipo:'ok', msg:`Regla: "${regla.nombre}"`, detalle:`ctx:${ctx} -${count} línea(s)`});
      }catch(e){}
    }
  }

  // Reconstruir texto sin las líneas eliminadas
  let t = lineas.filter((_,idx) => !lineasEliminar.has(idx)).join('\n');
  t = t.replace(/\n\n\n+/g, '\n\n');

  // Verificar artículos
  const re_art = /Artículo\s+(\d+)/gi;
  const numsOrig = [...texto.matchAll(re_art)].map(m => parseInt(m[1]));
  const numsLimp = [...t.matchAll(re_art)].map(m => parseInt(m[1]));
  const setO = new Set(numsOrig), setL = new Set(numsLimp);
  const faltantes = [...setO].filter(n => !setL.has(n));
  if(faltantes.length > 0)
    cambios.push({tipo:'warn', msg:'Artículos posiblemente afectados', detalle:`Revisar: ${faltantes.slice(0,5).join(', ')}`});
  else
    cambios.push({tipo:'ok', msg:'Integridad de artículos: OK', detalle:`${setL.size} artículos presentes`});

  return {texto: t.trim(), cambios};
}

async function finalizarProcesado(textoLimpio){
  try{
    state.textoLimpio = textoLimpio;
    verificarArticulos(state.textoOriginal, state.textoLimpio);
    state.estructura = parsear(state.textoLimpio, state.perfilActivo);
    state.problemas = detectarProblemas(state.estructura);
    const arts = state.estructura.filter(e=>e.tipo==='articulo').length;
    const fracs = state.estructura.reduce((n,a)=>n+(a.fracciones?.length||0),0);
    logInfo('Parseo',`${arts} artículos, ${fracs} fracciones`,`${arts} arts`);
    if(state.problemas.length) logWarn('Problemas',`${state.problemas.length} artículo(s)`,`×${state.problemas.length}`);
    else logOk('Sin problemas','Estructura detectada','✓');
    state.hashActual = await calcularHash(state.textoLimpio);
    logInfo('Hash',`SHA-256: ${state.hashActual.slice(0,16)}...`,'');
    actualizarStats(); renderVista(); renderDiff(); renderEstructura(); renderJSON(); renderProblemas(); renderLog();
    document.getElementById('panel-top-bar')?.classList.remove('hidden');
    const _btnN = document.getElementById('btn-nuevo-doc'); if(_btnN) _btnN.style.display='';
    document.getElementById('stats-section').style.display='block';
    mostrarEstado(`${arts} artículos${state.perfilActivo?' · '+state.perfilActivo.nombre:''}`);
    toast('Documento procesado — 2 etapas completadas','success');
  }catch(e){
    toast('Error: '+e.message,'error'); logErr('Error en finalización',e.message);
  }finally{
    setLoading(false);
  }
}


// ════════════════════════════════════════════════════════════════
// SPRINT 1 — DIFF SEMÁNTICO
// ════════════════════════════════════════════════════════════════

function calcularDiffSemantico(orig, limp){
  const lineasA = orig.split('\n');
  const lineasB = limp.split('\n');
  const lm = lineasA.length, ln = lineasB.length;
  const ldp = Array.from({length:lm+1}, () => new Int32Array(ln+1));
  for(let i=lm-1;i>=0;i--)
    for(let j=ln-1;j>=0;j--)
      ldp[i][j] = lineasA[i]===lineasB[j] ? ldp[i+1][j+1]+1 : Math.max(ldp[i+1][j],ldp[i][j+1]);

  const resultado = [];
  let i=0, j=0;
  const tok = t => t.match(/[^\s]+|\s+/g) || [];
  const palabrasB = limp.match(/[a-záéíóúüña-z]{3,}/gi) || [];
  const setBp = new Set(palabrasB.map(p=>p.toLowerCase()));

  // Mapa de línea → artículo para contexto de navegación
  // m[1] captura solo "ARTÍCULO N.-" sin el texto del artículo — es el label del bloque colapsable
  // También detecta TRANSITORIOS como corte de sección (evita fusión con el último artículo)
  // Una vez detectado el inicio del historial de decretos, todas las líneas siguientes
  // quedan bajo el label fijo "Historial de decretos" — sin crear sub-bloques por artículo interno
  const reArtLinea = /^\*{0,2}(ART[IÍ]CULO\s+(?:\d+|ÚNICO|PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO)[.\-]?)\*{0,2}/i;
  const reTransLinea = /^(TRANSITORIOS|Transitorios|TRANSITORIO|Transitorio)\s*$/;
  const reInicioHistorial = /^(?:ARTÍCULOS TRANSITORIOS DE DECRETOS DE REFORMA|DECRETO por el que se)/;
  let artActual = '';
  let enHistorial = false;
  const artPorLinea = lineasA.map(l => {
    const lt = l.trim();
    // Una vez en zona de historial, todo queda bajo el mismo bloque
    if(enHistorial){ return 'Historial de decretos'; }
    if(lt.match(reInicioHistorial)){ enHistorial = true; artActual = 'Historial de decretos'; return artActual; }
    const mArt = lt.match(reArtLinea);
    if(mArt){ artActual = mArt[1].trim(); return artActual; }
    if(lt.match(reTransLinea)){ artActual = lt; return artActual; }
    return artActual;
  });

  while(i<lm || j<ln){
    if(i<lm && j<ln && lineasA[i]===lineasB[j]){
      for(const p of tok(lineasA[i]+'\n')) resultado.push({tipo:'igual',texto:p,id:'t'+resultado.length,art:artPorLinea[i]||''});
      i++; j++;
    } else if(j<ln && (i>=lm || ldp[i][j+1]>=ldp[i+1][j])){
      resultado.push({tipo:'agregado',texto:lineasB[j]+'\n',id:'t'+resultado.length,art:''});
      j++;
    } else {
      const linea = lineasA[i];
      const palabrasLinea = linea.match(/[a-záéíóúüña-z]{3,}/gi) || [];
      const encontradas = palabrasLinea.filter(p=>setBp.has(p.toLowerCase())).length;
      const pct = palabrasLinea.length > 0 ? encontradas/palabrasLinea.length : 0;
      const tipo = pct > 0.6 ? 'reformateado' : 'borrado';
      for(const p of tok(linea+'\n')) resultado.push({tipo,texto:p,id:'t'+resultado.length,art:artPorLinea[i]||''});
      i++;
    }
  }
  return resultado;
}

function actualizarColumnaLimpio(){
  // Con la nueva vista de bloques, re-renderizar el diff completo es más seguro
  // que intentar actualizar columnas individuales por bloque
  renderDiff();
}


// ════════════════════════════════════════════════════════════════
// SPRINT 2 — PARSER INTELIGENTE
// ════════════════════════════════════════════════════════════════

function extraerNotasReforma(texto){
  // Regex unificado — una sola pasada para evitar anidamiento de marcas
  // Orden: más específico (Párrafo/Artículo/Fracción/Inciso reformado) → menos específico (Reformada)
  const rUnificado = /\*?(?:P[aá]rrafo|Art[íi]culo|Fracci[oó]n|Inciso)\s+(?:reformad[ao]|adicionad[ao]|derogad[ao]|recorrid[ao])\s+DOF\s+[\d]{2}-[\d]{2}-[\d]{4}(?:\s*,\s*[\d]{2}-[\d]{2}-[\d]{4})*\*?|\*?Reforma\s+DOF\s+[\d]{2}-[\d]{2}-[\d]{4}(?:\s*,\s*[\d]{2}-[\d]{2}-[\d]{4})*(?::\s*[^\.§]{0,60})?\*?|\*?Reformad[ao]\s+DOF\s+[\d]{2}-[\d]{2}-[\d]{4}(?:\s*,\s*[\d]{2}-[\d]{2}-[\d]{4})*\*?/gi;
  const notas = [];
  const textoLimpio = texto.replace(rUnificado, match => {
    const nota = match.replace(/\*/g,'').trim();
    notas.push(nota);
    return '\u00a7NOTA\u00a7' + nota + '\u00a7/NOTA\u00a7';
  });
  return {textoLimpio: textoLimpio.trim(), notas};
}

function detectarEstadoJuridico(contenido, titulo){
  titulo = titulo || '';
  const texto = contenido.trim();
  if(!texto) return 'vacio';
  // Derogado completo — solo si TODO el contenido es la frase de derogación
  if(/^\s*se\s+deroga\.?\s*$/i.test(texto)) return 'derogado';
  // Reservado completo
  if(/^\s*reservado\.?\s*$/i.test(texto)) return 'reservado';
  // Solo marcar como derogado si el encabezado (título) dice exactamente que el artículo fue derogado
  // NO marcar si solo algunas fracciones están derogadas (el contenido tendrá texto normal también)
  if(/art[ií]culo\s+derogado\s+dof/i.test(titulo)) return 'derogado';
  if(/^\s*derogado\s+dof/i.test(titulo)) return 'derogado';
  return 'vigente';
}

function generarInstruccionAgente(estado, notas){
  if(estado === 'derogado')
    return 'DEROGADO. Usa solo como contexto histórico. NUNCA como norma vigente.';
  if(estado === 'reservado')
    return 'Artículo reservado. Sin contenido aplicable.';
  if(notas && notas.length > 0)
    return 'Norma vigente con reformas. Última: ' + notas[notas.length-1] + '. Cita el texto actual.';
  return 'Norma vigente. Puedes citar textualmente como fundamento.';
}

function detectarCorteArticulo(item, siguiente){
  const alertas = [];
  const contenido = (item.contenido || '').trim();
  // Solo verificar el punto final en artículos sin fracciones — los artículos con fracciones
  // no tienen contenido plano al final y generarían falsos positivos
  const tieneFracciones = item.fracciones && item.fracciones.length > 0;
  if(!tieneFracciones && contenido && !/[.;:]\s*$/.test(contenido) && contenido.length > 50)
    alertas.push('El artículo no termina con punto — puede estar truncado');
  if(contenido.length > 0 && contenido.length < 30 && !/se\s+deroga/i.test(contenido))
    alertas.push('Contenido muy breve — verificar si está completo');
  if(siguiente){
    const sigContenido = (siguiente.contenido || '').trim();
    if(sigContenido && sigContenido[0] === sigContenido[0].toLowerCase() && /[a-záéíóúü]/.test(sigContenido[0]))
      alertas.push('El siguiente elemento inicia en minúscula — posible continuación');
  }
  return alertas;
}


// ════════════════════════════════════════════════════════════════
// SPRINT 3 — JSON CON ESTADOS JURÍDICOS
// ════════════════════════════════════════════════════════════════

// Helper: reconstruye el texto completo de una fracción incluyendo incisos
// Codex genera fracciones con { fraccion, contenido } o { fraccion, incisos[], introduccion? }
// cuando hay incisos, fi.contenido se elimina (línea ~525)
function _textoFraccion(fr) {
  if (fr.contenido) return fr.contenido.trim();
  if (fr.texto)     return fr.texto.trim();
  if (fr.incisos && fr.incisos.length) {
    const intro = fr.introduccion ? fr.introduccion.trim() + '\n' : '';
    return intro + fr.incisos.map(i => `  ${i.inciso} ${(i.contenido||'').trim()}`).join('\n');
  }
  return '';
}

function construirOutputFinal(){
  return {
    meta:{
      perfil:          state.perfilActivo?.nombre||'Genérico',
      ambito:          state.perfilActivo?.ambito||'—',
      origen:          state.perfilActivo?.origen||'—',
      fechaProcesado:  new Date().toISOString(),
      hashContenido:   state.hashActual||'',
      aprobado:        state.aprobado,
      reglasAplicadas: (state.perfilActivo?.reglas||[]).length,
      totalArticulos:  state.estructura.filter(e=>e.tipo==='articulo').length,
      totalDerogados:  state.estructura.filter(e=>e.tipo==='articulo'&&e.estado==='derogado').length,
      totalReformados: state.estructura.filter(e=>e.tipo==='articulo'&&e.reformas&&e.reformas.length>0).length,
      temas:           state.temasGenerados||[]
    },
    contenido:[
      ...state.estructura.map(item=>{
        const limpio = Object.assign({},item);
        Object.keys(limpio).forEach(k => limpio[k]===undefined && delete limpio[k]);
        return limpio;
      }),
      ...state.resaltados.map(r=>({
        tipo:   r.tipo.toLowerCase().replace(/\s+/g,'_'),
        nombre: r.tipo,
        contenido: r.texto,
        estado: 'manual',
        instruccion_agente: 'Elemento clasificado manualmente como "'+r.tipo+'".'
      }))
    ]
  };
}


// ════════════════════════════════════════════════════════════════
// SPRINT 4 — ENVIAR A LUMEN
// ════════════════════════════════════════════════════════════════

function extraerTituloLey(estructura){
  const intro = estructura.find(e=>e.tipo==='introduccion');
  if(!intro) return null;
  const match = (intro.contenido||'').match(/^(LEY(?:[ \t]+[A-ZÁÉÍÓÚÜÑ]+)+)/m);
  return match ? match[1].trim() : null;
}

function inferirTipoNormativa(perfil){
  if(!perfil) return 'ley';
  const nombre = (perfil.nombre||'').toLowerCase();
  if(nombre.includes('reglamento')) return 'reglamento';
  if(nombre.includes('lineamiento')) return 'lineamiento';
  if(nombre.includes('acuerdo')) return 'acuerdo';
  if(nombre.includes('norma')) return 'norma';
  return 'ley';
}

function extraerFechaPublicacion(texto){
  if(!texto) return null;
  const m = texto.match(/publicada?\s+en\s+el\s+Diario\s+Oficial.*?el\s+(\d+\s+de\s+\w+\s+de\s+\d{4})/i);
  return m ? m[1] : null;
}

function extraerUltimaReforma(texto){
  if(!texto) return null;
  const m = texto.match(/[ÚU]ltima\s+reforma\s+publicada\s+DOF\s+([\d\-]+)/i);
  return m ? m[1] : null;
}

async function obtenerUidActual(){
  return new Promise(resolve => {
    try{
      const uid = localStorage.getItem('lumenprep_uid');
      if(uid){ resolve(uid); return; }
      const ingresado = prompt(
        'Para enviar a Lumen necesitas tu ID de usuario.\n\n'+
        'Encuéntralo en Lumen → tu perfil → "ID de sesión"\n\n'+
        'Se guardará localmente para futuras sesiones:'
      );
      if(ingresado && ingresado.trim()){
        localStorage.setItem('lumenprep_uid', ingresado.trim());
        resolve(ingresado.trim());
      } else { resolve(null); }
    }catch(e){ resolve(null); }
  });
}

// ════════════════════════════════════════════════════════════════
// C2-01 — JERARQUÍA NORMATIVA
// ════════════════════════════════════════════════════════════════
function _inferirJerarquia(perfil) {
  if (!perfil) return 5;
  const combined = ((perfil.nombre||'') + ' ' + (perfil.tipo||'') + ' ' + (perfil.origen||'')).toLowerCase();
  if (/constituci[oó]n/.test(combined))                            return 1;
  if (/ley\s+(federal|general|orgánica|org.nica)/.test(combined)) return 2;
  if (/ley\s/.test(combined) && !/reglamento/.test(combined))      return 2;
  if (/reglamento/.test(combined))                                 return 3;
  if (/nom\b|norma\s+oficial/.test(combined))                      return 4;
  if (/lineamiento|acuerdo|circular|criterio/.test(combined))      return 5;
  if (/estatal|municipal|pog\b/.test(combined))                    return 6;
  return 5;
}

// ════════════════════════════════════════════════════════════════
// C2-06 — INSTRUCCIÓN DE AGENTE ESPECÍFICA POR TIPO DE ARTÍCULO
// ════════════════════════════════════════════════════════════════
function _inferirInstruccionAgente(item) {
  if (item.estado === 'derogado')
    return 'Artículo DEROGADO. Solo usar como contexto histórico. NO aplicar como norma vigente.';
  if (item.estado === 'reservado')
    return 'Artículo RESERVADO. Contenido pendiente de determinar por el legislador.';
  const txt = ((item.contenido || '') + ' ' + (item.introduccion || '')).toLowerCase();
  if (/para efectos de|se entenderá por|se entiende por|para los efectos|se considera|concepto de/.test(txt))
    return 'Artículo de DEFINICIONES. Usar para interpretar términos en otros artículos. Citar cuando la consulta involucre definir conceptos legales.';
  if (/tiene por objeto|objeto de la (ley|presente)|ámbito de aplicación|aplicará a|regirá/.test(txt))
    return 'Artículo de OBJETO O ÁMBITO. Define el alcance de la norma. Citar para determinar si la ley aplica a un caso específico.';
  if (/corresponde a|atribuciones|competencia|facultades|funciones de|tendrá a su cargo/.test(txt))
    return 'Artículo de ATRIBUCIONES. Define competencias de autoridades. Citar cuando la consulta sea sobre quién tiene facultad para actuar.';
  if (/queda prohibido|se prohíbe|están obligados|deberán|tendrán la obligación|no podrán/.test(txt))
    return 'Artículo de OBLIGACIONES o PROHIBICIONES. Aplicar directamente cuando la consulta sea sobre qué se debe hacer o qué está prohibido.';
  if (/tienen derecho|podrán acceder|tendrán acceso|gozarán de|derecho a/.test(txt))
    return 'Artículo de DERECHOS. Define beneficios o prerrogativas. Citar para consultas sobre elegibilidad o derechos de beneficiarios.';
  if (/sanción|multa|infracción|se sancionará|responsabilidad administrativa/.test(txt))
    return 'Artículo de SANCIONES. Aplicar cuando la consulta involucre consecuencias por incumplimiento.';
  if (/procedimiento|trámite|requisitos|solicitud|plazo de|días hábiles/.test(txt))
    return 'Artículo de PROCEDIMIENTO. Describe pasos, requisitos o plazos. Citar para consultas sobre cómo realizar una gestión.';
  if (/recursos|financiamiento|presupuesto|fondos|subsidio|apoyo económico/.test(txt))
    return 'Artículo de RECURSOS O FINANCIAMIENTO. Usar para consultas sobre fuentes de financiamiento o subsidios.';
  return 'Artículo normativo vigente. Aplicar como fundamento legal cuando sea relevante para la consulta.';
}

async function enviarALumen(){
  if(!state.aprobado){ toast('Aprueba el documento antes de enviarlo','error'); return; }
  if(!window._dbReady){ toast('Sin conexión a Firestore','error'); return; }

  // ── C3-02: Modal de confirmación ────────────────────────────────
  const titulo = extraerTituloLey(state.estructura) || state.perfilActivo?.nombre || 'Documento sin título';
  const totalArts = state.estructura.filter(e=>e.tipo==='articulo').length;
  const totalTrans = state.estructura.filter(e=>e.tipo==='transitorio').length;
  const perfil = state.perfilActivo?.nombre || 'Genérico';
  const ambito = state.perfilActivo?.ambito || '—';
  const confirmado = await _mostrarModalConfirmacionEnvio({ titulo, totalArts, totalTrans, perfil, ambito });
  if(!confirmado) return;

  const btn = document.getElementById('btn-enviar-lumen');
  if(btn){ btn.disabled=true; btn.textContent='⏳ Enviando...'; }
  try{
    const output = construirOutputFinal();
    output.meta.aprobado = true;
    const docLumen = {
      titulo:         extraerTituloLey(state.estructura)||state.perfilActivo?.nombre||'Documento sin título',
      tipo:           inferirTipoNormativa(state.perfilActivo),
      ambito:         state.perfilActivo?.ambito||'',
      origen:         state.perfilActivo?.origen||'',
      fechaPublicacion: extraerFechaPublicacion(state.textoOriginal)||'',
      ultimaReforma:  extraerUltimaReforma(state.textoOriginal)||'',
      estado:         'borrador_lumenprep',
      perfilVersion:  state.perfilActivo?.version || '1.0',  // C1-03
      jerarquia:      _inferirJerarquia(state.perfilActivo),  // C2-01
      articulos: (() => {
        let secActual = '';
        let secSubtitulo = '';  // ej. "DE LAS DISPOSICIONES GENERALES"
        let capActual = '';
        let capNombre = '';     // ej. "De los lineamientos"
        return output.contenido
          .filter(e => e.tipo === 'articulo' || e.tipo === 'seccion' || e.tipo === 'capitulo')
          .reduce((arts, item) => {
            if (item.tipo === 'seccion' || item.tipo === 'capitulo') {
              const lineas = (item.contenido || '').split('\n')
                .map(l => l.trim()).filter(Boolean);
              lineas.forEach(l => {
                if (/^(T[ÍI]TULO|TITULO|LIBRO|PARTE|SECCI[ÓO]N)\s/i.test(l)) {
                  secActual = l; secSubtitulo = ''; capActual = ''; capNombre = '';
                } else if (/^CAP[IÍ]TULO\s/i.test(l)) {
                  capActual = l; capNombre = '';
                } else {
                  // Línea de subtítulo/nombre
                  if (!capActual && secActual) secSubtitulo = secSubtitulo || l;
                  else if (capActual) capNombre = capNombre || l;
                }
              });
            } else if (item.tipo === 'articulo') {
              // Normalizar fracciones: si tienen incisos, reconstruir contenido
              const fraccionesNorm = (item.fracciones || []).map(fr => ({
                fraccion: fr.fraccion || fr.numero || '',
                contenido: _textoFraccion(fr),
                ...(fr.introduccion ? { introduccion: fr.introduccion } : {})
              }));
              // C2-06: instruccion_agente específica por contenido del artículo
              const instruccion = _inferirInstruccionAgente(item);
              arts.push(Object.assign({}, item, {
                fracciones:        fraccionesNorm,
                seccion:           secActual,
                seccion_subtitulo: secSubtitulo,
                capitulo:          capActual,
                capitulo_nombre:   capNombre,
                instruccion_agente: instruccion
              }));
            }
            return arts;
          }, []);
      })(),
      introduccion:   output.contenido.find(e=>e.tipo==='introduccion')||null,
      transitorios:   output.contenido.filter(e=>e.tipo==='transitorio'),
    firmas:        output.contenido.filter(e=>e.tipo==='firma'),
    decreto_historial: output.contenido.filter(e=>e.tipo==='decreto_historial') || [],
      meta:           output.meta,
      hashContenido:  state.hashActual||'',
      temas:          state.temasGenerados||[],
      visibilidadDefault: 1,
      creadoEn:       new Date().toISOString(),
      fuente:         'lumen_prep'
    };
    const uid = await obtenerUidActual();
    if(!uid){ toast('No se detectó usuario — ingresa tu UID de Lumen','error'); return; }
    const colRef = window._collection(window._db, `usuarios/${uid}/normatividad`);
    const docRef = await window._addDoc(colRef, docLumen);
    const normaId = docRef.id;
    const el = document.getElementById('lumen-send-result');
    if(el){ el.textContent='✅ Borrador creado en Lumen: "'+docLumen.titulo+'"'; el.classList.add('visible'); }
    logOk('Enviado a Lumen','"'+docLumen.titulo+'"', uid.slice(0,8));
    renderLog();
    toast('Documento enviado a Lumen','success');

    // ── Auto-embed: indexar artículos en Vectorize ──────────────
    _embedNorma(normaId, docLumen);

    // ── C1-06: Bitácora de operaciones ──────────────────────────
    _registrarOperacion('envio_lumen', {
      normaId,
      titulo: docLumen.titulo,
      perfil: docLumen.perfilVersion,
      articulos: docLumen.articulos.length,
      transitorios: docLumen.transitorios.length
    });

  }catch(e){
    toast('Error al enviar: '+e.message,'error');
    logErr('Error al enviar a Lumen', e.message);
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='🚀 Enviar a Lumen como borrador'; }
  }
}

// ════════════════════════════════════════════════════════════════
// AUTO-EMBED — indexar artículos en Vectorize tras envío a Lumen
// ════════════════════════════════════════════════════════════════
async function _embedNorma(normaId, docLumen) {
  const WORKER_URL   = 'https://lumen-briefing.garogmx89.workers.dev';
  const LOTE         = 20;
  const PAUSA_ART    = 1200;  // ms entre artículos
  const PAUSA_LOTE   = 3000;  // ms entre lotes

  const articulos = [
    // Preámbulo si existe
    ...(docLumen.introduccion ? [{
      id:      'preambulo',
      numero:  '_preambulo',
      articulo_original: 'Artículo_preámbulo',
      tipo:    'articulo',
      texto:   (docLumen.introduccion.contenido || '').slice(0, 1000)
    }] : []),
    // Artículos normales
    ...docLumen.articulos,
    // Transitorios
    ...docLumen.transitorios.map((t, i) => ({
      ...t,
      numero: t.numero || `T${i + 1}`,
      tipo:   'transitorio'
    }))
  ].filter(a => {
    const texto = a.contenido || a.introduccion || a.texto || '';
    return texto.trim().length > 0;
  });

  if (!articulos.length) return;

  const norma  = docLumen.titulo || 'Norma';
  const ambito = docLumen.ambito || 'Federal';
  const total  = articulos.length;

  // ── C1-04: Marcar embedParcial antes de empezar ──────────────
  try {
    const uid = localStorage.getItem('lumenprep_uid');
    const docRef = window._doc(window._db, `usuarios/${uid}/normatividad/${normaId}`);
    await window._updateDoc(docRef, { embedParcial: true, embeddingGenerado: false });
  } catch(e) { console.warn('[embed] No se pudo marcar embedParcial:', e.message); }

  logOk('Auto-embed iniciado', `${total} artículos a indexar`, normaId.slice(0,8));
  toast(`Indexando ${total} artículos en RAG…`, '');

  // ── C3-01: Barra de progreso del embed ───────────────────────
  _renderBarraProgreso(0, total, '');

  let indexados = 0;
  let errores   = 0;

  for (let i = 0; i < articulos.length; i++) {
    const art     = articulos[i];
    const artId   = art.id || `art_${i}`;
    const artNum  = art.articulo_original || art.numero || `Artículo ${i + 1}`;
    const tipo    = art.tipo || 'articulo';

    // Actualizar barra de progreso
    _renderBarraProgreso(i + 1, total, artNum);

    // Texto completo: preferir contenido estructurado
    let texto = '';
    if (art.introduccion) texto += art.introduccion + '\n';
    if (art.fracciones && art.fracciones.length) {
      art.fracciones.forEach(f => {
        texto += (f.fraccion || f.numero || '') + ' ' + (f.contenido || f.txt || '') + '\n';
      });
    }
    if (!texto.trim()) texto = art.contenido || art.texto || '';
    texto = texto.replace(/§NOTA§[\s\S]*?§\/NOTA§/g, '').trim().slice(0, 1000);

    if (!texto) { continue; }

    try {
      const res = await fetch(`${WORKER_URL}/embed`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:       `${normaId}_${artId}`,
          text:     `${norma} — ${artNum}\n\n${texto}`,
          metadata: {
            normaId,
            articuloId: artId,
            norma:      norma.toUpperCase(),
            articulo:   artNum,
            numero:     String(art.numero || ''),
            tipo,
            ambito,
            texto:      texto.slice(0, 1500)
          }
        })
      });
      if (res.ok) { indexados++; }
      else        { errores++; console.warn('[embed] Error HTTP', res.status, artNum); }
    } catch(e) {
      errores++;
      console.warn('[embed] Error:', artNum, e.message);
    }

    // Pausa entre artículos
    await new Promise(r => setTimeout(r, PAUSA_ART));

    // Pausa extra entre lotes
    if ((i + 1) % LOTE === 0 && i + 1 < articulos.length) {
      await new Promise(r => setTimeout(r, PAUSA_LOTE));
    }
  }

  // Ocultar barra de progreso
  _renderBarraProgreso(total, total, '', true);

  // Marcar en Firestore que el embedding fue generado (quita embedParcial)
  try {
    const uid    = localStorage.getItem('lumenprep_uid');
    const docRef = window._doc(window._db, `usuarios/${uid}/normatividad/${normaId}`);
    await window._updateDoc(docRef, { embeddingGenerado: true, embedParcial: false });
  } catch(e) {
    console.warn('[embed] No se pudo marcar embeddingGenerado:', e.message);
  }

  const msg = errores === 0
    ? `✅ ${indexados} artículos indexados en RAG`
    : `⚠ ${indexados} indexados, ${errores} errores`;

  logOk('Auto-embed completado', msg, normaId.slice(0,8));
  renderLog();
  toast(msg, errores === 0 ? 'success' : '');

  // ── C1-06: Bitácora — registrar embed ─────────────────────────
  _registrarOperacion('embed_completado', {
    normaId, norma, indexados, errores, total, ambito
  });

  // Guardar resultado del embed en state para verificación RAG
  state.embedResult = {
    normaId,
    norma,
    ambito,
    totalEsperados: total,
    indexados,
    errores,
    fecha: new Date().toISOString()
  };

  // Lanzar verificación automática en segundo plano
  _verificarRAG(normaId, norma, ambito, total);
}


// ════════════════════════════════════════════════════════════════
// C3-02 — MODAL DE CONFIRMACIÓN ANTES DE ENVIAR A LUMEN
// ════════════════════════════════════════════════════════════════
function _mostrarModalConfirmacionEnvio({ titulo, totalArts, totalTrans, perfil, ambito }) {
  return new Promise(resolve => {
    // Eliminar modal anterior si existe
    document.getElementById('modal-confirm-envio')?.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-confirm-envio';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:20px;`;
    modal.innerHTML = `
      <div style="background:var(--surface1);border:1px solid var(--border2);border-radius:12px;
                  max-width:480px;width:100%;padding:0;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5);">
        <div style="background:var(--surface2);padding:16px 20px;border-bottom:1px solid var(--border);">
          <div style="font-weight:700;font-size:15px;color:var(--text);">🚀 Confirmar envío a Lumen</div>
          <div style="font-size:11px;color:var(--text-faint);margin-top:2px;">Revisa los datos antes de continuar</div>
        </div>
        <div style="padding:18px 20px;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <tr><td style="color:var(--text-faint);padding:5px 0;width:120px;">Título</td>
                <td style="color:var(--text);font-weight:600;">${escHtml(titulo)}</td></tr>
            <tr><td style="color:var(--text-faint);padding:5px 0;">Perfil</td>
                <td style="color:var(--text);">${escHtml(perfil)}</td></tr>
            <tr><td style="color:var(--text-faint);padding:5px 0;">Ámbito</td>
                <td style="color:var(--text);">${escHtml(ambito)}</td></tr>
            <tr><td style="color:var(--text-faint);padding:5px 0;">Artículos</td>
                <td style="color:var(--ok);font-weight:600;">${totalArts}</td></tr>
            <tr><td style="color:var(--text-faint);padding:5px 0;">Transitorios</td>
                <td style="color:var(--text);">${totalTrans}</td></tr>
          </table>
          <div style="margin-top:14px;padding:10px 12px;background:var(--surface2);border-radius:6px;
                      font-size:11px;color:var(--text-faint);border-left:3px solid var(--frac);">
            ℹ️ Se creará un borrador en Lumen y se iniciará la indexación automática en el RAG.
            Este proceso puede tardar varios minutos.
          </div>
        </div>
        <div style="padding:12px 20px 18px;display:flex;gap:10px;justify-content:flex-end;">
          <button id="btn-modal-cancelar" class="btn btn-ghost" style="min-width:90px;">Cancelar</button>
          <button id="btn-modal-confirmar" class="btn btn-approve" style="min-width:120px;background:var(--frac);border-color:var(--frac);">
            ✅ Confirmar envío
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    document.getElementById('btn-modal-confirmar').onclick = () => { modal.remove(); resolve(true); };
    document.getElementById('btn-modal-cancelar').onclick  = () => { modal.remove(); resolve(false); };
    modal.addEventListener('click', e => { if(e.target === modal){ modal.remove(); resolve(false); } });
  });
}

// ════════════════════════════════════════════════════════════════
// C3-01 — BARRA DE PROGRESO DEL EMBED
// ════════════════════════════════════════════════════════════════
function _renderBarraProgreso(actual, total, artActual, finalizar = false) {
  // Buscar o crear el contenedor de barra en la pestaña validación
  let wrap = document.getElementById('embed-progress-wrap');
  if (!wrap) {
    // Intentar insertarla debajo del botón enviar
    const ref = document.getElementById('lumen-send-result');
    if (!ref) return;
    wrap = document.createElement('div');
    wrap.id = 'embed-progress-wrap';
    wrap.style.cssText = 'margin-top:10px;';
    ref.parentNode.insertBefore(wrap, ref.nextSibling);
  }

  if (finalizar || actual >= total) {
    wrap.innerHTML = '';
    return;
  }

  const pct = total > 0 ? Math.round((actual / total) * 100) : 0;
  wrap.innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:11px;color:var(--text-dim);font-weight:600;">⚙️ Indexando en RAG…</span>
        <span style="font-size:11px;font-family:'DM Mono',monospace;color:var(--text-faint);">${actual} / ${total} (${pct}%)</span>
      </div>
      <div style="background:var(--surface3);border-radius:4px;height:6px;overflow:hidden;">
        <div style="background:var(--frac);width:${pct}%;height:100%;border-radius:4px;
                    transition:width .3s ease;"></div>
      </div>
      ${artActual ? `<div style="font-size:10px;color:var(--text-faint);margin-top:5px;font-family:'DM Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(artActual)}</div>` : ''}
    </div>`;
}

// ════════════════════════════════════════════════════════════════
// C1-06 — BITÁCORA DE OPERACIONES EN FIRESTORE
// ════════════════════════════════════════════════════════════════
async function _registrarOperacion(tipo, datos = {}) {
  try {
    const uid = localStorage.getItem('lumenprep_uid');
    if (!uid) return;
    const col = window._collection(window._db, `usuarios/${uid}/operaciones`);
    await window._addDoc(col, {
      tipo,
      datos,
      fecha: new Date().toISOString(),
      fuente: 'lumen_codex'
    });
  } catch(e) {
    console.warn('[bitácora] No se pudo registrar operación:', e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// VERIFICACIÓN RAG — cierre de ciclo post-embed
// ════════════════════════════════════════════════════════════════
async function _verificarRAG(normaId, norma, ambito, totalEsperados) {
  const WORKER_URL = 'https://lumen-briefing.garogmx89.workers.dev';

  // Resultado inicial (se actualizará con las tres verificaciones)
  state.ragVerificacion = {
    normaId, norma, ambito,
    totalEsperados,
    estado: 'verificando',
    checks: []
  };
  // Actualizar UI si la pestaña validacion está visible
  _renderRAGVerificacion();

  const checks = [];

  // ── Check 1: artículos en Firestore con contenido ──────────────────────────
  try {
    const uid    = localStorage.getItem('lumenprep_uid');
    const col    = window._collection(window._db, `usuarios/${uid}/normatividad/${normaId}/articulos`);
    const snap   = await window._getDocs(col);
    let sinContenido = 0;
    let breves = 0;
    snap.forEach(doc => {
      const d = doc.data();
      const txt = d.contenido || d.introduccion || d.texto || '';
      if (!txt.trim()) sinContenido++;
      else if (txt.trim().length < 30) breves++;
    });
    const total = snap.size;
    const ok    = sinContenido === 0;
    checks.push({
      id:    'firestore',
      label: 'Artículos en Firestore',
      ok,
      valor: `${total - sinContenido}/${total} con contenido`,
      detalle: sinContenido > 0
        ? `⚠ ${sinContenido} artículo(s) sin contenido — re-procesa y re-envía`
        : breves > 0
          ? `ℹ ${breves} artículo(s) con contenido muy breve (<30 chars) — verifica`
          : 'Todos los artículos tienen contenido completo',
      warn: breves > 0 && sinContenido === 0
    });
  } catch(e) {
    checks.push({ id:'firestore', label:'Artículos en Firestore', ok:false, valor:'Error', detalle: e.message });
  }

  // ── Check 2: búsqueda semántica de prueba ──────────────────────────────────
  try {
    // Elegir un fragmento representativo del artículo 1 para la prueba
    const art1 = state.estructura.find(e => e.tipo === 'articulo' && /ARTÍCULO\s+1[.\-]/i.test(e.articulo));
    const queryPrueba = art1
      ? (art1.contenido || art1.introduccion || '').slice(0, 80).trim()
      : `artículos ${norma}`;

    const res  = await fetch(`${WORKER_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryPrueba, topK: 3, ambito })
    });
    const data = await res.json();
    const resultados = data.results || data.matches || [];
    const encontro   = resultados.some(r =>
      (r.metadata?.normaId === normaId) ||
      (r.metadata?.norma || '').toUpperCase().includes(norma.toUpperCase().slice(0,10))
    );
    checks.push({
      id:    'busqueda',
      label: 'Búsqueda semántica de prueba',
      ok:    encontro,
      valor: encontro ? `${resultados.length} resultado(s)` : 'Sin resultados de esta norma',
      detalle: encontro
        ? `El agente encontró fragmentos de esta ley al consultar — indexación confirmada`
        : `No se encontraron resultados para esta norma. Puede ser demora de Vectorize — intenta verificar de nuevo en 1 min`
    });
  } catch(e) {
    checks.push({ id:'busqueda', label:'Búsqueda semántica de prueba', ok:false, valor:'Error', detalle: e.message });
  }

  // ── Check 3: cobertura de indexación ──────────────────────────────────────
  const indexados   = state.embedResult?.indexados || 0;
  const pctCobertura = totalEsperados > 0 ? Math.round((indexados / totalEsperados) * 100) : 0;
  const coberturaOk  = pctCobertura >= 95;
  checks.push({
    id:    'cobertura',
    label: 'Cobertura de indexación',
    ok:    coberturaOk,
    valor: `${indexados}/${totalEsperados} (${pctCobertura}%)`,
    detalle: coberturaOk
      ? 'Cobertura completa — todos los artículos fueron enviados a Vectorize'
      : `${totalEsperados - indexados} artículo(s) no indexados — revisa errores en el log`
  });

  // ── Guardar resultado final ────────────────────────────────────────────────
  const todoOk = checks.every(c => c.ok);
  state.ragVerificacion = {
    normaId, norma, ambito,
    totalEsperados,
    estado:   todoOk ? 'ok' : 'error',
    checks,
    fecha:    new Date().toISOString()
  };

  _renderRAGVerificacion();
  renderLog();

  if (todoOk) {
    logOk('Verificación RAG completa', `${norma} — todos los checks pasaron`, '✅');
    toast(`✅ Verificación RAG: ${norma} lista para consultas`, 'success');
  } else {
    const fallidos = checks.filter(c => !c.ok).length;
    logWarn('Verificación RAG con problemas', `${fallidos} check(s) fallaron`, '⚠');
    toast(`⚠ Verificación RAG: ${fallidos} problema(s) detectado(s)`, '');
  }
}

function _renderRAGVerificacion() {
  // Buscar el contenedor en el DOM — solo existe si la pestaña validación está visible
  const el = document.getElementById('rag-verificacion-container');
  if (!el) return;

  const v = state.ragVerificacion;
  if (!v) { el.innerHTML = ''; return; }

  if (v.estado === 'verificando') {
    el.innerHTML = `
      <div style="background:var(--surface2);border:1px solid var(--surface3);border-radius:8px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:var(--text-dim);">
          🔍 Verificando integridad RAG…
        </div>
        <div style="font-size:12px;color:var(--text-faint);">Consultando Firestore y Vectorize — esto toma unos segundos.</div>
      </div>`;
    return;
  }

  const { norma, checks, fecha, estado } = v;
  const todoOk  = estado === 'ok';
  const fechaFmt = fecha ? new Date(fecha).toLocaleString('es-MX') : '';

  let html = `
    <div style="border:1px solid ${todoOk ? '#34c98a55' : 'var(--err-border,#f8717155)'};
                border-left:3px solid ${todoOk ? 'var(--ok)' : 'var(--err-text)'};
                border-radius:8px;overflow:hidden;margin-bottom:12px;">
      <div style="background:${todoOk ? 'var(--ok-bg,#34c98a18)' : 'var(--err-bg)'};
                  padding:10px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
        <div>
          <span style="font-weight:700;font-size:13px;color:${todoOk ? 'var(--ok)' : 'var(--err-text)'};">
            ${todoOk ? '✅' : '⚠️'} Verificación RAG — ${escHtml(norma)}
          </span>
          ${fechaFmt ? `<span style="font-size:10px;color:var(--text-faint);margin-left:8px;">${fechaFmt}</span>` : ''}
        </div>
        <button class="btn btn-ghost" onclick="_relanzarVerificacionRAG()" 
                style="font-size:10px;padding:3px 10px;">🔄 Re-verificar</button>
      </div>`;

  for (const c of checks) {
    const color  = c.ok ? 'var(--ok)' : c.warn ? 'var(--warn-text)' : 'var(--err-text)';
    const icono  = c.ok ? '✅' : c.warn ? '⚠️' : '❌';
    html += `
      <div style="padding:10px 16px;border-top:1px solid var(--surface3);display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:14px;margin-top:1px;">${icono}</span>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:12px;font-weight:600;color:var(--text-dim);">${escHtml(c.label)}</span>
            <span style="font-size:11px;font-family:monospace;background:var(--surface2);
                         color:${color};border-radius:3px;padding:1px 6px;">${escHtml(c.valor)}</span>
          </div>
          <div style="font-size:11px;color:var(--text-faint);margin-top:3px;">${escHtml(c.detalle)}</div>
        </div>
      </div>`;
  }

  html += `</div>`;
  el.innerHTML = html;
}

function _relanzarVerificacionRAG() {
  const v = state.ragVerificacion;
  if (!v) return;
  _verificarRAG(v.normaId, v.norma, v.ambito, v.totalEsperados);
}

// ════════════════════════════════════════════════════════════════
// SPRINT 5 — AGENTE IA / TEMAS
// ════════════════════════════════════════════════════════════════

async function etiquetarTemasConIA(){
  if(!state.estructura.length){ toast('Primero procesa un documento','error'); return; }
  const btn = document.getElementById('btn-etiquetar-temas');
  if(btn){ btn.disabled=true; btn.textContent='⏳ Analizando...'; }
  const arts = state.estructura.filter(e=>e.tipo==='articulo'&&e.estado!=='derogado');
  const muestra = arts.slice(0,20).map(a=>`${a.articulo}: ${(a.contenido||a.introduccion||'').slice(0,150)}`).join('\n');
  const prompt = `Eres experto en normativa legal mexicana. Devuelve ÚNICAMENTE JSON válido:
{"temas":["tema1","tema2",...]}
Máximo 12 temas, 1-3 palabras cada uno. Artículos:
${muestra}`;
  try{
    const res = await fetch('https://lumen-briefing.garogmx89.workers.dev',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:500,messages:[{role:'user',content:prompt}]})
    });
    const data = await res.json();
    const txt = (data.content?.[0]?.text||'').replace(/```json|```/g,'').trim();
    const resultado = JSON.parse(txt);
    state.temasGenerados = resultado.temas || [];
    renderTemas();
    logOk('Temas generados',`${state.temasGenerados.length} temas`,`×${state.temasGenerados.length}`);
    toast(`${state.temasGenerados.length} temas identificados`,'success');
  }catch(e){
    toast('Error: '+e.message,'error');
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='🏷 Etiquetar temas con IA'; }
  }
}

function renderTemas(){
  const el = document.getElementById('temas-container');
  if(!el) return;
  if(!state.temasGenerados || !state.temasGenerados.length){
    el.innerHTML='<span style="font-size:11px;color:var(--text-faint);">Sin temas aún.</span>';return;
  }
  el.innerHTML = state.temasGenerados.map((t,i)=>
    `<span class="tema-tag">${escHtml(t)}<span class="tema-remove" onclick="quitarTema(${i})">×</span></span>`
  ).join('');
}

function quitarTema(idx){
  state.temasGenerados.splice(idx,1);
  renderTemas();
}

function construirContextoAgente(){
  const arts = state.estructura.filter(e=>e.tipo==='articulo');
  const normativos = arts.filter(a=>a.estado==='vigente'||!a.estado);
  const historicos = arts.filter(a=>a.estado==='derogado');
  const titulo = extraerTituloLey(state.estructura)||state.perfilActivo?.nombre||'Documento normativo';
  let ctx = '# ' + titulo + '\n';
  if(state.perfilActivo?.ambito) ctx += 'Ámbito: ' + state.perfilActivo.ambito + '\n';
  if(state.temasGenerados?.length) ctx += 'Temas: ' + state.temasGenerados.join(', ') + '\n';
  ctx += '\n---\n\n## NORMA VIGENTE\n\n';
  for(const a of normativos){
    ctx += '**' + a.articulo + '**';
    if(a.reformas && a.reformas.length) ctx += ' *(reforma: ' + a.reformas[a.reformas.length-1] + ')*';
    ctx += '\n';
    if(a.introduccion) ctx += a.introduccion + '\n';
    if(a.fracciones && a.fracciones.length){
      for(const f of a.fracciones){
        if(f.estado==='derogado') continue;
        ctx += '  ' + f.fraccion + ' ' + _textoFraccion(f) + '\n';
      }
    } else if(a.contenido){ ctx += a.contenido + '\n'; }
    ctx += '\n';
  }
  if(historicos.length){
    ctx += '---\n\n## CONTEXTO HISTÓRICO (NO aplicar como norma)\n\n';
    for(const a of historicos){
      ctx += '**' + a.articulo + '** *(DEROGADO)*\n';
      if(a.contenido) ctx += a.contenido.slice(0,200) + '\n';
      ctx += '\n';
    }
  }
  ctx += '---\n*Procesado: ' + new Date().toLocaleDateString('es-MX') + ' | Hash: ' + (state.hashActual||'').slice(0,16) + '...*\n';
  return ctx;
}

function exportarContextoAgente(){
  if(!state.estructura.length){ toast('Primero procesa un documento','error'); return; }
  const ctx = construirContextoAgente();
  const blob = new Blob([ctx], {type:'text/markdown'});
  const a = document.createElement('a');
  const nombre = (extraerTituloLey(state.estructura)||'contexto').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  a.href = URL.createObjectURL(blob);
  a.download = nombre + '-contexto-ia.md';
  a.click();
  toast('Contexto para agente exportado','success');
}

// Interactividad radios
document.addEventListener('change', e=>{
  if(e.target.name==='ctx'){
    document.querySelectorAll('.regla-contexto-opt').forEach(o=>o.classList.remove('selected'));
    e.target.closest('.regla-contexto-opt')?.classList.add('selected');
  }
  if(e.target.name==='metodo'){
    document.querySelectorAll('.metodo-opt').forEach(o=>o.classList.remove('selected'));
    e.target.closest('.metodo-opt')?.classList.add('selected');
  }
});


// ── Inicialización robusta de Firebase ──────────────────────────
// Espera a que Firebase esté listo con reintentos
function inicializarApp(){
  const maxIntentos = 20; // hasta 4 segundos
  let intentos = 0;
  const intervalo = setInterval(() => {
    intentos++;
    if(window._dbReady && typeof cargarPerfilesFirestore === 'function'){
      clearInterval(intervalo);
      cargarPerfilesFirestore().then(() => {
        console.log('[Lumen Codex] Perfiles cargados correctamente');
      }).catch(e => console.error('[Lumen Codex] Error cargando perfiles:', e));
    } else if(intentos >= maxIntentos){
      clearInterval(intervalo);
      console.warn('[Lumen Codex] Firebase tardó demasiado en inicializarse');
    }
  }, 200);
}
window.addEventListener('load', inicializarApp);

let _tt;
function toast(msg,tipo=''){const el=document.getElementById('toast');el.textContent=msg;el.className=`show ${tipo}`;clearTimeout(_tt);_tt=setTimeout(()=>{el.className='';},3000);}
