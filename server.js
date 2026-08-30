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
const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;

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

/* =========================
   DATENBANK
========================= */

try {
    if (fs.existsSync(DB_FILE)) {
        db = JSON.parse(
            fs.readFileSync(DB_FILE, "utf8")
        );
    }
} catch (error) {
    console.log(
        "Neue Datenbank wird erstellt."
    );
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

/* =========================
   HILFSFUNKTIONEN
========================= */

function today() {
    return new Date()
        .toISOString()
        .slice(0, 10);
}

function clean() {
    const now = Date.now();

    for (
        const [token, session]
        of Object.entries(db.sessions)
    ) {
        if (
            now - session.createdAt >
            30 * DAY
        ) {
            delete db.sessions[token];
        }
    }

    for (
        const player
        of Object.values(db.players)
    ) {
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
            now - player.lastWorkedAt >
            JOB_INACTIVITY_LIMIT
        ) {
            player.activeJob = null;
            player.jobFired = true;
        }
    }
}

function normalizePlayer(player) {
    player.coins =
        Number.isFinite(player.coins)
            ? player.coins
            : 250;

    player.xp =
        Number.isFinite(player.xp)
            ? player.xp
            : 0;

    player.level =
        Number.isFinite(player.level)
            ? player.level
            : 1;

    player.energy =
        Number.isFinite(player.energy)
            ? Math.max(
                0,
                Math.min(
                    100,
                    player.energy
                )
            )
            : 100;

    player.happiness =
        Number.isFinite(
            player.happiness
        )
            ? Math.max(
                0,
                Math.min(
                    100,
                    player.happiness
                )
            )
            : 70;

    player.inventory ||= [];
    player.equipped ||= [];
    player.jobs ||= {};

    player.activeJob ||=
        null;

    player.lastWorkedAt ||=
        0;

    player.jobFired ||=
        false;

    player.restsToday ||=
        0;

    player.freeTimeToday ||=
        0;

    player.lastActionDay ||=
        today();

    player.streak ||=
        0;

    player.lastDaily ||=
        null;

    player.friends ||=
        [];

    player.friendRequests ||= {
        incoming: [],
        outgoing: []
    };

    player.gifts ||=
        [];

    player.bank ||=
        0;

    player.exchange ||=
        0;

    player.boostUntil ||=
        0;

    player.feePassUntil ||=
        0;

    player.portfolio ||=
        {};

    player.miner ||=
        null;
}

function currentPlayer(req) {
    const token =
        req.headers.authorization
            ?.replace(
                /^Bearer\s+/i,
                ""
            );

    if (
        !token ||
        !db.sessions[token]
    ) {
        return null;
    }

    const username =
        db.sessions[token].username;

    const player =
        db.players[username];

    if (!player) {
        return null;
    }

    normalizePlayer(player);

    player.lastSeen =
        Date.now();

    player.online = true;

    return player;
}

function requirePlayer(req, res) {
    const player =
        currentPlayer(req);

    if (!player) {
        res.status(401).json({
            success: false,
            error:
                "Nicht eingeloggt."
        });

        return null;
    }

    return player;
}

function xpNeeded(player) {
    return (
        100 +
        (player.level - 1) * 50
    );
}

function addXP(player, amount) {
    if (
        !Number.isSafeInteger(
            amount
        ) ||
        amount <= 0
    ) {
        return;
    }

    player.xp += amount;

    while (
        player.xp >=
        xpNeeded(player)
    ) {
        player.xp -=
            xpNeeded(player);

        player.level++;
    }
}

function resetDaily(player) {
    if (
        player.lastActionDay !==
        today()
    ) {
        player.lastActionDay =
            today();

        player.restsToday = 0;
        player.freeTimeToday = 0;
    }
}

function consume(player, name) {
    const index =
        player.inventory.findIndex(
            item =>
                item.name === name &&
                item.uses > 0
        );

    if (index === -1) {
        return false;
    }

    player.inventory[index].uses--;

    if (
        player.inventory[index]
            .uses <= 0
    ) {
        player.inventory.splice(
            index,
            1
        );

        player.equipped =
            player.equipped.filter(
                item => item !== name
            );
    }

    return true;
}

