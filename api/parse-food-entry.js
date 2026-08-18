'use strict';

const OPENROUTER_URL =
  'https://openrouter.ai/api/v1/chat/completions';

const UNIT_KINDS = [
  'mass',
  'natural_unit',
  'dish',
  'plate',
  'bowl',
  'serving',
  'slice_variable',
  'piece_variable',
  'volume',
  'unknown'
];

const SIZES = [
  'small',
  'medium',
  'large',
  'unspecified'
];

const CONFIDENCES = [
  'none',
  'low',
  'medium',
  'high'
];

function getBody(req) {
  if (!req.body) return {};

  if (typeof req.body === 'object') {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function clean(value, max = 500) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

function pos(value) {
  const n = Number(value);

  return Number.isFinite(n) && n > 0
    ? n
    : null;
}

function getAssistantText(data) {
  const message =
    data?.choices?.[0]?.message;

  const content =
    message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }

        return (
          item?.text ||
          item?.content ||
          ''
        );
      })
      .join('');
  }

  if (
    content &&
    typeof content === 'object'
  ) {
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }

  return '';
}

function tryParseJson(text) {
  if (!text) return null;

  const raw =
    String(text).trim();

  if (!raw) return null;

  /*
   * 1. JSON esatto.
   */
  try {
    const parsed =
      JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === 'object'
    ) {
      return parsed;
    }
  } catch {}

  /*
   * 2. Markdown:
   *
   * ```json
   * {...}
   * ```
   */
  const unfenced = raw
    .replace(
      /^```(?:json)?\s*/i,
      ''
    )
    .replace(
      /\s*```$/i,
      ''
    )
    .trim();

  if (unfenced !== raw) {
    try {
      const parsed =
        JSON.parse(unfenced);

      if (
        parsed &&
        typeof parsed === 'object'
      ) {
        return parsed;
      }
    } catch {}
  }

  /*
   * 3. Testo + JSON.
   *
   * "Ecco il risultato:
   *  {...}"
   */
  const first =
    unfenced.indexOf('{');

  const last =
    unfenced.lastIndexOf('}');

  if (
    first >= 0 &&
    last > first
  ) {
    const extracted =
      unfenced.slice(
        first,
        last + 1
      );

    try {
      const parsed =
        JSON.parse(extracted);

      if (
        parsed &&
        typeof parsed === 'object'
      ) {
        return parsed;
      }
    } catch {}
  }

  return null;
}

function parseOpenRouterResponse(data) {
  /*
   * Alcune integrazioni/provider
   * potrebbero restituire già
   * l'oggetto parsato.
   */
  const directCandidates = [
    data?.choices?.[0]?.message
      ?.parsed,

    data?.parsed
  ];

  for (
    const candidate
    of directCandidates
  ) {
    if (
      candidate &&
      typeof candidate === 'object'
    ) {
      return candidate;
    }
  }

  return tryParseJson(
    getAssistantText(data)
  );
}

function normalizeIngredient(raw) {
  const x =
    raw &&
    typeof raw === 'object'
      ? raw
      : {};

  return {
    raw:
      clean(x.raw, 300),

    name:
      clean(x.name, 180),

    grams:
      pos(x.grams),

    quantity_text:
      clean(
        x.quantity_text,
        120
      ),

    preparation:
      clean(
        x.preparation,
        100
      ),

    ambiguity:
      x.ambiguity ===
      'needs_detail'
        ? 'needs_detail'
        : 'none',

    ambiguity_reason:
      clean(
        x.ambiguity_reason,
        240
      ),

    count:
      pos(x.count),

    size:
      SIZES.includes(x.size)
        ? x.size
        : 'unspecified',

    unit_kind:
      UNIT_KINDS.includes(
        x.unit_kind
      )
        ? x.unit_kind
        : 'unknown',

    estimated_piece_grams:
      pos(
        x.estimated_piece_grams
      ),

    estimated_piece_min_g:
      pos(
        x.estimated_piece_min_g
      ),

    estimated_piece_max_g:
      pos(
        x.estimated_piece_max_g
      ),

    portion_confidence:
      CONFIDENCES.includes(
        x.portion_confidence
      )
        ? x.portion_confidence
        : 'none',

    portion_estimate_reason:
      clean(
        x.portion_estimate_reason,
        240
      )
  };
}

