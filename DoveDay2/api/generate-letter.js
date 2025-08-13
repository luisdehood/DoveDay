export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, achievement, support, dreams, advice } = await req.body
      ? Promise.resolve(req.body)
      : new Promise((resolve) => {
          let data = '';
          req.on('data', (chunk) => (data += chunk));
          req.on('end', () => resolve(JSON.parse(data || '{}')));
        });

    // Prompt: pedimos JSON directo para no andar parseando textos libres
    const payload = {
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content:
            'Eres una redactora empática. Devuelve SIEMPRE un JSON con las claves: name, paragraph1, paragraph2, adjective, closingLine. El adjetivo debe ser una sola palabra en minúsculas. Tono cálido, inspirador, inclusivo. Evita contenidos dañinos y reencuadra lo negativo de forma constructiva.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            name,
            achievement,
            support,
            dreams,
            advice,
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
            'Ejemplo de salida estricta:\n{"name":"María","paragraph1":"...","paragraph2":"...","adjective":"auténtica","closingLine":"Porque ser tú misma es..."}'
        }
      ]
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(500).json({ error: 'OpenAI error', detail: txt });
    }

    const dataAI = await r.json();
    const content = dataAI?.choices?.[0]?.message?.content?.trim();

    // Intentamos parsear JSON de la respuesta
    let out;
    try { out = JSON.parse(content); }
    catch {
      // Fallback sencillo si el modelo no devolvió JSON válido
      out = {
        name: name || 'Amiga',
        paragraph1: `Gracias por compartir. ${achievement || 'Ese logro'} habla de tu fuerza.`,
        paragraph2: `Cuando piensas en ${support || 'tu red de apoyo'} y en ${dreams || 'tus sueños'}, la dirección se vuelve clara.`,
        adjective: 'auténtica',
        closingLine: 'Porque ser tú misma es, y siempre será, tu mayor poder.'
      };
    }

    // Sanitizar adjetivo: minúsculas y 1 palabra
    out.adjective = String(out.adjective || 'auténtica').split(/\s+/)[0].toLowerCase();
    out.name = name || out.name || 'Amiga';

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}