function incomeMultiplier(player) {
    return player.boostUntil >
        Date.now()
        ? 2
        : 1;
}

/* =========================
   JOBS
========================= */

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

function jobEnergyCost(player, job) {
    let cost = job.energy;

    if (
        player.equipped.includes(
            "🚲 Fahrrad"
        )
    ) {
        cost -= 5;
    }

    if (
        player.equipped.includes(
            "👟 Arbeitsschuhe"
        )
    ) {
        cost -= 3;
    }

    return Math.max(5, cost);
}

/* =========================
   SHOP
========================= */

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
        text:
            "Verdoppelt Einnahmen für 10 Stunden"
    },

    "🛡️ Fee Pass": {
        price: 7500,
        uses: 1,
        type: "fees",
        text:
            "Keine Bank-/Börsengebühren für 24 Stunden"
    }
};

/* =========================
   REGISTRIERUNG
========================= */

app.post(
    "/api/register",
    (req, res) => {
        clean();

        const username =
            String(
                req.body.username || ""
            ).trim();

        if (
            !/^[A-Za-z0-9_]{3,16}$/
                .test(username)
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Username muss 3-16 Zeichen haben und darf nur Buchstaben, Zahlen und _ enthalten."
            });
        }

        if (
            db.players[username]
        ) {
            return res.status(409).json({
                success: false,
                error:
                    "Dieser Username ist bereits vergeben."
            });
        }

        const player = {
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

            friendRequests: {
                incoming: [],
                outgoing: []
            },

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

        db.players[username] =
            player;

        const token =
            crypto.randomBytes(32)
                .toString("hex");

        db.sessions[token] = {
            username,
            createdAt: Date.now()
        };

        saveDB();

        res.json({
            success: true,
            token,
            player
        });
    }
);

/* =========================
   LOGIN
========================= */

app.post(
    "/api/login",
    (req, res) => {
        clean();

        const username =
            String(
                req.body.username || ""
            ).trim();

        const player =
            db.players[username];

        if (!player) {
            return res.status(404).json({
                success: false,
                error:
                    "Spieler nicht gefunden."
            });
        }

        normalizePlayer(player);

        const token =
            crypto.randomBytes(32)
                .toString("hex");

        db.sessions[token] = {
            username,
            createdAt: Date.now()
        };

        player.online = true;
        player.lastSeen =
            Date.now();

        saveDB();

        res.json({
            success: true,
            token,
            player
        });
    }
);

/* =========================
   SPIELERDATEN
========================= */

app.get(
    "/api/me",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        resetDaily(player);
        clean();

        res.json({
            success: true,
            player,
            xpNeeded:
                xpNeeded(player),
            jobs,
            shop
        });
    }
);

/* =========================
   HEARTBEAT
========================= */

app.post(
    "/api/heartbeat",
    (req, res) => {
        const player =
            currentPlayer(req);

        if (!player) {
            return res.status(401).json({
                success: false
            });
        }

        player.lastSeen =
            Date.now();

        player.online = true;

        clean();
        saveDB();

        res.json({
            success: true,
            online:
                Object.values(
                    db.players
                ).filter(
                    p => p.online
                ).length
        });
    }
);

app.get(
    "/api/online",
    (req, res) => {
        clean();

        res.json({
            online:
                Object.values(
                    db.players
                ).filter(
                    p => p.online
                ).length
        });
    }
);

/* =========================
   JOB BEWERBUNG
========================= */

