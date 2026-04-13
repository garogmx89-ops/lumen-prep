// ═══════════════════════════════════════════════
// LUMEN CODEX — core: state, perfiles, firestore,
//   log, paneles de ayuda, toolbars, carga archivo
// ═══════════════════════════════════════════════
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Estado ─────────────────────────────────────────────────────────
let state={
  textoOriginal:'',textoLimpio:'',estructura:[],problemas:[],
  tabActiva:'vista',perfiles:[],perfilActivo:null,editandoId:null,
  resaltados:[],problemasResueltos:new Set(),snapshots:[],
  tokensRestaurados:new Set(),log:[],hashActual:'',aprobado:false,
  banco:[],
  introSubsecciones:[],
  temasGenerados:[],
  hashActual:'',
  aprobado:false
};
let tagsTemp={ruido:[],trans:[]};
let catsTemp=[];
let diffTokens=[];
let tokenSeleccionado=null;
let seleccionEnEstructura=null; // {texto, artIdx, tipo}

const COLORES=['#f97316','#eab308','#22c55e','#06b6d4','#8b5cf6','#ec4899','#14b8a6','#f43f5e','#84cc16','#3b82f6'];
const CATS_FIJAS=[
  {nombre:'Artículo',color:'#4f8ef7',fija:true},{nombre:'Fracción',color:'#34c98a',fija:true},
  {nombre:'Inciso',color:'#f7c94f',fija:true},{nombre:'Introducción',color:'#a78bfa',fija:true},
  {nombre:'Transitorio',color:'#f87171',fija:true},
];
const TIPOS_ELEMENTO={
  encabezado_publicacion:{label:'Encabezado de publicación',color:'#06b6d4'},
  nombre_ley:            {label:'Nombre de la ley',         color:'#8b5cf6'},
  decreto:               {label:'Decreto / Acuerdo',        color:'#f97316'},
  exposicion_motivos:    {label:'Exposición de motivos',    color:'#eab308'},
  firma:                 {label:'Firmas institucionales',   color:'#34c98a'},
  pie_pagina:            {label:'Pie de página (ruido)',    color:'#f87171'},
  transitorio:           {label:'Transitorio',              color:'#f87171'},
  personalizado:         {label:'Categoría del perfil',     color:'#4f8ef7'},
};


// ╔══════════════════════════════════════════════════════════════════╗
// ║  LUMEN CODEX — ÍNDICE DE FUNCIONES                              ║
// ║  Archivo único ~4,600 líneas. Navegar con Ctrl+G al número.     ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║  BLOQUE              LÍNEA APROX   DESCRIPCIÓN                  ║
// ║  ─────────────────────────────────────────────────────────────  ║
// ║  PANEL AYUDA         ~1197         renderPanelAyuda, toggle     ║
// ║  LOG / RENDER        ~1335         renderLog                    ║
// ║  FIRESTORE           ~1358         cargar, poblar, seleccionar  ║
// ║  PERFILES            ~1449         importar, exportar, guardar  ║
// ║  REGLAS              ~1627         modal regla, aplicar         ║
// ║  LEYENDA / MODAL     ~1735         leyenda, modal perfil        ║
// ║  TOOLBARS            ~1816         estructura, vista            ║
// ║  CARGA ARCHIVO       ~1940         cargarArchivo, PDF, DOCX     ║
// ║  PROCESAMIENTO       ~2007         procesarDocumento            ║
// ║  ETAPA 1             ~3665         preview, alertas, aprobar    ║
// ║  ETAPA 2             ~3602         normalizacion formato        ║
// ║  PARSER              ~2284         parsear, extraerNotas        ║
// ║  RENDER VISTA        ~2637         renderVista                  ║
// ║  RENDER ESTRUCTURA   ~2710         renderEstructura, cards      ║
// ║  RENDER DIFF         ~2047         renderDiff, calcularDiff     ║
// ║  RENDER JSON         ~3188         renderJSON, exportar         ║
// ║  RENDER PROBLEMAS    ~3207         renderProblemas              ║
// ║  VALIDACIÓN          ~3247         renderValidacion, aprobar    ║
// ║  IA                  ~3459         corregirConIA                ║
// ║  UTILIDADES          ~3487         switchTab, stats, limpiar    ║
// ║  OUTPUT / SEND       ~4328         construirOutput, enviarLumen ║
// ║  TEMAS IA            ~4462         etiquetarTemas, exportar     ║
// ║  INIT                ~4568         inicializarApp               ║
// ╚══════════════════════════════════════════════════════════════════╝

// ══ TEMA ═════════════════════════════════════════════════════════
function toggleTema(){
  const h=document.documentElement;
  const n=h.getAttribute('data-theme')==='dark'?'light':'dark';
  h.setAttribute('data-theme',n);
  document.getElementById('theme-btn').textContent=n==='dark'?'🌙':'☀️';
  localStorage.setItem('lp-tema',n);
}
window.addEventListener('load',()=>{
  const t=localStorage.getItem('lp-tema')||'dark';
  document.documentElement.setAttribute('data-theme',t);
  document.getElementById('theme-btn').textContent=t==='dark'?'🌙':'☀️';
  renderLeyenda();renderColoresSugeridos();
});


