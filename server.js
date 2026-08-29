const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cubix-admin";

const onlinePlayers = new Map();

function cleanupPlayers() {
    const now = Date.now();

    for (const [id, lastSeen] of onlinePlayers.entries()) {
        if (now - lastSeen > 90000) {
            onlinePlayers.delete(id);
        }
    }
}

app.post("/api/heartbeat", (req, res) => {
    const { playerId } = req.body;

    if (!playerId) {
        return res.status(400).json({ success: false });
    }

    onlinePlayers.set(playerId, Date.now());
    cleanupPlayers();

    res.json({
        success: true,
        online: onlinePlayers.size
    });
});

app.get("/api/online", (req, res) => {
    cleanupPlayers();

    res.json({
        online: onlinePlayers.size
    });
});

app.post("/api/admin/login", (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false
        });
    }

    res.json({
        success: true
    });
});

app.post("/api/admin/stats", (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false
        });
    }

    cleanupPlayers();

    res.json({
        success: true,
        onlinePlayers: onlinePlayers.size
    });
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`🔥 CUBIX CITY läuft auf Port ${PORT}`);
});
