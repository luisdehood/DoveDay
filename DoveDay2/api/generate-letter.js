// DoveDay2/api/generate-letter.js
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // --- Lee el body de forma segura ---
    const raw = await new Promise((resolve, reject) => {
      try {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => resolve(data || '{}'));
        req.on('error', reject);
      } catch (e) { reject(e); }
    });

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error('Body JSON parse error:', e, 'RAW:', raw);
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { name, achievement, support, dreams, advice } = payload;

    // --- Valida API key ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Missing OPENAI_API_KEY');
      return res.status(500).json({ error: 'Server not configured (missing OPENAI_API_KEY)' });
    }

    // --- Prompt & llamada a OpenAI (modelo vigente y barato) ---
    const messages = [
      {
        role: 'system',
        content: `
Eres una redactora empática y creativa para una experiencia de marca Dove.
Devuelve SIEMPRE un JSON VÁLIDO con EXACTAMENTE estas claves:
- name (string)
- paragraph1 (string)
- paragraph2 (string)
- adjective (string, UNA sola palabra en minúsculas, positiva y empoderadora)
- La palabra para "adjective" SIEMPRE debe ser exactamente: "valiente".
- closingLine (string)

REGLAS DE ESTILO:
- Tono cálido, respetuoso, motivador e inclusivo.
- Personaliza con los datos recibidos (logros, apoyos, sueños, consejo).
- Reencuadra lo negativo de manera constructiva; evita juicios, estigmas y clichés.
- Público: mujeres mexicanas (adolescentes y jóvenes).
- Evita revelar datos sensibles o identificables; no uses insultos ni lenguaje dañino.
- Mantén 2 párrafos principales (no demasiado largos) y un cierre breve.

SI NO HAY INFORMACIÓN SUFICIENTE:
- Inventa detalles realistas y positivos, pero NO rompas el formato JSON.
- Asegúrate de que el JSON sea válido (sin comas colgantes ni texto extra).
        `.trim()
      },
      {
        role: 'user',
        content: JSON.stringify({
          name,                       // nombre de la participante
          achievement,                // logro personal que le enorgullece
          support,                    // persona/red/idea que le apoya
          dreams,                     // sueños o metas
          advice,                     // consejo que se daría a sí misma
          constraints: {
            audience: 'mujeres mexicanas (adolescentes y jóvenes)',
            brand_tone: 'positivo, respetuoso, motivador',
            adjective_examples: [
             'Valiente', 'Auténtica', 'Creativa', 'Empática', 'Visionaria', 'Generosa', 
  'Inspiradora', 'Audaz', 'Determinada', 'Optimista', 'Ingeniosa', 'Leal', 
  'Confiable', 'Solidaria', 'Positiva', 'Honesta', 'Brillante', 'Inquebrantable', 
  'Sincera', 'Tenaz', 'Innovadora', 'Incondicional', 'Responsable', 'Protectora', 
  'Carismática', 'Soñadora', 'Admirable', 'Líder', 'Inteligente', 'Amable'
            ]
          }
        })
      },
      {
        role: 'assistant',
        content: `Ejemplos de salida estricta (JSON únicamente, sin texto adicional):
{"name":"María","paragraph1":"Desde pequeña has demostrado una fuerza interior...","paragraph2":"Con el tiempo, aprendiste a escuchar y a sostener a otros...","adjective":"auténtica","closingLine":"Porque ser tú misma es, y siempre será, tu mayor poder."}
{"name":"Ana","paragraph1":"Tu curiosidad te ha llevado a explorar, aprender y compartir...","paragraph2":"La paciencia y el apoyo de tu familia te han impulsado...","adjective":"inspiradora","closingLine":"Porque tu luz ilumina el camino de quienes te rodean."}`
      }
    ];

    const request = {
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('OpenAI error', r.status, txt);
      return res.status(502).json({ error: 'OpenAI error', status: r.status, detail: txt.slice(0, 800) });
    }

    const dataAI = await r.json();
    const content = dataAI?.choices?.[0]?.message?.content?.trim();

    // Intenta parsear el JSON; si falla, recorta al primer {...}..último
    let out;
    try {
      out = JSON.parse(content);
    } catch (e) {
      try {
        const first = content.indexOf('{');
        const last = content.lastIndexOf('}');
        if (first >= 0 && last > first) {
          out = JSON.parse(content.slice(first, last + 1));
        }
      } catch (e2) {
        console.error('Model did not return valid JSON. Raw content:', content);
      }
    }

    // Fallback si no hay JSON válido
    if (!out || typeof out !== 'object') {
      out = {
        name: name || 'Amiga',
        paragraph1: `Gracias por compartir. ${achievement || 'Ese logro'} habla de tu fuerza y determinación.`,
        paragraph2: `Cuando piensas en ${support || 'tu red de apoyo'} y en ${dreams || 'tus sueños'}, el camino se aclara paso a paso.`,
        adjective: 'auténtica',
        closingLine: 'Porque ser tú misma es, y siempre será, tu mayor poder.'
      };
    }

    // Sanitiza campos
    const oneWordLower = (s) => String(s || '').split(/\s+/)[0].toLowerCase();
    out.adjective = 'valiente';
    out.name = String(out.name || name || 'Amiga');

    return res.status(200).json(out);
  } catch (e) {
    console.error('Unhandled error in generate-letter:', e);
    return res.status(500).json({ error: 'Unhandled server error', detail: String(e).slice(0, 800) });
  }
}
