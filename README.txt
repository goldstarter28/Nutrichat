NutriChat V2.2.2
===================
Obiettivo: resolver semantico general-purpose per migliaia di alimenti.

File:
1. api/parse-food-entry.js
   Sostituisci integralmente il file corrente.

2. app-v2.2.2.patch.txt
   Applica le modifiche indicate all'app.js corrente.

La V2.2.2 NON hardcoda uva/ravioli. L'AI produce dinamicamente:
- lookup_name_en
- search_terms_en
- broader_terms_en
- must_terms_en
- exclude_terms_en

Il frontend cerca fino a 20 query nel Master e applica un semantic gate prima
di mostrare/auto-selezionare candidati.

Principi invariati:
- count/articoli non diventano grammi;
- peso esplicito > catalogo porzioni > stima AI controllata;
- Master DB resta fonte primaria;
- nessun candidato semanticamente incompatibile deve essere auto-selezionato.

Nota: app.js è fornito come patch perché il connettore GitHub restituisce porzioni
del file corrente, non una copia integrale affidabile da riscrivere senza rischio.
