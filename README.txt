NutriChat V2.3 — Master DB rigenerato, ricerca ottimizzata, AI robusta e cronologia analitica

CONTENUTO PRINCIPALE
- Master DB runtime V2.3 DB1: 38.072 alimenti, 64 chunk, 105 nutrienti/componenti canonici.
- Ricerca giornaliera con debounce e indice pre-normalizzato per evitare scansioni/rerender pesanti durante la digitazione.
- Voce libera/lista/ricetta con browser candidati e dettaglio completo prima della selezione.
- AI enrichment senza limite utente di 8 nutrienti: batching interno, retry JSON, errori per singolo nutriente e blocco esplicito high-risk.
- Profilo predefinito 72 kg / 2350 kcal e target V2.3.
- Micronutrienti con target prevalentemente settimanali e classificazione coverage-aware.
- Sezione Analisi con giorno/settimana/mese/anno/intervallo personalizzato, confronto periodo precedente e cronologia.

MASTER DB V2.3
- Runtime version: 2.3-db1.
- 1.354.385 valori numerici; 27.957 N/D espliciti.
- 13.146 valori strutturati recuperati conservativamente senza sovrascrivere valori esistenti.
- 18.899 alimenti con core macro completo (energia + proteine + grassi + carboidrati), rispetto a 16.760 della baseline.
- Pasta integrale, pane integrale, riso integrale, banana, uovo, cetriolo e uva inclusi nei quality gate.
- N/D resta distinto da zero; stime AI non vengono incorporate nel Master e non alimentano la classifica carenze.

AI
- OPENROUTER_API_KEY resta server-side nelle Vercel Functions.
- /api/parse-food-entry interpreta alimento/quantità/preparazione e genera query semantiche; non genera nutrienti.
- /api/nutrition-enrich è fallback controllato: JSON healing/retry, stime marcate AI, high-risk espliciti.

MIGRAZIONE
- Diario e alimenti personali restano nelle chiavi esistenti.
- Profilo/obiettivi V2.3 usano chiavi versionate nutritrace_profile_v23 e nutritrace_goals_v23 per applicare i nuovi default senza confonderli con quelli precedenti.
- Gli alimenti Master salvati localmente vengono rinfrescati quando la runtime_version cambia, mantenendo l'id locale dei log.

CACHE
- Service Worker e download Master usano la cache `nutrichat-v23-runtime`, separata dalle V2.1/V2.2.

DEPLOY
Sostituire integralmente i file del pacchetto nella repo, inclusa l'intera cartella data/master.
Environment: OPENROUTER_API_KEY; OPENROUTER_MODEL opzionale (default openrouter/free).