// ══ HASH ═════════════════════════════════════════════════════════
async function calcularHash(texto){
  const buf=new TextEncoder().encode(texto);
  const hash=await crypto.subtle.digest('SHA-256',buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}


// ══ LOG ══════════════════════════════════════════════════════════
function logInfo(t,d,c=''){state.log.push({tipo:'info',titulo:t,detalle:d,count:c,ts:new Date().toLocaleTimeString()});}
function logOk(t,d,c=''){state.log.push({tipo:'ok',titulo:t,detalle:d,count:c,ts:new Date().toLocaleTimeString()});}
function logWarn(t,d,c=''){state.log.push({tipo:'warn',titulo:t,detalle:d,count:c,ts:new Date().toLocaleTimeString()});}
function logErr(t,d,c=''){state.log.push({tipo:'err',titulo:t,detalle:d,count:c,ts:new Date().toLocaleTimeString()});}

// ════════════════════════════════════════════════════════════════
// PANEL DE AYUDA CONTEXTUAL
// ════════════════════════════════════════════════════════════════
function renderPanelAyuda(modulo){
  // Leer preferencia de colapso desde localStorage
  const colapsado = localStorage.getItem('ayuda_colapsada_' + modulo) === '1';
  const toggle = colapsado ? '▸ Ver guía' : '▾ Ocultar guía';

  // ── Calcular semáforo y estado dinámico por módulo ──
  let color = '#4a5568', estado = '', items = [], itemsAtencion = [];

  if(modulo === 'cambios'){
    const pO = contarPalabras(state.textoOriginalCrudo||state.textoOriginal||'');
    const pL = contarPalabras(state.textoLimpio||'');
    const diff = Math.abs(pL - pO);
    const pct = pO > 0 ? (diff/pO*100).toFixed(1) : 0;
    if(diff <= 50){ color='var(--ok)'; estado='Diferencia dentro del rango normal'; }
    else if(diff <= 200){ color='#f7c94f'; estado='Diferencia moderada — revisar'; }
    else { color='var(--err)'; estado='Diferencia alta — posible pérdida de texto'; }
    items = [
      {dot:'var(--ok)', texto:'<strong>Diferencia de palabras:</strong> Lo que importa revisar. Idealmente 0 o menor a 50. Refleja si el proceso de limpieza eliminó texto normativo real (no solo saltos de línea).'},
      {dot:'var(--text-faint)', texto:'<strong>Eliminados (rojo):</strong> Incluye saltos de línea normalizados, no solo texto borrado. Un número alto de eliminados es normal si la diferencia de palabras es 0.'},
      {dot:'var(--text-faint)', texto:'<strong>Reformateados (amarillo):</strong> Texto que cambió de forma pero conserva el mismo contenido. Generalmente reformateo de espacios o puntuación.'},
      {dot:'#f7c94f', texto:'<strong>Presta atención si:</strong> La diferencia de palabras supera 50, o si ves bloques rojos que contienen texto normativo real (artículos, fracciones, definiciones).'},
    ];
  }

  else if(modulo === 'log'){
    const warns = state.log.filter(e=>e.tipo==='warn'||e.tipo==='err').length;
    if(warns === 0){ color='var(--ok)'; estado='Sin advertencias — proceso limpio'; }
    else if(warns <= 2){ color='#f7c94f'; estado=warns+' advertencia(s) — revisar'; }
    else { color='var(--err)'; estado=warns+' alertas — requiere atención'; }
    items = [
      {dot:'var(--ok)', texto:'✅ <strong>Entradas verdes:</strong> Operaciones exitosas. Sellos eliminados, artículos verificados, hash calculado.'},
      {dot:'#f7c94f', texto:'⚠️ <strong>Entradas amarillas (warn):</strong> Situaciones que merecen revisión pero no impiden el proceso. Por ejemplo, diferencia de palabras moderada.'},
      {dot:'var(--err)', texto:'❌ <strong>Entradas rojas (err):</strong> Problemas que sí pueden afectar el resultado. La más importante: "Artículos faltantes" indica que el parser no encontró artículos que existían en el original.'},
      {dot:'var(--accent)', texto:'ℹ️ <strong>Entradas informativas:</strong> Datos del proceso: perfil usado, hash SHA-256, conteo de artículos y fracciones. No requieren acción.'},
    ];
  }

  else if(modulo === 'estructura'){
    const integ = calcularIntegridadEstructura();
    const pct = integ ? parseFloat(integ.pct) : 100;
    if(pct >= 100 && pct <= 110){ color='var(--ok)'; estado='Integridad normal ('+pct+'%)'; }
    else if(pct >= 95 && pct < 100){ color='#f7c94f'; estado='Integridad ligeramente baja ('+pct+'%) — revisar'; }
    else if(pct > 110 && pct <= 115){ color='#f7c94f'; estado='Integridad ligeramente alta ('+pct+'%) — normal con muchas reformas'; }
    else { color='var(--err)'; estado='Integridad fuera de rango ('+pct+'%) — revisar parser'; }
    items = [
      {dot:'var(--ok)', texto:'<strong>Integridad 100–110%:</strong> Rango normal. La estructura reconstruida siempre es un poco mayor que el texto limpio porque el parser agrega metadatos: estado jurídico de cada artículo (vigente/derogado), instrucción para el agente IA, y notas de reforma integradas inline. Todo eso suma palabras que no estaban en el original.'},
      {dot:'#f7c94f', texto:'<strong>Integridad 110–115%:</strong> Aceptable en leyes con muchas reformas acumuladas. Las notas de reforma integradas en artículos muy reformados pueden elevar el porcentaje.'},
      {dot:'var(--err)', texto:'<strong>Integridad por debajo de 95%:</strong> El parser puede haber perdido texto normativo. Revisar artículos con contenido muy corto o vacío.'},
      {dot:'var(--err)', texto:'<strong>Integridad por encima de 115%:</strong> El parser puede estar duplicando contenido. Revisar si hay artículos con texto repetido.'},
      {dot:'var(--text-faint)', texto:'<strong>Uso sugerido:</strong> Revisa que todos los artículos tengan contenido. Los artículos con fracciones (I, II, III...) se muestran expandibles. Los artículos derogados aparecen en gris con la etiqueta "DEROGADO".'},
    ];
  }

  else if(modulo === 'json'){
    const arts = state.estructura.filter(e=>e.tipo==='articulo').length;
    const tieneHist = state.estructura.some(e=>e.tipo==='decreto_historial');
    const tieneTrans = state.estructura.some(e=>e.tipo==='transitorio');
    color = arts > 0 ? 'var(--ok)' : 'var(--err)';
    estado = arts > 0 ? arts+' artículos listos para exportar' : 'Sin artículos — procesa primero';
    items = [
      {dot:'var(--ok)', texto:'<strong>articulos:</strong> Array con todos los artículos parseados. Cada uno incluye título, contenido o fracciones, estado jurídico (vigente/derogado/reservado) e instrucción para el agente IA.'},
      {dot:'var(--ok)', texto:'<strong>transitorios:</strong> Bloque con los transitorios originales de la ley (los que acompañaron la publicación inicial). '+(tieneTrans?'✓ Detectado':'⚠ No detectado en este documento.')},
      {dot:'var(--ok)', texto:'<strong>decreto_historial:</strong> Bloque con el historial acumulado de decretos de reforma. El agente IA sabe que este bloque es contexto histórico, no norma vigente. '+(tieneHist?'✓ Detectado':'No aplica o no detectado.')},
      {dot:'#f7c94f', texto:'<strong>Presta atención si:</strong> El campo "articulos" tiene menos elementos de los esperados, o si faltan secciones que sí existen en el documento (transitorios, firmas).'},
    ];
  }

  else if(modulo === 'problemas'){
    const total = state.problemas.length;
    const activos = state.problemas.filter(p=>!state.problemasResueltos.has(p.articulo)).length;
    const truncados = state.problemas.filter(p=>!state.problemasResueltos.has(p.articulo)&&p.problema&&p.problema.includes('truncado')).length;
    const largos = state.problemas.filter(p=>!state.problemasResueltos.has(p.articulo)&&p.problema&&p.problema.includes('largo')).length;
    if(truncados > 0){ color='var(--err)'; estado=truncados+' artículo(s) posiblemente truncado(s) — requieren revisión'; }
    else if(activos > 0){ color='#f7c94f'; estado=largos+' artículo(s) largos sin estructura — validar'; }
    else { color='var(--ok)'; estado='Todos los problemas validados'; }
    items = [
      {dot:'#f7c94f', texto:'<strong>Artículo largo sin estructura:</strong> El artículo tiene más de 300 caracteres pero no se detectaron fracciones (I, II, III). Puede ser correcto — algunas leyes tienen artículos con párrafos extensos sin numerar. Haz clic en ✓ OK si el contenido se ve completo en Estructura.'},
      {dot:'var(--err)', texto:'<strong>El artículo no termina con punto — puede estar truncado:</strong> El contenido del artículo termina de forma abrupta. Revisa ese artículo en Estructura para confirmar si el texto está completo.'},
      {dot:'var(--text-faint)', texto:'<strong>Cómo resolver:</strong> Para cada problema, haz clic en "Revisar en Estructura" para ver el artículo completo, o en "Usar corrección IA" para que el sistema lo analice. Si el resultado te parece correcto, haz clic en ✓ OK para marcarlo como validado.'},
    ];
  }

  else if(modulo === 'validacion'){
    const arts = state.estructura.filter(e=>e.tipo==='articulo').length;
    const probActivos = state.problemas.filter(p=>!state.problemasResueltos.has(p.articulo)).length;
    if(arts===0){ color='var(--text-faint)'; estado='Sin documento procesado'; }
    else if(probActivos>0){ color='#f7c94f'; estado=probActivos+' problema(s) pendientes de validar'; }
    else { color='var(--ok)'; estado='Listo para exportar'; }
    items = [
      {dot:'var(--ok)', texto:'<strong>Qué hace este módulo:</strong> Verifica la integridad final del documento y habilita la exportación. Calcula un hash SHA-256 que sirve como huella digital para comprobar que el documento no fue alterado.'},
      {dot:'#f7c94f', texto:'<strong>Antes de aprobar:</strong> Revisa que los problemas en el módulo Problemas estén validados (✓ OK). No es obligatorio resolver todos, pero sí conviene entender cada uno.'},
      {dot:'var(--ok)', texto:'<strong>Al aprobar:</strong> Se habilita la exportación a JSON y el envío a Lumen. El hash queda registrado como garantía de integridad del proceso.'},
    ];
  }

  else if(modulo === 'vista'){
    const arts = state.estructura.filter(e=>e.tipo==='articulo').length;
    color = arts > 0 ? 'var(--ok)' : 'var(--text-faint)';
    estado = arts > 0 ? 'Texto limpio con '+arts+' artículos resaltados' : 'Sin documento procesado';
    items = [
      {dot:'var(--ok)', texto:'<strong>Qué muestra:</strong> El texto limpio después de la Etapa 1 (limpieza estructural) y Etapa 2 (normalización de formato), con resaltado de artículos, fracciones e incisos según el perfil activo.'},
      {dot:'var(--text-faint)', texto:'<strong>Colores:</strong> Cada tipo de elemento tiene un color en la leyenda inferior. Los artículos aparecen resaltados, igual que las fracciones e incisos.'},
      {dot:'#f7c94f', texto:'<strong>Presta atención si:</strong> Ves bloques de texto sin resaltar donde debería haber artículos, o si el texto tiene ruido visible (encabezados de página, sellos digitales) que no fue eliminado en la limpieza.'},
    ];
  }

  const itemsHtml = items.map(it =>
    `<div class="ayuda-item">
      <div class="ayuda-item-dot" style="background:${it.dot};"></div>
      <div>${it.texto}</div>
    </div>`
  ).join('');

  return `<div class="ayuda-panel" id="ayuda-${modulo}">
    <div class="ayuda-header" onclick="toggleAyuda('${modulo}')">
      <div class="ayuda-semaforo" style="background:${color};box-shadow:0 0 6px ${color}44;"></div>
      <div class="ayuda-titulo">Guía del módulo</div>
      <div class="ayuda-estado" style="color:${color};">${estado}</div>
      <div class="ayuda-toggle" id="ayuda-toggle-${modulo}">${toggle}</div>
    </div>
    <div class="ayuda-body${colapsado?' collapsed':''}" id="ayuda-body-${modulo}">
      ${itemsHtml}
    </div>
  </div>`;
}

function toggleAyuda(modulo){
  const body = document.getElementById('ayuda-body-'+modulo);
  const tog = document.getElementById('ayuda-toggle-'+modulo);
  if(!body) return;
  const colapsado = body.classList.toggle('collapsed');
  if(tog) tog.textContent = colapsado ? '▸ Ver guía' : '▾ Ocultar guía';
  localStorage.setItem('ayuda_colapsada_'+modulo, colapsado ? '1' : '0');
}

function renderLog(){
  const el=document.getElementById('pane-log');
  if(!state.log.length){el.innerHTML=`<div class="empty-state"><div class="empty-state-icon">📋</div><p>El registro aparecerá aquí.</p></div>`;return;}
  const _ayudaLog = renderPanelAyuda('log');
  const iconos={info:'ℹ️',ok:'✅',warn:'⚠️',err:'❌'};
  let html=`<div style="font-size:11px;color:var(--text-faint);margin-bottom:12px;font-family:'IBM Plex Mono',monospace;">${state.log.length} entrada(s)</div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;overflow:hidden;">`;
  for(const e of [...state.log].reverse())
    html+=`<div class="log-entry log-${e.tipo}">
      <span class="log-icon">${iconos[e.tipo]}</span>
      <div class="log-msg"><strong>${escHtml(e.titulo)}</strong>${escHtml(e.detalle)}</div>
      <div class="log-count">${e.count?escHtml(String(e.count)):''}<br><span style="font-size:10px;">${e.ts}</span></div>
    </div>`;
  html+=`</div>`;
  el.innerHTML=_ayudaLog+html;
  const warns=state.log.filter(e=>e.tipo==='warn'||e.tipo==='err').length;
  const tL=document.getElementById('tab-log');
  if(warns>0){tL.textContent='Log ⚠';tL.style.color='#f7c94f';}
  else{tL.textContent='Log ✓';tL.style.color='var(--frac)';}
}


// ══ FIRESTORE ════════════════════════════════════════════════════
async function cargarPerfilesFirestore(){
  if(!window._dbReady)return;
  try{
    const snap=await window._getDocs(window._collection(window._db,'lumenprep_perfiles'));
    state.perfiles=[];
    snap.forEach(d=>state.perfiles.push({id:d.id,...d.data()}));
    poblarSelectPerfiles();
  }catch(e){console.error(e);}
}
function poblarSelectPerfiles(){
  const sel=document.getElementById('perfil-select');
  sel.innerHTML='<option value="">— Sin perfil (genérico) —</option>';
  for(const p of state.perfiles){
    const o=document.createElement('option');
    o.value=p.id;o.textContent=`${p.nombre}${p.ambito?' · '+p.ambito:''}`;sel.appendChild(o);
  }
  // Restaurar último perfil seleccionado
  const ultimoPerfil = localStorage.getItem('lc-ultimo-perfil');
  if(ultimoPerfil){
    const sel = document.getElementById('perfil-select');
    if(sel && [...sel.options].some(o=>o.value===ultimoPerfil)){
      sel.value = ultimoPerfil;
      seleccionarPerfil();
    }
  }
  actualizarEstadoDropZone();
  // Pequeño defer para asegurar que el DOM del sidebar ya tiene las opciones
  setTimeout(poblarSelectWelcome, 0);
}
function sincronizarPerfilDesdeWelcome(val){
  // Sincroniza el select del sidebar con el del welcome screen
  const sideSelect = document.getElementById('perfil-select');
  if(sideSelect) sideSelect.value = val;
  seleccionarPerfil();
  // Actualizar badge del welcome
  const badge = document.getElementById('welcome-perfil-badge');
  const perfil = state.perfiles.find(p=>p.id===val);
  if(badge){
    if(perfil){ badge.textContent = perfil.ambito||''; badge.style.display=''; }
    else badge.style.display='none';
  }
}
function poblarSelectWelcome(){
  const ws = document.getElementById('perfil-select-welcome');
  const ss = document.getElementById('perfil-select');
  if(!ws||!ss) return;
  ws.innerHTML = ss.innerHTML;
  ws.value = ss.value;
}
function seleccionarPerfil(){
  const id=document.getElementById('perfil-select').value;
  if(!id){
    state.perfilActivo=null;
    document.getElementById('perfil-info').style.display='none';
    document.getElementById('btn-editar-perfil').style.display='none';
    document.getElementById('btn-borrar-perfil').style.display='none';
    actualizarEstadoDropZone();
    renderLeyenda();return;
  }
  const p=state.perfiles.find(x=>x.id===id);if(!p)return;
  state.perfilActivo=p;
  document.getElementById('perfil-nombre-display').textContent=p.nombre;
  document.getElementById('perfil-meta-display').textContent=p.origen||'—';
  document.getElementById('perfil-ambito-badge').textContent=p.ambito||'—';
  document.getElementById('perfil-info').style.display='';
  document.getElementById('btn-editar-perfil').style.display='';
  document.getElementById('btn-borrar-perfil').style.display='';
  actualizarEstadoDropZone();
  localStorage.setItem('lc-ultimo-perfil', p.id);
  renderLeyenda();toast(`Perfil: ${p.nombre}`,'success');
  // Mostrar/ocultar botón exportar
  document.getElementById('btn-exportar-perfil').style.display=p?'':'none';
}

function actualizarEstadoDropZone(){
  const tienePerfil = !!state.perfilActivo;
  const dz = document.getElementById('drop-zone');
  const aviso = document.getElementById('drop-zone-aviso');
  const btn = document.getElementById('btn-procesar');
  if(dz){
    dz.style.opacity = tienePerfil ? '1' : '0.5';
    dz.style.cursor  = tienePerfil ? 'pointer' : 'not-allowed';
    dz.style.borderColor = tienePerfil ? '' : 'var(--err)';
  }
  if(aviso) aviso.style.display = tienePerfil ? 'none' : 'block';
  if(btn){
    btn.style.opacity = tienePerfil ? '1' : '0.5';
    btn.title = tienePerfil ? '' : 'Selecciona un perfil primero';
  }
}

// ══ IMPORTAR / EXPORTAR PERFIL ════════════════════════════════════

function abrirImportarPerfil(){
  document.getElementById('importar-perfil-input').value='';
  document.getElementById('importar-perfil-input').click();
}

async function procesarImportarPerfil(event){
  const file=event.target.files[0];
  if(!file)return;
  try{
    const texto=await file.text();
    const datos=JSON.parse(texto);

    // Validar que sea un perfil de Lumen Prep
    if(!datos._lumenprep_perfil&&!datos.nombre){
      toast('El archivo no es un perfil válido de Lumen Codex','error');return;
    }

    // Limpiar campos internos del JSON antes de guardar
    const perfil={
      nombre:       datos.nombre       || 'Perfil importado',
      ambito:       datos.ambito       || '',
      origen:       datos.origen       || '',
      notas:        datos.notas        || '',
      ruido:        datos.ruido        || [],
      transitorios: datos.transitorios || ['TRANSITORIOS','Transitorios'],
      patronArticulo: datos.patronArticulo || 'standard',
      artRegexCustom: datos.artRegexCustom || '',
      tipoFraccion:   datos.tipoFraccion   || 'romanos',
      tipoInciso:     datos.tipoInciso     || 'minusculas',
      categorias:     datos.categorias     || [],
      reglas:         datos.reglas         || [],
      creadoEn:       new Date().toISOString(),
      importadoDe:    file.name
    };

    // Verificar si ya existe un perfil con ese nombre
    const existe=state.perfiles.find(p=>p.nombre===perfil.nombre);
    if(existe){
      const confirmar=confirm(
        `Ya existe un perfil llamado "${perfil.nombre}".\n\n¿Deseas reemplazarlo o crear uno nuevo?\n\nAceptar = Reemplazar\nCancelar = Crear nuevo (se le añadirá " (importado)")`
      );
      if(confirmar){
        // Reemplazar
        await window._updateDoc(window._doc(window._db,'lumenprep_perfiles',existe.id),perfil);
        logOk('Perfil reemplazado',`"${perfil.nombre}" actualizado desde ${file.name}`,'📥');
        toast(`Perfil "${perfil.nombre}" actualizado`,'success');
      } else {
        // Crear nuevo con nombre diferente
        perfil.nombre=perfil.nombre+' (importado)';
        await window._addDoc(window._collection(window._db,'lumenprep_perfiles'),perfil);
        logOk('Perfil importado',`"${perfil.nombre}" creado desde ${file.name}`,'📥');
        toast(`Perfil "${perfil.nombre}" importado`,'success');
      }
    } else {
      await window._addDoc(window._collection(window._db,'lumenprep_perfiles'),perfil);
      logOk('Perfil importado',`"${perfil.nombre}" creado desde ${file.name}`,'📥');
      toast(`Perfil "${perfil.nombre}" importado`,'success');
    }

    await cargarPerfilesFirestore();

    // Mostrar resumen de lo importado
    const nReglas=(perfil.reglas||[]).length;
    const nCats=(perfil.categorias||[]).length;
    setTimeout(()=>{
      alert(
        `✅ Perfil importado correctamente:\n\n`+
        `Nombre: ${perfil.nombre}\n`+
        `Ámbito: ${perfil.ambito||'—'}\n`+
        `Origen: ${perfil.origen||'—'}\n`+
        `Categorías personalizadas: ${nCats}\n`+
        `Reglas aprendidas: ${nReglas}\n\n`+
        `Selecciónalo en el selector de perfil para usarlo.`
      );
    },300);

  }catch(e){
    toast('Error al importar: '+e.message,'error');
    console.error(e);
  }
}

function exportarPerfilActual(){
  if(!state.perfilActivo){toast('Selecciona un perfil primero','error');return;}
  const p=state.perfilActivo;

  // Armar JSON exportable con metadatos
  const exportable={
    _lumenprep_perfil:  true,
    _version:           '1.0',
    _exportadoEn:       new Date().toISOString(),
    _descripcion:       `Perfil exportado desde Lumen Codex: ${p.nombre}`,
    nombre:             p.nombre,
    ambito:             p.ambito        || '',
    origen:             p.origen        || '',
    notas:              p.notas         || '',
    patronArticulo:     p.patronArticulo|| 'standard',
    artRegexCustom:     p.artRegexCustom|| '',
    tipoFraccion:       p.tipoFraccion  || 'romanos',
    tipoInciso:         p.tipoInciso    || 'minusculas',
    transitorios:       p.transitorios  || ['TRANSITORIOS','Transitorios'],
    ruido:              p.ruido         || [],
    categorias:         p.categorias    || [],
    reglas:             p.reglas        || [],
    creadoEn:           p.creadoEn      || new Date().toISOString()
  };

  const json=JSON.stringify(exportable,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const a=document.createElement('a');
  const nombreArchivo='lumenprep-perfil-'
    +p.nombre.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')
    +'.json';
  a.href=URL.createObjectURL(blob);
  a.download=nombreArchivo;
  a.click();
  logOk('Perfil exportado',`"${p.nombre}" → ${nombreArchivo}`,'📤');
  toast(`Perfil exportado: ${nombreArchivo}`,'success');
}

async function guardarPerfil(){
  const nombre=document.getElementById('fp-nombre').value.trim();
  if(!nombre){toast('Nombre obligatorio','error');return;}
  const pa=document.getElementById('fp-patron-art').value;
  // Preservar campos del perfil activo que no están en el formulario
  const camposExtras = {};
  if(state.perfilActivo?.plantillaIntroduccion) camposExtras.plantillaIntroduccion = state.perfilActivo.plantillaIntroduccion;
  const perfil={
    ...camposExtras,
    nombre,ambito:document.getElementById('fp-ambito').value,
    origen:document.getElementById('fp-origen').value.trim(),
    notas:document.getElementById('fp-notas').value.trim(),
    ruido:[...tagsTemp.ruido],
    transitorios:tagsTemp.trans.length?[...tagsTemp.trans]:['TRANSITORIOS','Transitorios'],
    patronArticulo:pa,artRegexCustom:pa==='custom'?document.getElementById('fp-art-regex').value.trim():'',
    tipoFraccion:document.getElementById('fp-tipo-frac').value,
    tipoInciso:document.getElementById('fp-tipo-inc').value,
    categorias:[...catsTemp],
    reglas:state.perfilActivo?.reglas||[],
    creadoEn:state.perfilActivo?.creadoEn||new Date().toISOString()
  };
  try{
    if(state.editandoId)await window._updateDoc(window._doc(window._db,'lumenprep_perfiles',state.editandoId),perfil);
    else await window._addDoc(window._collection(window._db,'lumenprep_perfiles'),perfil);
    toast(state.editandoId?'Perfil actualizado':'Perfil guardado','success');
    cerrarModal();await cargarPerfilesFirestore();
  }catch(e){toast('Error: '+e.message,'error');}
}
async function borrarPerfilActual(){
  if(!state.perfilActivo)return;
  if(!confirm(`¿Borrar "${state.perfilActivo.nombre}"?`))return;
  try{
    await window._deleteDoc(window._doc(window._db,'lumenprep_perfiles',state.perfilActivo.id));
    state.perfilActivo=null;document.getElementById('perfil-select').value='';
    seleccionarPerfil();await cargarPerfilesFirestore();toast('Perfil eliminado','success');
  }catch(e){toast('Error: '+e.message,'error');}
}
function editarPerfilActual(){
  if(!state.perfilActivo)return;
  const p=state.perfilActivo;state.editandoId=p.id;
  document.getElementById('modal-title').textContent='Editar perfil';
  document.getElementById('fp-nombre').value=p.nombre||'';
  document.getElementById('fp-origen').value=p.origen||'';
  document.getElementById('fp-notas').value=p.notas||'';
  document.getElementById('fp-art-regex').value=p.artRegexCustom||'';
  document.getElementById('fp-ambito').value=p.ambito||'';
  document.getElementById('fp-patron-art').value=p.patronArticulo||'standard';
  document.getElementById('fp-tipo-frac').value=p.tipoFraccion||'romanos';
  document.getElementById('fp-tipo-inc').value=p.tipoInciso||'minusculas';
  tagsTemp.ruido=[...(p.ruido||[])];tagsTemp.trans=[...(p.transitorios||[])];
  catsTemp=[...(p.categorias||[])];
  renderTags('ruido');renderTags('trans');renderCatList();toggleArtCustom();
  document.getElementById('modal-perfil').classList.remove('hidden');
}


// ══ SISTEMA DE REGLAS ════════════════════════════════════════════

function abrirModalRegla(){
  if(!state.perfilActivo){toast('Selecciona un perfil primero','error');cerrarEstToolbar();return;}
  const sel=window.getSelection();
  const textoSel=sel?sel.toString().trim():'';
  if(!textoSel){toast('Selecciona texto primero','error');return;}

  seleccionEnEstructura={texto:textoSel};

  // Previsualización
  document.getElementById('regla-preview-texto').textContent=
    textoSel.slice(0,120)+(textoSel.length>120?'...':'');
  document.getElementById('regla-nombre').value='';
  document.getElementById('regla-tipo').value='encabezado_publicacion';
  document.getElementById('regla-color').value='#f97316';

  // Cargar categorías personalizadas del perfil
  const cats=state.perfilActivo?.categorias||[];
  const catSel=document.getElementById('regla-cat-custom');
  catSel.innerHTML=cats.length
    ?cats.map(c=>`<option value="${escAttr(c.nombre)}">${escHtml(c.nombre)}</option>`).join('')
    :'<option value="">Sin categorías en este perfil</option>';

  // Radio buttons
  document.querySelectorAll('.metodo-opt').forEach(o=>o.classList.remove('selected'));
  document.getElementById('mopt-inicio').classList.add('selected');
  document.querySelector('#mopt-inicio input').checked=true;
  document.querySelectorAll('.metodo-opt').forEach(o=>{
    o.addEventListener('click',()=>{
      document.querySelectorAll('.metodo-opt').forEach(x=>x.classList.remove('selected'));
      o.classList.add('selected');
    });
  });

  // Mostrar/ocultar categoría personalizada
  document.getElementById('regla-tipo').onchange=()=>{
    document.getElementById('regla-cat-custom-group').style.display=
      document.getElementById('regla-tipo').value==='personalizado'?'':'none';
  };

  // Colores sugeridos para regla
  const sw=document.getElementById('regla-color-swatches');
  sw.innerHTML=COLORES.map(c=>
    `<div class="color-swatch" style="background:${c};"
      onclick="document.getElementById('regla-color').value='${c}';this.parentNode.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));this.classList.add('selected');"
      title="${c}"></div>`).join('');

  cerrarEstToolbar();
  document.getElementById('modal-regla').classList.remove('hidden');
}

function cerrarModalRegla(){document.getElementById('modal-regla').classList.add('hidden');}

async function guardarRegla(){
  if(!state.perfilActivo){toast('Sin perfil activo','error');return;}
  const nombre=document.getElementById('regla-nombre').value.trim();
  if(!nombre){toast('Escribe el nombre de la regla','error');return;}
  const tipo=document.getElementById('regla-tipo').value;
  const metodo=document.querySelector('input[name="metodo"]:checked')?.value||'inicio';
  const patron=seleccionEnEstructura?.texto?.slice(0,80)||'';
  const color=document.getElementById('regla-color').value;
  const catCustom=tipo==='personalizado'?document.getElementById('regla-cat-custom').value:'';

  const nuevaRegla={
    nombre,tipo,metodo,patron,color,
    categoriaPersonalizada:catCustom,
    aprendidaEn:document.getElementById('raw-input').value.slice(0,40)||'documento',
    fecha:new Date().toISOString()
  };

  // Agregar al perfil activo en Firestore
  const reglasActuales=[...(state.perfilActivo.reglas||[])];
  reglasActuales.push(nuevaRegla);

  try{
    await window._updateDoc(
      window._doc(window._db,'lumenprep_perfiles',state.perfilActivo.id),
      {reglas:reglasActuales}
    );
    state.perfilActivo.reglas=reglasActuales;
    logOk('Regla guardada en perfil',`"${nombre}" — método: ${metodo}`,'📌');
    renderLog();
    cerrarModalRegla();
    toast(`Regla "${nombre}" guardada en perfil`,'success');
  }catch(e){toast('Error al guardar: '+e.message,'error');}
}

/** Aplica las reglas del perfil al texto antes de parsear */
function aplicarReglasPerfil(texto,perfil){
  if(!perfil?.reglas?.length)return texto;
  const lineas=texto.split('\n');
  const resultado=[];
  for(const linea of lineas){
    let clasificada=false;
    for(const regla of perfil.reglas){
      if(regla.tipo==='pie_pagina'){
        // Eliminar
        if(regla.metodo==='inicio'&&linea.trim().startsWith(regla.patron.trim())){clasificada=true;break;}
        if(regla.metodo==='contiene'&&linea.includes(regla.patron)){clasificada=true;break;}
      }
    }
    if(!clasificada)resultado.push(linea);
  }
  return resultado.join('\n');
}


// ══ LEYENDA ══════════════════════════════════════════════════════
function renderLeyenda(){
  const cats=categoriasTotales();
  const reglas=state.perfilActivo?.reglas||[];
  let html=cats.map(c=>`<div class="legend-item"><div class="legend-dot" style="background:${c.color}"></div>${escHtml(c.nombre)}</div>`).join('');
  if(reglas.length){
    html+=`<div style="width:100%;font-size:10px;color:var(--text-faint);margin-top:6px;text-transform:uppercase;letter-spacing:.8px;">Reglas del perfil</div>`;
    html+=reglas.map(r=>`<div class="legend-item"><div class="legend-dot" style="background:${r.color}"></div>${escHtml(r.nombre)}</div>`).join('');
  }
  document.getElementById('legend-container').innerHTML=html;
}
function categoriasTotales(){
  return[...CATS_FIJAS,...(state.perfilActivo?.categorias||[]).map(c=>({nombre:c.nombre,color:c.color,fija:false}))];
}


// ══ MODAL PERFIL ═════════════════════════════════════════════════
function abrirModalPerfil(){
  state.editandoId=null;
  document.getElementById('modal-title').textContent='Nuevo perfil de documento';
  ['fp-nombre','fp-origen','fp-notas','fp-art-regex'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fp-ambito').value='';
  document.getElementById('fp-patron-art').value='standard';
  document.getElementById('fp-tipo-frac').value='romanos';
  document.getElementById('fp-tipo-inc').value='minusculas';
  tagsTemp={ruido:[],trans:['TRANSITORIOS','Transitorios']};catsTemp=[];
  renderTags('ruido');renderTags('trans');renderCatList();toggleArtCustom();
  document.getElementById('modal-perfil').classList.remove('hidden');
}
function cerrarModal(){document.getElementById('modal-perfil').classList.add('hidden');}
function toggleArtCustom(){
  document.getElementById('grupo-art-custom').style.display=
    document.getElementById('fp-patron-art').value==='custom'?'':'none';
}
function agregarTag(tipo){
  const id=tipo==='ruido'?'input-ruido':'input-trans';
  const val=document.getElementById(id).value.trim();
  if(!val||tagsTemp[tipo].includes(val))return;
  tagsTemp[tipo].push(val);renderTags(tipo);document.getElementById(id).value='';
}
function quitarTag(tipo,idx){tagsTemp[tipo].splice(idx,1);renderTags(tipo);}
function renderTags(tipo){
  const el=document.getElementById(tipo==='ruido'?'tags-ruido':'tags-trans');
  el.innerHTML=tagsTemp[tipo].map((t,i)=>
    `<span class="tag">${escHtml(t)}<span class="tag-remove" onclick="quitarTag('${tipo}',${i})">×</span></span>`).join('');
}
function renderColoresSugeridos(){
  document.getElementById('color-swatches').innerHTML=COLORES.map(c=>
    `<div class="color-swatch" style="background:${c};"
      onclick="document.getElementById('cat-color-input').value='${c}';this.parentNode.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));this.classList.add('selected');"
      title="${c}"></div>`).join('');
}
function agregarCategoria(){
  const nombre=document.getElementById('cat-nombre-input').value.trim();
  const color=document.getElementById('cat-color-input').value;
  if(!nombre){toast('Escribe el nombre','error');return;}
  if(catsTemp.some(c=>c.nombre.toLowerCase()===nombre.toLowerCase())){toast('Ya existe','error');return;}
  catsTemp.push({nombre,color});renderCatList();document.getElementById('cat-nombre-input').value='';
}
function quitarCategoria(idx){catsTemp.splice(idx,1);renderCatList();}
function renderCatList(){
  const el=document.getElementById('cat-list');
  if(!catsTemp.length){el.innerHTML=`<div style="font-size:12px;color:var(--text-faint);padding:4px 0;">Sin categorías aún.</div>`;return;}
  el.innerHTML=catsTemp.map((c,i)=>`
    <div class="cat-row">
      <div class="cat-color-preview" style="background:${c.color};"></div>
      <span class="cat-nombre">${escHtml(c.nombre)}</span>
      <span class="cat-remove" onclick="quitarCategoria(${i})">×</span>
    </div>`).join('');
}
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    if(document.activeElement.id==='input-ruido')      agregarTag('ruido');
    if(document.activeElement.id==='input-trans')      agregarTag('trans');
    if(document.activeElement.id==='cat-nombre-input') agregarCategoria();
    if(document.activeElement.id==='regla-nombre')     guardarRegla();
  }
  if(e.key==='Escape'){cerrarEstToolbar();cerrarToolbar();}
});


