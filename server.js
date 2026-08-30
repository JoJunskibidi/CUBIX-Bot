const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "294140";
const DB_FILE = path.join(__dirname, "cubix-data.json");

const DAY = 86400000;
const JOB_INACTIVITY_LIMIT = 7 * DAY;

let db = {
    players: {},
    sessions: {},
    stocks: {
        CUBX: {
            name: "Cubix Corp",
            price: 100,
            history: [100]
        },
        NRGY: {
            name: "Energy Labs",
            price: 150,
            history: [150]
        },
        GAME: {
            name: "GameZone",
            price: 80,
            history: [80]
        },
        CITY: {
            name: "CityWorks",
            price: 220,
            history: [220]
        }
    }
};

try {
    if (fs.existsSync(DB_FILE)) {
        db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    }
} catch {
    console.log("Neue Datenbank wird erstellt.");
}

db.players ||= {};
db.sessions ||= {};
db.stocks ||= {};

function saveDB() {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(db, null, 2)
    );
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function clean() {
    const now = Date.now();

    for (const [token, session] of Object.entries(db.sessions)) {
        if (now - session.createdAt > 30 * DAY) {
            delete db.sessions[token];
        }
    }

    for (const player of Object.values(db.players)) {
        normalizePlayer(player);

        if (
            player.online &&
            now - player.lastSeen > 90000
        ) {
            player.online = false;
        }

        if (
            player.activeJob &&
            player.lastWorkedAt &&
            now - player.lastWorkedAt > JOB_INACTIVITY_LIMIT
        ) {
            player.activeJob = null;
            player.jobFired = true;
        }
    }
}

function normalizePlayer(p) {
    p.coins = Number.isFinite(p.coins) ? p.coins : 250;
    p.xp = Number.isFinite(p.xp) ? p.xp : 0;
    p.level = Number.isFinite(p.level) ? p.level : 1;

    p.energy = Number.isFinite(p.energy)
        ? Math.max(0, Math.min(100, p.energy))
        : 100;

    p.happiness = Number.isFinite(p.happiness)
        ? Math.max(0, Math.min(100, p.happiness))
        : 70;

    p.inventory ||= [];
    p.equipped ||= [];
    p.jobs ||= {};

    p.activeJob ||= null;
    p.lastWorkedAt ||= 0;
    p.jobFired ||= false;

    p.restsToday ||= 0;
    p.freeTimeToday ||= 0;
    p.lastActionDay ||= today();

    p.streak ||= 0;
    p.lastDaily ||= null;

    p.friends ||= [];
    p.gifts ||= [];

    p.bank ||= 0;
    p.exchange ||= 0;

    p.boostUntil ||= 0;
    p.feePassUntil ||= 0;

    p.portfolio ||= {};

    p.miner ||= null;
}

function currentPlayer(req) {
    const token =
        req.headers.authorization?.replace(
            /^Bearer\s+/i,
            ""
        );

    if (!token || !db.sessions[token]) {
        return null;
    }

    const username =
        db.sessions[token].username;

    const p = db.players[username];

    if (!p) return null;

    normalizePlayer(p);

    p.lastSeen = Date.now();
    p.online = true;

    return p;
}

function requirePlayer(req, res) {
    const p = currentPlayer(req);

    if (!p) {
        res.status(401).json({
            success: false,
            error: "Nicht eingeloggt."
        });

        return null;
    }

    return p;
}

function xpNeeded(p) {
    return 100 + (p.level - 1) * 50;
}

function addXP(p, amount) {
    p.xp += Math.max(
        0,
        Math.floor(amount)
    );

    while (p.xp >= xpNeeded(p)) {
        p.xp -= xpNeeded(p);
        p.level++;
    }
}

function resetDaily(p) {
    if (p.lastActionDay !== today()) {
        p.lastActionDay = today();
        p.restsToday = 0;
        p.freeTimeToday = 0;
    }
}

const jobs = [
    {
        id: "trash",
        name: "🧹 Müll sammeln",
        reward: 25,
        xp: 10,
        energy: 12,
        happiness: 3,
        cooldown: 60000
    },
    {
        id: "pizza",
        name: "🍕 Pizza liefern",
        reward: 60,
        xp: 25,
        energy: 20,
        happiness: 5,
        cooldown: 180000
    },
    {
        id: "taxi",
        name: "🚕 Taxi fahren",
        reward: 120,
        xp: 45,
        energy: 30,
        happiness: 7,
        cooldown: 420000
    },
    {
        id: "code",
        name: "💻 Programmieren",
        reward: 200,
        xp: 70,
        energy: 40,
        happiness: 10,
        cooldown: 720000
    }
];

