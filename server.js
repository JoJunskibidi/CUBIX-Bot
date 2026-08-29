const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// CUBIX CITY - SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

// Admin-Passwort.
// Später kannst du dieses Passwort in Render als Environment
// Variable ADMIN_PASSWORD setzen.
// Falls du dort noch nichts eingestellt hast, funktioniert
// zunächst das Standard-Passwort: cubix-admin
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cubix-admin";

// Spieler, die gerade online sind
const onlinePlayers = new Map();

// Spieleraktivität
app.post("/api/heartbeat", (req, res) => {
    const playerId = req.body.playerId;

    if (!playerId) {
        return res.status(400).json({
            success: false
        });
    }

    onlinePlayers.set(playerId, Date.now());

    // Spieler entfernen, die länger als 90 Sekunden nichts gesendet haben
    const now = Date.now();

    for (const [id, lastSeen] of onlinePlayers.entries()) {
        if (now - lastSeen > 90000) {
            onlinePlayers.delete(id);
        }
    }

    res.json({
        success: true,
        online: onlinePlayers.size
    });
});

// Spielerzahl
app.get("/api/online", (req, res) => {
    const now = Date.now();

    for (const [id, lastSeen] of onlinePlayers.entries()) {
        if (now - lastSeen > 90000) {
            onlinePlayers.delete(id);
        }
    }

    res.json({
        online: onlinePlayers.size
    });
});

// =====================================================
// ADMIN
// =====================================================

app.post("/api/admin/login", (req, res) => {
    const password = req.body.password;

    if (password === ADMIN_PASSWORD) {
        return res.json({
            success: true
        });
    }

    res.status(401).json({
        success: false,
        message: "Falsches Passwort."
    });
});

// Admin-Statistiken
app.post("/api/admin/stats", (req, res) => {
    const password = req.body.password;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false
        });
    }

    const now = Date.now();

    for (const [id, lastSeen] of onlinePlayers.entries()) {
        if (now - lastSeen > 90000) {
            onlinePlayers.delete(id);
        }
    }

    res.json({
        success: true,
        onlinePlayers: onlinePlayers.size,
        serverTime: new Date().toISOString()
    });
});

// =====================================================
// STARTSEITE
// =====================================================

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`🎮 CUBIX CITY läuft auf Port ${PORT}`);
});