function buildSystemPrompt(context) {
  return [
    /*
     * FORMATO
     */

    'You are the NutriTrace Italian food-entry parser.',

    `Current context: ${context}.`,

    'Return ONLY one valid JSON object.',

    'Do not use Markdown.',

    'Do not use code fences.',

    'Do not add commentary before or after the JSON.',

    'The top-level JSON object MUST contain these keys: mode, recipe_name, consumed_grams, final_recipe_weight_g, ingredients, errors.',

    'mode must be either "single" or "recipe".',

    'ingredients must be an array.',

    'errors must be an array of strings.',

    'Every ingredient object must contain these keys: raw, name, grams, quantity_text, preparation, ambiguity, ambiguity_reason, count, size, unit_kind, estimated_piece_grams, estimated_piece_min_g, estimated_piece_max_g, portion_confidence, portion_estimate_reason.',

    'For an unknown numeric field use null.',

    'For an unknown textual field use an empty string.',

    'ambiguity must be "none" or "needs_detail".',

    'size must be "small", "medium", "large", or "unspecified".',

    `unit_kind must be one of: ${UNIT_KINDS.join(', ')}.`,

    'portion_confidence must be "none", "low", "medium", or "high".',

    /*
     * NUTRIENTI
     */

    'You NEVER calculate or estimate calories, macronutrients, vitamins, minerals, amino acids, fatty acids or any other nutrient.',

    'NutriTrace will obtain nutritional values from its own food database after parsing.',

    /*
     * GRAMMI ESPLICITI
     */

    'The grams field has a strict meaning.',

    'Populate grams ONLY when the user explicitly provides a metric mass in grams or kilograms, or when an exact metric conversion is possible.',

    'Never put an estimated piece weight into grams.',

    /*
     * UNITÀ NATURALI
     */

    'Foods that naturally make sense as countable individual items may use unit_kind="natural_unit".',

    'Examples include banana, apple, pear, orange, kiwi, cucumber, tomato, potato, avocado and eggs when appropriate.',

    'If the user writes a singular natural-unit food without an explicit count, use count=1.',

    'If the user explicitly gives a count, preserve it.',

    'Example: "2 uova" means count=2.',

    'If a natural-unit food has no explicit size, use size="medium".',

    'If the user explicitly says piccolo or piccola, use size="small".',

    'If the user explicitly says grande, use size="large".',

    /*
     * UOVA
     */

    'For the ordinary Italian words "uovo" or "uova" without another species, interpret the food as ordinary whole chicken egg.',

    'Do not ask which bird produced the egg unless a different species is explicitly mentioned or context genuinely requires it.',

    'If the user says uovo di quaglia, uovo di anatra or another species, preserve that species in the food name.',

    /*
     * STIMA PESO PEZZO
     */

    'For a natural-unit food you MAY provide estimated_piece_grams plus estimated_piece_min_g and estimated_piece_max_g when a meaningful common average edible piece weight exists.',

    'This is ONLY a portion-weight estimate.',

    'It is NEVER a nutrient estimate.',

    'portion_confidence must honestly represent the variability of the unit.',

    'Use "high" only when the individual unit is relatively standardized.',

    'Use "medium" when a useful typical average exists but normal biological variation is meaningful.',

    'Use "low" when the average is weakly representative.',

    'Use "none" and null estimated weights when automatic weight would not be reliable.',

    /*
     * ALIMENTI MOLTO VARIABILI
     */

    'Do NOT assume every food has a meaningful standard portion.',

    'A plate, dish, bowl, generic serving, pizza, steak, generic slice or other highly variable portion must NOT be treated as a stable natural unit.',

    'For "un piatto di pasta", recognize pasta as the food but use unit_kind="plate" and do not invent grams.',

    'For "una ciotola di cereali", use unit_kind="bowl" and do not invent grams.',

    'For an unspecified steak or similarly variable piece, use unit_kind="piece_variable".',

    /*
     * IDENTITÀ DELL'ALIMENTO
     */

    'Food identity and portion weight are two separate problems.',

    'Ask for clarification only if the missing detail can materially change nutritional composition or database matching.',

    'Dry versus cooked pasta or rice is materially important.',

    'Pasta shape such as spaghetti versus penne normally is not materially important when state and ingredients are equivalent.',

    'Generic meat is materially ambiguous.',

    'Generic sugar means ordinary sucrose unless otherwise specified.',

    'Common names such as banana, apple, cucumber and ordinary chicken egg do not need unnecessary clarification.',

    'Preserve preparation terms such as raw, cooked, boiled, fried, dried or drained when they materially affect food identity.',

    /*
     * CONTESTO
     */

    'In search context, missing weight is NEVER an error.',

    'In quick or diary context, missing explicit weight is not automatically an error for a natural unit that the application can resolve later.',

    'In recipe context, a natural-unit ingredient may omit explicit grams because NutriTrace can later resolve its standard portion.',

    /*
     * RICETTE
     */

    'If the user says "200 g di torta fatta con ...", consumed_grams is 200 and ingredient quantities describe the complete recipe.',

    'consumed_grams is populated only when the user explicitly states the consumed mass.',

    'final_recipe_weight_g is populated only when the user explicitly states the finished or yield mass.',

    'Never infer final cooked weight from ingredient weights.',

    /*
     * DIVIETI
     */

    'Never infer a brand.',

    'Never invent recipe ingredients.',

    'Never invent cooking loss.',

    'Never invent edible yield.',

    'Never invent nutrient values.'
  ].join(' ');
}

