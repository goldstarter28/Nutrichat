# NutriChat V2.3.1 — validazione finale Stage 5C

**PASS**

- 38.230 alimenti runtime.
- 37.801 con `energy_kcal` numerica.
- Macro P/C/F tra gli alimenti con energia: 72 con 0 macro, 913 con 1, 1.791 con 2, **35.025 con tutti e 3**.
- Somma: 37.801 esatti.
- `0.0` numerico è trattato come presente; N/D/trace/conflict/invalid restano distinti.
- 15 valori di `fat_total` ricostruiti tramite bilancio energetico conservativo e marcati come calcolati; 1.790 casi con un solo macro mancante lasciati N/D per incertezza insufficiente.
- Fibra obbligatoria per ogni ricostruzione energetica.
- 64 chunk riletti dopo la scrittura: 0 mismatch di popolazione.
- Global invariant failures: 0.
- Regression pseudocasuale: 1.600 alimenti, esempi già discussi esclusi, 0 failure.
- Regression stratificata per fonte: 1.120 controlli, 0 failure.
- Fix completamento AI e cache/versionamento inclusi nel pacchetto finale.
