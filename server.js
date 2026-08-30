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

let db = { players: {}, sessions: {} };

try {
    if (fs.existsSync(DB_FILE)) {
        db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    }
} catch {
    db = { players: {}, sessions: {} };
}

db.players ||= {};
db.sessions ||= {};

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function clean() {
    const now = Date.now();

    for (const [token, session] of Object.entries(db.sessions)) {
        if (now - session.createdAt > 1000 * 60 * 60 * 24 * 30) {
            delete db.sessions[token];
        }
    }

    for (const player of Object.values(db.players)) {
        if (player.online && now - (player.lastSeen || 0) > 90000) {
            player.online = false;
        }
    }
}

function safeUsername(name) {
    return typeof name === "string" &&
        /^[A-Za-z0-9_]{3,16}$/.test(name);
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

    p.workToday ||= 0;
    p.restsToday ||= 0;
    p.freeTimeToday ||= 0;

    p.lastActionDay ||= new Date().toISOString().slice(0, 10);

    p.streak ||= 0;
    p.lastDaily ||= null;

    p.friends ||= [];
    p.gifts ||= [];

    p.bank ||= 0;
    p.exchange ||= 0;

    p.boostUntil ||= 0;
    p.feePassUntil ||= 0;

    p.miner ||= null;

    return p;
}

function currentPlayer(req) {
    const token =
        req.headers.authorization?.replace(/^Bearer\s+/i, "");

    if (!token || !db.sessions[token]) {
        return null;
    }

    const username = db.sessions[token].username;
    const p = db.players[username];

    if (!p) {
        return null;
    }

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
    p.xp += Math.max(0, Math.floor(amount));

    while (p.xp >= xpNeeded(p)) {
        p.xp -= xpNeeded(p);
        p.level++;
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
        type: "consumable",
        effect: "energy",
        value: 25,
        text: "+25 Energie"
    },

    "☕ Kaffee": {
        price: 80,
        uses: 4,
        type: "consumable",
        effect: "energy",
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
        text: "+15 Glück bei Freizeit"
    },

    "📱 Smartphone": {
        price: 250,
        uses: 12,
        type: "free",
        text: "+8 Glück bei Freizeit"
    },

    "💻 Gaming PC": {
        price: 750,
        uses: 8,
        type: "free",
        text: "+20 Glück bei Freizeit"
    },

    "🏠 Kleine Wohnung": {
        price: 1500,
        uses: 10,
        type: "rest",
        text: "+15 Energie beim Ausruhen"
    },

    "🛏️ Bequemes Bett": {
        price: 900,
        uses: 12,
        type: "rest",
        text: "+10 Energie beim Ausruhen"
    }
};

const shopSpecials = {
    "⚡ Einnahmen-Boost": {
        price: 5000,
        text: "10 Stunden: Jobs und Miner produzieren/verdienen doppelt."
    },

    "🧾 Gebührenpass": {
        price: 2500,
        text: "24 Stunden: Keine Gebühren zwischen Konto und Börse."
    }
};

function dailyReset(p) {
    const today =
        new Date().toISOString().slice(0, 10);

    if (p.lastActionDay !== today) {
        p.workToday = 0;
        p.restsToday = 0;
        p.freeTimeToday = 0;
        p.lastActionDay = today;
    }
}

function minerUpgradeCost(level) {
    const costs = [
        10000,
        25000,
        60000,
        140000,
        350000,
        900000,
        2500000,
        10000000,
        45000000
    ];

    return costs[level - 1] || Infinity;
}

function minerRate(level) {
    const rates = [
        2000,
        6000,
        18000,
        50000,
        140000,
        350000,
        800000,
        1600000,
        2800000,
        4400000
    ];

    return rates[
        Math.max(
            0,
            Math.min(9, level - 1)
        )
    ];
}

function minerState(p) {
    if (!p.miner) {
        return null;
    }

    const now = Date.now();

    const elapsed = Math.max(
        0,
        Math.min(
            now - p.miner.lastUpdate,
            24 * 60 * 60 * 1000
        )
    );

    const hours = elapsed / 3600000;

    const condition =
        Math.max(
            0,
            Math.min(100, p.miner.condition)
        );

    const efficiency =
        0.70 +
        0.30 * (condition / 100);

    const boost =
        p.boostUntil > now ? 2 : 1;

    const produced =
        minerRate(p.miner.level) *
        hours *
        efficiency *
        boost;

    p.miner.stored += produced;

    p.miner.condition =
        Math.max(
            0,
            condition - hours / 12
        );

    p.miner.lastUpdate = now;

    return p.miner;
}

