const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// CUBIX SERVER
// ===============================

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Admin-Passwort in Render unter:
// Environment -> ADMIN_PASSWORD
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME";

// Spieler werden serverseitig verwaltet.
// Für die erste Version nutzen wir den Speicher des Servers.
const players = new Map();

// Aktive Spieler
const activePlayers = new Map();

const JOBS = {
    garbage: {
        name: "Müll sammeln",
        coins: 20,
        xp: 10,
        cooldown: 30
    },
    pizza: {
        name: "Pizza liefern",
        coins: 50,
        xp: 25,
        cooldown: 60
    },
    taxi: {
        name: "Taxi fahren",
        coins: 100,
        xp: 50,
        cooldown: 120
    },
    programmer: {
        name: "Programmieren",
        coins: 200,
        xp: 90,
        cooldown: 300
    }
};

const SHOP = {
    energy: {
        name: "Energy Drink",
        price: 50
    },
    headphones: {
        name: "Kopfhörer",
        price: 150
    },
    skateboard: {
        name: "Skateboard",
        price: 400
    },
    smartphone: {
        name: "Smartphone",
        price: 750
    },
    laptop: {
        name: "Gaming Laptop",
        price: 1500
    }
};

function createPlayer(id) {
    return {
        id,
        coins: 250,
        xp: 0,
        level: 1,

        inventory: {},

        jobs: {},

        lastDaily: 0,
        dailyStreak: 0,

        achievements: [],

        quizWins: 0,
        reactionBest: null,
        blackjackWins: 0,
        racesWon: 0,

        createdAt: Date.now(),
        lastSeen: Date.now()
    };
}

function getPlayer(id) {
    if (!id) return null;

    if (!players.has(id)) {
        players.set(id, createPlayer(id));
    }

    const player = players.get(id);
    player.lastSeen = Date.now();

    return player;
}

function addXP(player, amount) {
    player.xp += amount;

    let levelUps = 0;

    while (player.xp >= player.level * 100) {
        player.xp -= player.level * 100;
        player.level++;
        levelUps++;
    }

    return levelUps;
}

function checkAchievements(player) {
    const newAchievements = [];

    function achievement(id, name, condition) {
        if (condition && !player.achievements.includes(id)) {
            player.achievements.push(id);
            newAchievements.push(name);
        }
    }

    achievement(
        "first_job",
        "💼 Erster Arbeitstag",
        Object.keys(player.jobs).length > 0
    );

    achievement(
        "rich",
        "💰 Sparschwein",
        player.coins >= 1000
    );

    achievement(
        "level5",
        "⭐ Level 5",
        player.level >= 5
    );

    achievement(
        "level10",
        "🌟 Level 10",
        player.level >= 10
    );

    achievement(
        "quiz10",
        "🧠 Quizmeister",
        player.quizWins >= 10
    );

    achievement(
        "race5",
        "🏎️ Rennfahrer",
        player.racesWon >= 5
    );

    achievement(
        "collector",
        "🎒 Sammler",
        Object.values(player.inventory).reduce((a, b) => a + b, 0) >= 5
    );

    return newAchievements;
}

function publicPlayer(player) {
    return {
        id: player.id,
        coins: player.coins,
        xp: player.xp,
        level: player.level,
        inventory: player.inventory,
        achievements: player.achievements,
        dailyStreak: player.dailyStreak,
        quizWins: player.quizWins,
        reactionBest: player.reactionBest,
        blackjackWins: player.blackjackWins,
        racesWon: player.racesWon
    };
}

// ===============================
// PLAYER
// ===============================

app.post("/api/player", (req, res) => {
    const id = req.body.id || crypto.randomUUID();

    const player = getPlayer(id);

    res.json({
        player: publicPlayer(player)
    });
});

// ===============================
// HEARTBEAT
// ===============================

app.post("/api/heartbeat", (req, res) => {
    const id = req.body.id;

    if (!id) {
        return res.status(400).json({
            error: "Keine Spieler-ID"
        });
    }

    const player = getPlayer(id);

    activePlayers.set(id, Date.now());

    res.json({
        activePlayers: getActivePlayerCount(),
        player: publicPlayer(player)
    });
});

