```javascript
const express = require("express");

const app = express();

app.get("/", function (req, res) {
    res.send(`
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CUBIX CITY</title>

<style>
body {
    margin: 0;
    font-family: Arial, sans-serif;
    background: #111827;
    color: white;
}

.game {
    max-width: 500px;
    margin: auto;
    padding: 20px;
}

h1 {
    text-align: center;
}

.stats {
    background: #1f2937;
    padding: 20px;
    border-radius: 15px;
    text-align: center;
    line-height: 2;
    margin-bottom: 20px;
}

button {
    width: 100%;
    padding: 16px;
    margin: 6px 0;
    border: 0;
    border-radius: 12px;
    background: #374151;
    color: white;
    font-size: 17px;
}

button:hover {
    background: #4b5563;
}

.content {
    background: #1f2937;
    padding: 20px;
    border-radius: 15px;
    margin-top: 20px;
}

.job {
    background: #374151;
    padding: 15px;
    border-radius: 12px;
    margin: 10px 0;
}
</style>
</head>

<body>

<div class="game">

<h1>🎮 CUBIX CITY</h1>

<div class="stats">
💰 <span id="coins">250</span> Coins<br>
⭐ Level <span id="level">1</span><br>
⚡ XP <span id="xp">0</span> / 100
</div>

<button onclick="jobs()">💼 Jobs</button>
<button onclick="shop()">🏪 Shop</button>
<button onclick="daily()">🎁 Daily Reward</button>
<button onclick="profile()">👤 Profil</button>

<div id="content" class="content">
<h2>Willkommen! 👋</h2>
<p>Wähle eine Aktion.</p>
</div>

</div>

<script>

let coins = 250;
let xp = 0;
let level = 1;

function update() {
    document.getElementById("coins").innerText = coins;
    document.getElementById("xp").innerText = xp;
    document.getElementById("level").innerText = level;
}

function addXP(amount) {
    xp += amount;

    if (xp >= 100) {
        xp -= 100;
        level++;
        alert("🎉 Level Up! Level " + level);
    }

    update();
}

function jobs() {
    document.getElementById("content").innerHTML =
    "<h2>💼 Jobs</h2>" +

    "<div class='job'>🧹 Müll sammeln<br>💰 +20 Coins<br>" +
    "<button onclick='work(20,10)'>Arbeiten</button></div>" +

    "<div class='job'>🍕 Pizza liefern<br>💰 +50 Coins<br>" +
    "<button onclick='work(50,25)'>Arbeiten</button></div>" +

    "<div class='job'>🚕 Taxi fahren<br>💰 +100 Coins<br>" +
    "<button onclick='work(100,50)'>Arbeiten</button></div>";
}

function work(money, experience) {
    coins += money;
    addXP(experience);
    alert("💼 Job erledigt! +" + money + " Coins");
    update();
}

function shop() {
    document.getElementById("content").innerHTML =
    "<h2>🏪 Shop</h2>" +

    "<div class='job'>🥤 Energy Drink<br>💰 50 Coins<br>" +
    "<button onclick='buy(50,\"Energy Drink\")'>Kaufen</button></div>" +

    "<div class='job'>🎧 Kopfhörer<br>💰 150 Coins<br>" +
    "<button onclick='buy(150,\"Kopfhörer\")'>Kaufen</button></div>";
}

function buy(price, item) {
    if (coins < price) {
        alert("❌ Nicht genug Coins!");
        return;
    }

    coins -= price;
    alert("✅ " + item + " gekauft!");
    update();
}

function daily() {
    coins += 100;
    addXP(20);
    alert("🎁 +100 Coins!");
    update();
}

function profile() {
    document.getElementById("content").innerHTML =
    "<h2>👤 Profil</h2>" +
    "<p>💰 Coins: " + coins + "</p>" +
    "<p>⭐ Level: " + level + "</p>" +
    "<p>⚡ XP: " + xp + " / 100</p>";
}

</script>

</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, function () {
    console.log("CUBIX läuft auf Port " + PORT);
});
```