app.post(
    "/api/job/apply",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const job =
            jobs.find(
                x =>
                    x.id ===
                    req.body.jobId
            );

        if (!job) {
            return res.status(400).json({
                success: false,
                error:
                    "Job nicht gefunden."
            });
        }

        if (player.activeJob) {
            return res.status(400).json({
                success: false,
                error:
                    "Du hast bereits einen Job."
            });
        }

        player.activeJob =
            job.id;

        player.jobFired = false;
        player.lastWorkedAt =
            Date.now();

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   ARBEITEN
========================= */

app.post(
    "/api/job/work",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        resetDaily(player);

        if (!player.activeJob) {
            return res.status(400).json({
                success: false,
                error:
                    "Du hast keinen Job. Bewirb dich zuerst."
            });
        }

        const job =
            jobs.find(
                x =>
                    x.id ===
                    player.activeJob
            );

        if (!job) {
            player.activeJob = null;

            return res.status(400).json({
                success: false,
                error:
                    "Job nicht verfügbar."
            });
        }

        if (
            player.lastWorkedAt &&
            Date.now() -
                player.lastWorkedAt >
                JOB_INACTIVITY_LIMIT
        ) {
            player.activeJob = null;
            player.jobFired = true;

            saveDB();

            return res.status(400).json({
                success: false,
                error:
                    "Du wurdest wegen zu langer Inaktivität gefeuert."
            });
        }

        const last =
            player.jobs[job.id] || 0;

        const remaining =
            job.cooldown -
            (
                Date.now() -
                last
            );

        if (remaining > 0) {
            return res.status(400).json({
                success: false,
                error:
                    `Noch ${Math.ceil(
                        remaining / 1000
                    )} Sekunden Cooldown.`
            });
        }

        const energyCost =
            jobEnergyCost(
                player,
                job
            );

        if (
            player.energy <
            energyCost
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Energie."
            });
        }

        let reward =
            Math.round(
                job.reward *
                incomeMultiplier(
                    player
                )
            );

        if (
            player.equipped.includes(
                "🎧 Kopfhörer"
            )
        ) {
            reward =
                Math.round(
                    reward * 1.10
                );

            consume(
                player,
                "🎧 Kopfhörer"
            );
        }

        if (
            player.equipped.includes(
                "🚲 Fahrrad"
            )
        ) {
            consume(
                player,
                "🚲 Fahrrad"
            );
        }

        if (
            player.equipped.includes(
                "👟 Arbeitsschuhe"
            )
        ) {
            consume(
                player,
                "👟 Arbeitsschuhe"
            );
        }

        player.energy -=
            energyCost;

        player.happiness =
            Math.max(
                0,
                player.happiness -
                    job.happiness
            );

        player.coins +=
            reward;

        addXP(
            player,
            job.xp
        );

        player.jobs[job.id] =
            Date.now();

        player.lastWorkedAt =
            Date.now();

        player.jobFired = false;

        saveDB();

        res.json({
            success: true,
            reward,
            xp: job.xp,
            player
        });
    }
);

/* =========================
   RUHE
========================= */

app.post(
    "/api/rest",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        resetDaily(player);

        if (
            player.restsToday >= 3
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Du hast heute bereits 3 Ruhepausen benutzt."
            });
        }

        if (
            player.energy >= 100
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Du bist bereits vollständig erholt."
            });
        }

        const amount = 30;

        player.energy =
            Math.min(
                100,
                player.energy +
                    amount
            );

        player.happiness =
            Math.min(
                100,
                player.happiness + 3
            );

        player.restsToday++;

        saveDB();

        res.json({
            success: true,
            energy: amount,
            player
        });
    }
);

/* =========================
   FREIZEIT
========================= */

app.post(
    "/api/freetime",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        resetDaily(player);

        if (
            player.freeTimeToday >=
            5
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Dein Freizeitlimit für heute ist erreicht."
            });
        }

        if (
            player.energy < 15
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Du brauchst mindestens 15 Energie."
            });
        }

        let happiness = 12;

        if (
            player.equipped.includes(
                "🎮 Controller"
            )
        ) {
            happiness += 15;

            consume(
                player,
                "🎮 Controller"
            );
        }

        if (
            player.equipped.includes(
                "📱 Smartphone"
            )
        ) {
            happiness += 8;

            consume(
                player,
                "📱 Smartphone"
            );
        }

        player.energy -= 15;

        player.happiness =
            Math.min(
                100,
                player.happiness +
                    happiness
            );

        player.freeTimeToday++;

        addXP(
            player,
            5
        );

        saveDB();

        res.json({
            success: true,
            happiness,
            player
        });
    }
);

