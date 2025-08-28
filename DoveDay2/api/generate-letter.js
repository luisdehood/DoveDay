// DoveDay2/api/generate-letter.js (versión ajustada al nuevo prompt)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // --- Lee body de forma segura ---
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

    // Acepta tanto los nombres viejos como los nuevos del formulario
    const name       = payload.name   ?? payload.nombre   ?? '';
    const fear       = payload.fear   ?? payload.miedo_superado ?? payload.achievement ?? '';
    const trait      = payload.trait  ?? payload.cualidad ?? payload.support     ?? '';
    const value      = payload.value  ?? payload.valor    ?? payload.dreams      ?? '';
    const proud      = payload.proud  ?? payload.logro    ?? payload.advice      ?? '';

    // --- Valida API key ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Missing OPENAI_API_KEY');
      return res.status(500).json({ error: 'Server not configured (missing OPENAI_API_KEY)' });
    }

    // Lista de adjetivos permitidos (minúsculas para validar)
    const ALLOWED = [
      'valiente','auténtica','creativa','visionaria','generosa','inspiradora','audaz','determinada','optimista','ingeniosa','leal','confiable','solidaria','positiva','honesta','brillante','sincera','tenaz','innovadora','responsable','carismática','soñadora','admirable','líder','inteligente'
    ];

    // --- Mensajes para el modelo (salida JSON estricta) ---
    const messages = [
      {
        role: 'system',
        content: `Eres una redactora empática para una experiencia dirigida a mujeres mexicanas. Devuelve SIEMPRE un JSON válido con EXACTAMENTE estas claves: \n- name (string)\n- paragraph1 (string)  // introducción general, positiva\n- complimentLine (string) // línea exacta: "El cumplido perfecto para ti es:\n[adjetivo]"\n- adjective (string) // el adjetivo SOLO de la lista permitida, en minúsculas y una sola palabra\n- closingLine (string) // frase final emotiva\n\nREGLAS:\n- Extensión total (paragraph1 + closingLine) máx. 150 palabras.\n- Tono positivo, cálido y general; no profundices ni inventes detalles.\n- Parafrasea de forma sutil, NO copies literalmente las respuestas.\n- Si hay contenido negativo/ofensivo, responde en tono neutro y respetuoso, sin juicios.\n- Evita temas sensibles: sexo, religión, política, muerte, suicidio, abuso u otros delicados.\n- No firmes ni menciones marcas.\n- El adjetivo debe salir en minúsculas y pertenecer a la lista dada.\n- Evita sobreusar “valiente”: solo úsalo cuando haya claras señales de coraje/atrevimiento/miedo superado; si hay varias opciones válidas, prefiere una distinta.`
      },
      {
        role: 'user',
        content: JSON.stringify({
          prompt: 'Escribe una carta breve, emocional y empoderadora dirigida a una mujer, basada en sus respuestas personales. El tono debe ser positivo, cálido y general, sin asumir detalles específicos ni interpretar en profundidad.',
          respuestas: {
            nombre: name,
            miedo_superado: fear,
            cualidad: trait,
            valor: value,
            logro: proud
          },
          reglas_importantes: [
            'No profundizar ni asumir historias específicas',
            'Parafrasear sutilmente, no repetir textual',
            'Tratar contenido negativo con neutralidad respetuosa',
            'Evitar temas sensibles (sexo, religión, política, muerte, suicidio, abuso, etc.)'
          ],
          sobre_el_cumplido: {
            lista_permitida: ALLOWED,
            formato: 'El cumplido perfecto para ti es:\n[adjetivo]'
          },
          formato_salida: [
            'Máx 150 palabras en total',
            'Tres partes: 1) Introducción general, 2) Línea del cumplido, 3) Frase final',
            'No repetir el nombre al final',
            'No firmas ni marcas',
            'Al final se coloca visualmente el logo dorado de Dove (instrucción visual, no textual)'
          ]
        })
      }
    ];

    const request = { model: 'gpt-4o-mini', temperature: 0.9, top_p: 0.95, messages };

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

    // Heurística server-side para diversificar el adjetivo y alinearlo a palabras clave
    function pickAdjective(inputs, modelAdj, allowed){
      const text = [inputs.trait, inputs.value, inputs.fear, inputs.proud]
        .map(s => String(s||'').toLowerCase()).join(' ');

      // Mapa simple de palabras clave → adjetivo sugerido
      const rules = [
        { keys: ['miedo','temor','atrev','valent','arriesg'], adj: 'valiente' },
        { keys: ['creativ','arte','dibu','pint','idea','imagin'], adj: 'creativa' },
        { keys: ['empati','escuchar','apoy','comprens','ayudar','cuidar','solidar'], adj: 'empática' },
        { keys: ['lider','guia','organ','coord','inspira'], adj: 'líder' },
        { keys: ['honest','verdad','franca','sincera'], adj: 'honesta' },
        { keys: ['sueñ','meta','futuro','vision','imagina'], adj: 'soñadora' },
        { keys: ['respons','cumplo','compromiso','constante','disciplina'], adj: 'responsable' },
        { keys: ['ideas','ingenio','resolver','solucion','creativ'], adj: 'ingeniosa' },
        { keys: ['aprend','curios','innov','nueva','cambio'], adj: 'innovadora' },
        { keys: ['autentic','ser yo','genuina','propia'], adj: 'auténtica' },
        { keys: ['apoyo','donar','compart','generos'], adj: 'generosa' },
        { keys: ['optim','positiv','ánimo','esperanza'], adj: 'optimista' },
        { keys: ['brilla','destaca','talento'], adj: 'brillante' },
        { keys: ['tenaz','constante','persever','logro','esfuerzo'], adj: 'tenaz' },
        { keys: ['carisma','encanto','conecta','amigas'], adj: 'carismática' },
        { keys: ['sincera','honesta','transpar'], adj: 'sincera' },
        { keys: ['confianza','segura','firme'], adj: 'confiable' },
        { keys: ['solidar','comunidad','juntas'], adj: 'solidaria' },
        { keys: ['vision','futuro','ideas grandes'], adj: 'visionaria' },
        { keys: ['lider','guía'], adj: 'líder' },
      ];

      // Si el modelo dio uno permitido y acorde a palabras, respétalo
      const normModel = String(modelAdj||'').toLowerCase();
      if (allowed.includes(normModel)) {
        // Si el modelo eligió 'valiente' pero el texto no sugiere coraje, la sustituimos
        const courage = /(miedo|temor|atrev|arriesg|valent)/.test(text);
        if (normModel === 'valiente' && !courage) {
          // caemos a selección por reglas o aleatoria
        } else {
          return normModel;
        }
      }

      // Busca por reglas
      for (const r of rules){
        if (r.keys.some(k => text.includes(k)) && allowed.includes(r.adj)) {
          return r.adj;
        }
      }

      // Aleatorio con pequeño sesgo para evitar 'valiente'
      const pool = allowed.filter(a => a !== 'valiente');
      return pool[Math.floor(Math.random() * pool.length)] || allowed[0];
    }

    // Fallback mínimo si el modelo no devuelve JSON válido
    if (!out || typeof out !== 'object') {
      const adjective = 'auténtica';
      out = {
        name: name || 'Amiga',
        paragraph1: 'Gracias por compartir un poco de ti. Tu forma de ver la vida transmite crecimiento, apertura y confianza en tu propio camino, y eso inspira a quienes te rodean.',
        complimentLine: `El cumplido perfecto para ti es:\n${adjective}`,
        adjective,
        closingLine: 'Porque tu esencia, tal y como es, merece ser celebrada cada día.'
      };
    }

    // Sanitiza y asegura reglas en server-side
    const toOneWordLower = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();
    let adj = toOneWordLower(out.adjective);
    // Aplicar heurística para diversificar y alinear
    adj = pickAdjective({ trait, value, fear, proud }, adj, ALLOWED);
    if (!ALLOWED.includes(adj)) adj = 'auténtica';

    // Reconstruye complimentLine por seguridad
    const complimentLine = `El cumplido perfecto para ti es:\n${adj}`;

    const response = {
      name: String(out.name || name || 'Amiga'),
      paragraph1: String(out.paragraph1 || ''),
      complimentLine,
      adjective: adj,
      closingLine: String(out.closingLine || '')
    };

    return res.status(200).json(response);
  } catch (e) {
    console.error('Unhandled error in generate-letter:', e);
    return res.status(500).json({ error: 'Unhandled server error', detail: String(e).slice(0, 800) });
  }
}