// ══ TOOLBAR ESTRUCTURA ═══════════════════════════════════════════
document.addEventListener('mouseup',e=>{
  if(e.target.closest('#est-sel-toolbar')||e.target.closest('#highlight-toolbar')||
     e.target.closest('.modal'))return;

  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.toString().trim()){
    // Solo cerrar si no hay input activo
    if(!e.target.closest('.art-content-edit')&&!e.target.closest('.intro-sub-content-edit'))
      cerrarEstToolbar();
    cerrarToolbar();
    return;
  }

  const estPane=document.getElementById('pane-estructura');
  const vistaPane=document.getElementById('pane-vista');

  if(estPane&&estPane.contains(sel.anchorNode)){
    mostrarEstToolbar(e.clientX,e.clientY);
  } else if(vistaPane&&vistaPane.contains(sel.anchorNode)){
    selectionRange=sel.getRangeAt(0).cloneRange();
    mostrarToolbar(e.clientX,e.clientY);
  }
});

function mostrarEstToolbar(x,y){
  const toolbar=document.getElementById('est-sel-toolbar');
  toolbar.classList.add('visible');
  const tw=toolbar.offsetWidth||400,th=toolbar.offsetHeight||50;
  let tx=x+10,ty=y+10;
  if(tx+tw>window.innerWidth-10)tx=window.innerWidth-tw-10;
  if(ty+th>window.innerHeight-10)ty=y-th-10;
  toolbar.style.left=tx+'px';toolbar.style.top=ty+'px';
}
function cerrarEstToolbar(){document.getElementById('est-sel-toolbar').classList.remove('visible');}