/* =========================
   SHOP KAUFEN
========================= */

app.post(
    "/api/shop/buy",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const name =
            req.body.name;

        const item =
            shop[name];

        if (!item) {
            return res.status(404).json({
                success: false,
                error:
                    "Item nicht gefunden."
            });
        }

        if (
            player.coins <
            item.price
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Coins."
            });
        }

        player.coins -=
            item.price;

        if (
            item.type ===
            "boost"
        ) {
            player.boostUntil =
                Math.max(
                    Date.now(),
                    player.boostUntil
                ) +
                10 *
                60 *
                60 *
                1000;
        } else if (
            item.type ===
            "fees"
        ) {
            player.feePassUntil =
                Math.max(
                    Date.now(),
                    player.feePassUntil
                ) +
                24 *
                60 *
                60 *
                1000;
        } else {
            player.inventory.push({
                name,
                uses: item.uses
            });
        }

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   ITEM AUSRÜSTEN
========================= */

app.post(
    "/api/item/equip",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const name =
            req.body.name;

        const item =
            shop[name];

        if (
            !item ||
            item.type === "energy"
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Dieses Item kann nicht ausgerüstet werden."
            });
        }

        if (
            !player.inventory.some(
                x =>
                    x.name === name &&
                    x.uses > 0
            )
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Item nicht im Inventar."
            });
        }

        if (
            !player.equipped.includes(
                name
            )
        ) {
            player.equipped.push(
                name
            );
        }

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

app.post(
    "/api/item/unequip",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        player.equipped =
            player.equipped.filter(
                x =>
                    x !==
                    req.body.name
            );

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   ITEM BENUTZEN
========================= */

app.post(
    "/api/item/use",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const name =
            req.body.name;

        const item =
            shop[name];

        if (
            !item ||
            item.type !==
                "energy"
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Item kann nicht benutzt werden."
            });
        }

        if (
            player.energy >=
            100
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Deine Energie ist bereits voll."
            });
        }

        if (
            !consume(
                player,
                name
            )
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Item nicht vorhanden."
            });
        }

        player.energy =
            Math.min(
                100,
                player.energy +
                    item.value
            );

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   DAILY
========================= */

app.post(
    "/api/daily",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const date =
            today();

        if (
            player.lastDaily ===
            date
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Daily bereits abgeholt."
            });
        }

        player.lastDaily =
            date;

        player.streak++;

        const reward =
            100 +
            Math.min(
                100,
                (player.streak - 1) *
                    10
            );

        player.coins +=
            reward;

        addXP(
            player,
            20
        );

        saveDB();

        res.json({
            success: true,
            reward,
            player
        });
    }
);

/* =========================
   RANGLISTE
========================= */

app.get(
    "/api/leaderboard",
    (req, res) => {
        clean();

        const players =
            Object.values(
                db.players
            );

        const money =
            [...players]
                .sort(
                    (a, b) =>
                        b.coins -
                        a.coins
                )
                .slice(0, 20)
                .map(
                    (player, index) => ({
                        rank:
                            index + 1,
                        username:
                            player.username,
                        value:
                            player.coins
                    })
                );

        const xp =
            [...players]
                .sort(
                    (a, b) => {
                        if (
                            b.level !==
                            a.level
                        ) {
                            return (
                                b.level -
                                a.level
                            );
                        }

                        return (
                            b.xp -
                            a.xp
                        );
                    }
                )
                .slice(0, 20)
                .map(
                    (player, index) => ({
                        rank:
                            index + 1,
                        username:
                            player.username,
                        value:
                            player.xp,
                        level:
                            player.level
                    })
                );

        res.json({
            success: true,
            money,
            xp
        });
    }
);

/* =========================
   FREUNDSCHAFTEN
========================= */

