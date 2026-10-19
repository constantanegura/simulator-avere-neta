# Simulator Avere Netă

Simulator pentru sesiuni de grup: participanții scanează un cod QR, își calculează averea netă pe telefon,
iar ecranul prezentatorului arată în timp real câți participanți sunt activi și ce procent sunt
**acumulatori de avere** sau **cheltuitori**.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/constantanegura/simulator-avere-neta)

## Cum se calculează
1. **Vârsta** dă coeficientul: până în 25 ani 0,5 · 26–30 ani 1 · 31–40 ani 3 · 41–60 ani 6 · peste 60 ani 9.
2. **Averea netă = Acumulări − Datorii** (bani lichizi, investiții, proprietăți, bunuri de valoare, criptomonede, afaceri
   minus credite, carduri de credit, alte datorii, bunuri de valoare, criptomonede, afaceri).
3. **Referința = Salariul lunar × 12 × Coeficientul vârstei.**
4. Avere netă ≥ Referință → **Acumulator de avere**; altfel → **Cheltuitor**.

Sursa coeficienților: „Milionarul de lângă noi”.

## Pagini
- `/` — formularul pentru participanți (se deschide din codul QR).
- `/prezentare?key=CHEIA` — ecranul pentru proiector: QR, participanți activi, procente live, pe grupe de vârstă.
  Cu cheia apare butonul „Sesiune nouă”, care șterge rezultatele.

Se trimit doar profilul (acumulator / cheltuitor) și grupa de vârstă, anonim. Nu se salvează nume sau sume.
Fiecare telefon e numărat o singură dată, chiar dacă scanează codul de mai multe ori.

## Online, cu link fix (Render, gratuit)
1. Apasă butonul **Deploy to Render** de mai sus și intră în cont (te poți loga cu GitHub).
2. Când ți se cere `ADMIN_KEY`, alege o cheie pentru ecranul de prezentare (de ex. un cuvânt și câteva cifre).
3. După publicare primești un link de forma `https://simulator-avere-neta-xxxx.onrender.com`.
   - Ecran prezentare: `https://…onrender.com/prezentare?key=CHEIA`
   - Codul QR de pe ecran duce automat la formularul de pe același link.

Pe planul gratuit, aplicația „adoarme” după 15 minute fără vizitatori și se trezește în aproximativ un minut.
Deschide ecranul de prezentare cu câteva minute înainte de sesiune. Rezultatele se păstrează cât rulează serverul;
„Sesiune nouă” le șterge oricând.

## Local, de pe laptop
```
node server.js
```
Fără dependințe (Node 18+). În consolă apar linkul ecranului de prezentare și cheia.
Dacă `bin/cloudflared.exe` există (Cloudflare Tunnel), serverul deschide singur și un link public https temporar.
Fără el, telefoanele trebuie să fie pe aceeași rețea Wi-Fi cu laptopul.

Variabile opționale: `PORT`, `ADMIN_KEY`, `PUBLIC_URL`, `TUNNEL=0`.