const shop = {
    "🥤 Energy Drink": {
        price: 50,
        uses: 3,
        type: "energy",
        value: 25,
        text: "+25 Energie"
    },

    "☕ Kaffee": {
        price: 80,
        uses: 4,
        type: "energy",
        value: 15,
        text: "+15 Energie"
    },

    "🎧 Kopfhörer": {
        price: 150,
        uses: 10,
        type: "work",
        text: "+10% Job-Einnahmen"
    },

    "👟 Arbeitsschuhe": {
        price: 350,
        uses: 12,
        type: "work",
        text: "-3 Energie pro Job"
    },

    "🚲 Fahrrad": {
        price: 500,
        uses: 10,
        type: "work",
        text: "-5 Energie pro Job"
    },

    "🎮 Controller": {
        price: 300,
        uses: 8,
        type: "free",
        text: "+15 Glück durch Freizeit"
    },

    "📱 Smartphone": {
        price: 250,
        uses: 10,
        type: "free",
        text: "+8 Glück durch Freizeit"
    },

    "⚡ Einnahmen-Boost": {
        price: 5000,
        uses: 1,
        type: "boost",
        text: "Verdoppelt Einnahmen für 10 Stunden"
    },

    "🛡️ Fee Pass": {
        price: 7500,
        uses: 1,
        type: "fees",
        text: "Keine Bank-/Börsengebühren für 24 Stunden"
    }
};

function consume(p, name) {
    const i = p.inventory.findIndex(
        x =>
            x.name === name &&
            x.uses > 0
    );

    if (i === -1) return false;

    p.inventory[i].uses--;

    if (p.inventory[i].uses <= 0) {
        p.inventory.splice(i, 1);

        p.equipped =
            p.equipped.filter(
                x => x !== name
            );
    }

    return true;
}

function incomeMultiplier(p) {
    return p.boostUntil > Date.now()
        ? 2
        : 1;
}

function jobEnergyCost(p, job) {
    let cost = job.energy;

    if (p.equipped.includes("🚲 Fahrrad"))
        cost -= 5;

    if (p.equipped.includes("👟 Arbeitsschuhe"))
        cost -= 3;

    return Math.max(5, cost);
}

/* =========================
   LOGIN / USERNAME
========================= */

app.post("/api/register", (req, res) => {
    clean();

    const username =
        String(req.body.username || "").trim();

    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
        return res.status(400).json({
            success: false,
            error:
                "Username muss 3-16 Zeichen haben und darf nur Buchstaben, Zahlen und _ enthalten."
        });
    }

    if (db.players[username]) {
        return res.status(409).json({
            success: false,
            error: "Dieser Username ist bereits vergeben."
        });
    }

    const p = {
        username,
        coins: 250,
        xp: 0,
        level: 1,
        energy: 100,
        happiness: 70,
        inventory: [],
        equipped: [],
        jobs: {},
        activeJob: null,
        lastWorkedAt: 0,
        jobFired: false,
        restsToday: 0,
        freeTimeToday: 0,
        lastActionDay: today(),
        streak: 0,
        lastDaily: null,
        friends: [],
        gifts: [],
        bank: 0,
        exchange: 0,
        boostUntil: 0,
        feePassUntil: 0,
        portfolio: {},
        miner: null,
        online: true,
        lastSeen: Date.now()
    };

    db.players[username] = p;

    const token = crypto.randomBytes(32).toString("hex");

    db.sessions[token] = {
        username,
        createdAt: Date.now()
    };

    saveDB();

    res.json({
        success: true,
        token,
        player: p
    });
});

app.post("/api/login", (req, res) => {
    clean();

    const username =
        String(req.body.username || "").trim();

    const p = db.players[username];

    if (!p) {
        return res.status(404).json({
            success: false,
            error: "Spieler nicht gefunden."
        });
    }

    normalizePlayer(p);

    const token = crypto.randomBytes(32).toString("hex");

    db.sessions[token] = {
        username,
        createdAt: Date.now()
    };

    p.online = true;
    p.lastSeen = Date.now();

    saveDB();

    res.json({
        success: true,
        token,
        player: p
    });
});

app.get("/api/me", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    resetDaily(p);
    clean();

    res.json({
        success: true,
        player: p,
        xpNeeded: xpNeeded(p),
        jobs,
        shop
    });
});