app.post(
    "/api/friend/add",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const username =
            String(
                req.body.username ||
                    ""
            ).trim();

        const target =
            db.players[username];

        if (!target) {
            return res.status(404).json({
                success: false,
                error:
                    "Spieler nicht gefunden."
            });
        }

        if (
            username ===
            player.username
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Du kannst dich nicht selbst hinzufügen."
            });
        }

        if (
            player.friends.includes(
                username
            )
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ihr seid bereits Freunde."
            });
        }

        normalizePlayer(target);

        if (
            target.friendRequests
                .incoming
                .includes(
                    player.username
                )
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Freundschaftsanfrage bereits gesendet."
            });
        }

        target.friendRequests
            .incoming
            .push(
                player.username
            );

        player.friendRequests
            .outgoing
            .push(username);

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   FREUNDSCHAFT ANNEHMEN
========================= */

app.post(
    "/api/friend/accept",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const username =
            String(
                req.body.username ||
                    ""
            ).trim();

        const target =
            db.players[username];

        if (!target) {
            return res.status(404).json({
                success: false,
                error:
                    "Spieler nicht gefunden."
            });
        }

        const index =
            player.friendRequests
                .incoming
                .indexOf(
                    username
                );

        if (index === -1) {
            return res.status(400).json({
                success: false,
                error:
                    "Keine Anfrage vorhanden."
            });
        }

        player.friendRequests
            .incoming
            .splice(index, 1);

        target.friendRequests
            .outgoing =
            target.friendRequests
                .outgoing
                .filter(
                    x =>
                        x !==
                        player.username
                );

        if (
            !player.friends.includes(
                username
            )
        ) {
            player.friends.push(
                username
            );
        }

        if (
            !target.friends.includes(
                player.username
            )
        ) {
            target.friends.push(
                player.username
            );
        }

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   FREUNDSCHAFT ABLEHNEN
========================= */

app.post(
    "/api/friend/decline",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const username =
            String(
                req.body.username ||
                    ""
            ).trim();

        const target =
            db.players[username];

        if (!target) {
            return res.status(404).json({
                success: false,
                error:
                    "Spieler nicht gefunden."
            });
        }

        player.friendRequests
            .incoming =
            player.friendRequests
                .incoming
                .filter(
                    x =>
                        x !==
                        username
                );

        target.friendRequests
            .outgoing =
            target.friendRequests
                .outgoing
                .filter(
                    x =>
                        x !==
                        player.username
                );

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   FREUND ENTFERNEN
========================= */

app.post(
    "/api/friend/remove",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const username =
            String(
                req.body.username ||
                    ""
            ).trim();

        const target =
            db.players[username];

        if (!target) {
            return res.status(404).json({
                success: false,
                error:
                    "Spieler nicht gefunden."
            });
        }

        player.friends =
            player.friends.filter(
                x =>
                    x !==
                    username
            );

        target.friends =
            target.friends.filter(
                x =>
                    x !==
                    player.username
            );

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   GESCHENK: COINS
========================= */

app.post(
    "/api/gift/coins",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const username =
            String(
                req.body.username ||
                    ""
            ).trim();

        const amount =
            Number(
                req.body.amount
            );

        const target =
            db.players[username];

        if (!target) {
            return res.status(404).json({
                success: false,
                error:
                    "Spieler nicht gefunden."
            });
        }

        if (
            !player.friends.includes(
                username
            )
        ) {
            return res.status(403).json({
                success: false,
                error:
                    "Du kannst nur Freunden Geschenke schicken."
            });
        }

        if (
            !Number.isSafeInteger(
                amount
            ) ||
            amount <= 0 ||
            amount >
                MAX_AMOUNT
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ungültige Menge."
            });
        }

        if (
            amount >
            player.coins
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Coins."
            });
        }

        player.coins -=
            amount;

        target.coins +=
            amount;

        player.gifts.push({
            type: "coins",
            to: username,
            amount,
            createdAt:
                Date.now()
        });

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   GESCHENK: ITEM
========================= */