function getActivePlayerCount() {
    const now = Date.now();

    for (const [id, lastSeen] of activePlayers) {
        if (now - lastSeen > 70000) {
            activePlayers.delete(id);
        }
    }

    return activePlayers.size;
}

// ===============================
// DAILY
// ===============================

app.post("/api/daily", (req, res) => {
    const player = getPlayer(req.body.id);

    if (!player) {
        return res.status(400).json({ error: "Spieler fehlt" });
    }

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    if (now - player.lastDaily < DAY) {
        const remaining = DAY - (now - player.lastDaily);

        return res.json({
            success: false,
            message: `Daily bereits eingesammelt. Noch ${formatTime(remaining)}.`
        });
    }

    const yesterday = DAY + 60 * 60 * 1000;

    if (
        player.lastDaily > 0 &&
        now - player.lastDaily <= yesterday
    ) {
        player.dailyStreak++;
    } else {
        player.dailyStreak = 1;
    }

    player.lastDaily = now;

    const reward = 100 + Math.min(player.dailyStreak * 25, 250);

    player.coins += reward;
    const levels = addXP(player, 20);

    const achievements = checkAchievements(player);

    res.json({
        success: true,
        reward,
        levels,
        achievements,
        player: publicPlayer(player)
    });
});

// ===============================
// JOBS
// ===============================

app.post("/api/job", (req, res) => {
    const player = getPlayer(req.body.id);
    const job = JOBS[req.body.job];

    if (!player || !job) {
        return res.status(400).json({
            error: "Ungültiger Job"
        });
    }

    const now = Date.now();
    const last = player.jobs[req.body.job] || 0;

    const cooldown = job.cooldown * 1000;

    if (now - last < cooldown) {
        return res.json({
            success: false,
            message: `Dieser Job ist noch ${formatTime(cooldown - (now - last))} gesperrt.`
        });
    }

    player.jobs[req.body.job] = now;

    player.coins += job.coins;

    const levels = addXP(player, job.xp);
    const achievements = checkAchievements(player);

    res.json({
        success: true,
        job: job.name,
        coins: job.coins,
        xp: job.xp,
        levels,
        achievements,
        player: publicPlayer(player)
    });
});

// ===============================
// SHOP
// ===============================

app.post("/api/shop/buy", (req, res) => {
    const player = getPlayer(req.body.id);
    const item = SHOP[req.body.item];

    if (!player || !item) {
        return res.status(400).json({
            error: "Ungültiger Artikel"
        });
    }

    if (player.coins < item.price) {
        return res.json({
            success: false,
            message: "Du hast nicht genug Coins."
        });
    }

    player.coins -= item.price;

    player.inventory[req.body.item] =
        (player.inventory[req.body.item] || 0) + 1;

    const achievements = checkAchievements(player);

    res.json({
        success: true,
        item: item.name,
        achievements,
        player: publicPlayer(player)
    });
});

// ===============================
// QUIZ
// ===============================

const quizQuestions = [
    {
        q: "Wie viele Planeten hat unser Sonnensystem?",
        answers: ["6", "7", "8", "9"],
        correct: 2
    },
    {
        q: "Was ist die Hauptstadt von Deutschland?",
        answers: ["Berlin", "Hamburg", "München", "Köln"],
        correct: 0
    },
    {
        q: "Wie viele Minuten hat eine Stunde?",
        answers: ["30", "45", "60", "90"],
        correct: 2
    },
    {
        q: "Welche Farbe entsteht aus Blau und Gelb?",
        answers: ["Rot", "Grün", "Lila", "Orange"],
        correct: 1
    },
    {
        q: "Wie viel ist 12 × 12?",
        answers: ["124", "144", "154", "164"],
        correct: 1
    }
];

app.get("/api/quiz", (req, res) => {
    const question =
        quizQuestions[Math.floor(Math.random() * quizQuestions.length)];

    res.json({
        question
    });
});

app.post("/api/quiz", (req, res) => {
    const player = getPlayer(req.body.id);

    if (!player) {
        return res.status(400).json({
            error: "Spieler fehlt"
        });
    }

    if (req.body.correct) {
        player.coins += 30;
        player.quizWins++;

        const levels = addXP(player, 15);
        const achievements = checkAchievements(player);

        return res.json({
            success: true,
            reward: 30,
            levels,
            achievements,
            player: publicPlayer(player)
        });
    }

    res.json({
        success: false,
        player: publicPlayer(player)
    });
});