function cortarSeleccion(){
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed){toast('Selecciona texto para cortar','error');return;}
  const textoSel=sel.toString().trim();
  if(!textoSel)return;

  // Buscar en qué artículo está la selección
  const anchorEl=sel.anchorNode?.parentElement?.closest('[data-art-idx]');
  if(!anchorEl){toast('Selecciona texto dentro de un artículo','error');cerrarEstToolbar();return;}
  const artIdx=parseInt(anchorEl.dataset.artIdx);
  const item=state.estructura[artIdx];
  if(!item||item.tipo!=='articulo'){cerrarEstToolbar();return;}

  // Cortar el texto del artículo
  const contenidoActual=item.contenido||'';
  const posInicio=contenidoActual.indexOf(textoSel);
  if(posInicio===-1){
    // Si no está en contenido, mandarlo al banco
    state.banco.push({id:'banco_'+Date.now(),texto:textoSel,origen:`${item.articulo}`});
    toast('Fragmento enviado al banco','success');
  } else {
    // Crear nuevo elemento con el texto cortado
    const nuevoPrevio=contenidoActual.slice(0,posInicio).trim();
    const nuevoSiguiente=contenidoActual.slice(posInicio+textoSel.length).trim();
    item.contenido=nuevoPrevio;
    // Insertar fragmento en banco
    state.banco.push({id:'banco_'+Date.now(),texto:textoSel,origen:`${item.articulo}`});
    if(nuevoSiguiente){
      // Crear nuevo artículo con el texto restante
      const nuevoItem={tipo:'articulo',articulo:'[Nuevo elemento]',contenido:nuevoSiguiente};
      state.estructura.splice(artIdx+1,0,nuevoItem);
    }
    logInfo('Texto cortado',`De "${item.articulo}" → banco de fragmentos`,`${textoSel.length} chars`);
    renderEstructura();renderJSON();
    toast('Texto cortado y enviado al banco','success');
  }
  cerrarEstToolbar();
  window.getSelection()?.removeAllRanges();
}


