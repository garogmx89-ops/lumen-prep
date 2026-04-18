import admin from 'firebase-admin';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';

// Configuración
const WORKER_URL = 'https://lumen-briefing.garogmx89.workers.dev';
const UID = 'a3Tc5bZJiPTvRSyGPyJVoVmucBG3';
const NORMA_ID = 'fa8TwfsKw4oE6U2sW1dW';
const LOTE = 20;
const PAUSA_ENTRE_ARTICULOS = 1200; // ms entre cada artículo
const PAUSA_ENTRE_LOTES = 3000;     // ms entre lotes

// Inicializar Firebase Admin
const serviceAccount = JSON.parse(readFileSync('./serviceAccount.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Helper: esperar N milisegundos
const esperar = ms => new Promise(r => setTimeout(r, ms));

// Helper: construir texto completo del artículo
function construirTexto(art) {
  let texto = '';
  if (art.introduccion) texto = art.introduccion + '\n';
  else if (art.texto) texto = art.texto;
  if (art.fracciones && art.fracciones.length > 0) {
    for (const fr of art.fracciones) {
      texto += `\n${fr.num || ''} ${fr.txt || ''}`;
    }
  }
  return texto.trim();
}

async function indexar() {
  console.log('📚 Leyendo artículos desde Firestore...');

  const snap = await db
    .collection(`usuarios/${UID}/normatividad/${NORMA_ID}/articulos`)
    .orderBy('indice')
    .get();

  const articulos = [];
  snap.forEach(doc => {
    const art = doc.data();
    const texto = construirTexto(art);
    if (texto.length > 10) {
      articulos.push({
        id: `${NORMA_ID}_${doc.id}`,
        texto,
        metadata: {
          normaId: NORMA_ID,
          articuloId: doc.id,
          norma: 'LEY DE VIVIENDA',
          articulo: art.articulo_original || `Artículo ${art.numero}`,
          numero: art.numero || '',
          tipo: art.tipo || 'articulo',
          ambito: 'Federal',
          texto: texto.substring(0, 500)
        }
      });
    }
  });

  console.log(`✅ ${articulos.length} artículos encontrados`);
  console.log(`🚀 Iniciando indexación — 1 artículo cada ${PAUSA_ENTRE_ARTICULOS}ms...\n`);

  let exitosos = 0;
  let fallidos = 0;

  for (let i = 0; i < articulos.length; i += LOTE) {
    const lote = articulos.slice(i, i + LOTE);
    console.log(`📦 Lote ${Math.floor(i / LOTE) + 1} — artículos ${i + 1} a ${Math.min(i + LOTE, articulos.length)}`);

    for (const art of lote) {
      await esperar(PAUSA_ENTRE_ARTICULOS);
      try {
        const res = await fetch(`${WORKER_URL}/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: art.texto,
            id: art.id,
            metadata: art.metadata
          })
        });
        const data = await res.json();
        if (data.ok) {
          console.log(`  ✅ ${art.metadata.articulo}`);
          exitosos++;
        } else {
          console.log(`  ❌ ${art.metadata.articulo} — ${JSON.stringify(data)}`);
          fallidos++;
        }
      } catch (err) {
        console.log(`  ❌ ${art.metadata.articulo} — ${err.message}`);
        fallidos++;
      }
    }

    if (i + LOTE < articulos.length) {
      console.log(`  ⏳ Pausa entre lotes...\n`);
      await esperar(PAUSA_ENTRE_LOTES);
    }
  }

  console.log(`\n🎉 Indexación completa — ${exitosos} exitosos, ${fallidos} fallidos`);
  process.exit(0);
}

indexar().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});