app.post(
    "/api/gift/item",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const username =
            String(
                req.body.username ||
                    ""
            ).trim();

        const itemName =
            String(
                req.body.itemName ||
                    ""
            );

        const target =
            db.players[username];

        if (!target) {
            return res.status(404).json({
                success: false,
                error:
                    "Spieler nicht gefunden."
            });
        }

        if (
            !player.friends.includes(
                username
            )
        ) {
            return res.status(403).json({
                success: false,
                error:
                    "Du kannst nur Freunden Geschenke schicken."
            });
        }

        const index =
            player.inventory.findIndex(
                item =>
                    item.name ===
                        itemName &&
                    item.uses > 0
            );

        if (index === -1) {
            return res.status(400).json({
                success: false,
                error:
                    "Dieses Item befindet sich nicht in deinem Inventar."
            });
        }

        const item =
            player.inventory[index];

        item.uses--;

        if (item.uses <= 0) {
            player.inventory.splice(
                index,
                1
            );

            player.equipped =
                player.equipped.filter(
                    x =>
                        x !==
                        itemName
                );
        }

        const existing =
            target.inventory.find(
                x =>
                    x.name ===
                    itemName
            );

        if (existing) {
            existing.uses += 1;
        } else {
            target.inventory.push({
                name: itemName,
                uses: 1
            });
        }

        player.gifts.push({
            type: "item",
            to: username,
            item: itemName,
            createdAt:
                Date.now()
        });

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   BANK
========================= */

function feeFor(
    player,
    amount
) {
    if (
        player.feePassUntil >
        Date.now()
    ) {
        return 0;
    }

    return Math.max(
        1,
        Math.floor(
            amount * 0.02
        )
    );
}

app.post(
    "/api/bank/deposit",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const amount =
            Math.floor(
                Number(
                    req.body.amount
                )
            );

        if (
            !Number.isSafeInteger(
                amount
            ) ||
            amount <= 0 ||
            amount >
                player.coins
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ungültiger Betrag."
            });
        }

        const fee =
            feeFor(
                player,
                amount
            );

        player.coins -=
            amount;

        player.exchange +=
            amount - fee;

        saveDB();

        res.json({
            success: true,
            fee,
            player
        });
    }
);

app.post(
    "/api/bank/withdraw",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const amount =
            Math.floor(
                Number(
                    req.body.amount
                )
            );

        if (
            !Number.isSafeInteger(
                amount
            ) ||
            amount <= 0 ||
            amount >
                player.exchange
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ungültiger Betrag."
            });
        }

        const fee =
            feeFor(
                player,
                amount
            );

        player.exchange -=
            amount;

        player.coins +=
            amount - fee;

        saveDB();

        res.json({
            success: true,
            fee,
            player
        });
    }
);

/* =========================
   AKTIEN
========================= */

function updateStocks() {
    for (
        const stock
        of Object.values(
            db.stocks
        )
    ) {
        const movement =
            (
                Math.random() -
                0.48
            ) * 0.08;

        let next =
            stock.price *
            (1 + movement);

        next =
            Math.max(
                10,
                Math.min(
                    100000,
                    next
                )
            );

        stock.price =
            Math.round(
                next * 100
            ) / 100;

        stock.history ||= [];

        stock.history.push(
            stock.price
        );

        if (
            stock.history.length >
            100
        ) {
            stock.history.shift();
        }
    }

    saveDB();
}

setInterval(
    updateStocks,
    60000
);

app.get(
    "/api/stocks",
    (req, res) => {
        res.json({
            success: true,
            stocks:
                db.stocks
        });
    }
);

app.post(
    "/api/stock/buy",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const symbol =
            req.body.symbol;

        const stock =
            db.stocks[symbol];

        const amount =
            Math.floor(
                Number(
                    req.body.amount
                )
            );

        if (
            !stock ||
            !Number.isSafeInteger(
                amount
            ) ||
            amount <= 0
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ungültiger Kauf."
            });
        }

        const cost =
            stock.price *
            amount;

        const fee =
            feeFor(
                player,
                cost
            );

        const total =
            cost + fee;

        if (
            player.exchange <
            total
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Nicht genug Börsengeld."
            });
        }

        player.exchange -=
            total;

        player.portfolio[
            symbol
        ] ||= {
            amount: 0,
            invested: 0
        };

        player.portfolio[
            symbol
        ].amount +=
            amount;

        player.portfolio[
            symbol
        ].invested +=
            cost;

        saveDB();

        res.json({
            success: true,
            fee,
            player
        });
    }
);

