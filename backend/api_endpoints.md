# 🚀 Guide des API & WebSockets - Brokex Unified Backend

Ce document répertorie tous les endpoints HTTP et les flux WebSocket disponibles sur le serveur unifié de **Brokex Keeper & Chart** (qui tourne par défaut sur `http://localhost:3000`).

> [!NOTE]
> Le serveur supporte désormais en parallèle les réseaux **Testnet** et **Mainnet**. Pour chaque endpoint listé ci-dessous (sauf mention contraire), vous pouvez spécifier le réseau via le paramètre de requête `?network=mainnet` ou `?network=testnet` (valeur par défaut : `testnet`).

---

## 📡 1. Endpoints HTTP (API REST)

### 🏥 Diagnostic & Statut
#### `GET /health`
* **Description** : Retourne l'état de santé du backend, l'état de chargement du Wallet Signer et les adresses des smart contracts pour les configurations **Testnet** et **Mainnet** séparément.
* **Exemple de réponse** :
  ```json
  {
    "status": "OK",
    "timestamp": "2026-05-27T20:30:15.123Z",
    "testnet": {
      "RPC_URL": "https://atlantic.dplabs-internal.com",
      "WS_URL": "wss://atlantic.dplabs-internal.com",
      "CORE_ADDRESS": "0x302d139487Dcb7bd0Fa3466aF51049a70EAF4353",
      "LENS_ADDRESS": "0xD9B592d2Cb993dFcC04D893DE3e5c322bB626f84",
      "SIGNER_LOADED": true
    },
    "mainnet": {
      "configured": true,
      "RPC_URL": "https://rpc.mainnet.example.com",
      "WS_URL": "wss://rpc.mainnet.example.com/ws",
      "CORE_ADDRESS": "0x1234...",
      "LENS_ADDRESS": "0x5678...",
      "SIGNER_LOADED": true
    }
  }
  ```

---

### 📊 Données de Marché & Graphiques
#### `GET /candles`
* **Description** : Fournit des bougies historiques (OHLCV) pour les graphiques TradingView, lues sur disque et synchronisées avec Pyth.
* **Paramètres de requête** :
  * `symbol` (Requis) : Ex: `Metal.XAU/USD`
  * `timeframe` (Requis) : `5`, `15`, `30`, `60` (1h), `240` (4h), `1440` (1d) ou `1` (1m)
  * `days` (Optionnel) : Nombre de jours d'historique (Défaut: `7`, Max: `365`)
* **Exemple de requête** : `GET /candles?symbol=Metal.XAU/USD&timeframe=15&days=3`
* **Exemple de réponse** :
  ```json
  {
    "symbol": "Metal.XAU/USD",
    "timeframe": "15",
    "requestedDays": 3,
    "count": 288,
    "data": [
      {
        "time": 1716834000,
        "open": 2345.5,
        "high": 2348.2,
        "low": 2344.1,
        "close": 2347.8,
        "volume": 1204.5
      }
    ]
  }
  ```

#### `GET /market-summary`
* **Description** : Retourne un résumé du marché avec le prix actuel, les variations sur 1 heure, 24 heures, 7 jours, et une sparkline échantillonnée (120 points).
* **Exemple de réponse** :
  ```json
  [
    {
      "symbol": "Metal.XAU/USD",
      "current_price": 2350.45,
      "hour_price_diff_decimal": 0.0012,
      "day_price_diff_decimal": -0.0045,
      "week_price_diff_decimal": 0.015,
      "sparkline": [2340.5, 2342.1, 2341.0, 2350.45]
    }
  ]
  ```

#### `GET /price-differences`
* **Description** : Retourne les price differences filtrées de Pyth (mise à jour horaire en arrière-plan et persistée en local dans un fichier) pour la liste spécifique d'actifs configurés.
* **Actifs inclus** :
  * `Metal.XAU/USD`, `Crypto.BTC/USD`, `Crypto.ETH/USD`, `Crypto.SOL/USD`, `Metal.XAG/USD`, `Commodities.USOILSPOT`, `FX.EUR/USD`, `FX.GBP/USD`, `FX.USD/JPY`, `Equity.US.AAPL/USD`, `Equity.US.TSLA/USD`, `Equity.US.GOOG/USD`, `Equity.US.MSFT/USD`, `Equity.US.AMZN/USD`
* **Exemple de réponse** :
  ```json
  [
    {
      "symbol": "Metal.XAU/USD",
      "hour_price_diff_decimal": 0.00014,
      "day_price_diff_decimal": -0.0392,
      "week_price_diff_decimal": -0.0927,
      "sparkline": [2350.4, 2348.1, 2352.0, 2350.65]
    },
    {
      "symbol": "Crypto.BTC/USD",
      "hour_price_diff_decimal": -0.0015,
      "day_price_diff_decimal": 0.024,
      "week_price_diff_decimal": 0.087,
      "sparkline": [67200.5, 67450.0, 68100.2]
    }
  ]
  ```

---

