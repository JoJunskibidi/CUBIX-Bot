```javascript
const express = require("express");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CUBIX CITY</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: Arial, sans-serif;
            background: #111827;
            color: white;
            display: flex;
            justify-content: center;
        }

        .game {
            width: 100%;
            max-width: 500px;
            min-height: 100vh;
            padding: 25px;
            background: #1f2937;
        }

        h1 {
            text-align: center;
        }

        .stats {
            background: #111827;
            border-radius: 15px;
            padding: 18px;
            margin: 20px 0;
            text-align: center;
            line-height: 1.8;
        }

        .menu {
            display: grid;
            gap: 12px;
        }

        button {
            width: 100%;
            border: none;
            border-radius: 12px;
            padding: 17px;
            font-size: 17px;
            cursor: pointer;
            background: #374151;
            color: white;
        }

        button:hover {
            background: #4b5563;
        }

        .content {
            margin-top: 20px;
            background: #111827;
            padding: 20px;
            border-radius: 15px;
        }

        .job {
            padding: 15px;
            margin: 10px 0;
            background: #374151;
            border-radius: 10px;
        }
    </style>
</head>

<body>

<div class="game">

    <h1>🎮 CUBIX CITY</h1>

    <div class="stats">
        💰 <span id="coins">250</span> Coins<br>
        ⭐ Level <span id="level">1</span><br>
        ⚡ XP: <span id="xp">0</span> / 100
    </div>

    <div class="menu">
        <button onclick="showJobs()">💼 Jobs</button>
        <button onclick="showShop()">🏪 Shop</button>
        <button onclick="daily()">🎁 Daily Reward</button>
        <button onclick="profile()">👤 Profil</button>
    </div>

    <div id="content" class="content">
        <h2>Willkommen! 👋</h2>
        <p>Wähle eine Aktion aus dem Menü.</p>
    </div>

</div>

<script>

let coins = 250;
let xp = 0;
let level = 1;

function updateStats() {
    document.getElementById("coins").textContent = coins;
    document.getElementById("xp").textContent = xp;
    document.getElementById("level").textContent = level;
}

function addXP(amount) {
    xp += amount;

    if (xp >= 100) {
        xp -= 100;
        level++;

        alert("🎉 Level Up! Du bist jetzt Level " + level);
    }

    updateStats();
}

function showJobs() {
    document.getElementById("content").innerHTML = `
        <h2>💼 Jobs</h2>

        <div class="job">
            🧹 Müll sammeln<br>
            💰 +20 Coins<br><br>
            <button onclick="work(20, 10)">Arbeiten</button>
        </div>

        <div class="job">
            🍕 Pizza liefern<br>
            💰 +50 Coins<br><br>
            <button onclick="work(50, 25)">Arbeiten</button>
        </div>

        <div class="job">
            🚕 Taxi fahren<br>
            💰 +100 Coins<br><br>
            <button onclick="work(100, 50)">Arbeiten</button>
        </div>
    `;
}

function work(money, experience) {
    coins += money;
    addXP(experience);

    alert("💼 Job erledigt! +" + money + " Coins");
    updateStats();
}

function showShop() {
    document.getElementById("content").innerHTML = `
        <h2>🏪 Shop</h2>

        <div class="job">
            🥤 Energy Drink<br>
            💰 50 Coins<br><br>
            <button onclick="buy(50, 'Energy Drink')">Kaufen</button>
        </div>

        <div class="job">
            🎧 Kopfhörer<br>
            💰 150 Coins<br><br>
            <button onclick="buy(150, 'Kopfhörer')">Kaufen</button>
        </div>
    `;
}

function buy(price, item) {
    if (coins < price) {
        alert("❌ Du hast nicht genug Coins!");
        return;
    }

    coins -= price;

    alert("✅ Du hast " + item + " gekauft!");
    updateStats();
}

function daily() {
    coins += 100;
    addXP(20);

    alert("🎁 Daily Reward: +100 Coins!");
    updateStats();
}

function profile() {
    document.getElementById("content").innerHTML = `
        <h2>👤 Dein Profil</h2>

        <p>💰 Coins: ${coins}</p>
        <p>⭐ Level: ${level}</p>
        <p>⚡ XP: ${xp} / 100</p>
    `;
}

</script>

</body>
</html>
    `);
});

app.get("/webhook", (req, res) => {
    res.send("Webhook erreichbar!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("CUBIX läuft auf Port " + PORT);
});
```
