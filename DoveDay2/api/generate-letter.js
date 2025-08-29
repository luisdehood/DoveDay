// DoveDay2/api/generate-letter.js (backend con prompt + saneo nombre + fallback unificado)

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ---- Lee body de forma segura ----
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

    // ---- Utilidades para saneo de nombre (server-side) ----
    const stripDiacritics = (s) =>
      (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const toTitleCase = (s) =>
      (s || '').trim().replace(/\s+/g, ' ')
        .split(' ')
        .map(w => w ? (w[0].toUpperCase() + w.slice(1).toLowerCase()) : '')
        .join(' ');

    function sanitizeName(raw) {
      let s = (raw || '')
        .trim()
        .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]/g, '');

      const rawDetect = stripDiacritics(String(raw || '').toLowerCase());
      const detectLeet = rawDetect
        .replace(/[@ª]/g, 'a').replace(/4/g, 'a')
        .replace(/3/g, 'e')
        .replace(/[1!|]/g, 'i')
        .replace(/0/g, 'o')
        .replace(/[$5]/g, 's')
        .replace(/7/g, 't');

      const detectAlpha = detectLeet.replace(/[^a-zñ\s-]+/g, ' ');
      const detectCollapsed = detectAlpha
        .replace(/([a-zñ])\1{2,}/g, '$1$1')
        .replace(/\s+/g, ' ')
        .trim();

      const BAD = [
        'puta','puto','pendeja','pendejo','idiota','imbecil','imbécil',
        'estupida','estúpida','estupido','estúpido','zorra','perra',
        'cabrona','cabron','cabrón','culera','culero','naca','naco',
        'mierda','chingada','chingado','chingar','chingona','chingon','chingón',
        'verga','prostituta','marica','maricón','nazi','hitler','kkk',
        'bitch','whore','slut','fuck','shit','asshole','dick','cock','cunt',
        'nigger','nigga'
      ];
      const BAD_PATTERNS = [
        /p\s*[uv]t[a|o]/, /p\s*e\s*n\s*d\s*e\s*j[oa]/, /c\s*a\s*b\s*r\s*o\s*n/,
        /c\s*u\s*l\s*e\s*r[ao]/, /z\s*o\s*r\s*r\s*a/, /p\s*e\s*r\s*r\s*a/,
        /m\s*i\s*e\s*r\s*d\s*a/, /ch\s*i\s*n\s*g\s*a\s*d[ao]/, /v\s*e\s*r\s*g\s*a/,
        /(b|v)\s*i\s*t\s*c\s*h/, /f\s*u\s*c\s*k/, /s\s*h\s*i\s*t/,
        /a\s*s\s*s\s*h\s*o\s*l\s*e/, /n\s*i\s*g\s*g\s*(e|a)\s*r/
      ];

      const looksLikeUrl = /https?:\/\//.test(raw) || /www\./.test(raw);
      if (looksLikeUrl) return 'Amiga';
      if (detectCollapsed.length < 2 || detectCollapsed.length > 40) return 'Amiga';

      const tokens = detectCollapsed.split(/\s+/);
      const inList = tokens.some(t => BAD.includes(t));
      const inPatterns = BAD_PATTERNS.some(rx => rx.test(detectCollapsed));
      const inJoined = BAD.some(b => detectCollapsed.replace(/\s+/g, '').includes(b));
      if (inList || inPatterns || inJoined) return 'Amiga';

      if (!s) return 'Amiga';
      return toTitleCase(s);
    }

    // ---- Acepta nombres viejos y nuevos del form ----
    const nameRaw   = payload.name   ?? payload.nombre   ?? '';
    const fear      = payload.fear   ?? payload.miedo_superado ?? payload.achievement ?? '';
    const trait     = payload.trait  ?? payload.cualidad ?? payload.support     ?? '';
    const value     = payload.value  ?? payload.valor    ?? payload.dreams      ?? '';
    const proud     = payload.proud  ?? payload.logro    ?? payload.advice      ?? '';

    const safeName = sanitizeName(nameRaw);

    // ---- Valida API key ----
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Missing OPENAI_API_KEY');
      return res.status(500).json({ error: 'Server not configured (missing OPENAI_API_KEY)' });
    }

    // ---- Lista de adjetivos permitidos (minúsculas) ----
    const ALLOWED = [
      'valiente','auténtica','creativa','visionaria','generosa','inspiradora','audaz','determinada','optimista','ingeniosa','leal','confiable','solidaria','positiva','honesta','brillante','sincera','tenaz','innovadora','responsable','carismática','soñadora','admirable','líder','inteligente'
    ];

    // ---- Mensajes al modelo (JSON estricto) ----
    const messages = [
      {
        role: 'system',
        content:
`Eres una redactora empática para una experiencia dirigida a mujeres mexicanas.
Devuelve SIEMPRE un JSON válido con EXACTAMENTE estas claves:
- name (string)
- paragraph1 (string)   // introducción general, positiva y neutral
- complimentLine (string) // línea exacta: "El cumplido perfecto para ti es:\\n[adjetivo]"
- adjective (string)    // SOLO una palabra en minúsculas, de la lista permitida
- closingLine (string)  // frase final emotiva
REGLAS:
- Extensión total (paragraph1 + closingLine) máx. 150 palabras.
- Tono positivo, cálido y general; no inventes detalles ni profundices.
- Parafrasea sutilmente, NO copies literal las respuestas.
- Si hay contenido negativo/ofensivo, responde en tono neutro y respetuoso, sin juicios.
- Evita temas sensibles: sexo, religión, política, muerte, suicidio, abuso.
- No firmes ni menciones marcas.
- No inicies con "Querida" ni "Querido"; usa una apertura neutral.
- Evita sobreusar "valiente": si hay varias opciones válidas, prefiere otra.`
      },
      {
        role: 'user',
        content: JSON.stringify({
          prompt: 'Escribe una carta breve, emocional y empoderadora dirigida a una mujer, basada en sus respuestas personales. Tono positivo, cálido y general.',
          respuestas: {
            nombre: safeName,
            miedo_superado: fear,
            cualidad: trait,
            valor: value,
            logro: proud
          },
          reglas_importantes: [
            'No profundizar ni asumir historias específicas',
            'Parafrasear sutilmente, no repetir textual',
            'Tratar contenido negativo con neutralidad respetuosa',
            'Evitar temas sensibles'
          ],
          sobre_el_cumplido: {
            lista_permitida: ALLOWED,
            formato: 'El cumplido perfecto para ti es:\n[adjetivo]'
          },
          formato_salida: [
            'Máx 150 palabras',
            'Tres partes: 1) Introducción general, 2) Línea del cumplido, 3) Frase final',
            'No repetir el nombre al final',
            'Sin firmas ni marcas',
            'Al final se coloca visualmente el logo dorado de Dove (instrucción visual, no textual)'
          ]
        })
      }
    ];

    const request = {
      model: 'gpt-4o-mini',
      temperature: 0.9,
      top_p: 0.95,
      messages
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
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

    // ---- Heurística para diversificar adjetivo (alineado a lista) ----
    function pickAdjective(inputs, modelAdj, allowed) {
      const text = [inputs.trait, inputs.value, inputs.fear, inputs.proud]
        .map(s => String(s || '').toLowerCase()).join(' ');

      // palabras clave → adjetivos (todos existen en ALLOWED)
      const rules = [
        { keys: ['miedo','temor','atrev','arriesg','valent'], adj: 'valiente' },
        { keys: ['creativ','arte','dibu','pint','idea','imagin'], adj: 'creativa' },
        // empática -> NO está en ALLOWED, redirigimos a solidaria o generosa
        { keys: ['empati','escuchar','comprens','ayudar','cuidar','apoyo','apoyar','acompañ'], adj: 'solidaria' },
        { keys: ['lider','guia','guía','organ','coord','inspira'], adj: 'líder' },
        { keys: ['honest','verdad','franca','sincera'], adj: 'honesta' },
        { keys: ['sueñ','meta','futuro','vision','imagina'], adj: 'soñadora' },
        { keys: ['respons','cumplo','compromiso','constante','disciplina'], adj: 'responsable' },
        { keys: ['ideas','ingenio','resolver','solucion','ingeni'], adj: 'ingeniosa' },
        { keys: ['autentic','ser yo','genuina','propia'], adj: 'auténtica' },
        { keys: ['donar','compart','generos'], adj: 'generosa' },
        { keys: ['optim','positiv','ánimo','esperanza'], adj: 'optimista' },
        { keys: ['brilla','destaca','talento','brillar'], adj: 'brillante' },
        { keys: ['tenaz','constante','persever','logro','esfuerzo'], adj: 'tenaz' },
        { keys: ['carisma','encanto','conecta','amigas','amistad'], adj: 'carismática' },
        { keys: ['sincera','honesta','transpar'], adj: 'sincera' },
        { keys: ['confianza','segura','firme'], adj: 'confiable' },
        { keys: ['solidar','comunidad','juntas'], adj: 'solidaria' },
        { keys: ['vision','futuro','ideas grandes'], adj: 'visionaria' }
      ];

      const normModel = String(modelAdj || '').toLowerCase();
      if (allowed.includes(normModel)) {
        const courage = /(miedo|temor|atrev|arriesg|valent)/.test(text);
        if (normModel === 'valiente' && !courage) {
          // sustituimos si no hay señales de coraje
        } else {
          return normModel;
        }
      }

      for (const rule of rules) {
        if (rule.keys.some(k => text.includes(k)) && allowed.includes(rule.adj)) {
          return rule.adj;
        }
      }

      const pool = allowed.filter(a => a !== 'valiente');
      return pool[Math.floor(Math.random() * pool.length)] || allowed[0];
    }

    // ---- Fallback unificado (server) si el modelo no devuelve JSON válido ----
    const SERVER_FALLBACK = {
      name: safeName || 'Amiga',
      paragraph1:
        'Gracias por compartir un poco de ti. Tu forma de ver la vida transmite crecimiento, apertura y confianza en tu propio camino, y eso inspira a quienes te rodean.',
      adjective: 'auténtica',
      complimentLine: 'El cumplido perfecto para ti es:\nauténtica',
      closingLine:
        'Porque tu esencia, tal y como es, merece ser celebrada cada día.'
    };

    if (!out || typeof out !== 'object') {
      out = { ...SERVER_FALLBACK };
    }

    // ---- Ajustes finales y seguridad de reglas ----
    const toOneWordLower = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();
    let adj = toOneWordLower(out.adjective);
    adj = pickAdjective({ trait, value, fear, proud }, adj, ALLOWED);
    if (!ALLOWED.includes(adj)) adj = 'auténtica';

    const complimentLine = `El cumplido perfecto para ti es:\n${adj}`;

    const response = {
      name: String(safeName || 'Amiga'),
      paragraph1: String(out.paragraph1 || SERVER_FALLBACK.paragraph1),
      complimentLine,
      adjective: adj,
      closingLine: String(out.closingLine || SERVER_FALLBACK.closingLine)
    };

    return res.status(200).json(response);
  } catch (e) {
    console.error('Unhandled error in generate-letter:', e);
    return res.status(500).json({ error: 'Unhandled server error', detail: String(e).slice(0, 800) });
  }
}
