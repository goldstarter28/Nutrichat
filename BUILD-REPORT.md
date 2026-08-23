# NutriChat V2.3 — Build report

La V2.3 integra cinque checkpoint: Master DB, Search/UI, AI enrichment, Goals e Analytics.

## Master DB
Runtime `2.3-db1`, 38.072 alimenti, 64 chunk. La rigenerazione recupera 13.146 valori strutturati mancanti secondo policy conservativa, senza sovrascrivere valori esistenti. Core macro completo su 18.899 alimenti. Vedi `data/master/V23_DB_REGENERATION_REPORT.json` e `V23_DB_VALIDATION_REPORT.json`.

## Search/UI
Debounce 220 ms sulla ricerca rapida, indice Master pre-normalizzato, ranking che favorisce copertura macro. Voce libera/lista/ricetta dispone di browser candidati e scheda dettagliata prima della selezione.

## AI
Parser semantico general-purpose V2.3. Enricher con batching lato client, retry JSON/response healing e stato esplicito per nutrienti high-risk o errori per singolo campo. Le stime AI restano separate dal Master e dalle classifiche di carenza.

## Goals
Default 72 kg / 2350 kcal; target micro prevalentemente settimanali, UL e target compositi supportati.

## Analytics
Report giorno/settimana/mese/anno/intervallo, confronto col periodo precedente, coverage e cronologia navigabile.
