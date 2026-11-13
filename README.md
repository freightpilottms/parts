# Parts

Bosanska web aplikacija za evidenciju autodijelova, prilagođena mobitelima i desktopu. Next.js + server API + PostgreSQL. Projekat: `D:\Parts`.

## Pokretanje

`npm install`, zatim `npm run db:setup` i `npm run dev -- --port 3333`. Otvorite http://localhost:3333. Na Windowsu možete pokrenuti `Start-Parts.cmd`.

`.env.local` sadrži privatni `DATABASE_URL` preuzet iz DOARDS konfiguracije. Nemojte ga commitovati ili dijeliti. Setup koristi isključivo privatnu shemu `parts_app`; ne mijenja DOARDS tabele. Setup je ponovljiv i ne resetuje postojeće lozinke.

Pocetni korisnici: Administrator, Adem, Juso, Almin. Pocetna lozinka je `1234`, i lokalno i na Vercelu. Prva prijava otvara obaveznu promjenu lozinke (najmanje 6 znakova, bez obaveznih posebnih znakova). Dok se lozinka ne promijeni, API dozvoljava samo podatke o vlastitoj prijavi, promjenu lozinke i odjavu. Nakon promjene, pocetna lozinka i prethodne sesije vise ne vrijede. Isto pravilo vazi za novo dodane korisnike.

## Lokalni pregled bez Supabasea

`npm run dev:preview` ili `Start-Local-Preview.cmd` pokreće odvojenu PostgreSQL-kompatibilnu lokalnu bazu u `.parts-preview`. Na vrhu je žuta oznaka. Podaci i promjene lozinki iz tog režima **nisu u Supabaseu** i ne prenose se automatski. Taj režim je zabranjen na Vercelu. Standardni `npm run dev` nikad automatski ne prelazi na lokalnu bazu.

## Pretraga i cijene

1. OEM broj se normalizuje uklanjanjem razmaka i crtica, a prvo se pretražuje indeks u bazi.
2. Internetski rezultat je keširan 24 sata.
3. Uz `GEMINI_API_KEY` koristi se Gemini sa Google Search groundingom. Model se podešava kroz `GEMINI_MODEL` (zadano `gemini-2.5-flash`). Pozivi su isključivo serverski. Kvota i cijena zavise od Google projekta; besplatan rad nije garantovan.
4. Bez AI ključa radi pokušaj besplatne Bing RSS pretrage izvora; ona ne garantuje dostupnost ni prepoznavanje. Ručni unos je uvijek dostupan. Ne izmišljaju se slike, podudaranja ili cijene.
5. AI prijedloge i kompatibilnost treba potvrditi. Prikazuju se izvori, broj ponuda i prosjek odvojeno za EU/BiH i novo/polovno. I jedan oglas ostaje označen kao jedna ponuda, ne pouzdan tržišni prosjek. Ponude u EUR pretvaraju se u KM po 1,95583. Ponovljeni URL-ovi se ne računaju dvaput.
6. Referentna internetska slika nije fotografija korisnikovog artikla i ne prenosi se automatski među njegove fotografije.

## Pravila evidencije

- Svaki primjerak ima vlastiti zapis; isti OEM može pripadati više artikala.
- Objavljen artikal se ne briše: prelazi u prodano uz stvarnu cijenu, uključujući 0 KM. Prodaja je atomska i ne može se izvršiti dvaput.
- Najviše tri fotografije; serverska provjera stvarnog formata, rotacija, uklanjanje metapodataka i WebP optimizacija. Slike se čuvaju privatno u PostgreSQL-u i poslužuju isključivo kroz autentificirani API. Za veći obim preporučuje se migracija slika u privatni object storage.
- Ako objava uspije, a upload djelimično ne uspije, dugme nastavlja preostale fotografije bez dupliranja artikla.
- Vrijednost skladišta je zbir procjena polovnog za dostupne primjerke: koristi se BiH prosjek, a ako nedostaje EU prosjek. Artikli bez procjene nisu vrednovani nulom bez oznake: prikazan je njihov broj.
- Promet je zbir stvarnih prodajnih cijena. Dobit je promet minus ukupna nabavna cijena robe i transport; uključuje i trošak još neprodane robe.
- Aktivnost bilježi korisnika, vrijeme, artikal i cijenu; prikazuje posljednjih 50 zapisa. Svi korisnici su System Admin i mogu mijenjati zajedničku evidenciju.

