const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

app.get("/webhook", (req, res) => {
    res.send("CUBIX Webhook erreichbar!");
});

app.listen(PORT, () => {
    console.log(`CUBIX läuft auf Port ${PORT}`);
});