// ══ TOOLBAR VISTA ════════════════════════════════════════════════
let selectionRange=null;
function mostrarToolbar(x,y){
  const toolbar=document.getElementById('highlight-toolbar');
  const btnsEl=document.getElementById('toolbar-btns');
  const cats=categoriasTotales().filter(c=>!c.fija);
  if(!cats.length){toast('Agrega categorías personalizadas al perfil','error');cerrarToolbar();return;}
  btnsEl.innerHTML=cats.map(c=>
    `<button class="hl-btn" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;border:1px solid ${c.color};background:${c.color}22;color:${c.color};font-size:11px;cursor:pointer;"
      onclick="aplicarResaltado('${escAttr(c.nombre)}','${escAttr(c.color)}')">${escHtml(c.nombre)}</button>`).join('');
  toolbar.classList.add('visible');
  const tw=toolbar.offsetWidth||300,th=toolbar.offsetHeight||60;
  let tx=x+10,ty=y+10;
  if(tx+tw>window.innerWidth-10)tx=window.innerWidth-tw-10;
  if(ty+th>window.innerHeight-10)ty=y-th-10;
  toolbar.style.left=tx+'px';toolbar.style.top=ty+'px';
}
function cerrarToolbar(){document.getElementById('highlight-toolbar').classList.remove('visible');selectionRange=null;}
function aplicarResaltado(nombre,color){
  if(!selectionRange)return;
  const txt=selectionRange.toString().trim();if(!txt)return;
  const id='hl_'+Date.now();
  state.resaltados.push({id,texto:txt,tipo:nombre,color});
  try{
    const span=document.createElement('span');
    span.className='hl-manual';span.dataset.hlId=id;
    span.style.cssText=`background:${color}33;border-bottom:2px solid ${color};color:inherit;`;
    span.title=nombre;span.onclick=()=>quitarResaltadoPorId(id);
    selectionRange.surroundContents(span);
  }catch(ex){
    const frag=selectionRange.extractContents();
    const span=document.createElement('span');
    span.className='hl-manual';span.dataset.hlId=id;
    span.style.cssText=`background:${color}33;border-bottom:2px solid ${color};color:inherit;`;
    span.title=nombre;span.onclick=()=>quitarResaltadoPorId(id);
    span.appendChild(frag);selectionRange.insertNode(span);
  }
  renderJSON();cerrarToolbar();window.getSelection()?.removeAllRanges();
  toast(`Marcado: ${nombre}`,'success');
}
function quitarResaltadoPorId(id){
  const span=document.querySelector(`[data-hl-id="${id}"]`);
  if(span){const p=span.parentNode;while(span.firstChild)p.insertBefore(span.firstChild,span);p.removeChild(span);}
  state.resaltados=state.resaltados.filter(r=>r.id!==id);renderJSON();
}