### 🛡️ Supra Oracle Proofs
#### `GET /proof`
* **Description** : Système ultra-rapide de récupération de pull proof Supra DORA (avec bascule automatique RPC/REST en cas de panne).
* **Gestion du Cache & Mémoire (Garbage Collection)** :
  * **Partage (< 1 seconde)** : Si plusieurs requêtes arrivent dans un intervalle de moins de 1 seconde, la même proof est renvoyée instantanément sans surcharger le RPC.
  * **Libération Active** : Au bout d'exactement 1 seconde, la proof est **activement supprimée de la mémoire vive** (`setTimeout`) pour garantir une empreinte mémoire de 0.
* **Paramètres de requête** :
  * `pairs` (Requis) : Index de paires séparés par une virgule (Ex: `5500` pour XAU/USD).
  * `network` (Optionnel) : `'testnet'` ou `'mainnet'` (Défaut: `'testnet'`).
* **Exemple de requête** : `GET /proof?pairs=5500&network=mainnet`
* **Exemple de réponse** :
  ```json
  {
    "proof": "0x01000b... (hex bytes de la proof oracle)"
  }
  ```

---

### 🔑 Signatures & KMS Proofs
#### `GET /kms-proof`
* **Description** : Génère et signe en direct une proof KMS/Risk à la volée en utilisant le même algorithme et le même hash que le smart contract BrokexCore pour autoriser l'exécution des ordres.
* **Paramètres de requête** :
  * `network` (Optionnel) : `'testnet'` ou `'mainnet'` (Défaut: `'testnet'`).
* **Exemple de requête** : `GET /kms-proof?network=mainnet`
* **Exemple de réponse** :
  ```json
  {
    "signer": "0xca30CD2760E48af1Be32C8420e71803DA6735142",
    "maxOILong": "1000000000000000",
    "maxOIShort": "1000000000000000",
    "alphaLock": "1000000",
    "spreadLong": "1000",
    "spreadShort": "1000",
    "expiry": 1716837600,
    "signature": "0x8b5c... (signature ECDSA)"
  }
  ```

---

### 💼 Statistiques du Protocole & Trades
#### `GET /trades/:address`
* **Description** : Récupère tous les trades (actifs et fermés) associés à une adresse Ethereum spécifique (insensible à la casse) depuis la base de données.
* **Paramètres de requête** :
  * `network` (Optionnel) : `'testnet'` ou `'mainnet'` (Défaut: `'testnet'`).
* **Exemple de requête** : `GET /trades/0xca30cd2760e48af1be32c8420e71803da6735142?network=mainnet`
* **Exemple de réponse** :
  ```json
  [
    {
      "id": "12",
      "trader": "0xca30cd2760e48af1be32c8420e71803da6735142",
      "state": 1,
      "direction": 1,
      "openPrice": "2350450000",
      "openInterest": "5000000000",
      "leverage": "20",
      "liqPrice": "2245000000",
      "stopLoss": "2300000000",
      "takeProfit": "2450000000",
      "openTimestamp": "1716834000"
    }
  ]
  ```

#### `GET /stats/volume`
* **Description** : Fournit des indicateurs analytiques globales sur le protocole (volume d'échange sur 24 heures, 7 jours, total cumulé et effets de levier moyens).
* **Paramètres de requête** :
  * `network` (Optionnel) : `'testnet'` ou `'mainnet'` (Défaut: `'testnet'`).
* **Exemple de requête** : `GET /stats/volume?network=mainnet`
* **Exemple de réponse** :
  ```json
  {
    "volume24h": {
      "raw": "15000000000",
      "formatted": "15000.00"
    },
    "volume7d": {
      "raw": "105000000000",
      "formatted": "105000.00"
    },
    "allTimeVolume": {
      "raw": "5200000000000",
      "formatted": "5200000.00"
    },
    "avgLeverageOpen": "18.50",
    "avgLeverageHistorical": "14.25",
    "timestamp": 1716835000
  }
  ```

---

## 🔌 2. Flux WebSockets (Temps Réel)

Le serveur unifié expose plusieurs chemins (pathnames) sur son port WebSocket `3000` :

### 🕯️ 1. Stream Pyth Live (TradingView)
* **URL** : `ws://localhost:3000/` ou `ws://localhost:3000/ws/pyth`
* **Description** : Diffuse en temps réel les ticks de prix Pyth pour alimenter instantanément le graphique TradingView (bougies temps réel).
* **Exemple de message reçu** :
  ```json
  {
    "id": "Metal.XAU/USD",
    "p": 2350.65,
    "t": 1716835001,
    "f": "t",
    "s": 0
  }
  ```

### 📈 2. Stream Supra Prix Général
* **URL** : `ws://localhost:3000/ws/prices`
* **Description** : Envoie un snapshot complet de tous les instruments Supra abonnés, puis diffuse des mises à jour régulières toutes les secondes.
* **Format des données** : Snapshot JSON contenant toutes les paires avec leurs données de variation de prix sur 24h.

### 🥇 3. Stream Supra Prix dédié à l'Or
* **URL** : `ws://localhost:3000/ws/gold` ou `ws://localhost:3000/ws/xau`
* **Description** : Identique au flux général, mais filtré pour n'envoyer **que le prix de l'Or (XAU/USD)**, réduisant drastiquement le trafic pour le terminal de trading Or.