app.post("/api/heartbeat", (req, res) => {
    const p = currentPlayer(req);

    if (!p) {
        return res.status(401).json({
            success: false
        });
    }

    p.lastSeen = Date.now();
    p.online = true;

    clean();
    saveDB();

    res.json({
        success: true,
        online: Object.values(db.players)
            .filter(x => x.online).length
    });
});

app.get("/api/online", (req, res) => {
    clean();

    res.json({
        online:
            Object.values(db.players)
                .filter(x => x.online).length
    });
});

/* =========================
   JOBS
========================= */

app.post("/api/job/apply", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const job = jobs.find(
        x => x.id === req.body.jobId
    );

    if (!job) {
        return res.status(400).json({
            success: false,
            error: "Job nicht gefunden."
        });
    }

    if (p.activeJob) {
        return res.status(400).json({
            success: false,
            error:
                "Du hast bereits einen Job."
        });
    }

    p.activeJob = job.id;
    p.jobFired = false;
    p.lastWorkedAt = Date.now();

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

app.post("/api/job/work", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    resetDaily(p);

    if (!p.activeJob) {
        return res.status(400).json({
            success: false,
            error:
                "Du hast keinen Job. Bewirb dich zuerst."
        });
    }

    const job = jobs.find(
        x => x.id === p.activeJob
    );

    if (!job) {
        p.activeJob = null;

        return res.status(400).json({
            success: false,
            error: "Job nicht verfügbar."
        });
    }

    if (
        p.lastWorkedAt &&
        Date.now() - p.lastWorkedAt >
        JOB_INACTIVITY_LIMIT
    ) {
        p.activeJob = null;
        p.jobFired = true;

        saveDB();

        return res.status(400).json({
            success: false,
            error:
                "Du wurdest wegen zu langer Inaktivität gefeuert."
        });
    }

    const last =
        p.jobs[job.id] || 0;

    const remaining =
        job.cooldown -
        (Date.now() - last);

    if (remaining > 0) {
        return res.status(400).json({
            success: false,
            error:
                `Noch ${Math.ceil(remaining / 1000)} Sekunden Cooldown.`
        });
    }

    const energyCost =
        jobEnergyCost(p, job);

    if (p.energy < energyCost) {
        return res.status(400).json({
            success: false,
            error: "Nicht genug Energie."
        });
    }

    let reward =
        Math.round(
            job.reward *
            incomeMultiplier(p)
        );

    if (p.equipped.includes("🎧 Kopfhörer")) {
        reward =
            Math.round(reward * 1.10);
        consume(p, "🎧 Kopfhörer");
    }

    if (p.equipped.includes("🚲 Fahrrad"))
        consume(p, "🚲 Fahrrad");

    if (p.equipped.includes("👟 Arbeitsschuhe"))
        consume(p, "👟 Arbeitsschuhe");

    p.energy -= energyCost;

    p.happiness =
        Math.max(
            0,
            p.happiness - job.happiness
        );

    p.coins += reward;

    addXP(p, job.xp);

    p.jobs[job.id] = Date.now();
    p.lastWorkedAt = Date.now();
    p.jobFired = false;

    saveDB();

    res.json({
        success: true,
        reward,
        xp: job.xp,
        player: p
    });
});

/* =========================
   REST
========================= */

app.post("/api/rest", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    resetDaily(p);

    if (p.restsToday >= 3) {
        return res.status(400).json({
            success: false,
            error:
                "Du hast heute bereits 3 Ruhepausen benutzt."
        });
    }

    if (p.energy >= 100) {
        return res.status(400).json({
            success: false,
            error:
                "Du bist bereits vollständig erholt."
        });
    }

    let amount = 30;

    if (p.equipped.includes("🏠 Kleine Wohnung")) {
        amount += 15;
        consume(p, "🏠 Kleine Wohnung");
    }

    p.energy =
        Math.min(
            100,
            p.energy + amount
        );

    p.happiness =
        Math.min(
            100,
            p.happiness + 3
        );

    p.restsToday++;

    saveDB();

    res.json({
        success: true,
        energy: amount,
        player: p
    });
});

/* =========================
   FREIZEIT
========================= */

