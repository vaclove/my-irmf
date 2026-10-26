# QLab status API – instrukce pro integraci do my.irmf.cz

Read-only JSON API se stavem promítacího QLabu (co se právě promítá, jak dlouho, jaké cues jsou v show).
Slouží jako zdroj dat pro vizualizaci v my.irmf.cz.

## Architektura

```
prohlížeč ──► my.irmf.cz backend (Azure) ──HTTPS + service token──► Cloudflare Access ──► tunnel ──► bridge na Macu ──OSC──► QLab
```

- API je **jen pro čtení**. Existují jen GET endpointy níže, nic jiného nejde.
- Za API je Cloudflare Access. Bez platného service tokenu vrací **403**.
- **Volat se smí jen ze serveru (backendu my.irmf.cz), nikdy přímo z prohlížeče.** Service token je tajný a nesmí se dostat do frontendového kódu, bundle, HTML ani do odpovědí pro klienta. CORS záměrně není povolený.

## Přístup

| | |
|---|---|
| Base URL | `https://qlab.irmf.cz` |
| Metoda | jen `GET` |
| Autentizace | HTTP hlavičky `CF-Access-Client-Id` a `CF-Access-Client-Secret` (Cloudflare Access service token) |
| Formát | `application/json; charset=utf-8`, UTF-8 (názvy obsahují diakritiku a znaky jako `–`) |

Konfigurace přes proměnné prostředí (v Azure App Settings / Key Vault, ne v repozitáři):

```
QLAB_API_URL=https://qlab.irmf.cz
QLAB_CF_CLIENT_ID=<client id>.access
QLAB_CF_CLIENT_SECRET=<client secret>
```

Test z příkazové řádky:

```bash
curl -H "CF-Access-Client-Id: $QLAB_CF_CLIENT_ID" -H "CF-Access-Client-Secret: $QLAB_CF_CLIENT_SECRET" https://qlab.irmf.cz/status
```

## Endpointy

### `GET /status` – hlavní endpoint pro vizuál

Vše potřebné v jednom požadavku: workspace + co běží.

```json
{
  "workspace": {
    "name": "IRMF promítání.qlab5",
    "uniqueID": "8462A6EC-F0BD-4D42-8390-5A4296844B13"
  },
  "permissions": "ok:view",
  "running": [
    {
      "uniqueID": "9653B982-0A64-4FA8-A460-3F9060EE171A",
      "number": "10",
      "name": "FILM – The Square",
      "type": "Video",
      "paused": false,
      "elapsed": 413.45950587500005,
      "duration": 8701.92
    }
  ],
  "time": "2026-10-20T21:10:07+0200"
}
```

| Pole | Typ | Význam |
|---|---|---|
| `workspace.name` | string | název QLab souboru |
| `workspace.uniqueID` | string | ID workspace |
| `permissions` | string | interní informace o přístupu k QLabu, **ve frontendu ignorovat** |
| `running` | array | cues, které právě běží nebo jsou pozastavené (stejný formát jako `/running`). **Prázdné pole = nic se nepromítá.** |
| `time` | string | lokální čas Macu v okamžiku odpovědi, formát `YYYY-MM-DDTHH:MM:SS+HHMM` (offset **bez dvojtečky**) |

### `GET /running` – jen běžící cues

Pole objektů, stejné jako `status.running`:

| Pole | Typ | Význam |
|---|---|---|
| `uniqueID` | string | stabilní ID cue, použij jako klíč (React key apod.) a pro spárování s `/cuelists` |
| `number` | string | číslo cue v QLabu (např. `"10"`), **může být prázdný řetězec** |
| `name` | string | název cue (např. název filmu nebo spotu) |
| `type` | string | typ cue: `"Video"`, `"Audio"`, `"Group"`, `"Wait"`, `"Fade"`, … |
| `paused` | bool | `true` = pozastaveno, `false` = běží |
| `elapsed` | number \| null | uplynulý čas v **sekundách** (float) |
| `duration` | number \| null | celková délka v **sekundách** (float), může být `0` nebo `null` u cues bez pevné délky |

Poznámky:
- Najednou může běžet **víc cues** (např. Group a v ní Video, nebo Video + Audio). Pro hlavní „teď se promítá“ zobrazení vyber typ `Video` s nejdelší `duration`. Pokud žádné Video neběží, vezmi první položku.
- Zbývající čas = `duration - elapsed`. Progress = `elapsed / duration` (jen když `duration > 0`, jinak zobraz neurčitý stav).

### `GET /cuelists` – seznam všech cues v show