// ══ CARGA ════════════════════════════════════════════════════════
document.getElementById('file-input').addEventListener('change',async e=>{if(e.target.files[0])await cargarArchivo(e.target.files[0]);});
const dz=document.getElementById('drop-zone');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
dz.addEventListener('drop',async e=>{e.preventDefault();dz.classList.remove('dragover');if(e.dataTransfer.files[0])await cargarArchivo(e.dataTransfer.files[0]);});
async function cargarArchivo(file){
  if(!state.perfilActivo){
    toast('Selecciona un perfil antes de cargar un documento','error');
    // Resaltar visualmente el selector de perfil
    const sel=document.getElementById('perfil-select');
    if(sel){sel.style.borderColor='var(--err)';sel.style.boxShadow='0 0 0 2px #f8717133';setTimeout(()=>{sel.style.borderColor='';sel.style.boxShadow='';},2000);}
    return;
  }
  setLoading(true);mostrarEstado(`Cargando: ${file.name}...`);
  try{
    const ext=file.name.split('.').pop().toLowerCase();
    let txt='';
    if(ext==='pdf')      txt=await extraerTextoPDF(file);
    else if(ext==='docx')txt=await extraerTextoDocx(file);
    else                 txt=await file.text();
    // Guardar el texto crudo en state — textoOriginalCrudo es inmutable para el diff
    state.textoOriginal=txt;
    state.textoOriginalCrudo=txt;
    logInfo('Archivo cargado',file.name,`${txt.length.toLocaleString()} chars`);
    mostrarEstado(`${file.name} — ${txt.length.toLocaleString()} chars`);
    toast(`Cargado: ${file.name}`,'success');
    // Lanzar preview de limpieza ANTES de poner el texto en el textarea
    state.resaltados=[];diffTokens=[];state.tokensRestaurados=new Set();
    state.log=[];state.aprobado=false;state.banco=[];state.introSubsecciones=[];
    state.temasGenerados=[];
    logInfo('Inicio',`Perfil: ${state.perfilActivo?.nombre||'Genérico'}`,new Date().toLocaleTimeString());
    mostrarPreviewEtapa1(txt, state.perfilActivo);
  }catch(e){toast('Error: '+e.message,'error');setLoading(false);}
}
async function extraerTextoPDF(file){
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  let txt='';
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const c=await page.getTextContent();
    const items=c.items;
    if(!items.length){txt+='\n';continue;}
    let linea='';
    let yAnterior=null;
    for(const item of items){
      const y=Math.round(item.transform[5]);
      if(yAnterior===null){
        yAnterior=y;
        linea+=item.str;
      } else if(Math.abs(y-yAnterior)>3){
        // Salto vertical — nueva línea
        txt+=linea.trim()+'\n';
        linea=item.str;
        yAnterior=y;
      } else {
        // Mismo renglón — separar con espacio si hay contenido
        if(item.str.trim()) linea+=(linea.trim()?(' '+item.str):item.str);
      }
    }
    if(linea.trim()) txt+=linea.trim()+'\n';
    txt+='\n'; // separar páginas
  }
  return txt;
}
async function extraerTextoDocx(file){return(await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}


// ══ LIMPIEZA ═════════════════════════════════════════════════════
function limpiarTextoConLog(texto,perfil){
  const orig=texto;
  if(perfil?.ruido?.length)
    for(const p of perfil.ruido)
      try{const antes=texto.length;texto=texto.replace(new RegExp(escapeRegex(p),'gi'),'');
        if(texto.length<antes)logOk('Ruido eliminado',`"${p.slice(0,50)}"`,`−${antes-texto.length}`);}catch(e){}

  // Aplicar reglas de tipo pie_pagina del perfil
  if(perfil?.reglas?.length){
    texto=aplicarReglasPerfil(texto,perfil);
    const reglasApp=perfil.reglas.filter(r=>r.tipo==='pie_pagina');
    if(reglasApp.length)logOk('Reglas de perfil aplicadas',`${reglasApp.length} regla(s) de ruido ejecutadas`,`×${reglasApp.length}`);
  }

  const anteSello=texto.length;
  texto=texto.replace(/[A-Za-z0-9+/]{40,}={0,2}/g,'');
  if(anteSello-texto.length>0)logOk('Sellos eliminados','Cadenas base64',`−${anteSello-texto.length}`);

  const numPags=(texto.match(/^\s*\d{1,4}\s*$/gm)||[]).length;
  texto=texto.replace(/^\s*\d{1,4}\s*$/gm,'');
  if(numPags>0)logOk('Números de página',`${numPags} líneas`,`×${numPags}`);

  const saltosFixed=(texto.match(/([^.\n])\n(?!\n)/g)||[]).length;
  texto=texto.replace(/([^.\n])\n(?!\n)/g,'$1 ');
  if(saltosFixed>0)logInfo('Saltos normalizados',`${saltosFixed} saltos`,`×${saltosFixed}`);

  texto=texto.replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n');

  const perdidos=contarPalabras(orig)-contarPalabras(texto);
  if(perdidos>10)logWarn('Diferencia de palabras significativa',`~${perdidos} palabras`,`Δ${perdidos}`);
  else logOk('Integridad conservada',`Diferencia mínima`,`Δ${perdidos}`);

  return texto.trim();
}
function contarPalabras(t){return(t.match(/\b[a-záéíóúüñA-ZÁÉÍÓÚÜÑA-Z]{2,}\b/g)||[]).length;}
function escapeRegex(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}