function feeFor(amount) {
    return Math.max(
        1,
        Math.floor(amount * 0.02)
    );
}

function publicPlayer(p) {
    return {
        username: p.username,
        coins: Math.floor(p.coins),
        xp: Math.floor(p.xp),
        level: p.level,

        energy: p.energy,
        happiness: p.happiness,

        streak: p.streak,

        inventory: p.inventory,
        equipped: p.equipped,

        workToday: p.workToday,
        restsToday: p.restsToday,
        freeTimeToday: p.freeTimeToday,

        friends: p.friends,

        bank: Math.floor(p.bank),
        exchange: Math.floor(p.exchange),

        boostUntil: p.boostUntil,
        feePassUntil: p.feePassUntil,

        miner: p.miner
            ? {
                level: p.miner.level,
                condition: p.miner.condition,
                stored: Math.floor(p.miner.stored),
                rate: minerRate(p.miner.level),
                upgradeCost:
                    minerUpgradeCost(p.miner.level)
            }
            : null
    };
}

function authToken() {
    return crypto.randomBytes(32).toString("hex");
}

app.post("/api/register", (req, res) => {
    clean();

    const username =
        String(req.body.username || "").trim();

    if (!safeUsername(username)) {
        return res.status(400).json({
            success: false,
            error:
                "Username: 3–16 Zeichen, nur Buchstaben, Zahlen und _."
        });
    }

    const key =
        username.toLowerCase();

    if (db.players[key]) {
        return res.status(409).json({
            success: false,
            error:
                "Dieser Username ist bereits vergeben."
        });
    }

    const p = normalizePlayer({
        username,

        coins: 250,
        xp: 0,
        level: 1,

        energy: 100,
        happiness: 70,

        inventory: [],
        equipped: [],

        jobs: {},

        workToday: 0,
        restsToday: 0,
        freeTimeToday: 0,

        lastActionDay:
            new Date().toISOString().slice(0, 10),

        streak: 0,
        lastDaily: null,

        friends: [],
        gifts: [],

        bank: 0,
        exchange: 0,

        boostUntil: 0,
        feePassUntil: 0,

        miner: null,

        online: true,
        lastSeen: Date.now()
    });

    db.players[key] = p;

    const token = authToken();

    db.sessions[token] = {
        username: key,
        createdAt: Date.now()
    };

    saveDB();

    res.json({
        success: true,
        token,
        player: publicPlayer(p)
    });
});

app.post("/api/login", (req, res) => {
    const username =
        String(req.body.username || "").trim();

    const key =
        username.toLowerCase();

    if (!db.players[key]) {
        return res.status(404).json({
            success: false,
            error: "Username nicht gefunden."
        });
    }

    const p =
        normalizePlayer(db.players[key]);

    dailyReset(p);

    const token = authToken();

    db.sessions[token] = {
        username: key,
        createdAt: Date.now()
    };

    p.online = true;
    p.lastSeen = Date.now();

    saveDB();

    res.json({
        success: true,
        token,
        player: publicPlayer(p)
    });
});

app.post("/api/state", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    dailyReset(p);
    minerState(p);

    saveDB();

    res.json({
        success: true,
        player: publicPlayer(p),
        xpNeeded: xpNeeded(p)
    });
});

app.post("/api/heartbeat", (req, res) => {
    const p = currentPlayer(req);

    if (p) {
        saveDB();
    }

    clean();

    res.json({
        success: true,
        online:
            Object.values(db.players)
                .filter(x => x.online)
                .length
    });
});

app.get("/api/online", (req, res) => {
    clean();

    res.json({
        online:
            Object.values(db.players)
                .filter(x => x.online)
                .length
    });
});