app.post("/api/freetime", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    resetDaily(p);

    if (p.freeTimeToday >= 5) {
        return res.status(400).json({
            success: false,
            error:
                "Dein Freizeitlimit für heute ist erreicht."
        });
    }

    if (p.energy < 15) {
        return res.status(400).json({
            success: false,
            error:
                "Du brauchst mindestens 15 Energie."
        });
    }

    let happiness = 12;

    if (p.equipped.includes("🎮 Controller")) {
        happiness += 15;
        consume(p, "🎮 Controller");
    }

    if (p.equipped.includes("📱 Smartphone")) {
        happiness += 8;
        consume(p, "📱 Smartphone");
    }

    p.energy -= 15;

    p.happiness =
        Math.min(
            100,
            p.happiness + happiness
        );

    p.freeTimeToday++;

    addXP(p, 5);

    saveDB();

    res.json({
        success: true,
        happiness,
        player: p
    });
});

/* =========================
   SHOP
========================= */

app.post("/api/shop/buy", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const name = req.body.name;
    const item = shop[name];

    if (!item) {
        return res.status(404).json({
            success: false,
            error: "Item nicht gefunden."
        });
    }

    if (p.coins < item.price) {
        return res.status(400).json({
            success: false,
            error: "Nicht genug Coins."
        });
    }

    p.coins -= item.price;

    if (item.type === "boost") {
        p.boostUntil =
            Math.max(
                Date.now(),
                p.boostUntil
            ) + 10 * 60 * 60 * 1000;
    } else if (item.type === "fees") {
        p.feePassUntil =
            Math.max(
                Date.now(),
                p.feePassUntil
            ) + 24 * 60 * 60 * 1000;
    } else {
        p.inventory.push({
            name,
            uses: item.uses
        });
    }

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

app.post("/api/item/equip", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const name = req.body.name;
    const item = shop[name];

    if (!item || item.type === "energy") {
        return res.status(400).json({
            success: false,
            error:
                "Dieses Item kann nicht ausgerüstet werden."
        });
    }

    if (
        !p.inventory.some(
            x =>
                x.name === name &&
                x.uses > 0
        )
    ) {
        return res.status(400).json({
            success: false,
            error: "Item nicht im Inventar."
        });
    }

    if (!p.equipped.includes(name)) {
        p.equipped.push(name);
    }

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

app.post("/api/item/unequip", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    p.equipped =
        p.equipped.filter(
            x => x !== req.body.name
        );

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

app.post("/api/item/use", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const name = req.body.name;
    const item = shop[name];

    if (!item || item.type !== "energy") {
        return res.status(400).json({
            success: false,
            error: "Item kann nicht benutzt werden."
        });
    }

    if (p.energy >= 100) {
        return res.status(400).json({
            success: false,
            error:
                "Deine Energie ist bereits voll."
        });
    }

    if (!consume(p, name)) {
        return res.status(400).json({
            success: false,
            error: "Item nicht vorhanden."
        });
    }

    p.energy =
        Math.min(
            100,
            p.energy + item.value
        );

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

/* =========================
   DAILY
========================= */

app.post("/api/daily", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const d = today();

    if (p.lastDaily === d) {
        return res.status(400).json({
            success: false,
            error:
                "Daily bereits abgeholt."
        });
    }

    p.lastDaily = d;
    p.streak++;

    const reward =
        100 +
        Math.min(
            100,
            (p.streak - 1) * 10
        );

    p.coins += reward;

    addXP(p, 20);

    saveDB();

    res.json({
        success: true,
        reward,
        player: p
    });
});

/* =========================
   RANGLISTE
========================= */

app.get("/api/leaderboard", (req, res) => {
    clean();

    const players =
        Object.values(db.players);

    const money =
        [...players]
            .sort((a, b) =>
                b.coins - a.coins
            )
            .slice(0, 20)
            .map((p, i) => ({
                rank: i + 1,
                username: p.username,
                value: p.coins
            }));

    const xp =
        [...players]
            .sort((a, b) => {
                if (b.level !== a.level)
                    return b.level - a.level;

                return b.xp - a.xp;
            })
            .slice(0, 20)
            .map((p, i) => ({
                rank: i + 1,
                username: p.username,
                value: p.xp,
                level: p.level
            }));

    res.json({
        success: true,
        money,
        xp
    });
});

/* =========================
   FREUNDE
========================= */

app.post("/api/friend/add", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const username =
        String(req.body.username || "").trim();

    if (!db.players[username]) {
        return res.status(404).json({
            success: false,
            error: "Spieler nicht gefunden."
        });
    }

    if (username === p.username) {
        return res.status(400).json({
            success: false,
            error:
                "Du kannst dich nicht selbst hinzufügen."
        });
    }

    if (!p.friends.includes(username)) {
        p.friends.push(username);
    }

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

/* =========================
   BANK / BÖRSE
========================= */

function feeFor(p, amount) {
    if (p.feePassUntil > Date.now())
        return 0;

    return Math.max(
        1,
        Math.floor(amount * 0.02)
    );
}

app.post("/api/bank/deposit", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const amount =
        Math.floor(Number(req.body.amount));

    if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > p.coins
    ) {
        return res.status(400).json({
            success: false,
            error: "Ungültiger Betrag."
        });
    }

    const fee = feeFor(p, amount);

    p.coins -= amount;
    p.exchange += amount - fee;

    saveDB();

    res.json({
        success: true,
        fee,
        player: p
    });
});

app.post("/api/bank/withdraw", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const amount =
        Math.floor(Number(req.body.amount));

    if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > p.exchange
    ) {
        return res.status(400).json({
            success: false,
            error: "Ungültiger Betrag."
        });
    }

    const fee = feeFor(p, amount);

    p.exchange -= amount;
    p.coins += amount - fee;

    saveDB();

    res.json({
        success: true,
        fee,
        player: p
    });
});

