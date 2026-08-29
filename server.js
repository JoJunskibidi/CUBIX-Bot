const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.get("/webhook", (req, res) => {
    res.send("CUBIX Webhook erreichbar!");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("CUBIX läuft auf Port " + PORT);
});