app.post("/api/work", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    dailyReset(p);

    if (p.workToday >= 8) {
        return res.status(400).json({
            success: false,
            error:
                "Tageslimit von 8 Jobs erreicht."
        });
    }

    const job =
        jobs.find(j => j.id === req.body.id);

    if (!job) {
        return res.status(400).json({
            success: false,
            error: "Job nicht gefunden."
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
                `Job noch ${Math.ceil(
                    remaining / 1000
                )} Sekunden gesperrt.`
        });
    }

    let energy = job.energy;

    if (p.equipped.includes("🚲 Fahrrad")) {
        energy -= 5;
    }

    if (p.equipped.includes("👟 Arbeitsschuhe")) {
        energy -= 3;
    }

    energy = Math.max(5, energy);

    if (p.energy < energy) {
        return res.status(400).json({
            success: false,
            error: "Nicht genug Energie."
        });
    }

    let reward = job.reward;

    if (p.equipped.includes("🎧 Kopfhörer")) {
        reward = Math.round(reward * 1.10);
    }

    if (p.boostUntil > Date.now()) {
        reward *= 2;
    }

    p.jobs[job.id] = Date.now();

    p.workToday++;

    p.energy -= energy;

    p.happiness =
        Math.max(
            0,
            p.happiness - job.happiness
        );

    p.coins += reward;

    addXP(p, job.xp);

    function consumeEquipped(name) {
        const index =
            p.inventory.findIndex(
                x =>
                    x.name === name &&
                    x.uses > 0
            );

        if (index === -1) return;

        p.inventory[index].uses--;

        if (p.inventory[index].uses <= 0) {
            p.inventory.splice(index, 1);

            p.equipped =
                p.equipped.filter(
                    x => x !== name
                );
        }
    }

    if (p.equipped.includes("🎧 Kopfhörer")) {
        consumeEquipped("🎧 Kopfhörer");
    }

    if (p.equipped.includes("🚲 Fahrrad")) {
        consumeEquipped("🚲 Fahrrad");
    }

    if (p.equipped.includes("👟 Arbeitsschuhe")) {
        consumeEquipped("👟 Arbeitsschuhe");
    }

    saveDB();

    res.json({
        success: true,
        reward,
        player: publicPlayer(p)
    });
});

app.post("/api/rest", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    dailyReset(p);

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
    }

    if (p.equipped.includes("🛏️ Bequemes Bett")) {
        amount += 10;
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

    function consume(name) {
        const index =
            p.inventory.findIndex(
                x =>
                    x.name === name &&
                    x.uses > 0
            );

        if (index === -1) return;

        p.inventory[index].uses--;

        if (p.inventory[index].uses <= 0) {
            p.inventory.splice(index, 1);

            p.equipped =
                p.equipped.filter(
                    x => x !== name
                );
        }
    }

    if (p.equipped.includes("🏠 Kleine Wohnung")) {
        consume("🏠 Kleine Wohnung");
    }

    if (p.equipped.includes("🛏️ Bequemes Bett")) {
        consume("🛏️ Bequemes Bett");
    }

    saveDB();

    res.json({
        success: true,
        amount,
        player: publicPlayer(p)
    });
});

app.post("/api/freetime", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    dailyReset(p);

    if (p.freeTimeToday >= 5) {
        return res.status(400).json({
            success: false,
            error:
                "Du hast dein Freizeitlimit für heute erreicht."
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

    function consume(name) {
        const index =
            p.inventory.findIndex(
                x =>
                    x.name === name &&
                    x.uses > 0
            );

        if (index === -1) return false;

        p.inventory[index].uses--;

        if (p.inventory[index].uses <= 0) {
            p.inventory.splice(index, 1);

            p.equipped =
                p.equipped.filter(
                    x => x !== name
                );
        }

        return true;
    }

    if (p.equipped.includes("🎮 Controller")) {
        happiness += 15;
        consume("🎮 Controller");
    }

    if (p.equipped.includes("💻 Gaming PC")) {
        happiness += 20;
        consume("💻 Gaming PC");
    }

    if (p.equipped.includes("📱 Smartphone")) {
        happiness += 8;
        consume("📱 Smartphone");
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
        player: publicPlayer(p)
    });
});

app.post("/api/daily", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    dailyReset(p);

    const today =
        new Date().toISOString().slice(0, 10);

    if (p.lastDaily === today) {
        return res.status(400).json({
            success: false,
            error:
                "Deine Daily wurde heute bereits abgeholt."
        });
    }

    p.lastDaily = today;
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
        player: publicPlayer(p)
    });
});