/* =========================
   STOCKS
========================= */

function updateStocks() {
    for (const stock of Object.values(db.stocks)) {
        const old = stock.price;

        const movement =
            (Math.random() - 0.48) * 0.08;

        let next =
            old * (1 + movement);

        next =
            Math.max(
                10,
                Math.min(
                    100000,
                    next
                )
            );

        stock.price =
            Math.round(next * 100) / 100;

        stock.history ||= [];
        stock.history.push(stock.price);

        if (stock.history.length > 100) {
            stock.history.shift();
        }
    }

    saveDB();
}

setInterval(
    updateStocks,
    60000
);

app.get("/api/stocks", (req, res) => {
    res.json({
        success: true,
        stocks: db.stocks
    });
});

app.post("/api/stock/buy", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const symbol = req.body.symbol;
    const stock = db.stocks[symbol];

    const amount =
        Math.floor(Number(req.body.amount));

    if (
        !stock ||
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        return res.status(400).json({
            success: false,
            error: "Ungültiger Kauf."
        });
    }

    const cost =
        stock.price * amount;

    const fee =
        feeFor(p, cost);

    const total =
        cost + fee;

    if (p.exchange < total) {
        return res.status(400).json({
            success: false,
            error:
                "Nicht genug Börsengeld."
        });
    }

    p.exchange -= total;

    p.portfolio[symbol] ||=
        {
            amount: 0,
            invested: 0
        };

    p.portfolio[symbol].amount += amount;
    p.portfolio[symbol].invested += cost;

    saveDB();

    res.json({
        success: true,
        fee,
        player: p
    });
});

app.post("/api/stock/sell", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    const symbol = req.body.symbol;
    const stock = db.stocks[symbol];

    const amount =
        Math.floor(Number(req.body.amount));

    const holding =
        p.portfolio[symbol];

    if (
        !stock ||
        !holding ||
        amount <= 0 ||
        amount > holding.amount
    ) {
        return res.status(400).json({
            success: false,
            error: "Ungültiger Verkauf."
        });
    }

    const gross =
        stock.price * amount;

    const fee =
        feeFor(p, gross);

    const net =
        gross - fee;

    const avg =
        holding.invested /
        holding.amount;

    holding.invested -=
        avg * amount;

    holding.amount -= amount;

    if (holding.amount <= 0) {
        delete p.portfolio[symbol];
    }

    p.exchange += net;

    saveDB();

    res.json({
        success: true,
        fee,
        profit:
            gross -
            fee -
            avg * amount,
        player: p
    });
});

/* =========================
   MINER
========================= */

function minerData(level) {
    return {
        level,
        hourly:
            Math.round(
                2000 *
                Math.pow(2.2, level - 1)
            ),
        upgrade:
            Math.round(
                10000 *
                Math.pow(2.7, level - 1)
            )
    };
}