// ===============================
// HIGH SCORE
// ===============================

app.post("/api/reaction", (req, res) => {
    const player = getPlayer(req.body.id);
    const time = Number(req.body.time);

    if (!player || !Number.isFinite(time)) {
        return res.status(400).json({
            error: "Ungültige Daten"
        });
    }

    let newRecord = false;

    if (
        player.reactionBest === null ||
        time < player.reactionBest
    ) {
        player.reactionBest = time;
        newRecord = true;

        player.coins += 75;
        addXP(player, 25);
    }

    res.json({
        newRecord,
        player: publicPlayer(player)
    });
});

// ===============================
// BLACKJACK OHNE EINSATZ
// ===============================

app.post("/api/blackjack", (req, res) => {
    const player = getPlayer(req.body.id);

    if (!player) {
        return res.status(400).json({
            error: "Spieler fehlt"
        });
    }

    const playerScore = Number(req.body.playerScore);
    const dealerScore = Math.floor(Math.random() * 15) + 7;

    let result = "lose";

    if (playerScore <= 21 && playerScore > dealerScore) {
        result = "win";

        player.coins += 60;
        addXP(player, 20);
        player.blackjackWins++;
    } else if (
        playerScore <= 21 &&
        playerScore === dealerScore
    ) {
        result = "draw";
    }

    const achievements = checkAchievements(player);

    res.json({
        result,
        dealerScore,
        achievements,
        player: publicPlayer(player)
    });
});

// ===============================
// RENNEN
// ===============================

app.post("/api/race", (req, res) => {
    const player = getPlayer(req.body.id);

    if (!player) {
        return res.status(400).json({
            error: "Spieler fehlt"
        });
    }

    const position = Math.floor(Math.random() * 3) + 1;

    if (position === 1) {
        player.coins += 150;
        addXP(player, 40);
        player.racesWon++;
    } else if (position === 2) {
        player.coins += 75;
        addXP(player, 20);
    } else {
        addXP(player, 5);
    }

    const achievements = checkAchievements(player);

    res.json({
        position,
        achievements,
        player: publicPlayer(player)
    });
});

// ===============================
// ADMIN
// ===============================

function adminAuth(req, res, next) {
    const password = req.headers["x-admin-password"];

    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(403).json({
            error: "Keine Berechtigung"
        });
    }

    next();
}

app.post("/api/admin/login", (req, res) => {
    if (
        !req.body.password ||
        req.body.password !== ADMIN_PASSWORD
    ) {
        return res.status(403).json({
            success: false
        });
    }

    res.json({
        success: true
    });
});

app.get("/api/admin/stats", adminAuth, (req, res) => {
    let totalCoins = 0;
    let totalXP = 0;

    for (const player of players.values()) {
        totalCoins += player.coins;
        totalXP += player.xp;
    }

    res.json({
        activePlayers: getActivePlayerCount(),
        totalPlayers: players.size,
        totalCoins,
        totalXP
    });
});

app.post("/api/admin/give", adminAuth, (req, res) => {
    const player = getPlayer(req.body.playerId);

    if (!player) {
        return res.status(404).json({
            error: "Spieler nicht gefunden"
        });
    }

    const coins = Number(req.body.coins) || 0;
    const xp = Number(req.body.xp) || 0;

    player.coins += coins;

    const levels = addXP(player, xp);

    res.json({
        success: true,
        levels,
        player: publicPlayer(player)
    });
});

app.post("/api/admin/reset", adminAuth, (req, res) => {
    const id = req.body.playerId;

    if (!players.has(id)) {
        return res.status(404).json({
            error: "Spieler nicht gefunden"
        });
    }

    players.set(id, createPlayer(id));

    res.json({
        success: true
    });
});

// ===============================
// UTILS
// ===============================

function formatTime(ms) {
    const seconds = Math.ceil(ms / 1000);

    if (seconds >= 3600) {
        return `${Math.floor(seconds / 3600)}h`;
    }

    if (seconds >= 60) {
        return `${Math.floor(seconds / 60)}min`;
    }

    return `${seconds}s`;
}

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🎮 CUBIX CITY läuft auf Port ${PORT}`);
});