app.post("/api/shop/buy", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    const name =
        String(req.body.name || "");

    if (shop[name]) {
        const item = shop[name];

        if (p.coins < item.price) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Coins."
            });
        }

        p.coins -= item.price;

        p.inventory.push({
            name,
            uses: item.uses
        });

        saveDB();

        return res.json({
            success: true,
            player: publicPlayer(p)
        });
    }

    if (shopSpecials[name]) {
        const item =
            shopSpecials[name];

        if (p.coins < item.price) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Coins."
            });
        }

        p.coins -= item.price;

        if (name === "⚡ Einnahmen-Boost") {
            p.boostUntil =
                Math.max(
                    Date.now(),
                    p.boostUntil
                ) +
                10 * 60 * 60 * 1000;
        }

        if (name === "🧾 Gebührenpass") {
            p.feePassUntil =
                Math.max(
                    Date.now(),
                    p.feePassUntil
                ) +
                24 * 60 * 60 * 1000;
        }

        saveDB();

        return res.json({
            success: true,
            player: publicPlayer(p)
        });
    }

    return res.status(404).json({
        success: false,
        error: "Shop-Item nicht gefunden."
    });
});

app.post("/api/inventory/equip", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    const name =
        String(req.body.name || "");

    const item =
        p.inventory.find(
            x =>
                x.name === name &&
                x.uses > 0
        );

    if (!item) {
        return res.status(400).json({
            success: false,
            error:
                "Item nicht im Inventar."
        });
    }

    const data = shop[name];

    if (!data || data.type === "consumable") {
        return res.status(400).json({
            success: false,
            error:
                "Dieses Item kann nicht ausgerüstet werden."
        });
    }

    if (!p.equipped.includes(name)) {
        p.equipped.push(name);
    }

    saveDB();

    res.json({
        success: true,
        player: publicPlayer(p)
    });
});

app.post("/api/inventory/unequip", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    const name =
        String(req.body.name || "");

    p.equipped =
        p.equipped.filter(
            x => x !== name
        );

    saveDB();

    res.json({
        success: true,
        player: publicPlayer(p)
    });
});

app.post("/api/inventory/use", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    const index =
        Number(req.body.index);

    const item =
        p.inventory[index];

    if (!item) {
        return res.status(400).json({
            success: false,
            error: "Item nicht gefunden."
        });
    }

    const data =
        shop[item.name];

    if (
        !data ||
        data.type !== "consumable"
    ) {
        return res.status(400).json({
            success: false,
            error:
                "Dieses Item ist nicht direkt benutzbar."
        });
    }

    if (p.energy >= 100) {
        return res.status(400).json({
            success: false,
            error:
                "Deine Energie ist bereits voll."
        });
    }

    const gained =
        Math.min(
            data.value,
            100 - p.energy
        );

    p.energy += gained;

    item.uses--;

    if (item.uses <= 0) {
        p.inventory.splice(index, 1);
    }

    saveDB();

    res.json({
        success: true,
        gained,
        player: publicPlayer(p)
    });
});

app.post("/api/friend/add", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    const username =
        String(req.body.username || "")
            .trim();

    const key =
        username.toLowerCase();

    if (!db.players[key]) {
        return res.status(404).json({
            success: false,
            error:
                "Spieler nicht gefunden."
        });
    }

    if (key === p.username.toLowerCase()) {
        return res.status(400).json({
            success: false,
            error:
                "Du kannst dich nicht selbst hinzufügen."
        });
    }

    if (!p.friends.includes(db.players[key].username)) {
        p.friends.push(
            db.players[key].username
        );
    }

    saveDB();

    res.json({
        success: true,
        player: publicPlayer(p)
    });
});

