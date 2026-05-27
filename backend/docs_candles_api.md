# 📊 Documentation Technique de l'API Graphique (Candles)

Cette documentation décrit comment consommer et configurer l'API de graphiques historique (chandelles OHLCV) du serveur **Brokex Keeper & Chart**. 

L'API fournit des données de bougies hautement performantes, lues depuis le disque local (cache optimisé) et synchronisées en tâche de fond avec Pyth Network.

---

## 📡 1. Endpoint Principal : `GET /candles`

Cet endpoint renvoie un tableau de bougies historiques au format standard **OHLCV** (Open, High, Low, Close, Volume), idéal pour être affiché dans des bibliothèques de graphiques comme **TradingView Lightweight Charts** ou **Highcharts**.

### 🔗 URL de l'Endpoint
* **Production** : `https://api.brokex.trade/candles`
* **Local** : `http://localhost:3000/candles`

---

## 🛠️ 2. Paramètres de Requête (Query Parameters)

| Paramètre | Type | Requis / Optionnel | Description | Valeurs possibles |
| :--- | :--- | :--- | :--- | :--- |
| `symbol` | `string` | **Requis** | L'identifiant de l'actif financier. | `Metal.XAU/USD` |
| `timeframe` | `string` | **Requis** | L'intervalle de temps représenté par chaque bougie. | `1`, `5`, `15`, `30`, `60`, `240`, `1440` |
| `days` | `integer` | *Optionnel* | Nombre de jours d'historique à récupérer en partant de maintenant. | De `1` à `365` *(Défaut: 7 jours)* |

### 💡 Exemples de Requêtes :
* **Récupérer 3 jours de bougies de 5 minutes sur l'Or :**
  `GET https://api.brokex.trade/candles?symbol=Metal.XAU/USD&timeframe=5&days=3`
* **Récupérer 30 jours de bougies quotidiennes (1d = 1440 minutes) :**
  `GET https://api.brokex.trade/candles?symbol=Metal.XAU/USD&timeframe=1440&days=30`

---

## 📦 3. Format de la Réponse JSON

La réponse renvoie un objet JSON contenant des métadonnées de la requête et le tableau `data` des bougies triées **par ordre chronologique** (du plus ancien au plus récent) :

```json
{
  "symbol": "Metal.XAU/USD",
  "timeframe": "5",
  "requestedDays": 3,
  "count": 864,
  "data": [
    {
      "time": 1779921300,
      "open": 4457.37,
      "high": 4461.794,
      "low": 4457.367,
      "close": 4461.495,
      "volume": 0
    },
    {
      "time": 1779921600,
      "open": 4461.435,
      "high": 4462.42,
      "low": 4458.496,
      "close": 4458.888,
      "volume": 0
    }
  ]
}
```

### 🔍 Description des Champs de chaque Chandelle :
* **`time`** *(integer)* : Timestamp Unix en **secondes** représentant l'ouverture de la bougie. *(Parfait pour l'intégration TradingView).*
* **`open`** *(number)* : Prix d'ouverture de l'actif au début de la période.
* **`high`** *(number)* : Prix maximum atteint pendant la période.
* **`low`** *(number)* : Prix minimum atteint pendant la période.
* **`close`** *(number)* : Prix de fermeture/dernier prix à la fin de la période.
* **`volume`** *(number)* : Volume (mis par défaut à `0` car les actifs de type CFD/Métaux synthétiques n'ont pas de volume transactionnel standardisé).

---

## ⚙️ 4. Configuration Globale dans le Backend (`backend/config.js`)

Tu peux ajuster le comportement de l'historique directement dans le fichier de configuration de ton backend :

```javascript
module.exports = {
  // Liste des symboles suivis par le backend
  symbols: [
    "Metal.XAU/USD",
  ],

  // 📅 Point de départ historique pour la synchronisation (au premier lancement)
  // Plus cette date est ancienne, plus le serveur mettra de temps à tout synchroniser depuis Pyth.
  historyStartDate: "2025-01-01",

  // ⏱️ Timeframes générées dynamiquement en local par le serveur
  generatedTimeframes: ["5", "15", "30", "60", "240", "1440"],

  // 🛡️ Limites appliquées aux réponses HTTP de l'API /candles
  apiResponse: {
    defaultDays: 7, // Nombre de jours retournés si le paramètre `days` est absent
    maxDays: 365    // Nombre maximum de jours qu'un utilisateur peut demander
  }
}
```

---

## 🎨 5. Exemple d'intégration JavaScript (TradingView Lightweight Charts)

Voici un exemple simple de comment charger ces données dans ton application front-end :

```javascript
import { createChart } from 'lightweight-charts';

// 1. Initialiser le graphique
const chart = createChart(document.getElementById('chart-container'), {
    width: 600,
    height: 300,
});

// 2. Créer la série de chandelles (Candlestick Series)
const candlestickSeries = chart.addCandlestickSeries();

// 3. Récupérer les données depuis ton API de production
async function loadChartData() {
    const symbol = "Metal.XAU/USD";
    const timeframe = "15"; // Bougies de 15 minutes
    const days = 3;         // 3 jours d'historique

    const response = await fetch(`https://api.brokex.trade/candles?symbol=${symbol}&timeframe=${timeframe}&days=${days}`);
    const result = await response.json();

    // 4. Formater les données (les timestamps renvoyés sont déjà en secondes)
    const formattedData = result.data.map(bar => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close
    }));

    // 5. Injecter les données dans le graphique
    candlestickSeries.setData(formattedData);
}

loadChartData();
```
