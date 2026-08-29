const express = require("express");

const app = express();

app.use(express.json());

// Startseite
app.get("/", (req, res) => {
    res.send("🎮 CUBIX-Bot läuft!");
});

// WhatsApp Webhook
app.get("/webhook", (req, res) => {
    res.send("Webhook erreichbar!");
});

// Server starten
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`CUBIX-Bot läuft auf Port ${PORT}`);
});
