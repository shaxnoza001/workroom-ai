# WORKROOM AI — avtonom raqamli ofis

Face ID davomat (platforma ichida, har qanday kamerada), ichki video-majlis (Zoom o‘rniga), o‘zbekcha Meeting AI (tinglaydi → xulosa + vazifalar), 1-Click tasdiqlash, Smart KPI & maosh, Telegram bot.

## Ishga tushirish (kompyuterda)
```bash
npm install
npm start          # http://localhost:3000
```
Kamera/mikrofon faqat `localhost` yoki **https** da ishlaydi (Render avtomatik https beradi).

## Render’ga joylash
1. Papkani GitHub’ga yuklang → Render → **New Web Service** → repo.
2. Build: `npm install` · Start: `npm start`
3. **Environment** bo‘limiga qo‘shing:

| O‘zgaruvchi | Nima uchun |
|---|---|
| `GEMINI_API_KEY` | Meeting AI: audio + matnni tahlil qilib vazifalar chiqaradi. Bo‘lmasa — oddiy qoida bilan ishlaydi |
| `SUPER_ADMIN_KEY` | Umumiy admin panel (`/admin`) kaliti — barcha ochilgan Room’lar, xodimlar va jonli faollikni ko‘rasiz. Uzun, tasodifiy so‘z qo‘ying |
| `GEMINI_MODEL` | ixtiyoriy. Bo‘sh qoldiring — server kalitingizga ochiq eng yangi Gemini Flash modelini o‘zi tanlaydi |
| `TELEGRAM_BOT_TOKEN` | @BotFather’dan. Kim keldi/kelmadi xabarlari |
| `DATA_DIR` | Render **Disk** ulasangiz, masalan `/var/data` — ma’lumotlar o‘chib ketmaydi |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | ixtiyoriy. Mobil internetda video ulanmasa (masalan, metered.ca bepul TURN) |
| `FACE_THRESHOLD` | ixtiyoriy, standart `0.5` (kichikroq = qattiqroq) |

⚠️ Render bepul tarifida disk vaqtinchalik — qayta ishga tushganda `db.json` o‘chadi. Haqiqiy mijozlar uchun **Disk** ($) qo‘shing yoki keyin PostgreSQL’ga o‘tamiz.

## Qanday ishlaydi
- **Room ochish** (`/`): kompaniya → xodimlar ro‘yxati → kamera ochiladi va **hamma navbat bilan yuzini skaner qiladi** → `#UZxxxx` kod.
- **Admin panel** (`/room/UZxxxx`): Boshqaruv, Face ID kiosk, Xodimlar (skaner/qayta skaner), Majlislar, Vazifalar (kanban), KPI & Maosh (CSV), Sozlamalar.
- **Face ID**: brauzerda `face-api.js` yuzni 128 ta raqamli “izga” aylantiradi; serverga rasm emas, shu iz yuboriladi va solishtiriladi. 1-qarash = keldi (kechikish daqiqasi bilan), 2-qarash = ketdi.
- **Majlis**: WebRTC video (≈6 kishigacha), ekran ulashish, chat. Har bir ishtirokchining telefoni/kompyuteri uning nutqini `uz-UZ` bilan jonli subtitrga aylantiradi (Chrome/Edge), rahbar qurilmasi butun majlis ovozini yozib oladi. “Yakunlash” → Gemini ovoz + subtitrni tahlil qiladi → xulosa, qarorlar, “kim — nima — qachongacha” → rahbar **1-Click tasdiqlaydi** → vazifalar xodimlarga va Telegramga tushadi.
- **Telegram**: Sozlamalar’dagi `/ulash UZxxxx maxfiy` buyrug‘ini botga yuboring. `/hisobot` — bugungi davomat. Ish boshlanganidan 30 daqiqa o‘tib avtomatik “kim kelmadi” hisoboti.

## Yangi modullar (v3)
- **AI Mentor** (`Room → AI Mentor`): xodim savol beradi, Gemini kompaniyaning **Bilim bazasi** (rahbar to‘ldiradi: qoidalar, yo‘riqnomalar, .txt fayl) asosida o‘zbekcha javob beradi. Rahbar xodimlar nima so‘rayotganini ko‘rib turadi.
- **AI Assistant · 1-Click**: xodim “Bugun kela olmayman” (kasal/ta’til) bosadi yoki rahbar belgilaydi → AI ochiq vazifalarni eng mos (bir xil lavozim, eng kam yuklangan) hamkasbga o‘tkazishni taklif qiladi → rahbar “Ha, o‘tkaz” yoki boshqa xodimni tanlaydi. Telegram’ga ham boradi.
- **Umumiy admin panel** (`/admin`): barcha Room’lar jadvali, 14 kunlik check-in grafigi, taxminiy MRR, jonli faollik lentasi, har bir Room tafsiloti, “Admin sifatida ochish” va o‘chirish.