app.post(
    "/api/stock/sell",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        const symbol =
            req.body.symbol;

        const stock =
            db.stocks[symbol];

        const amount =
            Math.floor(
                Number(
                    req.body.amount
                )
            );

        const holding =
            player.portfolio[
                symbol
            ];

        if (
            !stock ||
            !holding ||
            !Number.isSafeInteger(
                amount
            ) ||
            amount <= 0 ||
            amount >
                holding.amount
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ungültiger Verkauf."
            });
        }

        const gross =
            stock.price *
            amount;

        const fee =
            feeFor(
                player,
                gross
            );

        const net =
            gross - fee;

        const average =
            holding.invested /
            holding.amount;

        holding.invested -=
            average *
            amount;

        holding.amount -=
            amount;

        if (
            holding.amount <= 0
        ) {
            delete player
                .portfolio[
                    symbol
                ];
        }

        player.exchange +=
            net;

        saveDB();

        res.json({
            success: true,
            fee,
            profit:
                gross -
                fee -
                average *
                    amount,
            player
        });
    }
);

/* =========================
   MINER
========================= */

function minerData(level) {
    return {
        level,

        hourly:
            Math.round(
                2000 *
                Math.pow(
                    2.2,
                    level - 1
                )
            ),

        upgrade:
            Math.round(
                10000 *
                Math.pow(
                    2.7,
                    level - 1
                )
            )
    };
}

function processMiner(player) {
    if (!player.miner) {
        return;
    }

    const now =
        Date.now();

    const elapsed =
        Math.max(
            0,
            now -
                player.miner
                    .lastUpdate
        );

    const hours =
        elapsed /
        3600000;

    const data =
        minerData(
            player.miner.level
        );

    const conditionMultiplier =
        0.5 +
        player.miner.condition /
            200;

    const produced =
        data.hourly *
        hours *
        conditionMultiplier;

    player.miner.produced +=
        produced;

    const damage =
        hours * 1.2;

    player.miner.condition =
        Math.max(
            0,
            player.miner.condition -
                damage
        );

    player.miner.lastUpdate =
        now;
}

app.post(
    "/api/miner/buy",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        if (player.miner) {
            return res.status(400).json({
                success: false,
                error:
                    "Du besitzt bereits einen Miner."
            });
        }

        if (
            player.coins <
            10000
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ein Miner kostet 10.000 Coins."
            });
        }

        player.coins -=
            10000;

        player.miner = {
            level: 1,
            produced: 0,
            lastUpdate:
                Date.now(),
            condition: 100
        };

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

app.get(
    "/api/miner",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        processMiner(player);

        res.json({
            success: true,
            miner:
                player.miner
                    ? {
                        ...player.miner,
                        stats:
                            minerData(
                                player.miner
                                    .level
                            )
                    }
                    : null
        });
    }
);

app.post(
    "/api/miner/collect",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        processMiner(player);

        if (!player.miner) {
            return res.status(400).json({
                success: false,
                error:
                    "Kein Miner vorhanden."
            });
        }

        const amount =
            Math.floor(
                player.miner.produced
            );

        if (amount <= 0) {
            return res.status(400).json({
                success: false,
                error:
                    "Der Miner hat noch nichts produziert."
            });
        }

        player.miner.produced -=
            amount;

        player.coins +=
            Math.floor(
                amount *
                incomeMultiplier(
                    player
                )
            );

        saveDB();

        res.json({
            success: true,
            amount,
            player
        });
    }
);