async function callOpenRouter(
  key,
  basePayload,
  useJsonMode
) {
  const payload = {
    ...basePayload
  };

  if (useJsonMode) {
    payload.response_format = {
      type: 'json_object'
    };

    /*
     * OpenRouter Response Healing:
     * tenta di correggere automaticamente
     * JSON malformato / markdown / testo
     * misto.
     */
    payload.plugins = [
      {
        id: 'response-healing'
      }
    ];
  }

  return fetch(
    OPENROUTER_URL,
    {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${key}`,

        'Content-Type':
          'application/json',

        ...(
          process.env
            .OPENROUTER_SITE_URL
            ? {
                'HTTP-Referer':
                  process.env
                    .OPENROUTER_SITE_URL
              }
            : {}
        ),

        'X-Title':
          process.env
            .OPENROUTER_APP_NAME ||
          'NutriTrace'
      },

      body:
        JSON.stringify(payload)
    }
  );
}

module.exports =
async function handler(req, res) {
  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );

  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );

  if (req.method !== 'POST') {
    res.setHeader(
      'Allow',
      'POST'
    );

    return res
      .status(405)
      .json({
        error:
          'Metodo non consentito.'
      });
  }

  const key =
    process.env
      .OPENROUTER_API_KEY;

  if (!key) {
    return res
      .status(503)
      .json({
        error:
          'AI non configurata: manca OPENROUTER_API_KEY su Vercel.'
      });
  }

  const body =
    getBody(req);

  const text =
    clean(
      body.text,
      3000
    );

  if (!text) {
    return res
      .status(400)
      .json({
        error:
          'Testo mancante.'
      });
  }

  const context =
    [
      'search',
      'quick',
      'diary',
      'recipe'
    ].includes(body.context)
      ? body.context
      : 'diary';

  const system =
    buildSystemPrompt(
      context
    );

  const basePayload = {
    model:
      process.env
        .OPENROUTER_MODEL ||
      'openrouter/free',

    messages: [
      {
        role: 'system',
        content: system
      },
      {
        role: 'user',
        content: text
      }
    ],

    temperature: 0,

    /*
     * Abbastanza alto da evitare
     * troncamenti sulle ricette.
     */
    max_tokens: 3000,

    stream: false
  };

  try {
    /*
     * Tentativo 1:
     * JSON mode + Response Healing.
     */
    let response =
      await callOpenRouter(
        key,
        basePayload,
        true
      );

    let data =
      await response
        .json()
        .catch(() => ({}));

    /*
     * Alcuni modelli del router free
     * potrebbero non supportare
     * response_format/plugins.
     *
     * In quel caso facciamo un
     * secondo tentativo usando
     * soltanto il prompt JSON.
     */
    if (!response.ok) {
      const status =
        response.status;

      const errorText =
        clean(
          data?.error?.message,
          500
        );

      const potentiallyUnsupported =
        status === 400 ||
        status === 404 ||
        status === 422;

      if (
        potentiallyUnsupported
      ) {
        response =
          await callOpenRouter(
            key,
            basePayload,
            false
          );

        data =
          await response
            .json()
            .catch(() => ({}));
      }

      if (!response.ok) {
        return res
          .status(502)
          .json({
            error:
              data?.error?.message ||
              errorText ||
              `OpenRouter API ${response.status}`
          });
      }
    }

    const parsed =
      parseOpenRouterResponse(
        data
      );

    if (!parsed) {
      const model =
        clean(
          data?.model,
          120
        );

      const finishReason =
        clean(
          data?.choices?.[0]
            ?.finish_reason,
          100
        );

      const raw =
        clean(
          getAssistantText(data),
          300
        );

      return res
        .status(502)
        .json({
          error:
            'Risposta AI non interpretabile.' +
            (
              model
                ? ` Modello: ${model}.`
                : ''
            ) +
            (
              finishReason
                ? ` Fine: ${finishReason}.`
                : ''
            ) +
            (
              raw
                ? ` Output ricevuto: ${raw}`
                : ' Nessun contenuto testuale ricevuto.'
            )
        });
    }

    const ingredients =
      (
        Array.isArray(
          parsed.ingredients
        )
          ? parsed.ingredients
          : []
      )
        .slice(0, 30)
        .map(
          normalizeIngredient
        )
        .filter(
          ingredient =>
            ingredient.name
        );

    const errors =
      (
        Array.isArray(
          parsed.errors
        )
          ? parsed.errors
          : []
      )
        .map(
          error =>
            clean(
              error,
              300
            )
        )
        .filter(Boolean)
        .slice(0, 20);

    /*
     * Aggiungiamo errori soltanto
     * per vere ambiguità identitarie.
     *
     * NON aggiungiamo:
     * "mancano i grammi"
     * per banana/uova/etc.
     */
    for (
      const ingredient
      of ingredients
    ) {
      if (
        ingredient.ambiguity ===
          'needs_detail' &&
        ingredient
          .ambiguity_reason &&
        !errors.some(
          error =>
            error
              .toLowerCase()
              .includes(
                ingredient
                  .name
                  .toLowerCase()
              )
        )
      ) {
        errors.push(
          `${ingredient.name}: ` +
          ingredient
            .ambiguity_reason
        );
      }
    }

    if (!ingredients.length) {
      return res
        .status(502)
        .json({
          error:
            'L’AI non ha restituito alcun alimento interpretabile. Riprova specificando l’alimento.'
        });
    }

    return res
      .status(200)
      .json({
        mode:
          parsed.mode ===
            'recipe' ||
          ingredients.length > 1
            ? 'recipe'
            : 'single',

        recipe_name:
          clean(
            parsed.recipe_name,
            180
          ) ||
          'Voce libera',

        consumed_grams:
          pos(
            parsed
              .consumed_grams
          ),

        final_recipe_weight_g:
          pos(
            parsed
              .final_recipe_weight_g
          ),

        ingredients,

        errors,

        model:
          data?.model ||
          process.env
            .OPENROUTER_MODEL ||
          'openrouter/free'
      });
  } catch (error) {
    return res
      .status(502)
      .json({
        error:
          `AI non disponibile: ${
            error?.message ||
            'errore di rete'
          }`
      });
  }
};
