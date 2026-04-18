/**
 * validar-integridad.mjs
 * ─────────────────────────────────────────────────────────────────────
 * Compara el texto de un .docx original contra el JSON procesado por
 * Lumen Codex, para verificar que no se perdió texto normativo útil.
 *
 * USO:
 *   node validar-integridad.mjs <ruta-docx> <ruta-json>
 *
 * EJEMPLO:
 *   node validar-integridad.mjs Ley_de_Vivienda.docx lumen-codex-ley-federal.json
 *
 * REQUIERE (instalar una sola vez):
 *   npm install mammoth
 * ─────────────────────────────────────────────────────────────────────
 */

import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

// ── CONFIGURACIÓN ────────────────────────────────────────────────────

// Tipos del JSON que SÍ queremos verificar (texto normativo útil)
const TIPOS_VALIDOS = ['introduccion', 'seccion', 'articulo', 'transitorio', 'firma'];

// Tipos que ignoramos deliberadamente (no son parte de la ley vigente)
const TIPOS_IGNORADOS = ['decreto_historial'];

// Tamaño del fragmento de búsqueda (en palabras)
// 8 palabras es suficiente para ser específico sin ser frágil
const NGRAMA_PALABRAS = 8;

// Porcentaje mínimo de cobertura para considerar la ley íntegra
const UMBRAL_COBERTURA = 90;

// ── LIMPIEZA DE TEXTO ────────────────────────────────────────────────

/**
 * Normaliza texto para comparación:
 * - Elimina marcadores §NOTA§...§/NOTA§ del JSON
 * - Colapsa espacios y saltos de línea múltiples
 * - Convierte a minúsculas
 */
function limpiarTexto(texto) {
  return texto
    .replace(/§NOTA§.*?§\/NOTA§/gs, '')   // quitar notas de reforma
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')                  // colapsar espacios
    .trim()
    .toLowerCase();
}

/**
 * Lista de patrones que identifican encabezados/pie de DOF
 * que sí queremos descartar del .docx original antes de comparar.
 * Ajusta si tu .docx tiene encabezados distintos.
 */
const PATRONES_BASURA_DOF = [
  /diario oficial de la federaci[oó]n/gi,
  /lunes \d+ de .+ de \d{4}/gi,
  /martes \d+ de .+ de \d{4}/gi,
  /miércoles \d+ de .+ de \d{4}/gi,
  /jueves \d+ de .+ de \d{4}/gi,
  /viernes \d+ de .+ de \d{4}/gi,
  /^\s*\d+\s*$/gm,                        // líneas que solo tienen número de página
  /p[áa]g\. \d+/gi,
  /página \d+ de \d+/gi,
];

function eliminarBasuraDOF(texto) {
  let resultado = texto;
  for (const patron of PATRONES_BASURA_DOF) {
    resultado = resultado.replace(patron, ' ');
  }
  return resultado.replace(/\s+/g, ' ').trim();
}

// ── GENERADOR DE N-GRAMAS ────────────────────────────────────────────

/**
 * Divide texto en fragmentos de N palabras consecutivas.
 * Ejemplo con N=4: "la ley es clara" → ["la ley es clara"]
 * Con texto más largo genera múltiples fragmentos solapados.
 */
function generarNgramas(texto, n) {
  const palabras = texto.split(/\s+/).filter(p => p.length > 2); // ignora palabras muy cortas
  const ngramas = [];
  for (let i = 0; i <= palabras.length - n; i++) {
    ngramas.push(palabras.slice(i, i + n).join(' '));
  }
  return ngramas;
}

// ── EXTRACTOR DE TEXTO DEL JSON ──────────────────────────────────────

function extraerTextoJson(data) {
  const partes = [];
  for (const item of data.contenido) {
    if (TIPOS_IGNORADOS.includes(item.tipo)) continue;
    if (!TIPOS_VALIDOS.includes(item.tipo)) continue;
    if (item.contenido) {
      partes.push(item.contenido);
    }
  }
  return partes.join('\n\n');
}

// ── REPORTE ──────────────────────────────────────────────────────────