app.post(
    "/api/miner/upgrade",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        processMiner(player);

        if (!player.miner) {
            return res.status(400).json({
                success: false,
                error:
                    "Kein Miner vorhanden."
            });
        }

        const data =
            minerData(
                player.miner.level
            );

        if (
            player.coins <
            data.upgrade
        ) {
            return res.status(400).json({
                success: false,
                error:
                    `Upgrade kostet ${data.upgrade.toLocaleString("de-DE")} Coins.`
            });
        }

        player.coins -=
            data.upgrade;

        player.miner.level++;

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

app.post(
    "/api/miner/repair",
    (req, res) => {
        const player =
            requirePlayer(req, res);

        if (!player) return;

        processMiner(player);

        if (!player.miner) {
            return res.status(400).json({
                success: false,
                error:
                    "Kein Miner vorhanden."
            });
        }

        const missing =
            100 -
            player.miner.condition;

        if (missing <= 0) {
            return res.status(400).json({
                success: false,
                error:
                    "Miner ist vollständig repariert."
            });
        }

        const cost =
            Math.max(
                50,
                Math.round(
                    missing *
                    player.miner.level *
                    20
                )
            );

        if (
            player.coins <
            cost
        ) {
            return res.status(400).json({
                success: false,
                error:
                    `Reparatur kostet ${cost.toLocaleString("de-DE")} Coins.`
            });
        }

        player.coins -=
            cost;

        player.miner.condition =
            100;

        saveDB();

        res.json({
            success: true,
            player
        });
    }
);

/* =========================
   ADMIN
========================= */

function checkAdmin(req, res) {
    if (
        req.body.password !==
        ADMIN_PASSWORD
    ) {
        res.status(401).json({
            success: false,
            error:
                "Falsches Admin-Passwort."
        });

        return false;
    }

    return true;
}

app.post(
    "/api/admin/login",
    (req, res) => {
        if (
            !checkAdmin(
                req,
                res
            )
        ) {
            return;
        }

        res.json({
            success: true
        });
    }
);

app.post(
    "/api/admin/stats",
    (req, res) => {
        if (
            !checkAdmin(
                req,
                res
            )
        ) {
            return;
        }

        clean();

        res.json({
            success: true,

            onlinePlayers:
                Object.values(
                    db.players
                ).filter(
                    p =>
                        p.online
                ).length,

            totalPlayers:
                Object.keys(
                    db.players
                ).length
        });
    }
);

/* =========================
   ADMIN COINS / XP
========================= */

app.post(
    "/api/admin/give",
    (req, res) => {
        if (
            !checkAdmin(
                req,
                res
            )
        ) {
            return;
        }

        const username =
            String(
                req.body.username ||
                    ""
            ).trim();

        const amount =
            Number(
                req.body.amount
            );

        const type =
            req.body.type;

        const player =
            db.players[username];

        if (!player) {
            return res.status(404).json({
                success: false,
                error:
                    "Spieler nicht gefunden."
            });
        }

        /*
         * Keine künstliche
         * 1-Milliarden-Grenze mehr.
         *
         * Erlaubt sind alle sicheren
         * JavaScript-Ganzzahlen bis
         * Number.MAX_SAFE_INTEGER.
         */

        if (
            !Number.isSafeInteger(
                amount
            ) ||
            amount <= 0 ||
            amount >
                MAX_AMOUNT
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Ungültige Menge."
            });
        }

        if (
            type === "coins"
        ) {
            player.coins +=
                amount;
        }

        else if (
            type === "xp"
        ) {
            addXP(
                player,
                amount
            );
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
            username,
            amount,
            type
        });
    }
);

/* =========================
   ADMIN SEITE
========================= */

app.get(
    "/admin",
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );
    }
);

/* =========================
   FALLBACK
========================= */

app.use(
    (req, res) => {
        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );
    }
);

/* =========================
   AUTOMATISCHE BEREINIGUNG
========================= */

setInterval(
    () => {
        clean();
        saveDB();
    },
    30000
);

/* =========================
   SERVER START
========================= */

app.listen(
    PORT,
    () => {
        console.log(
            `🔥 CUBIX CITY läuft auf Port ${PORT}`
        );
    }
);