app.post("/api/gift", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    const target =
        String(req.body.username || "")
            .trim()
            .toLowerCase();

    const receiver =
        db.players[target];

    if (!receiver) {
        return res.status(404).json({
            success: false,
            error:
                "Spieler nicht gefunden."
        });
    }

    if (
        !p.friends.includes(
            receiver.username
        )
    ) {
        return res.status(400).json({
            success: false,
            error:
                "Du musst zuerst mit diesem Spieler befreundet sein."
        });
    }

    const type =
        String(req.body.type || "");

    if (type === "coins") {
        const amount =
            Math.floor(
                Number(req.body.amount)
            );

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ungültiger Betrag."
            });
        }

        if (p.coins < amount) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Coins."
            });
        }

        p.coins -= amount;
        receiver.coins += amount;

        saveDB();

        return res.json({
            success: true,
            player: publicPlayer(p)
        });
    }

    if (type === "item") {
        const index =
            Number(req.body.index);

        const item =
            p.inventory[index];

        if (!item || item.uses <= 0) {
            return res.status(400).json({
                success: false,
                error:
                    "Item nicht gefunden."
            });
        }

        p.inventory.splice(index, 1);

        p.equipped =
            p.equipped.filter(
                x => x !== item.name
            );

        receiver.inventory.push({
            name: item.name,
            uses: item.uses
        });

        saveDB();

        return res.json({
            success: true,
            player: publicPlayer(p)
        });
    }

    return res.status(400).json({
        success: false,
        error:
            "Ungültiger Geschenktyp."
    });
});

app.get("/api/leaderboard", (req, res) => {
    const players =
        Object.values(db.players)
            .map(normalizePlayer);

    const money =
        [...players]
            .sort(
                (a, b) =>
                    b.coins - a.coins
            )
            .slice(0, 50)
            .map((p, i) => ({
                rank: i + 1,
                username: p.username,
                value: Math.floor(p.coins)
            }));

    const xp =
        [...players]
            .sort((a, b) => {
                if (b.level !== a.level) {
                    return b.level - a.level;
                }

                return b.xp - a.xp;
            })
            .slice(0, 50)
            .map((p, i) => ({
                rank: i + 1,
                username: p.username,
                level: p.level,
                value: Math.floor(p.xp)
            }));

    res.json({
        success: true,
        money,
        xp
    });
});

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

    const price = 10000;

    if (p.coins < price) {
        return res.status(400).json({
            success: false,
            error:
                "Du brauchst 10.000 Coins."
        });
    }

    p.coins -= price;

    p.miner = {
        level: 1,
        condition: 100,
        stored: 0,
        lastUpdate: Date.now()
    };

    saveDB();

    res.json({
        success: true,
        player: publicPlayer(p)
    });
});

app.post("/api/miner/state", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    if (!p.miner) {
        return res.status(400).json({
            success: false,
            error:
                "Du besitzt noch keinen Miner."
        });
    }

    minerState(p);

    saveDB();

    res.json({
        success: true,
        player: publicPlayer(p)
    });
});

app.post("/api/miner/collect", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    if (!p.miner) {
        return res.status(400).json({
            success: false,
            error:
                "Du besitzt noch keinen Miner."
        });
    }

    minerState(p);

    const amount =
        Math.floor(p.miner.stored);

    if (amount <= 0) {
        return res.status(400).json({
            success: false,
            error:
                "Noch keine Einnahmen zum Abholen."
        });
    }

    p.miner.stored -= amount;
    p.coins += amount;

    saveDB();

    res.json({
        success: true,
        amount,
        player: publicPlayer(p)
    });
});

app.post("/api/miner/repair", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    if (!p.miner) {
        return res.status(400).json({
            success: false,
            error:
                "Du besitzt noch keinen Miner."
        });
    }

    minerState(p);

    if (p.miner.condition >= 99.9) {
        return res.status(400).json({
            success: false,
            error:
                "Dein Miner ist bereits fast vollständig repariert."
        });
    }

    const missing =
        100 - p.miner.condition;

    const cost =
        Math.max(
            50,
            Math.floor(missing * 20)
        );

    if (p.coins < cost) {
        return res.status(400).json({
            success: false,
            error:
                `Du brauchst ${cost.toLocaleString("de-DE")} Coins zur Reparatur.`
        });
    }

    p.coins -= cost;
    p.miner.condition = 100;

    saveDB();

    res.json({
        success: true,
        cost,
        player: publicPlayer(p)
    });
});

