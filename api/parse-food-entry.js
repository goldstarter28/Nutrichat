'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function clean(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

function pos(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function content(data) {
  const c = data?.choices?.[0]?.message?.content;
  return typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map(x => x?.text || '').join('')
      : '';
}

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

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['single', 'recipe']
    },

    recipe_name: {
      type: 'string'
    },

    consumed_grams: {
      type: ['number', 'null']
    },

    final_recipe_weight_g: {
      type: ['number', 'null']
    },

    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          raw: {
            type: 'string'
          },

          name: {
            type: 'string'
          },

          grams: {
            type: ['number', 'null']
          },

          quantity_text: {
            type: 'string'
          },

          preparation: {
            type: 'string'
          },

          ambiguity: {
            type: 'string',
            enum: ['none', 'needs_detail']
          },

          ambiguity_reason: {
            type: 'string'
          },

          count: {
            type: ['number', 'null']
          },

          size: {
            type: 'string',
            enum: [
              'small',
              'medium',
              'large',
              'unspecified'
            ]
          },

          unit_kind: {
            type: 'string',
            enum: UNIT_KINDS
          },

          estimated_piece_grams: {
            type: ['number', 'null']
          },

          estimated_piece_min_g: {
            type: ['number', 'null']
          },

          estimated_piece_max_g: {
            type: ['number', 'null']
          },

          portion_confidence: {
            type: 'string',
            enum: [
              'none',
              'low',
              'medium',
              'high'
            ]
          },

          portion_estimate_reason: {
            type: 'string'
          }
        },

        required: [
          'raw',
          'name',
          'grams',
          'quantity_text',
          'preparation',
          'ambiguity',
          'ambiguity_reason',
          'count',
          'size',
          'unit_kind',
          'estimated_piece_grams',
          'estimated_piece_min_g',
          'estimated_piece_max_g',
          'portion_confidence',
          'portion_estimate_reason'
        ]
      }
    },

    errors: {
      type: 'array',
      items: {
        type: 'string'
      }
    }
  },

  required: [
    'mode',
    'recipe_name',
    'consumed_grams',
    'final_recipe_weight_g',
    'ingredients',
    'errors'
  ]
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Metodo non consentito.'
    });
  }

  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    return res.status(503).json({
      error:
        'AI non configurata: manca OPENROUTER_API_KEY su Vercel.'
    });
  }

  const body = getBody(req);

  const text = clean(body.text, 3000);

  const context = [
    'search',
    'quick',
    'diary',
    'recipe'
  ].includes(body.context)
    ? body.context
    : 'diary';

  if (!text) {
    return res.status(400).json({
      error: 'Testo mancante.'
    });
  }

  const system = [
    'You parse Italian free-text food diary entries and food searches.',

    'You NEVER calculate calories, macros, vitamins, minerals or other nutrients.',

    `The current context is "${context}".`,

    'Return the food or recipe as structured ingredients for later lookup in the NutriTrace food database.',

    'The grams field has a strict meaning: populate grams ONLY when the user explicitly states a metric mass in grams or kilograms, or when an exact conversion from an explicitly stated metric mass is possible.',

    'Never put an estimated piece weight into the grams field.',

    'For foods naturally consumed or described as individual units, classify them as unit_kind="natural_unit".',

    'Examples of natural units include banana, apple, pear, orange, kiwi, cucumber, tomato, potato, avocado and eggs when appropriate.',

    'When the user writes a singular natural-unit food without an explicit count, infer count=1.',

    'When the user gives a count, preserve it. Example: "2 uova" means count=2.',

    'If a natural-unit food has no explicit size, use size="medium".',

    'If the user explicitly says piccolo/piccola, use size="small".',

    'If the user explicitly says grande, use size="large".',

    'For an unqualified Italian "uovo" or "uova", interpret it as an ordinary whole chicken egg. Do not ask which bird unless another species is explicitly mentioned or the context genuinely requires it.',

    'If the user says uovo di quaglia, uovo di anatra or another species, preserve that species in the food name.',

    'For a natural-unit food you MAY provide estimated_piece_grams and a plausible estimated_piece_min_g / estimated_piece_max_g when a common average edible piece weight is reasonably meaningful.',

    'This is only a portion-weight estimate. It is NEVER a nutrient estimate.',

    'portion_confidence must honestly represent how stable and well-defined the average piece weight is.',

    'Use portion_confidence="high" only when the unit is relatively standardized or has low practical variability.',

    'Use portion_confidence="medium" when a useful average exists but normal biological variation is relevant.',

    'Use portion_confidence="low" when the average is only weakly representative.',

    'Use portion_confidence="none" and null estimated weights when a meaningful automatic piece weight should not be used.',

    'Do NOT assume that every food has a useful standard portion.',

    'A plate, dish, bowl, generic serving, pizza, steak, generic slice or other highly variable portion must NOT be treated as a stable natural unit.',

    'For "un piatto di pasta", recognize the food as pasta but set unit_kind="plate" and do not invent grams.',

    'For "una ciotola di cereali", use unit_kind="bowl" and do not invent grams unless an explicit mass is provided.',

    'For "una pizza", identify the pizza as far as the text allows, but do not invent its total weight.',

    'For highly variable pieces such as an unspecified steak, use piece_variable rather than natural_unit.',

    'Food identity and portion weight are separate problems.',

    'Be specific about food identity when the distinction materially affects nutritional composition.',

    'Dry versus cooked pasta or rice is materially important because water content changes values per 100 g substantially.',

    'Pasta shape such as spaghetti versus penne is normally not materially important when preparation/state is the same.',

    'Generic meat is materially ambiguous and should normally require clarification.',

    'Generic sugar means ordinary sucrose unless the user says otherwise.',

    'Common food names such as banana, apple, cucumber and ordinary chicken egg are acceptable without unnecessary clarification.',

    'Preparation words such as raw, cooked, boiled, fried, dried or drained must be preserved when they materially affect database matching.',

    'Set ambiguity="needs_detail" ONLY when the missing detail can materially change the nutritional identity of the food.',

    'Do not be pedantic about harmless wording or irrelevant varieties.',

    'In search context, missing weight is NEVER an error because the user may simply be searching for a food.',

    'In quick/diary context, a missing explicit weight is not automatically an error when the food is a natural unit whose portion can later be resolved by the application.',

    'In recipe context, ingredient quantities must eventually be resolvable for proportional calculation, but natural-unit ingredients may be left without explicit grams because the application can resolve their standard portion later.',

    'If the user says "200 g di torta fatta con ...", consumed_grams is 200 and ingredient quantities describe the whole recipe.',

    'final_recipe_weight_g is populated only when the user explicitly provides the finished/yield weight.',

    'Never infer final cooked weight from the sum of ingredients.',

    'Never infer brand.',

    'Never invent recipe formulation.',

    'Never infer cooking loss.',

    'Never calculate or invent nutrient values.'
  ].join(' ');

  try {
    const response = await fetch(
      OPENROUTER_URL,
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',

          ...(process.env.OPENROUTER_SITE_URL
            ? {
                'HTTP-Referer':
                  process.env.OPENROUTER_SITE_URL
              }
            : {}),

          'X-Title':
            process.env.OPENROUTER_APP_NAME ||
            'NutriTrace'
        },

        body: JSON.stringify({
          model:
            process.env.OPENROUTER_MODEL ||
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

          max_tokens: 2600,

          provider: {
            require_parameters: true
          },

          response_format: {
            type: 'json_schema',

            json_schema: {
              name: 'food_entry_parse_v2',
              strict: true,
              schema
            }
          }
        })
      }
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      return res.status(502).json({
        error:
          data?.error?.message ||
          `OpenRouter API ${response.status}`
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(content(data));
    } catch {
      return res.status(502).json({
        error:
          'Risposta AI non interpretabile.'
      });
    }

    const ingredients = (
      Array.isArray(parsed.ingredients)
        ? parsed.ingredients
        : []
    )
      .slice(0, 30)
      .map(x => ({
        raw: clean(x.raw, 300),

        name: clean(x.name, 180),

        grams: pos(x.grams),

        quantity_text:
          clean(x.quantity_text, 120),

        preparation:
          clean(x.preparation, 100),

        ambiguity:
          x.ambiguity === 'needs_detail'
            ? 'needs_detail'
            : 'none',

        ambiguity_reason:
          clean(x.ambiguity_reason, 240),

        count: pos(x.count),

        size: [
          'small',
          'medium',
          'large'
        ].includes(x.size)
          ? x.size
          : 'unspecified',

        unit_kind:
          UNIT_KINDS.includes(x.unit_kind)
            ? x.unit_kind
            : 'unknown',

        estimated_piece_grams:
          pos(x.estimated_piece_grams),

        estimated_piece_min_g:
          pos(x.estimated_piece_min_g),

        estimated_piece_max_g:
          pos(x.estimated_piece_max_g),

        portion_confidence: [
          'low',
          'medium',
          'high'
        ].includes(x.portion_confidence)
          ? x.portion_confidence
          : 'none',

        portion_estimate_reason:
          clean(
            x.portion_estimate_reason,
            240
          )
      }))
      .filter(x => x.name);

    const errors = (
      Array.isArray(parsed.errors)
        ? parsed.errors
        : []
    )
      .map(x => clean(x, 300))
      .filter(Boolean)
      .slice(0, 20);

    /*
     * Non aggiungiamo più automaticamente:
     *
     * "Peso mancante: indica i grammi"
     *
     * per ogni alimento.
     *
     * La decisione viene demandata al motore
     * delle porzioni:
     *
     * explicit grams
     *      ↓
     * standard-portions.json
     *      ↓
     * stima AI con confidence/range
     *      ↓
     * richiesta all'utente solo se necessario
     */

    for (const ingredient of ingredients) {
      if (
        ingredient.ambiguity ===
          'needs_detail' &&
        ingredient.ambiguity_reason &&
        !errors.some(e =>
          e
            .toLowerCase()
            .includes(
              ingredient.name.toLowerCase()
            )
        )
      ) {
        errors.push(
          `${ingredient.name}: ${ingredient.ambiguity_reason}`
        );
      }
    }

    return res.status(200).json({
      mode:
        parsed.mode === 'recipe' ||
        ingredients.length > 1
          ? 'recipe'
          : 'single',

      recipe_name:
        clean(parsed.recipe_name, 180) ||
        'Voce libera',

      consumed_grams:
        pos(parsed.consumed_grams),

      final_recipe_weight_g:
        pos(
          parsed.final_recipe_weight_g
        ),

      ingredients,

      errors,

      model:
        data?.model ||
        process.env.OPENROUTER_MODEL ||
        'openrouter/free'
    });
  } catch (e) {
    return res.status(502).json({
      error:
        `AI non disponibile: ${
          e.message || 'errore di rete'
        }`
    });
  }
};