## Yangi (v4)
- **Oflayn majlis (xonada)**: Majlislar → “Oflayn majlis”. Telefon/noutbukni stolga qo‘ying — butun xona yoziladi, ekran o‘chmaydi, jonli subtitr chiqadi. Yakunlanganda Gemini spikerlarni ajratib (ism aytilsa ism bilan), xulosa va vazifalarni chiqaradi. **Internet bo‘lmasa** yozuv qurilmada (IndexedDB) saqlanadi va internet qaytishi bilan avtomatik yuboriladi.
- **Audio fayl yuklash**: diktofon yoki Telegram ovozli yozuvi (mp3/m4a/ogg/webm, 19 MB gacha) → AI tahlil.
- **AI Assistant avto-nazorat**: ish boshlanib *N* daqiqa (Sozlamalar) o‘tgach, xabarsiz kelmaganlarni o‘zi topadi → eng mos o‘rinbosarni tanlaydi (bir xil lavozim, bugun ishda, eng kam band) → rahbarga saytda va Telegram’da “✅ Ha / ✖️ Yo‘q” tugmali taklif yuboradi. **Avtopilot** yoqilsa — o‘zi tayinlaydi.
- **Xodim javob beradi**: xodim botga `/men UZxxxx kod` yuborib ulanadi (kod uning bosh sahifasida). Kelmasa bot undan “Kasalman / Kechikyapman / Ta’til / Uzrli” deb so‘raydi, javob rahbarga boradi; o‘rinbosarga ham “bugun siz mas’ulsiz” xabari keladi.
- **E’lonlar**, **AI kun xulosasi** (ish tugaganda Telegram’ga), **Oyning eng yaxshilari**, **maosh varaqasi** (chop etish/PDF), telefonga **ilova sifatida o‘rnatish** (PWA), **kun / tun rejimi** (tugma: quyosh/oy).

## Xavfsizlik (v5)
- Room kodi 6 xonali (`UZ123456`), kirish urinishlari cheklangan (rate limit) — kodni taxmin qilish amalda imkonsiz.
- Kod bilan kirgan yangi odam **rahbar tasdiqlaguncha** hech narsa ko‘rmaydi (xodimlar, vazifalar, majlislar yopiq). Eng xavfsiz yo‘l — Xodimlar jadvalidagi 🔗 **shaxsiy havola**.
- Mavjud xodim ismi bilan kirib, uning hisobini egallab bo‘lmaydi.
- Barcha ma’lumot API’lari va real-vaqt (Socket.io) kanallari kalit bilan himoyalangan; kalitlar vaqtga bardoshli (timing-safe) solishtiriladi.
- Face ID kiosk faqat admin qurilmasida; xodim telefonida faqat **o‘zini** belgilay oladi.
- CSP, HSTS, X-Frame-Options, nosniff, Permissions-Policy sarlavhalari; HTTP → HTTPS yo‘naltirish.
- Rasm faqat JPEG/PNG/WebP base64 (SVG orqali XSS yo‘q), barcha matnlar uzunligi va formati tekshiriladi.
- Gemini kaliti URL’da emas, sarlavhada yuboriladi; xatolar foydalanuvchiga ichki tafsilotsiz qaytadi.
- Render to‘xtatganda ma’lumotlar darhol saqlanadi; har kuni zaxira nusxa (7 kun), buzilgan bazada avtomatik tiklash.
- `npm audit`: 0 zaiflik.

## Joylash (Render, 5 daqiqa)
1. Papkani GitHub’ga yuklang.
2. Render → **New → Blueprint** → repo’ni tanlang (`render.yaml` hamma narsani sozlaydi: disk, healthcheck, `SUPER_ADMIN_KEY`).
3. Environment’da `GEMINI_API_KEY` va `TELEGRAM_BOT_TOKEN`ni kiriting → **Deploy**.
4. `SUPER_ADMIN_KEY` qiymatini Environment’dan oling — `/admin` sahifasining kaliti.
> Bepul tarifda disk yo‘q: qayta ishga tushganda ma’lumot o‘chadi. Haqiqiy mijozlar uchun **Starter** tarif + disk shart.

## v6 tuzatishlar
- **Rahbar kirishi**: Room ochishda parol qo‘yiladi. Boshqa qurilmadan: bosh sahifa → Roomga kirish → **Rahbarman** → kod + parol. Umumiy platforma admini: `/admin` + `SUPER_ADMIN_KEY`.
- **Kelish/ketish**: “Avto” rejimda kelgandan keyin 3 soat ichida qayta qarash “ketdi” bo‘lmaydi; kioskda **Keldim / Ketdim** tugmalari. Noto‘g‘ri yozuvni admin o‘chira oladi.
- **Face ID**: aniqroq SSD detektor, “yuz” emas narsalar (kiyim, fon) rad etiladi, **tirik yuz** tekshiruvi (boshni yon tomonga burish), ikki xodimga o‘xshagan yuz qabul qilinmaydi, bir yuz ikki xodimga yozilmaydi. Noto‘g‘ri yozilgan Face ID’ni Xodimlar → ✎ → “Face ID’ni o‘chirish”.
- **Gemini**: model avtomatik tanlanadi (eski model o‘chirilsa ham ishlaydi), xato sababi ko‘rinadi.
- **Telegram**: Render’da **webhook** rejimi — bepul tarifda server uxlab qolsa ham bot xabari uni uyg‘otadi.
- **Sozlamalar → Tizim holati**: Gemini va bot ishlayaptimi, xato bo‘lsa — sababi.

## Cheklovlar (keyingi bosqich)
- Face ID’da “tirik yuz” tekshiruvi yo‘q — telefondagi rasmni ko‘rsatib aldash mumkin. Kioskni rahbar ko‘radigan joyga qo‘ying; keyin ko‘z qisish/bosh burish tekshiruvini qo‘shamiz.
- Video mesh ~6 kishigacha yaxshi; ko‘proq bo‘lsa LiveKit/Jitsi server kerak.
- Jonli subtitr Safari/Firefox’da yo‘q — lekin yozuv baribir Gemini’ga boradi.