Strom cue listů. Mění se jen při úpravě show, stačí načíst při startu a pak třeba jednou za minutu.

```json
[
  {
    "uniqueID": "89C010BD-3BFE-4088-B6BC-064320D566BE",
    "number": "",
    "name": "Main Cue List",
    "listName": "Main Cue List",
    "type": "Cue List",
    "armed": true,
    "flagged": false,
    "colorName": "none",
    "cues": [
      {
        "uniqueID": "864831EB-A040-4791-89D4-1F8155088F73",
        "number": "1",
        "name": "Spot PMDP",
        "listName": "Spot PMDP",
        "type": "Video",
        "armed": true,
        "flagged": false,
        "colorName": "none"
      }
    ]
  }
]
```

| Pole | Typ | Význam |
|---|---|---|
| `uniqueID`, `number`, `name`, `type` | | stejně jako u `/running` |
| `listName` | string | název, jak ho QLab zobrazuje v seznamu (preferuj pro zobrazení, fallback `name`) |
| `armed` | bool | `false` = cue je vypnutá, při spuštění se přeskočí |
| `flagged` | bool | ruční značka v QLabu |
| `colorName` | string | barva cue v QLabu (`"none"`, `"red"`, `"green"`, …) |
| `cues` | array, volitelné | vnořené cues (u `Cue List` a `Group`). Prochází se rekurzivně. |

Nejvyšší úroveň pole jsou cue listy (`type: "Cue List"`, případně `"Cart"`). `duration` ani časy tu nejsou, ty jsou jen v `/running`.

### `GET /snapshot.jpg` – náhled obrazu z projektoru

Aktuální snímek toho, co jde na plátno (výstup QLabu na projektor), jako `image/jpeg`, 640×360 px, typicky 10–60 kB.

- Nový snímek vzniká **nejvýš jednou za 10 s**. Dotazy v mezidobí dostanou stejný obrázek, takže nemá smysl stahovat ho častěji.
- Mezi cues nebo po skončení filmu bývá obraz černý. Je to platný snímek, ne chyba.
- Při chybě vrací `503` s JSON `{"error": "snímek nedostupný: ..."}`, například když projektor není připojený nebo bridge nemá oprávnění snímat obrazovku.
- Ve vizuálu ho zobraz jako obrázek z **vlastního** endpointu my.irmf.cz (např. `<img src="/api/qlab/snapshot.jpg?t=...">`), nikdy přímo z `qlab.irmf.cz`.

### `GET /healthz` – dostupnost

`200 {"ok": true}` = QLab je dostupný. `503 {"ok": false, "error": "..."}` = bridge běží, ale QLab ne. Hodí se pro monitoring, ne pro vizuál.

## Chybové stavy

**Před parsováním JSONu vždy zkontroluj status a `Content-Type`.** Chyby z Cloudflaru jsou HTML, ne JSON.

| Status | Content-Type | Příčina | Co zobrazit |
|---|---|---|---|
| 200 | JSON | OK | data |
| 403 | text/html | chybějící nebo špatný service token (chyba konfigurace) | „data nedostupná“, zalogovat jako chybu |
| 502 / 530 | text/html | Mac je vypnutý, bez sítě, nebo neběží bridge či tunnel | „promítání offline“ |
| 503 | JSON `{"error": "..."}` | bridge běží, ale QLab není spuštěný nebo nemá otevřený workspace. U `/snapshot.jpg`: projektor odpojený nebo chybí oprávnění ke snímání | „QLab neběží“, u snímku placeholder |
| 404 | JSON | neexistující cesta | chyba v kódu |
| 405 | JSON | jiná metoda než GET | chyba v kódu |

Timeout požadavku nastav na ~5 s. Offline stav je běžný (mimo promítání bývá Mac vypnutý), nesmí shodit stránku.

## Jak to používat ve vizuálu