## Vercel

Koristite postojeći projekat **parts**, ID `prj_EykcrnXzC2eVYtwg4DJCO3jEDuBK`. Nije kreiran novi Vercel projekat niti je aplikacija objavljena.

Pošto je projekat ranije koristio Vite/DOARDS, u Vercelu postavite:

- Framework: **Next.js**.
- Root Directory: folder koji sadrži ovaj `package.json`.
- Build Command: `npm run build`.
- Output Directory: ukloniti stari `dist` override; ostaviti Next.js zadanu vrijednost.
- Install Command: `npm install`; Node.js 24.x.
- `DATABASE_URL`: za navedeni Supabase projekat koristiti IPv4 Transaction Pooler URI iz Supabase Connect ako direktni host nije dostupan. Ne nagađati pooler region. TLS certifikat se provjerava.
- `APP_ORIGIN`: tačan HTTPS origin aplikacije bez završne kose crte, npr. vaša potvrđena Vercel domena.
- Opcionalno `GEMINI_API_KEY`, `GEMINI_MODEL`.
- Ne postavljati `PARTS_LOCAL_PREVIEW` i ne koristiti stare `DOARDS_API_ORIGIN` varijable.

Prije objave pokrenite setup i postavite privatne lozinke svih početnih korisnika na stvarnoj bazi. Bez toga javni prvi login ostaje blokiran. Ne izlažite produkcijski DATABASE_URL nepouzdanim Preview granama.

## Sigurnost i provjera

Privatna shema, opozvani anon/authenticated grants, parametrizovani SQL, scrypt lozinke, slučajni serverski session tokeni čiji se hash čuva u bazi, HttpOnly/SameSite cookies (Secure u produkciji), provjera Origin zaglavlja, ograničenje prijava i pretraga, ograničena i validirana tijela zahtjeva, zaključavanje prodaja i limita fotografija. Nema javnog endpointa za setup ili brisanje artikala.

`npm test` provjerava API tokove sa stvarnim SQL-om u izolovanoj in-memory bazi, bez vanjske mreže. `npm run check` provjerava TypeScript; `npm run build` pravi produkcijski build. Ove provjere nisu zamjena za završni test stvarnog Supabase povezivanja, AI rezultata, mobilne kamere i Vercel okruženja.

## Prijava i instalacija na uredjaj

Nova prijava ostaje zapamcena 30 dana kroz HttpOnly cookie i serversku sesiju. Lozinka se ne pohranjuje u browser storage. Odjava ponistava sesiju; promjena lozinke ponistava prethodne sesije. Stare prijave zadrzavaju svoj raniji rok dok se korisnik ponovo ne prijavi.

Dugme Instaliraj aplikaciju koristi nativnu instalaciju kada je preglednik podrzava. Na iPhone/iPad prikazuje upute za Safari > Share > Add to Home Screen. Manifest ukljucuje 192/512 ikone, maskable ikonu, Apple ikonu i standalone prikaz. Za telefon koristite javni HTTPS domen nakon objave. Service worker cuva samo javne ikonice i offline obavijest; ne cuva API, privatne slike ni inventar. Offline prodaja nije podrzana.

## Izbor AI servisa

- Google: `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-2.5-flash`.
- OpenAI: `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5-mini`.

Kljucevi su iskljucivo serverski (bez NEXT_PUBLIC_). Nakon Vercel izmjene varijabli uradite Redeploy. GPT koristi Responses API s web-pretragom, najvise tri tool poziva po zahtjevu; stvarna potrosnja zavisi od tokena i web poziva. AI rezultati se kesiraju odvojeno po provajderu/modelu. Podrska je implementirana; poziv uz stvarni kljuc treba provjeriti nakon konfiguracije.
