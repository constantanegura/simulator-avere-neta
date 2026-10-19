# Simulator Avere Netă

Simulator pentru sesiuni de grup: participanții scanează un cod QR, își calculează averea netă pe telefon,
iar ecranul prezentatorului arată în timp real câți participanți sunt activi și ce procent sunt
**acumulatori de avere** sau **cheltuitori**.

## Folosire (online, fără instalare)

- **Ecranul prezentatorului:** https://tinyurl.com/simulator-avere-neta
  Îl deschizi pe laptop / proiector. Codul QR de pe ecran duce participanții direct în sesiunea ta.
- **Sesiune nouă** (buton pe ecran): pornește o sesiune curată, cu cod QR nou.

Merge de pe orice rețea, inclusiv date mobile. Nu are nevoie de server sau de laptop pornit pentru participanți;
ecranul prezentatorului trebuie doar să fie deschis ca să vezi rezultatele live.

## Cum se calculează
1. **Vârsta** dă coeficientul: până în 25 ani 0,5 · 26–30 ani 1 · 31–40 ani 3 · 41–60 ani 6 · peste 60 ani 9.
2. **Averea netă = Acumulări − Datorii** (bani lichizi, investiții, proprietăți, bunuri de valoare, criptomonede, afaceri
   minus credite, carduri de credit, alte datorii, bunuri de valoare, criptomonede, afaceri).
3. **Referința = Salariul lunar × 12 × Coeficientul vârstei.**
4. Avere netă ≥ Referință → **Acumulator de avere**; altfel → **Cheltuitor**.

Sursa coeficienților: „Milionarul de lângă noi”.

## Confidențialitate
Calculul se face pe telefonul participantului. În sesiunea live se trimit doar profilul (acumulator / cheltuitor)
și grupa de vârstă, anonim, printr-un releu public gratuit (MQTT). Nu se trimit nume sau sume.
Fiecare telefon e numărat o singură dată, chiar dacă scanează codul de mai multe ori.

## Structură
- `docs/` — versiunea publicată pe GitHub Pages (generată, nu se editează direct): `index.html` ecranul de prezentare, `formular.html` formularul deschis din QR.
- `public/` + `server.js` — versiunea cu server propriu (laptop sau Render), aceeași interfață.
- `tools/build-pages.js` — regenerează `docs/` din `public/`: `node tools/build-pages.js`.

## Variantă cu server propriu (opțional)
```
node server.js
```
Fără dependințe (Node 18+). Pentru găzduire pe Render există `render.yaml`
(cere variabila `ADMIN_KEY`, cheia ecranului de prezentare).