function imprimirReporte(resultados, totalFragmentos) {
  const { encontrados, noEncontrados } = resultados;
  const cobertura = ((encontrados / totalFragmentos) * 100).toFixed(1);
  const ok = parseFloat(cobertura) >= UMBRAL_COBERTURA;

  console.log('\n' + '═'.repeat(60));
  console.log('  REPORTE DE INTEGRIDAD — LUMEN CODEX');
  console.log('═'.repeat(60));
  console.log(`  Fragmentos analizados : ${totalFragmentos}`);
  console.log(`  Encontrados en JSON   : ${encontrados}`);
  console.log(`  No encontrados        : ${noEncontrados.length}`);
  console.log(`  Cobertura             : ${cobertura}%`);
  console.log(`  Umbral mínimo         : ${UMBRAL_COBERTURA}%`);
  console.log(`  Estado                : ${ok ? '✅ ÍNTEGRA' : '⚠️  REVISAR'}`);
  console.log('═'.repeat(60));

  if (noEncontrados.length > 0) {
    console.log('\n  FRAGMENTOS NO ENCONTRADOS EN EL JSON:');
    console.log('  (pueden ser encabezados de página no filtrados,');
    console.log('   o texto normativo perdido en el parseo)\n');

    // Agrupa fragmentos consecutivos para no repetir el mismo párrafo 20 veces
    const fragmentosUnicos = [...new Set(noEncontrados)];
    const limite = Math.min(fragmentosUnicos.length, 30); // muestra máx 30
    
    for (let i = 0; i < limite; i++) {
      console.log(`  [${i + 1}] "${fragmentosUnicos[i]}"`);
    }

    if (fragmentosUnicos.length > 30) {
      console.log(`\n  ... y ${fragmentosUnicos.length - 30} fragmentos más.`);
      console.log('  Exportando lista completa a: fragmentos-faltantes.txt');
      fs.writeFileSync('fragmentos-faltantes.txt', fragmentosUnicos.join('\n'));
    }
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

// ── MAIN ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('\nUSO: node validar-integridad.mjs <archivo.docx> <archivo.json>\n');
    process.exit(1);
  }

  const rutaDocx = path.resolve(args[0]);
  const rutaJson = path.resolve(args[1]);

  // Verificar que existen los archivos
  if (!fs.existsSync(rutaDocx)) {
    console.error(`❌ No se encontró el archivo .docx: ${rutaDocx}`);
    process.exit(1);
  }
  if (!fs.existsSync(rutaJson)) {
    console.error(`❌ No se encontró el archivo .json: ${rutaJson}`);
    process.exit(1);
  }

  console.log('\n  Lumen Codex — Validador de Integridad');
  console.log('  ──────────────────────────────────────');
  console.log(`  DOCX : ${path.basename(rutaDocx)}`);
  console.log(`  JSON : ${path.basename(rutaJson)}`);

  // 1. Extraer texto del .docx
  console.log('\n  [1/4] Extrayendo texto del .docx...');
  const resultado = await mammoth.extractRawText({ path: rutaDocx });
  if (resultado.messages.length > 0) {
    console.log('  ⚠️  Advertencias de mammoth:', resultado.messages.map(m => m.message).join(', '));
  }
  const textoDocxBruto = resultado.value;
  const textoDocxSinBasura = eliminarBasuraDOF(textoDocxBruto);
  const textoDocx = limpiarTexto(textoDocxSinBasura);
  console.log(`  → ${textoDocx.split(' ').length.toLocaleString()} palabras en el .docx (después de limpieza)`);

  // 2. Extraer texto del JSON
  console.log('\n  [2/4] Extrayendo texto del JSON...');
  const data = JSON.parse(fs.readFileSync(rutaJson, 'utf8'));
  const textoJson = limpiarTexto(extraerTextoJson(data));
  console.log(`  → ${textoJson.split(' ').length.toLocaleString()} palabras en el JSON`);
  
  // Resumen de lo que contiene el JSON
  const resumen = {};
  for (const item of data.contenido) {
    resumen[item.tipo] = (resumen[item.tipo] || 0) + 1;
  }
  console.log('  → Estructura del JSON:');
  for (const [tipo, count] of Object.entries(resumen)) {
    const ignorado = TIPOS_IGNORADOS.includes(tipo) ? ' (ignorado)' : '';
    console.log(`     ${tipo}: ${count}${ignorado}`);
  }

  // 3. Generar n-gramas del .docx y buscar en el JSON
  console.log(`\n  [3/4] Generando fragmentos de ${NGRAMA_PALABRAS} palabras y comparando...`);
  const ngramas = generarNgramas(textoDocx, NGRAMA_PALABRAS);
  console.log(`  → ${ngramas.length.toLocaleString()} fragmentos a verificar`);

  const noEncontrados = [];
  let encontrados = 0;

  // Muestreo: analizar 1 de cada 3 fragmentos para no tardar demasiado
  // (sigue siendo estadísticamente robusto con miles de fragmentos)
  const PASO = 3;
  const ngramasMuestra = ngramas.filter((_, i) => i % PASO === 0);
  console.log(`  → Analizando muestra de ${ngramasMuestra.length.toLocaleString()} fragmentos (1 de cada ${PASO})...`);

  for (const fragmento of ngramasMuestra) {
    if (textoJson.includes(fragmento)) {
      encontrados++;
    } else {
      noEncontrados.push(fragmento);
    }
  }

  // 4. Reporte final
  console.log('\n  [4/4] Generando reporte...');
  imprimirReporte({ encontrados, noEncontrados }, ngramasMuestra.length);
}

main().catch(err => {
  console.error('\n❌ Error inesperado:', err.message);
  process.exit(1);
});