1. **Backend dělá proxy s cache:** v my.irmf.cz vytvoř serverový endpoint (např. `GET /api/qlab/status`), který jednou za 1–2 s stáhne `https://qlab.irmf.cz/status`, výsledek drží v paměti a všem návštěvníkům vrací tu kopii. **Nevolat QLab API zvlášť pro každého návštěvníka.** Frontend se ptá jen svého backendu.
2. **Frontend polluje vlastní backend** každé 1–2 s (nebo backend pushuje přes SSE/WebSocket, pokud je to v projektu zavedené).
3. **Plynulý progress bar:** mezi dotazy dopočítávej čas lokálně: `elapsed + (now - fetchedAt)`, pokud `paused === false`. Při každé nové odpovědi se srovnej se skutečnou hodnotou.
4. **`/cuelists`** načti zvlášť a zřídka (při startu, pak třeba 1× za minutu). Podle `uniqueID` z `running` zvýrazni, která cue v seznamu právě běží, a co bude další (následující položka ve stejném cue listu).
5. **Snímek** stahuje backend jednou za 10 s (jen když je `state === "ok"` a něco běží, jinak stačí jednou za minutu), drží poslední úspěšný JPEG v paměti a vrací ho na vlastním endpointu (např. `GET /api/qlab/snapshot.jpg`) s `Content-Type: image/jpeg` a `Cache-Control: no-store`. Frontend obnovuje `<img>` každých 10 s s parametrem proti cache (`?t=<timestamp>`). Když snímek není k dispozici, zobraz placeholder.
6. Proxy endpoint má klientovi vracet jen data, která vizuál potřebuje. Nikdy ne hlavičky, token ani `permissions`.

## Příklad serverového kódu (Node / TypeScript)

Přizpůsob frameworku a jazyku, který my.irmf.cz používá. Princip zůstává stejný.

```ts
type RunningCue = {
  uniqueID: string;
  number: string;
  name: string;
  type: string;
  paused: boolean;
  elapsed: number | null;
  duration: number | null;
};

type QLabStatus = {
  workspace: { name: string; uniqueID: string };
  permissions: string;
  running: RunningCue[];
  time: string;
};

type Snapshot =
  | { state: "ok"; fetchedAt: number; workspace: string; running: RunningCue[] }
  | { state: "offline" | "qlab_down" | "error"; fetchedAt: number };

let cache: Snapshot | null = null;

async function fetchQLab(path: string): Promise<Response> {
  return fetch(`${process.env.QLAB_API_URL}${path}`, {
    headers: {
      "CF-Access-Client-Id": process.env.QLAB_CF_CLIENT_ID!,
      "CF-Access-Client-Secret": process.env.QLAB_CF_CLIENT_SECRET!,
    },
    signal: AbortSignal.timeout(5000),
  });
}

async function refresh(): Promise<void> {
  const fetchedAt = Date.now();
  try {
    const res = await fetchQLab("/status");
    const isJson = res.headers.get("content-type")?.includes("application/json");
    if (res.ok && isJson) {
      const data = (await res.json()) as QLabStatus;
      cache = { state: "ok", fetchedAt, workspace: data.workspace.name, running: data.running };
    } else if (res.status === 503 && isJson) {
      cache = { state: "qlab_down", fetchedAt };
    } else if (res.status === 502 || res.status === 530) {
      cache = { state: "offline", fetchedAt };
    } else {
      console.error("QLab API", res.status);   // 403 = špatný token
      cache = { state: "error", fetchedAt };
    }
  } catch {
    cache = { state: "offline", fetchedAt };  // timeout / síť
  }
}

setInterval(refresh, 1500);
refresh();

// GET /api/qlab/status  ->  return cache

let snapshot: { fetchedAt: number; jpeg: Buffer } | null = null;

async function refreshSnapshot(): Promise<void> {
  try {
    const res = await fetchQLab("/snapshot.jpg");
    if (res.ok && res.headers.get("content-type")?.startsWith("image/jpeg")) {
      snapshot = { fetchedAt: Date.now(), jpeg: Buffer.from(await res.arrayBuffer()) };
    }
    // jinak ponech poslední úspěšný snímek; podle fetchedAt ho UI může označit jako starý
  } catch {
    // offline – stejné jako výše
  }
}

setInterval(refreshSnapshot, 10_000);
refreshSnapshot();

// GET /api/qlab/snapshot.jpg  ->  snapshot.jpeg (image/jpeg, Cache-Control: no-store), nebo 404 když je null
```

## Co nedělat

- Nevolat `qlab.irmf.cz` z prohlížeče a neposílat service token na klienta.
- Nepoužívat jiné metody než GET ani jiné cesty, nic dalšího neexistuje. API nikdy nebude umět QLab ovládat.
- Nepollovat rychleji než 1× za sekundu. Bridge stejně drží odpovědi 0,5 s v cache.
- Nestahovat `/snapshot.jpg` častěji než jednou za 10 s. Nový snímek stejně nevznikne a snímání běží na promítacím Macu.
- Nespoléhat na pořadí položek v `running`.
- Nepředpokládat, že `number`, `duration` nebo `elapsed` jsou vždy vyplněné.