app.post("/api/miner/upgrade", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    if (!p.miner) {
        return res.status(400).json({
            success: false,
            error:
                "Du besitzt noch keinen Miner."
        });
    }

    minerState(p);

    const cost =
        minerUpgradeCost(
            p.miner.level
        );

    if (!Number.isFinite(cost)) {
        return res.status(400).json({
            success: false,
            error:
                "Maximales Miner-Level erreicht."
        });
    }

    if (p.coins < cost) {
        return res.status(400).json({
            success: false,
            error:
                `Du brauchst ${cost.toLocaleString("de-DE")} Coins.`
        });
    }

    p.coins -= cost;

    p.miner.level++;

    p.miner.condition = 100;

    saveDB();

    res.json({
        success: true,
        player: publicPlayer(p)
    });
});

app.post("/api/bank/transfer", (req, res) => {
    const p = requirePlayer(req, res);

    if (!p) return;

    const direction =
        String(req.body.direction || "");

    const amount =
        Math.floor(
            Number(req.body.amount)
        );

    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        return res.status(400).json({
            success: false,
            error:
                "Ungültiger Betrag."
        });
    }

    if (direction === "toBankFromCoins") {
        if (p.coins < amount) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Coins."
            });
        }

        p.coins -= amount;
        p.bank += amount;
    }

    else if (direction === "fromBankToCoins") {
        if (p.bank < amount) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Geld auf dem Konto."
            });
        }

        p.bank -= amount;
        p.coins += amount;
    }

    else if (
        direction === "toExchange" ||
        direction === "toBank"
    ) {
        const feeFree =
            p.feePassUntil > Date.now();

        const fee =
            feeFree
                ? 0
                : feeFor(amount);

        const total =
            amount + fee;

        if (direction === "toExchange") {
            if (p.bank < total) {
                return res.status(400).json({
                    success: false,
                    error:
                        `Du brauchst ${total.toLocaleString("de-DE")} Coins inklusive Gebühr.`
                });
            }

            p.bank -= total;
            p.exchange += amount;
        }

        else {
            if (p.exchange < total) {
                return res.status(400).json({
                    success: false,
                    error:
                        `Du brauchst ${total.toLocaleString("de-DE")} Coins inklusive Gebühr.`
                });
            }

            p.exchange -= total;
            p.bank += amount;
        }

        saveDB();

        return res.json({
            success: true,
            fee,
            player: publicPlayer(p)
        });
    }

    else {
        return res.status(400).json({
            success: false,
            error:
                "Ungültige Überweisung."
        });
    }

    saveDB();

    res.json({
        success: true,
        fee: 0,
        player: publicPlayer(p)
    });
});

app.post("/api/admin/login", (req, res) => {
    if (
        req.body.password !==
        ADMIN_PASSWORD
    ) {
        return res.status(401).json({
            success: false,
            error:
                "Falsches Admin-Passwort."
        });
    }

    res.json({
        success: true
    });
});

app.post("/api/admin/stats", (req, res) => {
    if (
        req.body.password !==
        ADMIN_PASSWORD
    ) {
        return res.status(401).json({
            success: false,
            error:
                "Falsches Admin-Passwort."
        });
    }

    clean();

    res.json({
        success: true,
        onlinePlayers:
            Object.values(db.players)
                .filter(x => x.online)
                .length,
        totalPlayers:
            Object.keys(db.players).length
    });
});

app.post("/api/admin/give", (req, res) => {
    if (
        req.body.password !==
        ADMIN_PASSWORD
    ) {
        return res.status(401).json({
            success: false,
            error:
                "Falsches Admin-Passwort."
        });
    }

    const username =
        String(req.body.username || "")
            .trim()
            .toLowerCase();

    const target =
        db.players[username];

    if (!target) {
        return res.status(404).json({
            success: false,
            error:
                "Spieler nicht gefunden."
        });
    }

    const type =
        String(req.body.type || "");

    const amount =
        Math.floor(
            Number(req.body.amount)
        );

    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        return res.status(400).json({
            success: false,
            error:
                "Ungültige Menge."
        });
    }

    if (type === "coins") {
        target.coins += amount;
    }

    else if (type === "xp") {
        addXP(target, amount);
    }

    else {
        return res.status(400).json({
            success: false,
            error:
                "Ungültiger Typ."
        });
    }

    saveDB();

    res.json({
        success: true,
        player: publicPlayer(target)
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

app.listen(PORT, () => {
    console.log(
        `🔥 CUBIX CITY läuft auf Port ${PORT}`
    );
});
