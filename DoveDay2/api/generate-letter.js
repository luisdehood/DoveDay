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

    // --- Llama a OpenAI (modelo vigente y barato) ---
    const request = {
      model: 'gpt-4o-mini', // evita model_not_found de gpt-3.5-turbo
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content:
            'Eres una redactora empática. Devuelve SIEMPRE un JSON con estas claves: name, paragraph1, paragraph2, adjective, closingLine. El adjetivo: UNA sola palabra en minúsculas. Tono cálido, inclusivo y motivador. Reencuadra lo negativo con cuidado.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            name, achievement, support, dreams, advice,
            constraints: {
              audience: 'mujeres mexicanas (adolescentes y jóvenes)',
              brand_tone: 'positivo, respetuoso, motivador',
              adjective_examples: ['valiente','auténtica','resiliente','creativa','soñadora','disciplinada','empática']
            }
          })
        },
        {
          role: 'assistant',
          content:
            'Ejemplo de salida exacta:\n{"name":"María","paragraph1":"...","paragraph2":"...","adjective":"auténtica","closingLine":"Porque ser tú misma es..."}'
        }
      ]
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('OpenAI error', r.status, txt);
      return res.status(502).json({ error: 'OpenAI error', status: r.status, detail: txt.slice(0, 500) });
    }

    const dataAI = await r.json();
    const content = dataAI?.choices?.[0]?.message?.content?.trim();

    let out;
    try {
      out = JSON.parse(content);
    } catch (e) {
      console.error('Model did not return valid JSON. Raw content:', content);
      // Fallback si el modelo no devolvió JSON válido
      out = {
        name: name || 'Amiga',
        paragraph1: `Gracias por compartir. ${achievement || 'Ese logro'} habla de tu fuerza.`,
        paragraph2: `Cuando piensas en ${support || 'tu red de apoyo'} y en ${dreams || 'tus sueños'}, el camino se aclara.`,
        adjective: 'auténtica',
        closingLine: 'Porque ser tú misma es, y siempre será, tu mayor poder.'
      };
    }

    // Sanitiza adjetivo
    out.adjective = String(out.adjective || 'auténtica').split(/\s+/)[0].toLowerCase();
    out.name = out.name || name || 'Amiga';

    return res.status(200).json(out);
  } catch (e) {
    console.error('Unhandled error in generate-letter:', e);
    return res.status(500).json({ error: 'Unhandled server error', detail: String(e).slice(0, 500) });
  }
}