app.post("/api/miner/buy", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    if (p.miner) {
        return res.status(400).json({
            success: false,
            error:
                "Du besitzt bereits einen Miner."
        });
    }

    if (p.coins < 10000) {
        return res.status(400).json({
            success: false,
            error:
                "Ein Miner kostet 10.000 Coins."
        });
    }

    p.coins -= 10000;

    p.miner = {
        level: 1,
        produced: 0,
        lastUpdate: Date.now(),
        condition: 100
    };

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

function processMiner(p) {
    if (!p.miner) return;

    const now = Date.now();

    const elapsed =
        Math.max(
            0,
            now - p.miner.lastUpdate
        );

    const hours =
        elapsed / 3600000;

    const data =
        minerData(p.miner.level);

    const conditionMultiplier =
        0.5 +
        p.miner.condition / 200;

    const produced =
        data.hourly *
        hours *
        conditionMultiplier;

    p.miner.produced += produced;

    const damage =
        hours * 1.2;

    p.miner.condition =
        Math.max(
            0,
            p.miner.condition - damage
        );

    p.miner.lastUpdate = now;
}

app.get("/api/miner", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    processMiner(p);

    res.json({
        success: true,
        miner: p.miner
            ? {
                ...p.miner,
                stats:
                    minerData(
                        p.miner.level
                    )
            }
            : null
    });
});

app.post("/api/miner/collect", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    processMiner(p);

    if (!p.miner) {
        return res.status(400).json({
            success: false,
            error: "Kein Miner vorhanden."
        });
    }

    const amount =
        Math.floor(p.miner.produced);

    if (amount <= 0) {
        return res.status(400).json({
            success: false,
            error:
                "Der Miner hat noch nichts produziert."
        });
    }

    p.miner.produced -= amount;

    p.coins +=
        Math.floor(
            amount *
            incomeMultiplier(p)
        );

    saveDB();

    res.json({
        success: true,
        amount,
        player: p
    });
});

app.post("/api/miner/upgrade", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    processMiner(p);

    if (!p.miner) {
        return res.status(400).json({
            success: false,
            error: "Kein Miner vorhanden."
        });
    }

    const data =
        minerData(
            p.miner.level
        );

    if (p.coins < data.upgrade) {
        return res.status(400).json({
            success: false,
            error:
                `Upgrade kostet ${data.upgrade.toLocaleString("de-DE")} Coins.`
        });
    }

    p.coins -= data.upgrade;
    p.miner.level++;

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

app.post("/api/miner/repair", (req, res) => {
    const p = requirePlayer(req, res);
    if (!p) return;

    processMiner(p);

    if (!p.miner) {
        return res.status(400).json({
            success: false,
            error: "Kein Miner vorhanden."
        });
    }

    const missing =
        100 - p.miner.condition;

    if (missing <= 0) {
        return res.status(400).json({
            success: false,
            error: "Miner ist vollständig repariert."
        });
    }

    const cost =
        Math.max(
            50,
            Math.round(
                missing *
                p.miner.level *
                20
            )
        );

    if (p.coins < cost) {
        return res.status(400).json({
            success: false,
            error:
                `Reparatur kostet ${cost.toLocaleString("de-DE")} Coins.`
        });
    }

    p.coins -= cost;
    p.miner.condition = 100;

    saveDB();

    res.json({
        success: true,
        player: p
    });
});

/* =========================
   ADMIN
========================= */

function admin(req, res) {
    if (
        req.body.password !==
        ADMIN_PASSWORD
    ) {
        res.status(401).json({
            success: false,
            error: "Falsches Admin-Passwort."
        });

        return false;
    }

    return true;
}

app.post("/api/admin/login", (req, res) => {
    if (!admin(req, res)) return;

    res.json({
        success: true
    });
});

app.post("/api/admin/stats", (req, res) => {
    if (!admin(req, res)) return;

    clean();

    res.json({
        success: true,
        onlinePlayers:
            Object.values(db.players)
                .filter(p => p.online).length,
        totalPlayers:
            Object.keys(db.players).length
    });
});

app.post("/api/admin/give", (req, res) => {
    if (!admin(req, res)) return;

    const username =
        String(req.body.username || "").trim();

    const amount =
        Math.floor(
            Number(req.body.amount)
        );

    const type = req.body.type;

    const p = db.players[username];

    if (!p) {
        return res.status(404).json({
            success: false,
            error: "Spieler nicht gefunden."
        });
    }

    if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 1000000000
    ) {
        return res.status(400).json({
            success: false,
            error: "Ungültige Menge."
        });
    }

    if (type === "coins") {
        p.coins += amount;
    } else if (type === "xp") {
        addXP(p, amount);
    } else {
        return res.status(400).json({
            success: false,
            error: "Ungültiger Typ."
        });
    }

    saveDB();

    res.json({
        success: true,
        username,
        amount,
        type
    });
});

app.get("/admin", (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );
});

app.use((req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );
});

setInterval(() => {
    clean();
    saveDB();
}, 30000);

app.listen(PORT, () => {
    console.log(
        `🔥 CUBIX CITY läuft auf Port ${PORT}`
    );
});
